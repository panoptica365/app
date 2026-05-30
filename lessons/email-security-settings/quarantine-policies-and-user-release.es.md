---
title: "Políticas de cuarentena y liberación de usuario — donde mueren los buenos valores por defecto"
subtitle: "Restringir los permisos de liberación de cuarentena para que los usuarios finales no puedan liberar por su cuenta phishing de alta confianza."
icon: "inbox"
last_updated: 2026-05-29
---

# Políticas de cuarentena y liberación de usuario — donde mueren los buenos valores por defecto

La asistente del director general de un cliente recibe un correo diario de notificación de cuarentena de Microsoft. Asunto: «Tienes 3 mensajes en cuarentena». El cuerpo lista tres mensajes con remitente, asunto y un botón de Liberar al lado de cada uno.

Uno de los tres es de alguien que no reconoce, con un asunto como «Tu sobre de DocuSign está listo para firma». Ella no esperaba un sobre de DocuSign. Pero el director firma cosas todo el tiempo, y ella le gestiona el calendario, y a lo mejor esto es algo que necesita ver, y ella no quiere parecer la asistente que bloqueó algo importante. Hace clic en Liberar.

El mensaje llega a su bandeja de entrada. Lo abre. Hace clic en el enlace con marca de DocuSign. El enlace va a una página de captura de credenciales corriendo en un dominio recién registrado con un certificado válido de Let's Encrypt. Teclea las credenciales del director general, porque el director le había pedido que se encargara de DocuSign por él, y ella tiene la contraseña. El atacante captura tanto la credencial como la cookie de sesión. Doce minutos después el atacante está dentro del buzón del director general.

La asistente hizo exactamente lo que la notificación de cuarentena por defecto de Microsoft *la invitó a hacer*. Tenía un botón de Liberar. Lo usó.

Este es el vector complementario al BEC que recibe menos atención de la que merece: incluso cuando Defender pone con éxito en cuarentena un correo de phishing, el propio usuario del cliente puede liberarlo de vuelta a la bandeja de entrada con un clic. La defensa contra el phishing existe; la defensa contra que el usuario deshaga la defensa es de lo que trata esta lección.

## Las cuatro (o cinco) categorías de cuarentena

Microsoft clasifica los mensajes en cuarentena en categorías distintas, cada una con sus propias reglas de liberación por defecto. Conocer las categorías importa porque la configuración correcta es *específica de la categoría*.

- **Spam** (spam de baja confianza) — mensajes que Microsoft sospecha que son spam con confianza moderada. Por defecto: los usuarios pueden liberar con notificación.
- **Spam de alta confianza** — Microsoft está más seguro. Por defecto: los usuarios pueden liberar con notificación.
- **Bulk** — correo masivo de estilo boletín. Por defecto: los usuarios pueden liberar con notificación.
- **Phishing** — Microsoft sospecha que esto es un intento de phishing. Por defecto: el admin debe liberar.
- **Phishing de alta confianza** — Microsoft está muy seguro. Por defecto: el admin debe liberar; el mensaje no puede ser liberado por usuarios.
- **Malware** — el adjunto o enlace coincidió con un patrón malicioso. Por defecto: el admin debe liberar.
- **Spoof** — la autenticación del remitente (SPF/DKIM/DMARC) falló de un modo que sugiere suplantación del remitente. Por defecto, varía según la configuración del tenant.

Los valores por defecto son razonables para las categorías de alta confianza (el admin debe liberar) y *peligrosos* para las de baja confianza (los usuarios pueden liberar). La anécdota inicial ocurrió porque la asistente recibió un mensaje clasificado como Phishing (no de alta confianza) con la configuración antigua por defecto que dejaba a los usuarios liberar phishing de baja confianza — y Microsoft ha endurecido los valores por defecto desde entonces, pero los tenants de clientes configurados hace años aún pueden llevar los ajustes más laxos.

## Políticas de cuarentena — el objeto de configuración

Una **política de cuarentena** en M365 es el objeto que define qué pueden hacer los usuarios con los mensajes en cuarentena. Microsoft entrega tres políticas preestablecidas; puedes crear personalizadas.

Las preestablecidas:

