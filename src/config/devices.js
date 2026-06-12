const fs = require('fs');
const path = require('path');

// Determine the correct path for devices.json (handling local vs deployed paths)
let configPath = path.join(__dirname, '../../config/devices.json');
if (!fs.existsSync(configPath) && fs.existsSync('/opt/render/project/src/config/devices.json')) {
  configPath = '/opt/render/project/src/config/devices.json';
} else if (!fs.existsSync(configPath) && fs.existsSync(path.join(__dirname, 'devices.json'))) {
  configPath = path.join(__dirname, 'devices.json');
}

/**
 * Parses and returns the contents of config/devices.json
 */
function parseDevicesConfig() {
  try {
    if (!fs.existsSync(configPath)) {
      console.warn(`[Config] Warning: Configuration file not found at ${configPath}`);
      return {};
    }
    const rawData = fs.readFileSync(configPath, 'utf8');
    return JSON.parse(rawData);
  } catch (err) {
    console.error('[Config] Error reading config/devices.json:', err.message);
    return {};
  }
}

/**
 * Returns the static B2B configuration for a given IMEI from devices.json.
 * Does not resolve dynamic configurations here.
 */
function getDeviceConfig(imei) {
  const configObj = parseDevicesConfig();
  const devices = configObj.devices || {};
  return devices[imei] || null;
}

/**
 * Dynamically constructs the specific endpoint/credentials for a B2B integration
 * based on the target strategy and the configured client name.
 * Pulls from process.env (e.g. AVLCHILE_TOKEN_LUISHERRERA)
 */
function getDynamicIntegrationConfig(target, clientName) {
  if (!clientName) return {};
  
  const targetUpper = target.toUpperCase();
  const clientUpper = clientName.toUpperCase();

  const config = {};
  
  if (target === 'avlchile') {
    config.endpoint = process.env[`AVLCHILE_API_URL_${clientUpper}`] || process.env.AVLCHILE_API_URL;
    config.token = process.env[`AVLCHILE_TOKEN_${clientUpper}`] || process.env.AVLCHILE_TOKEN;
  }
  else if (target === 'colun') {
    config.endpoint = process.env[`COLUN_API_URL_${clientUpper}`] || process.env.COLUN_API_URL;
    config.token = process.env[`COLUN_BEARER_TOKEN_${clientUpper}`] || process.env.COLUN_BEARER_TOKEN;
  }
  else if (target === 'arauco') {
    config.endpoint = process.env[`ARAUCO_API_URL_${clientUpper}`] || process.env.ARAUCO_API_URL;
    config.provider = process.env[`ARAUCO_PROVIDER_NAME_${clientUpper}`] || process.env.ARAUCO_PROVIDER_NAME;
    config.flotaName = process.env[`ARAUCO_NOM_FLOTA_${clientUpper}`] || process.env.ARAUCO_NOM_FLOTA;
    config.flotaCode = process.env[`ARAUCO_COD_FLOTA_${clientUpper}`] || process.env.ARAUCO_COD_FLOTA;
  }
  else if (target === 'unigis') {
    config.endpoint = process.env[`UNIGIS_API_URL_${clientUpper}`] || process.env.UNIGIS_API_URL;
    config.user = process.env[`UNIGIS_SYSTEM_USER_${clientUpper}`] || process.env.UNIGIS_SYSTEM_USER;
    config.password = process.env[`UNIGIS_PASSWORD_${clientUpper}`] || process.env.UNIGIS_PASSWORD;
  }
  else if (target === 'falabella') {
    config.endpoint = process.env[`FALABELLA_API_URL_${clientUpper}`] || process.env.FALABELLA_API_URL;
    config.user = process.env[`FALABELLA_USER_${clientUpper}`] || process.env.FALABELLA_USER;
    config.password = process.env[`FALABELLA_PASSWORD_${clientUpper}`] || process.env.FALABELLA_PASSWORD;
  }
  else if (target === 'traccar') {
    config.endpoint = process.env[`TRACCAR_API_URL_${clientUpper}`] || process.env.TRACCAR_API_URL;
    const suffix = clientUpper ? `_${clientUpper}` : '';
    config.idType = process.env[`TRACCAR_ID_TYPE${suffix}`] || process.env.TRACCAR_ID_TYPE;
  }
  return config;
}

module.exports = {
  getDeviceConfig,
  getDynamicIntegrationConfig
};
