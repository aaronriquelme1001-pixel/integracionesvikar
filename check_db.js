require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATALAKE_URL });
pool.query("SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'global_telemetry_traffic' AND column_name = 'dt_tracker'")
  .then(res => { console.log(res.rows); pool.end(); })
  .catch(err => { console.error(err); pool.end(); });
