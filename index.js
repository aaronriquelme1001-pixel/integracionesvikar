require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');
const axios = require('axios');

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
  dhl: new DhlStrategy()
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
  res.json({ status: 'OK', service: 'integraciones-vikar', pattern: 'Strategy', time: new Date().toISOString() });
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
  const targetParam = req.query.target;
  const clientParam = req.query.client;

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
 * Real-time integration testing endpoint
 */
app.get('/api/test', async (req, res) => {
  const { target, client } = req.query;
  
  if (!target) {
    return res.status(400).json({ success: false, error: 'Falta el parámetro target' });
  }

  const cleanTarget = target.toLowerCase();

  try {
    if (cleanTarget === 'incoming-gps') {
      // Test connection to the central GPS Server
      const targetUrl = process.env.GPS_SERVER_URL || 'http://gsh7.net/id39/api/api_loc.php';
      const gpsParams = {
        imei: '999999999999999', // Dummy IMEI to prevent telemetry pollution of real vehicles
        plate: 'PING_TEST',
        lat: '-33.456789',
        lng: '-70.654321',
        speed: 0,
        angle: 0,
        dt: new Date().toISOString().replace('T', ' ').substring(0, 19),
        loc_valid: 1,
        altitude: 0,
        params: 'acc=0|'
      };

      console.log(`[Test API] Testing GPS Server connection: ${targetUrl}`);
      const response = await axios.get(targetUrl, { 
        params: gpsParams,
        timeout: 4000
      });
      
      return res.json({ 
        success: true, 
        message: 'Conexión con GPS Server (gsh7.net) exitosa',
        response: response.data 
      });
    }

    const strategy = strategies[cleanTarget];
    if (!strategy) {
      return res.status(400).json({ success: false, error: `No se encontró estrategia para ${target}` });
    }

    // Standard mock telemetry payload for pings
    const telemetry = {
      imei: '999999999999999', // Dummy IMEI to prevent telemetry pollution of real vehicles
      plate_number: 'TEST99',
      lat: '-33.456789',
      lng: '-70.654321',
      speed: '60',
      angle: '90',
      dt_tracker: new Date().toISOString().replace('T', ' ').substring(0, 19),
      params: 'acc=1|'
    };

    const deviceConfig = {
      plate: 'TEST99',
      carrier: 'VIKARGPS_TEST'
    };

    const config = getDynamicIntegrationConfig(cleanTarget, client);
    console.log(`[Test API] Running live strategy test for: ${cleanTarget} (Client: ${client || 'default'})...`);
    
    await strategy.execute(telemetry, deviceConfig, config);

    return res.json({ 
      success: true, 
      message: `Test de conexión con ${target.toUpperCase()} exitoso` 
    });
  } catch (err) {
    console.error(`[Test API] Error testing target ${target}:`, err.message);
    return res.json({ 
      success: false, 
      error: err.message 
    });
  }
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

app.listen(PORT, () => {
  console.log(`===========================================================`);
  console.log(`VIKAR B2B Integrations Middleware running on port ${PORT}`);
  console.log(`Active configuration mappings read from config/devices.json`);
  console.log(`===========================================================`);
});
