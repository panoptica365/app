---
title: "Políticas de seguridad preestablecidas y operar la seguridad del correo a escala"
subtitle: "Usar las políticas Estándar y Estricta de Microsoft para imponer una postura de correo coherente en todos los tenants gestionados."
icon: "layers"
last_updated: 2026-05-29
---

# Políticas de seguridad preestablecidas y operar la seguridad del correo a escala

Un técnico junior, dos semanas en el puesto, le pregunta al sénior un martes por la tarde: «¿Cuándo miraste por última vez los ajustes de seguridad del Cliente X?».

El sénior piensa un segundo. «Honestamente, ¿en su revisión anual hace seis meses? Antes de eso, en la incorporación de 2024».

«¿Entonces no los *compruebas*?».

«No los *compruebo*. Panoptica365 los comprueba. Cada ciclo de sondeo, cada ajuste, cada cliente. Si algo deriva — alguien apaga MailTips porque un usuario se queja, se crea un buzón nuevo y no hereda la postura estricta de auditoría, la acción de la política de spam saliente se debilita — me llega una alerta. Actúo sobre la alerta. Luego sigo adelante. El panel de ajustes es donde voy *cuando salta una alerta*, no un sitio donde patrullo».

«¿Entonces de verdad funciona ponerlo y olvidarlo?».

«Ponlo, configúralo, documenta las excepciones en las notas del cliente, y luego sí — deja que el detector de deriva vigile. La cola de alertas es donde paso mi tiempo. Ese es el modelo entero. Sin él, estaría abriendo 28 paneles de cliente cada lunes por la mañana para verificar que nada cambió. Con él, los cambios vienen a buscarme».

Esta lección trata de cómo eso escala. Las políticas de seguridad preestablecidas Standard y Strict que te dan la mayor parte de los controles de la tarjeta 5 en un paquete. El modelo operativo dirigido por alertas que convierte una cartera de 28 clientes en una cola manejable de triaje en lugar de una tarea de inspección manual. La revisión anual profunda que pilla las cosas que la detección de deriva no puede. Y el registro de excepciones específicas del cliente que evita que rehagas el mismo trabajo por tenant cada año.

## Las políticas de seguridad preestablecidas de Microsoft — Built-in, Standard, Strict

Microsoft entrega tres niveles de política de seguridad preestablecida en Defender for Office 365. Cada uno es un paquete de políticas preconfiguradas cubriendo antispam, antiphishing, antimalware, Safe Links y Safe Attachments — todas las superficies MDO que ha cubierto la tarjeta 5. Cada preestablecida incluye los *ajustes*, el *alcance* (quién recibe qué preestablecida) y las *asignaciones de política de cuarentena* para los mensajes que esos ajustes pillan.

- **Built-in protection** — línea base mínima. Se aplica a cada buzón en cada tenant automáticamente. No configurable. Este es el suelo.
- **Preestablecida Standard** — valores por defecto sensatos para la mayoría de los clientes. Protección contra suplantación de identidad de usuario habilitada con umbrales razonables. Acciones antiphishing puestas en cuarentena. Safe Links y Safe Attachments habilitados con Dynamic Delivery. Políticas de cuarentena puestas en AdminOnlyAccessPolicy para phishing de alta confianza, malware y spoof. Esta es la opción correcta para la mayoría de los tenants de pequeña empresa.
- **Preestablecida Strict** — umbrales más ajustados en todo. Antiphishing más agresivo (más mensajes acaban en cuarentena). Umbral de bulk más bajo (más correo masivo se pilla). AdminOnlyAccessPolicy extendido también a Phishing (no solo de alta confianza). Esta es la opción correcta para industrias reguladas, clientes de mayor riesgo (legal, finanzas, contabilidad) o clientes con un historial reciente de compromisos.

Tanto para Standard como Strict, asignas la preestablecida a usuarios, grupos o dominios. La preestablecida entonces dirige la configuración para esos alcances. Lo que no esté cubierto por Standard o Strict cae de vuelta a Built-in protection.

## Lo que hay realmente en la preestablecida Standard

Vale la pena ser concreto, porque la mayor parte de la tarjeta 5 mapea directamente con ajustes que la preestablecida configura:

