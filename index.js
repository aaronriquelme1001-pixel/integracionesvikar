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

app.get('/api/datalake-facts', async (req, res) => {
  if (req.query.secret !== 'vikar2026') return res.status(403).send('Forbidden');
  if (!process.env.DATALAKE_URL) return res.json({ error: 'Data Lake no configurado' });
  
  try {
    const { Pool } = require('pg');
    const pool = new Pool({ connectionString: process.env.DATALAKE_URL, ssl: { rejectUnauthorized: false } });
    const { rows: countRows } = await pool.query('SELECT count(*) as total FROM global_telemetry_traffic');
    const { rows: recentRows } = await pool.query('SELECT imei, plate, speed, dt_tracker, client_source FROM global_telemetry_traffic ORDER BY created_at DESC LIMIT 5');
    res.json({ total_records: countRows[0].total, recent: recentRows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
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
 * Forensic Report API
 */
const forensicsRoute = require('./src/routes/forensics');
app.use('/api/forensic-report', forensicsRoute);

/**
 * Value-Added Billing API
 */
const billingRoute = require('./src/routes/billing');
app.use('/api/billing-stats', billingRoute);

/**
 * Manual Trigger for Billing Snapshot
 */
app.get('/api/trigger-billing', async (req, res) => {
  if (req.query.secret !== 'vikar2026') return res.status(403).send('Forbidden');
  const { runBillingSnapshot } = require('./src/cron/billing_snapshot');
  
  // No esperamos a que termine, lo lanzamos en background
  runBillingSnapshot().catch(console.error);
  res.json({ message: 'Billing snapshot job started in background.' });
});

app.get('/api/debug-gps-server', async (req, res) => {
  if (req.query.secret !== 'vikar2026') return res.status(403).send('Forbidden');
  const axios = require('axios');
  const masterKey = process.env.GPS_SERVER_MASTER_KEY;
  const gpsUrl = 'http://gsh7.net/id39/api/api.php';
  
  try {
    const response = await axios.get(`${gpsUrl}?api=server&key=${masterKey}&cmd=OBJECT_GET_LOCATIONS`);
    const objects = response.data;
    // Retornamos el primer objeto para analizar su estructura
    const firstImei = Object.keys(objects)[0];
    res.json({ firstImei, data: objects[firstImei] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * Root Endpoint
 */
app.get('/', (req, res) => {
  res.send('B2B Telemetry Orchestrator is running (V4 Enterprise).');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`[System] B2B Orchestrator listening on port ${PORT}`);
  console.log(`[System] Starting Pollers...`);

  if (process.env.TRACKSOLID_POLL_ENABLED === 'true') {
     setTimeout(pollTracksolid, 2000);
  }
  setTimeout(pollGpsServerLocations, 5000);
  
  // Start Billing Cron Job (Every 20 minutes)
  const { runBillingSnapshot } = require('./src/cron/billing_snapshot');
  setInterval(() => {
    const now = new Date();
    if (now.getMinutes() % 20 === 0) {
      runBillingSnapshot();
    }
  }, 60000); // Check every minute
});
