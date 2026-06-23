require('dotenv').config();
const axios = require('axios');
const { dispatchToB2B } = require('./src/core/dispatcher');

async function manualBackfill() {
  const imei = '869671072743006'; // PYWB35
  const dt_old = '2026-06-22 08:09:00';
  const dt_new = '2026-06-22 08:20:00';
  const masterKey = process.env.GPS_SERVER_MASTER_KEY;
  const GPSSERVER_API_URL = 'http://gsh7.net/id39/api/api.php';

  console.log(`[Manual Backfill] Fetching history for ${imei} from ${dt_old} to ${dt_new}...`);

  try {
    const response = await axios.get(GPSSERVER_API_URL, {
      params: { 
        api: 'server', 
        key: masterKey, 
        cmd: `OBJECT_GET_MESSAGES,${imei},${dt_old},${dt_new}` 
      },
      timeout: 30000
    });

    let resData = response.data;
    let allMessages = [];
    if (resData) {
      if (Array.isArray(resData)) {
         allMessages = resData;
      } else if (typeof resData === 'object') {
         allMessages = Object.values(resData);
      }
    }

    if (allMessages.length === 0) {
      console.log('No messages found in API.');
      return;
    }

    let messages = allMessages.map(m => {
       if (Array.isArray(m)) {
          const paramsObj = m[6] || {};
          const satellites = parseInt(paramsObj.gpslev || paramsObj.sat || paramsObj.satellites || 0, 10);
          return {
             dt_tracker: m[0],
             dt_server: m[0],
             lat: m[1],
             lng: m[2],
             altitude: m[3] || 0,
             angle: m[4] || 0,
             speed: m[5] || 0,
             params: paramsObj,
             loc_valid: satellites > 0 ? 1 : 0
          };
       }
       return m;
    });

    messages.sort((a, b) => new Date(a.dt_tracker) - new Date(b.dt_tracker));
    
    console.log(`[Manual Backfill] Retrieved ${messages.length} points. Injecting to B2B...`);
    let injected = 0;

    for (const msg of messages) {
       const telemetry = {
           imei: imei,
           name: 'PYWB35',
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
       // Dispatch to Traccar and Datalake
       await dispatchToB2B(telemetry);
       injected++;
       await new Promise(r => setTimeout(r, 100)); // Delay to not flood Traccar
    }

    console.log(`[Manual Backfill] Successfully injected ${injected} points to Traccar.`);
  } catch (err) {
    console.error('Error in manual backfill:', err.message);
  }
}

manualBackfill().catch(console.error);
