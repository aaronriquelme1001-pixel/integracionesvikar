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
 * Parse a date/time string for fleet history queries.
 * Accepts:
 *   - Chile local "DD-MM-YYYY HH:mm[:ss]"
 *   - ISO "YYYY-MM-DD" or "YYYY-MM-DDTHH:mm[:ss]" (portal checkpoint format)
 *
 * @param {string} dStr
 * @param {boolean} isEndOfDay — when only a date is given without time
 * @returns {Date|null}
 */
function parseFleetDateTime(dStr, isEndOfDay = false) {
  if (!dStr) return null;
  const trimmed = String(dStr).trim();

  // ISO: YYYY-MM-DD or YYYY-MM-DDTHH:mm[:ss] (with T or space)
  const isoMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}:\d{2}(?::\d{2})?))?$/);
  if (isoMatch) {
    const time = isoMatch[4] || (isEndOfDay ? '23:59:59' : '00:00:00');
    const t = time.split(':').length === 2 ? `${time}:00` : time;
    // Chile offset for consistency with legacy DD-MM-YYYY parser
    return new Date(`${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}T${t}-04:00`);
  }

  // Legacy Chile: DD-MM-YYYY HH:mm[:ss]
  const parts = trimmed.split(' ');
  const datePart = parts[0];
  const timePart = parts[1] || (isEndOfDay ? '23:59:59' : '00:00:00');
  const dParts = datePart.split('-');
  if (dParts.length === 3) {
    const d = dParts[0].padStart(2, '0');
    const m = dParts[1].padStart(2, '0');
    const y = dParts[2].length === 2 ? `20${dParts[2]}` : dParts[2];
    const t = timePart.split(':').length === 2 ? `${timePart}:00` : timePart;
    return new Date(`${y}-${m}-${d}T${t}-04:00`);
  }

  return null;
}

/**
 * GET /api/fleet/history
 *
 * Incremental checkpoint usage:
 *   - Pass `start_date` = last known dt_tracker (ISO or DD-MM-YYYY) from a prior fetch.
 *   - Omit `end_date` to default to now (continuous tail).
 *   - `merge_hint=1` is advisory for the portal (merge happens client-side); ignored server-side.
 */
router.get('/history', async (req, res) => {
  if (!bigquery) return res.status(500).json({ error: 'Data Lake (BigQuery) no configurado.' });

  const { imei, start_date, end_date, merge_hint: mergeHint } = req.query;

  if (!imei) return res.status(400).json({ error: 'Falta el parámetro imei.' });
  if (!start_date) return res.status(400).json({ error: 'Falta el parámetro start_date.' });

  try {
    let query = `
      SELECT lat, lng, speed, dt_tracker, plate, altitude, angle, params, loc_valid
      FROM \`telemetry.global_traffic\`
      WHERE imei = @imei
    `;
    const params = { imei };

    const normStart = parseFleetDateTime(start_date);
    let normEnd = end_date ? parseFleetDateTime(end_date, true) : new Date();

    if (!normStart) {
      return res.status(400).json({ error: 'start_date no pudo interpretarse.' });
    }

    if (!normEnd || normEnd < normStart) {
      normEnd = new Date();
    }

    query += ' AND dt_tracker >= @normStart';
    params.normStart = normStart;

    query += ' AND dt_tracker <= @normEnd';
    params.normEnd = normEnd;

    query += ' ORDER BY dt_tracker ASC LIMIT 10000';

    const [rows] = await bigquery.query({ query, params });

    const formattedRows = rows.map((row) => ({
      ...row,
      dt_tracker: row.dt_tracker.value ? row.dt_tracker.value : row.dt_tracker,
    }));

    const lastDt = formattedRows.length
      ? formattedRows[formattedRows.length - 1].dt_tracker
      : null;

    res.json({
      success: true,
      count: formattedRows.length,
      data: formattedRows,
      checkpoint: {
        from: normStart.toISOString(),
        until: normEnd.toISOString(),
        last_dt: lastDt,
        merge_hint: mergeHint === '1' || mergeHint === 'true',
      },
    });
  } catch (err) {
    console.error('Error fetching fleet history:', err);
    res.status(500).json({ error: 'Error interno obteniendo el historial.' });
  }
});

module.exports = router;
