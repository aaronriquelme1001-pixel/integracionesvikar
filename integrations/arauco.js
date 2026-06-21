const BaseStrategy = require('./BaseStrategy');

class AraucoStrategy extends BaseStrategy {
  /**
   * Executes the Arauco integration.
   * 
   * @param {Object} telemetry - Raw telemetry from GPS Server.
   * @param {Object} deviceConfig - Vehicle metadata from devices.json.
   * @param {Object} integrationConfig - Arauco specific config overrides from devices.json.
   */
  async execute(telemetry, deviceConfig, integrationConfig) {
    try {
      const url = integrationConfig.endpoint || process.env.ARAUCO_API_URL || 'http://clsclwebqas09.arauco.cl/GPSChileWS/GPSChileWS.asmx';
    const provider = integrationConfig.provider || process.env.ARAUCO_PROVIDER_NAME || 'VIKARGPS';
    const nomFlota = integrationConfig.nom_flota || process.env.ARAUCO_NOM_FLOTA || 'VIKARGPS';
    const codFlota = integrationConfig.cod_flota || process.env.ARAUCO_COD_FLOTA || '1539';

    const paramsObj = this.parseParams(telemetry.params);
    const isEngineOn = paramsObj.acc === '1' || paramsObj.acc === 1 || telemetry.event === 'ignition_on';
    
    const codUnidad = telemetry.imei ? telemetry.imei.substring(0, 5) : '00000';
    const numActividad = Date.now() + Math.floor(Math.random() * 1000);

    const formattedTime = this.formatDate(telemetry.dt_tracker || telemetry.dt_server, 'DD-MM-YYYY HH:mm:ss');
    
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
    const hdopVal = Math.round(parseFloat(telemetry.hdop || paramsObj.hdop || 0));
    const satVal = Math.round(parseFloat(telemetry.gps_satellites || paramsObj.sat || paramsObj.satellites || 0));

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
    const result = await this.sendSOAPRequest(url, 'http://siscoWS/WM_INS_ACTIVIDAD0_GPS_Masivo', soapEnvelope);

    if (result.success) {
      console.log(`[Arauco] Success Response:`, result.data.substring(0, 300));
    } else {
      console.error(`[Arauco] Forwarding failed:`, result.error);
    }
    } catch (error) {
      console.error('[Arauco] Integration error:', error.message);
    }
  }
}

module.exports = AraucoStrategy;
