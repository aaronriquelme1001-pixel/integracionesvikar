# MANUAL DE OPERACIÓN Y CONFIGURACIÓN: INTEGRACIONES B2B
## VIKAR GPS — Middleware de Enrutamiento Telemático

*   **Versión del Manual:** 2.0 (Edición Corporativa)
*   **Fecha de Publicación:** Mayo 2026
*   **Diseñado para:** Operadores de Monitoreo, Soporte Técnico y Administradores de Plataforma de Vikar GPS.
*   **Servicio Web en Render:** `https://integraciones-vikar.onrender.com`
*   **Acceso Admin Dashboard:** Usuario: `admin` | Contraseña: `vikar1247`

---

## 📋 ÍNDICE DE CONTENIDOS

1. **Introducción y Arquitectura del Sistema**
   * 1.1. Propósito del Middleware B2B
   * 1.2. Diagrama del Flujo de Datos
   * 1.3. ¿Cómo funciona la retransmisión?
2. **Protocolo Técnico y Comercial (Inicio de Integración)**
   * 2.1. ¿Qué información solicitar al Mandante/Cliente?
   * 2.2. Preguntas Frecuentes de la Contraparte TI del Mandante
3. **Configuración en GPS Server (gsh7.net)**
   * 3.1. Requisitos Previos del Dispositivo
   * 3.2. Formateo de Patentes (Punto Crítico)
   * 3.3. Configuración del Webhook Dinámico (Zero-Code)
4. **Configuración en Render.com (Credenciales y Seguridad)**
   * 4.1. Acceso a Render
   * 4.2. Estructura de Variables de Entorno con Sufijo de Cliente
   * 4.3. Ejemplo Práctico de Configuración paso a paso
5. **Catálogo de Integraciones Homologadas (Fichas Técnicas)**
   * 5.1. Colun (Plataforma Wing)
   * 5.2. Cementos Melón / Walmart / Cencosud / SMU (Plataforma UNIGIS)
   * 5.3. Arauco (Plataforma SISCO)
   * 5.4. Falabella / Sodimac / Tottus (Plataforma QAnalytics)
   * 5.5. Cencosud (REST Directo)
   * 5.6. Walmart (REST Directo)
   * 5.7. Mercado Libre Chile (Meli REST)
   * 5.8. SMU (REST Directo)
   * 5.9. Agrosuper
   * 5.10. CCU Chile
   * 5.11. Amazon (SP-API Latam)
   * 5.12. DHL Logistics
6. **Uso del Panel Web de Administración (Dashboard)**
   * 6.1. Acceso y Credenciales de Seguridad
   * 6.2. Generador Automático de URLs de Webhook
   * 6.3. Monitor en Tiempo Real y Diagnóstico de Tráfico
   * 6.4. Simulador de Envío y Herramienta de Pruebas de Ping
7. **Resolución de Problemas Frecuentes (Troubleshooting)**
   * 7.1. El vehículo reporta en gsh7.net pero no llega al Mandante
   * 7.2. Errores de Conexión Comunes (Timeout, Credenciales, Red Privada)
   * 7.3. Cómo revisar los logs del servidor en Render.com
8. **Anexo: Ficha de Validación e Inicio de Transmisión (Imprimible)**

---

## 1. INTRODUCCIÓN Y ARQUITECTURA DEL SISTEMA

### 1.1. Propósito del Middleware B2B
El middleware de **Integraciones B2B de Vikar** es una plataforma en la nube diseñada para actuar como un "Traductor y Enrutador" de datos GPS en tiempo real. 

Su principal objetivo es recibir las coordenadas transmitidas por los vehículos a nuestro servidor central (**GPS Server / gsh7.net**) y retransmitirlas inmediatamente a los sistemas de los grandes clientes corporativos (Mandantes) de nuestros clientes transportistas. 

El middleware elimina la necesidad de modificar el código de los servidores de rastreo o de programar desarrollos a medida para cada cliente nuevo. Soporta conexiones dinámicas mediante el uso de parámetros en las URLs.

### 1.2. Diagrama del Flujo de Datos
El viaje de la información GPS desde la carretera hasta el sistema de destino sigue el siguiente trayecto:

