# Política de Privacidad — Comprobify

Esta Política de Privacidad describe cómo **{{operador.nombre}}**, persona natural con RUC **{{operador.ruc}}**, titular de la plataforma Comprobify ("Comprobify", "nosotros") trata los datos personales en el contexto de la prestación del servicio de facturación electrónica y gestión empresarial (ERP), en cumplimiento de la Ley Orgánica de Protección de Datos Personales de la República del Ecuador (la "LOPDP").

## 1. Roles: quién es responsable de qué

Es importante distinguir dos roles, porque determinan quién decide qué se hace con los datos:

- **El Cliente (la persona natural o jurídica que usa Comprobify) es el Responsable del Tratamiento** de los datos de sus propios compradores/clientes finales. Es el Cliente quien decide qué datos de comprador se incluyen en cada comprobante y con qué finalidad.
- **Comprobify actúa como Encargado del Tratamiento** respecto de esos datos: los procesamos únicamente para generar, firmar y transmitir comprobantes electrónicos por instrucción del Cliente, y no los utilizamos para ningún fin propio (marketing, perfilamiento, venta a terceros, etc.), salvo cuando sea estrictamente necesario para la seguridad del Servicio, prevención de fraude, cumplimiento de obligaciones legales, o resolución de incidencias.

Para los datos del propio Cliente (su cuenta, su correo, su certificado de firma), Comprobify es el Responsable del Tratamiento.

## 2. Qué datos recopilamos

| Dato | De quién | Por qué |
|---|---|---|
| Correo electrónico, RUC, razón social del Cliente | Del Cliente (titular de la cuenta) | Identificación de la cuenta, comunicaciones operativas (verificación, facturación, alertas) |
| Datos contenidos en los comprobantes electrónicos, incluyendo RUC/cédula, nombre, dirección, correo electrónico, teléfono, y demás campos exigidos por la normativa del SRI según el tipo de comprobante | Del Cliente, por instrucción suya | Requisito legal del SRI para la emisión válida de comprobantes electrónicos |
| Nombre comercial, direcciones (matriz y sucursal) y logotipo opcional del emisor | Del Cliente | Se imprimen en los comprobantes electrónicos y en su representación impresa (RIDE), según lo exige el SRI o lo decide el Cliente |
| Clave privada de firma (cifrada con AES-256-GCM) y certificado digital (.p12) | Del Cliente | Almacenados únicamente para prestar el servicio de firma electrónica (XAdES-BES) solicitado por el Cliente, requerido por el SRI |
| Dirección IP y user-agent del Cliente | Del Cliente | Evidencia de aceptación al aceptar los Términos de Servicio, la Política de Privacidad o el DPA (ver sección de Registros) |
| Nombre, correo electrónico, contraseña (almacenada como hash, nunca en texto plano), rol y, si la activa, la configuración de verificación en dos pasos (cifrada) de cada usuario que el Cliente invita | Del Cliente y de cada usuario | Gestionar el acceso y los permisos de cada usuario dentro de la cuenta del Cliente |
| Datos de los clientes y proveedores del Cliente, su catálogo de productos o servicios, inventario, órdenes de compra y de venta, y demás datos de operación que el Cliente ingresa | Del Cliente | Prestar las funciones de gestión empresarial del Servicio por instrucción del Cliente |
| Comprobante de pago por transferencia bancaria, o datos de la transacción cuando el pago se realiza con tarjeta (marca de la tarjeta, últimos dígitos, código de autorización e identificador de la transacción asignado por el procesador de pagos) | Del Cliente, o del procesador de pagos según el medio de pago utilizado | Verificación del pago de la suscripción, conciliación contable y atención de reclamos o reversos |

Cuando el Cliente paga su suscripción con tarjeta, Comprobify **no recibe, no transmite y no almacena en ningún momento el número completo de la tarjeta ni su código de seguridad**. Dichos datos se ingresan directamente en el formulario del procesador de pagos y no transitan por los sistemas de Comprobify.

