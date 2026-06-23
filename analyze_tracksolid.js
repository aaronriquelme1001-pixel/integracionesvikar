require('dotenv').config();
const axios = require('axios');
const crypto = require('crypto');

function computeSignature(params, appSecret) {
  const sortedKeys = Object.keys(params).sort();
  let signString = appSecret;
  for (const key of sortedKeys) {
    if (key !== 'sign') {
      signString += key + params[key];
    }
  }
  signString += appSecret;
  return crypto.createHash('md5').update(signString, 'utf8').digest('hex').toUpperCase();
}

async function analyzeTracksolid() {
  const TRACKSOLID_API_URL = process.env.TRACKSOLID_API_URL || 'https://us-open.tracksolidpro.com/route/rest';
  const TRACKSOLID_USER_ID = process.env.TRACKSOLID_USER_ID;
  const TRACKSOLID_USER_PWD = process.env.TRACKSOLID_USER_PWD_MD5 || process.env.TRACKSOLID_USER_PWD;
  const TRACKSOLID_APP_KEY = process.env.TRACKSOLID_APP_KEY;
  const TRACKSOLID_APP_SECRET = process.env.TRACKSOLID_APP_SECRET;

  let d = new Date();
  let timestamp = d.getUTCFullYear() + '-' + String(d.getUTCMonth()+1).padStart(2,'0') + '-' + String(d.getUTCDate()).padStart(2,'0') + ' ' + String(d.getUTCHours()).padStart(2,'0') + ':' + String(d.getUTCMinutes()).padStart(2,'0') + ':' + String(d.getUTCSeconds()).padStart(2,'0');

  let params = {
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

  let token = null;
  try {
    const res = await axios.post(TRACKSOLID_API_URL, null, { params });
    if (res.data && res.data.code === 0 && res.data.result) {
      token = res.data.result.accessToken;
      console.log('Login successful! Token:', token);
    } else {
      console.log('Login failed:', res.data);
      return;
    }
  } catch (err) {
    console.error('Error logging in:', err.message);
    return;
  }

  console.log('\nFetching devices...');
  d = new Date();
  timestamp = d.getUTCFullYear() + '-' + String(d.getUTCMonth()+1).padStart(2,'0') + '-' + String(d.getUTCDate()).padStart(2,'0') + ' ' + String(d.getUTCHours()).padStart(2,'0') + ':' + String(d.getUTCMinutes()).padStart(2,'0') + ':' + String(d.getUTCSeconds()).padStart(2,'0');
  
  let locParams = {
    method: 'jimi.user.device.location.list',
    timestamp: timestamp,
    app_key: TRACKSOLID_APP_KEY,
    sign_method: 'md5',
    v: '1.0',
    format: 'json',
    access_token: token,
    target: TRACKSOLID_USER_ID
  };
  locParams.sign = computeSignature(locParams, TRACKSOLID_APP_SECRET);

  try {
    const res = await axios.post(TRACKSOLID_API_URL, null, { params: locParams });
    if (res.data && res.data.result) {
      const devices = res.data.result;
      console.log(`Found ${devices.length} devices in Tracksolid.`);
      for (const d of devices) {
        console.log(`\nIMEI: ${d.imei}`);
        console.log(`Name (Plate): ${d.deviceName}`);
        console.log(`Last Lat/Lng: ${d.lat}, ${d.lng}`);
        console.log(`Speed: ${d.speed} kph`);
        console.log(`GPS Time: ${d.gpsTime}`);
        console.log(`Course: ${d.course}`);
      }
    } else {
      console.log('Error fetching devices:', res.data);
    }
  } catch (err) {
    console.error('Error fetching locations:', err.message);
  }
}

analyzeTracksolid();
