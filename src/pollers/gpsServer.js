const axios = require('axios');
const { systemStats, deviceAntiSpamState, lastDeviceTimestamps, pendingBackfills, retryQueue } = require('../core/state');
const { dispatchToB2B } = require('../core/dispatcher');
const { Pool } = require('pg');

let pool = null;
if (process.env.DATALAKE_URL) {
  pool = new Pool({
    connectionString: process.env.DATALAKE_URL,
    ssl: { rejectUnauthorized: false }
  });
}

const waitBufferStates = {}; // { imei: firstWaitMs }
const GPSSERVER_POLL_INTERVAL = parseInt(process.env.GPSSERVER_POLL_INTERVAL, 10) || 10000;
const GPSSERVER_API_URL = process.env.GPSSERVER_API_URL || 'http://gsh7.net/id39/api/api.php';

let lastGpsServerPollTime = null;
let lastGpsServerPollStatus = 'Waiting to start...';
let isGpsServerPolling = false;
let isStateHydrated = false;

// Global mapping cache
let mappingCache = {};
let lastMappingRefresh = 0;
const MAPPING_REFRESH_INTERVAL = 20 * 60 * 1000; // 20 minutes

async function refreshMappingCache(masterKey) {
  try {
    const response = await axios.get(GPSSERVER_API_URL, {
      params: { api: 'server', key: masterKey, cmd: 'GET_USERS_OBJECTS' },
      timeout: 30000
    });
    const usersData = response.data;
    let newMappings = {};
    
    if (Array.isArray(usersData)) {
      for (const userObj of usersData) {
        const clientName = userObj.username || userObj.email || 'unknown';
        const items = userObj.objects || userObj.items || {};
        if (Array.isArray(items)) {
          for (const item of items) {
             if (typeof item === 'string') newMappings[item] = clientName;
             else if (item.imei) newMappings[item.imei] = clientName;
          }
        } else if (typeof items === 'object' && items !== null) {
          for (const key in items) {
             const val = items[key];
             if (typeof val === 'string') newMappings[val] = clientName;
             else newMappings[key] = clientName;
          }
        }
      }
    } else if (typeof usersData === 'object' && usersData !== null) {
      for (const clientName in usersData) {
        const items = usersData[clientName];
        if (typeof items === 'object' && items !== null && !Array.isArray(items)) {
           for (const key in items) {
              const val = items[key];
              if (typeof val === 'string') newMappings[val] = clientName;
              else newMappings[key] = clientName;
           }
        } else if (Array.isArray(items)) {
           for (const item of items) {
              if (item.imei) newMappings[item.imei] = clientName;
              else newMappings[item] = clientName;
           }
        }
      }
    }
    mappingCache = newMappings;
    lastMappingRefresh = Date.now();
    console.log(`[GPS Server Poller] Mapping cache refreshed. Discovered ${Object.keys(mappingCache).length} vehicles.`);
  } catch (err) {
    console.error('[GPS Server Poller] Error refreshing mapping cache:', err.message);
  }
}

/**
 * Función asíncrona para recuperar historial perdido (Túneles o Gaps)
 */
