const axios = require('axios');
const { systemStats, deviceAntiSpamState, lastDeviceTimestamps, pendingBackfills, retryQueue } = require('../core/state');
const { dispatchToB2B } = require('../core/dispatcher');
const { BigQuery } = require('@google-cloud/bigquery');
const fs = require('fs');

let bqClient = null;
if (process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON) {
   const credentials = JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON);
   bqClient = new BigQuery({ projectId: credentials.project_id, credentials });
} else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
   bqClient = new BigQuery();
} else if (fs.existsSync('./bq-key.json')) {
   bqClient = new BigQuery({ projectId: 'vikargpsdatos', keyFilename: './bq-key.json' });
}

const waitBufferStates = {}; // { imei: firstWaitMs }
const GPSSERVER_POLL_INTERVAL = parseInt(process.env.GPSSERVER_POLL_INTERVAL, 10) || 10000;
const GPSSERVER_API_URL = process.env.GPSSERVER_API_URL || 'http://gsh7.net/id39/api/api.php';

function getClientApiKey(client) {
  if (!client) return process.env.GPSSERVER_USER_API_KEY || null;
  const clientUpper = String(client).replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
  
  let clientKeys = {};
  try { clientKeys = require('../config/clientKeys.json'); } catch(err) { /* ignore */ }
  
  let key = process.env[`GPSSERVER_API_KEY_${clientUpper}`];
  if (!key) key = clientKeys[clientUpper] || clientKeys[client.toUpperCase()];
  if (!key) {
     const foundKey = Object.keys(clientKeys).find(k => clientUpper.includes(k) || client.toUpperCase().includes(k));
     if (foundKey) key = clientKeys[foundKey];
  }
  return key || process.env.GPSSERVER_USER_API_KEY || null;
}

let lastGpsServerPollTime = null;
let lastGpsServerPollStatus = 'Waiting to start...';
let isGpsServerPolling = false;
let isStateHydrated = false;

