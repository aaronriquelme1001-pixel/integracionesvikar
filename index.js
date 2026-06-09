require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { verifySignature, computeSignature } = require('./utils/signature');

// Tracksolid API configuration
const TRACKSOLID_API_URL = process.env.TRACKSOLID_API_URL || 'https://us-open.tracksolidpro.com/route/rest';
const TRACKSOLID_USER_ID = process.env.TRACKSOLID_USER_ID;
const TRACKSOLID_USER_PWD_MD5 = process.env.TRACKSOLID_USER_PWD_MD5;
const TRACKSOLID_APP_KEY = process.env.TRACKSOLID_APP_KEY;
const TRACKSOLID_APP_SECRET = process.env.TRACKSOLID_APP_SECRET;
const TRACKSOLID_IMEIS = process.env.TRACKSOLID_IMEIS;
const TRACKSOLID_POLL_INTERVAL = parseInt(process.env.TRACKSOLID_POLL_INTERVAL || '10000', 10);
const GPS_SERVER_URL = process.env.GPS_SERVER_URL || 'http://gsh7.net/id39/api/api_loc.php';

// Tracksolid Poller Cache & Diagnostics State
let cachedTracksolidToken = null;
let tracksolidTokenExpiresAt = null;
let lastTracksolidPollTime = null;
let lastTracksolidPollStatus = 'No runs yet';
let lastTracksolidForwardStatus = 'No runs yet';

// GPS Server Polling Engine Settings
const GPSSERVER_POLL_CLIENTS = process.env.GPSSERVER_POLL_CLIENTS;
const GPSSERVER_POLL_INTERVAL = parseInt(process.env.GPSSERVER_POLL_INTERVAL || '60000', 10);
const GPSSERVER_API_URL = process.env.GPSSERVER_API_URL || 'http://gsh7.net/id39/api/api.php';

// GPS Server Poller Diagnostics State
let lastGpsServerPollTime = null;
let lastGpsServerPollStatus = 'No runs yet';

// Import Strategy Classes
const ColunStrategy = require('./integrations/colun');
const AraucoStrategy = require('./integrations/arauco');
const MelonStrategy = require('./integrations/melon');
const FalabellaStrategy = require('./integrations/falabella');
const CencosudStrategy = require('./integrations/cencosud');
const WalmartStrategy = require('./integrations/walmart');
const MercadoLibreStrategy = require('./integrations/mercadolibre');
const SmuStrategy = require('./integrations/smu');
const AgrosuperStrategy = require('./integrations/agrosuper');
const CcuStrategy = require('./integrations/ccu');
const AmazonStrategy = require('./integrations/amazon');
const DhlStrategy = require('./integrations/dhl');
const AvlChileStrategy = require('./integrations/avlchile');

// Initialize strategy mapping
const strategies = {
  colun: new ColunStrategy(),
  arauco: new AraucoStrategy(),
  melon: new MelonStrategy(),
  unigis: new MelonStrategy(), // Alias for melon
  falabella: new FalabellaStrategy(),
  cencosud: new CencosudStrategy(),
  walmart: new WalmartStrategy(),
  mercadolibre: new MercadoLibreStrategy(),
  meli: new MercadoLibreStrategy(), // Alias for mercadolibre
  smu: new SmuStrategy(),
  agrosuper: new AgrosuperStrategy(),
  ccu: new CcuStrategy(),
  amazon: new AmazonStrategy(),
  dhl: new DhlStrategy(),
  avlchile: new AvlChileStrategy()
};

const app = express();
const PORT = process.env.PORT || 3001;

app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

/**
 * Simple Basic Authentication middleware to protect the dashboard
 */
function basicAuth(req, res, next) {
  // Allow public access to webhooks and health checks
  if (req.path.startsWith('/webhook/') || req.path === '/health') {
    return next();
  }

  const authHeader = req.headers.authorization;
  if (!authHeader) {
    res.setHeader('WWW-Authenticate', 'Basic realm="Vikar B2B Dashboard"');
    return res.status(401).send('Authentication required.');
  }

  try {
    const auth = Buffer.from(authHeader.split(' ')[1], 'base64').toString().split(':');
    const user = auth[0];
    const pass = auth[1];

    if (user === 'admin' && pass === 'vikar1247') {
      return next();
    }
  } catch (err) {
    console.error('Error parsing auth header:', err.message);
  }

  res.setHeader('WWW-Authenticate', 'Basic realm="Vikar B2B Dashboard"');
  return res.status(401).send('Invalid credentials.');
}

