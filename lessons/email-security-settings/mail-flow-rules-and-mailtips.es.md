---
title: "Reglas de flujo de correo y MailTips — las herramientas quirúrgicas y las luces de aviso"
subtitle: "Usar las transport rules de Exchange para imponer política en el flujo de correo, y los MailTips para mostrar avisos de riesgo antes de hacer clic en Enviar."
icon: "scroll-text"
last_updated: 2026-05-29
---

# Reglas de flujo de correo y MailTips — las herramientas quirúrgicas y las luces de aviso

El responsable de IT de un cliente cae en un phishing un viernes por la tarde. Es administrador global del tenant. El atacante usa sus credenciales para iniciar sesión en el centro de administración de M365. El MFA está habilitado, pero el atacante ha capturado la cookie de sesión vía Evilginx2 — la cookie satisface la afirmación de MFA-ya-completado. El atacante tiene una ventana de una hora antes de que la sesión expire normalmente.

En esa hora el atacante crea dos transport rules:

- **Regla uno** — condición: el remitente es `interventora@cliente.com`; acción: BCC de cada mensaje a `archive-helper@protonmail.com`. El atacante va a leer en silencio cada mensaje saliente que envíe la interventora.
- **Regla dos** — condición: cualquier mensaje entrante de fuera de la organización; acción: poner la cabecera de mensaje `X-MS-Exchange-Organization-SkipSafeLinksProcessing` para evitar el envoltorio de Safe Links. El atacante va a enviar enlaces de phishing sin envolver a la interventora a partir de ahora.

La cookie de sesión expira. El desafío de MFA se dispara en el siguiente intento de inicio de sesión y el atacante no puede satisfacerlo. El usuario vuelve a su cuenta. Las credenciales funcionan bien. Nada parece raro en la superficie visible para el usuario.

Las transport rules se quedan en su sitio. Son objetos a nivel tenant. Los restablecimientos de contraseña, las revocaciones de sesión y la reinscripción de MFA no las tocan. El correo saliente de la interventora se manda con BCC a protonmail.com durante las siguientes tres semanas. El cliente está pagando al atacante para leer en silencio todo lo que escribe la directora financiera, y el cliente no lo sabe.

Este es el patrón de abuso que hace que las transport rules sean una preocupación especial. Las reglas de bandeja de entrada son por buzón, visibles para el usuario, visibles en el panel de Reglas de Bandeja de Entrada de Panoptica365 (lección 5). Las transport rules son *a nivel tenant*, invisibles para los usuarios finales, y requieren un escaneo deliberado del operador para sacarlas a la superficie.

Esta lección trata de lo que las transport rules pueden hacer legítimamente, los patrones de abuso que vigilar, y la configuración de MailTips que da a los usuarios el aviso del momento-de-la-verdad antes de enviar algo de lo que se arrepentirían.

## Lo que pueden hacer las reglas de flujo de correo — los casos de uso legítimos

Las transport rules (la marca de Microsoft para las reglas de flujo de correo) son políticas de condición-acción que corren en cada mensaje que fluye por el tenant. Viven en el centro de administración de Exchange → Mail flow → Rules y también se pueden gestionar vía PowerShell (`New-TransportRule`, `Get-TransportRule`, `Set-TransportRule`, `Remove-TransportRule`).

Las condiciones pueden coincidir prácticamente con cualquier cosa: remitente, destinatario, asunto, contenido del cuerpo, cabeceras de mensaje, nombres o tipos de adjuntos, tamaño del mensaje, dominio del remitente, si el destinatario es interno o externo, hora del día. Las acciones son igual de amplias: bloquear, redirigir, BCC, reenviar, modificar cabeceras, antepone al asunto, añadir un descargo de responsabilidad, aplicar una etiqueta de cumplimiento, poner la clasificación del mensaje, enrutar por un conector específico.

Para los operadores de pequeña empresa, los casos de uso legítimos se agrupan en un pequeño número de patrones:

**Avisos de remitente externo.** Una regla que antepone `[EXTERNO]` al asunto de cualquier mensaje entrante de fuera de la organización, o que añade un banner amarillo de descargo al principio del cuerpo. El aviso de «tu colega ha enviado esto desde fuera». Vale la pena desplegarlo en la mayoría de los clientes; es la señal visible para el usuario más barata de que un mensaje no viene del directorio interno de confianza.

