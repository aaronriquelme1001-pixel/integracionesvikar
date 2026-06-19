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
    // Start of the current month (e.g. 2026-06-01)
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split('T')[0];

    // Metric 1: Total KM
    // We get the min and max odometer for each IMEI in the current month
    const deltaQuery = `
      SELECT 
        imei, 
        MAX(odometer) - MIN(odometer) as km_driven
      FROM billing_snapshots
      WHERE client_id = $1 
        AND snapshot_date >= $2 
        AND snapshot_date <= $3
      GROUP BY imei
    `;
    const deltaResult = await pool.query(deltaQuery, [clientId, startOfMonth, endOfMonth]);
    
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
      WHERE client_source = $1 
        AND dt_tracker >= $2
    `;
    const speedResult = await pool.query(speedQuery, [clientId, startOfMonth]);
    const maxSpeed = speedResult.rows[0]?.max_speed || 0;

    // Metric 4: Driver Ranking (Top Conductores)
    const rankingQuery = `
      SELECT 
        bs.imei,
        ROUND(AVG(bs.daily_grade), 1) as grade,
        MAX(gt.plate) as plate
      FROM billing_snapshots bs
      LEFT JOIN global_telemetry_traffic gt ON bs.imei = gt.imei
      WHERE bs.client_id = $1 
        AND bs.snapshot_date >= $2 
        AND bs.snapshot_date <= $3
      GROUP BY bs.imei
      ORDER BY grade DESC
      LIMIT 10
    `;
    const rankingResult = await pool.query(rankingQuery, [clientId, startOfMonth, endOfMonth]);
    const driverRanking = rankingResult.rows.map(row => ({
      plate: row.plate || row.imei || 'Desconocido',
      grade: parseFloat(row.grade) || 7.0
    }));

    // Construct the UI-ready response
    return res.json({
      month: `${now.getMonth() + 1}/${now.getFullYear()}`,
      client: clientId,
      metrics: {
        total_kilometers: Math.round(totalKm),
        active_vehicles: activeVehicles,
        max_speed_kmh: Math.round(maxSpeed),
        driver_ranking: driverRanking
      },
      ui_texts: {
        title1: "Kilometraje Total",
        desc1: `Tus vehículos recorrieron ${Math.round(totalKm).toLocaleString()} km bajo nuestra supervisión.`,
        title2: "Activos Protegidos",
        desc2: `${activeVehicles} vehículos transmitiendo correctamente este mes.`,
        title3: "Prevención de Riesgos",
        desc3: `Velocidad Máxima detectada: ${Math.round(maxSpeed)} km/h.`,
        title4: "Top Conductores",
        desc4: `Basado en análisis de telemetría de velocidad y comportamiento.`
      }
    });

  } catch (error) {
    console.error('[Billing API] Error calculating stats:', error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

module.exports = router;