```
[ Vehiculo (GPS) ] ──> [ GPS Server (gsh7.net) ]
                             │
                             ▼ (Webhook)
                    [ Middleware Vikar (Render) ]
                             │
                             ▼ (API REST / SOAP)
                    [ Mandante B2B (Destino) ]
```

### 1.3. ¿Cómo funciona la retransmisión?
1. El dispositivo GPS instalado en el vehículo envía una trama de datos (latitud, longitud, velocidad, rumbo, fecha) al servidor **gsh7.net**.
2. **gsh7.net** almacena la posición y dispara inmediatamente un evento HTTP (Webhook) hacia la URL de nuestro middleware.
3. El middleware intercepta este Webhook, extrae los parámetros de la URL (`target` y `client`), valida a qué mandante debe enviarse la información, formatea el paquete de datos en el protocolo exacto solicitado (JSON o SOAP XML) e inserta las credenciales de seguridad correspondientes.
4. Finalmente, el middleware entrega la información en milisegundos a la API del Mandante y devuelve un estado de "Correcto" (`ok`) a nuestro servidor GPS para confirmar la entrega.

---

## 2. PROTOCOLO TÉCNICO Y COMERCIAL (Inicio de Integración)

Cuando un cliente de Vikar (ej. un transportista) solicita transmitir los datos de su flota a una empresa mandante, **no se debe iniciar ninguna configuración sin contar con los datos correctos**. El operador de Vikar debe enviar el siguiente checklist al cliente por correo electrónico o WhatsApp.

### 2.1. ¿Qué información solicitar al Mandante/Cliente?
Copie y pegue la siguiente plantilla para solicitar los requerimientos técnicos:

> **ASUNTO:** Requerimientos Técnicos para Integración GPS - [Nombre del Cliente] a [Nombre del Mandante]
> 
> Estimado cliente / Equipo de TI de [Mandante]:
> 
> Junto con saludar, para proceder con la habilitación de la transmisión de datos GPS de la flota de **[Nombre del Cliente]** a los sistemas de **[Nombre del Mandante]**, solicitamos nos puedan proveer la siguiente información técnica:
> 
> 1. **Plataforma/Sistema de Destino:** Indicar si utilizan un software homologado (ej: UNIGIS, QAnalytics, Wing, etc.) o una API propia.
> 2. **Manual de Integración Técnica:** Documentación que describa la API, Web Service, endpoints, estructura de datos y métodos requeridos (REST/JSON o SOAP/XML).
> 3. **Credenciales de Acceso:** 
>    * Usuario y Contraseña del servicio web.
>    * API Key o Token Bearer (si corresponde).
>    * Diferenciar si son credenciales de prueba (QA) o producción (Live).
> 4. **Endpoints de Conexión (URLs):**
>    * URL del servicio de Pruebas (QA / Sandbox).
>    * URL del servicio de Producción.
> 5. **Registro de Patentes:** Confirmar si las patentes de los vehículos ya han sido registradas previamente en el sistema del Mandante (imprescindible para que acepten nuestros datos).
> 6. **Contacto del Encargado Técnico:** Nombre, correo y teléfono del responsable del lado del Mandante en caso de requerir pruebas coordinadas.
> 
> Quedamos atentos a sus comentarios para iniciar las configuraciones correspondientes.
> 
> Atentamente,  
> **Soporte de Integraciones — Vikar GPS**  
> `contacto@vikargps.cl`

---

## 3. CONFIGURACIÓN EN GPS SERVER (gsh7.net)

La administración de las integraciones en Vikar es **Zero-Code** (Cero Código). El operador de oficina puede dar de alta vehículos y configurar rutas de transmisión directamente en la interfaz gráfica del servidor GPS.

### 3.1. Requisitos Previos del Dispositivo
Antes de configurar el webhook de transmisión, asegúrese de lo siguiente:
1. El equipo GPS esté creado en la cuenta correcta del cliente en **gsh7.net**.
2. El equipo esté encendido y reportando activamente (icono verde de transmisión). Si el equipo tiene problemas de cobertura o instalación, la integración fallará o transmitirá datos desactualizados.

