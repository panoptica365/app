---
title: "Políticas antiphishing — la brecha de suplantación que Microsoft deja abierta por defecto"
subtitle: "Protección contra suplantación de usuario, ajuste del antispoofing y patrones BEC que los valores por defecto de Microsoft no detectan."
icon: "fish"
last_updated: 2026-05-29
---

# Políticas antiphishing — la brecha de suplantación que Microsoft deja abierta por defecto

La interventora de una empresa fabricante de 40 personas recibe un correo de su director general un martes por la tarde. Asunto: «Confidencial — pago necesario hoy». Cuerpo: «Por favor paga la factura adjunta de nuestro nuevo proveedor de equipos. Datos para la transferencia adjuntos. No metas a contabilidad todavía — te lo explico el jueves». Firmado con el bloque de despedida real del director, con el formato exacto en que se ven sus correos reales.

La interventora lee el correo en el móvil. El nombre para mostrar dice «James Wilson, CEO» — igual que cualquier otro correo del director general. Toca el adjunto, ve lo que parece una factura legítima con datos bancarios, e inicia la transferencia. 46 000 $.

La dirección de envío real — visible solo si tocas el nombre para mostrar y miras con cuidado — era `james.wilson.ceo@gmail.com`. No el dominio del cliente. Ni de lejos. Pero en el móvil, en la vista de bandeja de entrada, ves el nombre para mostrar. El nombre para mostrar decía lo correcto.

Este es el patrón de BEC más habitual en 2026 y el que la política antiphishing por defecto de Microsoft no pilla. El antispoofing sobre el propio dominio del cliente funciona bien — el atacante no está haciendo spoofing del dominio del cliente, está usando Gmail. La defensa que *sí* habría pillado esto es la **protección contra la suplantación de identidad de usuario**, y Microsoft la entrega apagada.

Esta lección trata de cerrar esa brecha.

## Las cuatro capas del antiphishing de M365 — y cuáles están encendidas

La protección antiphishing de Microsoft 365 son cuatro mecanismos distintos viviendo bajo el mismo paraguas de política. La mayoría de los operadores los tratan como una sola funcionalidad. No lo son. Saber cuál es cuál es la clave del juego.

**Antispoofing.** Pilla correo que *afirma venir del propio dominio del cliente* pero que falló la autenticación SPF / DKIM / DMARC. Por defecto: **encendido**. Este es el suelo básico — si alguien envía un mensaje falsificado afirmando ser `ceo@cliente.com` desde un servidor que no tiene nada que pintar enviando por `cliente.com`, el antispoofing lo pilla. Los valores por defecto de Microsoft son razonables aquí.

**Mailbox intelligence.** Usa el ML de Microsoft sobre el historial de comunicación del destinatario. Si un usuario nunca ha recibido correo de un remitente concreto, pero la identidad del remitente se parece a la de alguien con quien SÍ se comunica habitualmente, la mailbox intelligence lo marca. Por defecto: **encendido con consejo de seguridad de primer contacto**, pero las *acciones de aplicación* (mover a correo no deseado, cuarentena) normalmente están configuradas en posición de **Apagado** hasta que afines la política.

**Protección contra la suplantación de identidad de usuario.** Especificas «usuarios protegidos» — típicamente el director general, el director financiero, la interventora, cualquiera a quien plausiblemente se le pueda pedir transferir dinero. La política entonces marca el correo de remitentes cuyo nombre para mostrar coincide estrechamente con uno de esos usuarios protegidos *pero cuya dirección de envío no*. Por defecto: **apagado**. Esta es la brecha de la historia inicial.

**Protección contra la suplantación de dominio.** Especificas «dominios protegidos» — típicamente el dominio o los dominios del propio cliente y cualquier dominio de socios o proveedores con los que el cliente transacciona rutinariamente. La política marca dominios parecidos (`trilogiam.com` vs `trilogiam-corp.com`, `cliente.com` vs `cliente.co`, los clásicos ataques de homoglifo donde una «а» cirílica reemplaza una «a» latina). Por defecto: **apagado**.