- **Antiphishing** — suplantación de identidad de usuario habilitada (configura los usuarios protegidos explícitamente), suplantación de dominio habilitada, antispoofing encendido, mailbox intelligence habilitado. Acciones al detectar: cuarentena.
- **Safe Links** — protección habilitada, comprobación de URL en momento del clic encendida, anulación por usuario deshabilitada, protección de apps de Office encendida (la expansión SafeLinks-for-Office).
- **Safe Attachments** — protección habilitada, acción Dynamic Delivery.
- **Antimalware** — lista común de bloqueo de adjuntos aplicada.
- **Antispam (entrante)** — umbral de bulk y umbrales de spam puestos en los valores de rango medio de Standard.
- **Asignación de política de cuarentena** — AdminOnlyAccessPolicy para Phishing de alta confianza, Malware, Spoof; DefaultFullAccessWithNotificationPolicy para Spam y Bulk.

Lo que Standard *no* configura (tienes que manejar esto aparte aun con la preestablecida):

- La lista de usuarios protegidos por la protección contra suplantación (la preestablecida habilita la funcionalidad; tú especificas quién).
- Entradas personalizadas de remitentes de confianza (por cliente, por relación).
- La política de spam saliente (aparte de la preestablecida).
- Postura de auditoría de buzón, MailTips, control de reenvío de Remote Domain, deshabilitar envío SMTP AUTH — todos estos viven fuera de la preestablecida y necesitan su propia configuración. Estos son los siete ajustes de la categoría Exchange que Panoptica365 monitoriza.

## Standard vs Strict — cuándo usar cuál

El encuadre honesto:

**Usa Standard para:**
- El cliente de pequeña empresa por defecto
- Cualquier tenant donde no se te haya pedido defensas más estrictas
- Clientes sin motores regulatorios específicos
- El primer despliegue a un cliente nuevo (puedes apretar después)

**Usa Strict para:**
- Clientes en industrias reguladas — sanidad, finanzas, legal, contratación pública
- Clientes con un historial de compromisos en los últimos 12 meses
- Clientes donde el valor de negocio de los datos transportados por correo es alto (M&A, intensivos en IP, orientados a transacciones)
- Clientes que han pedido «la protección más fuerte que nos puedas dar» (y han aceptado los compromisos en la conversación con el cliente)

También puedes mezclar por alcance de usuario/grupo. El director general, el director financiero y el equipo financiero reciben Strict; el resto de la empresa recibe Standard. Esto es razonable cuando una parte de la organización tiene un valor objetivo más alto que el resto.

## El patrón de preestablecida + superposición personalizada

Las preestablecidas te dan un valor por defecto defendible; las políticas personalizadas te dan el afinado específico del tenant. El patrón que funciona a escala MSP:

1. **Despliega una preestablecida (Standard o Strict) como fundamento** para todos los usuarios.
2. **Pon encima una política personalizada con prioridad más alta** que añade las partes específicas del cliente: los usuarios protegidos nombrados para suplantación, la lista de remitentes de confianza para socios legítimos, los umbrales por cliente donde divergen de la preestablecida.
3. **Trata la preestablecida como intocable** — cuando un cliente pide un cambio, el cambio va en la superposición personalizada, no en la preestablecida.

Esto mantiene el afinado curado de la preestablecida intacto (para que las actualizaciones de Microsoft fluyan automáticamente) mientras te deja personalizar donde importa. El compromiso es tener dos políticas por cliente en lugar de una; la ventaja es que puedes responder «¿está este cliente aún en la línea base recomendada por Microsoft?» con un sí.

Una peculiaridad que vale la pena conocer: **los nombres de regla de la política preestablecida están con timestamp**. Cuando creas una preestablecida, Microsoft genera nombres de regla que incluyen el timestamp de creación — `Standard Preset Security Policy123456789...`. Si automatizas la creación de la preestablecida o buscas preestablecidas vía PowerShell, usa coincidencia con comodín (`Get-EOPProtectionPolicyRule -Identity 'Standard*'`) en lugar de nombres exactos, porque el nombre será único por tenant y por evento de creación.

## Operar a escala — el modelo dirigido por alertas

La tarjeta 5 entrega siete ajustes de seguridad de la categoría Exchange que Panoptica365 monitoriza por tenant:

1. Disable Automatic Forwarding to External Domains (Crítica)
2. Enable Mailbox Auditing for All Users (Crítica)
3. Enable Preset Security Policy (Standard or Strict) — MDO (Crítica)
4. Strict Mailbox Audit Posture (Bypass + Action List) (Crítica)
5. Enable MailTips (All Tips + External Recipients) (Alta)
6. Configure Anti-Spam Outbound Policy (Restrict Compromised Accounts) (Alta)
7. Disable Basic Auth for SMTP AUTH Submission (Alta)

