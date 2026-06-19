const { Client } = require('pg');

const client = new Client({
  connectionString: 'postgresql://postgres.qqxznexekadsuyivdgke:66fc7V%21zwA%24N.%2B-@aws-1-us-west-2.pooler.supabase.com:5432/postgres',
  ssl: { rejectUnauthorized: false }
});

async function run() {
  await client.connect();
  
  const q1 = await client.query('SELECT count(*) as total_pings, count(DISTINCT imei) as unique_trucks, max(speed) as max_speed, min(created_at) as first_ping FROM global_telemetry_traffic;');
  
  const q2 = await client.query(`
    SELECT client_source, count(*) as total_pings, count(DISTINCT imei) as active_trucks 
    FROM global_telemetry_traffic 
    GROUP BY client_source 
    ORDER BY total_pings DESC;
  `);
  
  const q3 = await client.query(`
    SELECT 
      case when speed > 5 then 'EN RUTA' else 'DETENIDO/ESTACIONADO' end as state, 
      count(*) as traffic_volume 
    FROM global_telemetry_traffic 
    GROUP BY state;
  `);

  const q4 = await client.query(`
    SELECT plate, client_source, max(speed) as max_speed_reached 
    FROM global_telemetry_traffic 
    GROUP BY plate, client_source 
    ORDER BY max_speed_reached DESC 
    LIMIT 3;
  `);

  console.log('=== RADIOGRAFÍA DEL DATA LAKE ===\n');
  console.log('1. VOLUMEN GLOBAL:');
  console.table(q1.rows);
  
  console.log('\n2. DESGLOSE POR CLIENTE:');
  console.table(q2.rows);
  
  console.log('\n3. ESTADO DE LA FLOTA (Tráfico):');
  console.table(q3.rows);

  console.log('\n4. TOP 3 CAMIONES MÁS RÁPIDOS:');
  console.table(q4.rows);

  await client.end();
}

run().catch(console.error);