Los datos contenidos en el comprobante incluyen, cuando el Cliente los utiliza, los denominados "Campos Adicionales" (a nivel de comprobante) y "Detalles Adicionales" (a nivel de cada ítem), previstos por el esquema del SRI como campos de texto libre — su contenido es determinado libremente por el Cliente y puede incluir información adicional a la exigida por la normativa del SRI.

**Datos de operación.** Además de los comprobantes, Comprobify almacena los datos que el Cliente ingresa para operar su negocio en el Servicio — catálogos de clientes y proveedores (con fines de reutilización en comprobantes, órdenes y compras), catálogo de productos o servicios, inventario, órdenes de compra y de venta —, así como otra información funcionalmente similar que se incorpore conforme evolucione el Servicio.

## 3. Base legal y finalidad

Respecto de los datos del propio Cliente, el tratamiento se realiza para la ejecución de los Términos de Servicio entre Comprobify y el Cliente, que constituyen el contrato de servicio bajo el cual se presta el Servicio. Respecto de los datos del comprador, el tratamiento se realiza por instrucción directa del Cliente en su calidad de Responsable del Tratamiento, con la finalidad exclusiva de generar y transmitir comprobantes electrónicos válidos ante el SRI.

## 4. Con quién compartimos datos

**Subencargados del tratamiento.** Los siguientes proveedores tratan datos personales por cuenta de Comprobify y conforme a sus instrucciones, según sus propios términos de servicio y compromisos de confidencialidad y seguridad:

- **DigitalOcean** — infraestructura y alojamiento del Servicio (todos los Clientes).
- **DigitalOcean Managed Postgres** — base de datos PostgreSQL del Servicio (todos los Clientes).
- **Cloudflare** — proxy inverso, red de entrega de contenido (CDN) y protección contra ataques para el tráfico dirigido al Servicio; dicho tráfico atraviesa su red, por lo que su contenido puede ser procesado de forma transitoria durante el tránsito (todos los Clientes).
- **Mailgun** — envío de correos transaccionales (verificación de cuenta, RIDE/PDF de comprobantes autorizados, notificaciones) (todos los Clientes).
- **Sentry** — monitoreo de errores (configurado para minimizar el tratamiento de datos personales) (todos los Clientes).
- **Betterstack** — plataforma de registro (logging) para monitoreo operativo y diagnóstico de errores; puede incluir la dirección IP de cada solicitud al Servicio, conforme a lo descrito en la sección 6 (todos los Clientes).

**Terceros que actúan como responsables independientes.** Los siguientes destinatarios no tratan datos por cuenta de Comprobify: determinan sus propios fines y medios en cumplimiento de obligaciones legales y regulatorias propias.

- **SRI (Servicio de Rentas Internas)** — autoridad tributaria ecuatoriana receptora obligatoria por mandato legal; la transmisión de comprobantes electrónicos es exigida por la normativa tributaria aplicable (todos los Clientes).
- **Payphone** — procesamiento de pagos con tarjeta de crédito o débito para el pago de la suscripción del Cliente, cuando el Cliente elige este medio de pago. Los datos de la tarjeta se ingresan directamente en el formulario de Payphone y no son recibidos ni almacenados por Comprobify. Comprobify recibe de Payphone únicamente el resultado de la transacción y los datos indicados en la sección 2. Payphone trata dichos datos como responsable independiente, conforme a su propia política de privacidad y a la normativa aplicable a los medios de pago (solo Clientes que pagan con tarjeta).

Algunos de estos proveedores pueden procesar datos en servidores ubicados fuera del Ecuador. Dichas transferencias se realizan únicamente para la prestación del Servicio y bajo los compromisos de confidencialidad y seguridad propios de cada proveedor.

No vendemos ni compartimos datos personales con terceros para fines comerciales o publicitarios.

Esta lista de proveedores puede actualizarse conforme evolucione la infraestructura del Servicio, garantizando en todo momento un nivel adecuado de protección de datos personales.

## 5. Medidas de seguridad

