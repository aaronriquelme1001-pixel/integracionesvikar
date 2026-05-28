# Vikar Telemetry & B2B Integrations Handbook

This handbook serves as the ultimate documentation and reference guide for the telematic telemetry routing system developed for **Vikar**. It explains how the architecture works, how to configure and maintain the systems, and how to scale the services or add new integrations.

---

## 1. High-Level Architecture

The system is split into two independent Node.js middleware services hosted on Render:

```mermaid
flowchart TD
    subgraph Tracksolid to GPS Server (nifty-hertz)
        Tracksolid[Tracksolid Pro API] -->|1. Polling Cycle (Every 30s)| PollingEngine[API Polling Engine]
        PollingEngine -->|2. HTTP GET| GPSServer[GPS Server gsh7.net]
    end

    subgraph B2B Integrations Router (integraciones-vikar)
        GPSServer -->|3. Outgoing Webhook POST| B2BRouter[B2B Router Webhook]
        B2BRouter -->|4. Checks Query Params or config/devices.json| Config{Routing Resolved?}
        
        Config -->|Yes| StrategyPattern[Strategy Manager]
        StrategyPattern -->|JSON REST| Colun[Colun Web Service]
        StrategyPattern -->|XML SOAP| Arauco[Arauco Web Service]
        StrategyPattern -->|XML SOAP| Melon[Cementos Melón / UNIGIS]
        StrategyPattern -->|XML SOAP| Falabella[Falabella / QAnalytics]
        StrategyPattern -->|JSON REST| Cencosud[Cencosud API]
        StrategyPattern -->|JSON REST| Walmart[Walmart REST API]
        StrategyPattern -->|JSON REST| MercadoLibre[Mercado Libre API]
        StrategyPattern -->|JSON REST| SMU[SMU API]
        StrategyPattern -->|JSON REST| Agrosuper[Agrosuper API]
        StrategyPattern -->|JSON REST| CCU[CCU API]
        StrategyPattern -->|JSON REST| Amazon[Amazon SP-API]
        StrategyPattern -->|JSON REST| DHL[DHL API]
    end
```

### Flow Explanation:
1. **Telemetry Retrieval:** The JC400 camera tracker reports to Tracksolid Pro. Since Tracksolid webhooks only push alert/ignition events, a **Polling Engine** running in `tracksolid-to-gps-server` polls Tracksolid Pro every 10 seconds to fetch real-time route locations.
2. **GPS Server Update:** The Polling Engine forwards these points to your custom GPS Server (`http://gsh7.net/id39/api/api_loc.php`).
3. **B2B Webhook Dispatch:** The GPS Server triggers an outgoing webhook to `integraciones-vikar` whenever it receives new position updates.
4. **B2B Client Forwarding:** The `integraciones-vikar` router reads `config/devices.json`. If the IMEI has integrations enabled, it formats the telemetry according to each logistics platform's protocol (REST or SOAP) and dispatches it.

---

## 2. Repositories and Deployment Details

### 2.1 Repository 1: `tracksolid-to-gps-server`
*   **Local Directory:** `C:\Users\aaron\Documents\antigravity\nifty-hertz`
*   **Git Remote:** `https://github.com/aaronriquelme1001-pixel/tracksolid-to-gps-server.git`
*   **Render Web Service:** `https://tracksolid-forwarder.onrender.com`
*   **Verification Command:** `npm run test:mock` (runs a local webhook test with mock signatures)

#### Render Environment Variables:
```env
TRACKSOLID_USER_ID=contacto@vikargps.cl
TRACKSOLID_USER_PWD_MD5=c5e3817d8fee89920b29741823cff106
TRACKSOLID_APP_KEY=8FB345B8693CCD006BD16DA4A532B248339A22A4105B6558
TRACKSOLID_APP_SECRET=cb1ea27673f44ac7936a2ecdc8d35154
TRACKSOLID_IMEIS=862798052972060
TRACKSOLID_POLL_INTERVAL=10000
GPS_SERVER_URL=http://gsh7.net/id39/api/api_loc.php
```

---

### 2.2 Repository 2: `integraciones-vikar`
*   **Local Directory:** `C:\Users\aaron\Documents\antigravity\integraciones-vikar`
*   **Git Remote:** `https://github.com/aaronriquelme1001-pixel/integracionesvikar.git`
*   **Render Web Service:** `https://integraciones-vikar.onrender.com` *(adjust to actual Render URL)*
*   **Verification Command:** `npm run test:mock` (simulates a GPS Server webhook and tests Colun, Arauco, UNIGIS, and Falabella mocks)

