require('dotenv').config();
const { getLogs } = require('./src/core/logger');
const express = require('express');
const bodyParser = require('body-parser');

// ==============================================
// 🛡️ ANTI-CRASH SHIELD (Seguro de Vida Node.js)
// ==============================================
process.on('uncaughtException', (err) => {
  console.error(`[CRITICAL] Error no capturado:`, err.message, err.stack);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error(`[CRITICAL] Promesa rechazada sin atrapar:`, reason);
  // No salimos del proceso
});

const { systemStats, deviceAntiSpamState, lastDeviceTimestamps, retryQueue } = require('./src/core/state');
const { handleGpsServerWebhook } = require('./src/webhooks/gpsServer');
const { handleIncomingGps } = require('./src/webhooks/incoming');
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

const { BigQuery } = require('@google-cloud/bigquery');
let bqClient = null;
if (process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON) {
   const credentials = JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON);
   bqClient = new BigQuery({ projectId: credentials.project_id, credentials });
} else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
   bqClient = new BigQuery();
} else if (require('fs').existsSync('./bq-key.json')) {
   bqClient = new BigQuery({ projectId: 'vikargpsdatos', keyFilename: './bq-key.json' });
}
app.get('/api/datalake-facts', async (req, res) => {
  if (req.query.secret !== 'vikar2026') return res.status(403).send('Forbidden');
  if (!bqClient) return res.json({ error: 'BigQuery Data Lake no configurado' });
  
  try {
    const [opelOldest] = await bqClient.query(`SELECT dt_tracker, lat, lng, speed FROM \`telemetry.global_traffic\` WHERE imei='865413054330609' ORDER BY dt_tracker ASC LIMIT 1`);
    const [opelYesterday] = await bqClient.query(`SELECT dt_tracker, lat, lng, speed FROM \`telemetry.global_traffic\` WHERE imei='865413054330609' AND dt_tracker >= '2026-06-19 13:00:00' AND dt_tracker <= '2026-06-19 15:00:00' LIMIT 5`);
    
    res.json({
      success: true,
      billingSnapshotsTotal: 0, // Deprecated in BQ
      opelOldestPoint: opelOldest.length ? opelOldest[0] : null,
      opelYesterdaySample: opelYesterday
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/audit', async (req, res) => {
  if (req.query.secret !== 'vikar2026') return res.status(403).send('Forbidden');
  if (!bqClient) return res.json({ error: 'BigQuery Data Lake no configurado' });
  try {
    const [r] = await bqClient.query(`
      SELECT plate, COUNT(*) as c, MAX(dt_tracker) as last_point
      FROM \`telemetry.global_traffic\` 
      WHERE dt_tracker > TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 2 HOUR)
      GROUP BY plate 
      ORDER BY c DESC
    `);
    const [outOfOrder] = await bqClient.query(`
      WITH numbered AS (
          SELECT plate, dt_tracker, 
                 LAG(dt_tracker) OVER (PARTITION BY plate ORDER BY created_at ASC) as prev_dt
          FROM \`telemetry.global_traffic\`
          WHERE dt_tracker > TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 12 HOUR)
      )
      SELECT plate, dt_tracker, prev_dt 
      FROM numbered 
      WHERE dt_tracker < prev_dt 
      LIMIT 100;
    `);
    res.json({ stats: r, outOfOrder: outOfOrder });
  } catch(e) { res.status(500).json({error: e.message}); }
});

const { recoverHistory } = require('./src/pollers/gpsServer');
app.get('/api/force-backfill', async (req, res) => {
  if (req.query.secret !== 'vikar2026') return res.status(403).send('Forbidden');
  try {
    const imei = req.query.imei;
    const client = req.query.client || 'luisherrera';
    
    if (typeof recoverHistory === 'function') {
      const start = req.query.start;
      const end = req.query.end;
      const count = await recoverHistory(imei, start, end, client, null, false);
      res.json({ success: true, count, message: `Se reinyectaron ${count} puntos con la hora corregida.` });
    } else {
      res.status(500).send('recoverHistory no exportado');
    }
  } catch(e) { res.status(500).json({error: e.message}); }
});

const fs = require('fs');
const { getMappingCache, getClientForImei } = require('./src/pollers/gpsServer');

app.get('/api/force-backfill-all', async (req, res) => {
  if (req.query.secret !== 'vikar2026') return res.status(403).send('Forbidden');
  try {
    // Timezone offset: Chile is UTC-4. User provides local time, we must convert to UTC for GPS Server API.
    const TZ_OFFSET_HOURS = parseInt(process.env.TZ_BACKFILL_OFFSET || '4', 10); // +4 to go from Chile->UTC
    const toUtc = (localStr) => {
      if (!localStr) return null;
      let isoStr = localStr.replace(' ', 'T');
      if (isoStr.split(':').length === 2) isoStr += ':00'; // Append seconds only if missing
      const epoch = new Date(isoStr).getTime() + (TZ_OFFSET_HOURS * 3600000);
      const d = new Date(epoch);
      const p = n => n.toString().padStart(2, '0');
      return `${d.getUTCFullYear()}-${p(d.getUTCMonth()+1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`;
    };
    
    const startLocal = req.query.start; // e.g. "2026-06-25 14:00"
    const endLocal = req.query.end;     // e.g. "2026-06-25 18:00"
    const start = toUtc(startLocal) || startLocal;
    const end   = toUtc(endLocal)   || endLocal;
    
    console.log(`[BackfillAll] Rango local: ${startLocal} → ${endLocal} | Convertido a UTC: ${start} → ${end}`);
    
    // Get all devices discovered dynamically from the API (Admin, Transklett, etc)
    const mappingCache = typeof getMappingCache === 'function' ? getMappingCache() : {};
    let imeis = Object.keys(mappingCache);
    
    const targetClients = req.query.clients ? req.query.clients.toLowerCase().split(',').map(s=>s.trim()) : null;
    if (targetClients) {
       imeis = imeis.filter(imei => {
           const cached = mappingCache[imei];
           const clientName = (cached && cached.client) ? cached.client : (typeof cached === 'string' ? cached : 'unknown');
           return targetClients.some(tc => clientName.toLowerCase().includes(tc));
       });
    }
    
    if (imeis.length === 0) {
      return res.json({ success: false, message: "No se encontraron vehículos para los clientes especificados o el caché está vacío." });
    }

    let results = [];
    
    // We start the processing in background so the request doesn't timeout
    setTimeout(async () => {
      for (const imei of imeis) {
        try {
          const cached = mappingCache[imei];
          const client = (cached && cached.client) ? cached.client : (typeof cached === 'string' ? cached : 'unknown');
          const clientUpper = client.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
          const clientApiKey = process.env[`GPSSERVER_API_KEY_${clientUpper}`];
          if (!clientApiKey) {
             console.warn(`[BackfillAll] ⚠️ No se encontró GPSSERVER_API_KEY_${clientUpper} para el cliente ${client}. Fallará si el masterKey no soporta historial.`);
          }
          console.log(`[BackfillAll] Procesando ${imei} del cliente ${client} | UTC: ${start} → ${end}`);
          const count = await recoverHistory(imei, start, end, client, { key: clientApiKey }, false);
          results.push({ imei, count });
          await new Promise(r => setTimeout(r, 2000)); // Pause between vehicles
        } catch(e) {
          results.push({ imei, error: e.message });
        }
      }
      console.log(`[BackfillAll] Terminado:`, results);
    }, 100);

    res.json({ success: true, utcRange: { start, end }, message: `Se inició el proceso en background para ${imeis.length} vehículos. Rango UTC: ${start} → ${end}` });
  } catch(e) { res.status(500).json({error: e.message}); }
});

/**
 * Security Middleware for Webhooks
 */
const requireWebhookAuth = (req, res, next) => {
  const secret = process.env.WEBHOOK_SECRET_KEY || process.env.INCOMING_API_KEY;
  if (!secret) return next(); // Permisivo si no se configura secreto en ENV
  
  const provided = req.query.secret || req.headers['x-webhook-secret'] || req.headers['x-api-key'];
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
 * Generic Inbound GPS Webhook
 */
app.post('/webhook/incoming-gps', requireWebhookAuth, handleIncomingGps);

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
 * Fleet API
 */
const fleetRoute = require('./src/routes/fleet');
app.use('/api/fleet', fleetRoute);

/**
 * Manual Trigger for Billing Snapshot
 */
  app.get('/api/trigger-billing', async (req, res) => {
    if (req.query.secret !== 'vikar2026') return res.status(403).send('Forbidden');
    const { runBillingSnapshot } = require('./src/cron/billing_snapshot');
    
    try {
      const result = await runBillingSnapshot();
      res.json({ message: 'Billing snapshot completed', result });
    } catch (err) {
      res.status(500).json({ error: err.message, stack: err.stack });
    }
  });

  /**
   * Manual Trigger for Billing Snapshot Backfill (Recalculate clusters for past days)
   */
  app.get('/api/trigger-backfill', async (req, res) => {
    if (req.query.secret !== 'vikar2026') return res.status(403).send('Forbidden');
    const { calculateDailyGrade } = require('./src/cron/billing_snapshot');
    const { start_date, end_date } = req.query; // YYYY-MM-DD
    
    if (!start_date || !end_date) return res.status(400).json({ error: 'Missing start_date or end_date' });

    try {
      const { Pool } = require('pg');
      const tempPool = new Pool({ connectionString: process.env.DATALAKE_URL, ssl: { rejectUnauthorized: false } });
      
      // Get all distinct IMEIs that had a snapshot in this range
      const clientsResult = await tempPool.query(`SELECT DISTINCT imei, client_id FROM billing_snapshots WHERE snapshot_date >= $1 AND snapshot_date <= $2`, [start_date, end_date]);
      
      const start = new Date(start_date);
      const end = new Date(end_date);
      let updatedCount = 0;

      for (const row of clientsResult.rows) {
        const imei = row.imei;
        const clientId = row.client_id;
        
        for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
          const snapshotDate = d.toISOString().split('T')[0];
          
          // Call the updated calculateDailyGrade which does the 5-min clustering
          const stats = await calculateDailyGrade(imei, snapshotDate);
          
          if (stats.extremeCount > 0 || stats.moderateCount > 0 || stats.harshCount > 0 || stats.fatigueCount > 0 || stats.grade !== 7.0) {
            await tempPool.query(`
              UPDATE billing_snapshots
              SET daily_grade = $1, extreme_speeding_count = $2, moderate_speeding_count = $3, harsh_maneuvers_count = $4, fatigue_alerts_count = $5
              WHERE imei = $6 AND snapshot_date = $7
            `, [stats.grade, stats.extremeCount, stats.moderateCount, stats.harshCount, stats.fatigueCount, imei, snapshotDate]);
            updatedCount++;
          }
        }
      }
      tempPool.end();
      res.json({ message: 'Backfill completed', updatedSnapshots: updatedCount });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: err.message, stack: err.stack });
    }
  });

app.get('/api/debug-users-objects', async (req, res) => {
  if (req.query.secret !== 'vikar2026') return res.status(403).send('Forbidden');
  const axios = require('axios');
  const masterKey = process.env.GPS_SERVER_MASTER_KEY;
  const gpsUrl = 'http://gsh7.net/id39/api/api.php';
  
  try {
    const response = await axios.get(`${gpsUrl}?api=server&key=${masterKey}&cmd=GET_USERS_OBJECTS`);
    const objects = response.data;
    res.json(objects);
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
app.listen(PORT, async () => {
  console.log(`[System] B2B Orchestrator listening on port ${PORT}`);
  
  // --- Auto Migration ---
  if (process.env.DATALAKE_URL) {
    const { Pool } = require('pg');
    const tempPool = new Pool({
      connectionString: process.env.DATALAKE_URL,
      ssl: { rejectUnauthorized: false }
    });
    try {
      await tempPool.query(`
        ALTER TABLE billing_snapshots 
        ADD COLUMN IF NOT EXISTS extreme_speeding_count INTEGER DEFAULT 0,
        ADD COLUMN IF NOT EXISTS moderate_speeding_count INTEGER DEFAULT 0,
        ADD COLUMN IF NOT EXISTS harsh_maneuvers_count INTEGER DEFAULT 0,
        ADD COLUMN IF NOT EXISTS fatigue_alerts_count INTEGER DEFAULT 0;
      `);
      console.log('[System] DB Migration applied successfully.');
    } catch (err) {
      console.error('[System] Error applying DB migration:', err);
    } finally {
      tempPool.end();
    }
  }
  // ----------------------

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
      runBillingSnapshot().catch(err => {
        console.error('[System] ❌ Error in background billing snapshot:', err.message);
      });
    }
  }, 60000); // Check every minute
});
