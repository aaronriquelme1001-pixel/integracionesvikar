const axios = require('axios');

/**
 * Converts "YYYY-MM-DD HH:mm:ss" to "DD-MM-YYYY HH:mm:ss"
 */
function formatFalabellaDate(dtStr) {
  if (!dtStr) return '';
  const parts = dtStr.split(' ');
  if (parts.length === 2) {
    const dateParts = parts[0].split('-');
    if (dateParts.length === 3) {
      return `${dateParts[2]}-${dateParts[1]}-${dateParts[0]} ${parts[1]}`;
    }
  }
  return dtStr;
}

function parseParams(paramsStr) {
  const result = {};
  if (!paramsStr) return result;
  const parts = paramsStr.split('|');
  for (const part of parts) {
    if (part) {
      const kv = part.split('=');
      if (kv.length === 2) {
        result[kv[0]] = kv[1];
      }
    }
  }
  return result;
}

/**
 * Sends telemetry data to Falabella (QMGPS / QAnalytics).
 * 
 * @param {Object} telemetry - Raw telemetry from GPS Server.
 * @param {Object} deviceConfig - Vehicle metadata from devices.json.
 */
async function sendToFalabella(telemetry, deviceConfig) {
  const url = process.env.FALABELLA_API_URL || 'http://ww3.qanalytics.cl/gps_test/service.asmx';
  const user = process.env.FALABELLA_USER || 'WS_test';
  const pass = process.env.FALABELLA_PASSWORD || '$$WS17';

  const paramsObj = parseParams(telemetry.params);
  const isEngineOn = paramsObj.acc === '1' || paramsObj.acc === 1 || telemetry.event === 'ignition_on';

  const formattedTime = formatFalabellaDate(telemetry.dt_tracker || telemetry.dt_server);

  const speedVal = Math.round(parseFloat(telemetry.speed || 0));
  const angleVal = Math.round(parseFloat(telemetry.angle || 0));
  const satVal = Math.round(parseFloat(telemetry.gps_satellites || 0));
  const hdopVal = Math.round(parseFloat(telemetry.hdop || 0));

  // Build SOAP 1.1 Envelope
  const soapEnvelope = `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Header>
    <Authentication xmlns="http://tempuri.org/">
      <Usuario>${user}</Usuario>
      <Clave>${pass}</Clave>
    </Authentication>
  </soap:Header>
  <soap:Body>
    <WM_INS_REPORTE_CLASS xmlns="http://tempuri.org/">
      <Tabla>
        <Datos>
          <ID_REG>${telemetry.imei}</ID_REG>
          <LATITUD>${telemetry.lat}</LATITUD>
          <LONGITUD>${telemetry.lng}</LONGITUD>
          <SENTIDO>${angleVal}</SENTIDO>
          <VELOCIDAD>${speedVal}</VELOCIDAD>
          <FH_DATO>${formattedTime}</FH_DATO>
          <PLACA>${deviceConfig.plate}</PLACA>
          <CANT_SATELITES>${satVal}</CANT_SATELITES>
          <HDOP>${hdopVal}</HDOP>
          <TEMP1>999</TEMP1>
          <TEMP2>999</TEMP2>
          <TEMP3>999</TEMP3>
          <SENSORA_1>999</SENSORA_1>
          <AP>-1</AP>
          <IGNICION>${isEngineOn ? 1 : 0}</IGNICION>
          <PANICO>-1</PANICO>
          <SENSORD_1>-1</SENSORD_1>
          <TRANS>${deviceConfig.carrier}</TRANS>
        </Datos>
      </Tabla>
    </WM_INS_REPORTE_CLASS>
  </soap:Body>
</soap:Envelope>`;

  console.log(`[Falabella] Dispatching SOAP request for ${deviceConfig.plate} to ${url}...`);

  try {
    const response = await axios.post(url, soapEnvelope, {
      headers: {
        'Content-Type': 'text/xml; charset=utf-8',
        'SOAPAction': 'http://tempuri.org/WM_INS_REPORTE_CLASS'
      },
      timeout: 10000
    });
    console.log(`[Falabella] Success Response:`, response.data.substring(0, 300));
  } catch (error) {
    console.error(`[Falabella] Forwarding failed:`, error.response ? error.response.data : error.message);
  }
}

module.exports = {
  sendToFalabella
};
