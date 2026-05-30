---
title: "La Security Baseline — tu paquete curado de endurecimiento de Windows"
subtitle: "98 ajustes de endurecimiento de Windows cuidadosamente seleccionados en un perfil — la postura opinada de un MSP experto, no la baseline oficial de Microsoft."
icon: "shield-check"
last_updated: 2026-05-29
---

# La Security Baseline — tu paquete curado de endurecimiento de Windows

La plantilla Security Baseline de Panoptica365 es el artefacto individual más grande de la biblioteca de Intune — alrededor de 98 ajustes individuales empaquetados en un único Perfil de Configuración. No es la Windows Security Baseline oficial de Microsoft. Esa distinción importa y llegaremos a ella. Lo que es, en su lugar, es un paquete curado de ajustes de endurecimiento de Windows recogidos a lo largo de los años desde páginas de Microsoft Learn, blogs de MVP, escritos de investigadores de seguridad y lecciones reales aprendidas en despliegues con clientes. Piénsalo como «la postura de endurecimiento de Windows que un MSP experimentado recomendaría si le pidieras que escogiera los ajustes que importan y se saltara los que no».

Esta lección recorre lo que hay dentro, cómo pensar sobre ella cuando la despliegas, y cómo hablar de ella con los clientes que pregunten «¿es esta la Microsoft Security Baseline?».

## Qué es, sin rodeos

La plantilla:

- Se aplica a dispositivos **Windows 10 / Windows 11** únicamente (`platforms: windows10`).
- Usa el tipo de plantilla **Settings Catalog** (`configurationPolicies`), lo que significa que vive en la sección Settings Catalog del portal de Intune, no en la sección de plantillas heredadas.
- Configura **unos 98 ajustes distintos**, organizados en unas 20 categorías de ajustes.
- Toca políticas tanto de **ámbito de dispositivo** como de **ámbito de usuario** — es decir, configura algunas cosas a nivel de máquina y otras a nivel por-usuario (p. ej., las restricciones de AutoPlay aplican por-usuario; las opciones de seguridad aplican al dispositivo).

Los ajustes abarcan: políticas de seguridad local, comportamiento de cuenta, bloqueo del dispositivo, AutoPlay, comportamiento Wi-Fi, PowerShell, Servicios de Escritorio Remoto, Gestión Remota, defensa contra amenazas web (integración con SmartScreen), restricciones de Chrome Remote Desktop, ajustes de MS Security Guide, opciones de energía, ajustes de GPO migrados a AdmX, y configuraciones de Microsoft Edge.

Lo que esta plantilla *no* configura:

- BitLocker (plantilla separada — lección 4).
- Ajustes de Microsoft Defender Antivirus (plantilla separada — lección 5).
- Windows Defender Firewall (plantilla separada — lección 6).
- Reglas ASR (plantilla separada — lección 7).
- Windows Hello / Credential Guard (plantilla separada — lección 8).
- Windows Update for Business (no está en la biblioteca — lo gestiona la herramienta de RMM del MSP).

La Security Baseline complementa a esas otras plantillas en lugar de solaparse con ellas. Donde un ajuste podría plausiblemente vivir en la Security Baseline o en una plantilla dedicada (p. ej., algunas opciones adyacentes a Defender), la biblioteca de Panoptica365 lo pone en la plantilla dedicada — manteniendo la Security Baseline como el paquete de endurecimiento «todo lo demás».

## No es la Windows Security Baseline oficial de Microsoft

Esto necesita un encuadre explícito porque el nombre de la plantilla invita a la confusión. Microsoft publica sus propias **Windows Security Baselines** — paquetes de ajustes formales, documentados y opinionados que Microsoft actualiza con cada versión mayor de Windows. Se publican en el portal de Intune bajo Endpoint Security → Security baselines. Cuando creas una de esas, Microsoft aplica su propio conjunto curado de ajustes.

La **plantilla Security Baseline de Panoptica365** *no* es una de esas. Es un artefacto separado, curado por el MSP, que:

- Fue ensamblado a mano basándose en orientación de MVP, artículos de MS Learn, posts de blogs de seguridad y experiencia del mundo real.
- Se actualiza según el calendario del MSP, no el de Microsoft.
- Puede o no alinearse con la baseline oficial de Microsoft para cualquier ajuste dado.
- Vive como una plantilla Settings Catalog, no como una baseline enviada por Microsoft.

