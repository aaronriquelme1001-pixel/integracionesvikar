require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({connectionString: process.env.DATALAKE_URL, ssl:{rejectUnauthorized:false}});
pool.query("SELECT dt_tracker, speed, lat, lng FROM global_telemetry_traffic WHERE imei='865413054330609' AND dt_tracker >= '2026-06-25 18:00:00' AND dt_tracker <= '2026-06-25 19:30:00' ORDER BY dt_tracker ASC").then(res => {
  console.log(res.rows);
  pool.end();
}).catch(e => {
  console.log(e);
  pool.end();
});
