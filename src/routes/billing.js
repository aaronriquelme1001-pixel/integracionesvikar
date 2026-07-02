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

/** Month bounds for the current calendar month (YYYY-MM-DD). */
function currentMonthBounds() {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split('T')[0];
  return { start, end, now };
}

/**
 * Parse optional `since` query param (ISO date or datetime).
 * Returns YYYY-MM-DD for snapshot filtering and a TIMESTAMP boundary for global_traffic.
 */
function parseSinceParam(sinceRaw, monthStart) {
  if (!sinceRaw || typeof sinceRaw !== 'string') {
    return { sinceDate: null, sinceTs: null };
  }
  const trimmed = sinceRaw.trim();
  let d = new Date(trimmed);
  if (Number.isNaN(d.getTime())) {
    // Accept YYYY-MM-DD without time
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
      d = new Date(`${trimmed}T00:00:00Z`);
    } else {
      return { sinceDate: null, sinceTs: null };
    }
  }
  const sinceDate = d.toISOString().split('T')[0];
  // Clamp to current month start
  const sinceTs = sinceDate < monthStart ? monthStart : sinceDate;
  return { sinceDate: sinceTs, sinceTs };
}

/**
 * GET /api/billing-stats
 * Returns Value-Added Metrics for a client (month-to-date).
 *
 * Query params:
 *   clientId, secret (required)
 *   since (optional ISO datetime) — only scan global_traffic from this point for vmax/ranking speed;
 *         km and event counts still come from billing_snapshots for the full month.
 *   known_max (optional number) — cached vmax from a prior checkpoint; merged as MAX(known_max, gap_max).
 */
