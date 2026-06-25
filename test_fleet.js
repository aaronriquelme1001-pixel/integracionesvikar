const express = require('express');
const fleetRoute = require('./src/routes/fleet');
require('dotenv').config();

const app = express();
app.use('/api/fleet', fleetRoute);

app.listen(3001, async () => {
  console.log('Test server started on 3001');
  try {
    const res = await fetch('http://localhost:3001/api/fleet/history?imei=865413054320576&start_date=23-06-2026&end_date=23-06-2026');
    const json = await res.json();
    console.log(json);
  } catch (e) {
    console.error(e);
  }
  process.exit(0);
});
