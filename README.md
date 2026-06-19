# Vikar B2B Telemetry Orchestrator (V4)

Este es el núcleo de integración, extracción y análisis forense de Vikar GPS. 
El sistema extrae datos de proveedores GPS comerciales (Tracksolid Pro, GPS Server), los almacena de forma persistente en un **Data Lake** propio, y distribuye la telemetría en tiempo real hacia los sistemas de las grandes empresas mandantes (Arauco, CMPC, Walmart, CCU, etc.). Adicionalmente, cuenta con un Motor Forense para reconstrucción de incidentes.

## Arquitectura Modular (`/src`)

El sistema está dividido en módulos de responsabilidad única:

- `src/pollers/`: Extractores de datos que se conectan a los proveedores (ej. Tracksolid, GPS Server) y normalizan la información a un formato estándar interno.
- `src/core/`: El "Cerebro". Aquí reside el `dispatcher.js`, que toma un dato normalizado, consulta la configuración B2B del dispositivo, y lo despacha a los destinos correspondientes.
- `src/integrations/`: Estrategias de envío hacia mandantes. Cada archivo (ej. `walmart.js`, `arauco.js`) implementa la autenticación y el formato específico exigido por esa empresa.
- `src/webhooks/`: Endpoints de entrada pasiva para dispositivos que empujan datos (ej. Teltonika, Concox) directamente al servidor sin necesidad de Polling.
- `src/routes/`: APIs REST expuestas para consumo de frontend o clientes. Destaca `forensics.js`, el Motor de Veredicto Determinístico.
- `src/templates/`: Plantillas HTML y recursos gráficos, como el diseño del Reporte Forense Enriquecido.
- `src/config/`: Archivos de configuración estática y resolución de variables de entorno.
- `src/utils/`: Utilidades compartidas (criptografía de firmas, helpers de fecha).

## Capacidades Especiales

### 1. Multi-Routing B2B
Un camión puede configurarse para transmitir a **múltiples destinos simultáneamente**. Por ejemplo, un paquete de posición puede ir a `Traccar` (espejo del cliente), a `Arauco` (mandante) y al `Data Lake` en paralelo y en milisegundos.

### 2. Backfiller Inteligente
Si el servidor o el GPS pierden conexión temporal, el orquestador detecta los "huecos" de tiempo y usa una cola inteligente (`recovery`) para ir a buscar los históricos faltantes a la API del proveedor original, garantizando un Data Lake sin lagunas.

### 3. Motor Pericial Forense (Veredicto Inteligente)
El sistema puede generar un reporte legal exhaustivo `/api/forensic-report?plate=XYZ`.
Este reporte:
1. Extrae los últimos 30 minutos de conducción del Data Lake (Supabase).
2. Calcula Excesos de Velocidad (vs Límite de 80km/h).
3. Calcula Fatiga del Conductor (horas de manejo continuo).
4. Consulta el Clima exacto (Open-Meteo) y la dirección postal (OpenStreetMap).
5. Cruza las variables en un motor de reglas para dictar un **Veredicto Determinístico** inobjetable para aseguradoras.

## Despliegue en Render

Este proyecto está optimizado para ejecutarse en Render (Node.js).
Para despliegues productivos, asegúrate de configurar correctamente todas las variables de entorno (`.env`) detalladas en el archivo `.env.example`.
