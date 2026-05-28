# MANUAL INTERNO DE CONFIGURACIÓN: RECEPCIÓN DE TELEMETRÍA EXTERNA
## Procedimiento de Alta y Configuración para Proveedores de GPS Terceros

*   **Versión del Manual:** 1.0 (Edición Corporativa)
*   **Fecha de Publicación:** Mayo 2026
*   **Diseñado para:** Operadores de Monitoreo y Soporte Técnico de Vikar GPS.
*   **Servicio Web en Render:** `https://integraciones-vikar.onrender.com`
*   **Endpoint Receptor:** `/webhook/incoming-gps`
*   **Clave API por Defecto:** `vikar_incoming_secure_key_2026`

---

## 📋 ÍNDICE DE CONTENIVOS

1. **Introducción al Sistema de Recepción**
   * 1.1. Propósito del Receptor de Telemetría
   * 1.2. Flujo de Datos Entrantes
2. **Procedimiento Paso a Paso de Alta Operativa**
   * 2.1. Paso 1: Configurar Cuenta y Flota en GPS Server (gsh7.net)
   * 2.2. Paso 2: Generar y Entregar Credenciales al Proveedor
3. **Configuración de Variables en Render.com**
   * 3.1. Clave de Seguridad de Entrada (`INCOMING_API_KEY`)
   * 3.2. Redirección de Servidor (`GPS_SERVER_URL`)
4. **Monitoreo y Diagnóstico de Transmisiones**
   * 4.1. Verificación en los Logs de Render
   * 4.2. Validación en Vivo en los Mapas de gsh7.net
5. **Resolución de Problemas Frecuentes (Troubleshooting)**
   * 5.1. Error 401: Unauthorized (Llave Incorrecta)
   * 5.2. Error 400: Missing required fields
   * 5.3. El proveedor reporta con éxito pero los vehículos no aparecen en el mapa
6. **Anexo: Ficha de Registro de Proveedor Externo (Imprimible)**

---

## 1. INTRODUCCIÓN AL SISTEMA DE RECEPCIÓN

### 1.1. Propósito del Receptor de Telemetría
El middleware de **Vikar** cuenta con un canal de entrada universal diseñado para que empresas externas (transportistas asociados, subcontratados o marcas de GPS terceras) envíen sus ubicaciones directamente a nuestra plataforma. 

Este sistema traduce el formato JSON estándar del tercero y lo ingresa automáticamente en nuestro panel principal de **Vikar GPS / gsh7.net (ID 39)**, permitiendo monitorear flotas mixtas o externas de forma unificada.

### 1.2. Flujo de Datos Entrantes
El trayecto que siguen los datos es el siguiente:

```
┌────────────────────────┐      ┌────────────────────────┐      ┌────────────────────────┐
│ Servidor Externo (3P)  │ ───> │ Middleware Vikar (API) │ ───> │ GPS Server (gsh7.net)  │
│ Envía JSON con API Key │      │ Valida clave y formatea│      │ Recibe y dibuja mapa   │
└────────────────────────┘      └────────────────────────┘      └────────────────────────┘
```

---

## 2. PROCEDIMIENTO PASO A PASO DE ALTA OPERATIVA

Cuando una empresa externa solicite transmitir los datos de sus camiones a nuestra plataforma, el operador de Vikar debe realizar el siguiente procedimiento técnico:

### 2.1. Paso 1: Configurar Cuenta y Flota en GPS Server (gsh7.net)
El servidor de mapas no aceptará posiciones de dispositivos que no reconozca. Por lo tanto, antes de que el proveedor empiece a enviar datos, estos deben ser creados:
1. Inicie sesión como Administrador en **gsh7.net**.
2. Cree o asigne la cuenta del cliente/subcontratista correspondiente.
3. Cree cada vehículo nuevo ingresando:
   *   **IMEI (Identificador Único):** Debe coincidir exactamente con el ID que transmitirá el proveedor externo.
   *   **Patente (Plate):** Escrita estrictamente en **MAYÚSCULAS y sin caracteres especiales ni espacios** (ej: `ABCD12`).

### 2.2. Paso 2: Generar y Entregar Credenciales al Proveedor
Una vez creados los vehículos, envíe por correo la **Guía de Integración para Proveedores** junto con los siguientes datos de conexión:
1.  **URL Receptora:** `https://integraciones-vikar.onrender.com/webhook/incoming-gps`
2.  **API Key de Acceso:** La clave de seguridad correspondiente (ver Sección 3.1).
3.  **Mapeo de Vehículos:** Una lista con el IMEI y la Patente que el proveedor debe enviar para cada uno de sus camiones.

---

## 3. CONFIGURACIÓN DE VARIABLES EN RENDER.COM

Las credenciales globales de recepción se administran de forma centralizada en el panel de control de Render para proteger la seguridad del servidor.

### 3.1. Clave de Seguridad de Entrada (`INCOMING_API_KEY`)
Para evitar inyecciones de datos no autorizados, el middleware valida que la cabecera `X-API-Key` coincida con la variable registrada en Render.
*   **Clave por Defecto:** Si no se define ninguna variable en Render, el sistema usará `vikar_incoming_secure_key_2026`.
*   **Personalización:** Para establecer una contraseña más segura para un cliente importante, acceda a **Render.com** -> `integraciones-vikar` -> **Environment** y modifique o añada la variable:
    *   **Key:** `INCOMING_API_KEY`
    *   **Value:** `ClaveSeguraGeneradaParaTerceros`

