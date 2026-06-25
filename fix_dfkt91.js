const axios = require('axios');
const { Pool } = require('pg');
const { dispatchToB2B } = require('./src/core/dispatcher');
require('dotenv').config();

const GPSSERVER_API_URL = 'http://gsh7.net/id39/api/api.php';

async function run() {
  const imei = '865413053854286';
  const start = '2026-06-23 16:30:00';
  const end = '2026-06-23 17:15:00';

  console.log(`Fetching history for ${imei} from ${start} to ${end}`);
  try {
    const res = await axios.get(GPSSERVER_API_URL, {
      params: { api: 'server', key: process.env.GPS_SERVER_MASTER_KEY, cmd: `OBJECT_GET_MESSAGES,${imei},${start},${end}` }
    });

    let allMessages = res.data;
    if (typeof allMessages === 'object' && !Array.isArray(allMessages)) {
      allMessages = Object.values(allMessages);
    }
    
    if (!Array.isArray(allMessages)) {
      console.log('No messages returned');
      process.exit(0);
    }

    console.log(`Got ${allMessages.length} raw points`);
    
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

    for (const msg of messages) {
       const telemetry = {
           imei: imei,
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
       // Only push to traccar logic instead of dispatch to avoid datalake duplication
       const url = process.env.TRACCAR_API_URL || 'http://demo3.traccar.org:5055/';
       const dateStr = msg.dt_tracker;
       const tz = process.env.TIMEZONE_OFFSET || '-04:00';
       const parsedDate = new Date(dateStr.replace(' ', 'T') + tz);
       const unixTimestamp = Math.floor(parsedDate.getTime() / 1000);

       await axios.get(url, {
         params: {
           id: imei,
           lat: msg.lat,
           lon: msg.lng,
           speed: msg.speed,
           bearing: msg.angle,
           altitude: msg.altitude || 0,
           timestamp: unixTimestamp,
           valid: 'true'
         }
       }).catch(e=>console.error('Traccar reject', e.message));
       await new Promise(r => setTimeout(r, 50));
    }
    console.log(`Done pushing ${messages.length} points to Traccar.`);
    process.exit(0);
  } catch (err) {
    console.error(err.message);
  }
}

run();
