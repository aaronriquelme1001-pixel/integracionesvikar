const express = require('express');
const { BigQuery } = require('@google-cloud/bigquery');
const fs = require('fs');
const path = require('path');

const router = express.Router();

let bigquery = null;
if (process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON) {
  const credentials = JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON);
  bigquery = new BigQuery({ projectId: credentials.project_id, credentials });
} else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
  bigquery = new BigQuery(); 
} else if (fs.existsSync(path.join(__dirname, '../../bq-key.json'))) {
  bigquery = new BigQuery({ projectId: 'vikargpsdatos', keyFilename: path.join(__dirname, '../../bq-key.json') });
}

// GET /api/fleet/history
router.get('/history', async (req, res) => {
  if (!bigquery) return res.status(500).json({ error: 'Data Lake (BigQuery) no configurado.' });
  
  const { imei, start_date, end_date } = req.query;
  
  if (!imei) return res.status(400).json({ error: 'Falta el parámetro imei.' });
  if (!start_date) return res.status(400).json({ error: 'Falta el parámetro start_date.' });

  try {
    let query = `
      SELECT lat, lng, speed, dt_tracker, plate, altitude, angle, params, loc_valid
      FROM \`telemetry.global_traffic\` 
      WHERE imei = @imei 
    `;
    const params = { imei };
    
    // Helper to normalize dates
    const normalizeDate = (d) => {
      if (!d) return null;
      // Handle both "DD-MM-YYYY" and "DD-MM-YYYY HH:mm"
      const parts = d.split(' ');
      const datePart = parts[0];
      const timePart = parts[1] ? ' ' + parts[1] : '';
      const dParts = datePart.split('-');
      if (dParts.length === 3 && dParts[0].length === 2 && dParts[2].length === 4) {
        return `${dParts[2]}-${dParts[1]}-${dParts[0]}${timePart}`;
      }
      return d;
    };

    const normStart = normalizeDate(start_date);
    const normEnd = normalizeDate(end_date);
    
    // Parse start date
    query += ` AND dt_tracker >= TIMESTAMP(@normStart)`;
    params.normStart = normStart;
    
    // Parse end date
    let finalEndDate = normEnd;
    if (!finalEndDate) {
      if (normStart.includes('T') || normStart.includes(' ')) {
        finalEndDate = normStart; 
      } else {
        finalEndDate = `${normStart} 23:59:59`;
      }
    }
    
    if (finalEndDate) {
      // If finalEndDate is just a date like YYYY-MM-DD and doesn't have time, make sure it covers the day
      if (finalEndDate.length === 10) {
        finalEndDate = `${finalEndDate} 23:59:59`;
      }
      query += ` AND dt_tracker <= TIMESTAMP(@finalEndDate)`;
      params.finalEndDate = finalEndDate;
    }
    
    query += ` ORDER BY dt_tracker ASC LIMIT 10000`; // Limit set to 10000 to prevent OOM

    const [rows] = await bigquery.query({
      query,
      params
    });
    
    const formattedRows = rows.map(row => ({
      ...row,
      dt_tracker: row.dt_tracker.value ? row.dt_tracker.value : row.dt_tracker
    }));

    res.json({
      success: true,
      count: formattedRows.length,
      data: formattedRows
    });
    
  } catch (err) {
    console.error('Error fetching fleet history:', err);
    res.status(500).json({ error: 'Error interno obteniendo el historial.' });
  }
});

module.exports = router;
