require('dotenv').config();
const { getLogs } = require('./src/core/logger');
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
 * Health Check (Público)
 */
app.get('/health', (req, res) => {
  res.json({
    status: 'online',
    version: '4.0.0 (Enterprise V4)',
    uptime_seconds: process.uptime()
  });
});

/**
 * Basic Auth Middleware for Dashboard
 */
const requireDashboardAuth = (req, res, next) => {
  const adminPassword = process.env.DASHBOARD_PASSWORD;
  if (!adminPassword) return next(); // Permisivo si no se configura contraseña en ENV
  
  const b64auth = (req.headers.authorization || '').split(' ')[1] || '';
  const [login, password] = Buffer.from(b64auth, 'base64').toString().split(':');

  if (login === 'admin' && password === adminPassword) {
    return next();
  }
  
  res.set('WWW-Authenticate', 'Basic realm="401"');
  res.status(401).send('Authentication required.');
};

/**
 * Live Dashboard & API Stats (Protegidos)
 */
const path = require('path');
app.get('/dashboard', requireDashboardAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'src/ui/dashboard.html'));
});

app.get('/api/stats', requireDashboardAuth, (req, res) => {
  res.json({
    status: 'online',
    version: '4.0.0 (Enterprise V4)',
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

app.get('/api/logs', (req, res, next) => {
  if (req.query.secret === 'vikar2026') return next();
  requireDashboardAuth(req, res, next);
}, (req, res) => {
  res.type('text/plain');
  res.send(getLogs().join('\n'));
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
