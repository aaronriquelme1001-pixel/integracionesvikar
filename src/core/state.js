const fs = require('fs');
const path = require('path');

const STATE_FILE = path.join(__dirname, '../../data', 'state.json');

const systemStats = {
  bootTime: new Date().toISOString(),
  totalWebhooksProcessed: 0,
  totalPolledPoints: 0,
  totalPointsDispatched: 0,
  backfillerTriggers: 0,
  backfillerRecoveredPoints: 0,
  lastDispatchTime: null
};

let deviceAntiSpamState = {};
let lastDeviceTimestamps = {};
let pendingBackfills = [];
const retryQueue = [];

// ==============================================
// 💾 MEMORIA PERSISTENTE (Inmunidad a Reinicios)
// ==============================================
try {
  if (!fs.existsSync(path.dirname(STATE_FILE))) {
    fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  }
  if (fs.existsSync(STATE_FILE)) {
    const rawData = fs.readFileSync(STATE_FILE, 'utf8');
    const parsedData = JSON.parse(rawData);
    deviceAntiSpamState = parsedData.deviceAntiSpamState || {};
    lastDeviceTimestamps = parsedData.lastDeviceTimestamps || {};
    pendingBackfills = parsedData.pendingBackfills || [];
    console.log(`[Persistencia] Memoria restaurada exitosamente. AntiSpam keys: ${Object.keys(deviceAntiSpamState).length}`);
  }
} catch (err) {
  console.error(`[Persistencia] Error cargando memoria:`, err.message);
}

// Guardar memoria cada 1 minuto
setInterval(() => {
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify({ deviceAntiSpamState, lastDeviceTimestamps, pendingBackfills }), 'utf8');
  } catch (err) {
    console.error(`[Persistencia] Error guardando memoria:`, err.message);
  }
}, 60000);

module.exports = {
  systemStats,
  deviceAntiSpamState,
  lastDeviceTimestamps,
  pendingBackfills,
  retryQueue
};
