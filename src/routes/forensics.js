const express = require('express');
const { BigQuery } = require('@google-cloud/bigquery');
const fs = require('fs');
const path = require('path');
const axios = require('axios');

const router = express.Router();

let bqClient = null;
if (process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON) {
   const credentials = JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON);
   bqClient = new BigQuery({ projectId: credentials.project_id, credentials });
} else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
   bqClient = new BigQuery();
} else if (fs.existsSync('./bq-key.json')) {
   bqClient = new BigQuery({ projectId: 'vikargpsdatos', keyFilename: './bq-key.json' });
}

const templatePath = path.join(__dirname, '../templates/forensic_report.html');
const forensicTemplate = fs.readFileSync(templatePath, 'utf8');

function getStatusBadge(speed, previousSpeed) {
  if (speed === 0) return '<span class="badge badge-danger">Detenido</span>';
  if (speed > 90) return '<span class="badge badge-warning">Exceso Vel.</span>';
  
  if (previousSpeed !== null) {
    const delta = speed - previousSpeed;
    if (delta > 20) return '<span class="badge badge-warning">Ace. Fuerte</span>';
    if (delta < -20) return '<span class="badge badge-danger">Freno Fuerte</span>';
  }
  
  if (speed > 5) return '<span class="badge badge-success">En Ruta</span>';
  return '<span class="badge badge-info">Mov. Lento</span>';
}

function getPointColor(speed) {
  if (speed === 0) return '#e53e3e';
  if (speed > 90) return '#dd6b20';
  return '#3182ce';
}