Cuando el CISO de un cliente pregunta «¿esto está alineado con la Windows Security Baseline de Microsoft?», la respuesta honesta es: *no directamente. Esta es una baseline curada por el MSP informada por la orientación de Microsoft pero mantenida por separado. La intención es la misma — endurecer Windows — pero los ajustes específicos se eligen para la operabilidad en pequeña empresa más que para el cumplimiento de la gran empresa.*

Las baselines de Microsoft apuntan a grandes empresas con equipos de seguridad dedicados. A veces son demasiado restrictivas para escenarios de pequeña empresa — asumen una infraestructura de autenticación específica, cadencias específicas de parches, una madurez específica de la gestión de endpoints. La Security Baseline de Panoptica365 está calibrada para el contexto de pequeña empresa: lo bastante agresiva para mejorar realmente la postura, lo bastante laxa para no romper flujos comunes de pequeña empresa.

Si un cliente específicamente necesita la Windows Security Baseline oficial de Microsoft por razones de cumplimiento (p. ej., un contrato que la nombra explícitamente), debería desplegarla *junto con* esta plantilla. Las dos pueden coexistir — la baseline de Microsoft tiene precedencia donde los ajustes entran en conflicto, y muchos ajustes no entrarán en conflicto en absoluto.

## Lo que hay dentro realmente — las grandes categorías

Los 98 ajustes se agrupan en unas 20 categorías. Las más grandes:

**Local Policies / Security Options (11 ajustes).** Endurecimiento de la política de seguridad local de Windows — las cosas que configurarías en `secpol.msc` en una máquina unida a dominio, aquí entregadas vía MDM. Ejemplos: seguridad de sesión NTLM mínima, comportamiento de retirada de tarjeta inteligente, restricción de enumeración SID anónima del sistema, protección LSA.

**Configuración de Microsoft Edge (18 ajustes — 10 de dispositivo + 8 de usuario).** Endurecimiento del navegador Edge: aislamiento de sitios, comportamiento del gestor de contraseñas, restricciones de autorrelleno, integración con SmartScreen, protección de descargas, comportamiento de pestañas durmientes, restricciones de creación de perfiles.

**Device Lock (6 ajustes).** Política de bloqueo de pantalla: tiempo antes del bloqueo, comportamiento de la pantalla de bloqueo, deshabilitación de contraseña con imagen, forzar bloqueo por inactividad.

**Chrome Remote Desktop / Chrome Remote Access (8 ajustes — 4 de dispositivo + 4 de usuario).** Restringe específicamente Chrome Remote Desktop de Google y las funciones relacionadas de acceso remoto de Chrome. Es un movimiento deliberado de endurecimiento — Chrome Remote Desktop es un vector de acceso remoto de apariencia legítima del que abusan los atacantes, y la mayoría de los entornos de pequeña empresa no tienen caso de negocio para que los usuarios lo usen. Vale la pena saber que está aquí; algunos equipos de IT de clientes lo usan legítimamente y necesitarán una excepción.

**MS Security Guide (4 ajustes).** Las recomendaciones GPO antiguas de la «Security Guide» de Microsoft — las de los días del SCM (Security Compliance Manager), todavía relevantes. Cosas como endurecimiento de SMB, preparación de AppLocker, autenticación en modo kernel.

**AdmX (10 ajustes — 6 de usuario + 4 de dispositivo).** Ajustes migrados desde plantillas ADMX tradicionales de Group Policy, entregados a través del soporte ADMX de Intune. Sobre todo aplicación de salvapantallas, comportamiento de la pantalla de bloqueo y otro endurecimiento derivado de GPO.

**AutoPlay (4 ajustes).** Deshabilita AutoPlay/AutoRun para todos los medios. Cierra un vector clásico de entrega de malware — memoria USB con carga útil autorun.

**Web Threat Defense (3 ajustes).** Controles adyacentes a SmartScreen — comprobación de archivos descargados contra inteligencia de amenazas, bloqueo de sitios de phishing inseguros, control de los avisos de SmartScreen.

**MSS Legacy (2 ajustes).** Endurecimiento antiguo de «Microsoft Solutions for Security» — restricción del enrutamiento IP, controles de liberación de nombre NetBIOS. Relevante para prácticas antiguas de endurecimiento de Windows.

**Power (2 ajustes).** Endurecimiento de la gestión de energía — típicamente bloquear suspensión en alimentación AC para sobremesas, bloquear wake-on-LAN salvo que sea necesario explícitamente.

