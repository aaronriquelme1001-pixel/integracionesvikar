const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const { computeSignature } = require('./utils/signature');

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

// Setup dynamic client environment variables for testing
process.env.UNIGIS_SYSTEM_USER_KLETT = 'KLETT_USER_MOCK';
process.env.UNIGIS_PASSWORD_KLETT = 'KLETT_PASS_MOCK';

// Setup mock incoming GPS environment variables
process.env.GPS_SERVER_URL = 'http://localhost:4005/api/api_loc.php';
process.env.INCOMING_API_KEY = 'test_incoming_key_123';

// Tracksolid Mock environment variables
process.env.TRACKSOLID_API_URL = 'http://localhost:4006/route/rest';
process.env.TRACKSOLID_USER_ID = 'test_user';
process.env.TRACKSOLID_APP_KEY = 'test_key';
process.env.TRACKSOLID_APP_SECRET = 'test_secret';
process.env.TRACKSOLID_USER_PWD_MD5 = 'test_pwd_md5';
process.env.TRACKSOLID_IMEIS = '862798052972060';
process.env.TRACKSOLID_POLL_INTERVAL = '60000'; // high interval so it doesn't poll repeatedly in test background

// AVL Chile Mock environment variables
process.env.AVLCHILE_API_URL = 'http://localhost:4007/api/v2/';
process.env.AVLCHILE_TOKEN_ALIRORIOS = 'mock_alirorios_token_123';
process.env.AVLCHILE_TOKEN_LUISHERRERA = 'mock_luisherrera_token_456';

// Traccar Mock environment variables
process.env.TRACCAR_API_URL = 'http://localhost:4009/';


const gpsServerApp = express();
gpsServerApp.get('/api/api_loc.php', (req, res) => {
  console.log('\n[Mock GPS Server] Received forwarded request:');
  console.log('Query:', req.query);
  res.send('ok');
});

const tracksolidApp = express();
tracksolidApp.use(bodyParser.urlencoded({ extended: true }));
tracksolidApp.use(bodyParser.json());
tracksolidApp.post('/route/rest', (req, res) => {
  const method = req.query.method || req.body.method;
  console.log(`\n[Mock Tracksolid API] Received request for method: ${method}`);
  
  if (method === 'jimi.oauth.token.get') {
    return res.json({
      code: 0,
      message: 'success',
      result: {
        accessToken: 'mock_access_token_123456789',
        expiresIn: 7200
      }
    });
  } else if (method === 'jimi.device.location.get') {
    return res.json({
      code: 0,
      message: 'success',
      result: [
        {
          imei: '862798052972060',
          lat: -39.821962,
          lng: -73.229566,
          speed: 0,
          direction: 134,
          accStatus: '0',
          gpsTime: '2026-05-29 16:15:01'
        }
      ]
    });
  }
  res.json({ code: -1, message: 'Unknown method' });
});

const avlchileApp = express();
avlchileApp.use(bodyParser.json());
avlchileApp.post('/api/v2/', (req, res) => {
  console.log('\n[Mock AVL Chile API] Received telemetry:');
  console.log('Headers:', { authorization: req.headers.authorization });
  console.log('Body:', JSON.stringify(req.body, null, 2));
  res.json({
    status: {
      result: true,
      total_count: req.body.length,
      valid_count: req.body.length,
      error_count: 0,
      error: []
    }
  });
});

const traccarApp = express();
traccarApp.get('/', (req, res) => {
  console.log('\n[Mock Traccar API] Received telemetry via GET:');
  console.log('Query parameters:', req.query);
  res.sendStatus(200);
});

// Start all mock servers
const servers = [
  colunApp.listen(4001, () => console.log('[Mocks] Colun mock active on port 4001')),
  araucoApp.listen(4002, () => console.log('[Mocks] Arauco mock active on port 4002')),
  unigisApp.listen(4003, () => console.log('[Mocks] UNIGIS mock active on port 4003')),
  falabellaApp.listen(4004, () => console.log('[Mocks] Falabella mock active on port 4004')),
  gpsServerApp.listen(4005, () => console.log('[Mocks] GPS Server mock active on port 4005')),
  tracksolidApp.listen(4006, () => console.log('[Mocks] Tracksolid API mock active on port 4006')),
  avlchileApp.listen(4007, () => console.log('[Mocks] AVL Chile mock active on port 4007')),
  traccarApp.listen(4009, () => console.log('[Mocks] Traccar mock active on port 4009'))
];

