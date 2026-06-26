const axios = require('axios');
const { BigQuery } = require('@google-cloud/bigquery');
const fs = require('fs');
const path = require('path');

// Setup BigQuery Client
let bigquery = null;
if (process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON) {
  const credentials = JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON);
  bigquery = new BigQuery({ projectId: credentials.project_id, credentials });
} else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
  bigquery = new BigQuery(); 
} else if (fs.existsSync(path.join(__dirname, '../../bq-key.json'))) {
  bigquery = new BigQuery({ projectId: 'vikargpsdatos', keyFilename: path.join(__dirname, '../../bq-key.json') });
} else {
  console.warn('[Billing Cron] ⚠️ Missing BigQuery credentials.');
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
  if (!bigquery) return 7.0;
  
  try {
    // Buscar los puntos de velocidad y eventos de este vehículo en el día actual
    // OPTIMIZADO: Usa rango de fechas para aprovechar el índice B-Tree en dt_tracker y limita a 10000 para evitar OOM
    const query = `
      SELECT speed, JSON_EXTRACT_SCALAR(params, '$.event') as event, dt_tracker 
      FROM \`telemetry.global_traffic\` 
      WHERE imei = @imei 
      AND dt_tracker >= TIMESTAMP(@snapshotDate)
      AND dt_tracker < TIMESTAMP_ADD(TIMESTAMP(@snapshotDate), INTERVAL 1 DAY)
      ORDER BY dt_tracker ASC
      LIMIT 10000
    `;
    const [rows] = await bigquery.query({
      query,
      params: { imei, snapshotDate: snapshotDateStr }
    });
    
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
    
    for (const row of rows) {
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
  if (!bigquery) {
    console.error('[Billing Cron] No BigQuery configuration found.');
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

      // Insert or Update the snapshot for today using MERGE for BigQuery
      const query = `
        MERGE \`telemetry.billing_snapshots\` T
        USING (SELECT @client_id as client_id, @imei as imei, DATE(@snapshot_date) as snapshot_date, @odometer as odometer, @engine_hours as engine_hours, @daily_grade as daily_grade, @extreme_speeding_count as extreme_speeding_count, @moderate_speeding_count as moderate_speeding_count, @harsh_maneuvers_count as harsh_maneuvers_count, @fatigue_alerts_count as fatigue_alerts_count) S
        ON T.imei = S.imei AND T.snapshot_date = S.snapshot_date
        WHEN MATCHED THEN
          UPDATE SET 
            client_id = S.client_id,
            odometer = S.odometer, 
            engine_hours = S.engine_hours,
            daily_grade = S.daily_grade,
            extreme_speeding_count = S.extreme_speeding_count,
            moderate_speeding_count = S.moderate_speeding_count,
            harsh_maneuvers_count = S.harsh_maneuvers_count,
            fatigue_alerts_count = S.fatigue_alerts_count
        WHEN NOT MATCHED THEN
          INSERT (client_id, imei, snapshot_date, odometer, engine_hours, daily_grade, extreme_speeding_count, moderate_speeding_count, harsh_maneuvers_count, fatigue_alerts_count)
          VALUES (S.client_id, S.imei, S.snapshot_date, S.odometer, S.engine_hours, S.daily_grade, S.extreme_speeding_count, S.moderate_speeding_count, S.harsh_maneuvers_count, S.fatigue_alerts_count)
      `;
      
      await bigquery.query({
        query,
        params: {
          client_id: clientId,
          imei,
          snapshot_date: snapshotDate,
          odometer,
          engine_hours: engineHours,
          daily_grade: stats.grade,
          extreme_speeding_count: stats.extremeCount,
          moderate_speeding_count: stats.moderateCount,
          harsh_maneuvers_count: stats.harshCount,
          fatigue_alerts_count: stats.fatigueCount
        }
      });
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
  runBillingSnapshot();
}

module.exports = { runBillingSnapshot, calculateDailyGrade };