**Remote Desktop Services / Remote Management (4 ajustes).** Endurecimiento de RDP — restringir conexiones remotas, habilitar NLA (autenticación a nivel de red) si no está ya aplicada, deshabilitar algunos comportamientos heredados de RPC.

**Wi-Fi (2 ajustes).** Bloquea la conexión automática a redes abiertas, restringe el compartir perfiles Wi-Fi.

**Windows PowerShell (2 ajustes).** Registro de bloques de script y registro de módulos de PowerShell — activa el registro detallado que se usa para respuesta a incidentes. No restringe PowerShell en sí; solo lo hace auditable.

**Connectivity (2 ajustes).** Restricciones de Internet Connection Sharing, restricciones de Network Bridge.

Hay más ajustes individuales más allá de estas categorías, pero lo anterior cubre la mayor parte del grueso.

## Las elecciones opinionadas a conocer

Tres ajustes en esta baseline que vale la pena conocer porque afectan a flujos de trabajo reales de clientes:

**Chrome Remote Desktop está bloqueado.** Esto pilla a algunos equipos de IT con la guardia baja. Chrome Remote Desktop es legítimamente útil para algunos escenarios de acceso remoto y lo usan ampliamente pequeñas empresas que no pagan por una herramienta de RMM apropiada. Bloquearlo vía esta baseline significa que esos flujos dejan de funcionar. Si el cliente tiene un caso de uso real de Chrome Remote Desktop, necesita una excepción. (La alternativa — dejar Chrome Remote Desktop sin restringir — abre un vector de ataque que se salta la telemetría de RMM del MSP.)

**La autoconexión Wi-Fi a redes abiertas está bloqueada.** Endurecimiento estándar. Algunos usuarios se molestarán por esto en cafeterías. Documéntalo en la comunicación de incorporación para que no sea una sorpresa.

**El registro de bloques de script de PowerShell está habilitado.** Es registro, no restricción — pero significa que *cada comando de PowerShell ejecutado en el dispositivo se registra en el log de eventos de Windows*. Eso tiene una implicación de privacidad para usuarios avanzados que podrían preferir que su historial de PowerShell no se registre. Es la decisión correcta para la seguridad; vale la pena saberlo para poder responder a la pregunta si se plantea.

Los otros 90 y pico ajustes son en su mayoría invisibles para los usuarios en operación normal. Endurecen cosas con las que el usuario no debería estar interactuando directamente (política del sistema, comportamiento de red, valores internos del navegador).

## Despliegue

La Security Baseline es el despliegue de mayor impacto por plantilla de la biblioteca porque toca tantos comportamientos separados de Windows. Ejecuta el despliegue por grupo piloto de la lección 1 con más cuidado que para las plantillas más pequeñas.

1. **Día 0** — despliega en un grupo piloto de 3–5 dispositivos de prueba conocidos en buen estado (dispositivos del equipo de IT, un usuario avanzado dispuesto, quizás un dispositivo de la población general).
2. **Días 1–7** — verifica que el despliegue tuvo éxito (el portal de Intune muestra contadores de éxito), y *usa* los dispositivos piloto para trabajo normal. Busca:
   - Cualquier cosa que se haya roto. Aplicaciones de negocio específicas que ya no funcionen, comportamientos de Edge que hayan cambiado de formas visibles para el usuario, herramientas de acceso remoto que hayan dejado de funcionar (Chrome Remote Desktop es la pillada clásica).
   - Scripts de PowerShell que legítimamente hagan cosas inusuales — el registro en modo bloque no debería romperlos, pero si un script legítimo hace algo que la baseline bloquea, verás errores.
   - Quejas de usuarios avanzados. Los usuarios avanzados notan los despliegues de baselines primero.
3. **Días 7–14** — extiende a un piloto más amplio si la primera ronda fue limpia. Un departamento completo o un subconjunto de los usuarios del cliente.
4. **Día 14–21** — despliegue completo si el piloto más amplio está limpio.

La ventana total de despliegue es de 2–3 semanas, más larga que para la mayoría de las plantillas porque la superficie es muy amplia. Intentar apresurar esta plantilla es como un MSP acaba con una llamada de soporte de un viernes por la tarde de «la Security Baseline le rompió a todo el mundo el [X]».

## Qué monitorizar tras la aplicación

**Tasa de éxito del despliegue.** El portal de Intune muestra éxito/fallo por dispositivo para la Security Baseline. Saludable es 98%+ de éxito. Los dispositivos que muestran fallos necesitan investigación — normalmente un conflicto con otra política, una versión no estándar de Windows, o un dispositivo que ha estado fuera de línea demasiado tiempo.

