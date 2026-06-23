require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATA_LAKE_URL });

async function alterTable() {
  try {
    await pool.query(`
      ALTER TABLE billing_snapshots 
      ADD COLUMN IF NOT EXISTS extreme_speeding_count INTEGER DEFAULT 0,
      ADD COLUMN IF NOT EXISTS moderate_speeding_count INTEGER DEFAULT 0,
      ADD COLUMN IF NOT EXISTS harsh_maneuvers_count INTEGER DEFAULT 0,
      ADD COLUMN IF NOT EXISTS fatigue_alerts_count INTEGER DEFAULT 0;
    `);
    console.log('Columns added successfully');
  } catch (err) {
    console.error('Error altering table', err);
  } finally {
    pool.end();
  }
}
alterTable();
