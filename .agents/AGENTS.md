# Reglas Maestras del Proyecto Integraciones Vikar

1. **NO a la Amnesia Arquitectónica**: El sistema usa "Zero-Code Dynamic Routing" mediante variables de entorno (ej. `GPSSERVER_POLL_AVLCHILE_CLIENTS`). Nunca intentes hardcodear clientes en el código fuente.
2. **Poller Centralizado**: Extraemos todos los camiones de `gsh7.net` con una única llave (`GPS_SERVER_MASTER_KEY`). No existen llaves por cliente.
3. **Frecuencia Intocable**: El Poller dispara cada 3 segundos. Está diseñado así intencionalmente. El filtro Anti-Spam (en `dispatcher.js`) es el encargado de frenar el bombardeo a los clientes (dejando pasar 1 dato cada 30s/60s según corresponda).
4. **Verificar antes de Tocar**: Antes de modificar `dispatcher.js`, `gpsServer.js` o `index.js`, SIEMPRE revisa cómo fluye la data. Si necesitas añadir un mandante nuevo, solo crea el archivo en `src/integrations/` y el dispatcher dinámico hará el resto.

> "Si dudo sobre la arquitectura, invocaré la skill `vikar-architecture-guardian` o leeré esta regla antes de romper la plataforma de producción de Aaron."