Dos de cuatro. Encendidas por defecto: las dos que pillan los ataques fáciles. Apagadas por defecto: las dos que pillan los ataques en los que los clientes de pequeña empresa realmente caen.

## El patrón de remitentes de confianza — lo que los clientes piden de verdad

Vas a recibir este ticket. Probablemente esta semana:

> «Para de que vuestro antiphishing nos bloquee los correos de nuestro socio ABC Corp. Necesitamos que nos lleguen sus facturas».

**Antes de tocar un solo ajuste, comprueba la autenticación del correo del remitente.** En el correo hace falta bailar de dos en dos — y la mayor parte de las veces, la pareja de baile lleva pasos perdidos.

Abre una herramienta de consulta DNS. La que recomendamos para este tipo de trabajo es [DomainGuardian](https://domainguardian.nebiatek.com/) — un comprobador visual y limpio construido por un colega de la comunidad de ciberseguridad de Quebec. Pega un dominio, obtienes un desglose codificado por colores de SPF, DKIM, DMARC, MX y registros relacionados con banderas claras sobre lo que está bien y lo que está roto. Diseñado para técnicos de nivel L1 que no deberían tener que memorizar la sintaxis de `dig` para hacer su trabajo. (Los operadores de línea de comandos pueden seguir tirando de `dig` o `nslookup` si para ellos es más rápido.)

Comprueba `abccorp.com` para:

- **SPF.** ¿Hay un registro TXT que empieza con `v=spf1`? ¿Incluye las IPs o servicios desde los que ABC Corp realmente envía? Fallo habitual: SPF existe pero termina en `~all` (soft-fail) o `+all` (permitir todo — básicamente roto).
- **DKIM.** ¿Hay un registro de selector DKIM publicado? Prueba selectores habituales (`default._domainkey`, `selector1._domainkey`, `s1._domainkey`, además de los selectores específicos para Microsoft 365, Google Workspace, Mailchimp o lo que sea por lo que envíen de verdad).
- **DMARC.** ¿Hay un registro TXT en `_dmarc.abccorp.com`? ¿Cuál es la política — `p=none`, `p=quarantine`, `p=reject`? ¿Están puestos `aspf` y `adkim`?

En una buena parte de estos tickets — cómodamente la mayoría del correo de pequeña empresa a pequeña empresa — el remitente tiene SPF configurado (a menudo medio configurado), nada de DKIM y nada de DMARC. Desde la perspectiva de Microsoft, el correo se parece exactamente al tipo de correo que enviaría un atacante: mal autenticado, a veces fallando la alineación, sin política del dominio del remitente que diga a los receptores qué hacer con él. La cuarentena no es un bug — es Microsoft haciendo exactamente lo que quieres que haga.

El primer movimiento es la conversación, no la excepción:

> «La autenticación de correo de ABC Corp está mal configurada — concretamente, no tienen DKIM ni DMARC publicados. Por eso sus correos se están marcando. El arreglo está en *su* lado: su equipo de IT necesita publicar firma DKIM y un registro DMARC. Una vez que lo hagan, Microsoft confiará en su correo y no nos hará falta excepción ninguna. ¿Puedes contactar con tu contacto en ABC Corp y pedirle que su IT mire esto?».

La mitad de las veces esta conversación resuelve el problema limpiamente dentro de una semana — el IT de ABC Corp publica DKIM y DMARC, Microsoft empieza a confiar en el correo, el cliente nunca te vuelve a preguntar por esto, y el ecosistema más amplio del correo gana un escalón de salud. La otra mitad de las veces ABC Corp no puede o no quiere arreglar su autenticación (proveedor pequeño sin IT, el MSP del proveedor se encoge de hombros, el «contacto» del cliente no tiene capital político para empujar), el cliente vuelve a reportar, y *entonces* recurres a uno de dos patrones de excepción: uno correcto, uno tentador.

**La forma tentadora.** Abre el centro de administración de Exchange. Crea una regla de flujo de correo que omita el filtrado de spam para todo el correo de `*@abccorp.com`. El ticket del cliente se cierra. Mañana, el dominio de ABC Corp se compromete por un ataque de phishing y los atacantes envían facturas con malware a la interventora del cliente. La regla de flujo de correo que creaste alegremente omite cada defensa que Microsoft aplicaría de otro modo. La interventora abre el adjunto. Tú pasas el fin de semana en respuesta a incidentes.

**La forma correcta.** Abre la política antiphishing. Añade `abccorp.com` a la lista de remitentes de confianza a *nivel de política antiphishing*, acotado a *esa protección específica* (típicamente suplantación de identidad de usuario y mailbox intelligence). La entrada de remitentes de confianza le dice a la política antiphishing «los mensajes de este dominio no deberían disparar marcas de suplantación». El filtrado de spam, el escaneo de malware, Safe Links, Safe Attachments — todo eso sigue aplicándose. Si el dominio de ABC Corp se compromete mañana, el malware en sus facturas lo pilla Safe Attachments antes de que llegue a la bandeja de la interventora.

La diferencia entre los dos enfoques es el radio de impacto cuando el remitente de confianza luego se ve comprometido. Los clientes no piensan en esa parte. Tú tienes que pensarla.

## Configurando la protección contra la suplantación de identidad de usuario — la parte práctica

Para un cliente típico de pequeña empresa, la configuración es directa y la disciplina está en saber *a quién* proteger.

**A quién proteger.** Cualquiera en una posición en la que suplantarlo llevaría a un destinatario a enviar dinero, compartir credenciales o conceder acceso. Lista real:

- El director general, el director financiero y cualquier nivel C
- La interventora, el jefe de finanzas, el jefe de contabilidad
- El jefe de RR. HH. (estafas de W-2 / nómina)
- El jefe de IT (peticiones de credenciales y acceso)
- El propietario / fundador / socio (empresas pequeñas)

Una empresa de 40 personas puede tener entre 5 y 8 usuarios protegidos. Una empresa de 200 personas puede tener entre 12 y 20. No intentes proteger a todo el mundo — la política se vuelve ruidosa y el equipo de operadores pierde señal.

Para cada usuario protegido, la política necesita:

- El nombre para mostrar del usuario (exactamente como aparece en Entra ID)
- La dirección de correo del usuario (típicamente `nombre.apellido@cliente.com`)

La política marca cualquier mensaje entrante cuyo nombre para mostrar del remitente coincida estrechamente con un nombre para mostrar protegido O cuya dirección del remitente coincida estrechamente con una dirección protegida — pero el remitente no es en realidad ese usuario. La anécdota inicial (`james.wilson.ceo@gmail.com` con nombre para mostrar «James Wilson, CEO») se pilla porque el nombre para mostrar coincide con un usuario protegido pero la dirección no.

**Qué hacer cuando se marca.** Tres opciones: mover a correo no deseado, cuarentena o «entregar y añadir consejo de seguridad». Para clientes de pequeña empresa, **cuarentena** suele ser la opción correcta. La opción del consejo de seguridad asume que los usuarios leen los consejos de seguridad; muchos no lo hacen. Correo no deseado deja al usuario liberar el mensaje él mismo; para marcas de suplantación de alta confianza, no quieres que el usuario tome esa decisión. La cuarentena enruta por el flujo del operador.

## Configurando la protección contra la suplantación de dominio

Misma idea, acotada a dominios.

**Dominios a proteger:**

- El dominio de correo primario del cliente (siempre)
- Cualquier otro dominio de correo que el cliente use activamente
- Los dominios clave de socios/proveedores con los que transacciona el cliente (los 10–20 principales por volumen de transacción)

La política marca el correo entrante de dominios visualmente similares a uno de los dominios protegidos. El caso clásico: el cliente es `acme.com`, el atacante registra `acne.com` o `acrne.com` (donde la «r» y la «n» juntas se ven como una «m» en la pantalla del móvil) o `аcme.com` (con una «а» cirílica). Los tres se pillan.

La elección de la acción al marcar (mover a correo no deseado, cuarentena, consejo de seguridad) sigue la misma lógica que la suplantación de usuario. Cuarentena suele ser lo correcto para pequeña empresa.

## Spoof intelligence — la cola manejable

La spoof intelligence de Microsoft es la inversa de la protección contra suplantación. Donde la suplantación pilla remitentes *ilegítimos* intentando parecerse a *legítimos*, la spoof intelligence se ocupa de los remitentes *legítimos* que fallan la autenticación por razones aburridas de infraestructura.

El caso más habitual: el cliente usa un servicio de terceros (una plataforma de marketing, un emisor de correos de una herramienta de RR. HH., un proveedor de encuestas) que envía «desde» el dominio del cliente pero no tiene la autorización SPF / DKIM adecuada. El antispoofing de Microsoft quiere bloquear esto; la spoof intelligence te permite revisar los remitentes, permitir los legítimos y bloquear los que son realmente atacantes.

Esto es la superficie de «Tenant Allow/Block Lists» en el portal de Defender. La disciplina del operador:

- Revisar mensualmente la información de spoof intelligence
- Para cada remitente no-autenticado-pero-legítimo (plataforma de marketing, proveedor de nóminas, etc.), añadir una entrada de permitir explícita
- Para cada remitente no-autenticado-e-ilegítimo, añadir un bloqueo explícito
- Decir al equipo de marketing del cliente que arregle su configuración de SPF / DKIM para no tener que seguir añadiendo permisos

## La alternativa de las políticas de seguridad preestablecidas

Para clientes en los que no quieres afinar a mano la política antiphishing, las **políticas de seguridad preestablecidas** de Microsoft (Standard y Strict, cubiertas en detalle en la lección 10) incluyen reglas antiphishing preconfiguradas. La preestablecida Standard habilita la protección contra suplantación de identidad de usuario con valores por defecto sensatos; la Strict sube las perillas.

El compromiso del enfoque preestablecido: obtienes la configuración curada de Microsoft, pierdes control granular sobre umbrales y listas de remitentes de confianza. Para la mayoría de los clientes de pequeña empresa, este es el compromiso correcto. Para clientes con necesidades específicas de suplantación (muchos usuarios protegidos, excepciones complejas de remitentes de confianza), una política personalizada te da la flexibilidad.

En la práctica: despliega una preestablecida (Standard para la mayoría; Strict para clientes de mayor riesgo como despachos contables o bufetes) como *fundamento*, luego pon encima una política antiphishing personalizada *con prioridad más alta* para los usuarios protegidos específicos del cliente y los remitentes de confianza. Este patrón mantiene los valores por defecto curados por Microsoft como suelo y te deja personalizar donde importa.

## Qué se puede romper

**El correo del ejecutivo del cliente hacia sí mismo se va a cuarentena.** Cuando el director envía un correo a su propia asistente desde su Gmail personal y el nombre para mostrar coincide con la lista de usuarios protegidos, la protección contra suplantación lo pilla. El arreglo es o bien añadir la dirección personal del ejecutivo a la lista de remitentes de confianza o bien que el ejecutivo use su cuenta de trabajo para el correo de trabajo (la respuesta correcta).

**Proveedores legítimos con mala higiene de correo se bloquean.** Un proveedor pequeño sin DMARC, SPF descuadrado y la manía de enviar desde direcciones IP aleatorias va a tropezar con varios chequeos antiphishing. Añadirlos a remitentes de confianza lo resuelve; idealmente el proveedor arregla su autenticación, pero esa es una conversación lenta.

**Plataformas de marketing enviando bajo el dominio del cliente.** Si el equipo de marketing del cliente usa HubSpot, Mailchimp, Marketo o similares para enviar bajo el dominio del cliente sin la autorización SPF / DKIM adecuada, esos correos fallan el antispoofing y los pilla la suplantación cuando el nombre para mostrar coincide con un usuario protegido. El arreglo es o bien configuración de autenticación en la plataforma de marketing (respuesta correcta) o bien entradas de remitentes de confianza (workaround).

## Qué ve Panoptica365

El estado de la política antiphishing es uno de los ajustes de seguridad que Panoptica365 monitoriza por tenant. Concretamente:

- **Deriva en la habilitación de la política de seguridad preestablecida.** Si la política de seguridad preestablecida de Microsoft (Standard o Strict) se deshabilita en el tenant de un cliente — alguien abre el portal de Defender y la apaga, por error o como respuesta a una queja — el detector de deriva dispara una alerta. El operador puede revertir, reaplicar o aceptar.
- **Evaluadores del motor de alertas sobre eventos relacionados con phishing.** Cuando Defender XDR detecta un incidente con patrón de phishing en el tenant de un cliente, la alerta fluye al motor de alertas de Panoptica365, donde aparece junto a las demás alertas de seguridad con atribución al cliente.

Lo que Panoptica365 no expone hoy: el volumen de marcas de suplantación por usuario, los umbrales por política, la lista de información de spoof intelligence ni ninguna postura de phishing por buzón. Eso vive en el portal de Microsoft 365 Defender — entra ahí cuando necesites la vista de diagnóstico profundo.

## Lo que esto significa para el operador

Tres puntos para llevarte.

**La brecha de suplantación es la brecha de BEC.** El antispoofing por defecto de Microsoft pilla los ataques fáciles; la protección contra suplantación pilla los que los clientes de pequeña empresa realmente caen. Si haces una cosa por el cliente este trimestre, enciende la suplantación de identidad de usuario y de dominio con acción de cuarentena y una lista pensada de usuarios protegidos.

**Cuando un cliente te pide «dejar pasar a X», comprueba primero la autenticación de X.** Hace falta bailar de dos en dos — y la mayoría de las quejas de cuarentena se trazan al DKIM y al DMARC que le faltan al remitente, no a un filtrado demasiado agresivo del lado receptor. Empuja la conversación al remitente primero. Cuando aun así se necesite una excepción, enrútala por la lista de remitentes de confianza de la política antiphishing, acotada a la protección específica — nunca un bypass por regla de flujo de correo. El filtrado de spam, Safe Links, Safe Attachments siguen vigentes.

**La política preestablecida es un default defendible; la personalización es donde está el valor.** Despliega una preestablecida (Standard o Strict) como suelo; pon encima una política antiphishing personalizada con los usuarios protegidos y los remitentes de confianza específicos del cliente. Esto te da el afinado curado de Microsoft más la defensa específica del cliente que necesitas.

## Lo que viene

- **Lección 3: Safe Links y Safe Attachments.** Las funcionalidades de Defender for Office 365 P1 que el cliente pagó y no está usando. Dónde pillan ataques reales y dónde se quedan cortas.
- **Lección 4: SPF, DKIM, DMARC.** El trío de autenticación que cierra el lado del spoofing de la brecha — la mitad que el antiphishing no pilla.

Por ahora: abre la política antiphishing del cliente. Enciende la suplantación de identidad de usuario. Lista los usuarios protegidos. Enciende la suplantación de dominio. Lista los dominios protegidos. Pon la acción en cuarentena. Pon encima una lista personalizada de remitentes de confianza para los socios legítimos. Este único cambio de configuración cierra el vector de BEC más habitual en pequeña empresa — el que cayó la interventora de la historia inicial.

---

*Fuentes de los datos en esta lección — Microsoft Learn sobre la configuración de la política antiphishing ([Microsoft Learn — Anti-phishing policies in EOP and MDO](https://learn.microsoft.com/en-us/defender-office-365/anti-phishing-policies-about)); protección contra la suplantación de identidad de usuario ([Microsoft Learn — Impersonation protection in anti-phishing](https://learn.microsoft.com/en-us/defender-office-365/anti-phishing-policies-mdo-configure)); spoof intelligence y las Tenant Allow/Block Lists ([Microsoft Learn — Spoof intelligence insight](https://learn.microsoft.com/en-us/defender-office-365/anti-spoofing-spoof-intelligence)); mailbox intelligence ([Microsoft Learn — Mailbox intelligence](https://learn.microsoft.com/en-us/defender-office-365/anti-phishing-mdo-impersonation-insight)); políticas de seguridad preestablecidas ([Microsoft Learn — Preset security policies](https://learn.microsoft.com/en-us/defender-office-365/preset-security-policies)).*
