const axios = require('axios');

/**
 * Converts "YYYY-MM-DD HH:mm:ss" to "YYYY-MM-DDTHH:mm:ss" ISO format
 */
function formatUnigisDate(dtStr) {
  if (!dtStr) return new Date().toISOString().substring(0, 19);
  return dtStr.replace(' ', 'T');
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
 * Sends telemetry data to Cementos Melón (UNIGIS).
 * 
 * @param {Object} telemetry - Raw telemetry from GPS Server.
 * @param {Object} deviceConfig - Vehicle metadata from devices.json.
 */
async function sendToMelon(telemetry, deviceConfig) {
  const url = process.env.UNIGIS_API_URL || 'https://cloud-test.unigis.com/hub_TEST/mapi/soap/gps/service.asmx';
  const user = process.env.UNIGIS_SYSTEM_USER || 'VIKARGPS';
  const pass = process.env.UNIGIS_PASSWORD || 'VIKARGPS2024';

  const paramsObj = parseParams(telemetry.params);
  const isEngineOn = paramsObj.acc === '1' || paramsObj.acc === 1 || telemetry.event === 'ignition_on';

  // Format date times
  const eventTime = formatUnigisDate(telemetry.dt_tracker);
  const receptionTime = formatUnigisDate(telemetry.dt_server || telemetry.dt_tracker);

  // Determine Event Code based on ignition
  const eventCode = isEngineOn ? 'ignition_on' : 'ignition_off';

  const latVal = parseFloat(telemetry.lat || 0).toFixed(6);
  const lngVal = parseFloat(telemetry.lng || 0).toFixed(6);
  const speedVal = Math.round(parseFloat(telemetry.speed || 0));

  // Build SOAP 1.1 Envelope calling LoginYInsertarEvento2
  const soapEnvelope = `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <LoginYInsertarEvento2 xmlns="http://unisolutions.com.ar/">
      <SystemUser>${user}</SystemUser>
      <Password>${pass}</Password>
      <Dominio>${deviceConfig.plate}</Dominio>
      <NroSerie>-1</NroSerie>
      <Codigo>${eventCode}</Codigo>
      <Latitud>${latVal}</Latitud>
      <Longitud>${lngVal}</Longitud>
      <Altitud>0</Altitud>
      <Velocidad>${speedVal}</Velocidad>
      <FechaHoraEvento>${eventTime}</FechaHoraEvento>
      <FechaHoraRecepcion>${receptionTime}</FechaHoraRecepcion>
      <Valido>true</Valido>
      <Sensores>
        <pSensor>
          <Clave>Ignicion</Clave>
          <Valor>${isEngineOn ? '1' : '0'}</Valor>
        </pSensor>
        <pSensor>
          <Clave>Bateria</Clave>
          <Valor>${paramsObj.batp || '100'}</Valor>
        </pSensor>
      </Sensores>
    </LoginYInsertarEvento2>
  </soap:Body>
</soap:Envelope>`;

  console.log(`[UNIGIS] Dispatching SOAP request for ${deviceConfig.plate} to ${url}...`);

  try {
    const response = await axios.post(url, soapEnvelope, {
      headers: {
        'Content-Type': 'text/xml; charset=utf-8',
        'SOAPAction': 'http://unisolutions.com.ar/LoginYInsertarEvento2'
      },
      timeout: 10000
    });
    console.log(`[UNIGIS] Success Response:`, response.data.substring(0, 300));
  } catch (error) {
    console.error(`[UNIGIS] Forwarding failed:`, error.response ? error.response.data : error.message);
  }
}

module.exports = {
  sendToMelon
};
