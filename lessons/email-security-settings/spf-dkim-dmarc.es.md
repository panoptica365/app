---
title: "SPF, DKIM, DMARC — el trío de autenticación de correo que casi todo el mundo configura mal"
subtitle: "Cómo SPF, DKIM y DMARC detienen el spoofing de dominio — y por qué p=none equivale a no tener ninguna política."
icon: "shield-check"
last_updated: 2026-05-29
---

# SPF, DKIM, DMARC — el trío de autenticación de correo que casi todo el mundo configura mal

Un MSP recibe una llamada en pánico de un cliente un jueves por la tarde. «Nuestro mayor cliente acaba de llamar. Recibieron un correo esta mañana que parecía venir de nuestro director financiero — instrucciones de transferencia, pago urgente a un proveedor, todo el paquete. Casi lo pagan. Las cabeceras del correo dicen que venía de nuestro dominio. ¿Cómo ha entrado el atacante en nuestro sistema?».

La respuesta es el peor tipo de respuesta: el atacante no entró en nada. Está fuera, enviando correo falsificado desde su propia infraestructura, poniendo el dominio del cliente en la cabecera `From`. El correo del cliente está bien. El director financiero del cliente está bien. El CRM y el Active Directory y la cuenta bancaria del cliente están bien.

El socio del cliente *también* ve un correo falsificado y casi le transfiere dinero al atacante. El cliente se lleva el golpe reputacional. El socio se lleva el golpe financiero. El MSP se lleva la conversación incómoda.

Este es el ataque que SPF, DKIM y DMARC existen para parar. El cliente tiene SPF. Quizá tenga DKIM. Probablemente no tiene DMARC. Aunque tenga los tres, DMARC está casi seguramente en `p=none`, que es solo observar — no hace nada para bloquear el spoof. El servidor de correo receptor (el proveedor de correo del socio) ve la autenticación fallida, no tiene política del dominio del cliente diciéndole qué hacer, y toma una decisión. A menudo la equivocada.

Esta lección trata de cerrar esa brecha honestamente. El recorrido desde «sin DMARC» o `p=none` hasta `p=reject` es el trabajo de endurecimiento del correo más consecuente que hace un MSP — y el más comúnmente saltado.

## Los tres mecanismos, distintos y complementarios

SPF, DKIM y DMARC son *tres cosas separadas* que funcionan juntas. Los operadores las confunden constantemente. Saber cuál es cuál es la base.

**SPF (Sender Policy Framework).** Un registro DNS TXT en tu dominio que lista las direcciones IP y servicios autorizados a enviar correo «desde» tu dominio. Publicado como `v=spf1 include:spf.protection.outlook.com -all` para un tenant solo M365. El servidor receptor, cuando llega un correo afirmando ser de tu dominio, comprueba la IP de envío contra tu registro SPF publicado. Si la IP no está autorizada, SPF falla.

**DKIM (DomainKeys Identified Mail).** Una firma criptográfica añadida al correo saliente por el servidor de envío, usando una clave privada. La clave pública correspondiente se publica en DNS como un registro TXT en un subdominio de selector (p. ej., `selector1._domainkey.cliente.com`). El servidor receptor recupera la clave pública, verifica la firma contra el cuerpo del mensaje. Si la firma es válida, el correo demuestra que fue enviado por un sistema autorizado *y* no ha sido manipulado en tránsito.

**DMARC (Domain-based Message Authentication, Reporting, and Conformance).** Un registro DNS TXT en `_dmarc.cliente.com` que le dice a los servidores receptores qué hacer cuando SPF o DKIM fallan. Tres políticas: `p=none` (no hagas nada — solo envíame un informe), `p=quarantine` (trátalo como sospechoso — carpeta de correo no deseado), `p=reject` (rechaza el mensaje directamente — rebote). Más un destino de informes — una dirección de correo que recibe informes agregados diarios de cada servidor intentando enviar bajo tu dominio.

Tres cosas en capas:
- SPF pregunta «¿la IP de envío está autorizada a enviar por este dominio?».
- DKIM pregunta «¿el mensaje está criptográficamente firmado por el dominio autorizado?».
- DMARC pregunta «si SPF o DKIM fallan, ¿qué debería hacer el receptor, y dónde debería informar?».

Un dominio solo con SPF está protegido a medias. Un dominio solo con DKIM está protegido a medias. Un dominio con ambos pero sin DMARC está *observablemente autenticado* pero el receptor aun así tiene que decidir qué hacer con los mensajes fallidos — y muchos los dejarán pasar.

## Alineación — el concepto que la mayoría de los operadores se pierde

Tanto SPF como DKIM «pasan» o «fallan», pero DMARC añade una comprobación extra crucial: **la alineación**.

