const axios = require('axios');
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

// Setup DB Pool
let pool = null;
if (process.env.DATALAKE_URL) {
  pool = new Pool({
    connectionString: process.env.DATALAKE_URL,
    ssl: { rejectUnauthorized: false }
  });
}

// Get the static mapping of devices to find their client_source
function getDeviceMappings() {
  const configPath = path.join(__dirname, '../../config/devices.json');
  if (fs.existsSync(configPath)) {
    const data = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    return data.devices || {};
  }
  return {};
}

async function calculateDailyGrade(imei, snapshotDateStr) {
  if (!pool) return 7.0;
  
  try {
    // Buscar los puntos de velocidad de este vehículo en el día actual
    const query = `
      SELECT speed 
      FROM global_telemetry_traffic 
      WHERE imei = $1 AND DATE(dt_tracker) = $2
    `;
    const result = await pool.query(query, [imei, snapshotDateStr]);
    
    let penalty = 0.0;
    for (const row of result.rows) {
      const speed = parseFloat(row.speed) || 0;
      if (speed > 110) {
        penalty += 0.2;
      } else if (speed > 90) {
        penalty += 0.05;
      }
    }
    
    let finalGrade = 7.0 - penalty;
    if (finalGrade < 1.0) finalGrade = 1.0;
    
    // Redondear a 1 decimal
    return Math.round(finalGrade * 10) / 10;
  } catch (err) {
    console.error(`[Billing Cron] Error calculating grade for ${imei}:`, err.message);
    return 7.0;
  }
}

async function runBillingSnapshot() {
  if (!pool) {
    console.error('[Billing Cron] No DATALAKE_URL provided.');
    return;
  }
  
  const masterKey = process.env.GPS_SERVER_MASTER_KEY;
  const gpsUrl = process.env.GPS_SERVER_URL ? process.env.GPS_SERVER_URL.replace('api_loc.php', 'api.php') : 'http://gsh7.net/id39/api/api.php';
  
  if (!masterKey) {
    console.error('[Billing Cron] Missing GPS_SERVER_MASTER_KEY in environment.');
    return;
  }

  console.log('[Billing Cron] Starting daily snapshot of odometers and driver grading...');
  const deviceMappings = getDeviceMappings();
  const snapshotDate = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
  
  try {
    // We use the Server API to get all locations at once
    const response = await axios.get(`${gpsUrl}?api=server&key=${masterKey}&cmd=OBJECT_GET_LOCATIONS`);
    const objects = response.data;
    
    if (!objects || typeof objects !== 'object') {
      console.error('[Billing Cron] Invalid response from GPS Server:', objects);
      return;
    }

    let insertedCount = 0;
    
    for (const imei in objects) {
      const data = objects[imei];
      const odometer = data.odometer || 0;
      const engineHours = data.engine_hours || 0;
      
      // Look up the client_id from our config/devices.json
      const config = deviceMappings[imei];
      const clientId = config ? config.client_source : 'unknown';
      
      if (clientId === 'unknown') continue; // We only care about mapped clients

      // Calculate driving score for today
      const dailyGrade = await calculateDailyGrade(imei, snapshotDate);

      // Insert or Update the snapshot for today
      const query = `
        INSERT INTO billing_snapshots (client_id, imei, snapshot_date, odometer, engine_hours, daily_grade)
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (imei, snapshot_date) DO UPDATE SET 
          odometer = EXCLUDED.odometer, 
          engine_hours = EXCLUDED.engine_hours,
          daily_grade = EXCLUDED.daily_grade;
      `;
      
      await pool.query(query, [clientId, imei, snapshotDate, odometer, engineHours, dailyGrade]);
      insertedCount++;
    }
    
    console.log(`[Billing Cron] Successfully took snapshot and graded ${insertedCount} devices on ${snapshotDate}.`);
    
  } catch (error) {
    console.error('[Billing Cron] Error executing snapshot:', error.message);
  } finally {
    // Let pool open since it might be used by index.js in production, but in cron script standalone we should close it.
    // The pool is a global singleton, so we'll leave it as is.
  }
}

// If run directly
if (require.main === module) {
  require('dotenv').config();
  runBillingSnapshot().then(() => pool && pool.end());
}

module.exports = { runBillingSnapshot };
