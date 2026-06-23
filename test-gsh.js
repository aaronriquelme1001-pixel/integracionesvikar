require('dotenv').config();
const axios = require('axios');
const masterKey = process.env.GPS_SERVER_MASTER_KEY;
axios.get(`http://gsh7.net/id39/api/api.php?api=server&key=${masterKey}&cmd=OBJECT_GET_MESSAGES,865413054322192,2026-06-23 15:49:44,2026-06-23 16:00:03`)
  .then(res => console.log(JSON.stringify(res.data).substring(0, 500)))
  .catch(console.error);
