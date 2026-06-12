const axios = require('axios');
const { dispatchToB2B } = require('../core/dispatcher');
const { computeSignature } = require('../../utils/signature');

const TRACKSOLID_API_URL = process.env.TRACKSOLID_API_URL || 'https://us-open.tracksolidpro.com/route/rest';
const TRACKSOLID_USER_ID = process.env.TRACKSOLID_USER_ID;
const TRACKSOLID_USER_PWD = process.env.TRACKSOLID_USER_PWD;
const TRACKSOLID_APP_KEY = process.env.TRACKSOLID_APP_KEY;
const TRACKSOLID_APP_SECRET = process.env.TRACKSOLID_APP_SECRET;

// Poll interval from environment or default to 10000ms (10s)
const TRACKSOLID_POLL_INTERVAL = parseInt(process.env.TRACKSOLID_POLL_INTERVAL, 10) || 10000;

let tracksolidAccessToken = null;
let tracksolidTokenExpiry = 0;
let lastTracksolidPollTime = null;
let lastTracksolidPollStatus = 'Waiting to start...';
let isTracksolidPolling = false;

/**
 * Authenticates with Tracksolid Pro API and sets the global tracksolidAccessToken
 */
async function loginToTracksolid() {
  if (!TRACKSOLID_USER_ID || !TRACKSOLID_USER_PWD || !TRACKSOLID_APP_KEY || !TRACKSOLID_APP_SECRET) {
    console.warn('[Tracksolid] Missing credentials in environment variables.');
    return false;
  }

  const timestamp = Math.floor(Date.now() / 1000).toString();
  const params = {
    method: 'jimi.oauth.token.get',
    timestamp: timestamp,
    app_key: TRACKSOLID_APP_KEY,
    sign_method: 'md5',
    v: '1.0',
    format: 'json',
    user_id: TRACKSOLID_USER_ID,
    user_pwd_md5: TRACKSOLID_USER_PWD,
    expires_in: 7200
  };

  params.sign = computeSignature(params, TRACKSOLID_APP_SECRET);

  try {
    const response = await axios.post(TRACKSOLID_API_URL, null, { params });
    if (response.data && response.data.code === 0 && response.data.result) {
      tracksolidAccessToken = response.data.result.accessToken;
      tracksolidTokenExpiry = Date.now() + (response.data.result.expiresIn * 1000) - 300000; 
      console.log('[Tracksolid] Authentication successful. Token generated.');
      return true;
    } else {
      console.error('[Tracksolid] Auth failed. API Response:', JSON.stringify(response.data));
      return false;
    }
  } catch (err) {
    console.error('[Tracksolid] Error during authentication request:', err.message);
    return false;
  }
}

/**
 * Retrieves latest device statuses/locations from Tracksolid Pro and routes them
 */
async function pollTracksolid() {
  if (isTracksolidPolling) return;
  isTracksolidPolling = true;
  lastTracksolidPollTime = new Date().toISOString();

  if (!tracksolidAccessToken || Date.now() > tracksolidTokenExpiry) {
    console.log('[Tracksolid] Token expired or missing. Attempting login...');
    const loginSuccess = await loginToTracksolid();
    if (!loginSuccess) {
      lastTracksolidPollStatus = 'Auth failed';
      isTracksolidPolling = false;
      setTimeout(pollTracksolid, TRACKSOLID_POLL_INTERVAL);
      return;
    }
  }

  const timestamp = Math.floor(Date.now() / 1000).toString();
  const params = {
    method: 'jimi.device.location.list',
    timestamp: timestamp,
    app_key: TRACKSOLID_APP_KEY,
    sign_method: 'md5',
    v: '1.0',
    format: 'json',
    access_token: tracksolidAccessToken,
    target: TRACKSOLID_USER_ID
  };

  params.sign = computeSignature(params, TRACKSOLID_APP_SECRET);

  try {
    const response = await axios.post(TRACKSOLID_API_URL, null, { params, timeout: 10000 });

    if (response.data && response.data.code === 0 && response.data.result) {
      const devices = response.data.result || [];
      console.log(`[Tracksolid] Poller fetched ${devices.length} devices.`);
      
      let processedCount = 0;
      for (const dev of devices) {
        if (!dev.imei || !dev.lat || !dev.lng) continue;

        // Parse GPS time string
        const gpsTime = dev.gpsTime ? dev.gpsTime.replace(' ', 'T') + 'Z' : new Date().toISOString();

        const telemetry = {
          imei: dev.imei,
          plate_number: dev.deviceName || dev.imei,
          dt_tracker: gpsTime,
          lat: dev.lat,
          lng: dev.lng,
          speed: dev.speed || 0,
          angle: dev.course || 0,
          altitude: dev.altitude || 0,
          loc_valid: 1, 
          params: ''
        };

        await dispatchToB2B(telemetry);
        processedCount++;
      }
      lastTracksolidPollStatus = `Success: Extracted ${processedCount} telemetry records.`;
    } else {
      console.error('[Tracksolid] Failed to fetch device locations:', JSON.stringify(response.data));
      if (response.data && response.data.code === 40003) {
         tracksolidAccessToken = null; // force token refresh
      }
      lastTracksolidPollStatus = `API Error: ${response.data ? response.data.code : 'Unknown'}`;
    }
  } catch (err) {
    console.error('[Tracksolid] Error polling API:', err.message);
    lastTracksolidPollStatus = `Network Error: ${err.message}`;
  }

  isTracksolidPolling = false;
  setTimeout(pollTracksolid, TRACKSOLID_POLL_INTERVAL);
}

module.exports = {
  pollTracksolid,
  getStatus: () => ({ lastTracksolidPollTime, lastTracksolidPollStatus })
};
