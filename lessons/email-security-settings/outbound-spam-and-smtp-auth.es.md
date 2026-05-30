---
title: "Spam saliente y SMTP AUTH — controlando el radio de impacto cuando el cliente es el atacante"
subtitle: "Límites de envío saliente, respuesta automática de Restricted Users y desactivación de SMTP AUTH para contener rápido un buzón comprometido."
icon: "send"
last_updated: 2026-05-29
---

# Spam saliente y SMTP AUTH — controlando el radio de impacto cuando el cliente es el atacante

La socia senior de un pequeño despacho contable cae en un phishing a las 7:14 AM de un miércoles. Estilo AiTM: inicia sesión en lo que parece la página de Microsoft en el móvil antes del primer café. A las 7:22, el atacante tiene la cookie de sesión y está dentro de su buzón.

A las 7:35 el atacante empieza a enviar. El script es automatizado y ambicioso. La socia tiene 1 847 contactos en su libreta de direcciones — clientes, proveedores, colegas, amigos, familia, listas de distribución de la red contable. El atacante envía a cada uno un mensaje idéntico: «Disculpa la urgencia — por favor revisa este archivo confidencial: [enlace a una captura de credenciales con marca del despacho]». 1 847 mensajes salientes a lo largo de unos noventa minutos.

A las 8:53 AM el atacante alcanza un límite de mensajes salientes. El tenant del cliente cambia la cuenta de la socia al estado Restricted Users. El correo saliente de su buzón se para. Un correo de alerta llega al contacto IT del cliente (el MSP) diciendo «El usuario X ha sido restringido de enviar correo saliente por sospecha de compromiso».

El de guardia del MSP ve la alerta a las 8:54 AM. A las 9:10 ha revocado sesiones, restablecido credenciales, confirmado el compromiso, bloqueado la cuenta y arrancado la respuesta a incidentes. El daño en este punto: aproximadamente 1 800 correos de phishing enviados. Malo — pero acotado. Aproximadamente 150 de los destinatarios hicieron clic en el enlace (tasa típica de clic de phishing); aproximadamente 25 introdujeron credenciales (tasa típica de seguimiento). El MSP pasa un miércoles largo corriendo respuesta a incidentes complementaria con las organizaciones y los equipos de IT de esos destinatarios.

Ahora imagina el mismo escenario sin el límite de salida. El atacante sigue enviando. Cuando alguien lo nota — quizá esa noche, cuando la socia vuelve de sus reuniones con clientes de la mañana y comprueba su carpeta de enviados — el atacante ha enviado 18 000 mensajes. El dominio primario del cliente ha sido listado en tres listas de bloqueo de spam importantes. Microsoft ha suspendido el correo saliente para toda la organización a nivel tenant. El MSP pasa la siguiente semana sacando al cliente de listas de bloqueo, restaurando la entregabilidad para todo el tenant, y explicando a los equipos de IT de los 18 000 destinatarios por qué fueron phisheados desde un dominio ahora contaminado.

Este es el problema del radio de impacto post-compromiso, y la política de spam saliente es el tope.

## La política de spam saliente de Microsoft — qué controla

La política de spam saliente en Defender (Threat policies → Anti-spam → Outbound spam) gobierna lo que pasa cuando un buzón en el tenant está enviando más correo saliente del que su línea base debería producir. Tres controles de umbral:

- **Límite de mensajes externos por hora.** Cuántos mensajes a destinatarios fuera de la organización puede enviar un solo buzón en una hora. El valor por defecto de Microsoft es 500. La mayoría de los buzones legítimos nunca lo alcanzan; los buzones comprometidos corriendo scripts de phishing lo alcanzan en veinte minutos.
- **Límite de mensajes internos por hora.** Cuántos mensajes a destinatarios internos por hora. Por defecto 1000.
- **Límite diario de mensajes por buzón.** Total de mensajes por día entre internos y externos. Por defecto 10 000 para la mayoría de los tenants.

Tres opciones de acción cuando se excede un límite:

- **Solo alertar a admins.** Las notificaciones salen; el usuario sigue enviando. Útil para configuraciones de solo-visibilidad; inútil como control del radio de impacto.
- **Restringir al usuario de enviar correo.** El usuario se añade a una lista de Restricted Users. El correo saliente de su buzón se bloquea a nivel tenant. Aún puede recibir correo; aún puede iniciar sesión; simplemente no puede enviar.
- **Sin acción.** El valor por defecto de algunos tenants más antiguos. Microsoft endureció esto en tenants más nuevos pero las configuraciones heredadas aún pueden estar en Sin acción.

