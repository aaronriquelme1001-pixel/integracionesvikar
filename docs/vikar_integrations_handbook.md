# Manual de Integraciones B2B y Telemática - Vikar GPS

Este manual sirve como documentación central y guía de referencia técnica para el ecosistema de ruteo de telemetría telemática desarrollado para **Vikar GPS**. Explica el diseño de la arquitectura, cómo configurar y mantener los servicios, y cómo agregar nuevos camiones o clientes B2B de forma rápida y expedita.

---

## 1. Arquitectura de Alto Nivel (Flujo Híbrido)

El sistema opera bajo un esquema híbrido de **Webhooks (Eventos en Tiempo Real)** y **Polling Engine (Consulta Periódica de Respaldo)** para asegurar que los camiones transmitan de manera continua, incluso cuando están estacionados por horas:

```mermaid
flowchart TD
    subgraph Recepción de Telemetría (Entrada)
        Tracksolid[API Tracksolid Pro] -->|1. Poller Tracksolid cada 10s| MidTracksolid[Poller Interno]
        MidTracksolid -->|2. Relé HTTP GET| GPSServer[GPS Server gsh7.net]
    end

    subgraph Ruteo B2B Integrador (integraciones-vikar)
        GPSServer -->|3. Webhook en Tiempo Real cuando se mueve| B2BRouter[Middleware Webhook]
        GPSServer -.->|3. Backup Poller GPS Server cada 20 min| B2BRouter
        
        B2BRouter -->|4. Filtro Deduplicador de 10s| RateLimit{¿Envío Reciente < 10s?}
        RateLimit -->|Sí - Evita Bloqueos| Skip[Ignorar trama duplicada]
        RateLimit -->|No - Procesa| StrategyPattern[Strategy Manager]
        
        StrategyPattern -->|Colun / Wing| Colun[API Colun]
        StrategyPattern -->|Arauco / SISCO| Arauco[API Arauco SOAP]
        StrategyPattern -->|Melón / UNIGIS| Melon[API UNIGIS SOAP]
        StrategyPattern -->|Falabella / QAnalytics| Falabella[API Falabella SOAP]
        StrategyPattern -->|AVL Chile REST| AVL[API AVL Chile]
        StrategyPattern -->|Otros: Cencosud, Walmart, CCU, DHL, etc.| Others[APIs B2B Outgoing]
    end
```

### Explicación del Flujo Híbrido:
1. **Webhooks (En movimiento):** Cuando los camiones están en ruta y cambian de estado, GPS Server (`gsh7.net`) gatilla inmediatamente un webhook hacia `integraciones-vikar` con la coordenada en tiempo real.
2. **Poller de Respaldo (Estacionados):** Como los webhooks de GPS Server son estrictamente por eventos (cambio de estado de falso a verdadero), si un camión se estaciona por horas no gatillará webhooks. El **GPS Server Poller** consulta cada 20 minutos (`GPSSERVER_POLL_INTERVAL`) las últimas coordenadas conocidas de las flotas y las retransmite para mantener los vehículos "online" en las plataformas corporativas.
3. **Deduplicador de 10s:** Si el poller de respaldo coincide con un webhook en tiempo real en un lapso menor a 10 segundos para una misma patente, el middleware **descarta el envío duplicado** localmente para cumplir con las tasas de refresco de las APIs corporativas (como AVL Chile, que bloquea envíos si ocurren en menos de 5 segundos).

---

## 2. Repositorios y Despliegues en Render

### 2.1 Repositorio: `integraciones-vikar`
*   **Directorio Local:** `C:\Users\aaron\Documents\antigravity\integraciones-vikar`
*   **Git Remote:** `https://github.com/aaronriquelme1001-pixel/integracionesvikar.git`
*   **URL Producción:** `https://integracionesvikarb2b.onrender.com`
*   **Comando de Test Local:** `npm run test:mock` (Levanta servidores mock locales en puertos 400x y prueba todo el flujo de ruteo sin tocar los servidores reales).

---

## 3. Variables de Entorno en Render.com

Para administrar las integraciones, se configuran las siguientes variables de entorno en el panel de Render para `integraciones-vikar`:

### 3.1 Variables Globales y de Recepción
*   `PORT` = `10000` (Puerto de escucha)
*   `GPS_SERVER_URL` = `http://gsh7.net/id39/api/api_loc.php` (Servidor central de GPS)
*   `INCOMING_API_KEY` = Llave de seguridad para recibir telemetría externa.
*   `GPSSERVER_POLL_CLIENTS` = `luisherrera,alirorios` (Lista de usuarios de GPS Server separados por coma que el Poller consultará periódicamente).
*   `GPSSERVER_POLL_INTERVAL` = `1200000` (Intervalo de polling de respaldo en milisegundos, recomendado 20 minutos = 1,200,000 ms).
*   `GPSSERVER_API_KEY_[CLIENTE]` = API Key del usuario en GPS Server para el poller (ej: `GPSSERVER_API_KEY_LUISHERRERA` y `GPSSERVER_API_KEY_ALIRORIOS`).

### 3.2 Variables de Clientes B2B (Estructura Dinámica)
El router resuelve credenciales dinámicamente usando el sufijo del cliente en mayúsculas (ej: `_LUISHERRERA`). Si no existen variables con sufijo de cliente, se usan las variables globales por defecto:

*   **Integración AVL Chile (`target=avlchile`):**
    *   `AVLCHILE_API_URL` = `https://webapp.avlchile.cl/api/v2/` (Endpoint base de AVL Chile)
    *   `AVLCHILE_TOKEN_LUISHERRERA` = Token del cliente Luis Herrera en AVL Chile (ej: `E052E03119509CD3EA64159E4D34F819`).
    *   `AVLCHILE_TOKEN_ALIRORIOS` = Token del cliente Aliro Ríos en AVL Chile (ej: `28BD2274962FD15472D8ABB789582D1B`).