**Bloqueos de adjuntos ejecutables.** Incluso con Safe Attachments en su sitio, algunos clientes quieren un bloqueo duro sobre extensiones específicas de alto riesgo (`.exe`, `.bat`, `.scr`, `.js`, `.vbs`). Una transport rule que rechaza mensajes con esos adjuntos es una capa de defensa en profundidad sobre el sandbox de Safe Attachments.

**Aplicación de la lista de bloqueo del tenant.** Dominios de remitente específicos que nunca deberían llegar al tenant — patrones de estafa conocidos, proveedores que se han vuelto deshonestos, ex-empleados intentando suplantación. Una regla que descarta o pone en cuarentena los mensajes de esos dominios.

**Descargo de responsabilidad / pie para cumplimiento.** Algunas industrias reguladas requieren texto específico en el correo saliente (descargos legales, avisos de confidencialidad). Las transport rules añaden el descargo en el gateway, así que los usuarios no tienen que acordarse.

**Listas de distribución solo internas.** Una regla que bloquea a los remitentes externos de entregar a grupos de distribución específicos (p. ej., `todos-empleados@cliente.com` no debería ser alcanzable desde fuera).

**Auto-clasificación para etiquetas de sensibilidad.** Reglas que coinciden con ciertas palabras clave o patrones de adjuntos y aplican etiquetas de Microsoft Information Protection para el DLP de aguas abajo.

Cada uno es legítimo. Ninguno de estos debería hacer que el cliente apague reflejamente las defensas de Microsoft en otro sitio — son controles aditivos.

## Los patrones de abuso del atacante — qué vigilar

La anécdota inicial cubrió dos patrones. La taxonomía completa es más amplia.

**La regla de BCC-fuera.** Condición: el remitente es un buzón de alto valor (CFO, CEO, directora financiera, jurídico). Acción: BCC a una dirección externa controlada por el atacante. Exfiltración persistente silenciosa. Sobrevive a los restablecimientos de contraseña.

**La regla de quitar cabecera.** Acción: modificar o poner una cabecera de mensaje para evitar controles posteriores. Quitar `X-MS-Exchange-Organization-SkipSafeLinksProcessing` para evadir el envoltorio de Safe Links; modificar cabeceras relacionadas con autenticación; suprimir la puntuación de spam; añadir anulaciones falsas de SCL (Spam Confidence Level).

**La regla de supresión de rebote.** Condición: el asunto contiene patrones de «No entregable» o `Fallo en la entrega del correo`; acción: eliminar silenciosamente. El atacante está enviando correos de transferencia fraudulenta desde el buzón comprometido y no quiere que los rebotes lleguen al usuario.

**La regla de redirigir-todo.** Condición: cualquier correo entrante a un destinatario específico; acción: redirigir a un buzón controlado por el atacante. Más agresivo que BCC porque el destinatario original nunca ve el mensaje en absoluto.

**La regla de borrado selectivo.** Condición: el remitente coincide con un socio de alto valor (el mayor cliente del cliente, un organismo de supervisión, un proveedor específico); acción: eliminar de la entrega o mover a una carpeta. Usada para suprimir comunicaciones que el atacante no quiere que afloren.

**La regla del caminar-lento.** Condición: el remitente coincide con una persona específica; acción: retrasar la entrega N horas. Usada para retrasar los correos del dueño legítimo para que los mensajes falsificados del atacante lleguen primero.

**El bypass de Safe Links / Safe Attachments.** Condiciones que coinciden con remitentes entrantes específicos y acciones que ponen al mensaje a saltarse el escaneo de MDO. El atacante está enviando contenido malicioso desde una dirección externa específica y quiere evadir las defensas.

La característica compartida: el atacante está usando transport rules para hacer su actividad post-compromiso *invisible al usuario* y *superviviente a los restablecimientos de credenciales*. La defensa es la detección — revisión periódica del operador de las transport rules del tenant, más alertado sobre eventos sospechosos de creación de reglas.

## El trabajo de higiene — auditando reglas existentes

La mayoría de los tenants de cliente acumulan basura de transport rules. Tres años de cambios de administradores anteriores, migraciones que trajeron reglas de dominios adquiridos, reglas específicas de proveedor creadas para problemas que ya no existen. El trabajo de inventario del chequeo previo de la lección 1 incluye «auditar las transport rules existentes»; esta es la sección que recorre la auditoría.

Para cada transport rule existente, pregunta:

