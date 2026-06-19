const express = require('express');
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

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
  if (speed > 90) return '<span class="badge badge-warning">Exceso de Velocidad</span>';
  
  if (previousSpeed !== null) {
    const delta = speed - previousSpeed;
    if (delta > 20) return '<span class="badge badge-warning">Aceleración Fuerte</span>';
    if (delta < -20) return '<span class="badge badge-danger">Frenado Fuerte</span>';
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
  
  // Basic security check matching the rest of the API
  if (secret !== 'vikar2026') {
    return res.status(403).send('No autorizado.');
  }

  if (!plate) {
    return res.status(400).send('Debes proveer el parámetro plate.');
  }

  try {
    let query = `
      SELECT lat, lng, speed, dt_tracker, client_source 
      FROM global_telemetry_traffic 
      WHERE plate = $1
    `;
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
      return res.status(404).send('No se encontraron registros para esa patente en esa ventana de tiempo.');
    }

    // Load HTML Template
    const templatePath = path.join(__dirname, '../templates/forensic_report.html');
    let template = fs.readFileSync(templatePath, 'utf8');

    // Process Analytics
    let maxSpeed = 0;
    let sumSpeed = 0;
    let tableRowsHTML = '';
    const chartLabels = [];
    const chartSpeeds = [];
    const chartColors = [];

    const clientSource = rows[0].client_source;

    // Detect anomalies
    let hasSpeeding = false;
    let hasHardBraking = false;

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const speed = Number(row.speed) || 0;
      const prevSpeed = i > 0 ? (Number(rows[i-1].speed) || 0) : null;
      
      maxSpeed = Math.max(maxSpeed, speed);
      sumSpeed += speed;

      if (speed > 90) hasSpeeding = true;
      if (prevSpeed !== null && (speed - prevSpeed) < -20) hasHardBraking = true;

      const dateStr = new Date(row.dt_tracker).toISOString().replace('T', ' ').substring(0, 19);
      
      chartLabels.push(dateStr.substring(11)); // Just the time
      chartSpeeds.push(speed);
      chartColors.push(getPointColor(speed));

      tableRowsHTML += `
        <tr>
          <td>${dateStr}</td>
          <td>${row.lat}</td>
          <td>${row.lng}</td>
          <td>${speed}</td>
          <td>${getStatusBadge(speed, prevSpeed)}</td>
        </tr>
      `;
    }

    const avgSpeed = Math.round(sumSpeed / rows.length);

    // Set Alert Box
    let alertClass = '';
    let alertTitle = 'Patrón de Conducción Normal';
    let alertMessage = 'No se detectaron anomalías inerciales significativas en esta ventana de tiempo.';

    if (hasSpeeding && hasHardBraking) {
      alertClass = ''; // uses default danger
      alertTitle = '🚨 Alerta Temeraria Múltiple';
      alertMessage = 'Se detectó exceso de velocidad combinado con frenadas bruscas, indicio alto de riesgo inercial o colisión.';
    } else if (hasHardBraking) {
      alertClass = 'warning';
      alertTitle = '⚠️ Frenado Brusco Detectado';
      alertMessage = 'Se detectó una reducción anormal de velocidad en corto tiempo.';
    } else if (hasSpeeding) {
      alertClass = 'warning';
      alertTitle = '⚠️ Exceso de Velocidad';
      alertMessage = 'El vehículo superó los límites de velocidad configurados (>90km/h).';
    }

    // Replace Placeholders
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
      .replace(/{{TIME_WINDOW}}/g, time ? `+/- ${window || 5} min desde ${time}` : 'Últimos registros disponibles')
      .replace(/{{TABLE_ROWS}}/g, tableRowsHTML)
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