// Protect the dashboard using basic authentication
app.use(basicAuth);

// Serve static dashboard files from the public folder
app.use(express.static(path.join(__dirname, 'public')));

// Log incoming requests
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

/**
 * Loads device configuration dynamically.
 */
function getDeviceConfig(imei) {
  try {
    const filePath = path.join(__dirname, 'config', 'devices.json');
    if (!fs.existsSync(filePath)) {
      return null;
    }
    const data = fs.readFileSync(filePath, 'utf8');
    const config = JSON.parse(data);
    return config[imei] || null;
  } catch (error) {
    console.error('Error reading devices.json mapping:', error.message);
    return null;
  }
}

/**
 * Health check endpoint
 */
app.get('/health', (req, res) => {
  res.json({
    status: 'OK',
    service: 'integraciones-vikar',
    version: '1.0.2-query-fix',
    pattern: 'Strategy',
    time: new Date().toISOString(),
    config: {
      gpsServerUrl: GPS_SERVER_URL,
      targetImeis: TRACKSOLID_IMEIS,
      pollIntervalMs: TRACKSOLID_POLL_INTERVAL
    },
    tracksolidPoller: {
      active: !!(TRACKSOLID_USER_ID && TRACKSOLID_APP_KEY && TRACKSOLID_APP_SECRET && TRACKSOLID_USER_PWD_MD5 && TRACKSOLID_IMEIS),
      hasToken: !!cachedTracksolidToken,
      lastPollTime: lastTracksolidPollTime,
      lastPollStatus: lastTracksolidPollStatus,
      lastForwardStatus: lastTracksolidForwardStatus
    },
    gpsServerPoller: {
      active: !!(GPSSERVER_POLL_CLIENTS),
      clients: GPSSERVER_POLL_CLIENTS,
      intervalMs: GPSSERVER_POLL_INTERVAL,
      lastPollTime: lastGpsServerPollTime,
      lastPollStatus: lastGpsServerPollStatus
    }
  });
});

/**
 * Resolves credentials and configuration dynamically based on the target integration and client query params.
 */