router.get('/', async (req, res) => {
  const { clientId, secret, since: sinceRaw, known_max: knownMaxRaw } = req.query;

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
    const { start: startOfCurrentMonth, end: endOfCurrentMonth } = currentMonthBounds();
    const { sinceDate, sinceTs } = parseSinceParam(sinceRaw, startOfCurrentMonth);
    const knownMax = knownMaxRaw != null && knownMaxRaw !== '' ? parseFloat(knownMaxRaw) : null;

    // ── Metric 1 & 2: KM + active vehicles (billing_snapshots only, full month) ──
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
      params: { clientId, startDate: startOfCurrentMonth, endDate: endOfCurrentMonth },
    });

    let totalKm = 0;
    deltaRows.forEach((row) => {
      totalKm += parseFloat(row.km_driven) || 0;
    });
    const activeVehicles = deltaRows.length;

    // ── Last snapshot date: gap detection for incremental global_traffic ──
    const lastSnapQuery = `
      SELECT MAX(snapshot_date) as last_snap
      FROM \`telemetry.billing_snapshots\`
      WHERE LOWER(client_id) LIKE CONCAT('%', LOWER(@clientId), '%')
      AND snapshot_date >= DATE(@startDate) AND snapshot_date <= DATE(@endDate)
    `;
    const [lastSnapRows] = await bigquery.query({
      query: lastSnapQuery,
      params: { clientId, startDate: startOfCurrentMonth, endDate: endOfCurrentMonth },
    });
    const lastSnapVal = lastSnapRows[0]?.last_snap;
    const lastSnapDate = lastSnapVal?.value ? lastSnapVal.value : (lastSnapVal || null);

    // Traffic scan start: prefer explicit `since`, else day after last snapshot, else month start
    let trafficStart = startOfCurrentMonth;
    if (sinceTs) {
      trafficStart = sinceTs;
    } else if (lastSnapDate) {
      const nextDay = new Date(lastSnapDate);
      nextDay.setUTCDate(nextDay.getUTCDate() + 1);
      const nextDayStr = nextDay.toISOString().split('T')[0];
      if (nextDayStr > trafficStart) trafficStart = nextDayStr;
    }

    const todayStr = new Date().toISOString().split('T')[0];
    const needsTrafficScan = trafficStart <= todayStr;

    // ── Metric 3: Max speed (incremental global_traffic when possible) ──
    let maxSpeed = 0;
    if (needsTrafficScan) {
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
        params: {
          clientId,
          startDate: startOfCurrentMonth,
          endDate: endOfCurrentMonth,
          trafficStart,
        },
      });
      maxSpeed = parseFloat(speedRows[0]?.max_speed) || 0;
    }

    // If client sent a cached vmax, merge (vmax can only go up within the month)
    if (knownMax != null && Number.isFinite(knownMax)) {
      maxSpeed = Math.max(maxSpeed, knownMax);
    }

    // If incremental `since` but no known_max, we still need pre-since vmax once.
    // Snapshots don't store vmax; do a bounded pre-since scan only when since > month start.
    if (sinceTs && sinceTs > startOfCurrentMonth && (knownMax == null || !Number.isFinite(knownMax))) {
      const preSinceQuery = `
        SELECT MAX(gt.speed) as max_speed
        FROM \`telemetry.global_traffic\` gt
        INNER JOIN (
          SELECT DISTINCT imei
          FROM \`telemetry.billing_snapshots\`
          WHERE LOWER(client_id) LIKE CONCAT('%', LOWER(@clientId), '%')
          AND snapshot_date >= DATE(@startDate) AND snapshot_date <= DATE(@endDate)
        ) client_imeis ON gt.imei = client_imeis.imei
        WHERE gt.dt_tracker >= TIMESTAMP(@startDate)
          AND gt.dt_tracker < TIMESTAMP(@sinceTs)
      `;
      const [preRows] = await bigquery.query({
        query: preSinceQuery,
        params: {
          clientId,
          startDate: startOfCurrentMonth,
          endDate: endOfCurrentMonth,
          sinceTs,
        },
      });
      const preMax = parseFloat(preRows[0]?.max_speed) || 0;
      maxSpeed = Math.max(maxSpeed, preMax);
    }

    // ── Metric 4: Driver ranking (snapshots + incremental traffic for plate/vmax) ──
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
      params: {
        clientId,
        startDate: startOfCurrentMonth,
        endDate: endOfCurrentMonth,
        trafficStart,
      },
    });

    let mappingCache = {};
    try {
      const { getMappingCache } = require('../pollers/gpsServer');
      if (typeof getMappingCache === 'function') {
        mappingCache = getMappingCache() || {};
      }
    } catch (e) {
      console.warn('Could not load mapping cache in billing API');
    }

    const driverRanking = rankingRows.map((row) => {
      const grade = parseFloat(row.grade) || 7.0;

      let recommendation = 'Conductor Seguro. Mantener comportamiento.';
      if (grade < 4.0) recommendation = 'ALERTA CRÍTICA: Requiere intervención inmediata y re-capacitación.';
      else if (grade < 5.0) recommendation = 'Precaución: Frecuentes violaciones de seguridad. Agendar feedback.';
      else if (grade < 6.0) recommendation = 'Regular: Oportunidad de mejora en ciertas conductas de conducción.';

      let plate = row.plate;
      if (!plate || plate === 'null' || plate === '') {
        const cached = mappingCache[row.imei];
        if (cached && cached.plate) plate = cached.plate;
        else if (cached && cached.name) plate = cached.name;
      }

      return {
        imei: row.imei,
        plate: plate || row.imei || 'Desconocido',
        grade,
        analysis: {
          max_speed: Math.round(row.max_speed || 0),
          extreme_speeding_events: parseInt(row.extreme_speeding_clustered || 0, 10),
          moderate_speeding_events: parseInt(row.moderate_speeding_clustered || 0, 10),
          harsh_maneuvers: parseInt(row.harsh_maneuvers_clustered || 0, 10),
          fatigue_alerts: parseInt(row.fatigue_alerts_clustered || 0, 10),
          recommendation,
        },
      };
    });

    const dateObj = new Date(startOfCurrentMonth);
    const formatter = new Intl.DateTimeFormat('es-CL', { month: 'long', year: 'numeric', timeZone: 'UTC' });
    const currentMonthText = formatter.format(dateObj);

    const checkpointUntil = new Date().toISOString();
    const incremental = Boolean(sinceTs) || (lastSnapDate && trafficStart > startOfCurrentMonth);

    return res.json({
      period: `Mes Actual (${currentMonthText})`,
      client: clientId,
      metrics: {
        total_kilometers: Math.round(totalKm),
        active_vehicles: activeVehicles,
        max_speed_kmh: Math.round(maxSpeed),
        driver_ranking: driverRanking,
      },
      ui_texts: {
        title1: 'Kilometraje del Mes',
        desc1: `Tus vehículos han recorrido ${Math.round(totalKm).toLocaleString()} km en lo que va de ${currentMonthText}.`,
        title2: 'Activos en el Mes',
        desc2: `${activeVehicles} vehículos registrados activos en el mes en curso.`,
        title3: 'Prevención de Riesgos',
        desc3: `Velocidad Máxima detectada este mes: ${Math.round(maxSpeed)} km/h.`,
        title4: `Ranking de Conductores (${currentMonthText})`,
        desc4: 'Lista de la flota. Ordenados desde los peores evaluados hacia los mejores, basado en su telemetría del mes en curso.',
      },
      checkpoint: {
        until: checkpointUntil,
        incremental,
        traffic_from: trafficStart,
        last_snapshot: lastSnapDate || null,
      },
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
    const { start: startOfCurrentMonth, end: endOfCurrentMonth } = currentMonthBounds();

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
      params: { imei, startDate: startOfCurrentMonth, endDate: endOfCurrentMonth },
    });

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
          event: row.event,
        });
        lastTime = dt;
      }
    }

    clusteredEvents.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    return res.json({
      imei,
      type,
      count: clusteredEvents.length,
      events: clusteredEvents,
    });
  } catch (err) {
    console.error('[Billing API] Error fetching driver events:', err);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

module.exports = router;
