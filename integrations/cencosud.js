const BaseStrategy = require('./BaseStrategy');

class CencosudStrategy extends BaseStrategy {
  /**
   * Executes the Cencosud integration.
   * 
   * @param {Object} telemetry - Raw telemetry from GPS Server.
   * @param {Object} deviceConfig - Vehicle metadata.
   * @param {Object} integrationConfig - Cencosud specific overrides.
   */
  async execute(telemetry, deviceConfig, integrationConfig) {
    try {
      const url = integrationConfig.endpoint || process.env.CENCOSUD_API_URL || 'https://api.cencosud.com/logistics/v1/telemetry';
    const apiKey = integrationConfig.api_key || process.env.CENCOSUD_API_KEY;

    if (!apiKey) {
      console.error('[Cencosud] Error: API key is not configured.');
      return;
    }

    const paramsObj = this.parseParams(telemetry.params);
    const isEngineOn = paramsObj.acc === '1' || paramsObj.acc === 1 || telemetry.event === 'ignition_on';

    const payload = {
      patente: deviceConfig.plate,
      fecha_hora: this.formatDate(telemetry.dt_tracker || telemetry.dt_server, 'ISO_T'),
      latitud: parseFloat(telemetry.lat),
      longitud: parseFloat(telemetry.lng),
      velocidad: Math.round(parseFloat(telemetry.speed || 0)),
      sentido: Math.round(parseFloat(telemetry.angle || 0)),
      ignicion: isEngineOn ? 1 : 0,
      proveedor: deviceConfig.carrier || 'VIKARGPS',
      imei: telemetry.imei
    };

    console.log(`[Cencosud] Dispatching telemetry for ${deviceConfig.plate} to ${url}...`);
    const result = await this.sendJSONRequest(url, { 'X-API-Key': apiKey }, payload);

    if (result.success) {
      console.log(`[Cencosud] Success Response:`, result.data);
    } else {
      console.error(`[Cencosud] Forwarding failed:`, result.error);
    }
    } catch (error) {
      console.error('[Cencosud] Integration error:', error.message);
    }
  }
}

module.exports = CencosudStrategy;
