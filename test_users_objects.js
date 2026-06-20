const axios = require('axios');
require('dotenv').config();

async function testUsersObjects() {
  const masterKey = process.env.GPS_SERVER_MASTER_KEY;
  if (!masterKey) {
    console.log("No master key found locally.");
    return;
  }
  const gpsUrl = 'http://gsh7.net/id39/api/api.php';
  try {
    const response = await axios.get(`${gpsUrl}?api=server&key=${masterKey}&cmd=GET_USERS_OBJECTS`);
    console.log(JSON.stringify(response.data).substring(0, 500));
  } catch (err) {
    console.error(err);
  }
}
testUsersObjects();
