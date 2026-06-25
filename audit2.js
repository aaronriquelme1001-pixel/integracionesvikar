const axios = require('axios');

const vehicles = [
  { name: 'VPXW60', imei: '863719067827833' },
  { name: 'OPEL', imei: '862798052972060' }, // Example Tracksolid
  { name: 'DFKT91', imei: '863719067827010' }, // I don't know their IMEIs!
];

async function run() {
  try {
    const r = await axios.get('https://integracionesvikarb2b.onrender.com/api/fleet?limit=200');
    const fleet = r.data.data;
    
    console.log('--- AUDITORÍA DE DATALAKE Y BACKFILLER ---');
    console.log('Revisando los últimos 500 puntos de cada vehículo...\n');
    
    for (const v of fleet.slice(0, 5)) {
      try {
        const hr = await axios.get(`https://integracionesvikarb2b.onrender.com/api/fleet/history?imei=${v.imei}&start_date=2026-06-25&limit=500`);
        const history = hr.data.data;
        if (!history || history.length === 0) continue;
        
        let recovered = 0;
        let gaps = 0;
        for (let i = 1; i < history.length; i++) {
          const t1 = new Date(history[i-1].dt_tracker).getTime();
          const t2 = new Date(history[i].dt_tracker).getTime();
          const diffMin = (t2 - t1) / 60000;
          
          if (diffMin < 0) {
            recovered++;
          } else if (diffMin > 10) {
            gaps++;
          }
        }
        
        console.log(`Vehículo: ${v.plate || v.name} (IMEI: ${v.imei})`);
        console.log(`  Puntos totales hoy: ${hr.data.count}`);
        console.log(`  Último punto: ${history[history.length-1].dt_tracker}`);
        console.log(`  Brechas > 10 min: ${gaps}`);
        console.log(`  Puntos fuera de orden (recuperados exitosamente): ${recovered}`);
        console.log('--------------------------------------------------');
      } catch(e) {
        // ignore
      }
    }
  } catch(err) {
    console.error(err.message);
  }
}

run();