*   **Integración Melón / UNIGIS (`target=melon`):**
    *   `UNIGIS_API_URL_[CLIENTE]` (ej: `UNIGIS_API_URL_TRANSKLETT`)
    *   `UNIGIS_SYSTEM_USER_[CLIENTE]`
    *   `UNIGIS_PASSWORD_[CLIENTE]`
*   **Integración Colun (`target=colun`):**
    *   `COLUN_API_URL_[CLIENTE]`
    *   `COLUN_BEARER_TOKEN_[CLIENTE]`

---

## 4. Guía de Operaciones (Paso a Paso)

Cuando des de alta a una **nueva empresa** o **nuevos camiones**, sigue este protocolo para que el proceso sea rápido y expedito:

### 4.1 Método Dinámico (Sin modificar código ni reiniciar el servidor)
Este es el método recomendado. Permite añadir clientes y camiones directamente desde GPS Server:

#### Paso 1: Configurar Webhooks en GPS Server (gsh7.net)
1. Entra a tu panel de administración en `gsh7.net`.
2. Haz login como el usuario del cliente (ej: `luisherrera`).
3. Ve a **Configuración** -> **Webhooks** (o Eventos -> Webhooks).
4. Crea un webhook que apunte al middleware indicando la plataforma destino (`target`) y el slug del cliente (`client`):
   `https://integracionesvikarb2b.onrender.com/webhook/gps-server?target=avlchile&client=luisherrera`
   *Nota: Si se configuran reglas de eventos en GPS Server, asegúrate de activar una regla que cubra todos los estados del vehículo (ej: `speed > -1`) para forzar un flujo continuo de telemetría.*

#### Paso 2: Habilitar el Poller de Respaldo en Render
1. Si el cliente es nuevo, ve al panel de Render de `integraciones-vikar`.
2. En la pestaña **Environment**, añade su nombre al listado separado por comas en `GPSSERVER_POLL_CLIENTS`.
3. Crea la variable `GPSSERVER_API_KEY_[CLIENTE]` con la API Key obtenida de la cuenta del cliente en `gsh7.net` (ej: en Configuración -> Cuenta de GPS Server).
4. Configura el token del cliente B2B correspondiente (ej: `AVLCHILE_TOKEN_LUISHERRERA`).
5. Guarda los cambios. Render aplicará los cambios sin downtime.

#### Paso 3: Mapear Camiones en `config/devices.json` (Solo si no usas Webhooks dinámicos)
Si no usas URLs dinámicas en los webhooks de GPS Server y deseas que el ruteo se resuelva de manera estática a través del IMEI:
1. Abre el archivo [devices.json](file:///C:/Users/aaron/Documents/antigravity/integraciones-vikar/config/devices.json).
2. Añade la entrada del IMEI del camión mapeando su patente y la configuración del B2B:
   ```json
   "863719062576112": {
     "plate": "RTBB39",
     "carrier": "VIKARGPS",
     "integrations": {
       "avlchile": {
         "enabled": true,
         "client": "luisherrera"
       }
     }
   }
   ```
3. Realiza commit y push del archivo. Render se desplegará solo en segundos.

---

## 5. Diagnóstico y Lectura de Logs en Producción

Para revisar el estado de transmisiones y diagnosticar errores directamente desde la consola de Render:

1. **Ingresar a los Logs de Render:** Selecciona el servicio `integraciones-vikar` y ve a la pestaña **Logs**.
2. **Monitorear Webhooks y Poller:**
   * Cuando se despacha un camión con éxito, verás:
     `[AVL Chile] Success Response: {"status":{"result":true,"total_count":1,"valid_count":1,"error_count":0,"error":[]}}`
   * Si un camión no está autorizado por el cliente corporativo (ej: AVL Chile no ha dado de alta la patente en sus servidores), la respuesta del API de destino se imprimirá detalladamente gracias al sistema de JSON stringified:
     `[AVL Chile] Success Response: {"status":{"result":false,"total_count":1,"valid_count":0,"error_count":1,"error":[{"avl.id":1,"avl.ident":"SHPC57","result":false,"message":"Vehículo no autorizado"}]}}`
     *Esto te indicará con precisión exacta qué camiones no están habilitados en la plataforma del mandante.*
3. **Evitar filtros antiguos:** Asegúrate de no tener filtros fijos aplicados en la barra de búsqueda de Render (como cápsulas azules de `instance: [ID]`), ya que esto evitará que veas los registros de los contenedores más recientes tras cada despliegue.

---

## 6. Patrones de Diseño del Código

*   **Strategy Pattern (`BaseStrategy.js` y subclases):** Permite al router seleccionar y ejecutar dinámicamente las reglas de mapeo de datos y protocolos HTTP/SOAP para cada B2B sin llenar el archivo principal de condicionales.
*   **Deduplicador Temporal:** La clase `AvlChileStrategy` implementa un caché volátil en memoria. Almacena las marcas de tiempo por patente y descarta de forma proactiva envíos repetidos dentro de un margen de 10 segundos, previniendo bloqueos de token o spam al Web Service externo.
*   **Seguridad:** Acceso protegido a la visualización del Dashboard mediante Basic Auth (`admin` / `vikar1247`), permitiendo libre tránsito público únicamente a los Webhooks `/webhook/*` y al chequeo de salud `/health`.

---

## 7. Contacto Técnico y Soporte
*   **Encargado:** Aaron Riquelme (Vikar GPS)
*   **Correo Electrónico:** `contacto@vikargps.cl`
