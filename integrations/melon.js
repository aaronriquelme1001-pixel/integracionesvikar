const BaseStrategy = require('./BaseStrategy');

class MelonStrategy extends BaseStrategy {
  /**
   * Executes the Melon/UNIGIS integration.
   * 
   * @param {Object} telemetry - Raw telemetry from GPS Server.
   * @param {Object} deviceConfig - Vehicle metadata from devices.json.
   * @param {Object} integrationConfig - Melon specific config overrides from devices.json.
   */
  async execute(telemetry, deviceConfig, integrationConfig) {
    const url = integrationConfig.endpoint || process.env.UNIGIS_API_URL || 'https://cloud-test.unigis.com/hub_TEST/mapi/soap/gps/service.asmx';
    const user = integrationConfig.user || process.env.UNIGIS_SYSTEM_USER || 'VIKARGPS';
    const pass = integrationConfig.password || process.env.UNIGIS_PASSWORD || 'VIKARGPS2024';

    const paramsObj = this.parseParams(telemetry.params);
    const isEngineOn = paramsObj.acc === '1' || paramsObj.acc === 1 || telemetry.event === 'ignition_on';

    // Format date times as ISO XML dates
    const eventTime = this.formatDate(telemetry.dt_tracker, 'ISO_T');
    const receptionTime = this.formatDate(telemetry.dt_server || telemetry.dt_tracker, 'ISO_T');

    const eventCode = isEngineOn ? 'ignition_on' : 'ignition_off';

    const latVal = parseFloat(telemetry.lat || 0).toFixed(6);
    const lngVal = parseFloat(telemetry.lng || 0).toFixed(6);
    const speedVal = Math.round(parseFloat(telemetry.speed || 0));

    // Build SOAP 1.1 Envelope
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
    const result = await this.sendSOAPRequest(url, 'http://unisolutions.com.ar/LoginYInsertarEvento2', soapEnvelope);

    if (result.success) {
      console.log(`[UNIGIS] Success Response:`, result.data.substring(0, 300));
    } else {
      console.error(`[UNIGIS] Forwarding failed:`, result.error);
    }
  }
}

module.exports = MelonStrategy;
