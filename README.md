# 🧠 Cerebro: B2B Telemetry Orchestrator

Motor de orquestación B2B de ultra-baja latencia diseñado para extraer, normalizar y rutear telemetría GPS desde múltiples fuentes hacia múltiples Web Services (Traccar, AVL Chile, Colun, Arauco, etc.).

## 🚀 Arquitectura "Híbrida" (Push-Poll)

El sistema funciona con un enfoque híbrido, garantizando 0% de pérdida de datos y cumplimiento normativo (MTT):

1. **Poller de 10 Segundos:** Extrae el estado actual de los dispositivos desde la API de GPS Server cada 10 segundos.
2. **Backfiller de Inteligencia Artificial:** Detecta gaps o saltos en el tiempo (ej. salida de túneles) mayores a 15 segundos. Se conecta de forma asíncrona a la API de historial y recupera toda la ráfaga perdida, inyectándola en estricto orden cronológico.
3. **Webhook Universal:** Soporta Data Forwarding nativo en la ruta `/webhook/gps-server`, procesando los paquetes bajo las mismas reglas Anti-Spam.

## 🛡️ Reglas de Despacho (Anti-Spam)

Todas las integraciones están protegidas por el **Motor Central de Despacho**:
*   **Filtro Inteligente:** Si un camión no se mueve (su timestamp no cambia), se bloquea el envío para no saturar al cliente destino.
*   **Heartbeat de 20 min:** Todo vehículo estacionado enviará 1 solo punto estático cada 20 minutos para evitar estado "Desconectado".
*   **Colas Recursivas:** Evita colisiones de peticiones HTTP utilizando `setTimeout` recursivos en lugar de ciclos paralelos, previniendo baneos por Rate Limiting (ej. AVL Chile).

## 🔀 Ruteo "Zero-Code" (Variables de Entorno)

Para mandar una flota a un Web Service destino, no se requiere modificar código. Basta con editar las variables en Render:

```env
# Extraerá los camiones de luisherrera y transklett, y los mandará a AVL Chile y Traccar
GPSSERVER_POLL_CLIENTS=luisherrera,transklett
GPSSERVER_POLL_AVLCHILE_CLIENTS=luisherrera,transklett
GPSSERVER_POLL_TRACCAR_CLIENTS=luisherrera
```

## 🛠️ Instalación

1. Clonar el repositorio.
2. Copiar `.env.example` a `.env` y llenar las variables (API Keys, URLs).
3. `npm install`
4. `npm start`
