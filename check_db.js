const { Client } = require('pg');

const client = new Client({
  connectionString: 'postgresql://postgres.qqxznexekadsuyivdgke:66fc7V%21zwA%24N.%2B-@aws-1-us-west-2.pooler.supabase.com:5432/postgres',
  ssl: { rejectUnauthorized: false }
});

async function setup() {
  try {
    await client.connect();
    
    // Create the billing snapshots table
    const createTableQuery = `
      CREATE TABLE IF NOT EXISTS billing_snapshots (
        id SERIAL PRIMARY KEY,
        client_id VARCHAR(100) NOT NULL,
        imei VARCHAR(50) NOT NULL,
        snapshot_date DATE NOT NULL,
        odometer NUMERIC NOT NULL DEFAULT 0,
        engine_hours NUMERIC NOT NULL DEFAULT 0,
        max_speed NUMERIC NOT NULL DEFAULT 0,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(imei, snapshot_date)
      );
    `;
    await client.query(createTableQuery);
    console.log('Table billing_snapshots created or already exists.');
    
    // Create index for fast queries
    await client.query(`CREATE INDEX IF NOT EXISTS idx_billing_client_date ON billing_snapshots(client_id, snapshot_date);`);
    console.log('Index created.');
    
  } catch (e) {
    console.error('Error:', e);
  } finally {
    await client.end();
  }
}

setup();
