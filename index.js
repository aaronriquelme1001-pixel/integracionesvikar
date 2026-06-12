require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { verifySignature, computeSignature } = require('./utils/signature');

// ==============================================
// 💾 MEMORIA PERSISTENTE (Inmunidad a Reinicios)
// ==============================================
const STATE_FILE = path.join(__dirname, 'data', 'state.json');

let deviceAntiSpamState = {};
let lastDeviceTimestamps = {};

try {
  if (!fs.existsSync(path.dirname(STATE_FILE))) {
    fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  }
  if (fs.existsSync(STATE_FILE)) {
    const rawData = fs.readFileSync(STATE_FILE, 'utf8');
    const parsedData = JSON.parse(rawData);
    deviceAntiSpamState = parsedData.deviceAntiSpamState || {};
    lastDeviceTimestamps = parsedData.lastDeviceTimestamps || {};
    console.log(`[Persistencia] Memoria restaurada exitosamente. AntiSpam keys: ${Object.keys(deviceAntiSpamState).length}`);
  }
} catch (err) {
  console.error(`[Persistencia] Error cargando memoria:`, err.message);
}

// Guardar memoria cada 1 minuto
setInterval(() => {
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify({ deviceAntiSpamState, lastDeviceTimestamps }), 'utf8');
  } catch (err) {
    console.error(`[Persistencia] Error guardando memoria:`, err.message);
  }
}, 60000);
// ==============================================

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
const GPSSERVER_POLL_TRACCAR_CLIENTS = process.env.GPSSERVER_POLL_TRACCAR_CLIENTS;
const GPSSERVER_POLL_INTERVAL = parseInt(process.env.GPSSERVER_POLL_INTERVAL || '60000', 10);
const GPSSERVER_API_URL = process.env.GPSSERVER_API_URL || 'http://gsh7.net/id39/api/api.php';
const GPSSERVER_POLL_ENABLED = (process.env.GPSSERVER_POLL_ENABLED || 'true').toLowerCase() !== 'false';

// Ingest endpoint security
const INGEST_SECRET = process.env.INTEGRACIONES_WEBHOOK_SECRET || 'vikar_ingest_2026';

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
const TraccarStrategy = require('./integrations/traccar');

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
  avlchile: new AvlChileStrategy(),
  traccar: new TraccarStrategy()
};

const app = express();
const PORT = process.env.PORT || 3001;

app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

/**
 * Simple Basic Authentication middleware to protect the dashboard
 */