- **¿Qué hace?** Lee las condiciones y acciones con cuidado. Resumen en español llano de una línea.
- **¿Por qué existe?** Mira las notas de la regla, la fecha de creación, el administrador que la modificó. Si la regla no tiene notas, ninguna modificación reciente y la creó un admin que ya no está en el cliente, eso es una bandera roja de regla rancia.
- **¿Sigue siendo necesaria?** Prueba qué pasa si se deshabilita (la mayoría de los tenants te dejan poner una regla en modo auditoría o deshabilitarla temporalmente). Si nada se rompe durante una semana, la regla es peso muerto.
- **¿Debilita alguna defensa?** Reglas que saltan Safe Links, saltan antispam, saltan antiphishing o BCC a cualquier sitio externo necesitan justificación explícita.

Documenta cada regla superviviente con su propósito. Quita la basura. De aquí en adelante, cada nueva transport rule debería tener un propósito documentado, una razón de creación en las notas de la regla, y un dueño que pueda hablar de por qué existe.

## MailTips — las luces de aviso

Aparte de las transport rules, M365 tiene **MailTips** — los pequeños avisos de la barra de información que Outlook muestra a los usuarios cuando están componiendo o respondiendo a un mensaje. El más consecuente para la defensa BEC es el aviso de **Destinatarios externos**, la barra amarilla que dice «Estás enviando este correo a destinatarios fuera de tu organización» con el dominio externo listado.

Para un usuario a punto de responder con transferencia fraudulenta a un correo de «director» falsificado viniendo de un atacante con Gmail-y-nombre-para-mostrar, esa barra amarilla es a veces el momento de pausa que evita la transferencia. No siempre. Pero es gratis, es visible para el usuario, y no cuesta nada operativamente.

Otros MailTips incluyen:

- **Fuera de la oficina** — el destinatario tiene un autorrespondedor puesto.
- **Buzón lleno** — el buzón del destinatario no puede recibir correo nuevo.
- **Audiencia grande** — la lista de destinatarios supera un umbral configurable.
- **Destinatario moderado** — el mensaje requerirá moderación antes de la entrega.
- **Destinatario restringido** — el destinatario está configurado para rechazar ciertos remitentes.
- **Responder a todos a audiencia grande** — pulsar Responder a Todos enviaría a mucha gente.

Para un cliente típico de pequeña empresa, la configuración correcta es **todos los tips habilitados, incluido el de Destinatarios externos**. El ajuste de seguridad de Panoptica365 «Enable MailTips (All Tips + External Recipients)» empuja esta configuración y vigila la deriva. Si el admin de un cliente deshabilita MailTips — a veces hecho como respuesta a una queja del usuario del tipo «la barra amarilla es molesta» — la señal de deriva es el aviso temprano. Vuelves a habilitar, hablas con el usuario sobre por qué existe el aviso, y sigues adelante.

El PowerShell por debajo: `Set-OrganizationConfig -MailTipsAllTipsEnabled $true -MailTipsExternalRecipientsTipsEnabled $true`. El umbral para el tip de audiencia grande puede ajustarse (`MailTipsLargeAudienceThreshold`) — el valor por defecto de Microsoft de 25 suele estar bien para pequeña empresa.

## Qué ve Panoptica365

**Deriva sobre el ajuste de seguridad «Enable MailTips (All Tips + External Recipients)».** Panoptica365 vigila las propiedades de MailTips de la configuración de la organización. Deshabilitar MailTips a nivel tenant dispara la alerta de deriva; reaplicar restaura la configuración.

**Alertas de Defender XDR sobre creación sospechosa de transport rules.** Cuando MDO expone un evento de alta severidad relacionado con la creación de una transport rule con características que coinciden con patrones de atacante (BCC externo, bypass de cabecera, bypass de Safe Links), la alerta fluye al motor de alertas de Panoptica365 por el pipeline estándar.

Lo que Panoptica365 *no* expone en el panel: un navegador de transport rules por tenant, un visor de diferencias regla a regla, un flujo de auditoría de higiene. El trabajo de auditoría pasa en el centro de administración de Exchange o vía PowerShell. El papel de Panoptica365 aquí es la deriva sobre el ajuste de MailTips y el pipeline de alertas para creación sospechosa de reglas; la auditoría regla a regla es territorio del operador.

## Qué se puede romper

