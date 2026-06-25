const { Pool } = require('pg');
const pool = new Pool({
  connectionString: 'postgresql://postgres.qqxznexekadsuyivdgke:66fc7V%21zwA%24N.%2B-@aws-1-us-west-2.pooler.supabase.com:5432/postgres',
  ssl: { rejectUnauthorized: false }
});

async function run() {
  const imei = '865413054401046';

  // Puntos últimas 4 horas
  const res = await pool.query(
    "SELECT dt_tracker, lat, lng, speed FROM global_telemetry_traffic WHERE imei = $1 AND created_at > NOW() - INTERVAL '4 HOURS' ORDER BY dt_tracker ASC",
    [imei]
  );
  console.log('Total puntos últimas 4h:', res.rows.length);

  if (res.rows.length === 0) {
    // Ver cuándo fue el último punto de este vehículo
    const last = await pool.query(
      "SELECT dt_tracker, lat, lng, created_at FROM global_telemetry_traffic WHERE imei = $1 ORDER BY dt_tracker DESC LIMIT 1",
      [imei]
    );
    console.log('Último punto registrado EVER:', last.rows[0]);
  } else {
    console.log('Primero:', res.rows[0]);
    console.log('Último:', res.rows[res.rows.length - 1]);

    // Detectar brechas > 10 minutos
    const brechas = [];
    for (let i = 1; i < res.rows.length; i++) {
      const diff = (new Date(res.rows[i].dt_tracker) - new Date(res.rows[i - 1].dt_tracker)) / 1000;
      if (diff > 600) {
        brechas.push({
          desde: res.rows[i - 1].dt_tracker,
          hasta: res.rows[i].dt_tracker,
          gap_min: Math.round(diff / 60)
        });
      }
    }
    console.log('\nBrechas > 10 min en Supabase:', brechas.length);
    brechas.forEach(b => console.log(' -', JSON.stringify(b)));
  }

  pool.end();
}

run().catch(console.error);
