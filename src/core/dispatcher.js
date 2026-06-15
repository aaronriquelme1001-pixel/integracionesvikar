const fs = require('fs');
const path = require('path');
const { getDeviceConfig, getDynamicIntegrationConfig } = require('../config/devices');
const { systemStats, deviceAntiSpamState, retryQueue } = require('./state');

// Load all integration strategies dynamically
const strategiesDir = path.join(__dirname, '../../integrations');
const strategies = {};

fs.readdirSync(strategiesDir).forEach(file => {
  if (file.endsWith('.js') && file !== 'BaseStrategy.js') {
    const strategyName = file.replace('.js', '').toLowerCase();
    const StrategyClass = require(path.join(strategiesDir, file));
    strategies[strategyName] = new StrategyClass();
  }
});

/**
 * Core B2B Dispatch Engine.
 * Takes normalized telemetry and dispatches it to all B2B strategies configured for the device.
 */
async function dispatchToB2B(telemetry, clientName = null, explicitTarget = null) {
  const { imei } = telemetry;
  const nowMs = Date.now();
  const PARKED_HEARTBEAT_MS = 20 * 60 * 1000; // 20 minutes
  let shouldSend = true;

  // Filtro Inteligente Anti-Spam con Latido (Heartbeat) - Aplica a Poller y Webhooks
  if (telemetry.dt_tracker) {
    const state = deviceAntiSpamState[imei] || {};
    const timeSinceLastSend = nowMs - (state.lastSentAt || 0);

    if (state.dt_tracker === telemetry.dt_tracker) {
      if (timeSinceLastSend < PARKED_HEARTBEAT_MS) {
        shouldSend = false; // Bloquear spam
      } else {
        console.log(`[B2B Dispatch] Enviando latido de 20 minutos para estacionado: ${imei}`);
      }
    }
    
    if (shouldSend) {
      if (!state.dt_tracker || telemetry.dt_tracker >= state.dt_tracker) {
        deviceAntiSpamState[imei] = {
          dt_tracker: telemetry.dt_tracker,
          lastSentAt: nowMs
        };
      }
    }
  }

  if (!shouldSend) return;

  // Look up device configuration from devices.json
  let deviceConfig = getDeviceConfig(imei);
  let activeStrategies = new Set();
  let strategyClients = {};

  // 1. Añadir integraciones estáticas de devices.json
  if (deviceConfig && deviceConfig.integrations) {
    for (const target of Object.keys(deviceConfig.integrations)) {
      if (deviceConfig.integrations[target] && deviceConfig.integrations[target].enabled) {
        activeStrategies.add(target);
        strategyClients[target] = deviceConfig.integrations[target].client;
      }
    }
  }

  // 2. Añadir integraciones dinámicas (Ruteo Zero-Code)
  if (clientName) {
    const clientLower = clientName.toLowerCase();
    for (const strategyName of Object.keys(strategies)) {
      const envVarName = `GPSSERVER_POLL_${strategyName.toUpperCase()}_CLIENTS`;
      const wildcardClients = (process.env[envVarName] || '').split(',').map(c => c.trim().toLowerCase()).filter(Boolean);
      
      if (wildcardClients.includes(clientLower)) {
        activeStrategies.add(strategyName);
        strategyClients[strategyName] = clientLower;
        
        if (!deviceConfig) {
          deviceConfig = {
            plate: telemetry.plate_number || telemetry.name || telemetry.plate || 'SIN_PATENTE',
            carrier: telemetry.carrier || 'VIKARGPS',
            integrations: {}
          };
        }
      }
    }
  }

  // 3. Añadir target explícito (URL Webhook con ?target=)
  if (explicitTarget && strategies[explicitTarget.toLowerCase()]) {
    const target = explicitTarget.toLowerCase();
    activeStrategies.add(target);
    strategyClients[target] = clientName || 'default';
    if (!deviceConfig) {
      deviceConfig = {
        plate: telemetry.plate_number || telemetry.name || telemetry.plate || 'SIN_PATENTE',
        carrier: telemetry.carrier || 'VIKARGPS',
        integrations: {}
      };
    }
  }

  if (activeStrategies.size === 0) return;

  systemStats.totalPointsDispatched++;
  systemStats.lastDispatchTime = new Date().toISOString();

  console.log(`[B2B Dispatch] Device: ${deviceConfig.plate || imei} — Routing to: ${Array.from(activeStrategies).join(', ')}`);

  const promises = Array.from(activeStrategies).map(async (target) => {
    const strategy = strategies[target];
    if (!strategy) return;

    const resolvedConfig = {
      ...getDynamicIntegrationConfig(target, strategyClients[target]),
      ...(deviceConfig.integrations && deviceConfig.integrations[target] ? deviceConfig.integrations[target] : { enabled: true, client: strategyClients[target] })
    };

    try {
      await strategy.execute(telemetry, deviceConfig, resolvedConfig);
    } catch (err) {
      console.error(`[B2B Dispatch] Error executing strategy '${target}':`, err.message);
      if (retryQueue.length < 5000) {
        retryQueue.push({
          target,
          telemetry,
          deviceConfig,
          resolvedConfig,
          retries: 0,
          nextAttempt: Date.now() + 5000
        });
      } else {
        console.warn(`[B2B Dispatch] 🚨 Cola de reintentos saturada (5000). Descartando carga para ${telemetry.imei}`);
      }
    }
  });

  await Promise.all(promises);
}

// Background Worker: Cola de Reintentos
setInterval(async () => {
  if (retryQueue.length === 0) return;
  
  const now = Date.now();
  const index = retryQueue.findIndex(i => now >= (i.nextAttempt || 0));
  if (index === -1) return;
  
  const item = retryQueue.splice(index, 1)[0];
  
  if (item.retries > 5) {
     console.log(`[Retry Queue] ❌ Descartando carga para ${item.telemetry.imei} hacia ${item.target} tras 5 intentos fallidos. Backfiller lo recuperará más tarde si aplica.`);
     return;
  }
  
  console.log(`[Retry Queue] ♻️ Reintentando envío de ${item.telemetry.imei} hacia ${item.target} (Intento ${item.retries + 1})...`);
  const strategy = strategies[item.target];
  if (!strategy) return;
  
  try {
    await strategy.execute(item.telemetry, item.deviceConfig, item.resolvedConfig);
    console.log(`[Retry Queue] ✅ Reintento exitoso para ${item.telemetry.imei} hacia ${item.target}!`);
  } catch (err) {
    console.error(`[Retry Queue] ⚠️ Reintento fallido para ${item.telemetry.imei} hacia ${item.target}:`, err.message);
    item.retries++;
    const delay = 5000 * Math.pow(3, item.retries); // 15s, 45s, 135s, 405s...
    item.nextAttempt = Date.now() + delay;
    retryQueue.push(item);
  }
}, 2000);

module.exports = {
  dispatchToB2B
};
