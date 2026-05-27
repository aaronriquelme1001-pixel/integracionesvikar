const axios = require('axios');

/**
 * Converts "YYYY-MM-DD HH:mm:ss" to "DD-MM-YYYY HH:mm:ss"
 */
function formatAraucoDate(dtStr) {
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
 * Sends telemetry data to Arauco (SISCO GPS).
 * 
 * @param {Object} telemetry - Raw telemetry from GPS Server.
 * @param {Object} deviceConfig - Vehicle metadata from devices.json.
 */
async function sendToArauco(telemetry, deviceConfig) {
  const url = process.env.ARAUCO_API_URL || 'http://clsclwebqas09.arauco.cl/GPSChileWS/GPSChileWS.asmx';
  const provider = process.env.ARAUCO_PROVIDER_NAME || 'VIKARGPS';
  const nomFlota = process.env.ARAUCO_NOM_FLOTA || 'VIKARGPS';
  const codFlota = process.env.ARAUCO_COD_FLOTA || '1539';

  const paramsObj = parseParams(telemetry.params);
  const isEngineOn = paramsObj.acc === '1' || paramsObj.acc === 1 || telemetry.event === 'ignition_on';
  
  // Extract first 5 digits of IMEI for Cod_Unidad
  const codUnidad = telemetry.imei ? telemetry.imei.substring(0, 5) : '00000';
  const numActividad = Date.now() + Math.floor(Math.random() * 1000);

  const formattedTime = formatAraucoDate(telemetry.dt_tracker || telemetry.dt_server);
  
  // Determine Event Code and Names based on engine state/speed
  let codTipoEvento = 21;
  let tipoEvento = '4';
  let nomTipoEvento = 'SIN CONTACTO';

  if (isEngineOn) {
    codTipoEvento = 20;
    tipoEvento = '3';
    nomTipoEvento = 'EN CONTACTO';
  }

  const speedVal = Math.round(parseFloat(telemetry.speed || 0));
  const angleVal = Math.round(parseFloat(telemetry.angle || 0));
  const odomVal = Math.round(parseFloat(telemetry.odometer || 0));
  const hdopVal = Math.round(parseFloat(telemetry.hdop || 0));
  const satVal = Math.round(parseFloat(telemetry.gps_satellites || 0));

  // Build SOAP 1.1 Envelope
  const soapEnvelope = `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <WM_INS_ACTIVIDAD0_GPS_Masivo xmlns="http://siscoWS">
      <ParamDataGPS>
        <DataGPS>
          <Num_Actividad>${numActividad}</Num_Actividad>
          <Cod_Flota>${codFlota}</Cod_Flota>
          <NomFlota>${nomFlota}</NomFlota>
          <Cod_Unidad>${codUnidad}</Cod_Unidad>
          <NomUnidad>${deviceConfig.plate}</NomUnidad>
          <Cod_Asignado>0</Cod_Asignado>
          <NomAsignado></NomAsignado>
          <FechaHoraActividad>${formattedTime}</FechaHoraActividad>
          <Latitud>${telemetry.lat}</Latitud>
          <Longitud>${telemetry.lng}</Longitud>
          <Ignicion>${isEngineOn ? 1 : 0}</Ignicion>
          <Ubicacion>${telemetry.desc || ''}</Ubicacion>
          <Velocidad>${speedVal}</Velocidad>
          <VelocidadMaxima>0</VelocidadMaxima>
          <Odometro>${odomVal}</Odometro>
          <DistanciaViaje>0</DistanciaViaje>
          <DistanciaIncremental>0</DistanciaIncremental>
          <Cod_TipoEvento>${codTipoEvento}</Cod_TipoEvento>
          <TipoEvento>${tipoEvento}</TipoEvento>
          <NomTipoEvento>${nomTipoEvento}</NomTipoEvento>
          <Puerto>0</Puerto>
          <HDOP>${hdopVal}</HDOP>
          <NumSatelites>${satVal}</NumSatelites>
          <Hdg>${angleVal}</Hdg>
          <DatosExtendidos></DatosExtendidos>
          <Proveedor>${provider}</Proveedor>
        </DataGPS>
      </ParamDataGPS>
    </WM_INS_ACTIVIDAD0_GPS_Masivo>
  </soap:Body>
</soap:Envelope>`;

  console.log(`[Arauco] Dispatching SOAP request for ${deviceConfig.plate} to ${url}...`);

  try {
    const response = await axios.post(url, soapEnvelope, {
      headers: {
        'Content-Type': 'text/xml; charset=utf-8',
        'SOAPAction': 'http://siscoWS/WM_INS_ACTIVIDAD0_GPS_Masivo'
      },
      timeout: 10000
    });
    console.log(`[Arauco] Success Response:`, response.data.substring(0, 300));
  } catch (error) {
    console.error(`[Arauco] Forwarding failed:`, error.response ? error.response.data : error.message);
  }
}

module.exports = {
  sendToArauco
};