#### Render Environment Variables:
```env
PORT=3001

# --- 1. COLUN ---
COLUN_API_URL=https://services.wing.cl/tracking/receiver/hub/v2
COLUN_BEARER_TOKEN=Bearer <Token>

# --- 2. ARAUCO ---
ARAUCO_API_URL=http://clsclwebqas09.arauco.cl/GPSChileWS/GPSChileWS.asmx
ARAUCO_PROVIDER_NAME=VIKARGPS
ARAUCO_NOM_FLOTA=VIKARGPS
ARAUCO_COD_FLOTA=1539

# --- 3. CEMENTOS MELON / UNIGIS ---
UNIGIS_API_URL=https://cloud-test.unigis.com/hub_TEST/mapi/soap/gps/service.asmx
UNIGIS_SYSTEM_USER=VIKARGPS
UNIGIS_PASSWORD=VIKARGPS2024

# --- 4. FALABELLA / SODIMAC / TOTTUS ---
FALABELLA_API_URL=http://ww3.qanalytics.cl/gps_test/service.asmx
FALABELLA_USER=WS_test
FALABELLA_PASSWORD=$$WS17

# --- 5. CENCOSUD ---
CENCOSUD_API_URL=https://api.cencosud.com/logistics/v1/telemetry
CENCOSUD_API_KEY=<ApiKey>

# --- 6. MERCADO LIBRE ---
MERCADOLIBRE_API_URL=https://api.mercadolibre.com/logistics/carriers/telemetry
MERCADOLIBRE_BEARER_TOKEN=<BearerToken>

# --- 7. WALMART (REST CUSTOM API) ---
WALMART_API_URL=https://api.walmart.com/logistics/v1/carrier/gps
WALMART_CLIENT_ID=<ClientId>
WALMART_CLIENT_SECRET=<ClientSecret>

# --- 8. SMU (UNIMARC) ---
SMU_API_URL=https://api.smu.cl/tracking/gps
SMU_API_TOKEN=<Token>

# --- 9. AGROSUPER ---
AGROSUPER_API_URL=https://api.agrosuper.cl/logistica/telemetria/gps
AGROSUPER_API_KEY=<ApiKey>

# --- 10. CCU ---
CCU_API_URL=https://api.ccu.cl/distribucion/gps
CCU_BEARER_TOKEN=<BearerToken>

# --- 11. AMAZON ---
AMAZON_API_URL=https://sellingpartnerapi-na.amazon.com/shipping/v2/carrier/telemetry
AMAZON_ACCESS_TOKEN=<AccessToken>

# --- 12. DHL ---
DHL_API_URL=https://api.dhl.com/transport/v1/telemetry
DHL_API_KEY=<ApiKey>
```

---

## 3. Operational Guidelines (Runbook)

### 3.1 Adding a New Vehicle / Client (Dynamic Zero-Code Method - RECOMMENDED)
To onboard a client and their vehicles without editing code or redeploying:
1.  **GPS Server Setup:** 
    *   Create the client account or sub-account (e.g., `transklett`) in GPS Server.
    *   Create the trucks/devices under that account, assigning their IMEIs and Plates.
    *   Add a Webhook for this client pointing to the middleware's URL:
        `https://integraciones-vikar.onrender.com/webhook/gps-server?target=<b2b_platform>&client=<client_identifier>`
        *Example for transklett sending to Melon:*
        `https://integraciones-vikar.onrender.com/webhook/gps-server?target=melon&client=transklett`
        *Supported Target Platforms:*
        *   `melon` (aliases: `unigis` - for Cementos Melón, Walmart, Cencosud, SMU, CCU, etc. if using their UNIGIS platform)
        *   `colun` (Wing.cl)
        *   `arauco` (SISCO GPS)
        *   `falabella` (QAnalytics - also supports Tottus and Sodimac division requests)
        *   `cencosud` (Custom Cencosud REST API)
        *   `walmart` (Custom Walmart REST API)
        *   `mercadolibre` (alias: `meli`)
        *   `smu` (Custom SMU REST API)
        *   `agrosuper` (Cold chain temperature-enabled REST API)
        *   `ccu` (Custom CCU REST API)
        *   `amazon` (Amazon SP-API compatible format)
        *   `dhl` (DHL logistics tracking API)
2.  **Render Credentials Setup:**
    If the client uses custom API endpoints or credentials different from the defaults, add them to Render's environment variables using the `_<CLIENT>` suffix (all uppercase). Refer to Section 2.2 for all available keys.
    *(If no client-specific variables are defined, the router automatically falls back to the default credentials configured in Render).*
3.  **Deactivation:** To stop sharing data or revoke a client, simply disable their webhook or user account in GPS Server.

---

### 3.2 Adding a New Vehicle (Static Fallback Method)
If you do not want to use query parameters in the webhook and prefer to map vehicles statically:
1.  Open `config/devices.json` in the `integraciones-vikar` repository.
2.  Add a new entry with the device's IMEI as the key. Specify its plate number, carrier, and enable the desired target integrations.
    *Example:*
    ```json
    "862798052972061": {
      "plate": "ABCD12",
      "carrier": "VIKARGPS",
      "integrations": {
        "colun": { "enabled": true },
        "melon": { "enabled": true }
      }
    }
    ```
3.  Commit and push the changes to GitHub. Render will automatically redeploy:
    ```bash
    git add config/devices.json
    git commit -m "Add vehicle ABCD12 to integrations"
    git push origin main
    ```

---