- **AdminOnlyAccessPolicy** — los usuarios no tienen ninguna capacidad de liberar. Pueden ver los mensajes en cuarentena (si la notificación está habilitada) pero no pueden liberarlos. El admin es el único que puede. La postura más estricta.
- **DefaultFullAccessPolicy** — los usuarios pueden solicitar liberación (el admin igual aprueba) y pueden previsualizar los mensajes. Sin notificaciones.
- **DefaultFullAccessWithNotificationPolicy** — igual que DefaultFullAccessPolicy pero con notificaciones de cuarentena habilitadas. La más permisiva de los valores por defecto de Microsoft.

Las políticas personalizadas te dejan mezclar y combinar: habilitar acciones específicas (solicitar liberación, previsualizar, bloquear remitente), especificar si se envían notificaciones, y elegir cuán agresiva es la cadencia de notificación.

La configuración que importa para el endurecimiento de pequeña empresa: **aplica AdminOnlyAccessPolicy a las categorías peligrosas** (Phishing, Phishing de alta confianza, Malware, Spoof). Los usuarios nunca pueden liberar mensajes en esas categorías sin la aprobación del operador. Para las categorías de menor confianza (Spam, Bulk), la más permisiva DefaultFullAccessWithNotificationPolicy es defendible — esas suelen ser correo de marketing o ruido, y darle a los usuarios autoservicio para esas reduce la carga de mesa de ayuda.

## Cadencia de notificación de cuarentena

Aparte de las propias políticas, M365 controla con qué frecuencia los usuarios reciben el correo resumen de «tienes mensajes en cuarentena». La frecuencia de notificación puede ponerse por política de cuarentena (en configuraciones más nuevas) o vía un ajuste global (en las más antiguas).

Cadencias habituales:

- **Diaria** — el valor por defecto. Un correo al día con los mensajes en cuarentena del día.
- **Cada 4 horas** — más agresiva; para buzones de alto volumen.
- **Apagada** — sin notificaciones. Los usuarios tienen que comprobar activamente el portal de cuarentena si quieren ver qué se ha bloqueado.

Para clientes de pequeña empresa, diaria suele ser el balance correcto. Notificaciones más frecuentes generan ruido; apagada genera tickets de «nunca recibí X» porque los usuarios no se acuerdan de comprobar el portal.

## El complemento al BEC — por qué los valores por defecto importan

La anécdota inicial no es hipotética. Es el segundo vector complementario más habitual después del reenvío automático (lección 5). La secuencia de ataque es consistente entre incidentes:

1. El atacante envía un correo de phishing elaborado para parecer una comunicación de negocio legítima (DocuSign, factura, RR. HH. interno, expiración de contraseña de IT).
2. El correo aterriza en cuarentena porque el clasificador antiphishing de Microsoft lo marca — pero con clasificación Phishing (no de alta confianza), porque el mensaje está técnicamente bien formado y usa infraestructura de alojamiento legítima.
3. El usuario recibe la notificación de cuarentena, ve un asunto plausiblemente de negocio, no quiere retrasar algo importante, hace clic en Liberar.
4. El mensaje llega a la bandeja de entrada. El usuario hace clic en el enlace. Se capturan las credenciales. Se captura la cookie de sesión. El buzón está comprometido.

La defensa es quitar el botón de Liberar para las categorías peligrosas. Configura todas — Phishing, Phishing de alta confianza, Malware y Spoof — a AdminOnlyAccessPolicy. La notificación aún puede llegar (para que el usuario sepa que su correo se puso en cuarentena y pueda pedirle al operador que investigue), pero el botón de Liberar no está. El usuario tiene que llamar a la mesa de ayuda.

Esto añade carga operativa — los operadores ahora atienden tickets de «libera mi mensaje en cuarentena». El compromiso es intencional: cada ticket de petición de liberación es una oportunidad para mirar el mensaje, verificar que es legítimo, y o bien liberarlo o usar la conversación para educar al usuario sobre lo que casi hizo clic. La conversación de cinco minutos es barata; el incidente de transferencia fraudulenta es caro.

## Las políticas de seguridad preestablecidas lo hacen más fácil