**La alineación de SPF** significa que el dominio en la comprobación de SPF coincide con el dominio en la cabecera `From:` visible que ve el usuario. Los atacantes pueden autenticar desde su propio dominio (`atacante-malo.com`) y poner tu dominio en el `From:` visible. SPF pasa — para el dominio del atacante. El `From:` visible dice el tuyo. La alineación de SPF pilla este desajuste.

**La alineación de DKIM** significa que el dominio que firma el mensaje vía DKIM coincide con el dominio visible del `From:`. Misma lógica — un atacante puede firmar con DKIM con su propio dominio mientras falsifica el `From:` visible. La alineación de DKIM pilla el desajuste.

DMARC exige *al menos uno de SPF o DKIM pase con alineación*. Que ambos pasen pero sin alineación sigue siendo un fallo de DMARC. El receptor entonces aplica tu política DMARC (`p=quarantine` o `p=reject`).

Esta es la parte que los operadores se pierden. Un dominio puede tener un registro SPF válido Y DKIM válido y aun así ser falsificable porque nada exige la alineación. DMARC la exige.

## El recorrido — de p=none a p=quarantine a p=reject

Casi cada recorrido DMARC de un cliente de pequeña empresa se ve así:

**Etapa 0 — Sin DMARC en absoluto.** La mayoría de los dominios. El receptor recibe SPF/DKIM fallidos y decide por su cuenta (normalmente deja pasar el correo porque rechazar se siente desagradable). El cliente es totalmente falsificable.

**Etapa 1 — DMARC publicado en p=none.** El cliente tiene *observabilidad* — informes agregados diarios te dicen quién envía bajo tu dominio, desde dónde, con qué estado de autenticación. Pero la política sigue diciendo «no hagas nada», así que el spoofing sigue funcionando. Aquí es donde viven el 80 % de los dominios con DMARC, a menudo durante años.

**Etapa 2 — DMARC en p=quarantine.** El correo con autenticación fallida va a la carpeta de correo no deseado del destinatario. El correo falsificado de la mayoría de los atacantes no llega a la bandeja de entrada. Algunos usuarios igualmente lo encuentran en correo no deseado y actúan; ese es un radio de impacto más pequeño pero no cero.

**Etapa 3 — DMARC en p=reject.** El correo con autenticación fallida es rechazado por completo por el servidor receptor. El destinatario nunca lo ve; el remitente (real o atacante) recibe un rebote. El dominio del cliente ya no es falsificable desde la perspectiva del receptor.

El recorrido de la Etapa 0 a la Etapa 3 lleva semanas o meses para la mayoría de los clientes. No porque sea técnicamente difícil — los cambios de DNS son pequeños. Porque entre `p=none` y `p=reject`, tienes que encontrar a cada remitente legítimo que está autenticando mal y arreglarlo, o aceptar que serán puestos en cuarentena o rechazados.

Esta es la parte que asusta a los MSPs a quedarse en `p=none` indefinidamente. No seas ese MSP. El cliente está a un correo de ingeniería social de un incidente de transferencia fraudulenta que DMARC habría detenido.

## Diagnóstico — usando DomainGuardian

