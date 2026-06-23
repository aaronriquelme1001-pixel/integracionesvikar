const axios = require('axios');
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

// Setup DB Pool
let pool = null;
if (process.env.DATALAKE_URL) {
  pool = new Pool({
    connectionString: process.env.DATALAKE_URL,
    ssl: { rejectUnauthorized: false }
  });
}

async function getDeviceMappings() {
  const configPath = path.join(__dirname, '../../config/devices.json');
  if (fs.existsSync(configPath)) {
    const data = JSON.parse(await fs.promises.readFile(configPath, 'utf8'));
    return data.devices || data || {};
  }
  return {};
}

async function calculateDailyGrade(imei, snapshotDateStr) {
  if (!pool) return 7.0;
  
  try {
    // Buscar los puntos de velocidad y eventos de este vehículo en el día actual
    // OPTIMIZADO: Usa rango de fechas para aprovechar el índice B-Tree en dt_tracker y limita a 10000 para evitar OOM
    const query = `
      SELECT speed, event, dt_tracker 
      FROM global_telemetry_traffic 
      WHERE imei = $1 
      AND dt_tracker >= $2::date 
      AND dt_tracker < ($2::date + INTERVAL '1 day')
      ORDER BY dt_tracker ASC
      LIMIT 10000
    `;
    const result = await pool.query(query, [imei, snapshotDateStr]);
    
    let penalty = 0.0;
    
    // Contadores de infracciones agrupadas
    let extremeCount = 0;
    let moderateCount = 0;
    let harshCount = 0;
    let fatigueCount = 0;

    // Cooldown variables (5 minutos)
    let lastExtremeSpeedingTime = 0;
    let lastModerateSpeedingTime = 0;
    let lastHarshManeuverTime = 0;
    
    // Variables para algoritmo de Fatiga (Matemático)
    let continuousDrivingMs = 0;
    let lastMovingTime = null;
    let lastPointTime = null;
    let fatiguePenalized = false;
    
    for (const row of result.rows) {
      const speed = parseFloat(row.speed) || 0;
      const event = row.event ? row.event.toLowerCase() : null;
      const dt = new Date(row.dt_tracker).getTime();
      
      // 1. Penalizaciones por Velocidad con Clustering (Cooldown 5 mins = 300,000 ms)
      if (speed > 120) {
        if (!lastExtremeSpeedingTime || (dt - lastExtremeSpeedingTime) > 300000) {
          penalty += 0.2;
          extremeCount++;
          lastExtremeSpeedingTime = dt;
        }
      } else if (speed > 90) {
        if (!lastModerateSpeedingTime || (dt - lastModerateSpeedingTime) > 300000) {
          penalty += 0.05;
          moderateCount++;
          lastModerateSpeedingTime = dt;
        }
      }
      
      // 2. Penalizaciones por Eventos Bruscos Nativos con Clustering
      if (event === 'haccel' || event === 'hbrake' || event === 'hcorn') {
        if (!lastHarshManeuverTime || (dt - lastHarshManeuverTime) > 300000) {
          penalty += 0.3;
          harshCount++;
          lastHarshManeuverTime = dt;
        }
      }

      if (event === 'fatigue' || event === 'tired') {
        if (!fatiguePenalized) {
          penalty += 0.5;
          fatigueCount++;
          fatiguePenalized = true; // Ya penalizado por evento nativo
        }
      }
      
      // 3. Algoritmo de Fatiga (Conducción Continua > 5 hrs)
      if (!fatiguePenalized && dt && lastPointTime) {
        const gapMs = dt - lastPointTime;
        
        if (speed > 5) {
          // Si va manejando
          if (!lastMovingTime) {
            lastMovingTime = dt;
          } else {
            // Si el gap es menor a 30 mins, sigue siendo el mismo viaje continuo
            if (gapMs < 30 * 60 * 1000) {
              continuousDrivingMs += gapMs;
            } else {
              // Descansó más de 30 mins, reiniciar contador
              continuousDrivingMs = 0;
              lastMovingTime = dt;
            }
          }
          
          // 5 horas = 5 * 60 * 60 * 1000 = 18,000,000 ms
          if (continuousDrivingMs > 18000000) {
            penalty += 0.5; // Falta Grave por conducir +5 horas seguidas
            fatigueCount++;
            fatiguePenalized = true; // Penalizar solo 1 vez al día para no hundir la nota a 1.0 por el mismo viaje
          }
        } else {
          // Si está detenido por más de 30 mins, resetear
          if (gapMs >= 30 * 60 * 1000) {
             continuousDrivingMs = 0;
             lastMovingTime = null;
          }
        }
      }
      lastPointTime = dt;
    }
    
    let finalGrade = 7.0 - penalty;
    if (finalGrade < 1.0) finalGrade = 1.0;
    
    // Redondear a 1 decimal
    return {
      grade: Math.round(finalGrade * 10) / 10,
      extremeCount,
      moderateCount,
      harshCount,
      fatigueCount
    };
  } catch (err) {
    console.error(`[Billing Cron] Error calculating grade for ${imei}:`, err.message);
    return { grade: 7.0, extremeCount: 0, moderateCount: 0, harshCount: 0, fatigueCount: 0 };
  }
}

