const { dispatchToB2B } = require('../core/dispatcher');

async function handleIncomingGps(req, res) {
  try {
    const payload = req.body;
    
    // Support single object or array of objects
    const dataArray = Array.isArray(payload) ? payload : [payload];

    if (dataArray.length === 0) {
      return res.status(400).json({ error: 'Empty payload' });
    }

    let processedCount = 0;

    for (const item of dataArray) {
      // Required fields
      if (!item.plate || !item.target || !item.client) {
        console.warn(`[Inbound Webhook] Rechazado: Falta plate, target o client.`, item);
        continue;
      }
      
      if (item.lat === undefined || item.lng === undefined) {
         console.warn(`[Inbound Webhook] Rechazado: Faltan coordenadas para ${item.plate}.`);
         continue;
      }

      const telemetry = {
        imei: item.plate, // Using plate as unique ID if IMEI is not provided
        name: item.plate,
        plate: item.plate,
        plate_number: item.plate,
        lat: parseFloat(item.lat),
        lng: parseFloat(item.lng),
        speed: parseFloat(item.speed || 0),
        angle: parseFloat(item.angle || 0),
        dt_tracker: item.dt_tracker ? new Date(item.dt_tracker).toISOString() : new Date().toISOString(),
        dt_server: new Date().toISOString(),
        loc_valid: 1,
        params: item.params || ''
      };

      // Dispatch to B2B explicitly targeting the requested integration
      await dispatchToB2B(telemetry, item.client, item.target);
      processedCount++;
    }

    res.status(200).json({ 
      status: 'ok', 
      message: `Procesado exitosamente. ${processedCount} registros enviados al Motor B2B.` 
    });

  } catch (error) {
    console.error('[Inbound Webhook] Error interno:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
}

module.exports = {
  handleIncomingGps
};
