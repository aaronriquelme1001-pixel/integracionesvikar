const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');

const MIDDLEWARE_PORT = 3001;

// 1. Setup Mock B2B Servers
const colunApp = express();
colunApp.use(bodyParser.json());
colunApp.post('/tracking/receiver/hub/v2', (req, res) => {
  console.log('\n[Mock Colun API] Received telemetry:');
  console.log('Headers:', { authorization: req.headers.authorization });
  console.log('Body:', req.body);
  res.json({ success: true, message: 'Received' });
});

const araucoApp = express();
araucoApp.use(bodyParser.text({ type: 'text/xml' }));
araucoApp.post('/GPSChileWS/GPSChileWS.asmx', (req, res) => {
  console.log('\n[Mock Arauco SOAP API] Received SOAP Envelope:');
  console.log('SOAPAction:', req.headers.soapaction);
  console.log('XML Body:', req.body);
  res.send(`<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <WM_INS_ACTIVIDAD0_GPS_MasivoResponse xmlns="http://siscoWS">
      <WM_INS_ACTIVIDAD0_GPS_MasivoResult>CORRECTO</WM_INS_ACTIVIDAD0_GPS_MasivoResult>
    </WM_INS_ACTIVIDAD0_GPS_MasivoResponse>
  </soap:Body>
</soap:Envelope>`);
});

const unigisApp = express();
unigisApp.use(bodyParser.text({ type: 'text/xml' }));
unigisApp.post('/hub_TEST/mapi/soap/gps/service.asmx', (req, res) => {
  console.log('\n[Mock UNIGIS SOAP API] Received SOAP Envelope:');
  console.log('SOAPAction:', req.headers.soapaction);
  console.log('XML Body:', req.body);
  res.send(`<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <LoginYInsertarEvento2Response xmlns="http://unisolutions.com.ar/">
      <LoginYInsertarEvento2Result>1</LoginYInsertarEvento2Result>
    </LoginYInsertarEvento2Response>
  </soap:Body>
</soap:Envelope>`);
});

const falabellaApp = express();
falabellaApp.use(bodyParser.text({ type: 'text/xml' }));
falabellaApp.post('/gps_test/service.asmx', (req, res) => {
  console.log('\n[Mock Falabella SOAP API] Received SOAP Envelope:');
  console.log('SOAPAction:', req.headers.soapaction);
  console.log('XML Body:', req.body);
  res.send(`<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <WM_INS_REPORTE_CLASSResponse xmlns="http://tempuri.org/">
      <WM_INS_REPORTE_CLASSResult>CORRECTO</WM_INS_REPORTE_CLASSResult>
    </WM_INS_REPORTE_CLASSResponse>
  </soap:Body>
</soap:Envelope>`);
});

// Override environment variables to point to local mocks
process.env.COLUN_API_URL = 'http://localhost:4001/tracking/receiver/hub/v2';
process.env.ARAUCO_API_URL = 'http://localhost:4002/GPSChileWS/GPSChileWS.asmx';
process.env.UNIGIS_API_URL = 'http://localhost:4003/hub_TEST/mapi/soap/gps/service.asmx';
process.env.FALABELLA_API_URL = 'http://localhost:4004/gps_test/service.asmx';
process.env.COLUN_BEARER_TOKEN = 'Bearer test_jwt_token';

// Start all mock servers
const servers = [
  colunApp.listen(4001, () => console.log('[Mocks] Colun mock active on port 4001')),
  araucoApp.listen(4002, () => console.log('[Mocks] Arauco mock active on port 4002')),
  unigisApp.listen(4003, () => console.log('[Mocks] UNIGIS mock active on port 4003')),
  falabellaApp.listen(4004, () => console.log('[Mocks] Falabella mock active on port 4004'))
];

setTimeout(runTest, 1500);

async function runTest() {
  console.log('\n[Test Suite] Initiating integration tests...');

  // Mock GPS Server webhook payload format (matches api_webhook.php fields)
  const gpsServerPayload = {
    username: 'vikargps',
    name: 'Peugeot Partner',
    imei: '862798052972060',
    type: 'location',
    desc: 'Route 5 South, Valdivia',
    lat: '-39.821940',
    lng: '-73.229614',
    speed: '85',
    altitude: '20',
    angle: '180',
    dt_tracker: '2026-05-27 13:22:00',
    dt_server: '2026-05-27 13:22:05',
    tr_model: 'Jimi JC400P',
    vin: 'PEUG1234567',
    plate_number: 'GLXP79',
    sim_number: '+56912345678',
    driver_name: 'Juan Perez',
    odometer: '154320',
    eng_hours: '4321',
    params: 'acc=1|batp=90|voltage=12.4|'
  };

  try {
    console.log('[Test Suite] Dispatching simulated GET request to /webhook/gps-server...');
    const getRes = await axios.get(`http://localhost:${MIDDLEWARE_PORT}/webhook/gps-server`, {
      params: gpsServerPayload
    });
    console.log('[Test Suite] Middleware Response Status:', getRes.status);
    console.log('[Test Suite] Middleware Response Body:', getRes.data);
  } catch (err) {
    console.error('[Test Suite] Error running GET webhook test:', err.message);
  }

  // Shut down mocks
  console.log('\n[Test Suite] Closing mock B2B servers...');
  servers.forEach(s => s.close());
}