function getDynamicIntegrationConfig(target, client) {
  const config = { enabled: true };
  const suffix = client ? `_${client.toUpperCase()}` : '';

  if (target === 'colun') {
    config.endpoint = process.env[`COLUN_API_URL${suffix}`] || process.env.COLUN_API_URL;
    config.token = process.env[`COLUN_BEARER_TOKEN${suffix}`] || process.env.COLUN_BEARER_TOKEN;
  } else if (target === 'arauco') {
    config.endpoint = process.env[`ARAUCO_API_URL${suffix}`] || process.env.ARAUCO_API_URL;
    config.provider = process.env[`ARAUCO_PROVIDER_NAME${suffix}`] || process.env.ARAUCO_PROVIDER_NAME;
    config.nom_flota = process.env[`ARAUCO_NOM_FLOTA${suffix}`] || process.env.ARAUCO_NOM_FLOTA;
    config.cod_flota = process.env[`ARAUCO_COD_FLOTA${suffix}`] || process.env.ARAUCO_COD_FLOTA;
  } else if (target === 'melon' || target === 'unigis') {
    config.endpoint = process.env[`UNIGIS_API_URL${suffix}`] || process.env[`MELON_API_URL${suffix}`] || process.env.UNIGIS_API_URL;
    config.user = process.env[`UNIGIS_SYSTEM_USER${suffix}`] || process.env[`MELON_USER${suffix}`] || process.env.UNIGIS_SYSTEM_USER;
    config.password = process.env[`UNIGIS_PASSWORD${suffix}`] || process.env[`MELON_PASSWORD${suffix}`] || process.env.UNIGIS_PASSWORD;
  } else if (target === 'falabella') {
    config.endpoint = process.env[`FALABELLA_API_URL${suffix}`] || process.env.FALABELLA_API_URL;
    config.user = process.env[`FALABELLA_USER${suffix}`] || process.env.FALABELLA_USER;
    config.password = process.env[`FALABELLA_PASSWORD${suffix}`] || process.env.FALABELLA_PASSWORD;
  } else if (target === 'cencosud') {
    config.endpoint = process.env[`CENCOSUD_API_URL${suffix}`] || process.env.CENCOSUD_API_URL;
    config.api_key = process.env[`CENCOSUD_API_KEY${suffix}`] || process.env.CENCOSUD_API_KEY;
  } else if (target === 'mercadolibre' || target === 'meli') {
    config.endpoint = process.env[`MERCADOLIBRE_API_URL${suffix}`] || process.env.MERCADOLIBRE_API_URL;
    config.token = process.env[`MERCADOLIBRE_BEARER_TOKEN${suffix}`] || process.env.MERCADOLIBRE_BEARER_TOKEN;
  } else if (target === 'walmart') {
    config.endpoint = process.env[`WALMART_API_URL${suffix}`] || process.env.WALMART_API_URL;
    config.client_id = process.env[`WALMART_CLIENT_ID${suffix}`] || process.env.WALMART_CLIENT_ID;
    config.client_secret = process.env[`WALMART_CLIENT_SECRET${suffix}`] || process.env.WALMART_CLIENT_SECRET;
  } else if (target === 'smu') {
    config.endpoint = process.env[`SMU_API_URL${suffix}`] || process.env.SMU_API_URL;
    config.token = process.env[`SMU_API_TOKEN${suffix}`] || process.env.SMU_API_TOKEN;
  } else if (target === 'agrosuper') {
    config.endpoint = process.env[`AGROSUPER_API_URL${suffix}`] || process.env.AGROSUPER_API_URL;
    config.api_key = process.env[`AGROSUPER_API_KEY${suffix}`] || process.env.AGROSUPER_API_KEY;
  } else if (target === 'ccu') {
    config.endpoint = process.env[`CCU_API_URL${suffix}`] || process.env.CCU_API_URL;
    config.token = process.env[`CCU_BEARER_TOKEN${suffix}`] || process.env.CCU_BEARER_TOKEN;
  } else if (target === 'amazon') {
    config.endpoint = process.env[`AMAZON_API_URL${suffix}`] || process.env.AMAZON_API_URL;
    config.token = process.env[`AMAZON_ACCESS_TOKEN${suffix}`] || process.env.AMAZON_ACCESS_TOKEN;
  } else if (target === 'dhl') {
    config.endpoint = process.env[`DHL_API_URL${suffix}`] || process.env.DHL_API_URL;
    config.api_key = process.env[`DHL_API_KEY${suffix}`] || process.env.DHL_API_KEY;
  } else if (target === 'avlchile') {
    config.endpoint = process.env[`AVLCHILE_API_URL${suffix}`] || process.env.AVLCHILE_API_URL;
    config.token = process.env[`AVLCHILE_TOKEN${suffix}`] || process.env.AVLCHILE_TOKEN;
  }
  return config;
}


/**
 * Unified endpoint for GPS Server webhook (GET and POST support)
 */
async function handleGpsServerWebhook(req, res) {
  // Combine parameters from GET and POST requests
  const telemetry = { ...req.query, ...req.body };

  const imei = telemetry.imei;
  if (!imei) {
    console.log('Received connection ping or request without IMEI.');
    return res.status(200).send('ok');
  }

  console.log(`\n======================================================`);
  console.log(`[Webhook] New telemetry update for IMEI: ${imei}`);
  console.log('Telemetry details:', telemetry);

  // Check query parameters for explicit target routing first (Dynamic Zero-Code Administration)
  let targetParam = req.query.target;
  let clientParam = req.query.client;

  // Clean up any incorrectly appended query string parameters from GPS Server (e.g. client=luisherrera?username=trans.herrera)
  if (targetParam && targetParam.includes('?')) {
    targetParam = targetParam.split('?')[0];
  }
  if (clientParam && clientParam.includes('?')) {
    clientParam = clientParam.split('?')[0];
  }

  let targets = [];
  let deviceConfig = null;
  let dynamicConfigs = {};

  if (targetParam) {
    const target = targetParam.toLowerCase();
    if (strategies[target]) {
      console.log(`[Router] Dynamic webhook routing triggered. Target: ${target}, Client: ${clientParam || 'default'}`);
      targets = [target];
      deviceConfig = {
        plate: telemetry.plate_number || telemetry.plate || 'SIN_PATENTE',
        carrier: telemetry.carrier || 'VIKARGPS'
      };
      dynamicConfigs[target] = getDynamicIntegrationConfig(target, clientParam);
    } else {
      console.warn(`[Router] Dynamic routing requested unknown target: ${targetParam}`);
    }
  }

  // Fallback to config/devices.json if no target was resolved dynamically
  if (targets.length === 0) {
    const staticConfig = getDeviceConfig(imei);
    if (!staticConfig || !staticConfig.integrations) {
      console.log(`[Router] No B2B integrations mapped for IMEI: ${imei}. Skipping.`);
      console.log(`======================================================`);
      return res.status(200).send('ok');
    }
    deviceConfig = staticConfig;
    targets = Object.keys(staticConfig.integrations);
    console.log(`[Router] Found static integrations for ${deviceConfig.plate}:`, targets);
  }

  // Execute integrations concurrently using their Strategy classes
  const promises = targets.map(async (target) => {
    const integrationConfig = dynamicConfigs[target] || (deviceConfig.integrations && deviceConfig.integrations[target]);
    
    // Check if integration is explicitly enabled
    if (!integrationConfig || integrationConfig.enabled !== true) {
      console.log(`[Router] Integration '${target}' is disabled for device ${imei}.`);
      return;
    }

    const strategy = strategies[target];
    if (!strategy) {
      console.warn(`[Router] Warning: No strategy implemented for target '${target}'`);
      return;
    }

    try {
      console.log(`[Router] Executing strategy for B2B target: '${target}'`);
      await strategy.execute(telemetry, deviceConfig, integrationConfig);
    } catch (err) {
      console.error(`[Router] Error executing strategy '${target}':`, err.message);
    }
  });

  // Await dispatching to all platforms
  await Promise.all(promises);

  console.log(`[Router] Telemetry B2B routing complete.`);
  console.log(`======================================================`);

  res.send('ok'); // Always respond 'ok' to GPS Server
}