router.get('/', async (req, res) => {
  if (!bqClient) {
    if (req.query.format === 'json') return res.status(500).json({ error: 'BigQuery Data Lake no configurado.' });
    return res.status(500).send('BigQuery Data Lake no configurado.');
  }
  
  const { plate, imei, time, window, secret, format } = req.query;
  
  if (secret !== 'vikar2026') {
    if (format === 'json') return res.status(403).json({ error: 'No autorizado.' });
    return res.status(403).send('No autorizado.');
  }
  if (!plate && !imei) {
    if (format === 'json') return res.status(400).json({ error: 'Debes proveer el parámetro plate o imei.' });
    return res.status(400).send('Debes proveer el parámetro plate o imei.');
  }

  try {
    // 1. Telemetry Query
    let query = `SELECT lat, lng, speed, dt_tracker, client_source, altitude, angle, params, loc_valid FROM \`telemetry.global_traffic\` WHERE 1=1 `;
    const params = {};

    if (imei) {
      query += ` AND imei = @imei`;
      params.imei = imei;
    } else {
      query += ` AND REPLACE(LOWER(plate), '-', '') = REPLACE(LOWER(@plate), '-', '')`;
      params.plate = plate;
    }

    if (time) {
      const windowMinutes = parseInt(window) || 5;
      query += ` AND dt_tracker >= TIMESTAMP_SUB(CAST(@time AS TIMESTAMP), INTERVAL ${windowMinutes} MINUTE)`;
      query += ` AND dt_tracker <= TIMESTAMP_ADD(CAST(@time AS TIMESTAMP), INTERVAL ${windowMinutes} MINUTE)`;
      params.time = time;
    }
    
    query += ` ORDER BY dt_tracker ASC LIMIT 500`;
    const [rows] = await bqClient.query({ query, params });

    if (rows.length === 0) {
      return res.status(404).send('No se encontraron registros en esa ventana de tiempo.');
    }

    // 2. Compute Incident point (Highest risk point: lowest speed if hard braking, or highest speed)
    let maxSpeed = 0;
    let sumSpeed = 0;
    let incidentRow = rows[Math.floor(rows.length / 2)]; // default to middle
    let maxDelta = 0;

    let hasSpeeding = false;
    let hasHardBraking = false;
    let timeStopped = 0; // seconds

    const chartLabels = [];
    const chartSpeeds = [];
    const chartColors = [];
    const mapData = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const speed = Number(row.speed) || 0;
      const prevSpeed = i > 0 ? (Number(rows[i-1].speed) || 0) : null;
      
      maxSpeed = Math.max(maxSpeed, speed);
      sumSpeed += speed;

      if (speed > 90) hasSpeeding = true;
      if (prevSpeed !== null) {
        const delta = Math.abs(speed - prevSpeed);
        if (speed - prevSpeed < -20) hasHardBraking = true;
        if (delta > maxDelta) {
           maxDelta = delta;
           incidentRow = row; // Assume the biggest speed change is the incident
        }
      }

      if (speed === 0) timeStopped += 60; // Approximate

      const rawDt = row.dt_tracker?.value || row.dt_tracker;
      const dateStr = new Date(rawDt).toISOString().replace('T', ' ').substring(0, 19);
      chartLabels.push(dateStr.substring(11));
      chartSpeeds.push(speed);
      chartColors.push(getPointColor(speed));

      mapData.push({
        lat: row.lat,
        lng: row.lng,
        speed: speed,
        time: dateStr.substring(11),
        isIncident: false, // Will mark the highest delta as incident later if needed
        altitude: row.altitude,
        angle: row.angle,
        params: typeof row.params === 'string' ? JSON.parse(row.params) : row.params,
        loc_valid: row.loc_valid
      });
    }

    if (incidentRow) {
      // Find the incident in mapData and mark it
      const incTime = new Date(incidentRow.dt_tracker).toISOString().replace('T', ' ').substring(11, 19);
      const m = mapData.find(d => d.time === incTime);
      if (m) m.isIncident = true;
    }

    const avgSpeed = Math.round(sumSpeed / rows.length);

    // 3. Reverse Geocoding (Nominatim API)
    let locationName = 'Desconocida';
    try {
      const geoUrl = `https://nominatim.openstreetmap.org/reverse?lat=${incidentRow.lat}&lon=${incidentRow.lng}&format=json`;
      const geoRes = await axios.get(geoUrl, { 
        headers: { 'User-Agent': 'VikarGPS-Forensics/1.0' },
        timeout: 5000
      });
      if (geoRes.data && geoRes.data.display_name) {
        locationName = geoRes.data.display_name;
      }
    } catch (e) {
      console.error('[Forensics] Geo Error:', e.message);
    }

    // 4. Weather API (Open-Meteo)
    let weatherCondition = 'Desconocido';
    let temp = 'N/A';
    let rain = 'N/A';
    try {
      // Simplification: query current weather at that lat/lng (since it's recent)
      const wUrl = `https://api.open-meteo.com/v1/forecast?latitude=${incidentRow.lat}&longitude=${incidentRow.lng}&current=temperature_2m,rain,weather_code`;
      const wRes = await axios.get(wUrl, { timeout: 5000 });
      const wData = wRes.data.current;
      temp = wData.temperature_2m + '°C';
      rain = wData.rain + ' mm';
      if (wData.rain > 0) weatherCondition = 'Lluvioso (Riesgo de Aquaplaning)';
      else if (wData.weather_code > 50) weatherCondition = 'Precipitaciones / Poca Visibilidad';
      else weatherCondition = 'Despejado / Seco';
    } catch (e) {
      console.error('[Forensics] Weather Error:', e.message);
    }

    // 5. Fatigue Calculation (Query total time active for today)
    let fatigueHours = '0.5h';
    try {
      const fatQ = `SELECT min(dt_tracker) as start_time FROM global_telemetry_traffic WHERE plate = $1 AND dt_tracker >= CURRENT_DATE`;
      const fatRes = await pool.query(fatQ, [plate]);
      if (fatRes.rows[0].start_time) {
         const diffMs = new Date() - new Date(fatRes.rows[0].start_time);
         fatigueHours = (diffMs / (1000 * 60 * 60)).toFixed(1) + ' hrs';
      }
    } catch (e) {
      console.warn('[Forensics] Fatigue Calculation Error:', e.message);
    }

    // 6. Deterministic Verdict Engine (Route Analysis - No accident assumption)
    let verdictTitle = '';
    let verdictBody = '';
    let verdictClass = ''; // Used for CSS styling

    if (hasSpeeding && hasHardBraking && weatherCondition.includes('Lluvioso')) {
      verdictTitle = 'CONDUCCIÓN TEMERARIA (Riesgo Agravado por Clima)';
      verdictBody = 'El conductor excedió los límites de velocidad bajo condiciones climáticas adversas (lluvia) y registró eventos de frenado brusco, lo que representa un alto riesgo operativo y desgaste excesivo bajo baja adherencia.';
      verdictClass = 'verdict-danger';
    } else if (hasSpeeding && hasHardBraking) {
      verdictTitle = 'CONDUCCIÓN AGRESIVA (Mala Gestión de Inercia)';
      verdictBody = 'El análisis de la ruta detecta continuos excesos de velocidad combinados con frenadas bruscas. Este patrón de manejo es ineficiente, desgasta prematuramente el vehículo y aumenta sustancialmente las probabilidades de colisión por alcance.';
      verdictClass = 'verdict-danger';
    } else if (!hasSpeeding && hasHardBraking && weatherCondition.includes('Lluvioso')) {
      verdictTitle = 'FRENADO DE PRECAUCIÓN (Condiciones Climáticas)';
      verdictBody = 'El vehículo operó dentro del límite de velocidad. Se detectaron eventos de frenado brusco que se atribuyen a maniobras evasivas preventivas dadas las condiciones de lluvia y pavimento resbaladizo en la ruta.';
      verdictClass = 'verdict-warning';
    } else if (!hasSpeeding && timeStopped > 120) {
      verdictTitle = 'CONGESTIÓN O DETENCIÓN EN RUTA';
      verdictBody = 'El vehículo respetó las velocidades máximas y registró detenciones prolongadas. Esto coincide con patrones de tráfico denso, detenciones logísticas operativas o controles en ruta.';
      verdictClass = 'verdict-info';
    } else {
      verdictTitle = 'CONDUCCIÓN EFICIENTE Y SEGURA';
      verdictBody = 'La telemetría indica que la ruta se completó de manera impecable, operando dentro de los parámetros esperados de seguridad, sin frenadas de emergencia ni excesos de velocidad. Excelente perfil de conducción.';
      verdictClass = 'verdict-success';
    }

    // Set Alert Box
    let alertClass = '';
    let alertTitle = 'Patrón de Conducción Normal';
    let alertMessage = 'No se detectaron anomalías inerciales significativas en esta ventana de tiempo.';

    if (hasSpeeding && hasHardBraking) {
      alertClass = ''; 
      alertTitle = '🚨 Alerta Temeraria Múltiple';
      alertMessage = 'Exceso de velocidad combinado con frenadas bruscas.';
    } else if (hasHardBraking) {
      alertClass = 'warning';
      alertTitle = '⚠️ Frenado Brusco Detectado';
      alertMessage = 'Reducción anormal de velocidad en corto tiempo.';
    } else if (hasSpeeding) {
      alertClass = 'warning';
      alertTitle = '⚠️ Exceso de Velocidad';
      alertMessage = 'El vehículo superó los límites de seguridad (>90km/h).';
    }

    if (format === 'json') {
      return res.json({
        report_id: 'FR-' + Date.now().toString().substring(5),
        generation_date: new Date().toISOString(),
        vehicle: {
          plate: (plate || '').toUpperCase(),
          imei: imei || null,
          client_source: rows[0].client_source.toUpperCase()
        },
        analysis: {
          total_records: rows.length,
          max_speed: maxSpeed,
          avg_speed: avgSpeed,
          time_window: time ? `+/- ${window || 5} min desde ${time}` : 'Últimos registros',
          location: locationName
        },
        weather: {
          condition: weatherCondition,
          temp: temp,
          rain: rain
        },
        fatigue_hours: fatigueHours,
        verdict: {
          title: verdictTitle,
          body: verdictBody,
          severity_class: verdictClass
        },
        alert: {
          title: alertTitle,
          message: alertMessage,
          severity_class: alertClass
        },
        map_data: mapData,
        chart_data: {
          labels: chartLabels,
          speeds: chartSpeeds,
          pointColors: chartColors
        }
      });
    }

    // 7. Render Template
    let template = forensicTemplate;

    const clientSource = rows[0].client_source;

    template = template
      .replace(/{{REPORT_ID}}/g, 'FR-' + Date.now().toString().substring(5))
      .replace(/{{GENERATION_DATE}}/g, new Date().toISOString().replace('T', ' ').substring(0, 19) + ' UTC')
      .replace(/{{ALERT_CLASS}}/g, alertClass)
      .replace(/{{ALERT_TITLE}}/g, alertTitle)
      .replace(/{{ALERT_MESSAGE}}/g, alertMessage)
      .replace(/{{PLATE}}/g, (plate || '').toUpperCase())
      .replace(/{{CLIENT_SOURCE}}/g, clientSource.toUpperCase())
      .replace(/{{TOTAL_RECORDS}}/g, rows.length)
      .replace(/{{MAX_SPEED}}/g, maxSpeed)
      .replace(/{{AVG_SPEED}}/g, avgSpeed)
      .replace(/{{TIME_WINDOW}}/g, time ? `+/- ${window || 5} min desde ${time}` : 'Últimos registros')
      .replace(/{{LOCATION_NAME}}/g, locationName)
      .replace(/{{WEATHER_CONDITION}}/g, weatherCondition)
      .replace(/{{WEATHER_TEMP}}/g, temp)
      .replace(/{{WEATHER_RAIN}}/g, rain)
      .replace(/{{FATIGUE_HOURS}}/g, fatigueHours)
      .replace(/{{VERDICT_CLASS}}/g, verdictClass)
      .replace(/{{VERDICT_TITLE}}/g, verdictTitle)
      .replace(/{{VERDICT_BODY}}/g, verdictBody)
      .replace(/{{MAP_DATA_JSON}}/g, JSON.stringify(mapData))
      .replace(/{{CHART_DATA_JSON}}/g, JSON.stringify({
        labels: chartLabels,
        speeds: chartSpeeds,
        pointColors: chartColors
      }));

    res.send(template);

  } catch (err) {
    console.error('Forensic Endpoint Error:', err);
    if (req.query.format === 'json') return res.status(500).json({ error: 'Error interno generando el reporte.' });
    res.status(500).send('Error interno generando el reporte.');
  }
});

module.exports = router;
