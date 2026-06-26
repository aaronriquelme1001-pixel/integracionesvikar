const { BigQuery } = require('@google-cloud/bigquery');
const fs = require('fs');

let bigquery = null;
let datasetId = 'telemetry';
let tableId = 'global_traffic';
let buffer = [];

class DatalakeStrategy {
  constructor() {
    this.initBQ();
    // Flush to BigQuery every 5 seconds to minimize API calls
    setInterval(() => this.flush(), 5000);
  }

  initBQ() {
    try {
      if (process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON) {
         const credentials = JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON);
         bigquery = new BigQuery({ projectId: credentials.project_id, credentials });
      } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
         bigquery = new BigQuery(); 
      } else if (fs.existsSync('./bq-key.json')) {
         bigquery = new BigQuery({ projectId: 'vikargpsdatos', keyFilename: './bq-key.json' });
      } else {
         console.warn('[Data Lake] ⚠️ Faltan credenciales de BigQuery. Data Lake Inactivo.');
         return;
      }
      console.log('[Data Lake] ✅ Conectado a Google BigQuery (Almacenamiento Infinito).');
    } catch(err) {
      console.error('[Data Lake] ❌ Error inicializando BigQuery:', err);
    }
  }

  async execute(telemetry, deviceConfig, resolvedConfig) {
    if (!bigquery) return { success: false, reason: 'BigQuery no configurado' };

    const {
      imei,
      plate = 'SIN_PATENTE',
      lat,
      lng,
      speed,
      altitude = 0,
      angle = 0,
      dt_tracker,
      client_source,
      client,
      loc_valid = true,
      params = null
    } = telemetry;

    let parsedDate = new Date();
    if (dt_tracker) {
      const dt = new Date(dt_tracker);
      if (!isNaN(dt.getTime())) {
        parsedDate = dt;
      }
    }

    const resolvedClient = String(client_source || client || 'B2B');

    const row = {
      imei: String(imei),
      plate: String(plate),
      lat: parseFloat(lat),
      lng: parseFloat(lng),
      speed: parseFloat(speed),
      altitude: parseFloat(altitude),
      angle: parseFloat(angle),
      loc_valid: Boolean(loc_valid),
      dt_tracker: parsedDate.toISOString(),
      client_source: resolvedClient,
      created_at: new Date().toISOString(),
      params: params ? JSON.stringify(params) : null
    };

    buffer.push(row);

    // Force flush if buffer gets too large
    if (buffer.length >= 500) {
      this.flush();
    }

    return { success: true, message: 'Agregado al buffer de BigQuery' };
  }
  
  async flush() {
    if (buffer.length === 0 || !bigquery) return;
    
    const rowsToInsert = [...buffer];
    buffer = [];
    
    try {
       await bigquery.dataset(datasetId).table(tableId).insert(rowsToInsert);
    } catch (error) {
       console.error(`[Data Lake] ❌ Error insertando en BigQuery:`, error.message);
       if (error.name === 'PartialFailureError') {
         // Errores de validación de BQ (ej: string muy largo). No reintentar o bloquearían la cola.
         error.errors.forEach(err => console.error(JSON.stringify(err)));
       } else {
         // Error de red o Google caído. ¡Usar el paracaídas!
         console.warn(`[Data Lake] ⚠️ Activando paracaídas. Reencolando ${rowsToInsert.length} puntos...`);
         buffer = [...rowsToInsert, ...buffer];
         
         // Si la caída dura muchas horas, evitar que se acabe la RAM del servidor
         if (buffer.length > 250000) {
             console.error(`[Data Lake] 💥 Paracaídas de memoria lleno. Guardando a disco de emergencia...`);
             if (!fs.existsSync('./data')) fs.mkdirSync('./data');
             fs.appendFileSync('./data/bq_fallback.jsonl', JSON.stringify(buffer) + '\\n');
             buffer = [];
         }
       }
    }
  }
}

module.exports = DatalakeStrategy;
