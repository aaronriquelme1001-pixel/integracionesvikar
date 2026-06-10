const BaseStrategy = require('./BaseStrategy');
const axios = require('axios');

class TraccarStrategy extends BaseStrategy {
  /**
   * Executes the Traccar HTTP (OsmAnd) integration.
   * 
   * @param {Object} telemetry - Raw telemetry from GPS Server.
   * @param {Object} deviceConfig - Vehicle metadata.
   * @param {Object} integrationConfig - Traccar specific overrides.
   */
  async execute(telemetry, deviceConfig, integrationConfig) {
    const url = integrationConfig.endpoint || process.env.TRACCAR_API_URL || 'http://demo3.traccar.org:5055/';
    const id = deviceConfig.plate || telemetry.plate_number || telemetry.imei;

    // Parse date and convert to UNIX timestamp (seconds)
    const dateStr = telemetry.dt_tracker || telemetry.dt_server || new Date().toISOString();
    let parsedDate;
    if (dateStr.includes(' ')) {
      parsedDate = new Date(dateStr.replace(' ', 'T') + 'Z');
    } else {
      parsedDate = new Date(dateStr);
    }
    const unixTimestamp = Math.floor((isNaN(parsedDate.getTime()) ? Date.now() : parsedDate.getTime()) / 1000);

    const params = {
      id: id,
      lat: parseFloat(telemetry.lat),
      lon: parseFloat(telemetry.lng),
      speed: Math.round(parseFloat(telemetry.speed || 0)),
      bearing: Math.round(parseFloat(telemetry.angle || 0)) % 360,
      altitude: Math.round(parseFloat(telemetry.altitude || 0)),
      timestamp: unixTimestamp,
      valid: telemetry.loc_valid !== undefined ? (String(telemetry.loc_valid) === '1' || telemetry.loc_valid === true ? 'true' : 'false') : 'true'
    };

    console.log(`[Traccar] Forwarding telemetry for ${id} to ${url}...`);

    try {
      const response = await axios.get(url, { params, timeout: 8000 });
      console.log(`[Traccar] Success Response for ${id}: Status ${response.status}`);
    } catch (err) {
      console.error(`[Traccar] Forwarding failed for ${id}:`, err.message);
    }
  }
}

module.exports = TraccarStrategy;
