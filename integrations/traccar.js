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
    try {
      const url = integrationConfig.endpoint || process.env.TRACCAR_API_URL || 'http://demo3.traccar.org:5055/';
    const idType = integrationConfig.idType || process.env.TRACCAR_ID_TYPE || 'plate';
    const id = idType === 'imei' ? telemetry.imei : (deviceConfig.plate || telemetry.plate_number || telemetry.imei);

    // Parse date and convert to UNIX timestamp (seconds)
    const dateStr = telemetry.dt_tracker || telemetry.dt_server || new Date().toISOString();
    let parsedDate;
    if (dateStr.includes('T') && dateStr.includes('Z')) {
      parsedDate = new Date(dateStr);
    } else if (dateStr.includes(' ')) {
      const tz = process.env.TIMEZONE_OFFSET || '-04:00';
      parsedDate = new Date(dateStr.replace(' ', 'T') + tz);
    } else {
      parsedDate = new Date(dateStr);
    }
    const unixTimestamp = Math.floor((isNaN(parsedDate.getTime()) ? Date.now() : parsedDate.getTime()) / 1000);

    const latVal = parseFloat(telemetry.lat);
    const lonVal = parseFloat(telemetry.lng || telemetry.lon);

    if (isNaN(latVal) || isNaN(lonVal)) {
      console.warn(`[Traccar] Skipping update for ${id}: Invalid coordinates (lat: ${telemetry.lat}, lng/lon: ${telemetry.lng || telemetry.lon})`);
      return;
    }

    const speedVal = isNaN(parseFloat(telemetry.speed)) ? 0 : Math.round(parseFloat(telemetry.speed));
    const bearingVal = isNaN(parseFloat(telemetry.angle || telemetry.bearing)) ? 0 : Math.round(parseFloat(telemetry.angle || telemetry.bearing)) % 360;
    const altitudeVal = isNaN(parseFloat(telemetry.altitude)) ? 0 : Math.round(parseFloat(telemetry.altitude));

    const params = {
      id: id,
      lat: latVal,
      lon: lonVal,
      speed: speedVal,
      bearing: bearingVal,
      altitude: altitudeVal,
      timestamp: unixTimestamp,
      valid: telemetry.loc_valid !== undefined ? (String(telemetry.loc_valid) === '1' || telemetry.loc_valid === true ? 'true' : 'false') : 'true'
    };

    console.log(`[Traccar] Forwarding telemetry for ${id} to ${url}... Parameters:`, JSON.stringify(params));

      try {
        const response = await axios.get(url, { params, timeout: 8000 });
        console.log(`[Traccar] Success Response for ${id}: Status ${response.status}`);
      } catch (err) {
        console.error(`[Traccar] Forwarding failed for ${id}:`, err.message);
      }
    } catch (error) {
      console.error('[Traccar] Integration error:', error.message);
    }
  }
}

module.exports = TraccarStrategy;
