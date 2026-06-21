const axios = require('axios');

async function findClient() {
  const clients = ["transklett", "vikargps", "buseseltorreon", "pacel", "delisur", "eladioagk", "transportelosulmos", "facturacion-vicat", "demo", "ruben"];
  for (const client of clients) {
    try {
      const res = await axios.get(`https://integracionesvikarb2b.onrender.com/api/billing-stats?clientId=${client}&secret=vikar2026`);
      console.log(`${client}: max_speed = ${res.data.metrics.max_speed_kmh}, active = ${res.data.metrics.active_vehicles}`);
    } catch (err) {
      // ignore
    }
  }
}
findClient();
