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
      if (err.response && (err.response.status === 404 || err.response.status === 400)) {
        console.warn(`[Traccar] Device ${id} rejected (${err.response.status}) by Traccar server. Attempting auto-registration...`);
        
        const username = integrationConfig.username || process.env.TRACCAR_USER;
        const password = integrationConfig.password || process.env.TRACCAR_PASSWORD;
        let webUrl = integrationConfig.webUrl || process.env.TRACCAR_WEB_URL;
        
        if (!webUrl && url) {
          try {
            const parsedUrl = new URL(url);
            parsedUrl.port = ''; // Use default port (80/443)
            webUrl = parsedUrl.toString();
          } catch (e) {
            // ignore URL parse errors
          }
        }

        if (username && password && webUrl) {
          try {
            const registerUrl = `${webUrl.replace(/\/$/, '')}/api/devices`;
            const authHeader = 'Basic ' + Buffer.from(`${username}:${password}`).toString('base64');
            
            console.log(`[Traccar] Creating device ${id} via REST API: ${registerUrl}...`);
            await axios.post(registerUrl, 
              { name: id, uniqueId: id },
              {
                headers: {
                  'Content-Type': 'application/json',
                  'Accept': 'application/json',
                  'Authorization': authHeader
                },
                timeout: 10000
              }
            );
            
            console.log(`[Traccar] Device ${id} registered successfully. Retrying telemetry push...`);
            const retryResponse = await axios.get(url, { params, timeout: 8000 });
            console.log(`[Traccar] Success Response for ${id} (after retry): Status ${retryResponse.status}`);
            return;
          } catch (regErr) {
            console.error(`[Traccar] Auto-registration failed for ${id}:`, regErr.response ? JSON.stringify(regErr.response.data) : regErr.message);
          }
        } else {
          console.warn(`[Traccar] Missing credentials/web URL for auto-registration of ${id}. Please configure TRACCAR_USER, TRACCAR_PASSWORD, and TRACCAR_WEB_URL.`);
        }
      }
      console.error(`[Traccar] Forwarding failed for ${id}:`, err.message);
    }
  }
}

module.exports = TraccarStrategy;