app.get('/webhook/gps-server', handleGpsServerWebhook);
app.post('/webhook/gps-server', handleGpsServerWebhook);



/**
 * Standard incoming endpoint for third-party GPS providers.
 * Translates and forwards external telemetry JSON to GPS Server (gsh7.net).
 */
app.post('/webhook/incoming-gps', async (req, res) => {
  try {
    const apiKey = req.headers['x-api-key'] || req.query.api_key;
    const expectedKey = process.env.INCOMING_API_KEY || 'vikar_incoming_secure_key_2026';

    if (apiKey !== expectedKey) {
      console.warn(`[Incoming GPS] Unauthorized access attempt with API Key: ${apiKey}`);
      return res.status(401).json({ success: false, error: 'Unauthorized. Invalid API Key.' });
    }

    const { imei, plate, lat, lng, speed, angle, dt, ignition, params } = req.body;

    if (!imei || lat === undefined || lng === undefined) {
      return res.status(400).json({ success: false, error: 'Missing required fields: imei, lat, lng' });
    }

    // Determine ignition value (ACC)
    let accVal = 0;
    if (ignition === true || ignition === 1 || String(ignition).toUpperCase() === 'ON' || String(ignition).toUpperCase() === '1') {
      accVal = 1;
    }

    // Build params string
    let paramsStr = `acc=${accVal}|`;
    if (params) {
      paramsStr += params;
    }

    // Prepare parameters for gsh7.net
    const gpsParams = {
      imei: imei,
      plate: plate || '',
      lat: Number(lat).toFixed(6),
      lng: Number(lng).toFixed(6),
      speed: Number(speed || 0),
      angle: Number(angle || 0),
      dt: dt || new Date().toISOString().replace('T', ' ').substring(0, 19),
      loc_valid: 1,
      altitude: 0,
      params: paramsStr
    };

    const targetUrl = process.env.GPS_SERVER_URL || 'http://gsh7.net/id39/api/api_loc.php';
    console.log(`[Incoming GPS] Forwarding telemetry for ${plate || imei} to GPS Server: ${targetUrl}`);
    
    const response = await axios.get(targetUrl, { 
      params: gpsParams,
      timeout: 8000
    });

    console.log(`[Incoming GPS] GPS Server Response:`, response.data);

    res.json({ 
      success: true, 
      message: 'Telemetry received and forwarded successfully', 
      serverResponse: response.data 
    });
  } catch (error) {
    console.error('[Incoming GPS] Error forwarding telemetry:', error.message);
    res.status(500).json({ success: false, error: 'Internal server error: ' + error.message });
  }
});

/**
 * Helper to format date in yyyy-MM-dd HH:mm:ss format (UTC)
 */
