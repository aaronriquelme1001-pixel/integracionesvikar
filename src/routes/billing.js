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
    // Calculate the start and end of the PREVIOUS month
    const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString().split('T')[0];
    const endOfLastMonth = new Date(now.getFullYear(), now.getMonth(), 0).toISOString().split('T')[0];

    // Metric 1: Total KM (Last Month)
    const deltaQuery = `
      SELECT 
        imei, 
        MAX(odometer) - MIN(odometer) as km_driven
      FROM billing_snapshots
      WHERE LOWER(client_id) LIKE LOWER('%' || $1 || '%')
      AND snapshot_date >= $2 AND snapshot_date <= $3
      GROUP BY imei
    `;
    const deltaResult = await pool.query(deltaQuery, [clientId, startOfLastMonth, endOfLastMonth]);
    
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
    const speedResult = await pool.query(speedQuery, [clientId, startOfLastMonth, endOfLastMonth]);
    const maxSpeed = speedResult.rows[0]?.max_speed || 0;

    // Metric 4: Driver Ranking (Top Conductores)
    const rankingQuery = `
      SELECT 
        bs.imei,
        ROUND(AVG(bs.daily_grade), 1) as grade,
        MAX(gt.plate) as plate,
        MAX(gt.speed) as max_speed,
        COUNT(CASE WHEN gt.speed > 110 THEN 1 END) as extreme_speeding,
        COUNT(CASE WHEN gt.speed > 90 AND gt.speed <= 110 THEN 1 END) as moderate_speeding,
        COUNT(CASE WHEN gt.event IN ('haccel', 'hbrake', 'hcorn') THEN 1 END) as harsh_maneuvers,
        COUNT(CASE WHEN gt.event IN ('fatigue', 'tired') THEN 1 END) as fatigue_alerts
      FROM billing_snapshots bs
      LEFT JOIN global_telemetry_traffic gt ON bs.imei = gt.imei 
           AND gt.dt_tracker >= $2::timestamp AND gt.dt_tracker <= ($3::timestamp + interval '23 hours 59 minutes 59 seconds')
      WHERE LOWER(bs.client_id) LIKE LOWER('%' || $1 || '%')
      AND bs.snapshot_date >= $2 AND bs.snapshot_date <= $3
      GROUP BY bs.imei
      ORDER BY grade ASC
    `;
    const rankingResult = await pool.query(rankingQuery, [clientId, startOfLastMonth, endOfLastMonth]);
    const driverRanking = rankingResult.rows.map(row => {
      const grade = parseFloat(row.grade) || 7.0;
      
      let recommendation = "Conductor Seguro. Mantener comportamiento.";
      if (grade < 4.0) recommendation = "ALERTA CRÍTICA: Requiere intervención inmediata y re-capacitación.";
      else if (grade < 5.0) recommendation = "Precaución: Frecuentes violaciones de seguridad. Agendar feedback.";
      else if (grade < 6.0) recommendation = "Regular: Oportunidad de mejora en ciertas conductas de conducción.";

      return {
        plate: row.plate || row.imei || 'Desconocido',
        grade: grade,
        analysis: {
          max_speed: Math.round(row.max_speed || 0),
          extreme_speeding_events: parseInt(row.extreme_speeding || 0),
          moderate_speeding_events: parseInt(row.moderate_speeding || 0),
          harsh_maneuvers: parseInt(row.harsh_maneuvers || 0),
          fatigue_alerts: parseInt(row.fatigue_alerts || 0),
          recommendation: recommendation
        }
      };
    });

    // Month formatting for UI (e.g. "mayo de 2026")
    const dateObj = new Date(startOfLastMonth);
    const formatter = new Intl.DateTimeFormat('es-CL', { month: 'long', year: 'numeric', timeZone: 'UTC' });
    const lastMonthText = formatter.format(dateObj); // "junio de 2026"

    // Construct the UI-ready response
    return res.json({
      period: `Último Mes (${lastMonthText})`,
      client: clientId,
      metrics: {
        total_kilometers: Math.round(totalKm),
        active_vehicles: activeVehicles,
        max_speed_kmh: Math.round(maxSpeed),
        driver_ranking: driverRanking
      },
      ui_texts: {
        title1: "Kilometraje Mensual",
        desc1: `Tus vehículos recorrieron ${Math.round(totalKm).toLocaleString()} km en total durante el mes pasado (${lastMonthText}).`,
        title2: "Activos Protegidos",
        desc2: `${activeVehicles} vehículos registrados activos en el último mes.`,
        title3: "Prevención de Riesgos",
        desc3: `Velocidad Máxima detectada durante el mes pasado: ${Math.round(maxSpeed)} km/h.`,
        title4: "Ranking de Conductores (Mes Pasado)",
        desc4: `Lista completa de la flota. Ordenados desde los peores evaluados hacia los mejores, basado en su telemetría de ${lastMonthText}.`
      }
    });

  } catch (error) {
    console.error('[Billing API] Error calculating stats:', error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

module.exports = router;
