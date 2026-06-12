require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');

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
 * GPS Server Webhooks
 */
app.get('/webhook/gps-server', handleGpsServerWebhook);
app.post('/webhook/gps-server', handleGpsServerWebhook);

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
