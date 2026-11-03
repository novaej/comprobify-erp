# Acuerdo de Procesamiento de Datos (DPA) — Comprobify

Este Acuerdo de Procesamiento de Datos ("DPA") complementa los Términos de Servicio y se celebra entre **{{operador.nombre}}**, persona natural con RUC **{{operador.ruc}}**, titular de la plataforma Comprobify (en adelante, "Comprobify" o "el Encargado"), y **{{cliente.razonSocial}}**, RUC **{{cliente.ruc}}** ("el Responsable"), y se aplica al tratamiento de datos personales de terceros (compradores) que el Responsable instruye al Encargado a procesar a través del Servicio.

## 1. Definiciones

A los efectos de este DPA, los términos "Responsable del Tratamiento", "Encargado del Tratamiento", "datos personales" y "tratamiento" tendrán el significado previsto en la Ley Orgánica de Protección de Datos Personales de la República del Ecuador ("LOPDP").

## 2. Objeto

El Encargado procesa, por instrucción documentada del Responsable, los datos personales de los compradores incluidos en los comprobantes electrónicos que el Responsable genera a través del Servicio, con la finalidad de generar, firmar electrónicamente, transmitir al Servicio de Rentas Internas ("SRI") y conservar los comprobantes electrónicos, así como almacenar los datos de clientes y proveedores que el Responsable guarda para reutilizarlos, conforme a lo descrito en la sección 3.

## 3. Categorías de datos e interesados

- **Interesados:** compradores/clientes finales y proveedores del Responsable.
- **Categorías de datos:** RUC/cédula, nombre o razón social, dirección, correo electrónico, teléfono, y demás datos del comprador incluidos en el comprobante, entre otros datos exigidos por el esquema de comprobantes electrónicos del SRI según el tipo de documento.

Estas categorías incluyen, cuando el Responsable los utiliza, los denominados "Campos Adicionales" (a nivel de comprobante) y "Detalles Adicionales" (a nivel de cada ítem), previstos por el esquema del SRI como campos de texto libre — su contenido es determinado libremente por el Responsable.

El Encargado no trata ninguna otra categoría de datos de los interesados, ni los utiliza para fines distintos a los instruidos por el Responsable.

**Catálogos de clientes y proveedores.** Cuando el Responsable guarda perfiles de sus clientes o proveedores para reutilizarlos en comprobantes, órdenes y compras, el Encargado almacena las mismas categorías de datos indicadas arriba de forma independiente al comprobante.

El catálogo de productos o servicios, el inventario y las órdenes que el Responsable registra en el Servicio constituyen información propia del negocio del Responsable, no datos personales de un interesado, por lo que no forma parte del objeto de este DPA; su tratamiento se rige por los Términos de Servicio y la Política de Privacidad.

## 4. Obligaciones del Encargado

El Encargado se compromete a:

1. Tratar los datos únicamente conforme a las instrucciones documentadas del Responsable (incluyendo las transmitidas mediante el uso normal del Servicio).
2. Garantizar la confidencialidad del personal con acceso a los datos.
3. Implementar medidas técnicas y organizativas apropiadas para proteger los datos personales tratados. Estas medidas se describen de manera general, a título informativo, en la Política de Privacidad de Comprobify, sección 5.
4. Notificar al Responsable sin demora indebida ante cualquier vulneración de seguridad que afecte los datos personales tratados por su cuenta, tan pronto como tenga conocimiento de ella.
5. Realizar transferencias internacionales de datos únicamente cuando sean necesarias para la prestación del Servicio y mediante los subencargados identificados en la sección 6.
6. Asistir al Responsable, en la medida de lo razonable, para que este pueda atender solicitudes de los interesados respecto de sus derechos bajo la LOPDP.
7. Suprimir o devolver los datos personales al Responsable, cuando este así lo solicite y ello sea técnica y legalmente posible, sin perjuicio de los casos en que el Encargado deba conservarlos para cumplir obligaciones legales, fiscales, de auditoría o seguridad.

## 5. Declaración del Responsable

El Responsable declara que cuenta con una base legal para el tratamiento de los datos personales que remite al Encargado, y que ha cumplido con las obligaciones que le corresponden conforme a la legislación aplicable. El Responsable es el único responsable de la exactitud, licitud y actualidad de los datos personales enviados al Servicio.

## 6. Subencargados

El Responsable autoriza el uso de los siguientes subencargados, ya en operación al momento de la aceptación de este DPA:

