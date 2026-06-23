const { Client } = require('pg');

const client = new Client({
  connectionString: 'postgresql://postgres.qqxznexekadsuyivdgke:66fc7V%21zwA%24N.%2B-@aws-1-us-west-2.pooler.supabase.com:5432/postgres',
  ssl: { rejectUnauthorized: false }
});

async function checkHistory() {
  await client.connect();
  const res = await client.query(`
    SELECT 
      COUNT(*) as total_points,
      MIN(dt_tracker) as oldest_record,
      MAX(dt_tracker) as newest_record,
      COUNT(DISTINCT imei) as unique_vehicles
    FROM global_telemetry_traffic
  `);
  console.log(res.rows[0]);
  await client.end();
}

checkHistory().catch(console.error);
