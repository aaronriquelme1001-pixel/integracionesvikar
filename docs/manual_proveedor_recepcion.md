# GUÍA DE INTEGRACIÓN DE TELEMETRÍA PARA PROVEEDORES GPS
## Especificaciones Técnicas para Envío de Posiciones Telemáticas a Vikar GPS

*   **Documento de Referencia:** GI-PROV-01
*   **Emisor:** Área de Integraciones y TI — Vikar GPS
*   **Contacto de Soporte:** `contacto@vikargps.cl`
*   **Propósito:** Detallar el formato de datos y las especificaciones técnicas requeridas para que los proveedores externos de GPS transmitan las coordenadas de sus flotas en tiempo real hacia la plataforma de monitoreo de Vikar GPS.

---

## 📋 ÍNDICE DE CONTENIDOS

1. **Presentación y Endpoint de Conexión**
   * 1.1. Objetivo de la Transmisión
   * 1.2. URL de Destino y Método HTTP
2. **Autenticación y Seguridad (API Key)**
   * 2.1. Requisito de la Cabecera `X-API-Key`
3. **Especificaciones del Payload (Diccionario de Datos)**
   * 3.1. Campos Obligatorios
   * 3.2. Campos Opcionales
   * 3.3. Ejemplo del JSON de Envío
4. **Respuestas de Confirmación del Servidor**
   * 4.1. Código HTTP 200 (Éxito)
   * 4.2. Código HTTP 400 (Petición Incorrecta)
   * 4.3. Código HTTP 401 (Acceso Denegado)
5. **Ejemplos de Consumo (Código de Referencia)**
   * 5.1. Ejemplo en comando cURL
   * 5.2. Ejemplo en Node.js (Axios)
   * 5.3. Ejemplo en Python (Requests)
6. **Canal de Soporte y Coordinación**

---

## 1. PRESENTACIÓN Y ENDPOINT DE CONEXIÓN

### 1.1. Objetivo de la Transmisión
Esta guía detalla el estándar técnico para que proveedores externos envíen datos de posicionamiento global a la base de datos de **Vikar GPS**. Esto nos permite consolidar y desplegar la información cartográfica en tiempo real sobre nuestra plataforma principal para fines de control operacional y seguridad logística.

### 1.2. URL de Destino y Método HTTP
El proveedor externo de GPS debe realizar peticiones HTTP a la siguiente dirección del middleware:

*   **URL de Destino:** `https://integraciones-vikar.onrender.com/webhook/incoming-gps`
*   **Método HTTP:** `POST`
*   **Formato de Envío:** `application/json` (Payload JSON codificado en UTF-8)

---

## 2. AUTENTICACIÓN Y SEGURIDAD (API Key)

### 2.1. Requisito de la Cabecera `X-API-Key`
Para autorizar la recepción de datos en nuestro servidor, cada petición debe incluir una cabecera de autenticación HTTP con la llave de acceso entregada por nuestro equipo técnico.

*   **Nombre de Cabecera:** `X-API-Key`
*   **Valor de la Clave:** *(Esta clave será provista individualmente por Vikar GPS por canales seguros antes de iniciar la integración).*

> [!WARNING]
> Cualquier petición que no incluya la cabecera `X-API-Key` o que envíe un valor incorrecto será rechazada inmediatamente por nuestro cortafuegos con un código de respuesta `HTTP 401 Unauthorized`.

---

## 3. ESPECIFICACIONES DEL PAYLOAD (Diccionario de Datos)

El payload JSON enviado en la petición POST debe respetar los siguientes campos:

### 3.1. Campos Obligatorios

| Nombre del Campo | Tipo de Dato | Formato / Ejemplo | Descripción |
| :--- | :---: | :--- | :--- |
| **`imei`** | Texto | `"862798052972060"` | El IMEI o identificador único del equipo GPS (15 dígitos). |
| **`lat`** | Decimal | `-33.456789` | Latitud geográfica con precisión de 6 decimales. |
| **`lng`** | Decimal | `-70.654321` | Longitud geográfica con precisión de 6 decimales. |

### 3.2. Campos Opcionales