| Subencargado | Finalidad | Aplica a |
|---|---|---|
| DigitalOcean | Infraestructura y alojamiento del Servicio | Todos los clientes |
| DigitalOcean Managed Postgres | Base de datos del Servicio | Todos los clientes |
| Cloudflare | Proxy inverso, red de entrega de contenido (CDN) y protección contra ataques para el tráfico hacia el Servicio; el contenido de las solicitudes puede ser procesado de forma transitoria durante el tránsito | Todos los clientes |
| Mailgun | Envío de correos transaccionales | Todos los clientes |
| Sentry | Monitoreo y diagnóstico de errores | Todos los clientes |
| Betterstack | Plataforma de registro (logging) para monitoreo operativo y diagnóstico de errores | Todos los clientes |
| SRI | Recepción obligatoria de comprobantes electrónicos conforme a la normativa ecuatoriana | Todos los clientes |

Algunos subencargados pueden procesar datos personales fuera del territorio ecuatoriano. Comprobify selecciona y procura mantener proveedores que implementen medidas de seguridad apropiadas para la protección de los datos personales.

El Responsable autoriza las transferencias internacionales de datos que resulten necesarias para la prestación del Servicio mediante los subencargados identificados en este DPA.

El Encargado notificará al Responsable con razonable antelación antes de incorporar un nuevo subencargado, indicando expresamente si dicha incorporación implica una nueva transferencia internacional de datos. La lista de subencargados podrá actualizarse cuando resulte necesario para la prestación del Servicio, conforme a lo dispuesto en esta sección.

## 7. Retención y eliminación al término de la relación con Comprobify

El Servicio almacena los datos relacionados con comprobantes electrónicos (facturas, notas de crédito y documentos similares) autorizados por el Servicio de Rentas Internas ("SRI"), así como los metadatos de su firma, transmisión y autorización. El Servicio también almacena, de forma independiente al comprobante, los catálogos de clientes y proveedores descritos en la sección 3. Fuera de estos dos contextos, el Servicio no almacena datos de los compradores del Responsable.

Los datos contenidos en comprobantes electrónicos autorizados por el SRI están sujetos al período de conservación obligatorio establecido por la normativa tributaria ecuatoriana — en particular el Código Tributario y el Reglamento de Comprobantes de Venta, Retención y Documentos Complementarios. **Durante dicho período — que conforme al Art. 55 del Código Tributario es de cinco (5) años en los casos ordinarios y de siete (7) años cuando la declaración no fue presentada o fue presentada de forma incompleta; se recomienda conservar durante el plazo mayor como medida prudente —, el Encargado no eliminará estos datos, incluso ante una solicitud del Responsable.** Esta limitación se fundamenta en la obligación legal del Encargado de conservar documentos tributarios durante el período de prescripción de las obligaciones tributarias (Art. 15 LOPDP — limitación del derecho de supresión por obligación legal).

**Los catálogos de clientes y proveedores no están sujetos a esta limitación.** A diferencia de los datos ya incorporados en un comprobante autorizado, una entrada de estos catálogos no constituye por sí misma un documento tributario — el Responsable puede eliminarla directamente desde el Servicio en cualquier momento, conforme a la obligación establecida en la sección 4(7), sin las restricciones aplicables a los datos de comprobantes ya autorizados.

Para los datos del Responsable que no formen parte de comprobantes electrónicos autorizados (datos de cuenta, metadatos de registro), el Encargado atenderá solicitudes de supresión conforme a la obligación establecida en la sección 4(7), una vez que no existan obligaciones legales que requieran su conservación.

## 8. Auditoría

El Encargado pondrá a disposición del Responsable información razonable que demuestre el cumplimiento de las obligaciones establecidas en este DPA, sin que ello implique acceso directo a la infraestructura, código fuente, ni información de otros clientes del Encargado.

## 9. Responsabilidad

La responsabilidad de las partes bajo este DPA se rige por lo dispuesto en los Términos de Servicio.

## 10. Vigencia y aceptación

Este DPA forma parte integrante de la relación entre el Responsable y Comprobify y requiere aceptación expresa, independiente de la aceptación de los Términos de Servicio, según lo descrito en la sección 1 de dichos Términos. Permanecerá vigente mientras el Responsable mantenga una cuenta activa en el Servicio, y se entiende automáticamente terminado al darse de baja dicha cuenta, sin perjuicio de las obligaciones de confidencialidad y de las descritas en la sección 7 que sobrevivan a la terminación.
