---
title: "Auditoría de buzón — el registro forense que solo echas en falta cuando lo necesitas"
subtitle: "Habilitar y verificar los registros de auditoría de buzón para reconstruir exactamente qué leyó, movió o eliminó un atacante durante una brecha."
icon: "eye"
last_updated: 2026-05-29
---

# Auditoría de buzón — el registro forense que solo echas en falta cuando lo necesitas

La interventora de un cliente cae en un phishing un miércoles. El atacante tiene su buzón durante seis días. El MSP pilla el compromiso el martes siguiente — un socio llama por instrucciones de transferencia fraudulentas, el MSP confirma la brecha, restablece credenciales, revoca sesiones, abre un incidente.

Ahora la pregunta que determina todo lo que viene después: **¿qué vio el atacante?**

El abogado del cliente necesita saberlo. El asegurador necesita saberlo. El responsable de protección de datos necesita saber si se cruzaron los umbrales de notificación de brecha. Los clientes, contratistas y contrapartes del cliente pueden necesitar ser informados dependiendo de lo que hubiera en esos mensajes. La transferencia fraudulenta ya está en marcha — cuantificar la *divulgación de información* es el siguiente paso.

El MSP abre el Registro de Auditoría Unificado. Eventos de inicio de sesión: presentes. Creación de regla de bandeja de entrada: presente. Mensajes salientes enviados por el atacante: presentes. Consultas de búsqueda que el atacante corrió dentro del buzón: presentes. ¿La lista exacta de mensajes que el atacante realmente abrió y leyó?

Nada. Porque **MailItemsAccessed no se estaba auditando.**

La configuración de auditoría de buzón por defecto que entrega Microsoft no incluye MailItemsAccessed en la lista de acciones auditadas. El MSP puede probar que el atacante estaba conectado. El MSP puede probar que el atacante envió correo malicioso. El MSP no puede probar qué mensajes entrantes leyó el atacante, qué hilos históricos exfiltró, sobre qué discusiones confidenciales tuvo visibilidad.

El alcance de la notificación de brecha se infla a «tenemos que asumir todo». Seis años de correo. Cada contrato adjunto, cada discusión de M&A, cada asunto de RR. HH. que la interventora tenía en su buzón. La reclamación al seguro multiplicándose por un orden de magnitud. Las obligaciones de divulgación multiplicándose en proporción.

Este es el coste de saltarse el trabajo de postura de auditoría de buzón. Esta lección trata de no pagarlo.

## Qué registra realmente la auditoría de buzón

La auditoría de buzón es la propiedad por buzón que determina qué acciones se registran en el Registro de Auditoría Unificado cuando ocurren en ese buzón. Ha estado encendida por defecto desde 2019 — pero «encendida» no significa «registrando todo», y la lista de acciones por defecto es mucho más estrecha de lo que la mayoría de los operadores asumen.

Tres clases de actor se auditan independientemente:

- **AuditOwner** — acciones realizadas por el dueño primario del buzón (es decir, el usuario conectado a su propio buzón).
- **AuditDelegate** — acciones realizadas por usuarios con acceso delegado (asistentes, miembros de buzón compartido, cualquiera con permisos sobre el buzón).
- **AuditAdmin** — acciones realizadas por administradores sobre el buzón (vía PowerShell, eDiscovery, etc.).

Cada uno es una lista de acciones auditadas. Los valores por defecto de Microsoft incluyen cosas como:

- **Update** — propiedades de mensaje cambiadas.
- **Move** / **MoveToDeletedItems** — mensaje movido a una carpeta o a Elementos eliminados.
- **SoftDelete** / **HardDelete** — mensaje eliminado de forma recuperable o permanente.
- **SendAs** / **SendOnBehalf** — mensaje enviado bajo otra identidad.
- **Create** — nuevo elemento creado (típicamente por admins/scripts).
- **MailboxLogin** — dueño iniciando sesión en el buzón.

Lo que **no** está en los valores por defecto (para la mayoría de los tenants) y más importa para el forense:

- **MailItemsAccessed** — el mensaje se abrió o se descargó. Esta es la acción que responde «¿qué vio el atacante?». Sin ella en la lista auditada, no puedes reconstruir la actividad de lectura post-compromiso.
- **Send** — mensaje enviado desde el buzón. Los valores por defecto registran SendAs y SendOnBehalf pero no la propia acción Send del usuario en algunas configuraciones. Vale la pena verificarlo por buzón.
- **SearchQueryInitiatedExchange** — búsqueda realizada dentro del buzón. Te dice qué estaba buscando el atacante.

## La puerta de Premium audit (en gran parte cerrada para Business Premium ahora)

MailItemsAccessed y SearchQueryInitiatedExchange solían ser solo de E5 — etiquetados como acciones de «Premium audit». Microsoft expandió la disponibilidad a lo largo de 2024–2025 y estas acciones específicas ahora están disponibles también en tenants Microsoft 365 Business Premium. El beneficio restante con barrera de E5 es la **duración de retención**: la auditoría Standard guarda registros 180 días; la retención Premium se extiende a 1 año por defecto. Para clientes de pequeña empresa sin E5, 180 días suele bastar para la respuesta a incidentes (el escenario de la interventora con phishing de arriba se resuelve en semanas), pero vale la pena conocer el límite al alcanzar una investigación de cola más larga.

## Audit Bypass — la salida silenciosa del atacante

Existe una propiedad por buzón llamada `AuditBypassEnabled`. Cuando se pone a `$true` (vía `Set-MailboxAuditBypassAssociation`), las acciones realizadas sobre ese buzón por la identidad omitida *no se registran en absoluto*. Típicamente se usa para cuentas de servicio legítimas cuya actividad normal generaría ruido de auditoría.

También es la propiedad de los sueños del atacante. Una cuenta comprometida con derechos de admin puede poner su propio buzón (u otro buzón que esté comprometiendo) a AuditBypassEnabled=$true y luego operar sin dejar rastro de auditoría. Cuando el MSP investiga, los eventos relevantes nunca se escribieron.

La postura estricta de auditoría de buzón tiene un trabajo específico aquí: **pillar banderas `AuditBypassEnabled` inesperadas**. La lista de bypass debería estar vacía o contener solo cuentas de servicio conocidas con una razón documentada para estar ahí. Cualquier buzón que no esperabas ver en la lista de bypass merece investigación.

## La postura estricta de auditoría de buzón — qué configura realmente

Dos cosas distintas, que Panoptica365 monitoriza como dos ajustes de seguridad distintos en la lista de categoría Exchange:

**«Enable Mailbox Auditing for All Users»** — verifica que cada buzón de usuario en el tenant tiene `AuditEnabled=$true`. Microsoft lo enciende por defecto para tenants nuevos, pero los buzones heredados de configuraciones más antiguas, migraciones o scripts de aprovisionamiento específicos pueden tenerlo deshabilitado. Si aunque sea un buzón tiene la auditoría apagada, ese buzón es un punto ciego. Panoptica365 comprueba la propiedad en todos los buzones e informa cumplimiento/no cumplimiento.

**«Strict Mailbox Audit Posture (Bypass + Action List)»** — el más enrevesado. Dos chequeos enrollados en un ajuste:

1. **La lista de bypass está limpia.** Ningún buzón tiene `AuditBypassEnabled=$true` salvo aprobación explícita. Cualquier entrada inesperada de bypass falla el ajuste.
2. **La lista de acciones es exhaustiva.** Las listas `AuditOwner`, `AuditDelegate` y `AuditAdmin` del buzón incluyen las acciones de alto valor (MailItemsAccessed, Send, SearchQueryInitiatedExchange, las variantes de eliminación, las variantes de SendAs / SendOnBehalf). Los buzones con la lista de acciones por defecto más estrecha fallan el ajuste.

Ambos ajustes pueden aplicarse a nivel tenant vía PowerShell. El comando fundamental es `Set-Mailbox <identidad> -AuditEnabled $true -AuditOwner @{Add="MailItemsAccessed","Send","SearchQueryInitiatedExchange",...} -AuditLogAgeLimit 180.00:00:00`. El flujo de aplicación de Panoptica365 corre esto en cada buzón del tenant del cliente cuando se empuja el ajuste.