Las políticas de seguridad preestablecidas de Microsoft (Standard y Strict — la lección 10 las cubre en detalle) incluyen configuraciones de políticas de cuarentena. La preestablecida Standard asigna la política estricta de acceso (AdminOnlyAccessPolicy) a las categorías de Phishing de alta confianza, Malware y Spoof por defecto. La preestablecida Strict extiende esto también a Phishing.

Si has aplicado la preestablecida Standard o Strict al cliente (cubierto en las lecciones 3 y 10), la configuración de cuarentena está parcialmente manejada. Lo que las preestablecidas no anulan es la cadencia y la asignación de política por categoría para Spam y Bulk — esas siguen siendo decisiones específicas del tenant.

El punto a llevarte: si estás desplegando políticas de seguridad preestablecidas y no personalizas más la cuarentena, ya has obtenido el bloqueo de liberación de las categorías peligrosas. Si estás configurando políticas de cuarentena independientemente de las preestablecidas, tienes que hacer explícita la asignación AdminOnly para cada categoría peligrosa.

## El flujo del operador — liberar en nombre del usuario

Cuando AdminOnlyAccessPolicy está en su sitio y un usuario llama para pedir una liberación:

1. **Abre el portal de cuarentena** (portal de Defender → Email & collaboration → Review → Quarantine). Busca el mensaje por destinatario, remitente o asunto.
2. **Previsualiza el mensaje** antes de liberarlo. Lee el cuerpo. Mira los enlaces. Mira los detalles del remitente — incluida la dirección real de envío (no solo el nombre para mostrar). Mira las cabeceras si el mensaje está en el límite.
3. **Verifica con el usuario** lo que esperaba. «Dices que es de Bob sobre la factura — ¿coincide con lo que Bob enviaría normalmente? ¿El enlace va donde esperas?».
4. **Libera si es legítimo; repórtalo como phishing si no.** El portal de Defender de Microsoft te deja liberar con una opción de «enviar a Microsoft para revisión» — esto entrena al clasificador de Microsoft y ayuda a que mensajes legítimos similares pasen automáticamente en el futuro.

Este es un flujo de 3 a 5 minutos por petición. Para clientes con muchas liberaciones, agrúpalas — maneja la cola una o dos veces al día en lugar de reaccionar a cada llamada. Para clientes de alto volumen, considera ajustar el afinado del antiphishing o el antispam para que menos mensajes legítimos aterricen en cuarentena.

## Qué ve Panoptica365

La configuración de la política de cuarentena es parte de lo que gobiernan las **políticas de seguridad preestablecidas**. El ajuste de seguridad de Panoptica365 «Enable Preset Security Policy (Standard or Strict) — MDO» empuja la habilitación de la preestablecida en el tenant del cliente, y el detector de deriva vigila si se mantiene habilitada. Si el admin de un cliente abre el portal de Defender y deshabilita la preestablecida — o crea una política de cuarentena personalizada con derechos de liberación permisivos que anula la preestablecida — la señal de deriva es el aviso temprano.

**Las alertas de Defender XDR** fluyen al motor de alertas de Panoptica365 cuando MDO expone eventos de alta severidad relacionados con liberaciones de cuarentena iniciadas por usuario de mensajes sospechosos. Estos aparecen en el pipeline estándar de alertas.

Lo que Panoptica365 *no* expone en el panel: navegadores de cola de cuarentena por tenant, flujo de aprobación de petición de liberación por mensaje, historial de actividad de liberación por usuario. La propia cola de cuarentena, la vista previa por mensaje, la acción de aprobación de liberación — todo eso pasa en el portal de Microsoft Defender. Panoptica365 vigila la *configuración* del sistema de cuarentena; la *operación* de la cola de cuarentena es una superficie de Microsoft.

## Qué se puede romper

**Quejas del cliente por mensajes «atascados en cuarentena».** Cuando AdminOnlyAccessPolicy está en su sitio, los usuarios genuinamente no pueden liberar sus propios mensajes. Llamarán por teléfono. Algunos clientes experimentan esto como una degradación. Encuádralo explícitamente durante la conversación con el cliente como «os estamos protegiendo del patrón de ataque AiTM-y-liberación; el compromiso es que nos llamáis para liberar mensajes ambiguos, y tardamos cinco minutos en verificar». La mayoría de los clientes lo acepta una vez explicado el compromiso.