El ajuste protector es **Restringir al usuario de enviar correo**, con alertas yendo al contacto IT del cliente (típicamente el buzón compartido del MSP). Cuando se dispara, la alerta es la señal de aviso temprano de que es probable que una cuenta esté comprometida; la restricción es el tope sobre cuánto daño se hace antes de que el operador pueda responder.

## La autoliberación a 24 horas — fricción por diseño

Cuando un usuario está restringido, se queda restringido hasta que pase una de dos cosas:

1. **Un admin lo quita manualmente de la lista de Restricted Users** (portal de Defender → Email & collaboration → Review → Restricted users; o vía PowerShell con `Remove-BlockedSenderAddress`).
2. **La autoliberación a 24 horas se dispara** y Microsoft lo quita automáticamente.

La autoliberación a 24 horas es la red de seguridad para los falsos positivos. Si un remitente legítimo de alto volumen alcanza el límite, no se queda fuera de línea para siempre — espera hasta el día siguiente. Para compromisos genuinos, la restricción aguanta el tiempo que el MSP necesita para investigar; para falsos positivos, se autorresuelve.

El ajuste de seguridad de Panoptica365 «Configure Anti-Spam Outbound Policy (Restrict Compromised Accounts)» empuja esta configuración: la acción puesta en «Restringir al usuario», destinatarios de alerta apuntados a la dirección correcta, la autoliberación a 24 horas activada. El detector de deriva vigila si la acción se mantiene en Restringir. Que alguien la cambie a «Solo alertar a admins» — típicamente en respuesta a un ticket de falso positivo — dispara la alerta de deriva.

## Afinado de umbrales — la conversación sobre volumen legítimo

Los umbrales por defecto (500 externos/hora, 1000 internos/hora, 10000 diarios) son generosos para la mayoría de los tenants de pequeña empresa. Algunos remitentes legítimos sí los alcanzan, no obstante, y el afinado necesita ser una conversación deliberada:

- **Remitentes de marketing / listas de distribución.** El CRM del cliente o la plataforma de marketing enviando campañas legítimas de alto volumen desde un buzón del tenant.
- **Automatización de atención al cliente.** Autorrespondedores, notificaciones de tickets, confirmaciones de cuenta enviadas desde un buzón de servicio.
- **Boletines internos.** Un equipo de comunicaciones enviando una actualización semanal a todo el personal a 500 destinatarios internos.

Para cada uno, la respuesta correcta normalmente *no* es «sube el umbral global». Es o bien:

- **Mover al remitente legítimo de alto volumen a un mecanismo de transporte diferente** (Microsoft tiene servicios dedicados de correo masivo; una plataforma de correo de terceros vía conector autenticado; etc.) para que el buzón del tenant no sea el que envía.
- **Crear una política de spam saliente personalizada** acotada al buzón específico (o grupo) con umbrales más altos, mientras se mantiene la política por defecto estricta para todos los demás.

No subas el umbral para todo el tenant solo porque un buzón tenga un caso de uso legítimo. Eso hace el tope del radio de impacto inútil para los otros 31 buzones del tenant.

## Envío SMTP AUTH — la puerta trasera heredada

Aparte de la política de spam saliente, M365 tiene otro vector que vale la pena cerrar: el **envío SMTP AUTH**.

El envío SMTP AUTH es el protocolo que deja a una aplicación o dispositivo autenticarse a `smtp.office365.com:587` con un usuario y contraseña y enviar correo a través de M365 como ese usuario. Lleva existiendo desde siempre. Las impresoras multifunción heredadas lo usan para escanear-a-correo. Las aplicaciones de línea de negocio viejas lo usan para enviar notificaciones. Los scripts personalizados lo usan para enviar correos de informe.

También es un sueño de credential stuffing. El envío SMTP AUTH usa **autenticación básica** — usuario y contraseña, sin MFA, sin Acceso Condicional en la mayoría de las configuraciones. Un atacante con la contraseña del usuario (de una lista de credential stuffing o de un phishing que no pilló la cookie de sesión) puede autenticarse a SMTP AUTH y enviar correo como el usuario, saltándose todas las defensas de auth modernas.

