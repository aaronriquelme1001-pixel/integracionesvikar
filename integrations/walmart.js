const BaseStrategy = require('./BaseStrategy');

class WalmartStrategy extends BaseStrategy {
  /**
   * Executes the Walmart custom REST API integration.
   * 
   * @param {Object} telemetry - Raw telemetry from GPS Server.
   * @param {Object} deviceConfig - Vehicle metadata.
   * @param {Object} integrationConfig - Walmart specific overrides.
   */
  async execute(telemetry, deviceConfig, integrationConfig) {
    const url = integrationConfig.endpoint || process.env.WALMART_API_URL || 'https://api.walmart.com/logistics/v1/carrier/gps';
    const clientSecret = integrationConfig.client_secret || process.env.WALMART_CLIENT_SECRET;
    const clientId = integrationConfig.client_id || process.env.WALMART_CLIENT_ID;

    if (!clientId || !clientSecret) {
      console.error('[Walmart] Error: Client ID or Client Secret is not configured.');
      return;
    }

    const paramsObj = this.parseParams(telemetry.params);
    const isEngineOn = paramsObj.acc === '1' || paramsObj.acc === 1 || telemetry.event === 'ignition_on';

    const payload = {
      vehicleId: deviceConfig.plate,
      imei: telemetry.imei,
      latitude: parseFloat(telemetry.lat),
      longitude: parseFloat(telemetry.lng),
      speedKmh: Math.round(parseFloat(telemetry.speed || 0)),
      bearingDegrees: Math.round(parseFloat(telemetry.angle || 0)),
      ignitionStatus: isEngineOn ? 'ON' : 'OFF',
      eventTime: this.formatDate(telemetry.dt_tracker || telemetry.dt_server, 'ISO_T'),
      carrierName: deviceConfig.carrier || 'VIKARGPS'
    };

    console.log(`[Walmart] Dispatching telemetry for ${deviceConfig.plate} to ${url}...`);
    const headers = {
      'WM_SEC.KEY': clientSecret,
      'WM_CONSUMER.ID': clientId
    };
    const result = await this.sendJSONRequest(url, headers, payload);

    if (result.success) {
      console.log(`[Walmart] Success Response:`, result.data);
    } else {
      console.error(`[Walmart] Forwarding failed:`, result.error);
    }
  }
}

module.exports = WalmartStrategy;