## La deriva del nuevo buzón — la realidad operativa

Aquí está el truco operativo, y es el escenario canónico de deriva de auditoría de buzón:

Aplicas la postura estricta de auditoría de buzón a los 32 buzones del cliente. Los 32 pasan el chequeo. Estado del ajuste: Monitorizado — OK. Dos semanas después, el cliente contrata a alguien nuevo. RR. HH. aprovisiona la cuenta a través de tu proceso estándar. Entra ID crea el usuario; M365 aprovisiona el buzón; el usuario inicia sesión y empieza a trabajar.

El buzón recién aprovisionado tiene los ajustes de auditoría por defecto de Microsoft. No la postura estricta que tú configuraste para los 32 existentes. **Los buzones nuevos no heredan automáticamente tu configuración de auditoría.**

El detector de deriva de Panoptica365 pilla esto. La próxima vez que corra el sondeo de ajustes de seguridad, el chequeo informa: «32 de 33 buzones tienen la postura estricta de auditoría. 1 no la tiene». Salta una alerta de deriva.

Abres el ajuste de seguridad, le das a la acción de aplicar, y Panoptica365 reaplica la postura estricta a través de todos los buzones — incluido el nuevo. La deriva se resuelve. El ajuste vuelve a Monitorizado — OK. El buzón nuevo ahora tiene la misma postura de auditoría que el resto del parque.

Esto va a pasar cada vez que se cree un buzón nuevo. No hay mecanismo de Microsoft para auto-aplicar la postura estricta en el momento del aprovisionamiento; el paso de reaplicar del operador es el workaround. Planifícalo en tu flujo de onboarding: cuando el cliente añada un usuario, espera una alerta de deriva dentro del día, y corre el reaplicar.

## Qué ve Panoptica365

La postura de auditoría de buzón es uno de los ejemplos más fuertes del modelo de detección de deriva de Panoptica365 en el lado de Exchange.

**Dos ajustes de seguridad** monitorizados por tenant:
- «Enable Mailbox Auditing for All Users» — comprueba `AuditEnabled` por buzón.
- «Strict Mailbox Audit Posture (Bypass + Action List)» — comprueba limpieza de la lista de bypass de auditoría y exhaustividad de la lista de acciones por buzón.

**Alertas de deriva** cuando cualquiera de los ajustes pasa de cumplimiento a no-cumplimiento — el caso del buzón nuevo siendo el disparador más habitual. La alerta aparece en el pipeline estándar de alertas con atribución al cliente.

**La acción de aplicar** en cada ajuste, que corre el PowerShell relevante en todos los buzones del tenant del cliente para devolverlos al cumplimiento.

Lo que Panoptica365 *no* expone en el panel: detalle de la configuración de auditoría por buzón, el volumen de eventos de auditoría por buzón, el contenido real del registro de auditoría. Para el propio registro de auditoría — qué eventos se han registrado, qué búsquedas se han corrido, a qué accedió realmente el atacante — entra en la búsqueda del registro de auditoría de Microsoft Purview en el portal de Defender.

## Qué se puede romper

**El techo de retención de 180 días para incidentes que afloran tarde.** Una brecha descubierta seis meses después puede estar parcialmente fuera de la ventana de auditoría — la actividad más temprana del atacante puede haber caducado ya. El arreglo es o E5 / Premium Audit para retención más larga (la mayoría de las pequeñas empresas no pagarán esto) o detección más temprana (que es de lo que trata el resto del currículum).

**Entradas de bypass de auditoría de cuentas de servicio que no documentaste.** Algunas cuentas de servicio legítimas tienen AuditBypassEnabled puesto por razones operativas válidas — una herramienta de copia de seguridad que toca cada buzón, un archivador de terceros, una plataforma de integración. Cuando el ajuste de postura estricta de auditoría dispare una alerta de deriva sobre una entrada de bypass inesperada, la respuesta correcta es investigar, documentar la razón si es legítima, y añadir la cuenta a una lista aprobada de excepciones de bypass en tu runbook. *No* simplemente deshabilites el chequeo de deriva; así es como la entrada de bypass legítima-en-apariencia-pero-maliciosa se cuela después.

