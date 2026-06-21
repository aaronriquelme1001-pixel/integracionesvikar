const BaseStrategy = require('./BaseStrategy');

class SmuStrategy extends BaseStrategy {
  /**
   * Executes the SMU (Unimarc/Alvi) integration.
   * 
   * @param {Object} telemetry - Raw telemetry from GPS Server.
   * @param {Object} deviceConfig - Vehicle metadata.
   * @param {Object} integrationConfig - SMU specific overrides.
   */
  async execute(telemetry, deviceConfig, integrationConfig) {
    try {
      const url = integrationConfig.endpoint || process.env.SMU_API_URL || 'https://api.smu.cl/tracking/gps';
    const token = integrationConfig.token || process.env.SMU_API_TOKEN;

    if (!token) {
      console.error('[SMU] Error: API token is not configured.');
      return;
    }

    const paramsObj = this.parseParams(telemetry.params);
    const isEngineOn = paramsObj.acc === '1' || paramsObj.acc === 1 || telemetry.event === 'ignition_on';

    const payload = {
      patente: deviceConfig.plate,
      imei: telemetry.imei,
      gps_fecha_hora: this.formatDate(telemetry.dt_tracker || telemetry.dt_server, 'ISO_T'),
      latitud: parseFloat(telemetry.lat),
      longitud: parseFloat(telemetry.lng),
      velocidad: Math.round(parseFloat(telemetry.speed || 0)),
      rumbo: Math.round(parseFloat(telemetry.angle || 0)),
      ignicion: isEngineOn ? 1 : 0
    };

    console.log(`[SMU] Dispatching telemetry for ${deviceConfig.plate} to ${url}...`);
    const result = await this.sendJSONRequest(url, { 'Authorization': `Token ${token}` }, payload);

      if (result.success) {
        console.log(`[SMU] Success Response:`, result.data);
      } else {
        console.error(`[SMU] Forwarding failed:`, result.error);
      }
    } catch (error) {
      console.error('[SMU] Integration error:', error.message);
    }
  }
}

module.exports = SmuStrategy;
