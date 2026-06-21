const BaseStrategy = require('./BaseStrategy');

class ColunStrategy extends BaseStrategy {
  /**
   * Executes the Colun integration.
   * 
   * @param {Object} telemetry - Raw telemetry from GPS Server.
   * @param {Object} deviceConfig - Vehicle metadata from devices.json.
   * @param {Object} integrationConfig - Colun specific config overrides from devices.json.
   */
  async execute(telemetry, deviceConfig, integrationConfig) {
    try {
      const url = integrationConfig.endpoint || process.env.COLUN_API_URL || 'https://services.wing.cl/tracking/receiver/hub/v2';
    const token = integrationConfig.token || process.env.COLUN_BEARER_TOKEN;

    if (!token) {
      console.error('[Colun] Error: Bearer token is not configured.');
      return;
    }

    const paramsObj = this.parseParams(telemetry.params);
    const isEngineOn = paramsObj.acc === '1' || paramsObj.acc === 1 || telemetry.event === 'ignition_on';
    const formattedTime = this.formatDate(telemetry.dt_tracker || telemetry.dt_server);

    const payload = {
      pv: deviceConfig.plate,
      fh: formattedTime,
      lt: parseFloat(telemetry.lat),
      ln: parseFloat(telemetry.lng),
      vg: Math.round(parseFloat(telemetry.speed || 0)),
      c: Math.round(parseFloat(telemetry.angle || 0)),
      tv: {
        me: isEngineOn ? 1 : 0
      }
    };

    if (telemetry.odometer !== undefined && telemetry.odometer !== '') {
      payload.tv.od = Math.round(parseFloat(telemetry.odometer));
    }

    console.log(`[Colun] Dispatching telemetry for ${deviceConfig.plate} to ${url}...`);
    const result = await this.sendJSONRequest(url, { 'Authorization': token }, payload);

    if (result.success) {
      console.log(`[Colun] Success Response:`, result.data);
    } else {
      console.error(`[Colun] Forwarding failed:`, result.error);
    }
    } catch (error) {
      console.error('[Colun] Integration error:', error.message);
    }
  }
}

module.exports = ColunStrategy;