function getUtcTimestamp() {
  const now = new Date();
  const yyyy = now.getUTCFullYear();
  const MM = String(now.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(now.getUTCDate()).padStart(2, '0');
  const hh = String(now.getUTCHours()).padStart(2, '0');
  const mm = String(now.getUTCMinutes()).padStart(2, '0');
  const ss = String(now.getUTCSeconds()).padStart(2, '0');
  return `${yyyy}-${MM}-${dd} ${hh}:${mm}:${ss}`;
}

/**
 * Common formatting and forwarding logic to GPS Server
 */
async function forwardTelemetryToGpsServer(payload, msgType = null) {
  let gpsParams = {
    imei: payload.imei,
    altitude: 0,
    loc_valid: 1
  };

  // Case 1: Alarm Push Event (jimi.push.device.alarm)
  if (msgType === 'jimi.push.device.alarm' || payload.alarmType !== undefined) {
    const alarmTypeStr = String(payload.alarmType || '');
    const isAccOff = alarmTypeStr === '1001' || String(payload.originalAlarmType).toUpperCase() === 'ACC_OFF';
    const isAccOn = alarmTypeStr === '1002' || String(payload.originalAlarmType).toUpperCase() === 'ACC_ON';
    
    let mappedEvent = 'alert';
    let accVal = 0;

    if (isAccOff) {
      mappedEvent = 'ignition_off';
      accVal = 0;
    } else if (isAccOn) {
      mappedEvent = 'ignition_on';
      accVal = 1;
    } else if (alarmTypeStr === '1') {
      mappedEvent = 'sos';
    } else if (alarmTypeStr === '2') {
      mappedEvent = 'pwrcut';
    } else if (alarmTypeStr === '14') {
      mappedEvent = 'lowdc';
    } else if (alarmTypeStr === '15') {
      mappedEvent = 'lowbat';
    } else if (alarmTypeStr === '20') {
      mappedEvent = 'door';
    } else if (alarmTypeStr === '41') {
      mappedEvent = 'haccel';
    } else if (alarmTypeStr === '48') {
      mappedEvent = 'hbrake';
    }

    gpsParams.dt = payload.alarmTime || new Date().toISOString().replace('T', ' ').substring(0, 19);
    gpsParams.lat = Number(payload.lat || 0).toFixed(6);
    gpsParams.lng = Number(payload.lng || 0).toFixed(6);
    gpsParams.speed = Number(payload.speed || 0);
    gpsParams.angle = Number(payload.direction || 0);
    gpsParams.event = mappedEvent;
    gpsParams.params = `acc=${accVal}|alarm_type=${alarmTypeStr}|alarm_name=${payload.alarmName || ''}|`;

  // Case 2: Standard Location telemetry
  } else {
    const isAccOn = payload.accStatus === '1' || payload.accStatus === 1 || String(payload.ignition).toUpperCase() === 'ON';
    const accVal = isAccOn ? 1 : 0;
    const batpVal = (payload.electQuantity !== undefined && payload.electQuantity !== null && payload.electQuantity !== '') ? payload.electQuantity : null;
    const powerVal = (payload.powerValue !== undefined && payload.powerValue !== null && payload.powerValue !== '') ? payload.powerValue : null;

    let paramsStr = `acc=${accVal}|`;
    if (batpVal !== null) {
      paramsStr += `batp=${batpVal}|`;
    }
    if (powerVal !== null) {
      paramsStr += `voltage=${powerVal}|`;
    }

    gpsParams.dt = payload.gpsTime || payload.hbTime || new Date().toISOString().replace('T', ' ').substring(0, 19);
    gpsParams.lat = Number(payload.lat || 0).toFixed(6);
    gpsParams.lng = Number(payload.lng || 0).toFixed(6);
    gpsParams.speed = Number(payload.speed || 0);
    gpsParams.angle = Number(payload.direction || 0);
    gpsParams.event = null;
    gpsParams.params = paramsStr;
  }

  console.log(`Forwarding to GPS Server: ${GPS_SERVER_URL}`, gpsParams);
  try {
    const response = await axios.get(GPS_SERVER_URL, { params: gpsParams, timeout: 5000 });
    console.log('GPS Server Response:', response.data);
    const respStr = typeof response.data === 'object' ? JSON.stringify(response.data) : response.data;
    lastTracksolidForwardStatus = `Success: GPS Server replied "${respStr}" at ${new Date().toISOString()}`;
  } catch (err) {
    console.error('GPS Server forward failed:', err.message);
    lastTracksolidForwardStatus = `Failed: ${err.message} at ${new Date().toISOString()}`;
    throw err;
  }
}

/**
 * Tracksolid Token Retriever (handles credentials & caches token)
 */
async function getTracksolidToken() {
  const now = Date.now();
  if (cachedTracksolidToken && tracksolidTokenExpiresAt && now < tracksolidTokenExpiresAt) {
    return cachedTracksolidToken;
  }

  console.log('[Tracksolid API] Fetching new access token...');
  const timestamp = getUtcTimestamp();
  
  const commonParams = {
    method: 'jimi.oauth.token.get',
    timestamp: timestamp,
    app_key: TRACKSOLID_APP_KEY,
    sign_method: 'md5',
    v: '1.0',
    format: 'json'
  };

  const privateParams = {
    user_id: TRACKSOLID_USER_ID,
    user_pwd_md5: TRACKSOLID_USER_PWD_MD5,
    expires_in: 7200
  };

  const allParams = { ...commonParams, ...privateParams };
  const sign = computeSignature(allParams, TRACKSOLID_APP_SECRET);
  
  const queryParams = { ...commonParams, sign };
  const queryStr = new URLSearchParams(queryParams).toString();
  const bodyStr = new URLSearchParams(privateParams).toString();

  try {
    const res = await axios.post(`${TRACKSOLID_API_URL}?${queryStr}`, bodyStr, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    });

    if (res.data && res.data.code === 0 && res.data.result) {
      cachedTracksolidToken = res.data.result.accessToken;
      const expiresInSec = parseInt(res.data.result.expiresIn || '7200', 10);
      tracksolidTokenExpiresAt = Date.now() + (expiresInSec - 600) * 1000;
      console.log(`[Tracksolid API] Token cached successfully. Expires in ${expiresInSec}s.`);
      return cachedTracksolidToken;
    } else {
      const errorMsg = res.data ? res.data.message : 'Unknown error';
      const errorCode = res.data ? res.data.code : -1;
      throw new Error(`Failed to get token (Code: ${errorCode}, Msg: ${errorMsg})`);
    }
  } catch (err) {
    console.error('[Tracksolid API] Error retrieving token:', err.message);
    throw err;
  }
}