### 3.2. Redirección de Servidor (`GPS_SERVER_URL`)
El middleware necesita saber a qué dirección IP o dominio enviar los datos una vez traducidos.
*   **Variable en Render:** `GPS_SERVER_URL`
*   **Valor por Defecto:** `http://gsh7.net/id39/api/api_loc.php`
*   *(Nota: No modifique esta variable a menos que cambie el servidor central de mapas de Vikar GPS).*

---

## 4. MONITOREO Y DIAGNÓSTICO DE TRANSMISIONES

### 4.1. Verificación en los Logs de Render
Para corroborar que la conexión con el proveedor externo fue exitosa:
1. Inicie sesión en **Render.com** y abra el servicio de `integraciones-vikar`.
2. Vaya a la pestaña **Logs**.
3. Al recibir datos, verá las siguientes entradas de sistema:
   *   `POST /webhook/incoming-gps` (Indica la llamada entrante).
   *   `[Incoming GPS] Forwarding telemetry for [Patente] to GPS Server...` (Confirmación de traducción).
   *   `[Incoming GPS] GPS Server Response: ok` (Confirmación de recepción por gsh7.net).

### 4.2. Validación en Vivo en los Mapas de gsh7.net
1. Inicie sesión en **gsh7.net**.
2. Abra el panel de monitoreo y busque los vehículos del cliente externo.
3. Si el camión aparece con el estado "Conectado" (verde) y su última fecha de reporte actualizada, la integración está operando correctamente en tiempo real.

---

## 5. RESOLUCIÓN DE PROBLEMAS FRECUENTES (Troubleshooting)

### 5.1. Error 401: Unauthorized (Llave Incorrecta)
*   **Causa:** El proveedor no incluyó la cabecera `X-API-Key` en su petición HTTP o el valor no coincide con el configurado en Render.
*   **Solución:** Verifique en Render el valor de la variable `INCOMING_API_KEY` y solicite al proveedor que confirme la escritura exacta de la clave en su cabecera.

### 5.2. Error 400: Missing required fields
*   **Causa:** El payload JSON enviado por el proveedor carece de alguno de los campos obligatorios: `imei`, `lat` o `lng`.
*   **Solución:** Revise la consola de logs en Render para identificar el JSON recibido y pida al proveedor externo que corrija su payload asegurándose de enviar la latitud y longitud correspondientes.

### 5.3. El proveedor reporta con éxito pero los vehículos no aparecen en el mapa
*   **Causa:** El IMEI enviado por el proveedor no coincide exactamente con el IMEI registrado en gsh7.net, o la patente está mal escrita.
*   **Solución:** Busque en los logs de Render el IMEI exacto que está transmitiendo el proveedor y verifique que coincida dígito por dígito con el del dispositivo creado en la cuenta de administración de GPS Server.

---

\newpage

## 6. ANEXO: FICHA DE REGISTRO DE PROVEEDOR EXTERNO (Imprimible)

*Esta ficha debe ser impresa y completada por el operador para dejar un registro físico de cada proveedor externo autorizado a inyectar datos GPS a nuestra red.*

---

### 📝 DATOS DEL PROVEEDOR Y CLIENTE
*   **Fecha de Autorización:** _____ / _____ / _________
*   **Operador de Vikar a Cargo:** __________________________________________________
*   **Nombre de la Empresa Proveedora (Tercero):** __________________________________
*   **Cliente Destinatario (Vikar):** ______________________________________________
*   **API Key Entregada:** ________________________________________________________

---

### ⚙️ VEHÍCULOS AUTORIZADOS Y CONFIGURACIÓN EN GSH7.NET

| N° | Patente Vehículo | IMEI Dispositivo (GPS) | ¿Creado en gsh7? | Observaciones |
| :---: | :---: | :---: | :---: | :--- |
| **1** | | | [ ] Sí  /  [ ] No | |
| **2** | | | [ ] Sí  /  [ ] No | |
| **3** | | | [ ] Sí  /  [ ] No | |
| **4** | | | [ ] Sí  /  [ ] No | |
| **5** | | | [ ] Sí  /  [ ] No | |

---

### 🔍 CHECKLIST DE HABILITACIÓN TÉCNICA
*   [ ] **Patentes Creadas:** Todos los camiones de la tabla superior están registrados en la cuenta del cliente en gsh7.net con su IMEI correcto.
*   [ ] **Entrega de Credenciales:** Se envió el correo de integración con la URL de Render y la API Key asignada.
*   [ ] **Prueba de Recepción:** Se comprobó en los logs de Render el primer reporte exitoso con código HTTP 200 de confirmación.
*   [ ] **Visualización en Mapa:** Se confirmó que el ícono del vehículo cambió a verde (activo) en gsh7.net.

---

### 🖋️ FIRMA DE CONFORMIDAD TÉCNICA

```text
                                              
 _________________________________             _________________________________
     Operador Vikar GPS a Cargo                         Firma de Habilitación
```