async function recoverHistory(imei, dt_old, dt_new, client, apiKey, isMaster = false) {
  try {
     console.log(`[Backfiller] Iniciando recuperación de historial para ${imei}. De: ${dt_old} a ${dt_new}`);
     let allMessages = [];
     const tz = process.env.TIMEZONE_OFFSET || '-04:00';
     const getEpoch = (ds) => new Date(ds.replace(' ', 'T') + tz).getTime();
     const startEpoch = getEpoch(dt_old);
     const endEpoch = getEpoch(dt_new);
     const TWELVE_HOURS_MS = 12 * 60 * 60 * 1000;
     const apiTarget = isMaster ? 'server' : 'user';
     
     if (!isNaN(startEpoch) && !isNaN(endEpoch) && (endEpoch - startEpoch) > TWELVE_HOURS_MS) {
       console.log(`[Backfiller] 📦 Rango gigante detectado. Paginando historial para ${imei}...`);
       
       const sign = tz[0] === '+' ? 1 : -1;
       const hours = parseInt(tz.substring(1, 3), 10);
       const mins = parseInt(tz.substring(4, 6), 10);
       const offsetMs = sign * ((hours * 60) + mins) * 60 * 1000;
       
       let currentStart = startEpoch;
       while (currentStart < endEpoch) {
         let currentEnd = currentStart + TWELVE_HOURS_MS;
         if (currentEnd > endEpoch) currentEnd = endEpoch;
         
         const pad = n => n.toString().padStart(2, '0');
         const fmt = epoch => {
            const d = new Date(epoch + offsetMs);
            return `${d.getUTCFullYear()}-${pad(d.getUTCMonth()+1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
         };
         
         const chunkStart = fmt(currentStart);
         const chunkEnd = fmt(currentEnd);
         
         const response = await axios.get(GPSSERVER_API_URL, {
            params: { api: apiTarget, key: apiKey, cmd: `OBJECT_GET_MESSAGES,${imei},${chunkStart},${chunkEnd}` },
            timeout: 30000
         });
         
         if (response.data && Array.isArray(response.data)) {
            allMessages = allMessages.concat(response.data);
         }
         currentStart = currentEnd;
         await new Promise(r => setTimeout(r, 500));
       }
     } else {
       const response = await axios.get(GPSSERVER_API_URL, {
          params: { api: apiTarget, key: apiKey, cmd: `OBJECT_GET_MESSAGES,${imei},${dt_old},${dt_new}` },
          timeout: 30000
       });
       let resData = response.data;
       if (resData) {
          if (Array.isArray(resData)) {
             allMessages = resData;
          } else if (typeof resData === 'object') {
             allMessages = Object.values(resData);
          }
       }
     }
     
     if (allMessages.length > 0) {
        let messages = allMessages.map(m => {
           if (Array.isArray(m)) {
              const paramsObj = m[6] || {};
              const satellites = parseInt(paramsObj.gpslev || paramsObj.sat || paramsObj.satellites || 0, 10);
              const isGpsValid = satellites > 0 ? 1 : 0;
              
              return {
                 dt_tracker: m[0],
                 dt_server: m[0],
                 lat: m[1],
                 lng: m[2],
                 altitude: m[3] || 0,
                 angle: m[4] || 0,
                 speed: m[5] || 0,
                 params: paramsObj,
                 loc_valid: isGpsValid
              };
           }
           return m;
        });
        
        messages.sort((a, b) => new Date(a.dt_tracker) - new Date(b.dt_tracker));
        
        const oldEpoch = getEpoch(dt_old);
        const newEpoch = getEpoch(dt_new);
        
        messages = messages.filter(m => {
           if (!m.dt_tracker) return false;
           const mEpoch = getEpoch(m.dt_tracker);
           return mEpoch > oldEpoch && mEpoch < newEpoch;
        });
        
        if (messages.length > 0) {
          systemStats.backfillerRecoveredPoints += messages.length;
          console.log(`[Backfiller] 💎 ¡ÉXITO! Se recuperaron ${messages.length} puntos históricos perdidos para ${imei}. Inyectándolos a B2B...`);
          
          for (const msg of messages) {
             const telemetry = {
                 imei: imei,
                 name: msg.name,
                 lat: msg.lat,
                 lng: msg.lng,
                 altitude: msg.altitude || 0,
                 angle: msg.angle || 0,
                 speed: msg.speed || 0,
                 dt_tracker: msg.dt_tracker,
                 dt_server: msg.dt_server,
                 loc_valid: msg.loc_valid !== undefined ? msg.loc_valid : 1,
                 params: msg.params || ''
             };
             await dispatchToB2B(telemetry, client);
             await new Promise(r => setTimeout(r, 100));
          }
          console.log(`[Backfiller] ✅ Inyección de ${messages.length} puntos completada para ${imei}.`);
          return messages.length;
        }
     }
     return 0;
  } catch (err) {
     console.error(`[Backfiller] Error recuperando historial para ${imei}:`, err.message);
     return 0;
  }
}

/**
 * Poll location updates for ALL devices using the Master Key
 */
async function pollGpsServerLocations() {
  if (isGpsServerPolling) return;
  isGpsServerPolling = true;

  lastGpsServerPollTime = new Date().toISOString();
  
  const masterKey = process.env.GPS_SERVER_MASTER_KEY;
  if (!masterKey) {
    lastGpsServerPollStatus = 'Disabled: GPS_SERVER_MASTER_KEY is not configured';
    isGpsServerPolling = false;
    setTimeout(pollGpsServerLocations, GPSSERVER_POLL_INTERVAL);
    return;
  }

  // --- HYDRATE STATE FROM DATALAKE TO SURVIVE RESTARTS ---
  if (!isStateHydrated && pool) {
    try {
      console.log('[GPS Server Poller] Hydrating state from Datalake to survive restarts...');
      const query = `
        SELECT imei, MAX(dt_tracker) as dt_tracker 
        FROM global_telemetry_traffic 
        WHERE created_at >= NOW() - INTERVAL '1 day'
        GROUP BY imei
      `;
      const res = await pool.query(query);
      for (const row of res.rows) {
        if (!lastDeviceTimestamps[row.imei]) {
          // Convert JS Date object to ISO string matching format expected by new Date() comparison
          lastDeviceTimestamps[row.imei] = { dt_tracker: new Date(row.dt_tracker).toISOString().replace('T', ' ').substring(0, 19) };
        }
      }
      console.log(`[GPS Server Poller] Hydrated state for ${res.rows.length} devices. Backfiller is ready for past gaps!`);
      isStateHydrated = true;
    } catch (err) {
      console.error('[GPS Server Poller] Failed to hydrate state:', err.message);
      // We will try again next poll if it failed
    }
  }

  if (Date.now() - lastMappingRefresh > MAPPING_REFRESH_INTERVAL || Object.keys(mappingCache).length === 0) {
    await refreshMappingCache(masterKey);
  }

  let totalDevicesProcessed = 0;

  try {
    const response = await axios.get(GPSSERVER_API_URL, {
      params: {
        api: 'server',
        key: masterKey,
        cmd: 'OBJECT_GET_LOCATIONS,*'
      },
      timeout: 15000
    });

    if (response.data && typeof response.data === 'object') {
      const devices = response.data;
      const imeis = Object.keys(devices);
      console.log(`[GPS Server Poller] Master Key returned ${imeis.length} devices.`);
      
      for (const imei of imeis) {
        try {
          const device = devices[imei];
          if (!device) continue;

          // Resolve client from cache
          const client = mappingCache[imei] || 'unknown';

          totalDevicesProcessed++;
          systemStats.totalPolledPoints++;
        
          const telemetry = {
            imei: imei,
            name: device.name,
            lat: device.lat,
            lng: device.lng,
            altitude: device.altitude || 0,
            angle: device.angle || 0,
            speed: device.speed || 0,
            dt_tracker: device.dt_tracker,
            dt_server: device.dt_server,
            loc_valid: device.loc_valid,
            odometer: device.odometer,
            engine_hours: device.engine_hours,
            params: device.params
          };

           // --- BACKFILLER IA LOGIC ---
          const lastPollerState = lastDeviceTimestamps[imei];
          if (lastPollerState && lastPollerState.dt_tracker) {
             if (device.dt_tracker && device.dt_tracker > lastPollerState.dt_tracker) {
               const timeDiffMs = new Date(device.dt_tracker) - new Date(lastPollerState.dt_tracker);
               const gapSeconds = Math.floor(timeDiffMs / 1000);
               
               const isMoving = parseFloat(device.speed || 0) > 0;
               // Thresholds: 3 mins if moving, 20 mins if parked
               const gapThreshold = isMoving ? 180 : 1200;
               
               if (gapSeconds > gapThreshold && gapSeconds < 259200) {
                 systemStats.backfillerTriggers++;
                 console.log(`[Poller] 📡 Brecha de ${gapSeconds}s detectada para ${imei}. Programando recuperación en 3 mins para permitir que suba su historial...`);
                 
                 // Queue the backfill to run in 3 minutes, giving the tracker time to upload over GPRS
                 pendingBackfills.push({
                   imei: imei,
                   dt_old: lastPollerState.dt_tracker,
                   dt_new: device.dt_tracker,
                   client: client,
                   apiKey: masterKey,
                   executeAt: Date.now() + (3 * 60 * 1000)
                 });
               }
             }
          }

          if (device.dt_tracker) {
             lastDeviceTimestamps[imei] = { dt_tracker: device.dt_tracker };
          }
          // ---------------------------

          await dispatchToB2B(telemetry, client);
        } catch (imeiErr) {
          console.error(`[GPS Server Poller] Error procesando camión ${imei}:`, imeiErr.message);
        }
      }
    } else {
      console.warn(`[GPS Server Poller] Unexpected response format from master key.`);
    }
  } catch (err) {
    console.error(`[GPS Server Poller] Error polling master key:`, err.message);
  }

  lastGpsServerPollStatus = `Cycle complete: processed ${totalDevicesProcessed} devices across ${Object.keys(mappingCache).length} mapped users.`;
  console.log(`[GPS Server Poller] ${lastGpsServerPollStatus}`);
  
  isGpsServerPolling = false;
  setTimeout(pollGpsServerLocations, GPSSERVER_POLL_INTERVAL);
}

// Background Worker: Procesar Backfills Pendientes
setInterval(async () => {
   if (!pendingBackfills || pendingBackfills.length === 0) return;
   
   const now = Date.now();
   const readyTasks = pendingBackfills.filter(task => now >= task.executeAt);
   
   if (readyTasks.length > 0) {
      pendingBackfills.splice(0, pendingBackfills.length, ...pendingBackfills.filter(t => now < t.executeAt));
      for (const task of readyTasks) {
         // Se asume que las tareas pendientes usarán sus keys antiguas (si eran locales),
         // pero si usamos Master Key a partir de ahora, todo el tráfico nuevo usará Master Key.
         await recoverHistory(task.imei, task.dt_old, task.dt_new, task.client, task.apiKey);
      }
   }
}, 30000);

module.exports = {
  pollGpsServerLocations,
  getStatus: () => ({ lastGpsServerPollTime, lastGpsServerPollStatus })
};