### 3.3 Modifying endpoints or tokens (e.g. going live with Arauco)
When moving from QA to production for a corporate client:
1.  Locate their API URL in the Render Environment panel for `integraciones-vikar` (e.g. `ARAUCO_API_URL` or `ARAUCO_API_URL_CLIENT`).
2.  Update the URL to the production server link provided by the client's IT team and save the environment variables.

---

### 3.4 Manual de Administración Webhook Dinámico (Español)
Para dar de alta integraciones B2B de forma dinámica sin modificar el código:

#### Paso 1: Construir la URL del Webhook
Tú mismo creas la URL agregando los parámetros al final. La estructura es:
`https://integraciones-vikar.onrender.com/webhook/gps-server?target=PLATAFORMA&client=SLUG_CLIENTE`

*   **`target`**: La plataforma de destino en minúsculas (`melon`, `unigis`, `colun`, `arauco`, `falabella`, `cencosud`, `walmart`, `meli`, `smu`, `agrosuper`, `ccu`, `amazon`, `dhl`).
*   **`client`**: El identificador o "slug" del cliente (ej. `transklett`, `pacel`, `holzapfel`). Se recomienda usar el mismo nombre de usuario que tiene en GPS Server para mantener el orden.

*Ejemplo para enviar Transklett a Cementos Melón:*
`https://integraciones-vikar.onrender.com/webhook/gps-server?target=melon&client=transklett`

#### Paso 2: Configurar la URL en GPS Server (gsh7.net)
1.  Inicia sesión en el Control Panel de Administrador de GPS Server.
2.  Ubica al usuario correspondiente (ej. `transklett`) y haz clic en **"Login as user"** (Ingresar como usuario).
3.  Una vez dentro de la cuenta del cliente, ve a **Configuración** (icono de engranaje/llave).
4.  Busca la sección **Webhooks** o **Eventos -> Webhooks**.
5.  Pega la URL completa construida en el Paso 1 y haz clic en **Guardar**.

#### Paso 3: Configurar las Credenciales en Render
Si el cliente tiene credenciales específicas entregadas por la empresa B2B:
1.  Ve al dashboard de Render para el servicio `integraciones-vikar`.
2.  Ve a la pestaña **Environment** y añade las variables con el sufijo `_SLUG_CLIENTE` (en mayúsculas):
    *   Ejemplo: `UNIGIS_SYSTEM_USER_TRANSKLETT` = `usuario_de_transklett`
    *   Ejemplo: `UNIGIS_PASSWORD_TRANSKLETT` = `clave_de_transklett`
3.  Si no agregas variables para el cliente, el sistema usará las credenciales por defecto de esa plataforma B2B.

#### Paso 4: Seguridad y Acceso al Dashboard
Para evitar el acceso público no deseado al panel de control, la raíz de la web (`/`) está protegida por Autenticación Básica (Basic Auth).
*   **Usuario:** `admin`
*   **Contraseña:** `vikar1247`

*Nota: Los endpoints de Webhook (`/webhook/gps-server`) y Health Check (`/health`) están completamente exentos de esta restricción y no requieren autenticación, lo que garantiza el correcto funcionamiento de las transmisiones y monitoreos externos.*

---

### 3.3 Adding a New B2B Integration Target
To add a new corporate client integration:
1.  **Create Strategy Class:** Inside `integraciones-vikar/integrations/`, create a new file (e.g. `newclient.js`) extending `BaseStrategy`:
    ```javascript
    const BaseStrategy = require('./BaseStrategy');
    class NewClientStrategy extends BaseStrategy {
      async execute(telemetry, deviceConfig, integrationConfig) {
        const url = integrationConfig.endpoint || process.env.NEWCLIENT_API_URL;
        // 1. Build Payload
        // 2. Dispatch using this.sendJSONRequest or this.sendSOAPRequest
      }
    }
    module.exports = NewClientStrategy;
    ```
2.  **Register Strategy:** In `integraciones-vikar/index.js`, import and register the new class:
    ```javascript
    const NewClientStrategy = require('./integrations/newclient');
    const strategies = {
      // ...,
      newclient: new NewClientStrategy()
    };
    ```
3.  **Map Devices:** Add `"newclient": { "enabled": true }` to target vehicles in `config/devices.json`.

---

## 4. Code Design Patterns

*   **Strategy Pattern:** Used in `integraciones-vikar`. Allows the router to dynamically select and execute the correct integration logic based on the targets listed in `devices.json` without massive `if/else` statements.
*   **BaseStrategy Helper (`BaseStrategy.js`):** Encapsulates repetitive formatting tasks (date string mapping to ISO/Chile formats, URL parameter extraction, SOAP envelope generation, and HTTP POST triggers).
*   **Built-in Resilience:** The polling loop caches tokens locally, checking validity timestamps before making requests. If a request returns an authentication error (code 1004), the token cache is cleared to prevent repeated failures.

---

## 5. Contact Information
*   **Owner:** Aaron Riquelme (Vikar GPS)
*   **Email:** `contacto@vikargps.cl`
