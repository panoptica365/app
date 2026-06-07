---
title: "Endurecimiento del correo — chequeo previo antes de tocar un solo ajuste"
subtitle: "Realidad del licenciamiento, inventario previo y errores habituales antes de empezar a endurecer el correo."
icon: "clipboard-check"
last_updated: 2026-05-29
---

# Endurecimiento del correo — chequeo previo antes de tocar un solo ajuste

La interventora de un cliente recibe un correo del director general. Urgente — un proveedor está en apuros, necesita una transferencia de 84 000 $ a una cuenta nueva antes del cierre del día. La interventora hace la transferencia. Doce horas más tarde el director real vuelve de un vuelo y pregunta para qué era esa transferencia. El correo era falsificado. El «proveedor» era una cuenta mula rumana. El seguro del cliente cubre la mitad. El abogado del cliente le pregunta al MSP, primero amablemente y después menos amablemente, por qué las defensas de correo que le están pagando no detectaron esto.

El post-mortem es deprimente en sus detalles:

- El dominio del cliente no tenía registro DMARC. SPF estaba en `~all` (soft-fail), que Microsoft 365 aceptaba igualmente porque rechazar habría sido «demasiado disruptivo».
- La política antiphishing era la de Microsoft por defecto. La protección contra la suplantación de identidad del director general no estaba activada. El antispoofing no estaba afinado.
- Safe Links estaba licenciado (Business Premium incluye Defender for Office 365 Plan 1) pero nunca se había configurado. El enlace clicable en el correo de las instrucciones de transferencia era una redirección sin envolver hacia una página de captura de credenciales.
- La liberación de cuarentena estaba en el valor por defecto de Microsoft para cada usuario, así que aunque el mensaje hubiera estado en cuarentena, la interventora podría haberlo liberado ella misma.
- El cliente pagaba por toda esta protección. Cada mes. Durante años.

La tarjeta 5 trata de cerrar esa brecha. El entorno de correo del cliente es la superficie más atacada de M365 — phishing, BEC, suplantación de identidad, malware, ataques de consentimiento OAuth, todo llega por correo — y los valores por defecto de Microsoft están afinados para la compatibilidad, no para la seguridad. El trabajo de la tarjeta 5 es coger las defensas que están *disponibles* y *pagadas* y *encenderlas, afinarlas correctamente, con la disciplina adecuada alrededor de los flujos humanos*.

Esta lección es el chequeo previo: la realidad del licenciamiento, el inventario que necesitas antes de tocar un ajuste, lo que M365 trae ya configurado de fábrica, y los errores habituales que cometen los operadores antes incluso de empezar.

## La realidad del licenciamiento — qué tienes y qué no

La defensa del correo en M365 vive en tres servicios apilados. Saber cuál tiene el cliente es el prerrequisito de todo lo demás en la tarjeta 5.

**Exchange Online Protection (EOP).** Gratis, incluido con cualquier licencia de buzón M365. EOP es la capa antispam, antimalware y de filtrado de conexión. Pilla la mayor parte del spam obvio y del malware conocido. Cada tenant de M365 lo tiene. No pagas extra por él, pero igual tienes que configurarlo — los valores por defecto son deliberadamente permisivos.

**Defender for Office 365 Plan 1 (MDO P1).** Incluido con Microsoft 365 Business Premium, la licencia con la que debería estar casi cualquier cliente MSP de pequeña empresa. Añade Safe Links (reescritura de URL y evaluación en el momento del clic), Safe Attachments (detonación de adjuntos en sandbox), detecciones en tiempo real y antiphishing mejorado (mailbox intelligence, protección contra la suplantación de identidad de usuario, protección contra la suplantación de dominio). Es la mejora significativa frente a EOP y la que los clientes normalmente ya están pagando sin darse cuenta. La mayor parte de la tarjeta 5 asume que tienes P1.

