const express = require('express');
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
const axios = require('axios');

const router = express.Router();

let pool = null;
if (process.env.DATALAKE_URL) {
  pool = new Pool({
    connectionString: process.env.DATALAKE_URL,
    ssl: { rejectUnauthorized: false }
  });
}

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
  if (!pool) return res.status(500).send('Data Lake no configurado.');
  
  const { plate, time, window, secret } = req.query;
  
  if (secret !== 'vikar2026') return res.status(403).send('No autorizado.');
  if (!plate) return res.status(400).send('Debes proveer el parámetro plate.');

  try {
    // 1. Telemetry Query
    let query = `SELECT lat, lng, speed, dt_tracker, client_source FROM global_telemetry_traffic WHERE LOWER(plate) = LOWER($1)`;
    const params = [plate];

    if (time) {
      const windowMinutes = parseInt(window) || 5;
      query += ` AND dt_tracker >= $2::timestamp - interval '${windowMinutes} minutes'`;
      query += ` AND dt_tracker <= $2::timestamp + interval '${windowMinutes} minutes'`;
      params.push(time);
    }
    
    query += ` ORDER BY dt_tracker ASC LIMIT 500`;
    const result = await pool.query(query, params);
    const rows = result.rows;

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

      const dateStr = new Date(row.dt_tracker).toISOString().replace('T', ' ').substring(0, 19);
      chartLabels.push(dateStr.substring(11));
      chartSpeeds.push(speed);
      chartColors.push(getPointColor(speed));

      mapData.push({
        lat: row.lat,
        lng: row.lng,
        speed: speed,
        time: dateStr.substring(11),
        isIncident: false // Will mark the highest delta as incident later if needed
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
      const geoRes = await axios.get(geoUrl, { headers: { 'User-Agent': 'VikarGPS-Forensics/1.0' } });
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
      const wRes = await axios.get(wUrl);
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
    } catch (e) { }

    // 6. Deterministic Verdict Engine
    let verdictTitle = '';
    let verdictBody = '';
    let verdictClass = ''; // Used for CSS styling

    if (hasSpeeding && hasHardBraking && weatherCondition.includes('Lluvioso')) {
      verdictTitle = 'RESPONSABILIDAD DEL CONDUCTOR (Agravada)';
      verdictBody = 'El conductor excedió los límites de seguridad en condiciones de pavimento mojado y visibilidad reducida, desencadenando una maniobra evasiva (frenado brusco) incontrolable debido a la inercia.';
      verdictClass = 'verdict-danger';
    } else if (hasSpeeding && hasHardBraking) {
      verdictTitle = 'RESPONSABILIDAD DEL CONDUCTOR (Negligencia Inercial)';
      verdictBody = 'El análisis determina que el conductor superó el límite de velocidad y aplicó un frenado crítico de emergencia. Bajo condiciones de clima seco, la pérdida de control se atribuye puramente al factor humano y exceso de fuerza G longitudinal.';
      verdictClass = 'verdict-danger';
    } else if (!hasSpeeding && hasHardBraking && weatherCondition.includes('Lluvioso')) {
      verdictTitle = 'INCIDENTE DE FUERZA MAYOR (Condiciones Climáticas)';
      verdictBody = 'El vehículo transitaba dentro del límite legal de velocidad. La pérdida de control o accidente se atribuye al pavimento resbaladizo y pérdida de coeficiente de roce debido a la lluvia reportada en el sector.';
      verdictClass = 'verdict-warning';
    } else if (!hasSpeeding && timeStopped > 120) {
      verdictTitle = 'INCIDENTE VIAL EXTERNO (Atasco / Control)';
      verdictBody = 'El vehículo no superó la velocidad máxima y registra una detención prolongada (superior a 2 minutos). Esto coincide con patrones de tráfico denso externo, accidentes de terceros en la ruta o controles policiales.';
      verdictClass = 'verdict-info';
    } else {
      verdictTitle = 'CONDUCCIÓN NORMAL (Sin Hallazgos Graves)';
      verdictBody = 'La telemetría indica que el vehículo se mantuvo dentro de los parámetros esperados de operación logística regular, sin frenadas de emergencia ni excesos de velocidad sostenidos.';
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

    // 7. Render Template
    const templatePath = path.join(__dirname, '../templates/forensic_report.html');
    let template = fs.readFileSync(templatePath, 'utf8');

    const clientSource = rows[0].client_source;

    template = template
      .replace(/{{REPORT_ID}}/g, 'FR-' + Date.now().toString().substring(5))
      .replace(/{{GENERATION_DATE}}/g, new Date().toISOString().replace('T', ' ').substring(0, 19) + ' UTC')
      .replace(/{{ALERT_CLASS}}/g, alertClass)
      .replace(/{{ALERT_TITLE}}/g, alertTitle)
      .replace(/{{ALERT_MESSAGE}}/g, alertMessage)
      .replace(/{{PLATE}}/g, plate.toUpperCase())
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
    res.status(500).send('Error interno generando el reporte.');
  }
});

module.exports = router;
