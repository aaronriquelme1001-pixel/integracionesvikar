# GUÍA DE INTEGRACIÓN TELEMÁTICA PARA EMPRESAS MANDANTES
## Especificaciones y Requerimientos de Transmisión de Datos GPS

*   **Documento de Referencia:** GI-MAND-01
*   **Emisor:** Área de Integraciones y TI — Vikar GPS
*   **Contacto Técnico:** `contacto@vikargps.cl`
*   **Propósito:** Detallar los requerimientos y el procedimiento operativo para integrar y transmitir en tiempo real las posiciones GPS de la flota de transporte de un proveedor (cliente de Vikar) hacia los sistemas de control logístico de la empresa mandante.

---

## 📋 ÍNDICE DE CONTENIDOS

1. **Presentación y Alcance del Servicio**
   * 1.1. Sobre Vikar GPS
   * 1.2. Objetivo de la Integración
   * 1.3. Compatibilidad de Protocolos (REST & SOAP)
2. **Requerimientos Técnicos (Lo que necesitamos de su área de TI)**
   * 2.1. Documentación del Servicio (API / Web Service)
   * 2.2. Endpoints y Direcciones de Servidor
   * 2.3. Credenciales de Acceso y Seguridad
3. **Acciones Necesarias por Parte del Mandante**
   * 3.1. Registro de Patentes en su Plataforma
   * 3.2. Autorización de Direcciones IP de Vikar (Whitelisting)
   * 3.3. Activación de Credenciales de Transmisión
4. **Especificaciones de los Datos Transmitidos**
   * 4.1. Diccionario de Datos GPS Estándar
   * 4.2. Soporte para Sensores y Cadena de Frío (Temperatura)
5. **Fases del Proceso de Integración (Flujo de Trabajo)**
   * 5.1. Etapa 1: Planificación y Configuración (Vikar)
   * 5.2. Etapa 2: Pruebas en Entorno de Desarrollo/QA
   * 5.3. Etapa 3: Validación Técnica
   * 5.4. Etapa 4: Certificación y Paso a Producción
6. **Contacto y Canales de Soporte**

---

## 1. PRESENTACIÓN Y ALCANCE DEL SERVICIO

### 1.1. Sobre Vikar GPS
**Vikar GPS** es una empresa proveedora de soluciones de rastreo satelital, telemetría avanzada y control de flotas. Ayudamos a las empresas de transporte a optimizar su operación y cumplir con los más altos estándares logísticos exigidos por sus mandantes corporativos.

### 1.2. Objetivo de la Integración
El objetivo es automatizar la retransmisión de datos de posicionamiento satelital de los camiones del transportista hacia el sistema de gestión del Mandante (ej. UNIGIS, QAnalytics, Wing, o plataformas propietarias de Retail / Minería / Consumo Masivo). Esto permite al Mandante obtener visibilidad completa del estado de sus despachos, estimar tiempos de arribo (ETA) y controlar ventanas horarias de entrega en tiempo real.

### 1.3. Compatibilidad de Protocolos
Nuestra plataforma en la nube (Middleware) cuenta con adaptadores nativos y es totalmente compatible con los siguientes protocolos estándar del mercado:

*   **API REST / JSON:** Envío de payloads HTTP POST/PUT estructurados de forma dinámica.
*   **Web Services SOAP / XML:** Consumo de servicios gubernamentales o corporativos tradicionales estructurados bajo envelopes SOAP.
*   **Protocolos Propietarios:** Adaptación de formatos a medida según las especificaciones provistas por el mandante.

---

## 2. REQUERIMIENTOS TÉCNICOS (Lo que necesitamos de su área de TI)

Para iniciar la configuración del canal de transmisión, solicitamos al área de TI o de Soporte de Integración del Mandante proveer la siguiente información:

### 2.1. Documentación del Servicio (API / Web Service)
El manual técnico o documentación técnica que describa el funcionamiento del servicio de entrada de datos GPS. Este debe incluir:
*   La estructura del payload requerido (ejemplo de JSON o XML SOAP).
*   La respuesta esperada por su servidor (códigos HTTP de éxito y mensajes de confirmación).

### 2.2. Endpoints y Direcciones de Servidor
Las direcciones URL donde nuestro servidor debe enviar las peticiones:
*   **URL de Pruebas (Sandbox/QA):** Destinada a la validación de tramas de prueba sin alterar la operación real.
*   **URL de Producción (Live/Production):** Destinada al tráfico real de los camiones operativos en ruta.

### 2.3. Credenciales de Acceso y Seguridad
El conjunto de llaves o accesos que permitan a Vikar GPS autenticarse de forma segura ante sus servidores. Dependiendo de sus políticas de seguridad, requerimos:
*   **Para autenticación básica:** Usuario y Contraseña del servicio web.
*   **Para APIs REST:** API Key (X-API-Key) o Token Bearer (JWT) permanente o con mecanismo de autorenovación.
*   **Para conexiones OAuth:** Client ID y Client Secret si el servicio requiere intercambio dinámico de tokens.

---

## 3. ACCIONES NECESARIAS POR PARTE DEL MANDANTE

La puesta en marcha exitosa requiere que el equipo técnico del Mandante realice las siguientes tres acciones críticas:

### 3.1. Registro de Patentes en su Plataforma (Crítico)
Los sistemas logísticos corporativos validan la información GPS utilizando la **Patente (Plate)** del vehículo como identificador principal. Si una patente nos reporta pero no está previamente creada e identificada en su base de datos, el sistema del Mandante rechazará la trama con error "Vehículo no registrado".
*   **Requerimiento:** Favor registrar las patentes provistas por el transportista en su sistema logístico antes de iniciar las pruebas.

### 3.2. Autorización de Direcciones IP de Vikar (Whitelisting)
Si los servidores del Mandante se encuentran protegidos por firewalls de red perimetrales o requieren una lista blanca de IPs autorizadas para recibir tráfico entrante:
*   **Requerimiento:** Favor informar a su área de seguridad de red para permitir las conexiones de salida provenientes de la dirección IP de nuestro servidor de Render. (La dirección IP específica será facilitada por nuestro equipo de soporte técnico a solicitud).

### 3.3. Activación de Credenciales de Transmisión
Asegurar que los accesos asignados a la cuenta de Vikar GPS para el transportista específico tengan permisos de escritura y actualización de estados geográficos habilitados.

---

## 4. ESPECIFICACIONES DE LOS DATOS TRANSMITIDOS

Nuestros dispositivos y middleware capturan y reportan un amplio conjunto de telemetría. A continuación se detallan los campos estándar que enviamos en cada trama:

### 4.1. Diccionario de Datos GPS Estándar

| Nombre del Campo | Tipo de Dato | Formato / Ejemplo | Descripción |
| :--- | :---: | :--- | :--- |
| **Identificador (IMEI)** | Alfanumérico | `862798052972060` | Código de 15 dígitos único del equipo físico GPS. |
| **Patente (Plate)** | Alfanumérico | `ABCD12` | Patente del camión en mayúsculas y sin guiones. |
| **Latitud** | Decimal | `-33.456789` | Coordenada geográfica (latitud) con precisión de 6 decimales. |
| **Longitud** | Decimal | `-70.654321` | Coordenada geográfica (longitud) con precisión de 6 decimales. |
| **Velocidad** | Entero / Decimal | `75` | Velocidad instantánea del camión medida en km/h. |
| **Rumbo (Angle)** | Entero | `180` | Dirección del vehículo expresada en grados (0 a 359). |
| **Fecha y Hora (UTC)** | ISO 8601 | `2026-05-28T14:56:00.000Z` | Marca de tiempo del reporte sincronizada con reloj satelital. |
| **Estado de Motor (Ignition)** | Booleano | `true` / `false` | Estado de encendido de la chapa del vehículo (contacto). |

### 4.2. Soporte para Sensores y Cadena de Frío
Para servicios de transporte de mercancías refrigeradas o de alto valor, podemos transmitir variables adicionales tales como:
*   **Temperatura de la Carga:** Datos recopilados por sensores de temperatura inalámbricos (BLE) instalados dentro de las cámaras de frío.
*   **Sensores de Puertas:** Detección de apertura y cierre de las compuertas de carga.
*   **Nivel de Batería del Dispositivo:** Porcentaje de carga del equipo GPS principal o sensores auxiliares.

---

## 5. FASES DEL PROCESO DE INTEGRACIÓN (Flujo de Trabajo)

Para garantizar un proceso ordenado, seguro y sin interrupciones operativas, el proyecto de integración se divide en cuatro fases:

```
[ Fase 1: Configuracion y Mapeo ]
  Vikar parametriza las credenciales y metodos de envio.
                │
                ▼
[ Fase 2: Pruebas en Entorno QA ]
  Envio de tramas de prueba a su servidor Sandbox/QA.
                │
                ▼
[ Fase 3: Validacion Tecnica ]
  El equipo de TI del Mandante certifica la recepcion.
                │
                ▼
[ Fase 4: Paso a Produccion ]
  Activacion en vivo del envio de datos telematicos.
```

*   **Fase 1: Configuración y Mapeo (1 a 2 días hábiles):**  
    Una vez recibidos los accesos y la documentación por parte de la empresa Mandante, el equipo de Vikar GPS configura los parámetros en su middleware y programa las patentes correspondientes.
*   **Fase 2: Pruebas en Entorno de Desarrollo (QA):**  
    Se inician transmisiones de prueba (simuladas o con un vehículo real circulando) hacia el Sandbox del Mandante para validar que la estructura de datos sea correcta y no se generen excepciones en su servidor.
*   **Fase 3: Validación Técnica:**  
    El equipo de TI del Mandante verifica la recepción de los datos en su consola de base de datos o panel logístico y nos otorga la aprobación técnica ("Ok" de conformidad).
*   **Fase 4: Certificación y Producción:**  
    Se cambian las URLs de destino al servidor productivo del Mandante. A partir de este momento, se inicia la transmisión comercial y el transportista puede iniciar labores de despacho oficial.

---

## 6. CONTACTO Y CANALES DE SOPORTE

Para coordinaciones técnicas de integración, solución de dudas sobre los protocolos o reportes de fallas de transmisión, favor comunicarse a través de los siguientes canales oficiales:

*   **Correo Electrónico de Soporte:** `contacto@vikargps.cl`
*   **Área Responsable:** Departamento de Soporte e Integración Telemática — Vikar GPS
*   **Horario de Atención:** Lunes a Viernes de 09:00 a 18:30 hrs. (Hora de Chile).

*Agradecemos de antemano la disposición de su equipo técnico para llevar a cabo este proceso de integración, permitiendo optimizar el control de la cadena logística y de distribución.*
