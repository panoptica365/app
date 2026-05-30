---
title: "Safe Links y Safe Attachments — lo que tu cliente pagó y no está usando"
subtitle: "Activar el envoltorio de enlaces y el sandbox de adjuntos de Defender for Office 365 — y entender qué pillan y qué no."
icon: "link"
last_updated: 2026-05-29
---

# Safe Links y Safe Attachments — lo que tu cliente pagó y no está usando

Un despacho contable recibe un correo de factura de un proveedor con el que realmente trabaja. El dominio del proveedor autentica correctamente. El nombre para mostrar coincide. El archivo adjunto es un PDF que se abre y parece una factura normal. El PDF contiene un botón: «Ver portal de pago». El usuario hace clic en el botón. El botón es un hiperenlace. El hiperenlace va a una página de captura de credenciales que parece pixel-perfect la página de inicio de sesión de Microsoft, alojada en un dominio recién registrado con un certificado nuevecito de Let's Encrypt. El usuario teclea su contraseña de M365. El atacante la captura, más la cookie de sesión vía Evilginx2. Veinte minutos después el atacante está leyendo el correo del usuario y añadiendo una regla de bandeja de entrada para ocultar sus pasos.

El cliente tiene Microsoft 365 Business Premium. Llevan dos años pagando Defender for Office 365 Plan 1. Safe Links habría envuelto ese hiperenlace del PDF en el momento de la entrega. Safe Attachments habría detonado el PDF en un sandbox antes de que llegara siquiera al usuario. Ninguno estaba configurado. Las funcionalidades por las que el cliente pagaba estuvieron dormidas mientras la cadena de ataque corría de punta a punta.

Esta lección trata de encender esas funcionalidades, entender qué pillan y ser honestos sobre lo que no.

## Safe Links — cómo funciona el envoltorio en la práctica

Cuando Safe Links está habilitado, cada URL en un correo entrante se *reescribe* en el momento de la entrega. La `https://dominioreal.com/ruta` original se convierte en algo como `https://nam04.safelinks.protection.outlook.com/?url=https%3A%2F%2Fdominioreal.com%2Fruta&...`. El usuario ve la URL original al pasar el ratón por encima (la mayoría de los clientes muestran el texto envuelto pero resuelven al original al pasar el cursor); ve el destino original si hace clic y Microsoft pasa la comprobación.

En el momento del clic ocurren tres cosas:

1. **La inteligencia de amenazas de Microsoft comprueba la URL de destino** contra la base de datos de reputación de Defender. Las URLs conocidas como maliciosas se bloquean en el momento del clic, incluso si la URL estaba limpia en la entrega.
2. **Para URLs desconocidas, Microsoft puede detonarlas en tiempo real** — buscando el destino desde un sandbox, evaluando el comportamiento de la página y decidiendo si permitir o bloquear.
3. **Se deja pasar al usuario, se le bloquea con una página de advertencia o se le muestra un intersticial de «ten cuidado»** dependiendo del veredicto.

Este es el valor sobre una lista de bloqueo estática. Un enlace de phishing que estaba limpio a las 9:00 (cuando se entregó el correo) y se volvió malicioso a las 15:00 (cuando la inteligencia de amenazas lo recogió) se pilla en el clic de las 16:00. El mismo dominio bloqueado en un tenant cliente está bloqueado en cada tenant protegido por Defender, en segundos.

**Ajustes que vale la pena conocer:**

- **«Hacer seguimiento de los clics de usuario»** — telemetría sobre quién hizo clic en qué. Encendido. Los datos aparecen en los informes de amenazas de MDO.
- **«No reescribir las siguientes URLs»** — lista de exclusión para URLs legítimas que se rompen al envolverse. Úsala con moderación; es el equivalente Safe Links de la lista de remitentes de confianza (y se aplica la misma disciplina — no hagas bypass sin una razón).
- **«Permitir a los usuarios pasar a la URL original»** — cuando Safe Links bloquea algo, este ajuste controla si los usuarios pueden anularlo. Para endurecimiento, esto debería estar **apagado**. Dejar que los usuarios pasen por encima significa que lo harán, y el envoltorio se vuelve decorativo.
- **«Mostrar el branding de la organización»** — cosmético; te permite poner el logo del cliente en la página de advertencia. Vale la pena hacerlo por la conversación que arranca cuando un usuario lo ve.

## Safe Attachments — el sandbox de detonación

Cuando Safe Attachments está habilitado, los correos entrantes con adjuntos se retienen en un sandbox de Microsoft. El adjunto se abre, se observa su comportamiento (creación de procesos, llamadas de red, escrituras en el registro, ejecución de macros, todo eso) y se produce un veredicto. Los tiempos habituales de escaneo son por debajo del minuto; los archivos complejos pueden tardar más.

