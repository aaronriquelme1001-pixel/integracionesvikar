const BaseStrategy = require('./BaseStrategy');

class AgrosuperStrategy extends BaseStrategy {
  /**
   * Executes the Agrosuper integration.
   * 
   * @param {Object} telemetry - Raw telemetry from GPS Server.
   * @param {Object} deviceConfig - Vehicle metadata.
   * @param {Object} integrationConfig - Agrosuper specific overrides.
   */
  async execute(telemetry, deviceConfig, integrationConfig) {
    const url = integrationConfig.endpoint || process.env.AGROSUPER_API_URL || 'https://api.agrosuper.cl/logistica/telemetria/gps';
    const apiKey = integrationConfig.api_key || process.env.AGROSUPER_API_KEY;

    if (!apiKey) {
      console.error('[Agrosuper] Error: API key is not configured.');
      return;
    }

    const paramsObj = this.parseParams(telemetry.params);
    const isEngineOn = paramsObj.acc === '1' || paramsObj.acc === 1 || telemetry.event === 'ignition_on';

    const payload = {
      patente: deviceConfig.plate,
      gps_id: telemetry.imei,
      latitud: parseFloat(telemetry.lat),
      longitud: parseFloat(telemetry.lng),
      velocidad: Math.round(parseFloat(telemetry.speed || 0)),
      rumbo: Math.round(parseFloat(telemetry.angle || 0)),
      ignicion: isEngineOn ? true : false,
      fecha_actividad: this.formatDate(telemetry.dt_tracker || telemetry.dt_server, 'ISO_T'),
      temperatura: paramsObj.temp1 ? parseFloat(paramsObj.temp1) : null // Track temperature for cold chain
    };

    console.log(`[Agrosuper] Dispatching telemetry for ${deviceConfig.plate} to ${url}...`);
    const result = await this.sendJSONRequest(url, { 'x-api-key': apiKey }, payload);

    if (result.success) {
      console.log(`[Agrosuper] Success Response:`, result.data);
    } else {
      console.error(`[Agrosuper] Forwarding failed:`, result.error);
    }
  }
}

module.exports = AgrosuperStrategy;
