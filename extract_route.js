const { Client } = require('pg');
const fs = require('fs');

const client = new Client({
  connectionString: 'postgresql://postgres.qqxznexekadsuyivdgke:66fc7V%21zwA%24N.%2B-@aws-1-us-west-2.pooler.supabase.com:5432/postgres',
  ssl: { rejectUnauthorized: false }
});

async function extractRoute() {
  await client.connect();
  const imei = '865413054385702';
  
  // Find oldest date
  const oldestRes = await client.query(`
    SELECT DATE(MIN(dt_tracker)) as oldest_date 
    FROM global_telemetry_traffic 
    WHERE imei = $1
  `, [imei]);
  
  const oldestDate = oldestRes.rows[0].oldest_date;
  if (!oldestDate) {
    console.log('No data found for this IMEI');
    await client.end();
    return;
  }
  
  console.log('Oldest date found:', oldestDate);
  
  // Get all data for that day
  const query = `
    SELECT dt_tracker, lat, lng, speed, event
    FROM global_telemetry_traffic
    WHERE imei = $1 AND DATE(dt_tracker) = $2
    ORDER BY dt_tracker ASC
  `;
  const dataRes = await client.query(query, [imei, oldestDate]);
  
  console.log(`Found ${dataRes.rows.length} points for ${oldestDate}`);
  
  // Format as CSV
  let csv = 'timestamp,latitude,longitude,speed_kmh,event\n';
  for (const row of dataRes.rows) {
    const timestamp = new Date(row.dt_tracker).toISOString();
    csv += `${timestamp},${row.lat},${row.lng},${row.speed},${row.event || ''}\n`;
  }
  
  const filename = `Ruta_JYJS98_${oldestDate.toISOString().split('T')[0]}.csv`;
  fs.writeFileSync(filename, csv);
  console.log('Saved to', filename);
  
  await client.end();
}

extractRoute().catch(console.error);