**Transport rules creadas por el cliente que entran en conflicto con los ajustes empujados por Panoptica365.** Un cliente tiene una regla vieja que deshabilita MailTips para un buzón específico (quizá una cuenta de automatización). Cuando Panoptica365 aplica MailTips a nivel tenant, el comportamiento viejo del cliente se rompe. El arreglo es identificar la necesidad legítima (si la hay) y actualizar la regla explícitamente; no debilitar la configuración de MailTips a nivel tenant.

**Banners de descargo de remitente externo siendo estampados por duplicado.** Algunos tenants de cliente ya tienen una regla de remitente externo y añaden otra sin deshabilitar la primera. Los usuarios ven dos banners amarillos. El arreglo es consolidar en una sola regla.

**Adjuntos ejecutables legítimos siendo bloqueados por reglas de extensión.** Un proveedor envía un instalador `.exe` de una herramienta específica que el cliente usa. La transport rule lo bloquea. El arreglo es una excepción acotada al remitente (permitir `.exe` solo desde `vendor.com`) en lugar de quitar el bloqueo de ejecutables por completo.

**MailTips deshabilitado por usuario.** Algunos usuarios tienen MailTips deshabilitado a nivel de su buzón (anulando el valor por defecto del tenant). Audita las políticas OWA por buzón durante el chequeo previo para pillar esto.

## Lo que esto significa para el operador

Tres puntos para llevarte.

**Las transport rules son el objeto de configuración más poderoso y menos visible en M365.** Son a nivel tenant, sobreviven a los restablecimientos de contraseña, pueden saltarse defensas posteriores, y la mayoría de los usuarios no tienen forma de verlas. Audítalas en cada incorporación de cliente. Documenta cada regla superviviente con su propósito. Trata la creación de una nueva transport rule como una acción de mayor confianza que crear un buzón de usuario.

**Los patrones de atacante son reconocibles.** BCC externo, bypass de cabecera, supresión de rebote, borrado selectivo — entrena a tu equipo de operadores para detectarlos en las listas de reglas del cliente. La característica compartida es que el efecto de la regla es invisible al usuario objetivo. Cualquier cosa que coincida con esa forma se investiga.

**Los MailTips son gratis, visibles para el usuario, y vale la pena habilitarlos en todas partes.** El tip de Destinatarios externos es el aviso del momento de la verdad que pausa a un usuario a punto de enviar a un dominio de atacante. Habilita todos los tips a nivel tenant. Empuja con suavidad cuando los usuarios se quejen de la barra amarilla — los está protegiendo de la transferencia fraudulenta que no quieres pasar el sábado gestionando.

## Lo que viene

- **Lección 9: Spam saliente y SMTP AUTH.** Los controles del radio de impacto post-compromiso — qué pasa cuando el buzón del cliente se vuelve el que envía el phishing.
- **Lección 10: Políticas de seguridad preestablecidas y operar a escala.** Los paquetes Standard / Strict, el modelo de detección de deriva en toda la tarjeta 5, y la cadencia de revisión anual.

Por ahora: abre las transport rules del cliente en el centro de administración de Exchange. Lee cada regla. Anota qué hace cada una y por qué. Quita la basura. Mientras estés ahí, verifica que MailTips está habilitado a nivel tenant (o comprueba el estado de deriva de Panoptica365 sobre el ajuste). El responsable de IT del cliente de la historia inicial no recibe la regla de BCC plantada bajo su vigilancia.

---

*Fuentes de los datos en esta lección — Microsoft Learn sobre las transport rules de Exchange Online ([Microsoft Learn — Mail flow rules in Exchange Online](https://learn.microsoft.com/en-us/exchange/security-and-compliance/mail-flow-rules/mail-flow-rules)); referencia de New-TransportRule y condiciones / acciones de regla ([Microsoft Learn — Mail flow rule actions](https://learn.microsoft.com/en-us/exchange/security-and-compliance/mail-flow-rules/mail-flow-rule-actions)); bypass de Safe Links vía la cabecera X-MS-Exchange-Organization-SkipSafeLinksProcessing ([Microsoft Learn — Skip Safe Links via mail flow rules](https://learn.microsoft.com/en-us/defender-office-365/safe-links-policies-configure)); visión general y configuración de tenant de MailTips ([Microsoft Learn — MailTips in Exchange Online](https://learn.microsoft.com/en-us/exchange/clients-and-mobile-in-exchange-online/mailtips/mailtips)); referencia de parámetros MailTips de Set-OrganizationConfig ([Microsoft Learn — Set-OrganizationConfig](https://learn.microsoft.com/en-us/powershell/module/exchange/set-organizationconfig)).*
