require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATALAKE_URL,
  ssl: { rejectUnauthorized: false }
});

async function run() {
  try {
    const res = await pool.query(`
      SELECT client_id, count(*) as c 
      FROM billing_snapshots 
      GROUP BY client_id;
    `);
    console.log("=== CLIENTS IN BILLING_SNAPSHOTS ===");
    console.table(res.rows);
    
    const transklettCount = await pool.query(`
      SELECT COUNT(*) FROM billing_snapshots WHERE client_id = 'transklett';
    `);
    console.log("Transklett rows:", transklettCount.rows[0].count);
    
  } catch (err) {
    console.error(err);
  } finally {
    await pool.end();
  }
}
run();
