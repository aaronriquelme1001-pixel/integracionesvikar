const { Pool } = require('pg');

let pool = null;
let initialized = false;

class DatalakeStrategy {
  constructor() {
    this.initPool();
  }

  async initPool() {
    if (!process.env.DATALAKE_URL) {
      console.warn('[Data Lake] ⚠️ DATALAKE_URL no definido. El registro global de tráfico está inactivo.');
      return;
    }

    try {
      pool = new Pool({
        connectionString: process.env.DATALAKE_URL,
        ssl: { rejectUnauthorized: false } // Required for Render/Supabase
      });

      // Create table if not exists
      const createTableQuery = `
        CREATE TABLE IF NOT EXISTS global_telemetry_traffic (
          id SERIAL PRIMARY KEY,
          imei VARCHAR(50) NOT NULL,
          plate VARCHAR(50),
          lat NUMERIC,
          lng NUMERIC,
          speed NUMERIC,
          dt_tracker TIMESTAMP,
          client_source VARCHAR(100),
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
      `;
      await pool.query(createTableQuery);
      
      // Create index for fast querying
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_telemetry_imei ON global_telemetry_traffic(imei);`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_telemetry_dt ON global_telemetry_traffic(dt_tracker);`);

      console.log('[Data Lake] ✅ Conectado a la base de datos central. Tabla global_telemetry_traffic lista.');
      initialized = true;
    } catch (err) {
      console.error('[Data Lake] ❌ Error inicializando la conexión a PostgreSQL:', err.message);
    }
  }

  async execute(telemetry, deviceConfig, resolvedConfig) {
    if (!initialized || !pool) return;

    try {
      const query = `
        INSERT INTO global_telemetry_traffic (imei, plate, lat, lng, speed, dt_tracker, client_source)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
      `;
      
      const values = [
        telemetry.imei,
        deviceConfig.plate || telemetry.plate_number || 'UNKNOWN',
        telemetry.lat,
        telemetry.lng,
        telemetry.speed || 0,
        telemetry.dt_tracker,
        resolvedConfig.client || 'unknown'
      ];

      // Await to ensure we don't flood the pg pool queue
      await pool.query(query, values);
    } catch (error) {
      console.error('[Data Lake] ❌ Error insertando punto en datalake:', error.message);
    }
  }
}

module.exports = DatalakeStrategy;