/**
 * Poll location updates for configured IMEIs
 */
async function pollTracksolidLocations() {
  lastTracksolidPollTime = new Date().toISOString();
  try {
    const token = await getTracksolidToken();
    const matches = (TRACKSOLID_IMEIS || '').match(/\d{14,16}/g);
    const imeisList = matches ? matches : [];
    
    if (imeisList.length === 0) {
      console.warn('[Tracksolid Poller] No valid IMEIs (14-16 digits) found in TRACKSOLID_IMEIS.');
      lastTracksolidPollStatus = 'Warning: No valid IMEIs found in configuration at ' + new Date().toISOString();
      return;
    }
    
    console.log(`[Tracksolid Poller] Fetching locations for ${imeisList.length} devices...`);

    const timestamp = getUtcTimestamp();
    const commonParams = {
      method: 'jimi.device.location.get',
      timestamp: timestamp,
      app_key: TRACKSOLID_APP_KEY,
      sign_method: 'md5',
      v: '1.0',
      format: 'json',
      access_token: token
    };

    const privateParams = {
      imeis: imeisList.join(',')
    };

    const allParams = { ...commonParams, ...privateParams };
    const sign = computeSignature(allParams, TRACKSOLID_APP_SECRET);
    
    const queryParams = { ...commonParams, sign };
    const queryStr = new URLSearchParams(queryParams).toString();
    const bodyStr = new URLSearchParams(privateParams).toString();

    const res = await axios.post(`${TRACKSOLID_API_URL}?${queryStr}`, bodyStr, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    });

    if (res.data && res.data.code === 0 && res.data.result) {
      const devices = Array.isArray(res.data.result) ? res.data.result : [res.data.result];
      console.log(`[Tracksolid Poller] Successfully retrieved ${devices.length} locations.`);
      lastTracksolidPollStatus = `Success: retrieved ${devices.length} locations at ${new Date().toISOString()}`;

      for (const device of devices) {
        if (!device || !device.imei) continue;
        console.log(`[Tracksolid Poller] Processing location for IMEI ${device.imei}`);
        await forwardTelemetryToGpsServer(device);
      }
    } else {
      const code = res.data ? res.data.code : -1;
      const msg = res.data ? res.data.message : 'Unknown error';
      console.warn(`[Tracksolid Poller] API warning (Code: ${code}, Msg: ${msg})`);
      lastTracksolidPollStatus = `API Warning: Code ${code}, Msg: ${msg} at ${new Date().toISOString()}`;
      
      if (code === 1004 || String(msg).toLowerCase().includes('token')) {
        console.log('[Tracksolid Poller] Token error detected. Invalidating cached token.');
        cachedTracksolidToken = null;
        tracksolidTokenExpiresAt = null;
      }
    }
  } catch (err) {
    console.error('[Tracksolid Poller] Polling cycle failed:', err.message);
    lastTracksolidPollStatus = `Failed: ${err.message} at ${new Date().toISOString()}`;
  }
}