async function runBillingSnapshot() {
  if (!pool) {
    console.error('[Billing Cron] No DATALAKE_URL provided.');
    return;
  }
  
  const masterKey = process.env.GPS_SERVER_MASTER_KEY;
  const gpsUrl = process.env.GPS_SERVER_URL ? process.env.GPS_SERVER_URL.replace('api_loc.php', 'api.php') : 'http://gsh7.net/id39/api/api.php';
  
  if (!masterKey) {
    console.error('[Billing Cron] Missing GPS_SERVER_MASTER_KEY in environment.');
    return;
  }

  console.log('[Billing Cron] Starting daily snapshot of odometers and driver grading...');
  const deviceMappings = await getDeviceMappings();
  
  // Create Date and adjust for UTC-4 (Chile Standard Time) to prevent "tomorrow" jumps at night
  const d = new Date();
  d.setHours(d.getHours() - 4);
  const snapshotDate = d.toISOString().split('T')[0]; // YYYY-MM-DD
  
  try {
    // 1. Fetch all telemetry from GPS Server (Master Key)
    const response = await axios.get(`${gpsUrl}?api=server&key=${masterKey}&cmd=OBJECT_GET_LOCATIONS`);
    const objects = response.data;
    
    // 2. Auto-Discover Mappings from GPS Server (GET_USERS_OBJECTS)
    let dynamicMappings = {};
    try {
      const mappingResponse = await axios.get(`${gpsUrl}?api=server&key=${masterKey}&cmd=GET_USERS_OBJECTS`);
      const usersData = mappingResponse.data;
      
      // Analizador robusto: no sabemos la estructura exacta, así que buscamos patrones
      if (Array.isArray(usersData)) {
        for (const userObj of usersData) {
          const clientName = userObj.username || userObj.email || 'unknown';
          const items = userObj.objects || userObj.items || {};
          
          if (Array.isArray(items)) {
            for (const item of items) {
               if (typeof item === 'string') dynamicMappings[item] = clientName;
               else if (item.imei) dynamicMappings[item.imei] = clientName;
            }
          } else if (typeof items === 'object' && items !== null) {
            for (const key in items) {
               const val = items[key];
               if (typeof val === 'string') dynamicMappings[val] = clientName;
               else dynamicMappings[key] = clientName;
            }
          }
        }
      } else if (typeof usersData === 'object' && usersData !== null) {
        for (const clientName in usersData) {
          const items = usersData[clientName];
          // Si el valor es un objeto de vehículos
          if (typeof items === 'object' && items !== null && !Array.isArray(items)) {
             for (const key in items) {
                const val = items[key];
                if (typeof val === 'string') {
                   // Formato: { "0": "imei123" }
                   dynamicMappings[val] = clientName;
                } else {
                   // Formato: { "imei123": { ... } }
                   dynamicMappings[key] = clientName;
                }
             }
          } else if (Array.isArray(items)) {
             for (const item of items) {
                if (item.imei) dynamicMappings[item.imei] = clientName;
                else dynamicMappings[item] = clientName; // array of strings
             }
          }
        }
      }
      console.log(`[Billing Cron] Auto-discovered ${Object.keys(dynamicMappings).length} vehicle mappings from GPS Server.`);
    } catch (err) {
      console.error('[Billing Cron] Failed to auto-discover from GET_USERS_OBJECTS:', err.message);
    }

    let insertedCount = 0;
    
    for (const imei in objects) {
      const data = objects[imei];
      const odometer = data.odometer || 0;
      const engineHours = data.engine_hours || 0;
      
      // Auto-assign client based on Data Lake history, fallback to config file
      let clientId = dynamicMappings[imei];
      
      if (!clientId) {
        const config = deviceMappings[imei];
        if (config && config.integrations) {
          for (const key in config.integrations) {
            if (config.integrations[key].client) {
              clientId = config.integrations[key].client;
              break;
            }
          }
        }
      }
      
      if (!clientId || clientId === 'unknown') continue; // We only care about mapped clients

      // Calculate driving score for today (Speed, Harsh Events, Fatigue)
      const stats = await calculateDailyGrade(imei, snapshotDate);

      // Insert or Update the snapshot for today
      const query = `
        INSERT INTO billing_snapshots (
          client_id, imei, snapshot_date, odometer, engine_hours, daily_grade,
          extreme_speeding_count, moderate_speeding_count, harsh_maneuvers_count, fatigue_alerts_count
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        ON CONFLICT (imei, snapshot_date) DO UPDATE SET 
          client_id = EXCLUDED.client_id,
          odometer = EXCLUDED.odometer, 
          engine_hours = EXCLUDED.engine_hours,
          daily_grade = EXCLUDED.daily_grade,
          extreme_speeding_count = EXCLUDED.extreme_speeding_count,
          moderate_speeding_count = EXCLUDED.moderate_speeding_count,
          harsh_maneuvers_count = EXCLUDED.harsh_maneuvers_count,
          fatigue_alerts_count = EXCLUDED.fatigue_alerts_count;
      `;
      
      await pool.query(query, [
        clientId, imei, snapshotDate, odometer, engineHours, stats.grade,
        stats.extremeCount, stats.moderateCount, stats.harshCount, stats.fatigueCount
      ]);
      insertedCount++;
    }
    
    console.log(`[Billing Cron] Successfully took snapshot and graded ${insertedCount} devices on ${snapshotDate}.`);
    return {
      status: 'success',
      insertedCount,
      dynamicMappingsCount: Object.keys(dynamicMappings).length,
      sampleMappings: Object.entries(dynamicMappings).slice(0, 5)
    };
  } catch (err) {
    console.error('[Billing Cron] Critical Error:', err);
    throw err; // throw to be caught by the endpoint
  } finally {
    // Let pool open since it might be used by index.js in production, but in cron script standalone we should close it.
    // The pool is a global singleton, so we'll leave it as is.
  }
}

// If run directly
if (require.main === module) {
  require('dotenv').config();
  runBillingSnapshot().then(() => pool && pool.end());
}

module.exports = { runBillingSnapshot, calculateDailyGrade };
