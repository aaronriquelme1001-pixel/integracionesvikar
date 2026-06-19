const { Client } = require('pg');

const client = new Client({
  connectionString: 'postgresql://postgres.qqxznexekadsuyivdgke:66fc7V%21zwA%24N.%2B-@aws-1-us-west-2.pooler.supabase.com:5432/postgres',
  ssl: { rejectUnauthorized: false }
});

async function setup() {
  try {
    await client.connect();
    
    // Add event column to telemetry table
    const alterQuery = `
      ALTER TABLE global_telemetry_traffic 
      ADD COLUMN IF NOT EXISTS event VARCHAR(50);
    `;
    await client.query(alterQuery);
    console.log('Column event added to global_telemetry_traffic.');
    
  } catch (e) {
    console.error('Error:', e);
  } finally {
    await client.end();
  }
}

setup();