### 3.2. Formateo de Patentes (Punto Crítico)
Las plataformas de destino identifican los datos GPS mediante la **Patente (Plate)** del vehículo y no por el IMEI del equipo. 
*   **Regla de Oro:** La patente del vehículo en **gsh7.net** debe estar escrita **estrictamente en MAYÚSCULAS y sin caracteres especiales, espacios o guiones**.
*   **Correcto:** `GLXP79`, `ABCD12`, `KLSW90`
*   **Incorrecto:** `GLXP-79`, `glxp 79`, `ABCD-12`, `Klsw90`

> [!WARNING]
> Si la patente está mal escrita en el servidor GPS (por ejemplo, con un guion como `ABCD-12`), el sistema del mandante rechazará la ubicación por "vehículo no registrado". Asegúrese de corregir la patente antes de proceder.

### 3.3. Configuración del Webhook Dinámico (Zero-Code)
El middleware utiliza URLs inteligentes para saber a dónde enviar los datos del cliente. Siga estos pasos para configurar el reenvío:

1. Inicie sesión en su panel de administración de **gsh7.net**.
2. Busque el usuario del cliente transportista (ej. `transklett`) y haga clic en **"Login as user"** (Ingresar como usuario).
3. Diríjase a la sección **Configuración / Ajustes** (icono de engranaje en la esquina superior derecha o panel lateral).
4. Vaya a la pestaña **Webhooks** (o Eventos -> Webhooks).
5. En el campo de la URL del Webhook, introduzca la dirección del middleware estructurada con los siguientes parámetros:

```text
https://integraciones-vikar.onrender.com/webhook/gps-server?target=PLATAFORMA&client=SLUG_CLIENTE
```

*   **`target`**: Nombre del mandante de destino en minúsculas. Ver catálogo en la Sección 5 (ej. `melon`, `colun`, `arauco`, `falabella`).
*   **`client`**: El identificador o "slug" que le asigne al cliente en minúsculas (ej. `transklett`). **Recomendación:** Use el mismo nombre de usuario que tiene en GPS Server para mantener consistencia.

#### Ejemplo de URL real:
Si el cliente `transklett` debe transmitir datos a Cementos Melón:
`https://integraciones-vikar.onrender.com/webhook/gps-server?target=melon&client=transklett`

6. Asegúrese de que el tipo de evento seleccionado sea **"All Events"** o **"Positions / Ubicaciones"**.
7. Haga clic en **Guardar / Guardar Cambios**. A partir de este momento, cada reporte de la flota del cliente se enviará en tiempo real al middleware.

---

## 4. CONFIGURACIÓN EN RENDER.COM (Credenciales y Seguridad)

Cuando un mandante entrega credenciales de acceso privadas y exclusivas para un cliente, estas deben registrarse de forma segura en el servidor de Render para que la integración funcione.

### 4.1. Acceso a Render
1. Ingrese a la consola web de **Render.com** con las credenciales de la empresa.
2. Busque y haga clic sobre el servicio web llamado **`integraciones-vikar`**.

### 4.2. Estructura de Variables de Entorno con Sufijo de Cliente
El middleware cuenta con credenciales globales por defecto para cada plataforma. Sin embargo, para asignar accesos propios a un cliente específico, el sistema busca variables de entorno que terminen con el formato: `_SLUG_CLIENTE` (en mayúsculas).

*   **Formato de Clave:** `NOMBRE_DE_VARIABLE_SUFIJO`
*   **Ejemplo:** Si la variable genérica es `UNIGIS_SYSTEM_USER` y el cliente es `transklett`, la clave a crear en Render será: `UNIGIS_SYSTEM_USER_TRANSKLETT`.

### 4.3. Ejemplo Práctico de Configuración Paso a Paso
Suponga que debe configurar credenciales únicas para el cliente `pacel` que transmitirá a Colun.
1. Inicie sesión en Render y abra el servicio **`integraciones-vikar`**.
2. En el menú de la izquierda, haga clic en la pestaña **Environment** (Medio ambiente).
3. Presione el botón **Add Environment Variable** (Añadir variable de entorno).
4. Agregue las variables que necesite. Siguiendo la documentación técnica de Colun (Sección 5.1), creamos:
   *   **Key:** `COLUN_BEARER_TOKEN_PACEL`  
       **Value:** `Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...` (El token entregado por Colun para Pacel).