// Boot middleware server in the same process using mock env variables
console.log('[Test Suite] Booting middleware server in-process...');
require('./index.js');

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
    params: 'acc=1|batp=90|voltage=12.4|hdop=1.5|sat=12|'
  };

  try {
    console.log('\n================================================================');
    console.log('[Test Suite] SCENARIO 1: Static Webhook Routing (Fallback to devices.json)');
    console.log('================================================================');
    console.log('[Test Suite] Dispatching simulated GET request to /webhook/gps-server...');
    const getRes = await axios.get(`http://localhost:${MIDDLEWARE_PORT}/webhook/gps-server`, {
      params: gpsServerPayload
    });
    console.log('[Test Suite] Middleware Response Status:', getRes.status);
    console.log('[Test Suite] Middleware Response Body:', getRes.data);
  } catch (err) {
    console.error('[Test Suite] Error running GET webhook test:', err.message);
  }

  try {
    console.log('\n================================================================');
    console.log('[Test Suite] SCENARIO 2: Dynamic Webhook Routing (?target=melon&client=klett)');
    console.log('================================================================');
    
    // Modify payload to represent a dynamic truck not configured in devices.json
    const dynamicPayload = {
      ...gpsServerPayload,
      imei: '111222333444555',
      plate_number: 'DYNAMIC99',
      gps_satellites: '10',
      hdop: '1.8'
    };

    console.log('[Test Suite] Dispatching dynamic routing request to /webhook/gps-server?target=melon&client=klett...');
    const dynamicRes = await axios.get(`http://localhost:${MIDDLEWARE_PORT}/webhook/gps-server`, {
      params: {
        ...dynamicPayload,
        target: 'melon',
        client: 'klett'
      }
    });
    console.log('[Test Suite] Middleware Response Status:', dynamicRes.status);
    console.log('[Test Suite] Middleware Response Body:', dynamicRes.data);
  } catch (err) {
    console.error('[Test Suite] Error running dynamic webhook test:', err.message);
  }

  try {
    console.log('\n================================================================');
    console.log('[Test Suite] SCENARIO 3: Incoming GPS Telemetry from Third Party');
    console.log('================================================================');
    console.log('[Test Suite] Dispatching simulated JSON POST to /webhook/incoming-gps...');
    
    const incomingPayload = {
      imei: '999888777666555',
      plate: 'PARTNER88',
      lat: -33.456789,
      lng: -70.654321,
      speed: 70,
      angle: 90,
      dt: '2026-05-28 12:00:00',
      ignition: true,
      params: 'temp1=2.5|'
    };

    const res = await axios.post(`http://localhost:${MIDDLEWARE_PORT}/webhook/incoming-gps`, incomingPayload, {
      headers: {
        'X-API-Key': 'test_incoming_key_123'
      }
    });
    console.log('[Test Suite] Middleware Response Status:', res.status);
    console.log('[Test Suite] Middleware Response Body:', res.data);
  } catch (err) {
    console.error('[Test Suite] Error running Scenario 3:', err.response ? err.response.data : err.message);
  }

  try {
    console.log('\n================================================================');
    console.log('[Test Suite] SCENARIO 4: Tracksolid Push Webhook (POST /webhook/location)');
    console.log('================================================================');
    
    const tracksolidPayload = {
      msgType: 'jimi.open.instruction.raw.receive',
      data: JSON.stringify({
        imei: '862798052972060',
        gpsTime: '2026-05-29 12:45:00',
        lat: -39.821962,
        lng: -73.229566,
        speed: 10,
        direction: 90,
        accStatus: '1',
        electQuantity: 95,
        powerValue: '13.2'
      })
    };

    const commonParams = {
      method: 'jimi.open.instruction.raw.receive',
      timestamp: new Date().toISOString().replace('T', ' ').substring(0, 19),
      app_key: 'test_key',
      v: '1.0',
      format: 'json'
    };

    const signParams = { ...commonParams, ...tracksolidPayload };
    const sign = computeSignature(signParams, 'test_secret');
    commonParams.sign = sign;

    const url = `http://localhost:${MIDDLEWARE_PORT}/webhook/location?` + new URLSearchParams(commonParams).toString();
    
    console.log('[Test Suite] Sending signed POST request to /webhook/location...');
    const res = await axios.post(url, tracksolidPayload);
    console.log('[Test Suite] Middleware Response Status:', res.status);
    console.log('[Test Suite] Middleware Response Body:', res.data);
  } catch (err) {
    console.error('[Test Suite] Error running Scenario 4:', err.response ? err.response.data : err.message);
  }



  try {
    console.log('\n================================================================');
    console.log('[Test Suite] SCENARIO 6: Dynamic Webhook Routing to AVL Chile (?target=avlchile&client=alirorios)');
    console.log('================================================================');
    console.log('[Test Suite] Dispatching dynamic routing request to /webhook/gps-server?target=avlchile&client=alirorios...');
    const res = await axios.get(`http://localhost:${MIDDLEWARE_PORT}/webhook/gps-server`, {
      params: {
        ...gpsServerPayload,
        target: 'avlchile',
        client: 'alirorios'
      }
    });
    console.log('[Test Suite] Middleware Response Status:', res.status);
    console.log('[Test Suite] Middleware Response Body:', res.data);
  } catch (err) {
    console.error('[Test Suite] Error running Scenario 6:', err.response ? err.response.data : err.message);
  }

  try {
    console.log('\n================================================================');
    console.log('[Test Suite] SCENARIO 7: Dynamic Webhook Routing to Traccar (?target=traccar&client=luisherrera)');
    console.log('================================================================');
    console.log('[Test Suite] Dispatching dynamic routing request to /webhook/gps-server?target=traccar&client=luisherrera...');
    const res = await axios.get(`http://localhost:${MIDDLEWARE_PORT}/webhook/gps-server`, {
      params: {
        ...gpsServerPayload,
        target: 'traccar',
        client: 'luisherrera'
      }
    });
    console.log('[Test Suite] Middleware Response Status:', res.status);
    console.log('[Test Suite] Middleware Response Body:', res.data);
  } catch (err) {
    console.error('[Test Suite] Error running Scenario 7:', err.response ? err.response.data : err.message);
  }

  // Shut down mocks
  console.log('\n[Test Suite] Closing mock B2B servers and exiting...');
  servers.forEach(s => s.close());
  setTimeout(() => {
    process.exit(0);
  }, 1000);
}
