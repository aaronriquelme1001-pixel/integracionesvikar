const { dispatchToB2B } = require('../core/dispatcher');
const { systemStats } = require('../core/state');

/**
 * Unified endpoint for GPS Server webhook (GET and POST support)
 */
async function handleGpsServerWebhook(req, res) {
  systemStats.totalWebhooksProcessed++;
  const telemetryObj = { ...req.query, ...req.body };
  const imei = telemetryObj.imei;
  if (!imei) {
    return res.status(200).send('ok');
  }

  let targetParam = req.query.target;
  let clientParam = req.query.client || telemetryObj.client;

  if (targetParam && targetParam.includes('?')) targetParam = targetParam.split('?')[0];
  if (clientParam && clientParam.includes('?')) clientParam = clientParam.split('?')[0];

  const telemetry = {
    imei: String(imei),
    plate_number: telemetryObj.plate_number || telemetryObj.plate,
    name: telemetryObj.name,
    dt_tracker: telemetryObj.dt || null,
    dt_server: telemetryObj.dt || null,
    lat: telemetryObj.lat !== undefined ? String(telemetryObj.lat) : '0',
    lng: telemetryObj.lng !== undefined ? String(telemetryObj.lng) : '0',
    altitude: telemetryObj.altitude || 0,
    angle: telemetryObj.angle || 0,
    speed: telemetryObj.speed || 0,
    loc_valid: telemetryObj.loc_valid !== undefined ? telemetryObj.loc_valid : 1,
    params: telemetryObj.params || '',
    event: telemetryObj.event || null
  };

  try {
    await dispatchToB2B(telemetry, clientParam, targetParam);
    return res.status(200).send('ok');
  } catch (err) {
    console.error('[Webhook] ❌ Critical failure dispatching B2B event:', err.message);
    return res.status(500).send('Internal Server Error');
  }
}

module.exports = {
  handleGpsServerWebhook
};
