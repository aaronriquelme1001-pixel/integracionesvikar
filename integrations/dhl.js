const BaseStrategy = require('./BaseStrategy');

class DhlStrategy extends BaseStrategy {
  /**
   * Executes the DHL carrier telemetry integration.
   * 
   * @param {Object} telemetry - Raw telemetry from GPS Server.
   * @param {Object} deviceConfig - Vehicle metadata.
   * @param {Object} integrationConfig - DHL specific overrides.
   */
  async execute(telemetry, deviceConfig, integrationConfig) {
    try {
      const url = integrationConfig.endpoint || process.env.DHL_API_URL || 'https://api.dhl.com/transport/v1/telemetry';
    const apiKey = integrationConfig.api_key || process.env.DHL_API_KEY;

    if (!apiKey) {
      console.error('[DHL] Error: API key is not configured.');
      return;
    }

    const paramsObj = this.parseParams(telemetry.params);
    const isEngineOn = paramsObj.acc === '1' || paramsObj.acc === 1 || telemetry.event === 'ignition_on';

    const payload = {
      carrierCode: deviceConfig.carrier || 'VIKARGPS',
      licensePlate: deviceConfig.plate,
      imei: telemetry.imei,
      latitude: parseFloat(telemetry.lat),
      longitude: parseFloat(telemetry.lng),
      speedKmh: Math.round(parseFloat(telemetry.speed || 0)),
      heading: Math.round(parseFloat(telemetry.angle || 0)),
      engineStatus: isEngineOn ? 'RUNNING' : 'STOPPED',
      timestamp: this.formatDate(telemetry.dt_tracker || telemetry.dt_server, 'ISO_T')
    };

    console.log(`[DHL] Dispatching telemetry for ${deviceConfig.plate} to ${url}...`);
    const result = await this.sendJSONRequest(url, { 'DHL-API-Key': apiKey }, payload);

    if (result.success) {
      console.log(`[DHL] Success Response:`, result.data);
    } else {
      console.error(`[DHL] Forwarding failed:`, result.error);
    }
    } catch (error) {
      console.error('[DHL] Integration error:', error.message);
    }
  }
}

module.exports = DhlStrategy;
