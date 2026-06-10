const BaseStrategy = require('./BaseStrategy');

// Memory cache to prevent duplicate transmissions within the 10-second rate-limit window per plate
const lastSentCache = {};
// Memory cache to prevent duplicate transmissions of the exact same coordinate timestamp
const lastSentTelemetryTimestamp = {};

// Queue variables to ensure consecutive requests to AVL Chile are paced at least 5 seconds apart
let avlRequestQueue = Promise.resolve();
let lastRequestTime = 0;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

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

    const rawPlate = deviceConfig.plate || telemetry.plate_number || telemetry.imei || '';
    const plate = rawPlate.toUpperCase().replace(/[^A-Z0-9]/g, '');

    // Determine the source of the token for logging
    const tokenSource = integrationConfig.token ? `integrationConfig (${integrationConfig.client || 'override'})` : (process.env.AVLCHILE_TOKEN ? 'process.env.AVLCHILE_TOKEN' : 'unknown');
    const maskedToken = token.length <= 8 ? '***' : `${token.substring(0, 4)}...${token.substring(token.length - 4)}`;
    console.log(`[AVL Chile] Using token from ${tokenSource} (masked: ${maskedToken}) for plate ${plate}`);

    // Parse date and convert to UNIX timestamp (seconds)
    const dateStr = telemetry.dt_tracker || telemetry.dt_server || new Date().toISOString();
    let parsedDate;
    if (dateStr.includes(' ')) {
      parsedDate = new Date(dateStr.replace(' ', 'T') + 'Z');
    } else {
      parsedDate = new Date(dateStr);
    }
    const unixTimestamp = Math.floor((isNaN(parsedDate.getTime()) ? Date.now() : parsedDate.getTime()) / 1000);

    // Enforce deduplication by exact telemetry timestamp to prevent duplicates on parked/static vehicles
    const lastTelemetryTimestamp = lastSentTelemetryTimestamp[plate];
    if (lastTelemetryTimestamp && lastTelemetryTimestamp === unixTimestamp) {
      console.log(`[AVL Chile] Skipping telemetry dispatch for ${plate}: Telemetry timestamp ${unixTimestamp} was already successfully sent.`);
      return;
    }

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

    const latVal = parseFloat(telemetry.lat);
    const lngVal = parseFloat(telemetry.lng);

    if (isNaN(latVal) || isNaN(lngVal) || latVal === 0 || lngVal === 0) {
      console.warn(`[AVL Chile] Skipping telemetry dispatch for ${plate}: Invalid coordinates (lat: ${telemetry.lat}, lng: ${telemetry.lng}).`);
      return;
    }

    // Satellites visible (Min 4 per spec)
    const satVal = Math.round(parseFloat(telemetry.gps_satellites || paramsObj.sat || paramsObj.satellites || paramsObj.gpslev || 4));
    const finalSat = satVal >= 4 ? satVal : 4;

    // Build flat payload array with dot-notation keys
    const record = {
      "avl.id": 1,
      "avl.ident": plate,
      "avl.name": plate,
      "avl.timestamp": unixTimestamp,
      "avl.position.altitude": Math.round(parseFloat(telemetry.altitude || 0)),
      "avl.position.direction": Math.round(parseFloat(telemetry.angle || 0)) % 360,
      "avl.position.latitude": latVal,
      "avl.position.longitude": lngVal,
      "avl.position.satellites": finalSat,
      "avl.position.speed": Math.round(parseFloat(telemetry.speed || 0)),
      "avl.device.battery.voltage": paramsObj.batp ? (parseFloat(paramsObj.batp) > 10 ? parseFloat((3.5 + (parseFloat(paramsObj.batp) / 100) * 0.7).toFixed(2)) : parseFloat(paramsObj.batp)) : 4.0,
      "avl.device.external.voltage": paramsObj.voltage ? parseFloat(paramsObj.voltage) : 12.0,
      "avl.device.gsm": paramsObj.gsm ? parseInt(paramsObj.gsm, 10) : (paramsObj.gsmlev ? parseInt(paramsObj.gsmlev, 10) : 3),
      "avl.device.ignition": isEngineOn,
      "avl.driver.id": telemetry.driver_name || "",
      "avl.driver.name": telemetry.driver_name || "",
      "avl.data": []
    };

    const payload = [record];

    // Queue and throttle the HTTP request to satisfy AVL Chile's 5-second rate limit
    const result = await new Promise((resolve) => {
      avlRequestQueue = avlRequestQueue
        .then(async () => {
          const timeSinceLast = Date.now() - lastRequestTime;
          const minDelay = 10000; // 10 seconds safety margin to comply strictly with AVL Chile API limits
          if (timeSinceLast < minDelay) {
            const waitTime = minDelay - timeSinceLast;
            console.log(`[AVL Chile] Throttling request for ${plate}: waiting ${waitTime}ms to comply with 10-second rate limit...`);
            await delay(waitTime);
          }

          console.log(`[AVL Chile] Dispatching telemetry for ${deviceConfig.plate || telemetry.plate_number} to ${url}...`);
          const headers = {
            'Authorization': `AVLToken ${token}`
          };
          
          let res;
          try {
            res = await this.sendJSONRequest(url, headers, payload);
          } finally {
            // Update last request timestamp AFTER completion (success or failure) to account for connection latency
            lastRequestTime = Date.now();
          }
          resolve(res);
        })
        .catch((err) => {
          console.error(`[AVL Chile] Error in request queue:`, err.message);
          lastRequestTime = Date.now();
          resolve({ success: false, error: err.message });
        });
    });

    if (result.success) {
      console.log(`[AVL Chile] Success Response:`, JSON.stringify(result.data));
      
      // Save telemetry timestamp if it was successfully accepted (not unauthorized)
      const isAccepted = result.data && result.data.status && 
                         (result.data.status.result === true || result.data.status.valid_count > 0);
      if (isAccepted) {
        lastSentTelemetryTimestamp[plate] = unixTimestamp;
      }
    } else {
      console.error(`[AVL Chile] Forwarding failed:`, result.error);
    }
  }
}

module.exports = AvlChileStrategy;
