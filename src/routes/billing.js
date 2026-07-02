const express = require('express');
const { BigQuery } = require('@google-cloud/bigquery');
const fs = require('fs');
const path = require('path');

const router = express.Router();

let bigquery = null;
if (process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON) {
  const credentials = JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON);
  bigquery = new BigQuery({ projectId: credentials.project_id, credentials });
} else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
  bigquery = new BigQuery(); 
} else if (fs.existsSync(path.join(__dirname, '../../bq-key.json'))) {
  bigquery = new BigQuery({ projectId: 'vikargpsdatos', keyFilename: path.join(__dirname, '../../bq-key.json') });
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

  if (!bigquery) {
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
      FROM \`telemetry.billing_snapshots\`
      WHERE LOWER(client_id) LIKE CONCAT('%', LOWER(@clientId), '%')
      AND snapshot_date >= DATE(@startDate) AND snapshot_date <= DATE(@endDate)
      GROUP BY imei
    `;
    const [deltaRows] = await bigquery.query({
      query: deltaQuery,
      params: { clientId, startDate: startOfCurrentMonth, endDate: endOfCurrentMonth }
    });
    
    let totalKm = 0;
    deltaRows.forEach(row => {
      totalKm += parseFloat(row.km_driven) || 0;
    });

    // Metric 2: Active Vehicles
    const activeVehicles = deltaRows.length;

    // Metric 3: Max Speed — scoped to client IMEIs from billing_snapshots (avoids full-table scan via client_source LIKE)
    const speedQuery = `
      SELECT MAX(gt.speed) as max_speed
      FROM \`telemetry.global_traffic\` gt
      INNER JOIN (
        SELECT DISTINCT imei
        FROM \`telemetry.billing_snapshots\`
        WHERE LOWER(client_id) LIKE CONCAT('%', LOWER(@clientId), '%')
        AND snapshot_date >= DATE(@startDate) AND snapshot_date <= DATE(@endDate)
      ) client_imeis ON gt.imei = client_imeis.imei
      WHERE gt.dt_tracker >= TIMESTAMP(@startDate)
        AND gt.dt_tracker <= TIMESTAMP_ADD(TIMESTAMP(@endDate), INTERVAL 23*3600+59*60+59 SECOND)
    `;
    const [speedRows] = await bigquery.query({
      query: speedQuery,
      params: { clientId, startDate: startOfCurrentMonth, endDate: endOfCurrentMonth }
    });
    const maxSpeed = speedRows[0]?.max_speed || 0;

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
      FROM \`telemetry.billing_snapshots\` bs
      LEFT JOIN (
          SELECT gt.imei, MAX(IF(gt.plate = 'SIN_PATENTE', NULL, gt.plate)) as plate, MAX(gt.speed) as max_speed
          FROM \`telemetry.global_traffic\` gt
          INNER JOIN (
            SELECT DISTINCT imei
            FROM \`telemetry.billing_snapshots\`
            WHERE LOWER(client_id) LIKE CONCAT('%', LOWER(@clientId), '%')
            AND snapshot_date >= DATE(@startDate) AND snapshot_date <= DATE(@endDate)
          ) client_imeis ON gt.imei = client_imeis.imei
          WHERE gt.dt_tracker >= TIMESTAMP(@startDate)
            AND gt.dt_tracker <= TIMESTAMP_ADD(TIMESTAMP(@endDate), INTERVAL 23*3600+59*60+59 SECOND)
          GROUP BY gt.imei
      ) gt ON bs.imei = gt.imei
      WHERE LOWER(bs.client_id) LIKE CONCAT('%', LOWER(@clientId), '%')
      AND bs.snapshot_date >= DATE(@startDate) AND bs.snapshot_date <= DATE(@endDate)
      GROUP BY bs.imei
      ORDER BY grade ASC
    `;
    const [rankingRows] = await bigquery.query({
      query: rankingQuery,
      params: { clientId, startDate: startOfCurrentMonth, endDate: endOfCurrentMonth }
    });
    
    // Attempt to load mapping cache to get real vehicle names/plates
    let mappingCache = {};
    try {
      const { getMappingCache } = require('../pollers/gpsServer');
      if (typeof getMappingCache === 'function') {
        mappingCache = getMappingCache() || {};
      }
    } catch (e) {
      console.warn('Could not load mapping cache in billing API');
    }

    const driverRanking = rankingRows.map(row => {
      const grade = parseFloat(row.grade) || 7.0;
      
      let recommendation = "Conductor Seguro. Mantener comportamiento.";
      if (grade < 4.0) recommendation = "ALERTA CRÍTICA: Requiere intervención inmediata y re-capacitación.";
      else if (grade < 5.0) recommendation = "Precaución: Frecuentes violaciones de seguridad. Agendar feedback.";
      else if (grade < 6.0) recommendation = "Regular: Oportunidad de mejora en ciertas conductas de conducción.";

      let plate = row.plate;
      if (!plate || plate === 'null' || plate === '') {
        const cached = mappingCache[row.imei];
        if (cached && cached.plate) plate = cached.plate;
        else if (cached && cached.name) plate = cached.name;
      }
      
      return {
        imei: row.imei,
        plate: plate || row.imei || 'Desconocido',
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

  if (!bigquery) return res.status(500).json({ error: 'Data Lake is not configured.' });

  try {
    const now = new Date();
    const startOfCurrentMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
    const endOfCurrentMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split('T')[0];

    let typeCondition = '';
    if (type === 'extreme_speeding') typeCondition = 'speed > 120';
    else if (type === 'moderate_speeding') typeCondition = 'speed > 90 AND speed <= 120';
    else if (type === 'harsh_maneuvers') typeCondition = "JSON_EXTRACT_SCALAR(params, '$.event') IN ('haccel', 'hbrake', 'hcorn')";
    else if (type === 'fatigue_alerts') typeCondition = "JSON_EXTRACT_SCALAR(params, '$.event') IN ('fatigue', 'tired')";
    else return res.status(400).json({ error: 'Invalid type parameter.' });

    const query = `
      SELECT dt_tracker, speed, lat, lng, JSON_EXTRACT_SCALAR(params, '$.event') as event
      FROM \`telemetry.global_traffic\`
      WHERE imei = @imei
      AND dt_tracker >= TIMESTAMP(@startDate) AND dt_tracker <= TIMESTAMP_ADD(TIMESTAMP(@endDate), INTERVAL 23*3600+59*60+59 SECOND)
      AND ${typeCondition}
      ORDER BY dt_tracker DESC
      LIMIT 100
    `;
    
    const [rows] = await bigquery.query({
      query,
      params: { imei, startDate: startOfCurrentMonth, endDate: endOfCurrentMonth }
    });
    
    // Agrupación de eventos (Clustering) con un cooldown de 5 minutos (300,000 ms)
    const rawEvents = rows.sort((a, b) => {
      const dtA = a.dt_tracker.value ? a.dt_tracker.value : a.dt_tracker;
      const dtB = b.dt_tracker.value ? b.dt_tracker.value : b.dt_tracker;
      return new Date(dtA) - new Date(dtB);
    });
    const clusteredEvents = [];
    let lastTime = 0;
    
    for (const row of rawEvents) {
      const dtValue = row.dt_tracker.value ? row.dt_tracker.value : row.dt_tracker;
      const dt = new Date(dtValue).getTime();
      if (!lastTime || (dt - lastTime) > 300000) {
        clusteredEvents.push({
          timestamp: row.dt_tracker.value ? row.dt_tracker.value : row.dt_tracker,
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