Una vez configurados en el tenant de un cliente, no necesitas revisitarlos en ninguna agenda. Panoptica365 sondea cada ajuste de cada cliente continuamente. Cuando un ajuste deriva de su valor configurado — alguien apaga MailTips en el centro de administración de Exchange, se crea un buzón nuevo sin la postura estricta de auditoría, la política de spam saliente se debilita como respuesta a un ticket de falso positivo — Panoptica365 dispara una alerta de deriva. La alerta va al equipo de operadores por el pipeline estándar: aparece en el panel de alertas, genera una notificación por correo, está atribuida al cliente específico con el ajuste específico que cambió.

El flujo del operador a escala es por tanto reactivo, no proactivo:

- **Tría la cola de alertas.** Abre el panel de alertas a la cadencia que tenga sentido para el equipo (la mayoría de los MSPs echan un vistazo a diario; las notificaciones por correo de alertas significan que nada se cuela aunque no abras el panel). Cada alerta de deriva es algo que el tenant de un cliente hizo y deberías saber.
- **Para cada alerta, decide la respuesta.** Abre el ajuste de seguridad afectado. Lee la pestaña Historial — cuál era el valor anterior, cuál es el nuevo, cuándo cambió, quién o qué probablemente lo causó. Decide:
  - **Aplicar** — restablecer al valor recomendado. La acción por defecto; apropiada cuando la deriva es un accidente rutinario o un evento conocido (nuevo buzón aprovisionado, etc.).
  - **Aceptar la deriva** — dejar el nuevo valor en su sitio, documentar la razón. Apropiada cuando el cambio es una decisión intencional dirigida por el cliente que has validado.
  - **Investigar más** — cuando el patrón de deriva es lo bastante sospechoso para justificar una mirada más profunda antes de responder. Cuenta de admin comprometida, cambio de configuración no autorizado, patrón inesperado en varios ajustes.
- **Documenta decisiones no rutinarias en las notas del cliente.** El rutinario «buzón nuevo derivado, reaplicado» no necesita mucho. Las derivas aceptadas siempre necesitan una razón en el registro (cubierto abajo). Esto es lo que hace tratable la revisión anual.

Esto es lo que hace que el modelo funcione a escala MSP. No estás inspeccionando manualmente las posturas de los clientes cada lunes; estás respondiendo a un pequeño número de alertas por semana según afloran. Una cartera de 28 clientes típicamente genera un puñado de alertas de deriva por semana — la mayoría de ellas los casos rutinarios de buzón nuevo que se resuelven con un clic de aplicar. Las alertas que no son rutinarias son por definición las que merecen tu atención.

## La revisión anual — qué verificar en profundidad

La revisión semanal de deriva pilla la deriva operativa — buzones nuevos, deshabilitaciones accidentales, cambios en los valores por defecto de Microsoft. No pilla la *deuda de configuración*: excepciones específicas del cliente que se han acumulado, entradas de remitentes de confianza que ya no sirven, anulaciones SMTP AUTH por buzón para impresoras que han sido reemplazadas desde entonces, entradas de Remote Domain para socios con los que el cliente ya no trabaja.

Una vez al año, por cliente — sincronizado con la revisión de seguridad o la conversación de renovación de contrato — haz la auditoría más profunda:

- **Usuarios protegidos por antiphishing.** ¿Sigue la lista al día? ¿Ha cambiado el director financiero? ¿Hay un nuevo interventor? ¿Hay ex-empleados aún en la lista?
- **Remitentes de confianza.** Cada entrada debería tener una razón documentada. Las entradas sin razón se quitan.
- **Entradas Remote Domain** (excepciones de reenvío automático por dominio). Cada una debería referenciar una relación de negocio documentada. Las entradas viejas para ex-socios se quitan.
- **Anulaciones SMTP AUTH por buzón.** Cada una debería tener un dispositivo o app heredada documentada. Dispositivos que ya no existen; apps que han sido reemplazadas — quita la anulación.
- **Transport rules.** La auditoría de cuatro preguntas de la lección 8 — propósito, dueño, sigue-siendo-necesaria, impacto en defensa — aplicada a cada regla.
- **Políticas de cuarentena personalizadas.** Mismo patrón de auditoría.
- **Reglas de flujo de correo** añadidas por el cliente desde la última revisión. ¿Apareció algo nuevo que no autorizaste?
- **Recuento de buzones del cliente.** ¿Crece o decrece? ¿Hay buzones abandonados (ex-empleados) que deberían limpiarse?

Documenta los hallazgos. Quita el peso muerto. Reafirma las excepciones supervivientes. La revisión anual es como evitas que la configuración del cliente se vuelva un cementerio de decisiones tomadas por gente que ya no recuerda por qué.