**Defender for Office 365 Plan 2 (MDO P2).** Incluido con Microsoft 365 E5 / A5 / G5 (SKUs de nivel empresarial). Añade Threat Explorer, investigación y respuesta automatizadas, formación con simulación de ataques y rastreadores de amenazas. Casi ningún cliente de pequeña empresa lo tiene. Mencionaremos las funcionalidades de P2 de pasada donde toque; no nos detendremos. Si tu cliente tiene E5 lo sabrás, y vas a querer apoyarte en la documentación de Microsoft Learn para esas funcionalidades específicas en lugar de esperar que la tarjeta 5 las cubra en profundidad.

Lo que hay que interiorizar: los clientes con Business Premium tienen una mejora significativa de seguridad sobre Business Standard, pero la mejora solo cuenta si efectivamente la enciendes. El cliente de la transferencia fraudulenta de la anécdota inicial estuvo pagando P1 todo ese tiempo. El MSP simplemente no había configurado Safe Links.

## Lo que M365 trae ya configurado de fábrica

Microsoft sí configura *algunas* defensas de correo de salida. El truco es saber cuáles, porque a menudo son más débiles de lo que los operadores asumen.

**Ya encendido, con valores por defecto:**

- La política antispam entrante por defecto. Pilla el spam obvio (nivel de confianza alto). El umbral de correo bulk está en 7 (rango medio — deja pasar la mayoría del correo de marketing). Se permite la liberación de cuarentena por el usuario.
- La política antimalware por defecto. Pilla adjuntos conocidos como maliciosos por coincidencia de hash. Extensiones de archivo habituales bloqueadas (.exe, .bat, .cmd, y algunas más).
- La política antiphishing por defecto. Antispoofing habilitado. Protección antiphishing contra *la suplantación de identidad de usuario* — **no configurada por defecto**. Protección contra *la suplantación de dominio* — **no configurada por defecto**.
- Política de filtro de conexión. Sin lista de IPs permitidas ni bloqueadas por defecto.
- DKIM por defecto. Microsoft autogenera una clave DKIM para el dominio `onmicrosoft.com` del tenant únicamente. Los dominios personalizados requieren configuración manual.

**No configurado por defecto — esto tienes que encenderlo tú:**

- Políticas de Safe Links. Aun con la licencia P1, Safe Links no está habilitado para los usuarios hasta que crees una política y la asignes a grupos de usuarios.
- Políticas de Safe Attachments. Lo mismo — licencia presente, funcionalidad apagada hasta que la configures.
- DMARC. DNS del cliente, responsabilidad del cliente (o del MSP). M365 no publica registros DMARC por ti.
- DKIM para dominios personalizados. Las claves DKIM existen; tienes que publicar los CNAMEs en DNS y habilitar la firma por dominio.
- Reenvío automático a dominios externos. Microsoft endureció los valores por defecto en 2020 para bloquear esto, pero todavía pueden existir listas de excepción por cliente venidas de proyectos de migración.
- Protección antispam saliente (restricciones personalizadas). La política saliente por defecto es permisiva — un buzón comprometido puede enviar mucho correo antes de tropezar con los umbrales por defecto.
- Reglas de flujo de correo (transport rules). Ninguna por defecto.
- Registro de auditoría de buzón en modo estricto. La auditoría está encendida por defecto desde 2019, pero el conjunto *estricto* de acciones auditadas (las que pillan los rastros de BEC) necesita configuración explícita.

El patrón: Microsoft entrega el suelo. La licencia cubre el techo. La tarjeta 5 trata de levantar la postura del cliente desde el suelo al techo.

## Inventario — saber qué estás endureciendo

Antes de tocar un solo ajuste, recopila estos datos sobre el entorno del cliente:

**Buzones.** ¿Cuántos? Ejecuta `Get-Mailbox` en Exchange Online PowerShell o saca el recuento del centro de administración de Microsoft 365. Anota el desglose:

- Buzones de usuario (humanos reales).
- Buzones compartidos (acceso delegado; a menudo débilmente protegidos y a menudo la fuente de los relatos del «la asistente del director cayó en el phishing»).
- Buzones de recurso (salas, equipos).
- Listas de distribución y grupos de Microsoft 365.

