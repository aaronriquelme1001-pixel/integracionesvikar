const express = require('express');
const { Pool } = require('pg');

const router = express.Router();

let pool = null;
if (process.env.DATALAKE_URL) {
  pool = new Pool({
    connectionString: process.env.DATALAKE_URL,
    ssl: { rejectUnauthorized: false }
  });
}

/**
 * GET /api/billing-stats
 * Returns the Value-Added Metrics for a given client in the current month.
 * Required query params: clientId, secret
 */
router.get('/', async (req, res) => {
  const { clientId, secret } = req.query;

  // Basic security to avoid public scraping
  if (!secret || secret !== (process.env.API_SECRET || 'vikar2026')) {
    return res.status(403).json({ error: 'Forbidden. Invalid secret.' });
  }

  if (!clientId) {
    return res.status(400).json({ error: 'Missing clientId parameter.' });
  }

  if (!pool) {
    return res.status(500).json({ error: 'Data Lake is not configured.' });
  }

  try {
    const now = new Date();
    // Calculate the start and end of the CURRENT month (Month-to-Date)
    const startOfCurrentMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
    const endOfCurrentMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split('T')[0];

    // Metric 1: Total KM (Current Month)
    const deltaQuery = `
      SELECT 
        imei, 
        MAX(odometer) - MIN(odometer) as km_driven
      FROM billing_snapshots
      WHERE LOWER(client_id) LIKE LOWER('%' || $1 || '%')
      AND snapshot_date >= $2 AND snapshot_date <= $3
      GROUP BY imei
    `;
    const deltaResult = await pool.query(deltaQuery, [clientId, startOfCurrentMonth, endOfCurrentMonth]);
    
    let totalKm = 0;
    deltaResult.rows.forEach(row => {
      totalKm += parseFloat(row.km_driven) || 0;
    });

    // Metric 2: Active Vehicles
    const activeVehicles = deltaResult.rows.length;

    // Metric 3: Max Speed
    const speedQuery = `
      SELECT MAX(speed) as max_speed
      FROM global_telemetry_traffic
      WHERE LOWER(client_source) LIKE LOWER('%' || $1 || '%')
      AND dt_tracker >= $2::timestamp AND dt_tracker <= ($3::timestamp + interval '23 hours 59 minutes 59 seconds')
    `;
    const speedResult = await pool.query(speedQuery, [clientId, startOfCurrentMonth, endOfCurrentMonth]);
    const maxSpeed = speedResult.rows[0]?.max_speed || 0;

    // Metric 4: Driver Ranking (Top Conductores)
    const rankingQuery = `
      SELECT 
        bs.imei,
        ROUND(AVG(bs.daily_grade), 1) as grade,
        MAX(gt.plate) as plate,
        MAX(gt.max_speed) as max_speed,
        SUM(bs.extreme_speeding_count) as extreme_speeding_clustered,
        SUM(bs.moderate_speeding_count) as moderate_speeding_clustered,
        SUM(bs.harsh_maneuvers_count) as harsh_maneuvers_clustered,
        SUM(bs.fatigue_alerts_count) as fatigue_alerts_clustered
      FROM billing_snapshots bs
      LEFT JOIN (
          SELECT imei, MAX(plate) as plate, MAX(speed) as max_speed 
          FROM global_telemetry_traffic 
          WHERE dt_tracker >= $2::timestamp AND dt_tracker <= ($3::timestamp + interval '23 hours 59 minutes 59 seconds')
          GROUP BY imei
      ) gt ON bs.imei = gt.imei 
      WHERE LOWER(bs.client_id) LIKE LOWER('%' || $1 || '%')
      AND bs.snapshot_date >= $2 AND bs.snapshot_date <= $3
      GROUP BY bs.imei
      ORDER BY grade ASC
    `;
    const rankingResult = await pool.query(rankingQuery, [clientId, startOfCurrentMonth, endOfCurrentMonth]);
    const driverRanking = rankingResult.rows.map(row => {
      const grade = parseFloat(row.grade) || 7.0;
      
      let recommendation = "Conductor Seguro. Mantener comportamiento.";
      if (grade < 4.0) recommendation = "ALERTA CRÍTICA: Requiere intervención inmediata y re-capacitación.";
      else if (grade < 5.0) recommendation = "Precaución: Frecuentes violaciones de seguridad. Agendar feedback.";
      else if (grade < 6.0) recommendation = "Regular: Oportunidad de mejora en ciertas conductas de conducción.";

      return {
        imei: row.imei,
        plate: row.plate || row.imei || 'Desconocido',
        grade: grade,
        analysis: {
          max_speed: Math.round(row.max_speed || 0),
          extreme_speeding_events: parseInt(row.extreme_speeding_clustered || 0),
          moderate_speeding_events: parseInt(row.moderate_speeding_clustered || 0),
          harsh_maneuvers: parseInt(row.harsh_maneuvers_clustered || 0),
          fatigue_alerts: parseInt(row.fatigue_alerts_clustered || 0),
          recommendation: recommendation
        }
      };
    });

    // Month formatting for UI (e.g. "mayo de 2026")
    const dateObj = new Date(startOfCurrentMonth);
    const formatter = new Intl.DateTimeFormat('es-CL', { month: 'long', year: 'numeric', timeZone: 'UTC' });
    const currentMonthText = formatter.format(dateObj); // "junio de 2026"

    // Construct the UI-ready response
    return res.json({
      period: `Mes Actual (${currentMonthText})`,
      client: clientId,
      metrics: {
        total_kilometers: Math.round(totalKm),
        active_vehicles: activeVehicles,
        max_speed_kmh: Math.round(maxSpeed),
        driver_ranking: driverRanking
      },
      ui_texts: {
        title1: "Kilometraje del Mes",
        desc1: `Tus vehículos han recorrido ${Math.round(totalKm).toLocaleString()} km en lo que va de ${currentMonthText}.`,
        title2: "Activos en el Mes",
        desc2: `${activeVehicles} vehículos registrados activos en el mes en curso.`,
        title3: "Prevención de Riesgos",
        desc3: `Velocidad Máxima detectada este mes: ${Math.round(maxSpeed)} km/h.`,
        title4: `Ranking de Conductores (${currentMonthText})`,
        desc4: `Lista de la flota. Ordenados desde los peores evaluados hacia los mejores, basado en su telemetría del mes en curso.`
      }
    });

  } catch (error) {
    console.error('[Billing API] Error calculating stats:', error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

/**
 * GET /api/billing-stats/driver-events
 * Fetch detailed events for a specific driver and category in the current month.
 */
router.get('/driver-events', async (req, res) => {
  const { imei, type, secret } = req.query;

  if (!secret || secret !== (process.env.API_SECRET || 'vikar2026')) {
    return res.status(403).json({ error: 'Forbidden. Invalid secret.' });
  }

  if (!imei || !type) {
    return res.status(400).json({ error: 'Missing imei or type parameter.' });
  }

  if (!pool) return res.status(500).json({ error: 'Data Lake is not configured.' });

  try {
    const now = new Date();
    const startOfCurrentMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
    const endOfCurrentMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split('T')[0];

    let typeCondition = '';
    if (type === 'extreme_speeding') typeCondition = 'speed > 120';
    else if (type === 'moderate_speeding') typeCondition = 'speed > 90 AND speed <= 120';
    else if (type === 'harsh_maneuvers') typeCondition = "event IN ('haccel', 'hbrake', 'hcorn')";
    else if (type === 'fatigue_alerts') typeCondition = "event IN ('fatigue', 'tired')";
    else return res.status(400).json({ error: 'Invalid type parameter.' });

    const query = `
      SELECT dt_tracker, speed, lat, lng, event
      FROM global_telemetry_traffic
      WHERE imei = $1
      AND dt_tracker >= $2::timestamp AND dt_tracker <= ($3::timestamp + interval '23 hours 59 minutes 59 seconds')
      AND ${typeCondition}
      ORDER BY dt_tracker DESC
      LIMIT 100
    `;
    
    const result = await pool.query(query, [imei, startOfCurrentMonth, endOfCurrentMonth]);
    
    // Agrupación de eventos (Clustering) con un cooldown de 5 minutos (300,000 ms)
    const rawEvents = result.rows.sort((a, b) => new Date(a.dt_tracker) - new Date(b.dt_tracker));
    const clusteredEvents = [];
    let lastTime = 0;
    
    for (const row of rawEvents) {
      const dt = new Date(row.dt_tracker).getTime();
      if (!lastTime || (dt - lastTime) > 300000) {
        clusteredEvents.push({
          timestamp: row.dt_tracker,
          speed: Math.round(row.speed),
          lat: row.lat,
          lng: row.lng,
          event: row.event
        });
        lastTime = dt;
      }
    }
    
    // Ordenar de más reciente a más antiguo
    clusteredEvents.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    
    return res.json({
      imei,
      type,
      count: clusteredEvents.length,
      events: clusteredEvents
    });
  } catch (err) {
    console.error('[Billing API] Error fetching driver events:', err);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

module.exports = router;
