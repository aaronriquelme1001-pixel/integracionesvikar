const axios = require('axios');
const { dispatchToB2B } = require('../core/dispatcher');
const { systemStats, lastDeviceTimestamps, pendingBackfills } = require('../core/state');

const GPSSERVER_POLL_INTERVAL = parseInt(process.env.GPSSERVER_POLL_INTERVAL, 10) || 10000;
const GPSSERVER_API_URL = process.env.GPSSERVER_API_URL || 'http://gsh7.net/id39/api/api.php';

let lastGpsServerPollTime = null;
let lastGpsServerPollStatus = 'Waiting to start...';
let isGpsServerPolling = false;

/**
 * Función asíncrona para recuperar historial perdido (Túneles o Gaps)
 */
async function recoverHistory(imei, dt_old, dt_new, client, apiKey) {
  try {
     console.log(`[Backfiller] Iniciando recuperación de historial para ${imei}. De: ${dt_old} a ${dt_new}`);
     const response = await axios.get(GPSSERVER_API_URL, {
        params: {
           api: 'user',
           key: apiKey,
           cmd: `OBJECT_GET_MESSAGES,${imei},${dt_old},${dt_new}`
        },
        timeout: 30000
     });
     
     if (response.data && Array.isArray(response.data)) {
        // GPS Server API returns an array of arrays for GET_MESSAGES, not objects!
        // Format: [dt_tracker, lat, lng, altitude, angle, speed, params]
        let messages = response.data.map(m => {
           if (Array.isArray(m)) {
              return {
                 dt_tracker: m[0],
                 dt_server: m[0], // GET_MESSAGES doesn't provide dt_server
                 lat: m[1],
                 lng: m[2],
                 altitude: m[3] || 0,
                 angle: m[4] || 0,
                 speed: m[5] || 0,
                 params: m[6] || {},
                 loc_valid: 1
              };
           }
           return m;
        });
        
        // Ordenar cronológicamente (el más antiguo primero)
        messages.sort((a, b) => new Date(a.dt_tracker) - new Date(b.dt_tracker));
        
        // Filtrar los puntos exactos de los bordes para no duplicar
        messages = messages.filter(m => m.dt_tracker && m.dt_tracker !== dt_old && m.dt_tracker !== dt_new);
        
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
             await new Promise(r => setTimeout(r, 100)); // Pequeña pausa para no saturar
          }
          console.log(`[Backfiller] ✅ Inyección de ${messages.length} puntos completada para ${imei}.`);
        }
     }
  } catch (err) {
     console.error(`[Backfiller] Error recuperando historial para ${imei}:`, err.message);
  }
}

/**
 * Poll location updates for configured GPS Server clients and forward them to B2B targets
 */
async function pollGpsServerLocations() {
  if (isGpsServerPolling) return;
  isGpsServerPolling = true;

  lastGpsServerPollTime = new Date().toISOString();
  const GPSSERVER_POLL_CLIENTS = process.env.GPSSERVER_POLL_CLIENTS;
  if (!GPSSERVER_POLL_CLIENTS) {
    lastGpsServerPollStatus = 'Disabled: GPSSERVER_POLL_CLIENTS is not configured';
    isGpsServerPolling = false;
    setTimeout(pollGpsServerLocations, GPSSERVER_POLL_INTERVAL);
    return;
  }

  const clientsList = GPSSERVER_POLL_CLIENTS.split(',').map(c => c.trim()).filter(Boolean);
  if (clientsList.length === 0) {
    lastGpsServerPollStatus = 'Disabled: Empty client list';
    isGpsServerPolling = false;
    setTimeout(pollGpsServerLocations, GPSSERVER_POLL_INTERVAL);
    return;
  }

  console.log(`[GPS Server Poller] Starting poll cycle for clients: ${clientsList.join(', ')}`);
  let successCount = 0;
  let totalDevicesProcessed = 0;

  for (const client of clientsList) {
    const apiKeyEnvName = `GPSSERVER_API_KEY_${client.toUpperCase()}`;
    const apiKey = process.env[apiKeyEnvName];

    if (!apiKey) {
      console.warn(`[GPS Server Poller] Missing API Key environment variable: ${apiKeyEnvName}`);
      continue;
    }

    try {
      console.log(`[GPS Server Poller] Querying locations for client '${client}'...`);
      const response = await axios.get(GPSSERVER_API_URL, {
        params: {
          api: 'user',
          key: apiKey,
          cmd: 'OBJECT_GET_LOCATIONS,*'
        },
        timeout: 15000
      });

      if (response.data && typeof response.data === 'object') {
        const devices = response.data;
        const imeis = Object.keys(devices);
        console.log(`[GPS Server Poller] Client '${client}' returned ${imeis.length} devices.`);
        
        for (const imei of imeis) {
          const device = devices[imei];
          if (!device) continue;

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
               
               // Sensibilidad dinámica: 45s en movimiento, 5 min (300s) estacionado
               const isMoving = parseFloat(device.speed || 0) > 0;
               const gapThreshold = isMoving ? 45 : 300;
               
               // Evitar falsos positivos por frecuencia de reporte normal
               if (gapSeconds > gapThreshold && gapSeconds < 10800) {
                 systemStats.backfillerTriggers++;
                 console.log(`[Poller] ⚠️ Salto de ${gapSeconds}s detectado en ${imei}. Programando Backfiller en 3 minutos para permitir descarga del tracker...`);
                 
                 // Encolar para 3 minutos en el futuro
                 pendingBackfills.push({
                    imei,
                    dt_old: lastPollerState.dt_tracker,
                    dt_new: device.dt_tracker,
                    client,
                    apiKey,
                    executeAt: Date.now() + 180000 // 3 minutos de retraso
                 });
               }
             }
          }

          if (device.dt_tracker) {
             lastDeviceTimestamps[imei] = { dt_tracker: device.dt_tracker };
          }
          // ---------------------------

          await dispatchToB2B(telemetry, client);
        }
        successCount++;
      } else {
        console.warn(`[GPS Server Poller] Unexpected response format for client '${client}'.`);
      }
    } catch (err) {
      console.error(`[GPS Server Poller] Error polling for client '${client}':`, err.message);
    }
  }

  lastGpsServerPollStatus = `Cycle complete: Success for ${successCount}/${clientsList.length} clients, processed ${totalDevicesProcessed} devices.`;
  console.log(`[GPS Server Poller] ${lastGpsServerPollStatus}`);
  
  isGpsServerPolling = false;
  setTimeout(pollGpsServerLocations, GPSSERVER_POLL_INTERVAL);
}

// Background Worker: Procesar Backfills Pendientes
setInterval(async () => {
   if (!pendingBackfills || pendingBackfills.length === 0) return;
   
   const now = Date.now();
   // Encontrar tareas listas para ejecutarse
   const readyTasks = pendingBackfills.filter(task => now >= task.executeAt);
   
   if (readyTasks.length > 0) {
      for (const task of readyTasks) {
         // Remover la tarea de la cola
         const index = pendingBackfills.indexOf(task);
         if (index > -1) pendingBackfills.splice(index, 1);
         
         // Ejecutar recuperación
         await recoverHistory(task.imei, task.dt_old, task.dt_new, task.client, task.apiKey);
      }
   }
}, 30000); // Revisar cola cada 30 segundos

module.exports = {
  pollGpsServerLocations,
  getStatus: () => ({ lastGpsServerPollTime, lastGpsServerPollStatus })
};