Para un cliente pequeño esto son entre 10 y 50 entidades; para uno mediano, entre 100 y 300. En cualquier caso, *escribe el inventario*. Vas a volver a él para el alcance de la liberación de cuarentena, el alcance de la postura de auditoría de buzón y el alcance de la protección contra suplantación.

**Dominios.** Cada dominio aceptado en el tenant. El dominio primario (usado en los UPN de usuario), los dominios secundarios (dominios aceptados adicionales desde los que envía el cliente), los dominios heredados (de adquisiciones o cambios de marca), el `onmicrosoft.com` por defecto (el fallback a nivel suelo). Para cada uno, anota:

- Registro SPF actual (TXT de DNS — empieza con `v=spf1 include:spf.protection.outlook.com -all` como estado final objetivo).
- Estado actual de DKIM (¿habilitado por dominio? ¿CNAMEs publicados?).
- Registro DMARC actual (¿publicado? `p=none` / `p=quarantine` / `p=reject`?).
- Si el dominio se usa para envío saliente desde M365 (algunos dominios heredados existen solo para recibir; esos también necesitan DMARC).

**Flujo de correo actual.** Abre el centro de administración de Exchange, ve a Flujo de correo → Reglas. Lee cada regla. Documenta el propósito. Muchos clientes tienen una capa de sedimentos de transport rules de administradores anteriores haciendo cosas anteriores — viejas reglas de «si el asunto contiene [URGENT] entonces importancia alta», viejas advertencias de destinatarios externos que ya no se disparan, viejas reglas de bloqueo de ejecutables hechas obsoletas por Safe Attachments. La lección 8 trata de domar esto; para el chequeo previo, basta con saber qué hay ahí.

**Estado de protección existente.** Una auditoría rápida de la postura actual usando `Get-AntiPhishPolicy`, `Get-SafeLinksPolicy`, `Get-SafeAttachmentPolicy` y `Get-HostedContentFilterPolicy` (la política antispam). Para cada una, anota: ¿es la política por defecto de Microsoft, o el administrador anterior la ha personalizado? Las políticas personalizadas en estados desconocidos son la fuente más habitual de tickets del tipo «desplegamos Safe Links pero no pasó nada».

## Qué espera el cliente

Esta es la parte blanda del chequeo previo, y la parte que los operadores se saltan. Las defensas del correo rompen flujos del cliente constantemente — las defensas afinadas para phishing pillan algo de correo legítimo de marketing; un DMARC endurecido echa a la plataforma de marketing mal configurada del propio cliente de la bandeja de entrada; un Safe Attachments agresivo retrasa el PDF importante de un ejecutivo 90 segundos. Los clientes sienten esto como fricción.

Documenta, en el ticket o registro de cambios, antes de desplegar:

- ¿Quién en el cliente está autorizado a liberar mensajes de cuarentena? Por defecto-todo-el-mundo es peligroso; por defecto-solo-admin es restrictivo. A menudo la respuesta correcta es «el jefe de la interventora más una o dos personas de confianza», y eso hay que comunicarlo y configurarlo.
- ¿Hay remitentes de los que el cliente recibe correo rutinariamente que probablemente tropiecen con los controles de suplantación o antiphishing? (Proveedores con dominios parecidos al del cliente; plataformas legítimas de marketing con DKIM débil; aplicaciones SaaS que envían desde SMTP de terceros.)
- ¿Hay algún dominio que *no debería endurecerse* todavía porque el equipo de marketing del cliente usa una plataforma de terceros para enviar desde él y no han arreglado su SPF? (Habitual; este es el alcance adecuado para una conversación aparte.)
- ¿Hay requisitos de cumplimiento que afecten a retención, retención legal o políticas de cuarentena? (Habitual en sanidad, finanzas y contratación pública.)

## Errores habituales que cometen los operadores antes incluso de empezar

Tres patrones afloran repetidamente:

**Asumir «Microsoft nos tiene cubiertos».** No lo tienen. Los valores por defecto son el suelo, no el techo. Auditar el estado actual antes de asumir que existe protección ha salvado a más clientes que cualquier cambio de política individual.

