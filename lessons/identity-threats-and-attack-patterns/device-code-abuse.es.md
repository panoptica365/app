---
title: "Abuso del código de dispositivo — la impresora que no era una impresora"
subtitle: "Actores estatales (Storm-2372) convierten en arma el flujo legítimo de código de dispositivo para robar tokens sin tocar jamás una contraseña."
icon: "smartphone"
last_updated: 2026-05-29
---

# Abuso del código de dispositivo — la impresora que no era una impresora

En algún lugar de la oficina de tu cliente, una impresora inicia sesión en Microsoft 365 para hacer scan-to-email. Esa impresora no puede tener teclado. No puede escribir una contraseña. No puede tocar un teléfono para MFA. Microsoft resolvió esto hace años con el *flujo de código de dispositivo*: el dispositivo muestra un código alfanumérico corto en su pantalla, el usuario va a `microsoft.com/devicelogin` en su teléfono o portátil, introduce el código, inicia sesión normalmente, y Microsoft le entrega al dispositivo un token. La impresora ahora puede enviar correo. Nadie tuvo que reescribir una contraseña en un dispositivo sin teclado.

Es una función legítima e inteligente. También es el vector de ataque detrás de Storm-2372 — un actor de amenazas alineado con Rusia que ha estado corriendo campañas de phishing por código de dispositivo contra objetivos en gobiernos, ONGs, servicios de IT, defensa, telecomunicaciones, salud, educación superior y energía a través de Europa, América del Norte, África y Oriente Medio desde agosto de 2024. En febrero de 2025, Microsoft observó a Storm-2372 evolucionar el ataque para adquirir Primary Refresh Tokens (PRTs) registrando dispositivos controlados por el atacante dentro del tenant de la víctima.

Esta lección trata sobre cómo una función de autenticación amigable con impresoras se convierte en una herramienta de ataque, y la política única de Acceso Condicional que la cierra para los clientes que no tienen impresoras.

## El flujo legítimo de código de dispositivo

Para entender el ataque, recorre primero la versión legítima.

Una impresora (o televisión inteligente, dispositivo IoT, sesión de PowerShell en un servidor, automatización por script, etc.) quiere autenticarse como un usuario. No puede presentar una UI de inicio de sesión por sí misma.

**Paso 1: El dispositivo solicita un código.** El dispositivo llama al endpoint `/devicecode` de Microsoft y recibe de vuelta dos cosas: un corto *código de usuario* (unos ocho caracteres alfanuméricos como `B7XK-9MNP`) y un más largo *código de dispositivo* (una cadena opaca larga que el dispositivo guarda internamente). El dispositivo también recibe una URL — `microsoft.com/devicelogin`.

**Paso 2: El dispositivo muestra el código de usuario.** La pantalla de la impresora muestra: «Ve a `microsoft.com/devicelogin` e introduce el código `B7XK-9MNP` para iniciar sesión.»

**Paso 3: El usuario va a esa URL en su teléfono o portátil.** Se autentica normalmente en Microsoft. Cuando se le pregunta, introduce el código de usuario. Microsoft ahora asocia ese código con la identidad del usuario que ha iniciado sesión.

**Paso 4: El dispositivo sondea el endpoint de tokens de Microsoft.** Una vez que el usuario ha introducido el código, Microsoft le entrega al dispositivo un token. El dispositivo ahora puede iniciar sesión como el usuario.

Funciona. Es legítimo. Microsoft ha documentado el flujo extensamente. La fisura es que *los pasos 2 al 4 no requieren realmente que el dispositivo esté en la misma habitación que el usuario*. El «dispositivo» puede ser el portátil del atacante en Bucarest. El «código de usuario» puede enviarse vía WhatsApp. El usuario no tiene forma de saber a qué dispositivo va a autenticar el código.

## El ataque

Ahora la versión de ataque, que es estructuralmente idéntica:

**Paso 1: El portátil del atacante solicita un código de dispositivo.** Llama al endpoint `/devicecode` de Microsoft con un ID de cliente — típicamente uno de los IDs de aplicación de primera parte bien conocidos de Microsoft (Outlook, Teams, Microsoft Graph PowerShell, Microsoft Authentication Broker). Microsoft devuelve el código de usuario y el código de dispositivo.

**Paso 2: El atacante envía el código de usuario a la víctima.** Vía WhatsApp, Teams, Signal, o correo. Storm-2372 típicamente se hace pasar por una «persona prominente relevante para el objetivo» — un periodista organizando una entrevista, un inversor programando una llamada, un investigador invitando a colaborar. El pretexto culmina en: «He organizado una reunión de Teams para nosotros. Por favor, ve a `microsoft.com/devicelogin` e introduce el código `B7XK-9MNP` para unirte.»

