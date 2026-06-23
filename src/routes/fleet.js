const express = require('express');
const { Pool } = require('pg');

const router = express.Router();

let pool = null;
if (process.env.DATALAKE_URL) {
  pool = new Pool({
    connectionString: process.env.DATALAKE_URL,
    ssl: { rejectUnauthorized: false }
  });
}

// GET /api/fleet/history
// Query Params:
// - imei (required)
// - start_date (required, e.g. 2026-06-19 or 2026-06-19T00:00:00)
// - end_date (optional, defaults to end of start_date)
// - secret (optional)
router.get('/history', async (req, res) => {
  if (!pool) return res.status(500).json({ error: 'Data Lake no configurado.' });
  
  const { imei, start_date, end_date } = req.query;
  
  if (!imei) return res.status(400).json({ error: 'Falta el parámetro imei.' });
  if (!start_date) return res.status(400).json({ error: 'Falta el parámetro start_date.' });

  try {
    let query = `
      SELECT lat, lng, speed, dt_tracker, event, plate, course
      FROM global_telemetry_traffic 
      WHERE imei = $1 
    `;
    const params = [imei];
    
    // Parse start date
    query += ` AND dt_tracker >= $2::timestamp`;
    params.push(start_date);
    
    // Parse end date (if not provided, assume end of the start_date day)
    let finalEndDate = end_date;
    if (!finalEndDate) {
      if (start_date.includes('T')) {
        // Just add 24 hours if they sent an ISO but no end date
        finalEndDate = start_date; // Not ideal, but let's assume they want the rest of the day
      } else {
        // YYYY-MM-DD format
        finalEndDate = `${start_date}T23:59:59`;
      }
    }
    
    if (finalEndDate) {
      query += ` AND dt_tracker <= $3::timestamp`;
      params.push(finalEndDate);
    }
    
    query += ` ORDER BY dt_tracker ASC LIMIT 5000`; // Limit to prevent massive payloads crashing the browser

    const result = await pool.query(query, params);
    
    res.json({
      success: true,
      count: result.rows.length,
      data: result.rows
    });
    
  } catch (err) {
    console.error('Error fetching fleet history:', err);
    res.status(500).json({ error: 'Error interno obteniendo el historial.' });
  }
});

module.exports = router;
