const { Client } = require('pg');

const client = new Client({
  connectionString: 'postgresql://postgres.qqxznexekadsuyivdgke:66fc7V%21zwA%24N.%2B-@aws-1-us-west-2.pooler.supabase.com:5432/postgres',
  ssl: { rejectUnauthorized: false }
});

async function queryDB() {
  await client.connect();
  const res = await client.query('SELECT DISTINCT client_source FROM global_telemetry_traffic');
  console.log('Distinct client_sources in telemetry:', res.rows);
  
  const res2 = await client.query('SELECT * FROM billing_snapshots');
  console.log('Billing snapshots count:', res2.rows.length);
  if (res2.rows.length > 0) console.log('Sample snapshot:', res2.rows[0]);
  
  await client.end();
}

queryDB();
