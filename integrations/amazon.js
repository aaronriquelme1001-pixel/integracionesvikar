const BaseStrategy = require('./BaseStrategy');

class AmazonStrategy extends BaseStrategy {
  /**
   * Executes the Amazon SP-API / carrier telemetry integration.
   * 
   * @param {Object} telemetry - Raw telemetry from GPS Server.
   * @param {Object} deviceConfig - Vehicle metadata.
   * @param {Object} integrationConfig - Amazon specific overrides.
   */
  async execute(telemetry, deviceConfig, integrationConfig) {
    try {
      const url = integrationConfig.endpoint || process.env.AMAZON_API_URL || 'https://sellingpartnerapi-na.amazon.com/shipping/v2/carrier/telemetry';
    const token = integrationConfig.token || process.env.AMAZON_ACCESS_TOKEN;

    if (!token) {
      console.error('[Amazon] Error: Access token is not configured.');
      return;
    }

    const paramsObj = this.parseParams(telemetry.params);
    const isEngineOn = paramsObj.acc === '1' || paramsObj.acc === 1 || telemetry.event === 'ignition_on';

    const payload = {
      carrierId: deviceConfig.carrier || 'VIKARGPS',
      vehicleIdentifier: deviceConfig.plate,
      deviceId: telemetry.imei,
      location: {
        latitude: parseFloat(telemetry.lat),
        longitude: parseFloat(telemetry.lng)
      },
      speed: {
        value: Math.round(parseFloat(telemetry.speed || 0)),
        unit: 'KM_PER_HOUR'
      },
      headingDegrees: Math.round(parseFloat(telemetry.angle || 0)),
      ignitionOn: isEngineOn,
      recordedAt: this.formatDate(telemetry.dt_tracker || telemetry.dt_server, 'ISO_T')
    };

    console.log(`[Amazon] Dispatching telemetry for ${deviceConfig.plate} to ${url}...`);
    const headers = {
      'x-amz-access-token': token
    };
    const result = await this.sendJSONRequest(url, headers, payload);

    if (result.success) {
      console.log(`[Amazon] Success Response:`, result.data);
    } else {
      console.error(`[Amazon] Forwarding failed:`, result.error);
    }
    } catch (error) {
      console.error('[Amazon] Integration error:', error.message);
    }
  }
}

module.exports = AmazonStrategy;
