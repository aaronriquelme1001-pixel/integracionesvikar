require('dotenv').config();
const ColunStrategy = require('./integrations/colun');
const MelonStrategy = require('./integrations/melon');
const FalabellaStrategy = require('./integrations/falabella');
const CencosudStrategy = require('./integrations/cencosud');
const WalmartStrategy = require('./integrations/walmart');
const MercadoLibreStrategy = require('./integrations/mercadolibre');
const SmuStrategy = require('./integrations/smu');
const AgrosuperStrategy = require('./integrations/agrosuper');
const CcuStrategy = require('./integrations/ccu');
const AmazonStrategy = require('./integrations/amazon');
const DhlStrategy = require('./integrations/dhl');
const AvlChileStrategy = require('./integrations/avlchile');

const telemetry = {
  imei: '862798052972060',
  plate_number: 'GLXP79',
  lat: '-39.821940',
  lng: '-73.229614',
  speed: '80',
  angle: '180',
  dt_tracker: '2026-05-27 13:22:00',
  params: 'acc=1|temp1=4.5|'
};

const deviceConfig = {
  plate: 'GLXP79',
  carrier: 'VIKARGPS'
};

async function pingAll() {
  console.log('=== STARTING REAL CONNECTION PING TEST ===\n');

  const tests = [
    {
      name: 'Colun',
      strategy: new ColunStrategy(),
      config: { enabled: true, token: 'Bearer dummy_token' }
    },
    {
      name: 'UNIGIS (Melón)',
      strategy: new MelonStrategy(),
      config: { enabled: true, user: 'VIKARGPS', password: 'VIKARGPS2024' }
    },
    {
      name: 'Falabella',
      strategy: new FalabellaStrategy(),
      config: { enabled: true, user: 'WS_test', password: '$$WS17' }
    },
    {
      name: 'Cencosud',
      strategy: new CencosudStrategy(),
      config: { enabled: true, api_key: 'dummy_api_key' }
    },
    {
      name: 'Walmart',
      strategy: new WalmartStrategy(),
      config: { enabled: true, client_id: 'dummy_id', client_secret: 'dummy_secret' }
    },
    {
      name: 'Mercado Libre',
      strategy: new MercadoLibreStrategy(),
      config: { enabled: true, token: 'dummy_token' }
    },
    {
      name: 'SMU',
      strategy: new SmuStrategy(),
      config: { enabled: true, token: 'dummy_token' }
    },
    {
      name: 'Agrosuper',
      strategy: new AgrosuperStrategy(),
      config: { enabled: true, api_key: 'dummy_key' }
    },
    {
      name: 'CCU',
      strategy: new CcuStrategy(),
      config: { enabled: true, token: 'dummy_token' }
    },
    {
      name: 'Amazon',
      strategy: new AmazonStrategy(),
      config: { enabled: true, token: 'dummy_token' }
    },
    {
      name: 'DHL',
      strategy: new DhlStrategy(),
      config: { enabled: true, api_key: 'dummy_key' }
    },
    {
      name: 'AVL Chile',
      strategy: new AvlChileStrategy(),
      config: { enabled: true, token: 'UkjYmu0rayhCqnSa1unMYEcpvZzeULAD0J03BrZkH6wydBLQt3M7nLkKzWuN2JYd' }
    }
  ];

  for (const t of tests) {
    console.log(`\n--------------------------------------------------`);
    console.log(`[Ping Test] Sending request to: ${t.name}...`);
    try {
      await t.strategy.execute(telemetry, deviceConfig, t.config);
    } catch (err) {
      console.log(`[Ping Test] Execution error for ${t.name}:`, err.message);
    }
  }

  console.log(`\n==============================================`);
  console.log(`=== REAL CONNECTION PING TEST COMPLETE ===`);
  console.log(`==============================================`);
}

pingAll();
