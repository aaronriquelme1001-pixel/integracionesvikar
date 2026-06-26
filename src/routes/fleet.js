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
    
    // Helper to parse Chile local time "DD-MM-YYYY HH:mm" to a Javascript Date
    const parseChileDate = (dStr, isEndOfDay = false) => {
      if (!dStr) return null;
      const parts = dStr.split(' ');
      const datePart = parts[0];
      const timePart = parts[1] || (isEndOfDay ? '23:59:59' : '00:00:00');
      
      const dParts = datePart.split('-');
      if (dParts.length === 3) {
        // Assume DD-MM-YYYY
        const d = dParts[0].padStart(2, '0');
        const m = dParts[1].padStart(2, '0');
        const y = dParts[2].length === 2 ? `20${dParts[2]}` : dParts[2];
        
        // Ensure timePart has seconds
        const t = timePart.split(':').length === 2 ? `${timePart}:00` : timePart;
        
        // Chile standard timezone offset is roughly -04:00
        return new Date(`${y}-${m}-${d}T${t}-04:00`);
      }
      return null;
    };

    const normStart = parseChileDate(start_date);
    let normEnd = parseChileDate(end_date, true);
    
    // Fallback if end date not provided
    if (!normEnd && normStart) {
       // If no end date, set to end of the same day
       normEnd = new Date(normStart);
       normEnd.setHours(23, 59, 59, 999);
    }
    
    // Use Javascript Date objects natively, BigQuery handles them as TIMESTAMP
    query += ` AND dt_tracker >= @normStart`;
    params.normStart = normStart;
    
    if (normEnd) {
      query += ` AND dt_tracker <= @normEnd`;
      params.normEnd = normEnd;
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