5. Haga clic en **Save Changes** (Guardar cambios).
6. **Importante:** Render reiniciará la aplicación automáticamente en segundo plano para aplicar los cambios. Este proceso tarda entre 1 y 2 minutos y **no interrumpe** las transmisiones activas de otros clientes.

---

## 5. CATÁLOGO DE INTEGRACIONES HOMOLOGADAS (Fichas Técnicas)

A continuación se detalla la configuración técnica para cada una de las 12 plataformas corporativas que ya están completamente programadas y listas para su uso en el middleware.

---

### 5.1. Colun (Plataforma Wing)
*   **Valor del Parámetro `target`:** `colun`
*   **Tipo de Conexión:** REST API (Envío en formato JSON)
*   **Variables de Entorno en Render:**
    *   `COLUN_API_URL` (Default: `https://services.wing.cl/tracking/receiver/hub/v2`)
    *   `COLUN_BEARER_TOKEN` (Clave de autenticación general o específica del cliente)
*   **Ejemplo de Webhook:**  
    `https://integraciones-vikar.onrender.com/webhook/gps-server?target=colun&client=transklett`
*   **Configuración en Render para cliente `transklett`:**  
    Crear variable `COLUN_BEARER_TOKEN_TRANSKLETT` con el valor del token.

---

### 5.2. Cementos Melón / Walmart / Cencosud / SMU (Plataforma UNIGIS)
*   **Valor del Parámetro `target`:** `melon` o `unigis` (ambos son válidos y apuntan a la misma estrategia)
*   **Tipo de Conexión:** Web Service SOAP/XML (Envío mediante llamadas HTTP POST SOAP)
*   **Variables de Entorno en Render:**
    *   `UNIGIS_API_URL` (Default de pruebas: `https://cloud-test.unigis.com/hub_TEST/mapi/soap/gps/service.asmx`)
    *   `UNIGIS_SYSTEM_USER` (Nombre de usuario asignado en UNIGIS)
    *   `UNIGIS_PASSWORD` (Contraseña asignada en UNIGIS)
*   **Ejemplo de Webhook:**  
    `https://integraciones-vikar.onrender.com/webhook/gps-server?target=melon&client=transklett`
*   **Configuración en Render para cliente `transklett`:**  
    *   `UNIGIS_SYSTEM_USER_TRANSKLETT` = `usuario_melon_transklett`
    *   `UNIGIS_PASSWORD_TRANSKLETT` = `clave_melon_transklett`
    *   `UNIGIS_API_URL_TRANSKLETT` = `https://unigis.melon.cl/mapi/soap/gps/service.asmx` (URL productiva de Melón)

---

### 5.3. Arauco (Plataforma SISCO)
*   **Valor del Parámetro `target`:** `arauco`
*   **Tipo de Conexión:** Web Service SOAP/XML
*   **Variables de Entorno en Render:**
    *   `ARAUCO_API_URL` (Default: `http://clsclwebqas09.arauco.cl/GPSChileWS/GPSChileWS.asmx`)
    *   `ARAUCO_PROVIDER_NAME` (Default: `VIKARGPS`)
    *   `ARAUCO_NOM_FLOTA` (Default: `VIKARGPS`)
    *   `ARAUCO_COD_FLOTA` (Default: `1539`)
*   **Ejemplo de Webhook:**  
    `https://integraciones-vikar.onrender.com/webhook/gps-server?target=arauco&client=transklett`
*   **Nota de Red Privada:** Arauco requiere que nuestra IP esté en su lista blanca (Whitelisting). Se debe coordinar con el departamento de TI de Arauco para autorizar la IP de salida de Render.

---

### 5.4. Falabella / Sodimac / Tottus (Plataforma QAnalytics)
*   **Valor del Parámetro `target`:** `falabella`
*   **Tipo de Conexión:** Web Service SOAP/XML
*   **Variables de Entorno en Render:**
    *   `FALABELLA_API_URL` (Default: `http://ww3.qanalytics.cl/gps_test/service.asmx`)
    *   `FALABELLA_USER` (Default: `WS_test`)
    *   `FALABELLA_PASSWORD` (Default: `$$WS17`)