/**
 * Poll location updates for configured GPS Server clients and forward them to B2B targets
 */
async function pollGpsServerLocations() {
  lastGpsServerPollTime = new Date().toISOString();
  if (!GPSSERVER_POLL_CLIENTS) {
    lastGpsServerPollStatus = 'Disabled: GPSSERVER_POLL_CLIENTS is not configured';
    return;
  }

  const clientsList = GPSSERVER_POLL_CLIENTS.split(',').map(c => c.trim()).filter(Boolean);
  if (clientsList.length === 0) {
    lastGpsServerPollStatus = 'Disabled: Empty client list';
    return;
  }

  console.log(`[GPS Server Poller] Starting poll cycle for clients: ${clientsList.join(', ')}`);
  let successCount = 0;
  let totalDevicesProcessed = 0;

  for (const client of clientsList) {
    const apiKeyEnvName = `GPSSERVER_API_KEY_${client.toUpperCase()}`;
    const apiKey = process.env[apiKeyEnvName];

    if (!apiKey) {
      console.warn(`[GPS Server Poller] Missing API Key environment variable: ${apiKeyEnvName}`);
      continue;
    }

    try {
      console.log(`[GPS Server Poller] Querying locations for client '${client}'...`);
      const response = await axios.get(GPSSERVER_API_URL, {
        params: {
          api: 'user',
          key: apiKey,
          cmd: 'OBJECT_GET_LOCATIONS,*'
        },
        timeout: 15000
      });

      if (response.data && typeof response.data === 'object') {
        const devices = response.data;
        const imeis = Object.keys(devices);
        console.log(`[GPS Server Poller] Client '${client}' returned ${imeis.length} devices.`);
        
        for (const imei of imeis) {
          const device = devices[imei];
          if (!device) continue;

          totalDevicesProcessed++;
          
          // Get B2B config for this device from config/devices.json
          const deviceConfig = getDeviceConfig(imei);
          if (!deviceConfig || !deviceConfig.integrations) {
            // Not configured for B2B forwarding, skip
            continue;
          }

          // Format telemetry to match what strategies expect
          const telemetry = {
            imei: imei,
            name: device.name,
            lat: device.lat,
            lng: device.lng,
            altitude: device.altitude || 0,
            angle: device.angle || 0,
            speed: device.speed || 0,
            dt_tracker: device.dt_tracker,
            dt_server: device.dt_server,
            loc_valid: device.loc_valid,
            odometer: device.odometer,
            engine_hours: device.engine_hours,
            params: device.params // Can be JSON object directly since we upgraded parseParams
          };

          const targets = Object.keys(deviceConfig.integrations);
          
          // Process integrations
          for (const target of targets) {
            const integrationConfig = deviceConfig.integrations[target];
            if (!integrationConfig || integrationConfig.enabled !== true) {
              continue;
            }

            const strategy = strategies[target];
            if (!strategy) {
              console.warn(`[GPS Server Poller] No strategy implemented for target '${target}'`);
              continue;
            }

            try {
              // Resolve token and endpoint (checking for environment overrides for this client)
              const resolvedConfig = getDynamicIntegrationConfig(target, integrationConfig.client || client);
              
              console.log(`[GPS Server Poller] Forwarding ${device.name || imei} (${deviceConfig.plate}) to target: '${target}' (Client config: ${integrationConfig.client || client})`);
              await strategy.execute(telemetry, deviceConfig, resolvedConfig);
            } catch (err) {
              console.error(`[GPS Server Poller] Error forwarding device ${imei} to ${target}:`, err.message);
            }
          }
        }
        successCount++;
      } else {
        console.warn(`[GPS Server Poller] Invalid response format for client '${client}':`, response.data);
      }
    } catch (err) {
      console.error(`[GPS Server Poller] Failed polling client '${client}':`, err.message);
    }
  }

  lastGpsServerPollStatus = `Success: polled ${successCount}/${clientsList.length} clients, processed ${totalDevicesProcessed} total devices at ${new Date().toISOString()}`;
}

