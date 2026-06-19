const { Client } = require('pg');

const client = new Client({
  connectionString: 'postgresql://postgres.qqxznexekadsuyivdgke:66fc7V%21zwA%24N.%2B-@aws-1-us-west-2.pooler.supabase.com:5432/postgres',
  ssl: { rejectUnauthorized: false }
});

async function run() {
  await client.connect();
  const res = await client.query("SELECT lat, lng, speed, dt_tracker FROM global_telemetry_traffic WHERE plate = 'VPXW60' ORDER BY dt_tracker DESC LIMIT 10;");
  console.log(JSON.stringify(res.rows, null, 2));
  await client.end();
}

run().catch(console.error);
