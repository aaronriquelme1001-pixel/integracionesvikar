const BaseStrategy = require('./BaseStrategy');

// Memory cache to prevent duplicate transmissions within the 5-second rate-limit window
const lastSentCache = {};

class AvlChileStrategy extends BaseStrategy {
  /**
   * Executes the AVL Chile integration.
   * 
   * @param {Object} telemetry - Raw telemetry from GPS Server.
   * @param {Object} deviceConfig - Vehicle metadata.
   * @param {Object} integrationConfig - AVL Chile specific overrides.
   */
  async execute(telemetry, deviceConfig, integrationConfig) {
    const url = integrationConfig.endpoint || process.env.AVLCHILE_API_URL || 'https://webapp.avlchile.cl/api/v2/';
    const token = integrationConfig.token || process.env.AVLCHILE_TOKEN;

    if (!token) {
      console.error('[AVL Chile] Error: Token is not configured.');
      return;
    }

    const plate = deviceConfig.plate || telemetry.plate_number || telemetry.imei;

    // Enforce 10-second deduplication window to comply with AVL Chile's rate limit
    const now = Date.now();
    const lastSent = lastSentCache[plate];
    if (lastSent && (now - lastSent) < 10000) {
      console.log(`[AVL Chile] Skipping telemetry dispatch for ${plate} to prevent rate limit (last sent ${((now - lastSent) / 1000).toFixed(1)}s ago).`);
      return;
    }

    // Save timestamp before sending (optimistic cache lock)
    lastSentCache[plate] = now;

    const paramsObj = this.parseParams(telemetry.params);
    const isEngineOn = paramsObj.acc === '1' || paramsObj.acc === 1 || 
                       paramsObj.io239 === '1' || paramsObj.io239 === 1 || 
                       telemetry.event === 'ignition_on' || 
                       parseFloat(telemetry.speed || 0) > 0;

    // Parse date and convert to UNIX timestamp (seconds)
    const dateStr = telemetry.dt_tracker || telemetry.dt_server || new Date().toISOString();
    let parsedDate;
    if (dateStr.includes(' ')) {
      parsedDate = new Date(dateStr.replace(' ', 'T') + 'Z');
    } else {
      parsedDate = new Date(dateStr);
    }
    const unixTimestamp = Math.floor((isNaN(parsedDate.getTime()) ? Date.now() : parsedDate.getTime()) / 1000);

    // Satellites visible (Min 4 per spec)
    const satVal = Math.round(parseFloat(telemetry.gps_satellites || paramsObj.sat || paramsObj.satellites || 4));
    const finalSat = satVal >= 4 ? satVal : 4;

    // Build flat payload array with dot-notation keys
    const record = {
      "avl.id": 1,
      "avl.ident": deviceConfig.plate || telemetry.plate_number || telemetry.imei,
      "avl.name": deviceConfig.plate || telemetry.plate_number || "",
      "avl.timestamp": unixTimestamp,
      "avl.position.altitude": Math.round(parseFloat(telemetry.altitude || 0)),
      "avl.position.direction": Math.round(parseFloat(telemetry.angle || 0)) % 360,
      "avl.position.latitude": parseFloat(telemetry.lat),
      "avl.position.longitude": parseFloat(telemetry.lng),
      "avl.position.satellites": finalSat,
      "avl.position.speed": Math.round(parseFloat(telemetry.speed || 0)),
      "avl.device.battery.voltage": paramsObj.batp ? parseFloat(paramsObj.batp) : 4.0,
      "avl.device.external.voltage": paramsObj.voltage ? parseFloat(paramsObj.voltage) : 12.0,
      "avl.device.gsm": paramsObj.gsm ? parseInt(paramsObj.gsm, 10) : 3,
      "avl.device.ignition": isEngineOn,
      "avl.driver.id": telemetry.driver_name || "",
      "avl.driver.name": telemetry.driver_name || "",
      "avl.data": []
    };

    const payload = [record];

    console.log(`[AVL Chile] Dispatching telemetry for ${deviceConfig.plate || telemetry.plate_number} to ${url}...`);
    const headers = {
      'Authorization': `AVLToken ${token}`
    };
    const result = await this.sendJSONRequest(url, headers, payload);

    if (result.success) {
      console.log(`[AVL Chile] Success Response:`, result.data);
    } else {
      console.error(`[AVL Chile] Forwarding failed:`, result.error);
    }
  }
}

module.exports = AvlChileStrategy;