*   **Ejemplo de Webhook:**  
    `https://integraciones-vikar.onrender.com/webhook/gps-server?target=falabella&client=transklett`
*   **Nota:** QAnalytics opera como la plataforma concentradora del grupo Falabella, Sodimac y Tottus. Mismo protocolo aplica para las tres marcas.

---

### 5.5. Cencosud (REST Directo)
*   **Valor del Parámetro `target`:** `cencosud`
*   **Tipo de Conexión:** REST API (Envío en formato JSON)
*   **Variables de Entorno en Render:**
    *   `CENCOSUD_API_URL` (Default: `https://api.cencosud.com/logistics/v1/telemetry`)
    *   `CENCOSUD_API_KEY` (Token API único)
*   **Ejemplo de Webhook:**  
    `https://integraciones-vikar.onrender.com/webhook/gps-server?target=cencosud&client=transklett`

---

### 5.6. Walmart (REST Directo)
*   **Valor del Parámetro `target`:** `walmart`
*   **Tipo de Conexión:** REST API (Envío en formato JSON)
*   **Variables de Entorno en Render:**
    *   `WALMART_API_URL` (Default: `https://api.walmart.com/logistics/v1/carrier/gps`)
    *   `WALMART_CLIENT_ID` (Identificador de Cliente)
    *   `WALMART_CLIENT_SECRET` (Clave Secreta de API)
*   **Ejemplo de Webhook:**  
    `https://integraciones-vikar.onrender.com/webhook/gps-server?target=walmart&client=transklett`

---

### 5.7. Mercado Libre Chile (Meli REST)
*   **Valor del Parámetro `target`:** `mercadolibre` o `meli`
*   **Tipo de Conexión:** REST API (Envío en formato JSON)
*   **Variables de Entorno en Render:**
    *   `MERCADOLIBRE_API_URL` (Default: `https://api.mercadolibre.com/logistics/carriers/telemetry`)
    *   `MERCADOLIBRE_BEARER_TOKEN` (Token Bearer de MercadoLibre)
*   **Ejemplo de Webhook:**  
    `https://integraciones-vikar.onrender.com/webhook/gps-server?target=meli&client=transklett`

---

### 5.8. SMU (REST Directo)
*   **Valor del Parámetro `target`:** `smu`
*   **Tipo de Conexión:** REST API (Envío en formato JSON)
*   **Variables de Entorno en Render:**
    *   `SMU_API_URL` (Default: `https://api.smu.cl/tracking/gps`)
    *   `SMU_API_TOKEN` (Token de Autorización)
*   **Ejemplo de Webhook:**  
    `https://integraciones-vikar.onrender.com/webhook/gps-server?target=smu&client=transklett`

---

### 5.9. Agrosuper
*   **Valor del Parámetro `target`:** `agrosuper`
*   **Tipo de Conexión:** REST API (Transmisión de ubicación y temperatura de cadena de frío)
*   **Variables de Entorno en Render:**
    *   `AGROSUPER_API_URL` (Default: `https://api.agrosuper.cl/logistica/telemetria/gps`)
    *   `AGROSUPER_API_KEY` (Clave de autenticación API)
*   **Ejemplo de Webhook:**  
    `https://integraciones-vikar.onrender.com/webhook/gps-server?target=agrosuper&client=transklett`

---

### 5.10. CCU Chile
*   **Valor del Parámetro `target`:** `ccu`
*   **Tipo de Conexión:** REST API (Envío en formato JSON)
*   **Variables de Entorno en Render:**
    *   `CCU_API_URL` (Default: `https://api.ccu.cl/distribucion/gps`)
    *   `CCU_BEARER_TOKEN` (Token Bearer de CCU)
*   **Ejemplo de Webhook:**  
    `https://integraciones-vikar.onrender.com/webhook/gps-server?target=ccu&client=transklett`

---

### 5.11. Amazon (SP-API Latam)
*   **Valor del Parámetro `target`:** `amazon`
*   **Tipo de Conexión:** REST API (Compatible con Amazon Carrier Telemetry API)
*   **Variables de Entorno en Render:**
    *   `AMAZON_API_URL` (Default: `https://sellingpartnerapi-na.amazon.com/shipping/v2/carrier/telemetry`)
    *   `AMAZON_ACCESS_TOKEN` (Token de acceso AWS de Amazon SP-API)