**Paso 3: La víctima, esperando un flujo legítimo de invitación a Teams, va a la URL e introduce el código.** Ahora está en la página *real* de devicelogin de Microsoft. Se autentica normalmente — contraseña, MFA, todo el flujo regular. No hay página falsa de inicio de sesión. No hay proxy. La página es genuinamente la de Microsoft. El código de usuario, sin embargo, es el del atacante.

**Paso 4: Microsoft autoriza al portátil del atacante como ese usuario.** El atacante ahora tiene un token de acceso — emitido legítimamente, por Microsoft, después de que la víctima completara correctamente el MFA. Desde la perspectiva de Microsoft, este es un inicio de sesión completamente válido.

**Paso 5: El atacante lee correo, exfiltra datos, etc.**

La experiencia del usuario es: pensaba que se unía a una reunión de Teams. La reunión no se produjo. Cerró la pestaña. Lo dejaron pelado.

## Por qué esto derrota a MFA

El MFA ocurre entre *la víctima y Microsoft* en el paso 3. La víctima lo completa correctamente. El prompt de MFA pregunta «¿Aprobar el inicio de sesión desde el dispositivo que inició este flujo?» — pero el dispositivo que inició este flujo es el portátil *del atacante*. La víctima no puede saber por el prompt que el dispositivo no es el suyo, porque el flujo de código de dispositivo no saca a la superficie información significativa sobre el dispositivo solicitante en la experiencia de MFA del usuario.

El MFA de Microsoft valida la presencia del usuario y las credenciales correctas. No valida la intención («¿realmente quería este usuario iniciar sesión a esta máquina del atacante?»). El flujo de código de dispositivo usa el MFA tal como se diseñó y aún así produce un compromiso, porque *el consentimiento al inicio de sesión* y *la autenticación del inicio de sesión* ocurren en máquinas distintas.

Este es estructuralmente el mismo problema que AiTM (lección 3): la autenticación es técnicamente correcta pero acaba beneficiando a la parte equivocada. La diferencia es que AiTM intercepta la cookie de sesión del usuario; el phishing por código de dispositivo hace que Microsoft *emita legítimamente* un token vinculado al atacante. No hay robo. No hay malware. No hay proxy. Todo es oficial.

## La evolución reciente de Storm-2372

En agosto de 2024, Microsoft empezó a rastrear las campañas de código de dispositivo de Storm-2372. Las campañas iniciales fueron directas — hacer phishing de un token de Outlook o Microsoft Graph PowerShell, leer correo.

El 14 de febrero de 2025, Microsoft observó al actor cambiar a una variante mucho más peligrosa: usar el ID de cliente específico del **Microsoft Authentication Broker**. Cuando el flujo de código de dispositivo se ejecuta contra el Authentication Broker, el token de actualización resultante puede intercambiarse por un token fresco en el *servicio de registro de dispositivos*, lo que le permite al atacante registrar su propia máquina como un dispositivo en el tenant Entra ID de la víctima.

Un dispositivo registrado en Entra ID puede solicitar un Primary Refresh Token (PRT) — la credencial que M365 emite a los dispositivos Windows gestionados para mantener al usuario conectado. Con un PRT, el atacante tiene el mismo tipo de acceso que tiene un portátil corporativo completamente inscrito. Puede iniciar sesión en cualquier cosa en M365 sin prompts de MFA adicionales, porque el PRT es lo que *reemplaza* al MFA para los inicios de sesión de dispositivos gestionados.

En otras palabras, el atacante convirtió un único phishing por código de dispositivo en un *dispositivo inscrito* en el tenant del cliente. Pasar de «tengo un token por unas horas» a «tengo una identidad de dispositivo gestionado que va a seguir produciendo tokens» es un salto cualitativo en persistencia — similar a lo que el phishing por consentimiento OAuth (lección 4) le da al atacante, pero conseguido a través de un mecanismo completamente distinto.

## Cómo se ve esto en la telemetría de M365

El flujo de código de dispositivo se registra. El registro de inicio de sesión en Entra ID registra:

- **Protocolo de autenticación: Device Code.** Esta es la pista delatora. Muy pocas cargas de trabajo de cliente reales usan el flujo de código de dispositivo como método de inicio de sesión primario.
- **ID de cliente.** Te dice qué aplicación se estaba autorizando. El ID del Microsoft Authentication Broker (`29d9ed98-a469-4536-ade2-f981bc1d605e`) apareciendo aquí es una señal fuerte — esa es la evolución de Storm-2372.
- **IP de origen.** A menudo un proxy residencial o una geografía hostil conocida.
- **User agent.** A menudo Python por defecto o estilo curl — automatización, no un cliente real.