## Excepciones específicas del cliente — el registro

Cada cliente acumula excepciones legítimas con el tiempo. La disciplina que mantiene cuerdo el modelo a escala es *escribirlas en un solo sitio por cliente*.

Un registro mínimo de excepciones de cliente:

- **Remitentes de confianza de antiphishing** — dominio, protección acotada, razón, fecha de añadido, operador que aprueba.
- **Excepciones de política de cuarentena** — asignaciones de política no-por-defecto, razón, operador que aprueba.
- **Excepciones de reenvío automático de Remote Domain** — dominio, razón, operador que aprueba.
- **Anulaciones SMTP AUTH por buzón** — buzón, dispositivo/app, razón, objetivo de migración planeado, operador que aprueba.
- **Transport rules** — nombre de regla, propósito, dueño, fecha de la última revisión.
- **Reglas de flujo de correo personalizadas** — igual.
- **Personalizaciones de política de seguridad preestablecida** — qué se anula en la superposición personalizada, por qué.

Esto es un documento, no un sistema de configuración. Markdown, Word, página del sistema de tickets — lo que use el MSP. El punto es que cualquier operador que coja la cuenta del cliente pueda leer el registro y entender por qué existe cada excepción, y la revisión anual tiene una lista de comprobación contra la que trabajar.

Sin el registro, cada revisión anual empieza desde cero — los operadores tienen que aplicar ingeniería inversa a la configuración del cliente para entender si cada excepción sigue siendo necesaria. Con el registro, la revisión tarda una hora en lugar de un día.

## Qué ve Panoptica365

El panel de cliente de Panoptica365 expone, por tenant:

- **Todos los ajustes de seguridad con estado actual** (verde / deriva / no monitorizado). La sección de la categoría Exchange contiene los siete ajustes de la tarjeta 5; otras secciones manejan otras superficies.
- **Historial por ajuste** — qué valor ha tenido a lo largo del tiempo, cuándo cambió.
- **Acción de aplicar por ajuste** — reaplicar el valor recomendado cuando se detecta deriva.
- **El pipeline estándar de alertas** para eventos de alta severidad: eventos de Restricted Users de la política de spam saliente, creación sospechosa de transport rules, patrones sospechosos en reglas de bandeja de entrada, incidentes ingeridos por Defender XDR de MDO.

Lo que Panoptica365 *no* expone en el panel: una agregación de flota entre clientes, una matriz de «cada cliente de un vistazo», una vista de comparación entre los ajustes de dos clientes, un registro de excepciones de cliente integrado. El trabajo entre clientes es click-through por cliente, una revisión de lunes por la mañana a la vez. El registro vive fuera de Panoptica365 — en el sistema de documentación del MSP, en la plataforma de tickets, o donde sea que se guarden las notas del cliente.

## Qué se puede romper (a escala)

**El afinado específico del cliente se pierde con la rotación de personal.** El operador que configuró al cliente hace dos años se fue; el operador que hereda la cuenta no sabe por qué la lista de remitentes de confianza tiene la pinta que tiene. El registro de excepciones es el antídoto. Haz que crear entradas en el registro sea parte del flujo de cambio — ninguna excepción entra sin una nota de registro.

**Microsoft actualiza los valores por defecto de las preestablecidas y los clientes se comportan diferente.** Microsoft ocasionalmente endurece o suaviza configuraciones preestablecidas. Los clientes usando preestablecidas reciben el nuevo comportamiento automáticamente. A veces esto es bueno (mejora gratuita); a veces sorprende a usuarios que experimentan un cambio de comportamiento que no entienden. Vigilar las notas de versión de seguridad del correo de Microsoft vale la pena; comunicar cambios mayores de preestablecidas a los clientes proactivamente es el diferenciador.

**Las alertas de deriva se amontonan sin atender durante semanas ajetreadas.** Cuando el equipo va corto, las alertas de deriva son la cosa fácil de despriorizar — «ya me ocuparé el viernes». El coste es invisible hasta que un patrón real de compromiso esté en la cola esperando ser triado. Trata el triaje de alertas como no opcional; enruta las notificaciones de alertas a algún sitio que todos vean; asigna propiedad clara para cada tenant o turno.

**Las revisiones anuales se estiran de anuales a «cuando lleguemos».** El detector de deriva cubre la deriva operativa, pero no pilla la deuda de configuración — remitentes de confianza rancios, entradas Remote Domain abandonadas, anulaciones SMTP AUTH por buzón para impresoras retiradas. La revisión anual es lo único que pilla esas. Ponla en el calendario; factúrala; hazla un entregable que los clientes vean en su informe de servicio.