*   **Ejemplo de Webhook:**  
    `https://integraciones-vikar.onrender.com/webhook/gps-server?target=amazon&client=transklett`

---

### 5.12. DHL Logistics
*   **Valor del Parámetro `target`:** `dhl`
*   **Tipo de Conexión:** REST API (Envío en formato JSON)
*   **Variables de Entorno en Render:**
    *   `DHL_API_URL` (Default: `https://api.dhl.com/transport/v1/telemetry`)
    *   `DHL_API_KEY` (Clave API proporcionada por DHL)
*   **Ejemplo de Webhook:**  
    `https://integraciones-vikar.onrender.com/webhook/gps-server?target=dhl&client=transklett`

---

## 6. USO DEL PANEL WEB DE ADMINISTRACIÓN (DASHBOARD)

El middleware cuenta con una interfaz web privada para facilitar la creación de conexiones y permitir al personal de oficina diagnosticar transmisiones de forma sencilla.

### 6.1. Acceso y Credenciales de Seguridad
*   **Dirección Web:** `https://integraciones-vikar.onrender.com`
*   **Restricción de Acceso:** Al ingresar, el navegador solicitará un usuario y contraseña. Utilice las siguientes credenciales:
    *   **Usuario:** `admin`
    *   **Contraseña:** `vikar1247`
*   *(Nota: Esta autenticación solo protege la parte visual del administrador. Los webhooks de GPS y las llamadas automatizadas externas no se ven afectadas ni bloqueadas).*

### 6.2. Generador Automático de URLs de Webhook
En la sección superior del panel:
1. Seleccione la **Plataforma Mandante** (ej. Colun) en el menú desplegable.
2. Escriba el **Identificador de Cliente** (ej. `pacel`) en el cuadro de texto.
3. El panel generará automáticamente la URL lista para copiar. Haga clic en el botón **"Copiar URL"** y péguela directamente en GPS Server (gsh7.net).

### 6.3. Monitor en Tiempo Real y Diagnóstico de Tráfico
El panel cuenta con una consola de depuración en vivo:
*   Muestra los últimos datos GPS procesados por el servidor.
*   Permite verificar si la patente ingresada en el servidor GPS coincide exactamente con la enviada en el paquete.
*   Muestra la respuesta del servidor del mandante. Si el mandante responde con un error (ej. `HTTP 401 Unauthorized` o `Vehículo No Encontrado`), aparecerá reflejado en la lista con color rojo.

### 6.4. Simulador de Envío y Herramienta de Pruebas de Ping
El panel permite realizar una simulación técnica para verificar que los servidores del mandante estén en línea:
1. Ingrese una patente y coordenadas ficticias.
2. Presione **"Enviar Prueba / Test Ping"**.
3. El servidor enviará una señal de verificación inmediata y le notificará en pantalla si la conexión fue exitosa (`Conexión Exitosa - HTTP 200`) o si falló la comunicación, lo que permite descartar caídas de los servidores de destino en segundos.

---

## 7. RESOLUCIÓN DE PROBLEMAS FRECUENTES (Troubleshooting)

### 7.1. El vehículo reporta en gsh7.net pero no llega al Mandante
*   **Causa 1: Patente mal formateada en GPS Server.**
    *   *Solución:* Revise que la patente en el servidor GPS esté en mayúsculas y no contenga guiones (ej. debe ser `ABCD12` y no `abcd-12`).
*   **Causa 2: La patente no está registrada en el sistema del Mandante.**
    *   *Solución:* El mandante rechaza cualquier dato si su área logística no ha ingresado previamente la patente en su base de datos corporativa. Envíe un correo al contacto del mandante solicitando que "den de alta" la patente en su sistema.
*   **Causa 3: Webhook mal configurado.**
    *   *Solución:* Verifique que la URL copiada en gsh7.net tenga exactamente las palabras clave correctas sin espacios (ej: `target=melon&client=transklett`).

