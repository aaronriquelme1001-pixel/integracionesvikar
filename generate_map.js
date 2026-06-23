const fs = require('fs');

async function generateMap() {
  const { Client } = require('pg');
  const client = new Client({
    connectionString: 'postgresql://postgres.qqxznexekadsuyivdgke:66fc7V%21zwA%24N.%2B-@aws-1-us-west-2.pooler.supabase.com:5432/postgres',
    ssl: { rejectUnauthorized: false }
  });

  await client.connect();
  const imei = '865413054385702';
  const oldestDate = '2026-06-19';

  const query = `
    SELECT dt_tracker, lat, lng, speed, event
    FROM global_telemetry_traffic
    WHERE imei = $1 AND DATE(dt_tracker) = $2
    ORDER BY dt_tracker ASC
  `;
  const dataRes = await client.query(query, [imei, oldestDate]);
  
  const coordinates = [];
  const markers = [];
  
  for (let i = 0; i < dataRes.rows.length; i++) {
    const row = dataRes.rows[i];
    coordinates.push(`[${row.lat}, ${row.lng}]`);
    
    const time = new Date(row.dt_tracker).toLocaleTimeString('es-CL');
    const speed = Math.round(row.speed);
    
    // Color coding based on speed
    let color = '#2ecc71'; // Green (Safe)
    if (speed > 120) color = '#e74c3c'; // Red (Extreme)
    else if (speed > 90) color = '#f39c12'; // Orange (Moderate)
    
    let popupText = `<b>Hora:</b> ${time}<br><b>Velocidad:</b> ${speed} km/h`;
    if (row.event) popupText += `<br><b style="color:red">Evento: ${row.event.toUpperCase()}</b>`;
    
    // Draw a line segment to the previous point with the color of the current speed
    if (i > 0) {
      const prevRow = dataRes.rows[i-1];
      markers.push(`L.polyline([[${prevRow.lat}, ${prevRow.lng}], [${row.lat}, ${row.lng}]], {color: '${color}', weight: 4, opacity: 0.8}).addTo(map);`);
    }
    
    // Add an interactive circle marker that the user can click
    markers.push(`
      L.circleMarker([${row.lat}, ${row.lng}], {
        radius: ${row.event ? 6 : 3},
        fillColor: "${row.event ? '#9b59b6' : color}",
        color: "#fff",
        weight: 1,
        opacity: 1,
        fillOpacity: 0.9
      }).addTo(map).bindPopup('${popupText}');
    `);
  }

  const html = `<!DOCTYPE html>
<html>
<head>
    <title>Ruta Histórica - JYJS98 (19 Jun 2026)</title>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
    <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
    <style>
        #map { width: 100%; height: 100vh; margin: 0; padding: 0; }
        body { margin: 0; padding: 0; font-family: sans-serif; }
        .header { position: absolute; top: 10px; left: 50px; z-index: 1000; background: white; padding: 10px 20px; border-radius: 8px; box-shadow: 0 2px 5px rgba(0,0,0,0.3); }
    </style>
</head>
<body>
<div class="header">
    <h2 style="margin: 0; color: #333;">Ruta Histórica: JYJS98</h2>
    <p style="margin: 5px 0 0; color: #666;">Fecha: 19 de Junio de 2026 (${dataRes.rows.length} puntos GPS)</p>
</div>
<div id="map"></div>
<script>
    var map = L.map('map').setView([-33.4489, -70.6693], 10);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '© OpenStreetMap'
    }).addTo(map);

    var latlngs = [
        ${coordinates.join(',\n        ')}
    ];
    
    ${markers.join('\n    ')}

    // Zoom to fit all markers
    var group = new L.featureGroup(Object.values(map._layers).filter(l => l instanceof L.CircleMarker || l instanceof L.Polyline));
    map.fitBounds(group.getBounds());
    
    // Start and End markers
    if (latlngs.length > 0) {
        L.circleMarker(latlngs[0], {color: 'green', radius: 10, fillOpacity: 1}).addTo(map).bindPopup("<b>Inicio de Ruta</b>");
        L.circleMarker(latlngs[latlngs.length - 1], {color: 'black', radius: 10, fillOpacity: 1}).addTo(map).bindPopup("<b>Fin de Ruta</b>");
    }
</script>
</body>
</html>`;

  const filename = `C:\\Users\\aaron\\.gemini\\antigravity\\brain\\ffe6c5ae-7b79-4366-b536-88a2175e3fad\\Mapa_JYJS98.html`;
  fs.writeFileSync(filename, html);
  console.log('Saved to', filename);
  
  await client.end();
}

generateMap().catch(console.error);