El veredicto dirige una de cuatro acciones, elegida por política:

- **Bloquear** — los adjuntos maliciosos paran la entrega por completo; el correo llega sin el adjunto, o no llega en absoluto (configurable).
- **Reemplazar** — el adjunto se quita, el cuerpo del correo aún llega, con una notificación explicando lo que pasó.
- **Dynamic Delivery** — el correo llega inmediatamente con un marcador, el adjunto real se añade una vez que el sandbox termina. El usuario puede leer el cuerpo del correo mientras corre el escaneo. El mejor equilibrio entre seguridad y experiencia de usuario para pequeña empresa.
- **Monitor** — solo auditoría; el adjunto se entrega sin cambios, pero los veredictos maliciosos se registran. Útil para pruebas; no es postura de producción.

Para la mayoría de los tenants de pequeña empresa, **Dynamic Delivery** es la acción correcta. Los usuarios reciben el cuerpo del correo inmediatamente (sin tickets de «¿dónde está mi correo?»), el adjunto aparece un minuto después, y los adjuntos maliciosos nunca llegan.

**Safe Documents** es una funcionalidad relacionada en Microsoft 365 Apps for enterprise (licenciamiento de nivel E5) que abre documentos de fuentes externas en Vista Protegida y los escanea vía Microsoft Defender for Endpoint antes de dejar que los usuarios editen. Vale la pena conocerla; no está en Business Premium.

## SafeLinks-for-Office — enlaces dentro de documentos y de Teams

Safe Links era originalmente solo para correo. Pero los atacantes se dieron cuenta de que podían entregar un correo limpio con un documento de Word limpio, y poner el enlace malicioso *dentro* del documento de Word. El enlace nunca se envolvía porque Safe Links no tocaba el documento. El usuario abre Word, hace clic en el enlace, lo phishean. Saltaron por encima de Safe Links.

Microsoft lo arregló. **SafeLinks-for-Office** extiende la evaluación de URL a:

- Word, Excel, PowerPoint, OneNote (escritorio y web)
- Chats, canales y publicaciones de Microsoft Teams
- Visio (escritorio y web)

Cuando un usuario hace clic en un enlace dentro de cualquiera de esos, la URL se comprueba contra la inteligencia de amenazas de Microsoft de la misma forma que lo haría un enlace entregado por correo. Esto cierra el camino de evasión más habitual.

**Ajuste:** «Proteger las apps de Office 365» — debería estar **encendido** en la política de Safe Links. Es parte de la preestablecida Standard; con políticas personalizadas, tienes que acordarte de habilitarlo.

## Lo que pillan, lo que se les escapa — siendo honestos

Safe Links y Safe Attachments son defensas en capas, no balas de plata. La anécdota inicial es real porque ambas funcionalidades tienen límites reales.

**Safe Links pilla:**

- URLs hacia destinos conocidos como maliciosos
- URLs hacia destinos que se vuelven maliciosos entre la entrega y el clic
- URLs hacia dominios recién creados con características que el ML de Microsoft reconoce (edad del registro, reputación del hosting, huella del contenido)
- URLs que evaden el análisis estático previo al clic pero fallan la detonación dinámica

**Safe Links se le escapa:**

- Dominios de phishing recién creados con TLS válido, sin cobertura todavía de inteligencia de amenazas y una UI de inicio de sesión perfectamente clonada de Microsoft. La página de captura de credenciales de la anécdota inicial es exactamente este caso. Safe Links comprueba; la inteligencia de amenazas aún no ha categorizado el dominio; la página se renderiza bien en el sandbox; la URL pasa. El usuario aterriza en el phishing.
- Sitios de negocio legítimos pero comprometidos. Un sitio legítimo de WordPress se secuestra, el atacante aloja la captura de credenciales en el dominio legítimo durante seis horas, Safe Links ve un dominio con buena reputación y pasa la URL.
- URLs entregadas fuera de banda (SMS, WhatsApp, el usuario tecleando una URL que recuerda de una llamada). Safe Links solo protege lo que fluye por las superficies de correo o documentos de M365.

**Safe Attachments pilla:**

- Malware con patrones de comportamiento reconocibles en un sandbox
- Documentos con macros maliciosas que se ejecutan al abrir
- Archivos con hashes conocidos como maliciosos
- Archivos que coinciden con las firmas de detección por ML de Microsoft para malware novedoso

**Safe Attachments se le escapa:**

