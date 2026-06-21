const axios = require('axios');
require('dotenv').config();

async function checkKeys() {
  const masterKey = process.env.GPS_SERVER_MASTER_KEY;
  const gpsUrl = 'http://gsh7.net/id39/api/api.php';
  try {
    const response = await axios.get(`${gpsUrl}?api=server&key=${masterKey}&cmd=GET_USERS_OBJECTS`);
    if (response.data && response.data.length > 0) {
      console.log("Keys available:", Object.keys(response.data[0]));
      console.log("First user:", { username: response.data[0].username, email: response.data[0].email, subuser: response.data[0].subuser });
    }
  } catch (err) {
    console.error(err);
  }
}
checkKeys();