**Saltarse DMARC porque «es complicado».** No es complicado, es *un proceso* — hay un recorrido desde `p=none` (observar) hasta `p=quarantine` y luego `p=reject` (aplicar). La lección 4 lo recorre. Saltarse DMARC es como empieza la anécdota de la transferencia fraudulenta al principio de esta lección.

**No auditar las reglas de flujo de correo del cliente.** Tres años de transport rules acumuladas por administradores anteriores son un lío. A veces hay una regla enrutando correo de `*@finance.com` a un buzón único por una fusión hace mucho olvidada. A veces hay una regla deshabilitando Safe Links sobre cierto correo entrante porque un proveedor se quejó. A veces hay una regla reenviando *cualquier cosa* que case con una regex a una dirección externa porque alguien estaba depurando un problema en 2021 y se olvidó de limpiar. Encuéntralas. Documéntalas. Arréglalas o quítalas. (Lección 8.)

## Lo que esto significa para el operador

Tres puntos para llevarte.

**La realidad del licenciamiento es el prerrequisito.** Confirma qué tiene el cliente (solo EOP / MDO P1 / MDO P2) antes de prometer ninguna de las defensas de la tarjeta 5. La mayoría de los clientes de pequeña empresa tienen MDO P1 vía Business Premium; la mayoría no lo está usando.

**Encendido por defecto no significa seguro por defecto.** Microsoft entrega un suelo utilizable — antispam funcionando, malware conocido bloqueado, antispoofing básico existente. Nada de eso está afinado. El trabajo de la tarjeta 5 es levantar desde el suelo al techo para cada funcionalidad.

**Inventario antes de configuración.** Buzones, dominios, SPF/DKIM/DMARC actuales, reglas de flujo de correo existentes, políticas personalizadas existentes. Sin esta lista, vas a configurar la mitad de un pase de endurecimiento y a romper de nuevo la mitad que te perdiste cuando un ticket del cliente saque a la luz una regla de la que no sabías nada.

## Lo que viene

- **Lección 2: Políticas antiphishing.** Protección contra la suplantación de identidad de usuario y de dominio, inteligencia de spoof, inteligencia de buzón — convirtiendo la defensa contra suplantación apagada-por-defecto de Microsoft en algo que realmente pilla la anécdota de BEC del principio de esta lección.
- **Lección 3: Safe Links y Safe Attachments.** Las funcionalidades de MDO P1 que los clientes pagaron sin usar.
- **Lección 4: SPF, DKIM, DMARC.** El trío de autenticación que habría pillado el correo falsificado de la historia inicial.

Por ahora: escribe el inventario, audita la configuración actual, marca las expectativas del cliente sobre lo que está a punto de cambiar. El resto de la tarjeta 5 se construye sobre esta base.

---

*Fuentes de los datos en esta lección — Microsoft Learn sobre la visión general de Exchange Online Protection ([Microsoft Learn — EOP overview](https://learn.microsoft.com/en-us/defender-office-365/eop-about)); descripción del servicio Defender for Office 365 ([Microsoft Learn — MDO service description](https://learn.microsoft.com/en-us/office365/servicedescriptions/office-365-advanced-threat-protection-service-description)); lista de funcionalidades de Microsoft 365 Business Premium ([Microsoft Learn — Business Premium for SMB](https://learn.microsoft.com/en-us/microsoft-365/business-premium/)); referencia de las políticas de seguridad preestablecidas ([Microsoft Learn — Preset security policies](https://learn.microsoft.com/en-us/defender-office-365/preset-security-policies)); bloqueo del reenvío automático a dominios externos ([Microsoft Learn — External email forwarding](https://learn.microsoft.com/en-us/defender-office-365/outbound-spam-policies-external-email-forwarding)); Set-MailboxAuditBypassAssociation y línea base de auditoría ([Microsoft Learn — Mailbox audit logging](https://learn.microsoft.com/en-us/purview/audit-mailboxes)).*
