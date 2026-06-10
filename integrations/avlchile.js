const BaseStrategy = require('./BaseStrategy');
const axios = require('axios');

// Memory cache to prevent duplicate transmissions of the exact same coordinate timestamp
const lastSentTelemetryTimestamp = {};

// Batch queues grouped by token: { 'tokenXYZ': [record1, record2] }
const batchQueues = {}; 
const targetUrls = {};

// Background worker that flushes batches every 10 seconds
// This perfectly satisfies the AVL Chile rule while allowing the user's desired 10-second ultra-low latency
setInterval(async () => {
  const tokens = Object.keys(batchQueues);
  if (tokens.length === 0) return;

  for (const token of tokens) {
    const payload = batchQueues[token];
    if (!payload || payload.length === 0) continue;
    
    // Extract and clear the queue for this token
    batchQueues[token] = [];
    const url = targetUrls[token];

    console.log(`[AVL Chile] Flushing batch of ${payload.length} vehicles for token (masked: ${token.substring(0,4)}...)`);
    
    const headers = { 'Authorization': `AVLToken ${token}` };
    try {
      const res = await axios.post(url, payload, { headers, timeout: 15000 });
      console.log(`[AVL Chile] Batch Success Response:`, JSON.stringify(res.data));
    } catch (err) {
      console.error(`[AVL Chile] Batch Forwarding failed:`, err.message);
    }

    // Since rate limits are usually per-account, we just leave a tiny 1-second gap between different tokens
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
}, 10000);

class AvlChileStrategy extends BaseStrategy {
  async execute(telemetry, deviceConfig, integrationConfig) {
    const url = integrationConfig.endpoint || process.env.AVLCHILE_API_URL || 'https://webapp.avlchile.cl/api/v2/';
    const token = integrationConfig.token || process.env.AVLCHILE_TOKEN;

    if (!token) {
      console.error('[AVL Chile] Error: Token is not configured.');
      return;
    }

    const rawPlate = deviceConfig.plate || telemetry.plate_number || telemetry.imei || '';
    const plate = rawPlate.toUpperCase().replace(/[^A-Z0-9]/g, '');

    // Parse date and convert to UNIX timestamp
    const dateStr = telemetry.dt_tracker || telemetry.dt_server || new Date().toISOString();
    let parsedDate;
    if (dateStr.includes(' ')) {
      parsedDate = new Date(dateStr.replace(' ', 'T') + 'Z');
    } else {
      parsedDate = new Date(dateStr);
    }
    const unixTimestamp = Math.floor((isNaN(parsedDate.getTime()) ? Date.now() : parsedDate.getTime()) / 1000);

    // Enforce deduplication by exact telemetry timestamp
    const lastTelemetryTimestamp = lastSentTelemetryTimestamp[plate];
    if (lastTelemetryTimestamp && lastTelemetryTimestamp === unixTimestamp) {
      return; // Silently skip exact duplicate
    }
    lastSentTelemetryTimestamp[plate] = unixTimestamp;

    const paramsObj = this.parseParams(telemetry.params);
    const isEngineOn = paramsObj.acc === '1' || paramsObj.acc === 1 || 
                       paramsObj.io239 === '1' || paramsObj.io239 === 1 || 
                       telemetry.event === 'ignition_on' || 
                       parseFloat(telemetry.speed || 0) > 0;

    const latVal = parseFloat(telemetry.lat);
    const lngVal = parseFloat(telemetry.lng);

    if (isNaN(latVal) || isNaN(lngVal) || latVal === 0 || lngVal === 0) {
      console.warn(`[AVL Chile] Skipping telemetry dispatch for ${plate}: Invalid coordinates.`);
      return;
    }

    const satVal = Math.round(parseFloat(telemetry.gps_satellites || paramsObj.sat || paramsObj.satellites || paramsObj.gpslev || 4));
    const finalSat = satVal >= 4 ? satVal : 4;

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

    // Instead of sending instantly, we push to the token's batch queue
    if (!batchQueues[token]) {
      batchQueues[token] = [];
      targetUrls[token] = url;
    }
    
    batchQueues[token].push(record);
    console.log(`[AVL Chile] Added ${plate} to batch queue for token (masked: ${token.substring(0,4)}...)`);
  }
}

module.exports = AvlChileStrategy;
