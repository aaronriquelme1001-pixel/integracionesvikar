require('dotenv').config();
const axios = require('axios');

async function main() {
  const masterKey = process.env.GPS_SERVER_MASTER_KEY;
  const gpsUrl = 'http://gsh7.net/id39/api/api.php';
  console.log("Master key first 5 chars:", masterKey ? masterKey.substring(0,5) : "NULL");

  // Query 1: Locations
  const resLoc = await axios.get(gpsUrl, {
    params: { api: 'server', key: masterKey, cmd: 'OBJECT_GET_LOCATIONS' }
  });
  const dataLoc = resLoc.data;
  console.log("Type of response:", typeof dataLoc);
  if (typeof dataLoc === 'object' && dataLoc !== null) {
      console.log("Keys in locations response:", Object.keys(dataLoc).length);
      const imeiToCheck = '869671072743006';
      if (dataLoc[imeiToCheck]) {
          console.log(`FOUND ${imeiToCheck} in Locations!`);
          console.log(dataLoc[imeiToCheck]);
      } else {
          console.log(`${imeiToCheck} NOT FOUND in Locations.`);
      }
      
      // Look for PYWB35 by name
      for (const key in dataLoc) {
          if (dataLoc[key].name && dataLoc[key].name.toUpperCase().includes('PYWB')) {
              console.log(`FOUND NAME PYWB in IMEI ${key}:`, dataLoc[key].name);
          }
      }
  } else {
      console.log("Locations response is not an object:", String(dataLoc).substring(0, 100));
  }
}
main().catch(console.error);