| Nombre del Campo | Tipo de Dato | Formato / Ejemplo | Descripción |
| :--- | :---: | :--- | :--- |
| **`plate`** | Texto | `"ABCD12"` | Patente del camión en mayúsculas y sin caracteres especiales. |
| **`speed`** | Entero | `75` | Velocidad instantánea medida en km/h. |
| **`angle`** | Entero | `180` | Rumbo/Dirección en grados (0 a 359). |
| **`dt`** | Texto | `"2026-05-28 12:00:00"` | Fecha y hora del reporte (`AAAA-MM-DD HH:MM:SS`). |
| **`ignition`** | Booleano / Entero | `true` / `false` o `1` / `0` | Estado de encendido del motor (ACC). |
| **`params`** | Texto | `"temp1=4.5\|door=1\|"` | Cadena de sensores estructurada separada por tuberías (`\|`). |

### 3.3. Ejemplo del JSON de Envío
```json
{
  "imei": "862798052972060",
  "plate": "ABCD12",
  "lat": -33.456789,
  "lng": -70.654321,
  "speed": 75,
  "angle": 180,
  "dt": "2026-05-28 12:00:00",
  "ignition": true,
  "params": "temp1=4.5|door=0|"
}
```

---

## 4. RESPUESTAS DE CONFIRMACIÓN DEL SERVIDOR

Nuestros servidores responderán con uno de los siguientes códigos estándar HTTP según el estado del paquete:

### 4.1. Código HTTP 200 (Éxito)
Indica que el JSON fue recibido, validado y reenviado exitosamente a nuestro servidor de mapas.
```json
{
  "success": true,
  "message": "Telemetry received and forwarded successfully",
  "serverResponse": "ok"
}
```

### 4.2. Código HTTP 400 (Petición Incorrecta)
Indica que la estructura está incompleta o faltan campos obligatorios (`imei`, `lat`, `lng`).
```json
{
  "success": false,
  "error": "Missing required fields: imei, lat, lng"
}
```

### 4.3. Código HTTP 401 (Acceso Denegado)
Indica que la clave en la cabecera `X-API-Key` es inválida o no fue enviada.
```json
{
  "success": false,
  "error": "Unauthorized. Invalid API Key."
}
```

---

## 5. EJEMPLOS DE CONSUMO (Código de Referencia)

### 5.1. Ejemplo en comando cURL
```bash
curl -X POST https://integraciones-vikar.onrender.com/webhook/incoming-gps \
  -H "Content-Type: application/json" \
  -H "X-API-Key: su_clave_entregada_aqui" \
  -d '{
    "imei": "862798052972060",
    "plate": "ABCD12",
    "lat": -33.456789,
    "lng": -70.654321,
    "speed": 65,
    "angle": 90,
    "ignition": true
  }'
```

### 5.2. Ejemplo en Node.js (Axios)
```javascript
const axios = require('axios');

const payload = {
  imei: "862798052972060",
  plate: "ABCD12",
  lat: -33.456789,
  lng: -70.654321,
  speed: 65,
  angle: 90,
  ignition: true
};

axios.post('https://integraciones-vikar.onrender.com/webhook/incoming-gps', payload, {
  headers: {
    'Content-Type': 'application/json',
    'X-API-Key': 'su_clave_entregada_aqui'
  }
})
.then(res => console.log('Transmisión exitosa:', res.data))
.catch(err => console.error('Error de transmisión:', err.response ? err.response.data : err.message));
```

### 5.3. Ejemplo en Python (Requests)
```python
import requests

url = "https://integraciones-vikar.onrender.com/webhook/incoming-gps"
headers = {
    "Content-Type": "application/json",
    "X-API-Key": "su_clave_entregada_aqui"
}
payload = {
    "imei": "862798052972060",
    "plate": "ABCD12",
    "lat": -33.456789,
    "lng": -70.654321,
    "speed": 65,
    "angle": 90,
    "ignition": True
}

try:
    response = requests.post(url, json=payload, headers=headers)
    print("Respuesta:", response.status_code, response.json())
except Exception as e:
    print("Error:", e)
```

---

## 6. CANAL DE SOPORTE Y COORDINACIÓN

Para dar de alta nuevos IMEIs, solicitar llaves de acceso (`API Keys`) o reportar fallas en los envíos, favor comunicarse con nuestra mesa de ayuda de soporte e integraciones telemáticas:

*   **Correo Oficial:** `contacto@vikargps.cl`
*   **Horario Técnico:** Lunes a Viernes de 09:00 a 18:30 hrs. (Hora de Chile).
*   *(Nota: Favor coordinar con nuestro equipo antes de iniciar transmisiones masivas para asegurar que las patentes se encuentren debidamente creadas en la base de datos de visualización).*