**Correo legítimo de marketing o transaccional yendo a cuarentena repetidamente.** Facturas de proveedores, sobres de DocuSign, invitaciones de calendario de terceros — cualquier sistema que envíe correo con características que Microsoft puntúa como cercanas al phishing. El arreglo es o bien autenticar al remitente correctamente (lección 4) o añadir el dominio del remitente a la lista de remitentes de confianza antiphishing (lección 2). No crear una política de cuarentena permisiva.

**Notificaciones de cuarentena yendo a correo no deseado.** Los usuarios a veces configuran reglas que mueven todos los correos de remitente «noreply@» a correo no deseado, incluido el resumen de cuarentena de Microsoft. Luego se quejan de que no se enteran de los mensajes en cuarentena. Diagnostícalo durante el onboarding y educa al usuario.

**Políticas de cuarentena personalizadas viejas dejadas por administradores anteriores.** Algunos tenants de cliente tienen políticas de cuarentena personalizadas heredadas de migraciones o de MSPs anteriores. Audítalas durante el chequeo previo (lección 1) y o bien alinéalas con el modelo de preestablecidas Standard/Strict o reconstrúyelas explícitamente.

## Lo que esto significa para el operador

Tres puntos para llevarte.

**La liberación de cuarentena por defecto es un vector complementario al BEC.** Los valores por defecto de Microsoft dejan a los usuarios liberar mensajes de phishing de baja confianza ellos mismos. La asistente de la historia inicial es la víctima recurrente. Pon AdminOnlyAccessPolicy en Phishing, Phishing de alta confianza, Malware y Spoof — como mínimo.

**O despliega preestablecidas o configura las políticas de cuarentena explícitamente.** La preestablecida Standard o Strict maneja la configuración de liberación solo-admin de las categorías peligrosas. Si no estás usando preestablecidas, cada categoría necesita una asignación explícita de política. No hay una tercera opción segura.

**Liberar en nombre del usuario es un flujo de operador de cinco minutos, y vale la pena hacerlo bien.** Cuando los usuarios llaman para liberar un mensaje, ese es el momento de verificar el remitente, previsualizar el enlace, y o bien liberar con confianza o usar la llamada para educar. La sobrecarga operativa es real pero proporcional a la protección — y las conversaciones mismas entrenan a los usuarios del cliente para ser más escépticos del phishing de la próxima vez.

## Lo que viene

- **Lección 8: Reglas de flujo de correo y MailTips.** Transport rules — el objeto de configuración que da a los operadores control quirúrgico sobre el manejo de mensajes, y el patrón de abuso cuando se usa demasiado ampliamente.
- **Lección 9: Spam saliente y SMTP AUTH.** Los controles del radio de impacto post-compromiso — qué pasa cuando el buzón del cliente es el que envía el phishing.

Por ahora: abre las políticas de cuarentena del cliente en el portal de Defender. Verifica que Phishing, Phishing de alta confianza, Malware y Spoof están mapeados a AdminOnlyAccessPolicy (o que la política de seguridad preestablecida está habilitada y proporcionando el mismo efecto). Verifica que la cadencia de notificación es diaria, no apagada. La asistente de la historia inicial no obtiene su botón de Liberar esta semana; tú puedes dormir mejor como resultado.

---

*Fuentes de los datos en esta lección — Microsoft Learn sobre la visión general de políticas de cuarentena ([Microsoft Learn — Quarantine policies](https://learn.microsoft.com/en-us/defender-office-365/quarantine-policies)); creación y asignación de políticas de cuarentena personalizadas ([Microsoft Learn — Manage quarantine policies](https://learn.microsoft.com/en-us/defender-office-365/quarantine-policies-configure)); referencia del comportamiento de liberación de cuarentena por usuario ([Microsoft Learn — Quarantine user permissions](https://learn.microsoft.com/en-us/defender-office-365/quarantine-end-user)); configuración de notificaciones de cuarentena ([Microsoft Learn — Quarantine notifications](https://learn.microsoft.com/en-us/defender-office-365/quarantine-policies#quarantine-notifications)); políticas de seguridad preestablecidas y sus efectos sobre la cuarentena ([Microsoft Learn — Preset security policies](https://learn.microsoft.com/en-us/defender-office-365/preset-security-policies)).*