- **Aislamiento de los datos a nivel de base de datos** mediante Row-Level Security (RLS) de PostgreSQL — las tablas con datos de cada empresa (comprobantes, catálogos, inventario, usuarios, firmas electrónicas y registros de actividad) están protegidas directamente en el motor de base de datos, no solo por la lógica de la aplicación. La protección es de falla cerrada: una consulta que no declare a qué empresa pertenece es rechazada con un error, no devuelve datos.
- **Cifrado AES-256-GCM** de la clave privada de firma; la clave de cifrado se gestiona fuera de la base de datos.
- **TLS** en todas las comunicaciones con el Servicio.
- **Contraseñas almacenadas únicamente como hash**, nunca en texto plano, y **verificación en dos pasos** (código de una aplicación de autenticación) opcional para cada usuario, que la empresa puede exigir a todos sus miembros.
- **Acceso administrativo** restringido mediante mecanismos de autenticación independientes de las credenciales de los Clientes.
- **Enlaces de un solo uso que caducan** para verificar el correo electrónico, restablecer la contraseña y aceptar invitaciones; abrir un enlace no lo consume, solo confirmar la acción.
- **Diseño anti-enumeración** en el registro y el restablecimiento de contraseña — una solicitud con un correo registrado o no registrado recibe la misma respuesta, de modo que estos flujos no puedan usarse para confirmar si un correo existe en el sistema.
- **Limitación de tasa (rate limiting)** por correo electrónico y por dirección IP en el inicio de sesión, el registro, el restablecimiento de contraseña, la verificación y las invitaciones, y bloqueo temporal tras códigos de verificación en dos pasos incorrectos.
- La cuenta de base de datos utilizada por la aplicación no tiene privilegios de superusuario, y las políticas de RLS están diseñadas para impedir su elusión desde la capa de aplicación.

## 6. Registros (logs)

Comprobify mantiene un registro de auditoría de los eventos relevantes del ciclo de vida de cada comprobante y de la cuenta del Cliente (creación, envío, autorización, cambios de estado, entre otros), con la finalidad de garantizar la seguridad del Servicio, diagnosticar errores y mantener la trazabilidad de las operaciones.

La dirección IP y el user-agent del Cliente se registran al momento de aceptar los Términos de Servicio, la Política de Privacidad o el DPA, como evidencia de dicha aceptación. Adicionalmente, con fines de seguridad y diagnóstico operativo, la dirección IP de cada solicitud individual al Servicio se incluye en los registros técnicos del Servicio (no se guarda en la base de datos de la cuenta) junto con identificadores técnicos de la solicitud (método, ruta, código de respuesta, y los identificadores internos de la cuenta, del emisor y de la clave de acceso del comprobante cuando corresponden; nunca el contenido de los comprobantes ni credenciales), los cuales se conservan durante un período máximo de tres (3) días, transcurrido el cual se eliminan de forma automática.

Comprobify también utiliza contadores temporales en su base de datos, con fines de limitación de tasa (rate limiting) y detección de intentos repetidos de acceso no autorizado; la dirección IP y el correo electrónico se guardan en ellos únicamente como huella criptográfica (hash). Estos contadores se eliminan automáticamente al cabo de un día y no constituyen un registro histórico.

## 7. Cookies y tecnologías similares

El Servicio utiliza cookies técnicas necesarias para mantener la sesión del usuario autenticado, recordar la empresa activa seleccionada, garantizar la seguridad, y mejorar el funcionamiento del Servicio. Comprobify no utiliza cookies con fines publicitarios ni de seguimiento de terceros, salvo que se indique expresamente en el momento correspondiente.

## 8. Retención de datos

Comprobify almacena los datos relacionados con comprobantes electrónicos emitidos a través del Servicio (facturas, notas de crédito y documentos similares) y los metadatos necesarios para su autorización por el SRI, así como, de forma independiente al comprobante, los datos de operación descritos en la sección 2.

