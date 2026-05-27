const BaseStrategy = require('./BaseStrategy');

class MercadoLibreStrategy extends BaseStrategy {
  /**
   * Executes the Mercado Libre Carrier/GPS integration.
   * 
   * @param {Object} telemetry - Raw telemetry from GPS Server.
   * @param {Object} deviceConfig - Vehicle metadata.
   * @param {Object} integrationConfig - Mercado Libre specific overrides.
   */
  async execute(telemetry, deviceConfig, integrationConfig) {
    const url = integrationConfig.endpoint || process.env.MERCADOLIBRE_API_URL || 'https://api.mercadolibre.com/logistics/carriers/telemetry';
    const token = integrationConfig.token || process.env.MERCADOLIBRE_BEARER_TOKEN;

    if (!token) {
      console.error('[Mercado Libre] Error: Bearer token is not configured.');
      return;
    }

    const paramsObj = this.parseParams(telemetry.params);
    const isEngineOn = paramsObj.acc === '1' || paramsObj.acc === 1 || telemetry.event === 'ignition_on';

    const payload = {
      license_plate: deviceConfig.plate,
      timestamp: this.formatDate(telemetry.dt_tracker || telemetry.dt_server, 'ISO_T'),
      latitude: parseFloat(telemetry.lat),
      longitude: parseFloat(telemetry.lng),
      speed: Math.round(parseFloat(telemetry.speed || 0)),
      heading: Math.round(parseFloat(telemetry.angle || 0)),
      ignition: isEngineOn,
      provider: deviceConfig.carrier || 'VIKARGPS',
      device_id: telemetry.imei
    };

    console.log(`[Mercado Libre] Dispatching telemetry for ${deviceConfig.plate} to ${url}...`);
    const result = await this.sendJSONRequest(url, { 'Authorization': `Bearer ${token}` }, payload);

    if (result.success) {
      console.log(`[Mercado Libre] Success Response:`, result.data);
    } else {
      console.error(`[Mercado Libre] Forwarding failed:`, result.error);
    }
  }
}

module.exports = MercadoLibreStrategy;