function basicAuth(req, res, next) {
  // Allow public access to webhooks, health checks and ingest endpoint
  if (req.path.startsWith('/webhook/') || req.path === '/health' || req.path === '/ingest') {
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

function maskToken(token) {
  if (!token) return 'not set';
  if (token.length <= 8) return `*** (length ${token.length})`;
  return `${token.substring(0, 4)}...${token.substring(token.length - 4)} (length ${token.length})`;
}

/**
 * Health check endpoint
 */
app.get('/health', (req, res) => {
  res.json({
    status: 'OK',
    service: 'integraciones-vikar',
    version: '3.0.0-all-in-one',
    pattern: 'Unified Telemetry Gateway',
    time: new Date().toISOString(),
    architecture: {
      primaryServer: 'GPS Server (gsh7.net)',
      dataSource: 'Tracksolid API Poller + GPS Server Poller + /ingest push pipeline'
    },
    tracksolidPoller: {
      active: !!(TRACKSOLID_USER_ID && TRACKSOLID_APP_KEY && TRACKSOLID_APP_SECRET && TRACKSOLID_USER_PWD_MD5 && TRACKSOLID_IMEIS),
      hasToken: !!cachedTracksolidToken,
      lastPollTime: lastTracksolidPollTime,
      lastPollStatus: lastTracksolidPollStatus,
      lastForwardStatus: lastTracksolidForwardStatus
    },
    gpsServerPoller: {
      enabled: GPSSERVER_POLL_ENABLED,
      active: !!(GPSSERVER_POLL_CLIENTS),
      clients: GPSSERVER_POLL_CLIENTS,
      intervalMs: GPSSERVER_POLL_INTERVAL,
      lastPollTime: lastGpsServerPollTime,
      lastPollStatus: lastGpsServerPollStatus
    },
    avlchileDiagnostics: {
      AVLCHILE_API_URL: process.env.AVLCHILE_API_URL || 'not set',
      AVLCHILE_TOKEN_LUISHERRERA: maskToken(process.env.AVLCHILE_TOKEN_LUISHERRERA),
      AVLCHILE_TOKEN_ALIRORIOS: maskToken(process.env.AVLCHILE_TOKEN_ALIRORIOS),
      AVLCHILE_TOKEN: maskToken(process.env.AVLCHILE_TOKEN)
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
  } else if (target === 'traccar') {
    config.endpoint = process.env[`TRACCAR_API_URL${suffix}`] || process.env.TRACCAR_API_URL;
    config.idType = process.env[`TRACCAR_ID_TYPE${suffix}`] || process.env.TRACCAR_ID_TYPE;
  }
  return config;
}


/**
 * Unified endpoint for GPS Server webhook (GET and POST support)
 */
async function handleGpsServerWebhook(req, res) {
  systemStats.totalWebhooksProcessed++;
  const telemetryObj = { ...req.query, ...req.body };
  const imei = telemetryObj.imei;
  if (!imei) {
    return res.status(200).send('ok');
  }

  let targetParam = req.query.target;
  let clientParam = req.query.client || telemetryObj.client;

  if (targetParam && targetParam.includes('?')) targetParam = targetParam.split('?')[0];
  if (clientParam && clientParam.includes('?')) clientParam = clientParam.split('?')[0];

  const telemetry = {
    imei: String(imei),
    plate_number: telemetryObj.plate_number || telemetryObj.plate,
    name: telemetryObj.name,
    dt_tracker: telemetryObj.dt || null,
    dt_server: telemetryObj.dt || null,
    lat: telemetryObj.lat !== undefined ? String(telemetryObj.lat) : '0',
    lng: telemetryObj.lng !== undefined ? String(telemetryObj.lng) : '0',
    altitude: telemetryObj.altitude || 0,
    angle: telemetryObj.angle || 0,
    speed: telemetryObj.speed || 0,
    loc_valid: telemetryObj.loc_valid !== undefined ? telemetryObj.loc_valid : 1,
    params: telemetryObj.params || '',
    event: telemetryObj.event || null
  };

  await dispatchToB2B(telemetry, clientParam, targetParam);
  return res.status(200).send('ok');
}

app.get('/webhook/gps-server', handleGpsServerWebhook);
app.post('/webhook/gps-server', handleGpsServerWebhook);


/**
 * Core Stats object for monitoring
 */
const systemStats = {
  bootTime: new Date().toISOString(),
  totalWebhooksProcessed: 0,
  totalPolledPoints: 0,
  totalPointsDispatched: 0,
  backfillerTriggers: 0,
  backfillerRecoveredPoints: 0,
  lastDispatchTime: null
};

/**
 * Health Check & Live Dashboard Endpoint
 */
app.get('/health', (req, res) => {
  res.json({
    status: 'online',
    version: '2.0.0 (B2B Engine)',
    uptime_seconds: process.uptime(),
    stats: systemStats,
    activeDevicesInSpamFilter: Object.keys(deviceAntiSpamState).length,
    pollerMemoryKeys: Object.keys(lastDeviceTimestamps).length,
    retryQueueLength: retryQueue.length
  });
});

// deviceAntiSpamState ya fue declarado globalmente arriba
// ==============================================
// ♻️ COLA DE REINTENTOS (Tolerancia a fallos)
// ==============================================
const retryQueue = [];

setInterval(async () => {
  if (retryQueue.length === 0) return;
  const item = retryQueue.shift();
  
  if (item.retries > 10) {
     console.log(`[Retry Queue] ❌ Descartando carga para ${item.telemetry.imei} hacia ${item.target} tras 10 intentos fallidos.`);
     return;
  }
  
  console.log(`[Retry Queue] ♻️ Reintentando envío de ${item.telemetry.imei} hacia ${item.target} (Intento ${item.retries + 1})...`);
  const strategy = strategies[item.target];
  if (!strategy) return;
  
  try {
    await strategy.execute(item.telemetry, item.deviceConfig, item.resolvedConfig);
    console.log(`[Retry Queue] ✅ Reintento exitoso para ${item.telemetry.imei} hacia ${item.target}!`);
  } catch (err) {
    console.error(`[Retry Queue] ⚠️ Reintento fallido para ${item.telemetry.imei} hacia ${item.target}:`, err.message);
    item.retries++;
    retryQueue.push(item);
  }
}, 5000); // Procesa 1 item de la cola cada 5 segundos
// ==============================================

/**
 * Core B2B Dispatch Engine.
 * Takes normalized telemetry (mirrors GPS Server OBJECT_GET_LOCATIONS format)
 * and dispatches it to all B2B strategies configured for the device.
 */
async function dispatchToB2B(telemetry, clientName = null, explicitTarget = null) {
  const { imei } = telemetry;
  const nowMs = Date.now();
  const PARKED_HEARTBEAT_MS = 20 * 60 * 1000; // 20 minutes
  let shouldSend = true;

  // Filtro Inteligente Anti-Spam con Latido (Heartbeat) - Aplica a Poller y Webhooks
  if (telemetry.dt_tracker) {
    const state = deviceAntiSpamState[imei] || {};
    const timeSinceLastSend = nowMs - (state.lastSentAt || 0);

    if (state.dt_tracker === telemetry.dt_tracker) {
      if (timeSinceLastSend < PARKED_HEARTBEAT_MS) {
        shouldSend = false; // Bloquear spam
      } else {
        console.log(`[B2B Dispatch] Enviando latido de 20 minutos para estacionado: ${imei}`);
      }
    }
    
    if (shouldSend) {
      // Only update the anti-spam clock if the incoming point is chronologically newer
      if (!state.dt_tracker || telemetry.dt_tracker >= state.dt_tracker) {
        deviceAntiSpamState[imei] = {
          dt_tracker: telemetry.dt_tracker,
          lastSentAt: nowMs
        };
      }
    }
  }

  if (!shouldSend) return;

  // Look up device configuration from devices.json
  let deviceConfig = getDeviceConfig(imei);
  let activeStrategies = new Set();
  let strategyClients = {};

  // 1. Añadir integraciones estáticas de devices.json
  if (deviceConfig && deviceConfig.integrations) {
    for (const target of Object.keys(deviceConfig.integrations)) {
      if (deviceConfig.integrations[target] && deviceConfig.integrations[target].enabled) {
        activeStrategies.add(target);
        strategyClients[target] = deviceConfig.integrations[target].client;
      }
    }
  }

  // 2. Añadir integraciones dinámicas (Ruteo Zero-Code)
  if (clientName) {
    const clientLower = clientName.toLowerCase();
    for (const strategyName of Object.keys(strategies)) {
      const envVarName = `GPSSERVER_POLL_${strategyName.toUpperCase()}_CLIENTS`;
      const wildcardClients = (process.env[envVarName] || '').split(',').map(c => c.trim().toLowerCase()).filter(Boolean);
      
      if (wildcardClients.includes(clientLower)) {
        activeStrategies.add(strategyName);
        strategyClients[strategyName] = clientLower;
        
        if (!deviceConfig) {
          deviceConfig = {
            plate: telemetry.plate_number || telemetry.name || telemetry.plate || 'SIN_PATENTE',
            carrier: telemetry.carrier || 'VIKARGPS',
            integrations: {}
          };
        }
      }
    }
  }

  // 3. Añadir target explícito (URL Webhook con ?target=)
  if (explicitTarget && strategies[explicitTarget.toLowerCase()]) {
    const target = explicitTarget.toLowerCase();
    activeStrategies.add(target);
    strategyClients[target] = clientName || 'default';
    if (!deviceConfig) {
      deviceConfig = {
        plate: telemetry.plate_number || telemetry.name || telemetry.plate || 'SIN_PATENTE',
        carrier: telemetry.carrier || 'VIKARGPS',
        integrations: {}
      };
    }
  }

  if (activeStrategies.size === 0) return;

  systemStats.totalPointsDispatched++;
  systemStats.lastDispatchTime = new Date().toISOString();

  console.log(`[B2B Dispatch] Device: ${deviceConfig.plate || imei} — Routing to: ${Array.from(activeStrategies).join(', ')}`);

  const promises = Array.from(activeStrategies).map(async (target) => {
    const strategy = strategies[target];
    if (!strategy) return;

    const resolvedConfig = {
      ...getDynamicIntegrationConfig(target, strategyClients[target]),
      ...(deviceConfig.integrations && deviceConfig.integrations[target] ? deviceConfig.integrations[target] : { enabled: true, client: strategyClients[target] })
    };

    try {
      await strategy.execute(telemetry, deviceConfig, resolvedConfig);
    } catch (err) {
      console.error(`[B2B Dispatch] Error executing strategy '${target}':`, err.message);
      retryQueue.push({
        target,
        telemetry,
        deviceConfig,
        resolvedConfig,
        retries: 0
      });
    }
  });

  await Promise.all(promises);
}

/**
 * POST /ingest — Real-time telemetry ingestion from external sources (e.g. legacy nifty-hertz).
 *
 * Receives pre-normalized telemetry (same format as api_loc.php params)
 * and dispatches it to all B2B strategies configured for the device.
 *
 * Expected payload (JSON):
 * {
 *   imei, dt, lat, lng, speed, angle, altitude, loc_valid, params, event
 * }
 * where params is the GPS Server Location API format: "acc=1|batp=87|voltage=12.3|"
 */
app.post('/ingest', async (req, res) => {
  // Validate ingest secret
  const incomingSecret = req.headers['x-ingest-secret'];
  if (incomingSecret !== INGEST_SECRET) {
    console.warn(`[Ingest] Unauthorized request (bad or missing x-ingest-secret)`);
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }

  const { imei, dt, lat, lng, speed, angle, altitude, loc_valid, params, event } = req.body;

  if (!imei) {
    return res.status(400).json({ success: false, error: 'Missing required field: imei' });
  }

  console.log(`\n======================================================`);
  console.log(`[Ingest] New external real-time telemetry for IMEI: ${imei}`);
  console.log(`[Ingest] dt=${dt} lat=${lat} lng=${lng} speed=${speed} params=${params}`);

  // Parse "acc=1|batp=87|voltage=12.3|" into a key/value object
  // so strategies can access individual parameters by name
  const parsedParams = {};
  if (params && typeof params === 'string') {
    params.split('|').forEach(pair => {
      const eqIdx = pair.indexOf('=');
      if (eqIdx > 0) {
        const key = pair.substring(0, eqIdx).trim();
        const val = pair.substring(eqIdx + 1).trim();
        if (key) parsedParams[key] = val;
      }
    });
  }

  // Build the telemetry object that strategies expect (mirrors GPS Server OBJECT_GET_LOCATIONS format)
  const telemetry = {
    imei: String(imei),
    dt_tracker: dt || null,
    dt_server: dt || null,
    lat: lat !== undefined ? String(lat) : '0',
    lng: lng !== undefined ? String(lng) : '0',
    altitude: altitude || 0,
    angle: angle || 0,
    speed: speed || 0,
    loc_valid: loc_valid !== undefined ? loc_valid : 1,
    params: parsedParams,  // object for strategies
    params_raw: params || '',  // raw string for GPS Server format
    event: event || null
  };

  await dispatchToB2B(telemetry);

  console.log(`[Ingest] B2B routing complete for IMEI: ${imei}`);
  console.log(`======================================================`);

  res.json({ success: true, message: `Dispatched to B2B engine` });
});



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

// NOTE: getUtcTimestamp is kept for potential future use in GPS Server Poller logging.

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

// lastDeviceTimestamps is defined globally at the top for persistence

/**
 * Función asíncrona para recuperar historial perdido (Túneles o Gaps)
 */
async function recoverHistory(imei, dt_old, dt_new, client, apiKey) {
  try {
     console.log(`[Backfiller] Iniciando recuperación de ruta para ${imei} desde ${dt_old} hasta ${dt_new}...`);
     const res = await axios.get(GPSSERVER_API_URL, {
       params: { api: 'user', key: apiKey, cmd: `OBJECT_GET_MESSAGES,${imei},${dt_old},${dt_new}` },
       timeout: 20000
     });
     
     let messages = [];
     if (Array.isArray(res.data)) {
        messages = res.data;
     } else if (res.data && typeof res.data === 'object') {
        messages = Object.values(res.data);
     }
     
     if (messages.length === 0) {
       console.log(`[Backfiller] No se encontraron puntos intermedios para ${imei}.`);
       return;
     }

     // Filtrar los extremos para no duplicar
     messages = messages.filter(m => m.dt_tracker && m.dt_tracker !== dt_old && m.dt_tracker !== dt_new);
     
     if (messages.length > 0) {
       systemStats.backfillerRecoveredPoints += messages.length;
       console.log(`[Backfiller] 💎 ¡ÉXITO! Se recuperaron ${messages.length} puntos históricos perdidos para ${imei}. Inyectándolos a B2B...`);
       
       for (const msg of messages) {
           const telemetry = {
              imei: imei,
              name: msg.name || imei,
              lat: msg.lat,
              lng: msg.lng,
              altitude: msg.altitude || 0,
              angle: msg.angle || 0,
              speed: msg.speed || 0,
              dt_tracker: msg.dt_tracker,
              dt_server: msg.dt_server,
              loc_valid: msg.loc_valid !== undefined ? msg.loc_valid : 1,
              params: msg.params || ''
           };
           await dispatchToB2B(telemetry, client);
           await new Promise(r => setTimeout(r, 100)); // Pequeña pausa para no saturar
       }
       console.log(`[Backfiller] ✅ Inyección de ${messages.length} puntos completada para ${imei}.`);
     }
  } catch (err) {
     console.error(`[Backfiller] Error recuperando historial para ${imei}:`, err.message);
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
          systemStats.totalPolledPoints++;
          
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
            params: device.params
          };

          // ==============================================
          // [Backfiller IA] Detección de Saltos de Tiempo
          // ==============================================
          if (device.dt_tracker) {
            const lastPollerState = lastDeviceTimestamps[imei] || {};
            if (lastPollerState.dt_tracker && lastPollerState.dt_tracker !== device.dt_tracker) {
              const oldTime = new Date(lastPollerState.dt_tracker.replace(' ', 'T') + 'Z').getTime();
              const newTime = new Date(device.dt_tracker.replace(' ', 'T') + 'Z').getTime();
              const gapSeconds = (newTime - oldTime) / 1000;
              
              // Si el salto es mayor a 15 segundos y menor a 3 horas (para evitar bloqueos masivos)
              if (gapSeconds > 15 && gapSeconds < 10800) {
                 systemStats.backfillerTriggers++;
                 console.log(`[Poller] ⚠️ Salto de ${gapSeconds}s detectado en ${imei}. Disparando Backfiller...`);
                 // Disparar recuperación en segundo plano (sin await para no bloquear el poller)
                 recoverHistory(imei, lastPollerState.dt_tracker, device.dt_tracker, client, apiKey);
              }
            }
            // Actualizar memoria del Poller para el siguiente ciclo
            lastDeviceTimestamps[imei] = { dt_tracker: device.dt_tracker };
          }
          // ==============================================

          try {
            await dispatchToB2B(telemetry, client);
          } catch (err) {
            console.error(`[GPS Server Poller] Error procesando B2B para IMEI ${imei}:`, err.message);
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

// ============================================================================
// TRACKSOLID POLLING & FORWARDING ENGINE (NUEVO)
// ============================================================================

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

  // 1. Forward to GPS Server Native API (api_loc.php)
  if (GPS_SERVER_URL) {
    console.log(`[Tracksolid] Forwarding to GPS Server: ${GPS_SERVER_URL}`, gpsParams);
    try {
      const response = await axios.get(GPS_SERVER_URL, { params: gpsParams, timeout: 5000 });
      console.log('[Tracksolid] GPS Server Response:', response.data);
      const respStr = typeof response.data === 'object' ? JSON.stringify(response.data) : response.data;
      lastTracksolidForwardStatus = `Success: GPS Server replied "${respStr}" at ${new Date().toISOString()}`;
    } catch (err) {
      console.error('[Tracksolid] GPS Server forward failed:', err.message);
      lastTracksolidForwardStatus = `Failed: ${err.message} at ${new Date().toISOString()}`;
      // Note: We don't throw here. We want B2B routing to continue even if the GPS Server insert fails momentarily.
    }
  }

  // 2. Dispatch to B2B engines internally
  console.log(`\n======================================================`);
  console.log(`[Tracksolid → B2B] Internal routing for IMEI: ${gpsParams.imei}`);
  
  const parsedParams = {};
  if (gpsParams.params && typeof gpsParams.params === 'string') {
    gpsParams.params.split('|').forEach(pair => {
      const eqIdx = pair.indexOf('=');
      if (eqIdx > 0) {
        const key = pair.substring(0, eqIdx).trim();
        const val = pair.substring(eqIdx + 1).trim();
        if (key) parsedParams[key] = val;
      }
    });
  }

  const telemetry = {
    imei: String(gpsParams.imei),
    dt_tracker: gpsParams.dt || null,
    dt_server: gpsParams.dt || null,
    lat: gpsParams.lat !== undefined ? String(gpsParams.lat) : '0',
    lng: gpsParams.lng !== undefined ? String(gpsParams.lng) : '0',
    altitude: gpsParams.altitude || 0,
    angle: gpsParams.angle || 0,
    speed: gpsParams.speed || 0,
    loc_valid: gpsParams.loc_valid !== undefined ? gpsParams.loc_valid : 1,
    params: parsedParams,
    params_raw: gpsParams.params || '',
    event: gpsParams.event || null
  };

  await dispatchToB2B(telemetry);
  console.log(`======================================================`);
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
 * Poll location updates for configured Tracksolid IMEIs
 */
async function pollTracksolidLocations() {
  lastTracksolidPollTime = new Date().toISOString();
  try {
    const token = await getTracksolidToken();
    const imeisList = TRACKSOLID_IMEIS.split(',').map(s => s.trim());
    
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
 * Middleware to verify Tracksolid signature on webhooks
 */
function requireTracksolidSignature(req, res, next) {
  const hasParams = Object.keys(req.query).length > 0 || Object.keys(req.body).length > 0;
  if (!hasParams) {
    return res.status(200).json({ code: 0, message: 'success' });
  }

  const incomingSign = req.query.sign || req.body.sign || req.headers['x-sign'] || req.headers['sign'];
  if (!incomingSign) {
    console.log('[Tracksolid Signature Warning] Missing signature on push, proceeding anyway.');
    return next();
  }

  if (!verifySignature(req, TRACKSOLID_APP_SECRET)) {
    console.warn(`[Tracksolid Signature Failed] Unauthorized request to ${req.path}`);
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
      console.log('[Tracksolid Push] Received empty payload/verification ping on POST.');
      return res.status(200).json({ code: 0, message: 'success' });
    }

    const payload = typeof data === 'string' ? JSON.parse(data) : data;
    console.log(`\n--- New Tracksolid Telemetry Push (Type: ${msgType}) ---`);
    console.log('Payload:', payload);

    await forwardTelemetryToGpsServer(payload, msgType);

    res.json({ code: 0, message: 'Telemetry forwarded successfully' });
  } catch (error) {
    console.error('[Tracksolid Push] Error handling webhook push:', error.message);
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
  
  console.log(`[Architecture] Single System (All-in-One)`);
  console.log(`[Architecture] Tracksolid polling active: ${!!TRACKSOLID_USER_ID}`);
  console.log(`[Architecture] GPS Server polling active: ${GPSSERVER_POLL_ENABLED}`);

  // Start Tracksolid Polling Engine if credentials are provided
  if (TRACKSOLID_USER_ID && TRACKSOLID_APP_KEY && TRACKSOLID_APP_SECRET && TRACKSOLID_USER_PWD_MD5 && TRACKSOLID_IMEIS) {
    console.log(`[Tracksolid Poller] Starting background location polling loop.`);
    console.log(`[Tracksolid Poller] Interval: ${TRACKSOLID_POLL_INTERVAL}ms`);
    console.log(`[Tracksolid Poller] Target IMEIs: ${TRACKSOLID_IMEIS}`);
    
    // Run immediately on startup, then every interval
    pollTracksolidLocations();
    setInterval(pollTracksolidLocations, TRACKSOLID_POLL_INTERVAL);
  } else {
    console.log(`[Tracksolid Poller] Disabled (missing one or more TRACKSOLID_* env variables).`);
  }

  // Start GPS Server Polling Engine if clients are configured AND not explicitly disabled
  if (GPSSERVER_POLL_ENABLED && GPSSERVER_POLL_CLIENTS) {
    console.log(`[GPS Server Poller] Starting background location polling loop.`);
    console.log(`[GPS Server Poller] Interval: ${GPSSERVER_POLL_INTERVAL}ms`);
    console.log(`[GPS Server Poller] Active Clients: ${GPSSERVER_POLL_CLIENTS}`);
    
    // Run immediately on startup, then every interval
    pollGpsServerLocations();
    setInterval(pollGpsServerLocations, GPSSERVER_POLL_INTERVAL);
  } else if (!GPSSERVER_POLL_ENABLED) {
    console.log(`[GPS Server Poller] Disabled via GPSSERVER_POLL_ENABLED=false. Using /ingest push pipeline instead.`);
  } else {
    console.log(`[GPS Server Poller] Disabled (GPSSERVER_POLL_CLIENTS is not configured).`);
  }
  console.log(`===========================================================`);
});
