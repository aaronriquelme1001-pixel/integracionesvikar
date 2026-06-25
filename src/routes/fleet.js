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
      SELECT lat, lng, speed, dt_tracker, plate, altitude, angle, params, loc_valid
      FROM global_telemetry_traffic 
      WHERE imei = $1 
    `;
    const params = [imei];
    
    // Helper to normalize dates
    const normalizeDate = (d) => {
      if (!d) return null;
      // If it's DD-MM-YYYY, convert to YYYY-MM-DD
      const parts = d.split('-');
      if (parts.length === 3 && parts[0].length === 2 && parts[2].length === 4) {
        return `${parts[2]}-${parts[1]}-${parts[0]}`;
      }
      return d;
    };

    const normStart = normalizeDate(start_date);
    const normEnd = normalizeDate(end_date);
    
    // Parse start date
    query += ` AND dt_tracker >= $2::timestamp`;
    params.push(normStart);
    
    // Parse end date
    let finalEndDate = normEnd;
    if (!finalEndDate) {
      if (normStart.includes('T')) {
        finalEndDate = normStart; 
      } else {
        finalEndDate = `${normStart}T23:59:59`;
      }
    }
    
    if (finalEndDate) {
      // If finalEndDate is just a date like YYYY-MM-DD and doesn't have time, make sure it covers the day
      if (finalEndDate.length === 10) {
        finalEndDate = `${finalEndDate}T23:59:59`;
      }
      query += ` AND dt_tracker <= $3::timestamp`;
      params.push(finalEndDate);
    }
    
    query += ` ORDER BY dt_tracker ASC LIMIT 10000`; // Limit set to 10000 to prevent OOM 500 errors on large datasets

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
