const { Client } = require('pg');

const client = new Client({
  connectionString: 'postgresql://postgres.qqxznexekadsuyivdgke:66fc7V%21zwA%24N.%2B-@aws-1-us-west-2.pooler.supabase.com:5432/postgres',
  ssl: { rejectUnauthorized: false }
});

async function queryDB() {
  await client.connect();
  const res = await client.query('SELECT client_source, count(DISTINCT imei) as vehicles FROM global_telemetry_traffic WHERE client_source IS NOT NULL GROUP BY client_source');
  console.log('Vehicles per client in Data Lake:', res.rows);
  
  await client.end();
}

queryDB();