- Archivos comprimidos protegidos por contraseña. Microsoft no puede abrir archivos `.zip` con contraseñas; el sandbox no puede detonar lo que no puede desempaquetar. Los atacantes lo saben y lo usan constantemente. La contraseña se proporciona amablemente en el cuerpo del correo: «Contraseña: 12345».
- Archivos que detectan el entorno de sandbox y se comportan benignamente dentro. Algún malware busca indicadores de virtualización, movimiento del ratón o procesos específicos de Office antes de activarse.
- Cargas que viven de la tierra. El propio adjunto no es malicioso; dispara un flujo que usa binarios legítimos de Windows (mshta.exe, certutil.exe, PowerShell) para hacer daño. El sandbox no ve nada raro en el documento.
- Cargas alojadas en la nube. El documento no contiene malware; contiene un enlace a una carga alojada en la nube que se carga en el momento de la ejecución. Safe Attachments ve un documento limpio; Safe Links puede o no pillar el enlace en la nube dependiendo de la reputación.

**El punto a llevarte:** estas funcionalidades son *necesarias pero no suficientes*. Pillan el grueso del phishing y malware de mercado masivo. No pillan a un atacante decidido construyendo un flujo AiTM personalizado contra tu cliente. Por eso existe el resto del currículum — Acceso Condicional, MFA resistente al phishing, protección contra suplantación antiphishing, formación de usuarios. Defensa en capas. Safe Links y Safe Attachments son dos de las capas.

## Configuración — la parte práctica

Por defecto, ninguna funcionalidad tiene una política asignada a nadie. Tienes que crear las políticas y asignarlas a grupos de usuarios.

**Para la mayoría de los clientes de pequeña empresa, la configuración inicial correcta:**

- Aplica la **política de seguridad preestablecida Standard** a todos los usuarios. Esto crea políticas de Safe Links y Safe Attachments con los valores por defecto curados de Microsoft, las asigna a todos los usuarios del tenant y enciende SafeLinks-for-Office. Hecho en tres clics.
- Si el cliente tiene un perfil de mayor riesgo (finanzas, legal, sanidad, contratación pública), aplica **Strict** en su lugar.

**Para clientes que necesitan configuración personalizada:**

- Crea una política de Safe Links personalizada con los ajustes de arriba (seguimiento de clics encendido, sin anulación por parte del usuario, protección de apps de Office encendida, sin exclusiones de reescritura salvo necesidad).
- Crea una política de Safe Attachments personalizada con **Dynamic Delivery** como acción.
- Asigna ambas a todos los usuarios (o al alcance correcto; la lección 10 cubre el alcance de preestablecida-y-superposición).

El enfoque preestablecido es correcto para la mayoría. El enfoque personalizado es para clientes con exclusiones específicas que gestionar o acciones específicas que afinar.

## Qué se puede romper

**El ticket de «Safe Links nos está bloqueando el portal del proveedor».** La URL legítima del portal de un proveedor se envuelve, la URL envuelta no se renderiza correctamente porque el sitio del proveedor usa tokens de sesión que no sobreviven al envoltorio, el usuario no puede entrar. El arreglo es añadir el dominio del proveedor a la lista de «no reescribir» — *no* apagar Safe Links para el usuario. (Misma disciplina que los remitentes de confianza en la lección 2.)

**Quejas por retraso en la entrega de adjuntos.** Sin Dynamic Delivery, los usuarios esperan hasta un minuto a que el adjunto se escanee antes de que llegue el correo. Frustrante para ejecutivos que esperan un adjunto *ya*. Dynamic Delivery resuelve esto — el cuerpo del correo llega inmediatamente, el adjunto se rellena. Si Dynamic Delivery no está habilitado, espera tickets la primera semana.

**Documentos legítimos pesados en macros marcándose.** Una macro de Excel legítima que hace algo inusual (un flujo de automatización complejo, una herramienta de informes con macros) puede disparar Safe Attachments. El arreglo es o bien un permitido a nivel de adjunto (raro; hash de archivo específico) o un permitido a nivel de remitente (más habitual; socio de confianza). Se aplica la misma disciplina que los remitentes de confianza antiphishing — comprueba si hay una razón por la que se está marcando el archivo antes de añadir la excepción.

## Despliegue

Para Safe Links específicamente, despliega vía la **preestablecida Standard o Strict** para la base entera de usuarios desde el día 0. La acción de bloqueo solo se dispara con URLs realmente maliciosas, así que el daño colateral es raro. La rotura más habitual es el caso del «portal del proveedor» de arriba, que aflora como tickets en la primera semana y se resuelve con exclusiones puntuales.

Para Safe Attachments, lo mismo — despliegue por preestablecida, acción Dynamic Delivery para que los usuarios no noten el retraso del escaneo, exclusiones para flujos legítimos conocidos pesados en macros añadidas según afloran.

