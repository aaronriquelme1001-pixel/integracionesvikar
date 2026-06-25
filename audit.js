require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({
  connectionString: process.env.DATALAKE_URL,
  ssl: { rejectUnauthorized: false }
});

async function run() {
  const r = await pool.query(`
    SELECT plate, COUNT(*) as c 
    FROM global_telemetry_traffic 
    WHERE dt_tracker > NOW() - INTERVAL '2 hours' 
    GROUP BY plate 
    ORDER BY c DESC
  `);
  console.log('Recent Telemetry Counts:');
  console.table(r.rows);

  const outOfOrder = await pool.query(`
    WITH numbered AS (
        SELECT id, plate, dt_tracker, 
               LAG(dt_tracker) OVER (PARTITION BY plate ORDER BY id ASC) as prev_dt
        FROM global_telemetry_traffic
        WHERE dt_tracker > NOW() - INTERVAL '6 hours'
    )
    SELECT plate, dt_tracker, prev_dt 
    FROM numbered 
    WHERE dt_tracker < prev_dt 
    LIMIT 20;
  `);
  
  console.log('\nOut of Order Points (indicates successful backfill):');
  console.table(outOfOrder.rows);
  
  pool.end();
}

run().catch(console.error);