// Global mapping cache: { imei -> { client, name } }
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
     
     const pad = n => n.toString().padStart(2, '0');
     const toLocalChileStr = (utcStr, hoursOffset = 0) => {
        if (!utcStr) return NaN;
        const s = String(utcStr).trim().replace(' ', 'T');
        const epoch = new Date(s.includes('Z') ? s : s + 'Z').getTime();
        if (isNaN(epoch)) return NaN;
        // Restar 4 horas para pasar de UTC a hora local de Chile, y sumar el offset adicional
        const d = new Date(epoch - (4 * 3600000) + (hoursOffset * 3600000));
        return `${d.getUTCFullYear()}-${pad(d.getUTCMonth()+1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
     };

     const startEpoch = toLocalChileStr(dt_old, 0) !== NaN ? new Date(String(dt_old).trim().replace(' ', 'T') + 'Z').getTime() : NaN;
     const endEpoch = toLocalChileStr(dt_new, 0) !== NaN ? new Date(String(dt_new).trim().replace(' ', 'T') + 'Z').getTime() : NaN;
     const FOUR_HOURS_MS = 4 * 60 * 60 * 1000;
     
     // CRITICAL: OBJECT_GET_MESSAGES only works with api=user.
     const apiTarget = 'user';

     // Widen API query window because GPS Server API filters by dt_server (arrival time), not dt_tracker.
     const q_old = !isNaN(startEpoch) ? toLocalChileStr(dt_old, -1) : dt_old;
     const q_new = !isNaN(endEpoch) ? toLocalChileStr(dt_new, 3) : dt_new;
     
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
     
     let allMessages = [];

     if (!isNaN(startEpoch) && !isNaN(endEpoch) && (endEpoch - startEpoch) > FOUR_HOURS_MS) {
       console.log(`[Backfiller] 📦 Rango grande detectado. Paginando historial para ${imei}...`);
       
       let currentStart = startEpoch - 1 * 60 * 60 * 1000;
       const finalEnd = endEpoch + 3 * 60 * 60 * 1000;
       
       while (currentStart < finalEnd) {
         let currentEnd = currentStart + FOUR_HOURS_MS;
         if (currentEnd > finalEnd) currentEnd = finalEnd;
         
         const fmt = (epochMs) => {
            // Subtract 4 hours to convert UTC epoch to Local Chile Time
            const d = new Date(epochMs - (4 * 3600000));
            const p = n => n.toString().padStart(2, '0');
            return `${d.getUTCFullYear()}-${p(d.getUTCMonth()+1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`;
         };
         
         const chunkStart = fmt(currentStart);
         const chunkEnd = fmt(currentEnd);
         
         console.log(`[Backfiller] Consultando GPS Server (api=user): OBJECT_GET_MESSAGES,${imei},${chunkStart},${chunkEnd}`);
         const response = await fetchWithRetry(GPSSERVER_API_URL, {
            params: { api: 'user', key: apiKey, cmd: `OBJECT_GET_MESSAGES,${imei},${chunkStart},${chunkEnd}` },
            timeout: 30000
         });

         console.log(`[Backfiller] DEBUG-TRACE: apiKey length=${apiKey ? apiKey.length : 0}, response.data type=${typeof response.data}, isArray=${Array.isArray(response.data)}`);
         
         if (response.data) {
            if (Array.isArray(response.data)) {
               allMessages = allMessages.concat(response.data);
            } else if (typeof response.data === 'object') {
               allMessages = allMessages.concat(Object.values(response.data));
            }
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
        console.log(`[Backfiller] DEBUG-TRACE: allMessages.length = ${allMessages.length} antes del mapeo.`);
        let messages = allMessages.map(m => {
           if (Array.isArray(m)) {
              const paramsObj = m[6] || {};
              const satellites = parseInt(paramsObj.gpslev || paramsObj.sat || paramsObj.satellites || 0, 10);
              const isGpsValid = satellites > 0 ? 1 : 0;
              
              // FIX: GPS Server OBJECT_GET_MESSAGES devuelve hora LOCAL (ej: 2026-06-25 15:00:00).
              // Si le mandamos esto crudo a B2B, Traccar lo asume como UTC y lo retrasa 4 horas.
              // Debemos convertirlo a formato ISO UTC real restando el offset (asumiendo Chile UTC-4).
              let dtTrackerUtc = m[0];
              if (m[0] && m[0].includes(' ')) {
                const parsedDt = new Date(m[0].replace(' ', 'T') + '-04:00');
                if (isNaN(parsedDt.getTime())) return null; // Skip garbage dates like 0000-00-00
                dtTrackerUtc = parsedDt.toISOString();
              }
              
              return {
                 dt_tracker: dtTrackerUtc,
                 dt_server: dtTrackerUtc,
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
        
         messages = messages.filter(Boolean);
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
             await new Promise(r => setTimeout(r, 50)); // Reducido a 50ms para que no tarde horas en inyectar
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

  // --- HYDRATE STATE FROM BIGQUERY DATALAKE TO SURVIVE RESTARTS ---
  if (!isStateHydrated && bqClient) {
    try {
      console.log('[GPS Server Poller] Hydrating state from BigQuery to survive restarts...');
      const query = `
        SELECT imei, MAX(dt_tracker) as dt_tracker 
        FROM \`telemetry.global_traffic\` 
        WHERE created_at >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 1 DAY)
        GROUP BY imei
      `;
      const [rows] = await bqClient.query({ query });
      for (const row of rows) {
        if (!lastDeviceTimestamps[row.imei] && row.dt_tracker) {
          lastDeviceTimestamps[row.imei] = { dt_tracker: new Date(row.dt_tracker.value).toISOString().replace('T', ' ').substring(0, 19) };
        }
      }
      console.log(`[GPS Server Poller] Hydrated state for ${rows.length} devices from BigQuery. Backfiller is ready!`);
      isStateHydrated = true;
    } catch (err) {
      console.error('[GPS Server Poller] Failed to hydrate state from BigQuery:', err.message);
    }
  } else if (!isStateHydrated && !bqClient) {
      // If no BQ configured, we can't hydrate
      isStateHydrated = true;
      console.warn('[GPS Server Poller] BigQuery not configured. State hydration skipped.');
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

            // Resolve client and name from cache
            const cached = mappingCache[imei];
            const client = (cached && cached.client) ? cached.client : (typeof cached === 'string' ? cached : 'unknown');
            const cachedName = (cached && cached.name) ? cached.name : null;

            // Store the vehicle name in the mapping cache for future use by dispatcher
            if (device.name && (!cached || typeof cached === 'string' || !cached.name)) {
              mappingCache[imei] = { client, name: device.name };
            }

            totalDevicesProcessed++;
            systemStats.totalPolledPoints++;
          
            const vehicleName = device.name || cachedName || imei;
            const telemetry = {
              imei: imei,
              name: vehicleName,
              plate: vehicleName,
              lat: device.lat,
              lng: device.lng,
              altitude: device.altitude || 0,
              angle: device.angle || 0,
              speed: device.speed || 0,
              dt_tracker: device.dt_tracker, // Is already UTC from GET_LOCATIONS
              dt_server: device.dt_server,   // Is already UTC from GET_LOCATIONS
              loc_valid: device.loc_valid,
              odometer: device.odometer,
              engine_hours: device.engine_hours,
              params: device.params
            };

            // --- BACKFILLER IA LOGIC ---
            const lastPollerState = lastDeviceTimestamps[imei];
            let sentAllIntermediatePoints = false;

            if (lastPollerState && lastPollerState.dt_tracker) {
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
                 const isMoving = parseFloat(device.speed || 0) > 0;

                 // IMMEDIATE RECOVERY: If vehicle is moving and we missed intermediate points (gap > 15s),
                 // query GPS Server for ALL points in that window right now — don't wait 6 minutes.
                 // This makes Traccar receive every 10-second point, matching GPS Server's native view.
                  if (isMoving && gapSeconds > 15 && gapSeconds < 259200) {
                    try {
                      const userApiKey = getClientApiKey(client);
                      
                      if (userApiKey) {
                       // Query all intermediate points from GPS Server (add 5s buffer each side)
                       const fmtLocal = (epochMs) => {
                         const d = new Date(epochMs - (4 * 3600000)); // Translate UTC epoch back to Local representation
                         const p = n => n.toString().padStart(2, '0');
                         return `${d.getUTCFullYear()}-${p(d.getUTCMonth()+1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`;
                       };
                       const qStart = fmtLocal(lastEpoch - 5000);
                       const qEnd   = fmtLocal(deviceEpoch + 5000);
                       
                       const msgResponse = await axios.get(GPSSERVER_API_URL, {
                         params: { api: 'user', key: userApiKey, cmd: `OBJECT_GET_MESSAGES,${imei},${qStart},${qEnd}` },
                         timeout: 10000
                       });
                       
                       let intermediatePoints = [];
                       if (Array.isArray(msgResponse.data) && msgResponse.data.length > 1) {
                         intermediatePoints = msgResponse.data;
                       } else if (msgResponse.data && typeof msgResponse.data === 'object' && !Array.isArray(msgResponse.data)) {
                         intermediatePoints = Object.values(msgResponse.data);
                       }
                       
                       if (intermediatePoints.length > 1) {
                         // Sort chronologically and dispatch each point
                         const sorted = intermediatePoints
                           .filter(m => Array.isArray(m) && m[0])
                           .sort((a, b) => new Date(a[0]) - new Date(b[0]));
                         
                         console.log(`[Poller] ⚡ Recuperando ${sorted.length} puntos intermedios para ${vehicleName} (gap ${gapSeconds}s)`);
                         
                         for (const m of sorted) {
                           const paramsObj = m[6] || {};
                           const sats = parseInt(paramsObj.gpslev || paramsObj.sat || 0, 10);
                            let dtUtc = m[0];
                            if (m[0] && m[0].includes(' ')) {
                              const parsedDt = new Date(m[0].replace(' ', 'T') + 'Z');
                              if (isNaN(parsedDt.getTime())) continue; // Skip garbage dates like 0000-00-00
                              dtUtc = parsedDt.toISOString();
                            }
                           const intermediatePoint = {
                             imei, name: vehicleName, plate: vehicleName,
                             dt_tracker: dtUtc, dt_server: dtUtc,
                             lat: m[1], lng: m[2],
                             altitude: m[3] || 0, angle: m[4] || 0, speed: m[5] || 0,
                             params: paramsObj, loc_valid: sats > 0 ? 1 : 0
                           };
                           await dispatchToB2B(intermediatePoint, client);
                         }
                         sentAllIntermediatePoints = true;
                         systemStats.backfillerTriggers++;
                       }
                     }
                   } catch (msgErr) {
                     // If intermediate recovery fails, fall through to send just current point
                     console.warn(`[Poller] No se pudieron recuperar puntos intermedios para ${imei}: ${msgErr.message}`);
                   }
                 }

                 // Large offline gaps (> 10 min): schedule delayed backfill as before
                 if (gapSeconds > 600 && gapSeconds < 259200) {
                   const userApiKey = getClientApiKey(client) || masterKey;
                   pendingBackfills.push({
                     imei, dt_old: lastPollerState.dt_tracker, dt_new: device.dt_tracker,
                     client, apiKey: userApiKey, executeAt: Date.now() + (6 * 60 * 1000)
                   });
                   systemStats.backfillerTriggers++;
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

            // Only dispatch the current point if we didn't already send all intermediate ones
            if (!sentAllIntermediatePoints) {
              await dispatchToB2B(telemetry, client);
            }
          } catch (imeiErr) {
            console.error(`[GPS Server Poller] Error procesando camión ${imei}:`, imeiErr.stack);
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
  getStatus: () => ({ lastGpsServerPollTime, lastGpsServerPollStatus }),
  recoverHistory,
  getMappingCache: () => mappingCache,
  getClientForImei: (imei) => {
    const c = mappingCache[imei];
    if (!c) return null;
    return typeof c === 'string' ? c : c.client;
  }
};