**Ajustes reportados como no aplicados.** Incluso en dispositivos que muestran éxito general, ajustes individuales pueden fallar al aplicarse (incompatibilidad con software instalado, claves del Registro bloqueadas, etc.). Haz comprobaciones puntuales en dispositivos piloto para confirmar que ajustes específicos están de verdad en efecto.

**Quejas de usuarios en los primeros 30 días.** Es cuando salen a la superficie los casos de Chrome Remote Desktop y autoconexión Wi-Fi. Documenta cada uno. Decide caso a caso: excepción vía exclusión, o cambio de flujo de trabajo para el cliente.

**Deriva sobre la propia plantilla.** El detector de deriva de Panoptica365 se aplica aquí. Si la plantilla desplegada diverge de la Security Baseline empaquetada, eso es deriva a investigar. Causa habitual: otro admin del cliente ajustó un ajuste específico que se rompía para él, y la divergencia no se propagó de vuelta a tu referencia.

## Cuándo personalizar

La Security Baseline es la plantilla con más probabilidad de necesitar personalización por-cliente. Razones habituales:

- El marco regulatorio del cliente exige ajustes específicos que la baseline no incluye o configura de otra forma.
- La aplicación de negocio del cliente requiere un comportamiento bloqueado por la baseline (un despliegue personalizado de Chrome Remote Desktop, un patrón específico de PowerShell).
- El cliente está en una variante de Windows (Server, LTSC) donde algunos ajustes de la baseline no aplican.
- La madurez de IT del cliente ha crecido — quiere ajustes más estrictos que los que proporciona la baseline ajustada a pequeña empresa.

El flujo correcto de personalización está en la lección 10: exporta la baseline desde un tenant donde hayas hecho la personalización, generaliza las referencias, importa como nueva plantilla, despliega en los clientes aplicables. No edites la plantilla empaquetada directamente — eso aleja tu referencia de la baseline enviada por Panoptica365 y vuelve desordenadas las futuras actualizaciones.

## Lo que esto significa para el operador

Tres puntos para llevarte.

**La Security Baseline es el despliegue individual más grande de la tarjeta 4. Trátalo como tal.** Ventana de despliegue de dos a tres semanas, disciplina de grupo piloto, monitorización durante 30 días. No la despliegues en bloque a todos los clientes en una sola sesión.

**Sé explícito con los clientes en que esto es curado por el MSP, no oficial de Microsoft.** Cuando surja la pregunta (y surgirá), la respuesta correcta es «esta es nuestra baseline de endurecimiento informada por la orientación de Microsoft, no la baseline oficial de Microsoft. Pueden coexistir si necesitas ambas». Documenta esto en los materiales de incorporación del cliente.

**Conoce las tres elecciones opinionadas que afectan a los usuarios.** Chrome Remote Desktop bloqueado, autoconexión Wi-Fi bloqueada, registro de PowerShell habilitado. Estas surgirán como preguntas; ten las respuestas listas. Los otros 90 y pico ajustes raramente producen efectos visibles al usuario.

## Lo que viene

- **Lección 4: BitLocker Settings.** Cifrado de disco — la plantilla de configuración que entrega lo que la política de cumplimiento de Windows no exige pero la postura de endurecimiento sí demanda.
- **Lección 5: Defender for Endpoint (Win + Mac).** La configuración antivirus / EDR entregada por separado de la Security Baseline.

Por ahora: la Security Baseline es la base del endurecimiento del lado Windows en la biblioteca de Panoptica365. Despliégala con cuidado; monitorízala durante el primer mes; personaliza por cliente cuando su realidad diverja de los valores por defecto para pequeña empresa.

---

*Fuentes de los datos en esta lección — Microsoft Learn sobre las Windows Security Baselines (las oficiales) ([Microsoft Learn — Windows security baselines](https://learn.microsoft.com/en-us/windows/security/operating-system-security/device-management/windows-security-configuration-framework/windows-security-baselines)); referencia de Settings Catalog ([Microsoft Learn — Settings catalog](https://learn.microsoft.com/en-us/mem/intune/configuration/settings-catalog)); configuración de Microsoft Edge vía Intune ([Microsoft Learn — Configure Edge via Intune](https://learn.microsoft.com/en-us/deployedge/configure-edge-with-intune)); entrega de políticas respaldadas por ADMX ([Microsoft Learn — ADMX-backed policies](https://learn.microsoft.com/en-us/mem/intune/configuration/administrative-templates-windows)).*
