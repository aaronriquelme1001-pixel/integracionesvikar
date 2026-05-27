require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');

// Import B2B integrations
const { sendToColun } = require('./integrations/colun');
const { sendToArauco } = require('./integrations/arauco');
const { sendToMelon } = require('./integrations/melon');
const { sendToFalabella } = require('./integrations/falabella');

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
 * Loads device configuration dynamically on each request to allow
 * changes to config/devices.json without restarting the server.
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
  res.json({ status: 'OK', service: 'integraciones-vikar', time: new Date().toISOString() });
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
    return res.status(200).send('ok'); // GPS Server expects a simple 'ok' response
  }

  console.log(`\n======================================================`);
  console.log(`[Webhook] New telemetry update for IMEI: ${imei}`);
  console.log('Telemetry details:', telemetry);

  // Check if device has B2B integrations configured
  const deviceConfig = getDeviceConfig(imei);
  if (!deviceConfig || !deviceConfig.targets || deviceConfig.targets.length === 0) {
    console.log(`[Router] No B2B integrations mapped for IMEI: ${imei}. Skipping.`);
    console.log(`======================================================`);
    return res.status(200).send('ok');
  }

  console.log(`[Router] Mapped targets for ${deviceConfig.plate}:`, deviceConfig.targets);

  // Execute integrations in parallel but isolated from each other
  const promises = deviceConfig.targets.map(async (target) => {
    try {
      if (target === 'colun') {
        await sendToColun(telemetry, deviceConfig);
      } else if (target === 'arauco') {
        await sendToArauco(telemetry, deviceConfig);
      } else if (target === 'melon' || target === 'unigis') {
        await sendToMelon(telemetry, deviceConfig);
      } else if (target === 'falabella') {
        await sendToFalabella(telemetry, deviceConfig);
      } else {
        console.warn(`[Router] Warning: Unknown B2B target '${target}'`);
      }
    } catch (err) {
      console.error(`[Router] Error dispatching to target '${target}':`, err.message);
    }
  });

  // Await dispatching to all platforms
  await Promise.all(promises);

  console.log(`[Router] Telemetry routing complete.`);
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