Antes de tocar nada, audita el estado actual. [DomainGuardian](https://domainguardian.nebiatek.com/) te da la vista codificada por colores para SPF / DKIM / DMARC / MX / registros relacionados, diseñada para técnicos de nivel L1 que no quieren memorizar la sintaxis de consulta de DNS.

Para cada dominio aceptado en el tenant del cliente, comprueba:

- **SPF.** ¿Existe? ¿Termina en `-all` (hard fail) o `~all` (soft fail) o `+all` (catastrófico — permitir todo)? ¿Incluye `spf.protection.outlook.com` (obligatorio para M365)? ¿Incluye cualquier otro remitente que el cliente realmente use (plataformas de marketing, proveedores de nómina, herramientas de contabilidad)? ¿El recuento de búsquedas está bajo 10 (el límite duro de SPF — supéralo y el registro se rompe)?

- **DKIM.** ¿Está DKIM habilitado para este dominio en el centro de administración de M365? ¿Están los registros CNAME correspondientes (`selector1._domainkey.cliente.com` y `selector2._domainkey.cliente.com`) publicados en DNS apuntando a los destinos de Microsoft? ¿Están resolviendo correctamente?

- **DMARC.** ¿Existe un registro TXT en `_dmarc.cliente.com`? ¿Cuál es la política (`p=none`, `p=quarantine`, `p=reject`)? ¿Hay un destino de informe agregado (`rua=mailto:...`)? ¿Están puestos `aspf` y `adkim` (modos de alineación — `r` para relajado, `s` para estricto)?

Documenta los hallazgos por dominio. La auditoría es el fundamento del recorrido.

## Configuración — los pasos prácticos

**SPF, para un tenant solo M365:**

```
v=spf1 include:spf.protection.outlook.com -all
```

Añade otros includes para terceros remitentes que use el cliente (el `include:servers.mcsv.net` de Mailchimp, el `include:sendgrid.net` de SendGrid, el `include:spf.adp.com` de ADP, etc. — cada plataforma documenta su include). Mantén el total de includes bajo 10 para no salirte del límite de búsquedas. Termina con `-all` (hard fail) para endurecimiento de producción — `~all` es una piedra intermedia, no un destino.

**DKIM, en M365:**

Abre el portal de Microsoft 365 Defender → Email & collaboration → Policies & rules → Threat policies → Email authentication settings → DKIM. Selecciona cada dominio aceptado. Microsoft muestra los dos valores CNAME que necesitas publicar en DNS. Publícalos. Espera a la propagación de DNS (normalmente bajo una hora). Conmuta la firma DKIM a *habilitada* en el portal para el dominio.

Esto hay que hacerlo **por cada dominio aceptado**. El dominio `onmicrosoft.com` del cliente tiene DKIM automático; sus dominios personalizados no lo tienen hasta que configures cada uno.

**DMARC, empezando en p=none:**

```
v=DMARC1; p=none; rua=mailto:dmarc-reports@cliente.com; aspf=r; adkim=r;
```

Publicado como un registro TXT en `_dmarc.cliente.com`. El destino `rua` debería ser un buzón que tú (o un servicio de informes DMARC) monitoricéis activamente — los informes llegan diariamente y son la mina de oro para la siguiente etapa.

**Leer los informes** es la parte difícil del recorrido. Los informes son archivos XML (uno por servidor de envío, por día). Para clientes de pequeña empresa, quieres un servicio que convierta el XML en paneles legibles que muestren quién está enviando bajo tu dominio, qué estado de autenticación tienen, y qué remitentes necesitas arreglar. El que recomendamos es [mailsec.ca](https://mailsec.ca/). Existen otras opciones (la monitorización DMARC de Postmark, Valimail, dmarcian, Mailhardener); elige una por MSP y úsala consistentemente entre clientes para que el flujo se vuelva familiar.

**Avanzando a p=quarantine:**

Una vez que hayas pasado unas semanas en `p=none` y hayas identificado (y arreglado) todos los remitentes legítimos, cambia la política:

```
v=DMARC1; p=quarantine; rua=mailto:dmarc-reports@cliente.com; aspf=r; adkim=r; pct=25;
```

El `pct=25` despliega la cuarentena al 25 % del correo con autenticación fallida. Vigila los informes durante dos semanas. Si nada legítimo se rompe, sube a `pct=50`, luego `pct=100`. Esta es la red de seguridad para sorpresas.

**Avanzando a p=reject:**

Una vez que `p=quarantine; pct=100` haya corrido limpiamente unas pocas semanas, pasa a `p=reject`. El dominio del cliente ahora es no-falsificable desde la perspectiva del receptor.

## Qué se puede romper

**Remitentes legítimos sin la autorización SPF/DKIM adecuada.** Plataformas de marketing, proveedores de nóminas, sistemas CRM, herramientas de encuestas — cualquier servicio que envíe bajo el dominio del cliente que no tenga los includes SPF apropiados o la firma DKIM. Una vez que DMARC se endurece a `p=quarantine` o `p=reject`, esos remitentes se ponen en cuarentena o se rebotan. El arreglo es específico del servicio — añadir includes SPF, configurar DKIM para el remitente de terceros, o migrar el remitente a un subdominio con su propia política DMARC.

**Campañas de marketing donde el cliente no le dijo a IT.** Un ciclo habitual: marketing prueba una plataforma de correo nueva, envía una campaña, la mitad de los destinatarios nunca la reciben porque DMARC bloqueó el correo no autenticado. Marketing se queja a IT. IT se da cuenta de que marketing lleva meses usando la plataforma. El arreglo es autenticar correctamente, no debilitar DMARC.

**Correo reenviado.** El correo reenviado a través de un intermediario (una lista de distribución, un reenviador personal) a menudo falla DMARC porque la IP del servidor de reenvío no coincide con SPF y el cuerpo del mensaje se modifica, rompiendo DKIM. Las listas de distribución modernas manejan esto vía ARC (Authenticated Received Chain) pero la infraestructura más antigua aún tropieza con DMARC.

**Límite de búsquedas SPF superado.** Los registros SPF que anidan demasiados includes (límite duro de 10 búsquedas) se vuelven inválidos. M365 solo usa un include; añade Mailchimp, ADP y Salesforce y puedes alcanzar el límite rápido. Las herramientas de aplanado de SPF (servicios de pago) colapsan los includes en listas de IP en crudo para mantenerse bajo el límite.

## Qué ve Panoptica365

SPF, DKIM y DMARC son registros DNS en el dominio del cliente — fuera del modelo de lectura de Panoptica365 centrado en el tenant M365. Panoptica365 hoy no audita los registros DNS de forma nativa; el flujo del operador es usar DomainGuardian (o una herramienta similar) para la auditoría periódica.

Lo que Panoptica365 *sí* expone que es relevante:

- **Estado de habilitación de DKIM en el tenant M365.** Conmutar DKIM «habilitado» por dominio es un ajuste de M365 — la detección de deriva de Panoptica365 puede marcar si la firma DKIM se deshabilita para un dominio que antes estaba habilitado.
- **El pipeline de alertas de Defender XDR.** Cuando MDO detecta un intento de spoofing que falló la alineación DMARC, la alerta resultante fluye al motor de alertas de Panoptica365.

Para los informes DMARC reales — los informes XML agregados diarios — los operadores se apoyan en una plataforma de monitorización DMARC de terceros; [mailsec.ca](https://mailsec.ca/) es la que recomendamos, con Postmark, Valimail, dmarcian o Mailhardener como alternativas válidas. Panoptica365 no ingiere estos hoy.

## Lo que esto significa para el operador

Tres puntos para llevarte.

**`p=none` no hace nada.** Un cliente con DMARC en `p=none` está observablemente autenticado pero operativamente desprotegido. Los receptores siguen dejando pasar el correo falsificado. El recorrido hasta `p=quarantine` y luego `p=reject` es el trabajo que hace que DMARC defienda realmente al cliente.

**La alineación es el concepto que pilla a los operadores.** SPF y DKIM pueden ambos «pasar» mientras la cabecera `From:` visible está falsificada. El requisito de alineación de DMARC es lo que hace que el trío pille realmente el spoofing que describe la anécdota inicial.

**DomainGuardian para el diagnóstico, mailsec.ca para los informes.** El trabajo de auditar el DNS es amigable para L1 con la herramienta visual adecuada. El trabajo de leer informes DMARC necesita una plataforma de informes real para la escala de pequeña empresa — los archivos XML no escalan a una cartera de 30 clientes. mailsec.ca es la que recomendamos; Postmark, Valimail, dmarcian o Mailhardener son alternativas válidas. Elige una por MSP y úsala con cada cliente.

## Lo que viene

- **Lección 5: Reenvío automático y reglas de bandeja de entrada.** El par de indicadores post-compromiso — lo que pasa después de que la autenticación y Safe Links y DMARC hayan sido saltados de alguna manera.
- **Lección 6: Auditoría de buzón.** La postura de auditoría que te da visibilidad sobre lo que pasó en un buzón después de los hechos.

Por ahora: abre DomainGuardian, pega el dominio primario del cliente, captura el resultado y recorre los hallazgos de SPF / DKIM / DMARC con el cliente. Si están en `p=none` o no tienen DMARC en absoluto, el recorrido empieza ahí. Dos o tres meses de trabajo disciplinado llevan a un cliente de la Etapa 0 a la Etapa 3. Sáltatelo y el cliente se queda a un correo de ingeniería social de la llamada de la anécdota inicial.

---

*Fuentes de los datos en esta lección — el comprobador de autenticación de correo DomainGuardian ([domainguardian.nebiatek.com](https://domainguardian.nebiatek.com/)); la plataforma de informes DMARC mailsec.ca ([mailsec.ca](https://mailsec.ca/)); Microsoft Learn sobre SPF en Microsoft 365 ([Microsoft Learn — Set up SPF](https://learn.microsoft.com/en-us/defender-office-365/email-authentication-spf-configure)); configuración de firma DKIM en M365 ([Microsoft Learn — Use DKIM to validate outbound email](https://learn.microsoft.com/en-us/defender-office-365/email-authentication-dkim-configure)); visión general y referencia de política DMARC ([Microsoft Learn — Use DMARC to validate email](https://learn.microsoft.com/en-us/defender-office-365/email-authentication-dmarc-configure)); RFC 7489 (especificación DMARC — modos de alineación y semántica de política) ([RFC 7489](https://datatracker.ietf.org/doc/html/rfc7489)); visión general de ARC (Authenticated Received Chain) para correo reenviado ([Microsoft Learn — ARC](https://learn.microsoft.com/en-us/defender-office-365/email-authentication-arc-configure)).*
