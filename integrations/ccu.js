const BaseStrategy = require('./BaseStrategy');

class CcuStrategy extends BaseStrategy {
  /**
   * Executes the CCU integration.
   * 
   * @param {Object} telemetry - Raw telemetry from GPS Server.
   * @param {Object} deviceConfig - Vehicle metadata.
   * @param {Object} integrationConfig - CCU specific overrides.
   */
  async execute(telemetry, deviceConfig, integrationConfig) {
    const url = integrationConfig.endpoint || process.env.CCU_API_URL || 'https://api.ccu.cl/distribucion/gps';
    const token = integrationConfig.token || process.env.CCU_BEARER_TOKEN;

    if (!token) {
      console.error('[CCU] Error: Bearer token is not configured.');
      return;
    }

    const paramsObj = this.parseParams(telemetry.params);
    const isEngineOn = paramsObj.acc === '1' || paramsObj.acc === 1 || telemetry.event === 'ignition_on';

    const payload = {
      patente: deviceConfig.plate,
      imei: telemetry.imei,
      latitud: parseFloat(telemetry.lat),
      longitud: parseFloat(telemetry.lng),
      velocidad: Math.round(parseFloat(telemetry.speed || 0)),
      rumbo: Math.round(parseFloat(telemetry.angle || 0)),
      contacto: isEngineOn ? 1 : 0,
      fecha_hora: this.formatDate(telemetry.dt_tracker || telemetry.dt_server, 'ISO_T')
    };

    console.log(`[CCU] Dispatching telemetry for ${deviceConfig.plate} to ${url}...`);
    const result = await this.sendJSONRequest(url, { 'Authorization': `Bearer ${token}` }, payload);

    if (result.success) {
      console.log(`[CCU] Success Response:`, result.data);
    } else {
      console.error(`[CCU] Forwarding failed:`, result.error);
    }
  }
}

module.exports = CcuStrategy;
