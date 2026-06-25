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
     
     // Simple and robust local time math: 
     // dt_old and dt_new are strings in Local Time (e.g. "2026-06-25 14:45:32").
     // We parse them as UTC to easily add/subtract hours without timezone shifts, 
     // then format them back to strings for the GPS Server query.
     const pad = n => n.toString().padStart(2, '0');
     const addHours = (dtStr, hoursOffset) => {
        if (!dtStr) return NaN;
        const s = String(dtStr).trim().replace(' ', 'T');
        // Treat local time string as UTC for pure math
        const epoch = new Date(s.includes('Z') ? s : s + 'Z').getTime();
        if (isNaN(epoch)) return NaN;
        const d = new Date(epoch + (hoursOffset * 60 * 60 * 1000));
        return `${d.getUTCFullYear()}-${pad(d.getUTCMonth()+1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
     };

     const startEpoch = addHours(dt_old, 0) !== NaN ? new Date(String(dt_old).trim().replace(' ', 'T') + 'Z').getTime() : NaN;
     const endEpoch = addHours(dt_new, 0) !== NaN ? new Date(String(dt_new).trim().replace(' ', 'T') + 'Z').getTime() : NaN;
     const FOUR_HOURS_MS = 4 * 60 * 60 * 1000;
     
     // CRITICAL: OBJECT_GET_MESSAGES only works with api=user.
     const apiTarget = 'user';

     // Widen API query window because GPS Server API filters by dt_server (arrival time), not dt_tracker.
     const q_old = !isNaN(startEpoch) ? addHours(dt_old, -1) : dt_old;
     const q_new = !isNaN(endEpoch) ? addHours(dt_new, 3) : dt_new;
     
     console.log(`[Backfiller] Fechas parseadas para ${imei}: dt_old="${dt_old}" → q_old="${q_old}" | dt_new="${dt_new}" → q_new="${q_new}"`);

     async function fetchWithRetry(url, config, retries = 3) {
         for (let i = 0; i < retries; i++) {
            try {
               return await axios.get(url, config);
            } catch (err) {
               if (i === retries - 1) throw err;
               console.warn(`[Backfiller] Request failed for ${imei} (${err.message}). Retry ${i+1}/${retries}...`);
               await new Promise(r => setTimeout(r, 2000 * (i + 1)));
            }
         }
     }

     if (!isNaN(startEpoch) && !isNaN(endEpoch) && (endEpoch - startEpoch) > FOUR_HOURS_MS) {
       console.log(`[Backfiller] 📦 Rango grande detectado. Paginando historial para ${imei}...`);
       
       let currentStart = startEpoch - 1 * 60 * 60 * 1000;
       const finalEnd = endEpoch + 3 * 60 * 60 * 1000;
       
       while (currentStart < finalEnd) {
         let currentEnd = currentStart + FOUR_HOURS_MS;
         if (currentEnd > finalEnd) currentEnd = finalEnd;
         
         const chunkStart = fmt(currentStart);
         const chunkEnd = fmt(currentEnd);
         
         console.log(`[Backfiller] Consultando GPS Server (api=user): OBJECT_GET_MESSAGES,${imei},${chunkStart},${chunkEnd}`);
         const response = await fetchWithRetry(GPSSERVER_API_URL, {
            params: { api: 'user', key: apiKey, cmd: `OBJECT_GET_MESSAGES,${imei},${chunkStart},${chunkEnd}` },
            timeout: 30000
         });
         
         if (response.data && Array.isArray(response.data)) {
            allMessages = allMessages.concat(response.data);
         }
         currentStart = currentEnd;
         await new Promise(r => setTimeout(r, 500));
       }
     } else {
       console.log(`[Backfiller] Consultando GPS Server (api=user): OBJECT_GET_MESSAGES,${imei},${q_old},${q_new}`);
       const response = await fetchWithRetry(GPSSERVER_API_URL, {
          params: { api: 'user', key: apiKey, cmd: `OBJECT_GET_MESSAGES,${imei},${q_old},${q_new}` },
          timeout: 30000
       });
       console.log(`[Backfiller] GPS Server respondió para ${imei}:`, typeof response.data, Array.isArray(response.data) ? response.data.length + ' puntos' : JSON.stringify(response.data).substring(0, 100));
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

         // FIX #2: The previous filter applied timezone offset to messages that may already be in local time,
         // causing valid recovered points to be discarded as "out of range".
         // We already widened the API query window above (±1h to +3h), so we trust the GPS Server's response.
         // Instead of a strict epoch filter, we only remove obviously invalid points (no coords, no timestamp).
         const simpleEpoch = (ds) => new Date(String(ds).trim().replace(' ', 'T') + (String(ds).includes('Z') ? '' : 'Z')).getTime();
         const oldEpochForFilter = simpleEpoch(dt_old);
         const newEpochForFilter = simpleEpoch(dt_new);
         const TOLERANCE_MS = 4 * 60 * 60 * 1000; // 4h tolerance for timezone ambiguity

         messages = messages.filter(m => {
            if (!m.dt_tracker) return false;
            if (isNaN(parseFloat(m.lat)) || isNaN(parseFloat(m.lng))) return false;
            const mEpoch = simpleEpoch(m.dt_tracker);
            if (isNaN(mEpoch)) return false;
            // Accept point if it falls within the gap window + tolerance on both sides
            return mEpoch > (oldEpochForFilter - TOLERANCE_MS) && mEpoch < (newEpochForFilter + TOLERANCE_MS);
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
             await new Promise(r => setTimeout(r, 1000)); // FIX: Increased to 1000ms to prevent rate limit (spam) blocks
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
      
      // Ejecución concurrente en lotes de 50 para evitar estrangular la RAM pero maximizar I/O
      const chunkSize = 50;
      for (let i = 0; i < imeis.length; i += chunkSize) {
        const chunk = imeis.slice(i, i + chunkSize);
        
        await Promise.all(chunk.map(async (imei) => {
          try {
            const device = devices[imei];
            if (!device) return;

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
               // FIX #3: Convert both timestamps to numeric epoch before comparing.
               // Comparing date strings directly (> operator) is fragile and fails with
               // inconsistent zero-padding (e.g. "2026-6-4 9:00:00" vs "2026-06-04 09:00:00").
               const tz = process.env.TIMEZONE_OFFSET || '-04:00';
               const parseLocalEpoch = (ds) => {
                 if (!ds) return NaN;
                 if (ds.includes('T') && (ds.includes('Z') || ds.match(/[+-]\d{2}:\d{2}$/))) return new Date(ds).getTime();
                 return new Date(ds.replace(' ', 'T') + tz).getTime();
               };
               const deviceEpoch = parseLocalEpoch(device.dt_tracker);
               const lastEpoch = parseLocalEpoch(lastPollerState.dt_tracker);

               if (device.dt_tracker && !isNaN(deviceEpoch) && !isNaN(lastEpoch) && deviceEpoch > lastEpoch) {
                 const timeDiffMs = deviceEpoch - lastEpoch;
                 const gapSeconds = Math.floor(timeDiffMs / 1000);
                 
                 if (!isNaN(gapSeconds)) {
                   let distanceMeters = 0;
                   if (lastPollerState.lat && lastPollerState.lng && device.lat && device.lng) {
                     const R = 6371e3;
                     const lat1 = parseFloat(lastPollerState.lat) * Math.PI/180;
                     const lat2 = parseFloat(device.lat) * Math.PI/180;
                     const dLat = (parseFloat(device.lat) - parseFloat(lastPollerState.lat)) * Math.PI/180;
                     const dLng = (parseFloat(device.lng) - parseFloat(lastPollerState.lng)) * Math.PI/180;
                     const rawA = Math.sin(dLat/2) * Math.sin(dLat/2) + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng/2) * Math.sin(dLng/2);
                     const a = Math.min(1, Math.max(0, rawA));
                     const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
                     distanceMeters = R * c;
                   }

                   // Was it moving at the end of the trip, OR did it travel > 5km/h on average during the gap?
                   const isMoving = parseFloat(device.speed || 0) > 0 || (gapSeconds > 0 && (distanceMeters / gapSeconds) > 1.38);
                   
                   // Thresholds: 30 seconds if moving, 20 mins if parked (ajustado para alta velocidad)
                   const gapThreshold = isMoving ? 30 : 1200;
                   
                   if (gapSeconds > gapThreshold && gapSeconds < 259200) {
                     systemStats.backfillerTriggers++;
                     
                     // OBJECT_GET_MESSAGES ONLY works with api=user (api=server always returns empty).
                     // Use GPSSERVER_USER_API_KEY (a user-level key from GPS Server settings).
                     // Per-client keys as fallback, then last resort is masterKey (may not work).
                     const clientUpper = (client || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
                     const userApiKey = process.env.GPSSERVER_USER_API_KEY
                       || process.env[`GPSSERVER_API_KEY_${clientUpper}`]
                       || masterKey; // last resort — may not work if server≠user key
                     
                     console.log(`[Poller] 📡 Brecha de ${gapSeconds}s detectada para ${imei}. Usando clave: ${userApiKey === process.env.GPSSERVER_USER_API_KEY ? 'GPSSERVER_USER_API_KEY' : 'Alternative Key'}. Programando recuperación en 6 mins...`);

                     // Queue the backfill to run in 6 minutes, giving the tracker time to upload over GPRS
                     pendingBackfills.push({
                       imei: imei,
                       dt_old: lastPollerState.dt_tracker,
                       dt_new: device.dt_tracker,
                       client: client,
                       apiKey: userApiKey,
                       executeAt: Date.now() + (6 * 60 * 1000)
                     });
                   }
                 }
               }
            }

            if (device.dt_tracker) {
               lastDeviceTimestamps[imei] = { 
                 dt_tracker: device.dt_tracker,
                 lat: device.lat,
                 lng: device.lng
               };
            }
            // ---------------------------

            await dispatchToB2B(telemetry, client);
          } catch (imeiErr) {
            console.error(`[GPS Server Poller] Error procesando camión ${imei}:`, imeiErr.message);
          }
        }));
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
         // Fix: Pass true as the 6th argument because task.apiKey is a Master Key
         const recoveredCount = await recoverHistory(task.imei, task.dt_old, task.dt_new, task.client, task.apiKey, true);
         
         // Retry logic: If no points were recovered, give the physical tracker more time to upload
         if (recoveredCount === 0) {
             task.retries = (task.retries || 0) + 1;
             if (task.retries <= 11) {
                 task.executeAt = Date.now() + (5 * 60 * 1000); // Try again in 5 minutes
                 console.log(`[Backfiller] Reintentando (${task.retries}/11) para ${task.imei} en 5 minutos...`);
                 pendingBackfills.push(task);
             } else {
                 console.warn(`[Backfiller] Se rindió con ${task.imei} tras ${task.retries} intentos. El GPS no subió la data.`);
             }
         }
      }
   }
}, 30000);

module.exports = {
  pollGpsServerLocations,
  getStatus: () => ({ lastGpsServerPollTime, lastGpsServerPollStatus })
};
