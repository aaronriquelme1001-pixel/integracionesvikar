const BaseStrategy = require('./BaseStrategy');
const axios = require('axios');

class GpsServerStrategy extends BaseStrategy {
  constructor() {
    super('gpsserver');
  }

  async execute(telemetry, deviceConfig, resolvedConfig) {
    // 1. Validar telemetría
    this.validateTelemetry(telemetry);

    // 2. Extraer o derivar el endpoint y el imei
    // Puede usar resolvedConfig.endpoint si está en devices.js, o process.env genérico
    const endpointUrl = resolvedConfig.endpoint || process.env.GPS_SERVER_URL || 'http://gsh7.net/id39/api/api_loc.php';
    const imei = telemetry.imei;

    // 3. Formatear la fecha a YYYY-MM-DD HH:MM:SS
    let dateStr = '';
    if (telemetry.dt_tracker) {
      const d = new Date(telemetry.dt_tracker);
      dateStr = d.getUTCFullYear() + '-' + 
                String(d.getUTCMonth()+1).padStart(2,'0') + '-' + 
                String(d.getUTCDate()).padStart(2,'0') + ' ' + 
                String(d.getUTCHours()).padStart(2,'0') + ':' + 
                String(d.getUTCMinutes()).padStart(2,'0') + ':' + 
                String(d.getUTCSeconds()).padStart(2,'0');
    }

    // 4. Preparar payload GET (Location API format)
    // api_loc.php?imei=123&dt=2016-01-01 00:00:00&lat=54&lng=25&altitude=100&angle=45&speed=60&loc_valid=1&params=batp=100|acc=1|
    
    // Preparar parámetros extra (opcional)
    let paramsStr = telemetry.params || '';
    if (paramsStr && !paramsStr.endsWith('|')) {
       paramsStr += '|';
    }

    const queryParams = new URLSearchParams({
      imei: imei,
      dt: dateStr,
      lat: telemetry.lat,
      lng: telemetry.lng,
      altitude: telemetry.altitude || 0,
      angle: telemetry.angle || 0,
      speed: telemetry.speed || 0,
      loc_valid: telemetry.loc_valid || 1,
      params: paramsStr
    });

    const url = `${endpointUrl}?${queryParams.toString()}`;

    // 5. Enviar a GPS Server
    try {
      const response = await axios.get(url, { timeout: 10000 });
      if (response.status === 200) {
        // En caso de éxito, opcionalmente validar respuesta (GPS Server suele devolver OK vacío)
        console.log(`[B2B-GpsServer] ✅ Reenviado a GPS Server -> IMEI: ${imei}`);
      } else {
         throw new Error(`Código HTTP Inesperado: ${response.status} - ${response.statusText}`);
      }
    } catch (error) {
       console.error(`[B2B-GpsServer] ❌ Error inyectando a GPS Server para IMEI: ${imei}`, error.message);
       throw error;
    }
  }
}

module.exports = GpsServerStrategy;