**Inquietudes de los clientes por «ruido de auditoría».** Algunos clientes preguntan «¿estáis leyendo el correo de nuestros empleados?» cuando oyen la palabra «auditoría». La respuesta honesta: la auditoría de buzón registra *metadatos sobre eventos* (quién accedió a qué, cuándo), no contenido del mensaje. Las entradas del registro de auditoría dicen «el usuario X abrió el mensaje Y a las 14:23»; no dicen qué contenía el mensaje. Comunícalo claramente para evitar la conversación incómoda después.

## Lo que esto significa para el operador

Tres puntos para llevarte.

**La auditoría de buzón es el registro forense que solo echas en falta cuando lo necesitas.** Los clientes no preguntan por la postura de auditoría de buzón hasta que han sido comprometidos y el abogado está preguntando qué datos se exfiltraron. Para entonces la configuración de auditoría está puesta; no puedes decidir retroactivamente haber registrado MailItemsAccessed. Ponla estricta, ponla en todos los buzones, acepta el ritmo de derive-y-reaplica como coste operativo permanente.

**Los buzones nuevos son la fuente recurrente de deriva.** Cada usuario nuevo aprovisionado crea un buzón con los ajustes de auditoría por defecto de Microsoft — no tu configuración estricta. La alerta de deriva es la señal; el reaplicar es el flujo. Los manuales de onboarding deberían incluir explícitamente «esperar alerta de deriva de Panoptica365, ejecutar reaplicar» como paso.

**La lista de Bypass es el escondite del atacante.** Periódicamente — y desde luego como parte de cualquier triaje de respuesta a incidentes — audita la propiedad AuditBypassEnabled en todos los buzones. Una entrada inesperada merece investigación hasta que se demuestre legítima. La postura estricta de auditoría pilla la deriva rutinaria; el ojo del operador pilla la rara deriva adversaria.

## Lo que viene

- **Lección 7: Políticas de cuarentena y liberación de usuario.** Quién puede liberar mensajes en cuarentena, por qué los valores por defecto son peligrosos, y cómo la liberación dirigida por el atacante de cuarentena se vuelve un vector complementario al BEC.
- **Lección 8: Reglas de flujo de correo y MailTips.** Transport rules — el poder que dan a los operadores y el abuso que habilitan cuando se configuran de forma laxa.

Por ahora: abre el panel de ajustes de seguridad del cliente en Panoptica365. Encuentra los dos ajustes de auditoría de buzón. Si no están verdes, aplícalos ahora. El primer aplicar puede tardar unos minutos para un recuento grande de buzones; los aplicar siguientes (tras derivas de buzones nuevos) son rápidos. Prepara al cliente para la respuesta correcta a la pregunta que el abogado eventualmente hará.

---

*Fuentes de los datos en esta lección — Microsoft Learn sobre la visión general de la auditoría de buzón y acciones por defecto ([Microsoft Learn — Manage mailbox auditing](https://learn.microsoft.com/en-us/purview/audit-mailboxes)); referencia de parámetros de auditoría de Set-Mailbox ([Microsoft Learn — Set-Mailbox](https://learn.microsoft.com/en-us/powershell/module/exchange/set-mailbox)); cambios de disponibilidad de MailItemsAccessed y Premium audit ([Microsoft Learn — Audit Solutions in Microsoft Purview](https://learn.microsoft.com/en-us/purview/audit-solutions-overview)); referencia de Set-MailboxAuditBypassAssociation ([Microsoft Learn — Set-MailboxAuditBypassAssociation](https://learn.microsoft.com/en-us/powershell/module/exchange/set-mailboxauditbypassassociation)); flujo de búsqueda del Registro de Auditoría Unificado ([Microsoft Learn — Audit log search](https://learn.microsoft.com/en-us/purview/audit-log-search)).*
