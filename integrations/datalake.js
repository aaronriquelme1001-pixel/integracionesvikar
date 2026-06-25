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
      
      // Ensure missing sensor and I/O columns exist
      await pool.query(`ALTER TABLE global_telemetry_traffic ADD COLUMN IF NOT EXISTS altitude NUMERIC DEFAULT 0;`);
      await pool.query(`ALTER TABLE global_telemetry_traffic ADD COLUMN IF NOT EXISTS angle NUMERIC DEFAULT 0;`);
      await pool.query(`ALTER TABLE global_telemetry_traffic ADD COLUMN IF NOT EXISTS params TEXT;`);
      await pool.query(`ALTER TABLE global_telemetry_traffic ADD COLUMN IF NOT EXISTS loc_valid BOOLEAN DEFAULT true;`);

      // Create index for fast querying
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_telemetry_imei ON global_telemetry_traffic(imei);`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_telemetry_dt ON global_telemetry_traffic(dt_tracker);`);

      console.log('[Data Lake] ✅ Conectado a la base de datos central. Tabla global_telemetry_traffic lista y migrada con I/O.');
      initialized = true;
    } catch (err) {
      console.error('[Data Lake] ❌ Error inicializando la conexión a PostgreSQL:', err.message);
    }
  }

  async execute(telemetry, deviceConfig, resolvedConfig) {
    if (!initialized || !pool) return;

    try {
      // Validate dt_tracker before inserting — reject clearly invalid dates like "0000-00-00 00:00:00"
      const dtRaw = telemetry.dt_tracker;
      if (!dtRaw || String(dtRaw).startsWith('0000') || String(dtRaw).trim() === '') {
        console.warn(`[Data Lake] ⚠️ Fecha inválida ignorada para IMEI ${telemetry.imei} (${deviceConfig.plate || 'SIN PLACA'}): "${dtRaw}"`);
        return;
      }

      const query = `
        INSERT INTO global_telemetry_traffic (imei, plate, lat, lng, speed, dt_tracker, client_source, altitude, angle, params, loc_valid)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      `;
      
      const values = [
        telemetry.imei,
        deviceConfig.plate || telemetry.plate_number || 'UNKNOWN',
        telemetry.lat,
        telemetry.lng,
        telemetry.speed || 0,
        telemetry.dt_tracker,
        resolvedConfig.client || 'unknown',
        telemetry.altitude || 0,
        telemetry.angle || 0,
        typeof telemetry.params === 'object' ? JSON.stringify(telemetry.params) : (telemetry.params || ''),
        telemetry.loc_valid !== undefined ? Boolean(telemetry.loc_valid) : true
      ];

      // Await to ensure we don't flood the pg pool queue
      await pool.query(query, values);
    } catch (error) {
      console.error(`[Data Lake] ❌ Error insertando punto para IMEI ${telemetry.imei} (${deviceConfig.plate || telemetry.plate_number || 'SIN PLACA'}): ${error.message}`);
    }
  }

}

module.exports = DatalakeStrategy;