Microsoft lleva años deprecando Basic Auth en todos los protocolos heredados (IMAP, POP, EWS, MAPI/RPC, Remote PowerShell). El envío SMTP AUTH fue el último reducto porque tantos dispositivos y apps heredadas dependen de él. A partir de 2025–2026, Microsoft ha estado deshabilitando el envío SMTP AUTH por defecto para tenants nuevos, pero los tenants más antiguos y los tenants que lo habilitaron explícitamente aún pueden tenerlo activo.

El ajuste de seguridad de Panoptica365 «Disable Basic Auth for SMTP AUTH Submission» empuja `Set-TransportConfig -SmtpClientAuthenticationDisabled $true` a nivel tenant. El detector de deriva vigila si se mantiene deshabilitado.

## La conversación sobre el caso de uso heredado

Cuando empujas el bloqueo a nivel tenant, puedes romper flujos legítimos. Encuéntralos durante el chequeo previo (el trabajo de «auditar el estado actual» de la lección 1), no después del despliegue.

Usuarios habituales de SMTP AUTH heredados:

- **Impresoras multifunción** configuradas hace años para escanear-a-correo. El arreglo suele ser reconfigurar la impresora para usar el mecanismo de *direct send* de Microsoft (SMTP no autenticado desde la IP interna de la impresora vía un conector del tenant) o actualizar el firmware de la impresora para soportar auth moderna.
- **Aplicaciones LOB heredadas** enviando notificaciones por correo. El arreglo depende del proveedor — las versiones modernas suelen soportar envío SMTP basado en OAuth vía Microsoft Graph; las versiones más antiguas pueden necesitar una contraseña por aplicación (menos seguro) o un reemplazo.
- **Scripts personalizados.** El arreglo es reescribir para usar la API `sendMail` de Microsoft Graph o Azure Communication Services. Los scripts suelen ser puntuales y fáciles de actualizar.
- **Buzones de servicio específicos que el cliente no puede migrar fácilmente.** Como último recurso, el envío SMTP AUTH puede habilitarse por buzón mientras permanece deshabilitado a nivel tenant (`Set-CASMailbox <usuario> -SmtpClientAuthenticationDisabled $false`). Documenta la excepción; revísala anualmente; planifica la eventual migración.

Evita el atajo tentador de dejar SMTP AUTH habilitado a nivel tenant solo porque una impresora lo necesita. Eso reabre la puerta trasera para todos. La anulación por buzón existe exactamente para este caso.

## Qué ve Panoptica365

Dos ajustes de seguridad en la lista de la categoría Exchange:

**«Configure Anti-Spam Outbound Policy (Restrict Compromised Accounts)».** Panoptica365 vigila la propiedad de acción de la política de spam saliente. El valor recomendado es «Restringir al usuario de enviar correo» con la autoliberación a 24 horas activada. La deriva se dispara si la acción cambia o las alertas se deshabilitan.

**«Disable Basic Auth for SMTP AUTH Submission».** Panoptica365 vigila la propiedad `SmtpClientAuthenticationDisabled` de la config de transporte del tenant. El valor recomendado es `$true` (deshabilitado). La deriva se dispara si SMTP AUTH se vuelve a habilitar a nivel tenant.

Más allá de la deriva, el **motor de alertas** ingiere los eventos de restricción de spam saliente de Microsoft cuando se disparan — un evento de usuario-restringido es uno de los indicadores de compromiso de mayor señal que Microsoft expone, y Panoptica365 lo reenvía por el pipeline estándar de alertas para que no se pierda en la avalancha de notificaciones de Microsoft.

Lo que Panoptica365 *no* expone en el panel: historial de actividad SMTP AUTH por buzón, un navegador de Restricted Users, un historial de límite de tasa saliente por buzón. Eso vive en la superficie de revisión de restricted users del portal de Defender y en los registros de auditoría de Microsoft.

## Qué se puede romper

**Un remitente legítimo alcanza el límite saliente y se le restringe.** El comercial en un día de campaña grande; la persona de marketing enviando un boletín puntual desde su propio buzón; la persona de comunicaciones enviando la carta anual del empleado. El usuario llama en pánico. El arreglo es o bien quitarlo de Restricted Users manualmente (y avisarle sobre el mecanismo apropiado de correo masivo) o esperar a que pase la autoliberación a 24 horas. Afina para los patrones de volumen legítimo del cliente durante la incorporación.

**La impresora deja de escanear-a-correo tras deshabilitar SMTP AUTH.** Habitual. El arreglo es direct-send vía conector del tenant (preferido), actualización de firmware de la impresora a auth moderna (funciona para modelos más nuevos), o anulación SMTP AUTH por buzón para la cuenta de servicio de la impresora como último recurso.

