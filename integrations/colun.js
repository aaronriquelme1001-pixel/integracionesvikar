const axios = require('axios');

/**
 * Parses GPS Server custom params string (e.g. "acc=1|batp=80|") into an object.
 */
function parseParams(paramsStr) {
  const result = {};
  if (!paramsStr) return result;
  const parts = paramsStr.split('|');
  for (const part of parts) {
    if (part) {
      const kv = part.split('=');
      if (kv.length === 2) {
        result[kv[0]] = kv[1];
      }
    }
  }
  return result;
}

/**
 * Sends telemetry data to Colun (GPS Smart / West Ingeniería).
 * 
 * @param {Object} telemetry - Raw telemetry from GPS Server.
 * @param {Object} deviceConfig - Vehicle metadata from devices.json.
 */
async function sendToColun(telemetry, deviceConfig) {
  const url = process.env.COLUN_API_URL || 'https://services.wing.cl/tracking/receiver/hub/v2';
  const token = process.env.COLUN_BEARER_TOKEN;

  if (!token) {
    console.error('[Colun] Error: COLUN_BEARER_TOKEN is not configured.');
    return;
  }

  const paramsObj = parseParams(telemetry.params);
  const isEngineOn = paramsObj.acc === '1' || paramsObj.acc === 1 || telemetry.event === 'ignition_on';

  // Format date: Colun expects "YYYY-MM-DD HH:mm:ss"
  let formattedTime = telemetry.dt_tracker || telemetry.dt_server || new Date().toISOString().replace('T', ' ').substring(0, 19);

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

  // Add odometer if present in telemetry
  if (telemetry.odometer !== undefined && telemetry.odometer !== '') {
    payload.tv.od = Math.round(parseFloat(telemetry.odometer));
  }

  console.log(`[Colun] Dispatching telemetry for ${deviceConfig.plate} to ${url}...`);

  try {
    const response = await axios.post(url, payload, {
      headers: {
        'Authorization': token,
        'Content-Type': 'application/json'
      },
      timeout: 10000
    });
    console.log(`[Colun] Success Response:`, response.data);
  } catch (error) {
    console.error(`[Colun] Forwarding failed:`, error.response ? error.response.data : error.message);
  }
}

module.exports = {
  sendToColun
};
