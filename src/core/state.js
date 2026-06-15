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

// Guardar memoria cada 1 minuto (Asíncrono Anti-Bloqueo)
setInterval(async () => {
  try {
    const tmpFile = `${STATE_FILE}.tmp`;
    const data = JSON.stringify({ deviceAntiSpamState, lastDeviceTimestamps, pendingBackfills });
    await fs.promises.writeFile(tmpFile, data, 'utf8');
    await fs.promises.rename(tmpFile, STATE_FILE);
  } catch (err) {
    console.error(`[Persistencia] Error guardando memoria:`, err.message);
  }
}, 60000);

// ==============================================
// 🧹 GARBAGE COLLECTOR (Limpieza de RAM)
// ==============================================
// Se ejecuta cada 12 horas para borrar camiones que no han transmitido en 7 días
setInterval(() => {
  const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
  const now = Date.now();
  let deletedCount = 0;
  
  for (const imei in deviceAntiSpamState) {
    if (now - (deviceAntiSpamState[imei].lastSentAt || 0) > SEVEN_DAYS_MS) {
      delete deviceAntiSpamState[imei];
      delete lastDeviceTimestamps[imei];
      deletedCount++;
    }
  }
  
  if (deletedCount > 0) {
    console.log(`[Garbage Collector] 🧹 Se limpiaron ${deletedCount} vehículos inactivos de la memoria RAM.`);
  }
}, 12 * 60 * 60 * 1000);

module.exports = {
  systemStats,
  deviceAntiSpamState,
  lastDeviceTimestamps,
  pendingBackfills,
  retryQueue
};