/**
 * Middleware to verify Tracksolid signature
 */
function requireTracksolidSignature(req, res, next) {
  const hasParams = Object.keys(req.query).length > 0 || Object.keys(req.body).length > 0;
  if (!hasParams) {
    return res.status(200).json({ code: 0, message: 'success' });
  }

  const incomingSign = req.query.sign || req.body.sign || req.headers['x-sign'] || req.headers['sign'];
  if (!incomingSign) {
    console.log('[Signature Warning] Missing signature on push, proceeding anyway.');
    return next();
  }

  if (!verifySignature(req, TRACKSOLID_APP_SECRET)) {
    console.warn(`[Signature Failed] Unauthorized request to ${req.path}`);
    return res.status(401).json({
      code: 1004,
      message: 'Illegal access, token exception! (Invalid signature)'
    });
  }
  next();
}

/**
 * Unified request handler for both Tracksolid Webhooks
 */
async function handleTracksolidPush(req, res) {
  try {
    const { msgType, data } = req.body;

    if (!msgType || !data) {
      console.log('Received empty payload/verification ping on POST.');
      return res.status(200).json({ code: 0, message: 'success' });
    }

    const payload = typeof data === 'string' ? JSON.parse(data) : data;
    console.log(`\n--- New Telemetry Push (Type: ${msgType}) ---`);
    console.log('Payload:', payload);

    await forwardTelemetryToGpsServer(payload, msgType);

    res.json({ code: 0, message: 'Telemetry forwarded successfully' });
  } catch (error) {
    console.error('Error handling webhook push:', error.message);
    res.status(500).json({ code: -1, message: 'Internal server error: ' + error.message });
  }
}

// Tracksolid Push Routes
app.get('/webhook/alarm', (req, res) => {
  console.log('Received GET verification ping on /webhook/alarm');
  res.status(200).json({ code: 0, message: 'success' });
});

app.get('/webhook/location', (req, res) => {
  console.log('Received GET verification ping on /webhook/location');
  res.status(200).json({ code: 0, message: 'success' });
});

app.post('/webhook/alarm', requireTracksolidSignature, handleTracksolidPush);
app.post('/webhook/location', requireTracksolidSignature, handleTracksolidPush);

app.listen(PORT, () => {
  console.log(`===========================================================`);
  console.log(`VIKAR B2B Integrations Middleware running on port ${PORT}`);
  console.log(`Active configuration mappings read from config/devices.json`);
  
  // Start Tracksolid Polling Engine if credentials are provided
  if (TRACKSOLID_USER_ID && TRACKSOLID_APP_KEY && TRACKSOLID_APP_SECRET && TRACKSOLID_USER_PWD_MD5 && TRACKSOLID_IMEIS) {
    console.log(`[Polling Engine] Starting background location polling loop.`);
    console.log(`[Polling Engine] Interval: ${TRACKSOLID_POLL_INTERVAL}ms`);
    console.log(`[Polling Engine] Target IMEIs: ${TRACKSOLID_IMEIS}`);
    
    // Run immediately on startup, then every interval
    pollTracksolidLocations();
    setInterval(pollTracksolidLocations, TRACKSOLID_POLL_INTERVAL);
  } else {
    console.log(`[Polling Engine] Disabled (missing one or more TRACKSOLID_* env variables).`);
  }

  // Start GPS Server Polling Engine if clients are configured
  if (GPSSERVER_POLL_CLIENTS) {
    console.log(`[GPS Server Poller] Starting background location polling loop.`);
    console.log(`[GPS Server Poller] Interval: ${GPSSERVER_POLL_INTERVAL}ms`);
    console.log(`[GPS Server Poller] Active Clients: ${GPSSERVER_POLL_CLIENTS}`);
    
    // Run immediately on startup, then every interval
    pollGpsServerLocations();
    setInterval(pollGpsServerLocations, GPSSERVER_POLL_INTERVAL);
  } else {
    console.log(`[GPS Server Poller] Disabled (GPSSERVER_POLL_CLIENTS is not configured).`);
  }
  console.log(`===========================================================`);
});