## Lo que esto significa para el operador

Tres puntos para llevarte.

**Las preestablecidas son el fundamento; la personalización es el diferenciador.** Despliega Standard o Strict a cada cliente como valor por defecto. Pon encima una superposición personalizada para los usuarios protegidos específicos, los remitentes de confianza y el afinado donde importa. Trata la preestablecida como la línea base curada de Microsoft que no tocas; trata la superposición como el sitio donde viven las decisiones específicas del cliente.

**La detección de deriva convierte la seguridad del correo a escala de imposible en reactiva.** Sin detección de deriva, la única forma honesta de operar las posturas de correo de 28 clientes sería una rutina de inspección manual que ningún MSP puede sostener. Con detección de deriva, configuras una vez, documentas las excepciones, y dejas que las alertas vengan a buscarte. El trabajo del operador se vuelve triar una pequeña cola de eventos reales — no patrullar buscando derivas hipotéticas.

**El registro de excepciones es la disciplina poco sexy que se compone.** Cada excepción legítima documentada es un misterio menos para el operador que herede al cliente. Cada revisión anual con un registro es una hora en lugar de un día. Los MSPs que ganan a esta escala no son los que tienen las defensas más astutas — son los que escriben las cosas y las miran una vez al año.

## Cerrando la tarjeta 5

Has visto la postura de endurecimiento del correo a lo largo de diez lecciones:

1. Inventario del chequeo previo y realidad del licenciamiento
2. Protección antiphishing contra suplantación — la brecha BEC de pequeña empresa
3. Safe Links y Safe Attachments — las funcionalidades de MDO P1 que los clientes pagan
4. SPF, DKIM, DMARC — el trío de autenticación de correo
5. Reenvío automático y reglas de bandeja de entrada — el par de indicadores post-compromiso
6. Auditoría de buzón — el registro forense que solo echas en falta cuando lo necesitas
7. Políticas de cuarentena y liberación de usuario — donde mueren los buenos valores por defecto
8. Reglas de flujo de correo y MailTips — las herramientas quirúrgicas y las luces de aviso
9. Spam saliente y SMTP AUTH — controlando el radio de impacto
10. Políticas de seguridad preestablecidas y operar a escala — lo que acabamos de cubrir

El arco: enciende lo que el cliente pagó, configúralo correctamente, vigila la deriva, documenta las excepciones, revisa anualmente. La seguridad del correo no va de desplegar una bala de plata — va de defensas en capas aplicadas con disciplina. El cliente al que nunca le hacen BEC es aquel cuyo MSP hizo el trabajo de las diez lecciones, no el que encendió Safe Links y se dio por satisfecho.

## Lo que viene

- **Tarjeta 6: Secure Score.** La métrica de postura de seguridad a nivel tenant de Microsoft, cómo interpretarla, dónde engaña, y cómo el trabajo MSP de las tarjetas 3, 4 y 5 mapea a recomendaciones específicas de Secure Score.

Por ahora: abre la cola de alertas de Panoptica365. Tría lo que esté ahí. Si la cola es corta — la mayoría de las semanas lo es — cierra la pestaña y haz otra cosa. Así es como se supone que se siente el modelo. El detector de deriva está haciendo la vigilancia para que tú no tengas que hacerla.

---

*Fuentes de los datos en esta lección — Microsoft Learn sobre la visión general de las políticas de seguridad preestablecidas ([Microsoft Learn — Preset security policies](https://learn.microsoft.com/en-us/defender-office-365/preset-security-policies)); diferencias de configuración entre las preestablecidas Standard y Strict ([Microsoft Learn — Recommended settings for EOP and MDO](https://learn.microsoft.com/en-us/defender-office-365/recommended-settings-for-eop-and-office365)); gestión de las políticas de seguridad preestablecidas vía PowerShell ([Microsoft Learn — Manage preset security policies](https://learn.microsoft.com/en-us/defender-office-365/preset-security-policies)); referencia del alcance de Built-in protection ([Microsoft Learn — Built-in protection](https://learn.microsoft.com/en-us/defender-office-365/mdo-support-teams-about)); cmdlet EOPProtectionPolicyRule para las reglas de preestablecida ([Microsoft Learn — Get-EOPProtectionPolicyRule](https://learn.microsoft.com/en-us/powershell/module/exchange/get-eopprotectionpolicyrule)).*