El patrón de despliegue en modo Auditoría (lección 1 de la tarjeta 4) no aplica mucho aquí — estas funcionalidades son de impacto demasiado bajo para justificar una ventana de auditoría de 30 días. El despliegue directo es la norma.

## Qué ve Panoptica365

Dos cosas relevantes para esta lección:

- **Deriva en la habilitación de la política de seguridad preestablecida.** Si el tenant de un cliente tiene Safe Links y Safe Attachments desplegados vía la preestablecida Standard o Strict (el camino recomendado), Panoptica365 vigila si la preestablecida se mantiene habilitada. Que alguien apague la preestablecida — por error o como respuesta a una queja del cliente — dispara una alerta de deriva. El operador puede revertir, reaplicar o aceptar.
- **Los eventos de detección de Defender for Office 365 fluyen por Defender XDR.** Cuando Safe Links bloquea una URL en el momento del clic o Safe Attachments pone en cuarentena un archivo malicioso, el evento de detección subyacente es parte de la telemetría MDO de Microsoft. Cuando la ingesta de Defender XDR está configurada para el cliente (tarjeta 1 lección 4), los incidentes MDO de alta severidad fluyen al motor de alertas de Panoptica365.

Lo que Panoptica365 no expone hoy: tasas de clic por usuario a través de Safe Links, resultados de escaneo por adjunto, las vistas del rastreador de amenazas del portal de Defender. Esas son superficies del portal de Microsoft Defender; entra ahí para el diagnóstico profundo.

## Lo que esto significa para el operador

Tres puntos para llevarte.

**Estas son las funcionalidades que los clientes pagaron y no están usando.** La mayoría de los clientes de pequeña empresa con Business Premium tienen Safe Links y Safe Attachments licenciados. La mayoría los tienen sin configurar. El movimiento de mayor palanca para un MSP incorporando un cliente nuevo es habilitar la preestablecida Standard — tres clics, valor inmediato, sin configuración por usuario.

**Sé honesto sobre los límites.** Safe Links y Safe Attachments pillan el phishing y el malware de mercado masivo que pega a los tenants de pequeña empresa a diario. No pillan una operación AiTM personalizada y decidida, un archivo comprimido con contraseña ni una carga que evade el sandbox. Díselo a los clientes. La historia de la defensa en capas (Safe Links + protección contra suplantación + Acceso Condicional + MFA resistente al phishing + formación de usuarios) es el pitch correcto — no «encendimos Safe Links y ya eres a prueba de balas».

**Dynamic Delivery es la acción correcta para Safe Attachments.** Bloquear la entrega del adjunto mientras el sandbox escanea es la diferencia entre usuarios tolerando Safe Attachments y usuarios odiándolo. Pon la acción en Dynamic Delivery; el cuerpo del correo llega al instante; el adjunto se rellena; nadie nota el trabajo de seguridad.

## Lo que viene

- **Lección 4: SPF, DKIM, DMARC.** El trío de autenticación que cierra la brecha del lado del spoofing. La otra mitad de lo que el antiphishing y Safe Links no pillan.
- **Lección 5: Reenvío automático y reglas de bandeja de entrada.** El par de indicadores post-compromiso — lo que pasa después de que el atacante ya esté dentro, y cómo detectarlos.

Por ahora: abre el portal de Defender del cliente. Mira la superficie de las políticas de seguridad preestablecidas. Si la preestablecida Standard o Strict no está habilitada, has encontrado el cambio de mayor impacto que puedes hacer esta semana. Tres clics. Las funcionalidades por las que el cliente ya está pagando finalmente empiezan a hacer su trabajo.

---

*Fuentes de los datos en esta lección — Microsoft Learn sobre la visión general de Safe Links ([Microsoft Learn — Safe Links in Defender for Office 365](https://learn.microsoft.com/en-us/defender-office-365/safe-links-about)); configuración de la política de Safe Links ([Microsoft Learn — Set up Safe Links policies](https://learn.microsoft.com/en-us/defender-office-365/safe-links-policies-configure)); visión general y ajustes de política de Safe Attachments ([Microsoft Learn — Safe Attachments](https://learn.microsoft.com/en-us/defender-office-365/safe-attachments-about)); acción Dynamic Delivery explicada ([Microsoft Learn — Dynamic Delivery in Safe Attachments](https://learn.microsoft.com/en-us/defender-office-365/safe-attachments-policies-configure)); cobertura de SafeLinks-for-Office y Teams ([Microsoft Learn — Safe Links for Microsoft Teams](https://learn.microsoft.com/en-us/defender-office-365/safe-links-about#safe-links-settings-for-email-messages)); paquete de políticas de seguridad preestablecidas ([Microsoft Learn — Preset security policies](https://learn.microsoft.com/en-us/defender-office-365/preset-security-policies)).*