**Las notificaciones por correo de trabajos de copia de seguridad dejan de funcionar.** Algún software de copia de seguridad heredado usa SMTP AUTH para correos de estado. Moderniza vía SMTP basado en OAuth (si el proveedor lo soporta) o migra el mecanismo de notificación.

**Restricción de falso positivo durante un pico legítimo.** Un lanzamiento de producto nuevo, un anuncio importante al cliente, una comunicación de emergencia — estos pueden parecer brevemente comportamiento de cuenta comprometida. Pon el escenario específico en lista blanca, quita manualmente de Restricted Users, documenta en el runbook para el año siguiente.

## Lo que esto significa para el operador

Tres puntos para llevarte.

**El límite saliente es el tope del radio de impacto.** Cuando ocurra un compromiso — y eventualmente ocurrirá en cada cliente — la diferencia entre 1 800 phishing salientes y 18 000 es la acción Restringir de la política de spam saliente. Ponla. Confirma que las alertas se enrutan a tu buzón compartido. La autoliberación a 24 horas es tu red de seguridad para falsos positivos; no es razón para debilitar la acción.

**El envío SMTP AUTH es el camino de auth heredado que sobrevivió a los otros — deshabilítalo.** La auth moderna ha sido el estándar durante años; SMTP AUTH es el último agujero. Deshabilítalo a nivel tenant, identifica los flujos heredados que necesitan excepciones durante el chequeo previo, arréglalos como toca (direct send, envío OAuth, modernización de apps), y mantén las anulaciones por buzón documentadas y acotadas en el tiempo.

**La alerta de Restricted Users es el indicador de compromiso de mayor señal que Microsoft expone.** Cuando se dispara, trátala como compromiso creíble hasta que se demuestre lo contrario. Revoca sesiones, restablece credenciales, audita la actividad reciente, comprueba las reglas de bandeja de entrada y las transport rules, mira la carpeta de enviados, identifica qué se envió. La socia del despacho contable de la historia inicial mantiene sus relaciones con los clientes porque su MSP respondió dentro de la ventana de 30 minutos que compró la restricción.

## Lo que viene

- **Lección 10: Políticas de seguridad preestablecidas y operar el correo a escala.** Los paquetes Standard / Strict que unen la mayoría de los controles de la tarjeta 5 en una configuración, el modelo de detección de deriva en toda la tarjeta, y la cadencia de revisión anual.

Por ahora: abre la política de spam saliente del cliente en el portal de Defender. Verifica que la acción está puesta en «Restringir al usuario de enviar correo» con alertas de admin habilitadas. Verifica que el envío SMTP AUTH está deshabilitado a nivel tenant (`Get-TransportConfig | Select SmtpClientAuthenticationDisabled` debería devolver `True`). Identifica y arregla cualquier excepción SMTP AUTH por buzón que no esté documentada. La socia de la historia inicial no tiene su teléfono sonando todo el día un miércoles por la tarde porque el tope aguantó.

---

*Fuentes de los datos en esta lección — Microsoft Learn sobre políticas de spam saliente y límites de mensajes ([Microsoft Learn — Outbound spam policies](https://learn.microsoft.com/en-us/defender-office-365/outbound-spam-policies-configure)); flujo de revisión y eliminación de Restricted Users ([Microsoft Learn — Restricted users](https://learn.microsoft.com/en-us/defender-office-365/outbound-spam-restore-restricted-users)); visión general y deprecación del envío SMTP AUTH ([Microsoft Learn — Authenticated SMTP submission](https://learn.microsoft.com/en-us/exchange/clients-and-mobile-in-exchange-online/authenticated-client-smtp-submission)); referencia de Set-TransportConfig SmtpClientAuthenticationDisabled ([Microsoft Learn — Set-TransportConfig](https://learn.microsoft.com/en-us/powershell/module/exchange/set-transportconfig)); direct send para impresoras y escáneres ([Microsoft Learn — Submitting email using direct send](https://learn.microsoft.com/en-us/exchange/mail-flow-best-practices/how-to-set-up-a-multifunction-device-or-application-to-send-email-using-microsoft-365-or-office-365#option-2-send-mail-directly-from-your-printer-or-application-to-microsoft-365-or-office-365-direct-send-recommended)); anulación SMTP AUTH por buzón con Set-CASMailbox ([Microsoft Learn — Set-CASMailbox](https://learn.microsoft.com/en-us/powershell/module/exchange/set-casmailbox)).*