Los comprobantes electrónicos y su historial de autorización, firma y transmisión están sujetos a los plazos de conservación establecidos por la normativa tributaria ecuatoriana — en particular el Código Tributario y el Reglamento de Comprobantes de Venta, Retención y Documentos Complementarios —, que exigen conservar los documentos tributarios durante el período de prescripción de las obligaciones tributarias. **Durante este período — que conforme al Art. 55 del Código Tributario es de cinco (5) años para los casos ordinarios y de siete (7) años cuando la declaración no fue presentada o fue presentada de forma incompleta; se recomienda conservar durante el plazo mayor como medida prudente —, Comprobify no eliminará ni permitirá la eliminación de dichos datos, incluso ante una solicitud de supresión.** El derecho de supresión reconocido por la LOPDP no es aplicable cuando la conservación es necesaria para el cumplimiento de una obligación legal (Art. 15 LOPDP).

**Los catálogos de clientes, proveedores y productos o servicios no están sujetos a esta limitación.** A diferencia de los datos ya incorporados en un comprobante autorizado, una entrada de estos catálogos no constituye por sí misma un documento tributario — el Cliente puede eliminarla directamente desde el Servicio en cualquier momento, sin las restricciones aplicables a los datos de comprobantes ya autorizados.

Para los datos de la cuenta del Cliente (correo electrónico, metadatos de registro, historial de pagos) — y los datos de los usuarios que invitó — que no formen parte de un comprobante electrónico autorizado por el SRI, Comprobify atenderá solicitudes de supresión una vez terminada la relación con Comprobify, siempre que no existan obligaciones legales que requieran su conservación.

Los datos de las transacciones de pago con tarjeta forman parte del historial de pagos del Cliente y se conservan conforme a lo indicado en el párrafo anterior y a los plazos exigidos por la normativa tributaria y contable aplicable a los pagos recibidos por Comprobify. **De la respuesta que devuelve el procesador de pagos, Comprobify conserva únicamente los datos indicados en la sección 2 — importe, estado de la transacción, código de autorización y marca y últimos dígitos de la tarjeta —; los datos de identificación del titular de la tarjeta que el procesador pueda devolver no se almacenan.**

El Cliente puede eliminar en cualquier momento el logotipo de un emisor mediante el Servicio; al hacerlo, la representación impresa (RIDE) de todos sus comprobantes, incluidos los ya autorizados, se genera sin logotipo — el XML del comprobante electrónico autorizado por el SRI no se modifica.

Actualmente el sistema no implementa un mecanismo de eliminación definitiva de comprobantes electrónicos ni de su historial de auditoría y cumplimiento normativo; únicamente admite la desactivación lógica de recursos como emisores.

## 9. Derechos del titular de los datos

Bajo la LOPDP, los compradores cuyos datos constan en un comprobante pueden ejercer sus derechos de acceso, rectificación, actualización, eliminación (cuando proceda), oposición y portabilidad (si aplica), **directamente ante el Cliente** (Responsable del Tratamiento), quien decidió incluir esos datos. Comprobify, como Encargado, colaborará con el Cliente para atender dichas solicitudes en la medida técnicamente posible. **El derecho de eliminación no aplica a los datos contenidos en comprobantes electrónicos autorizados por el SRI durante el período de conservación obligatorio establecido por la normativa tributaria ecuatoriana (ver sección 8).**

El Cliente, respecto de los datos de su propia cuenta (correo, certificado, historial de pagos), puede ejercer los mismos derechos señalados anteriormente directamente ante Comprobify, escribiendo a `{{soporte.email}}`.

Cada usuario que el Cliente invita puede ejercer los mismos derechos respecto de sus propios datos (nombre, correo electrónico, contraseña). El acceso y la rectificación de su nombre y contraseña están disponibles directamente desde su cuenta en el Servicio; cualquier otra solicitud puede dirigirse a `{{soporte.email}}`.

## 10. Cambios a esta política

Publicaremos cualquier cambio material en esta página con una nueva versión. Cuando las modificaciones sean sustanciales y la legislación aplicable así lo requiera, Comprobify podrá solicitar una nueva aceptación antes de continuar utilizando el Servicio.

## 11. Contacto

`{{operador.nombre}}` — RUC `{{operador.ruc}}` — {{operador.domicilio}} — `{{soporte.email}}`
