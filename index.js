require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');

// ==============================================
// 🛡️ ANTI-CRASH SHIELD (Seguro de Vida Node.js)
// ==============================================
process.on('uncaughtException', (err) => {
  console.error(`[CRITICAL] Error no capturado:`, err.message, err.stack);
  // No salimos del proceso (evitamos crash total)
});

process.on('unhandledRejection', (reason, promise) => {
  console.error(`[CRITICAL] Promesa rechazada sin atrapar:`, reason);
  // No salimos del proceso
});

const { systemStats, deviceAntiSpamState, lastDeviceTimestamps, retryQueue } = require('./src/core/state');
const { handleGpsServerWebhook } = require('./src/webhooks/gpsServer');
const { pollGpsServerLocations, getStatus: getGpsPollerStatus } = require('./src/pollers/gpsServer');
const { pollTracksolid, getStatus: getTracksolidStatus } = require('./src/pollers/tracksolid');

const app = express();
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

/**
 * Health Check & Live Dashboard Endpoint
 */
app.get('/health', (req, res) => {
  res.json({
    status: 'online',
    version: '2.0.0 (B2B Engine Modular)',
    uptime_seconds: process.uptime(),
    stats: systemStats,
    activeDevicesInSpamFilter: Object.keys(deviceAntiSpamState).length,
    pollerMemoryKeys: Object.keys(lastDeviceTimestamps).length,
    retryQueueLength: retryQueue.length,
    pollers: {
       gpsServer: getGpsPollerStatus(),
       tracksolid: getTracksolidStatus()
    }
  });
});

/**
 * Security Middleware for Webhooks
 */
const requireWebhookAuth = (req, res, next) => {
  const secret = process.env.WEBHOOK_SECRET_KEY;
  if (!secret) return next(); // Permisivo si no se configura secreto en ENV
  
  const provided = req.query.secret || req.headers['x-webhook-secret'];
  if (provided !== secret) {
    console.warn(`[Security] Intento de acceso a webhook bloqueado (IP: ${req.ip})`);
    return res.status(401).send('Unauthorized');
  }
  next();
};

/**
 * GPS Server Webhooks
 */
app.get('/webhook/gps-server', requireWebhookAuth, handleGpsServerWebhook);
app.post('/webhook/gps-server', requireWebhookAuth, handleGpsServerWebhook);

/**
 * Root Endpoint
 */
app.get('/', (req, res) => {
  res.send('B2B Telemetry Orchestrator is running (V2.0 Modular).');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`[System] B2B Orchestrator listening on port ${PORT}`);
  console.log(`[System] Starting Pollers...`);

  if (process.env.TRACKSOLID_POLL_ENABLED === 'true') {
     setTimeout(pollTracksolid, 2000);
  }
  setTimeout(pollGpsServerLocations, 5000);
});