Si haces grep al registro de inicio de sesión de Entra por `authenticationProtocol == "deviceCode"`, deberías ver casi cero resultados en un tenant sano a menos que haya casos de uso documentados de IoT/automatización. Cada acierto vale la pena investigarlo.

La actividad de seguimiento — registro súbito de un nuevo dispositivo en el tenant, nuevos métodos de autenticación registrados, cambios de permisos de buzón — es más ruidosa y más fácil de detectar que el propio inicio de sesión por código de dispositivo.

## Qué hace Defender al respecto

Safe Links de Microsoft Defender for Office 365 puede pillar la *entrega* del mensaje de phishing si es por correo, pero el pretexto de Storm-2372 es típicamente un mensaje de chat en Teams, WhatsApp, o Signal, que Defender for Office 365 no ve.

Defender XDR puede correlacionar el inicio de sesión por código de dispositivo con anomalías aguas abajo — registro de nuevo dispositivo, consultas sospechosas a Graph, exfiltración de buzón — y asignar confianza de Attack Disruption si el patrón coincide. El equipo de Microsoft Threat Intelligence ha publicado consultas de detección que los clientes con Defender XDR pueden desplegar en advanced hunting para buscar los indicadores específicos de Storm-2372.

El control defensivo más limpio, sin embargo, es la configuración: evitar que el flujo de código de dispositivo sea usable para la mayoría de los usuarios desde el principio.

## La política de Acceso Condicional que cierra esto

En Acceso Condicional, hay una condición llamada **Flujos de autenticación** (preview hasta 2024, generalmente disponible en 2025). Dentro de esa condición, uno de los interruptores es **Flujo de código de dispositivo**. Puedes escribir una política de AC que diga:

> Bloquear a todos los usuarios de completar el flujo de autenticación por código de dispositivo, con las siguientes excepciones: [cuentas específicas que legítimamente lo necesitan, como la cuenta de servicio de la impresora o la cuenta de helpdesk que corre automatización de PowerShell contra múltiples tenants].

Esa es la política. Ponla en el tenant del cliente, excluye cualquier cuenta de servicio que legítimamente necesite código de dispositivo (la mayoría de los tenants no tienen ninguna), y todo el manual de Storm-2372 deja de funcionar para ese tenant.

Esta es una de las políticas de AC únicas con más palanca disponibles en Entra ID P1 (Business Premium en adelante). Microsoft empezó a recomendar públicamente esta política tras la divulgación de Storm-2372 en febrero de 2025, y a partir de mediados de 2026 debería considerarse base de partida para cualquier tenant que no tenga un caso de uso documentado de código de dispositivo.

La limpieza de seguimiento, si descubres que la política no estaba en su sitio y ocurrió un ataque: revocar los tokens del usuario (cubierto en la sección de respuesta de la lección 3), de-registrar cualquier dispositivo controlado por el atacante de la lista de dispositivos del tenant, auditar y limpiar los métodos de autenticación, y restablecer la contraseña del usuario.

## Qué ve Panoptica365

El pipeline de ingesta de UAL de Panoptica365 incluye señales relacionadas con el código de dispositivo como parte del catálogo de detección más amplio:

**Inicios de sesión sospechosos por código de dispositivo.** Cuando un inicio de sesión se completa con `authenticationProtocol == "deviceCode"` y el origen no es una cuenta IoT documentada, la alerta puede dispararse — dependiendo de la configuración del tenant.

**Nuevo dispositivo registrado.** Cuando un dispositivo no visto previamente aparece en la lista de dispositivos del tenant (la firma de ataque post-Storm-2372), el evento de registro está en el registro de auditoría de Entra y Panoptica365 lo saca a la superficie.

**Nuevo método de autenticación registrado.** Como con la mayoría de los ataques de identidad, el atacante post-compromiso a menudo añade su propio método MFA. Esta alerta cubre la cadena de ataque por código de dispositivo así como las cadenas de AiTM y credential stuffing.

**La ingesta de Defender XDR** capta los incidentes correlacionados cuando Microsoft ha puntuado la actividad como sospechosa.

El enfoque de triaje: cuando una alerta de IP extranjera o de nuevo-dispositivo-registrado se dispara, comprueba si el protocolo de autenticación del inicio de sesión fue Device Code. Si lo fue, trátalo como un ataque estilo Storm-2372 hasta que se demuestre lo contrario.

## Defender al cliente

En capas, por orden de impacto:

**Bloquear el flujo de código de dispositivo vía Acceso Condicional para los usuarios que no lo necesiten.** Política única, efecto inmediato. La gran mayoría de los tenants de cliente tienen cero casos de uso legítimos de código de dispositivo. Los pocos que sí (la impresora, la cuenta de automatización de PowerShell) pueden excluirse individualmente. No dejes esto expuesto.

**Para tenants que sí necesitan código de dispositivo (raro), exige que venga de ubicaciones de confianza o dispositivos conformes.** La condición de Acceso Condicional se combina con las otras — puedes exigir «flujo de código de dispositivo solo desde el rango de IP de la oficina» o «solo en dispositivos conformes a Intune». Configuración más pesada pero posible.

**Educa a los usuarios sobre los pretextos basados en chat.** La cadena de ataque de Storm-2372 depende de que el usuario confíe en un mensaje de WhatsApp/Signal/Teams lo suficiente como para seguir instrucciones. Entrena a los usuarios (especialmente ejecutivos y personas en roles como subvenciones, periodismo, investigación, o cualquier función orientada al exterior) que **cualquiera que les pida ir a `microsoft.com/devicelogin` e introducir un código vía un mensaje de chat es casi con total seguridad un atacante**. No hay razón legítima alguna por la que una parte externa deba enviar nunca un código de dispositivo por chat.

**Monitoriza el protocolo `deviceCode` en el registro de inicios de sesión.** Esto debería ser una línea base cercana a cero en la mayoría de los tenants. Cualquier cosa no-cero vale la pena examinarla.

**Detecta los indicadores post-compromiso.** Eventos de registro de nuevo dispositivo, nuevos métodos de autenticación, actividad sospechosa de buzón — estas son las señales de seguimiento que se disparan más fuerte que el propio inicio de sesión por código de dispositivo.

## Lo que esto significa para el operador

Tres puntos para llevarte.

**Añade «bloquear el flujo de código de dispositivo» a la lista de comprobación de incorporación de clientes.** Esta es una de las políticas de Acceso Condicional baratas y de alto impacto que debería estar en cada tenant de Business Premium por defecto. La biblioteca de plantillas de AC de Panoptica365 es el sitio correcto para entregar esto; si no está ya en tu biblioteca, añádelo antes de la próxima incorporación de cliente.

**La evolución de Storm-2372 de «robar un token» a «registrar un dispositivo» es el patrón que vigilar.** Cuando los atacantes encuentran nuevas formas de convertir el acceso de corto plazo en acceso persistente, la amenaza se compone. La misma lógica se aplica al phishing por consentimiento (lección 4) y al truco post-AiTM «registrar un nuevo método MFA» (lección 3). Las variantes de persistencia son donde los compromisos simples se convierten en incidentes prolongados.

**El phishing por código de dispositivo se pilla mejor aguas arriba.** Una vez emitido el token, estás persiguiendo el rastro del atacante. La política de AC que evita que el flujo sea usable es *la* defensa; todo lo demás es limpieza.

## Lo que viene

- **Lección 6: Compromiso del correo de empresa.** Donde terminan la mayoría de estos ataques — no en el compromiso dramático en sí, sino en la manipulación tranquila y prolongada de los correos financieros que sigue. BEC es lo que hace rentables para los atacantes los cinco ataques anteriores.

Por ahora: el flujo de código de dispositivo es una función legítima siendo abusada a escala por un actor sofisticado. La defensa es configuración, no detección. Pon la política de Acceso Condicional. Entrena a tus usuarios para que nunca introduzcan un código de dispositivo desde un mensaje de chat. Vigila el registro de inicios de sesión por el protocolo que no esperas ver.

---

*Fuentes de los datos en esta lección — Microsoft Security Blog sobre la campaña de phishing por código de dispositivo de Storm-2372 ([Microsoft Security Blog — Storm-2372 conducts device code phishing campaign, febrero de 2025](https://www.microsoft.com/en-us/security/blog/2025/02/13/storm-2372-conducts-device-code-phishing-campaign/)); referencia técnica del flujo de código de dispositivo ([Microsoft Learn — OAuth 2.0 device code flow](https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-device-code)); condición «flujos de autenticación» de Acceso Condicional ([Microsoft Learn — Conditional Access: Authentication flows](https://learn.microsoft.com/en-us/entra/identity/conditional-access/concept-conditional-access-cloud-apps#authentication-flows)); evolución de Storm-2372 al robo de Authentication Broker / PRT ([Microsoft Threat Intelligence — Storm-2372 update, febrero de 2025](https://www.microsoft.com/en-us/security/blog/2025/02/13/storm-2372-conducts-device-code-phishing-campaign/)).*
