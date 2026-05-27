const BaseStrategy = require('./BaseStrategy');

class FalabellaStrategy extends BaseStrategy {
  /**
   * Executes the Falabella integration.
   * 
   * @param {Object} telemetry - Raw telemetry from GPS Server.
   * @param {Object} deviceConfig - Vehicle metadata from devices.json.
   * @param {Object} integrationConfig - Falabella specific config overrides from devices.json.
   */
  async execute(telemetry, deviceConfig, integrationConfig) {
    const url = integrationConfig.endpoint || process.env.FALABELLA_API_URL || 'http://ww3.qanalytics.cl/gps_test/service.asmx';
    const user = integrationConfig.user || process.env.FALABELLA_USER || 'WS_test';
    const pass = integrationConfig.password || process.env.FALABELLA_PASSWORD || '$$WS17';

    const paramsObj = this.parseParams(telemetry.params);
    const isEngineOn = paramsObj.acc === '1' || paramsObj.acc === 1 || telemetry.event === 'ignition_on';

    const formattedTime = this.formatDate(telemetry.dt_tracker || telemetry.dt_server, 'DD-MM-YYYY HH:mm:ss');

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
    const result = await this.sendSOAPRequest(url, 'http://tempuri.org/WM_INS_REPORTE_CLASS', soapEnvelope);

    if (result.success) {
      console.log(`[Falabella] Success Response:`, result.data.substring(0, 300));
    } else {
      console.error(`[Falabella] Forwarding failed:`, result.error);
    }
  }
}

module.exports = FalabellaStrategy;
