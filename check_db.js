const { Client } = require('pg');

const client = new Client({
  connectionString: 'postgresql://postgres.qqxznexekadsuyivdgke:66fc7V%21zwA%24N.%2B-@aws-1-us-west-2.pooler.supabase.com:5432/postgres',
  ssl: { rejectUnauthorized: false }
});

async function setup() {
  try {
    await client.connect();
    
    // Add daily_grade column
    const alterQuery = `
      ALTER TABLE billing_snapshots 
      ADD COLUMN IF NOT EXISTS daily_grade NUMERIC NOT NULL DEFAULT 7.0;
    `;
    await client.query(alterQuery);
    console.log('Column daily_grade added.');
    
  } catch (e) {
    console.error('Error:', e);
  } finally {
    await client.end();
  }
}

setup();