### 7.2. Errores de Conexión Comunes (Timeout, Credenciales, Red Privada)
*   **Error: `ETIMEDOUT` / `ENOTFOUND`**
    *   *Significado:* El servidor del mandante no responde o no está disponible públicamente.
    *   *Solución:* Compruebe si el mandante requiere Red Privada (ej. Arauco). Si es así, asegúrese de haber solicitado a su TI que agregue la IP de salida de nuestro servidor de Render a su lista blanca.
*   **Error: `HTTP 401 Unauthorized` / `HTTP 403 Forbidden`**
    *   *Significado:* El token o las credenciales configuradas en Render no son válidas o han expirado.
    *   *Solución:* Revise en Render que el nombre de las variables de entorno para el cliente esté bien escrito (ej: `UNIGIS_PASSWORD_CLIENTE`) y que el valor copiado no tenga espacios adicionales al inicio o al final.

### 7.3. Cómo revisar los logs del servidor en Render.com
Si la falla persiste y necesita apoyo de desarrollo:
1. Inicie sesión en **Render.com** y haga clic en **`integraciones-vikar`**.
2. Seleccione la pestaña **Logs** en el panel superior.
3. Observe el flujo de texto en tiempo real. Cuando ocurre una transmisión, el middleware escribe detalladamente:
   *   El IMEI y la patente detectados.
   *   El mandante de destino seleccionado.
   *   La respuesta exacta (error o éxito) devuelta por el servidor del mandante.
4. Tome una captura de pantalla del error de los Logs y envíela al departamento técnico para su revisión.

---

\newpage

## 8. ANEXO: FICHA DE VALIDACIÓN E INICIO DE TRANSMISIÓN (Imprimible)

*Esta ficha debe ser impresa y completada por el operador de Vikar GPS encargado para registrar cada proceso de integración de manera formal.*

---

### 📝 DATOS GENERALES DE LA INTEGRACIÓN
*   **Fecha de Ejecución:** _____ / _____ / _________
*   **Operador Responsable:** __________________________________________________
*   **Nombre del Cliente (Transportista):** ______________________________________
*   **Identificador de Cliente (Slug):** _________________________________________
*   **Nombre de la Empresa Mandante (Destino):** __________________________________
*   **Plataforma de Enrutamiento (`target`):** ___________________________________

---

### ⚙️ CHECKLIST DE CONFIGURACIÓN Y OPERATIVIDAD

#### Fase 1: Recolección y Alta de Vehículos
*   [ ] **Credenciales Disponibles:** Se ingresaron las credenciales y URLs entregadas por el cliente en la sección *Environment* de Render.com (con el sufijo correcto, ej. `_TRANSKLETT`).
*   [ ] **Patentes Registradas:** El mandante confirmó que las patentes ya están cargadas en su sistema interno.
*   [ ] **Formato de Patente en gsh7.net:** Se validó que las patentes de la flota están escritas en **MAYÚSCULAS y sin guiones o espacios** en el servidor de rastreo.

#### Fase 2: Configuración del Canal Telemático
*   [ ] **Habilitación de Webhook:** La URL del webhook dinámico fue generada en el dashboard e ingresada dentro de la cuenta del usuario en gsh7.net.
*   [ ] **Verificación de Enlace:** La URL del webhook contiene los parámetros correctos de `target` y `client` correspondientes a la integración.

#### Fase 3: Pruebas y Validación en Vivo
*   [ ] **Prueba de Ping de Conexión:** Se ejecutó el simulador de ping desde el panel web de Vikar confirmando que los servidores del mandante devuelven respuesta satisfactoria (HTTP 200 / OK).
*   [ ] **Validación en Consola (Logs):** Se encendió un vehículo de prueba en carretera y se confirmó en el visor de logs del middleware que la transmisión GPS se procesó y redirigió con éxito.
*   [ ] **Confirmación del Mandante:** Se recibió confirmación escrita (correo, WhatsApp o captura) del encargado técnico del mandante indicando que ven el camión reportando correctamente en su sistema.

---

### 🖋️ FIRMAS DE CONFORMIDAD

```text
                                              
 _________________________________             _________________________________
       Operador de Vikar GPS                             Jefe de Soporte
       Firma y Aclaración                          Firma y Visto Bueno
```

*Archivar esta ficha firmada junto con el correo de confirmación de transmisión entregado por el mandante.*
