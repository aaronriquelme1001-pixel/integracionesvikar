require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');

// Import Strategy Classes
const ColunStrategy = require('./integrations/colun');
const AraucoStrategy = require('./integrations/arauco');
const MelonStrategy = require('./integrations/melon');
const FalabellaStrategy = require('./integrations/falabella');

// Initialize strategy mapping
const strategies = {
  colun: new ColunStrategy(),
  arauco: new AraucoStrategy(),
  melon: new MelonStrategy(),
  unigis: new MelonStrategy(), // Alias for melon
  falabella: new FalabellaStrategy()
};

const app = express();
const PORT = process.env.PORT || 3001;

app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

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

  // Check if device has B2B integrations configured
  const deviceConfig = getDeviceConfig(imei);
  if (!deviceConfig || !deviceConfig.integrations) {
    console.log(`[Router] No B2B integrations mapped for IMEI: ${imei}. Skipping.`);
    console.log(`======================================================`);
    return res.status(200).send('ok');
  }

  const targets = Object.keys(deviceConfig.integrations);
  console.log(`[Router] Found integrations for ${deviceConfig.plate}:`, targets);

  // Execute integrations concurrently using their Strategy classes
  const promises = targets.map(async (target) => {
    const integrationConfig = deviceConfig.integrations[target];
    
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

app.listen(PORT, () => {
  console.log(`===========================================================`);
  console.log(`VIKAR B2B Integrations Middleware running on port ${PORT}`);
  console.log(`Active configuration mappings read from config/devices.json`);
  console.log(`===========================================================`);
});
