const axios = require('axios');
const BaseStrategy = require('./BaseStrategy');

class FlespiStrategy extends BaseStrategy {
  async execute(telemetry, deviceConfig, integrationConfig) {
    // Flespi URL defaults to the user-provided HTTP channel if not in .env
    const flespiUrl = process.env.FLESPI_URL || 'http://ch1398973.flespi.gw:25693';
    
    // Flespi OsmAnd channel expects a UNIX timestamp
    const timestampUnix = Math.floor(new Date(telemetry.dt_tracker).getTime() / 1000);
    
    // Constructing standard OsmAnd payload format
    const params = {
      id: telemetry.imei,
      lat: telemetry.lat,
      lon: telemetry.lng,
      timestamp: timestampUnix,
      speed: telemetry.speed || 0,
      bearing: telemetry.angle || 0,
      altitude: telemetry.altitude || 0,
      valid: telemetry.loc_valid == '1' ? 'true' : 'false'
    };

    try {
      // Usar timeout corto para que no bloquee el hilo en caso de lentitud
      const response = await axios.get(flespiUrl, { params, timeout: 5000 });
      console.log(`[Flespi] Success Response for ${telemetry.imei}: Status ${response.status}`);
    } catch (error) {
      console.error(`[Flespi] Forwarding failed for ${telemetry.imei}:`, error.message);
      throw error;
    }
  }
}

module.exports = FlespiStrategy;
