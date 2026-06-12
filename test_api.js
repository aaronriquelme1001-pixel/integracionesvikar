require('dotenv').config();
const axios = require('axios');

async function test() {
  const apiKey = process.env.GPSSERVER_API_KEY_ALIRORIOS || process.env.GPSSERVER_API_KEY_LUISHERRERA || process.env.GPSSERVER_API_KEY_ADMIN;
  if (!apiKey) {
    console.log("No API Key found.");
    return;
  }

  try {
    const res = await axios.get('http://gsh7.net/id39/api/api.php', {
      params: { api: 'user', key: apiKey, cmd: 'OBJECT_GET_LOCATIONS,*' }
    });
    
    console.log("LOCATIONS:", JSON.stringify(res.data).substring(0, 300));
    const devices = res.data;
    let imei = Object.keys(devices).find(k => devices[k] && devices[k].dt_tracker);
    if (!imei) {
      console.log("No valid device found with dt_tracker.");
      return;
    }
    const dt_new = devices[imei].dt_tracker;
    console.log(`Testing IMEI: ${imei}, dt_new: ${dt_new}`);
    
    // Create dt_old by subtracting 1 hour from dt_new
    const d = new Date(dt_new.replace(' ', 'T') + 'Z');
    d.setHours(d.getHours() - 1);
    const dt_old = d.toISOString().replace('T', ' ').substring(0, 19);
    
    console.log(`Calling OBJECT_GET_MESSAGES,${imei},${dt_old},${dt_new}`);
    
    const resMsg = await axios.get('http://gsh7.net/id39/api/api.php', {
      params: { api: 'user', key: apiKey, cmd: `OBJECT_GET_MESSAGES,${imei},${dt_old},${dt_new}` }
    });
    
    console.log("MESSAGES TYPE:", typeof resMsg.data);
    if (typeof resMsg.data === 'object') {
       if (Array.isArray(resMsg.data)) {
         console.log("Array length:", resMsg.data.length);
         console.log("First element:", resMsg.data[0]);
       } else {
         console.log("Keys:", Object.keys(resMsg.data).slice(0,3));
         const firstKey = Object.keys(resMsg.data)[0];
         console.log("First element:", resMsg.data[firstKey]);
       }
    } else {
       console.log("Data:", String(resMsg.data).substring(0, 500));
    }
  } catch (err) {
    console.error(err.message);
  }
}

test();
