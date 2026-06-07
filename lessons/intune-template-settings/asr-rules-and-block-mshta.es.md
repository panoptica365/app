---
title: "ASR Rules + Block mshta.exe — reducción de la superficie de ataque"
subtitle: "19 reglas ASR en modo Bloqueo y una regla de firewall para mshta.exe — cortar las cadenas de comportamiento del malware antes de que las firmas puedan detectarlas."
icon: "bug"
last_updated: 2026-05-29
---

# ASR Rules + Block mshta.exe — reducción de la superficie de ataque

Un patrón habitual en la entrega de malware: un usuario abre un documento de Word adjunto a un correo de phishing. El documento contiene una macro. La macro lanza un proceso de PowerShell. El proceso de PowerShell descarga un ejecutable desde un servidor remoto. El ejecutable corre, establece persistencia, y el atacante tiene un punto de apoyo en el dispositivo.

Cada paso de esa cadena es *funcionalidad legítima de Windows*. Word puede tener macros. Las macros pueden llamar a PowerShell. PowerShell puede descargar archivos. Los archivos pueden ejecutarse. Cada paso, tomado aislado, es algo que un desarrollador o un usuario avanzado podría legítimamente hacer. Pero la *combinación* — Word → macro → PowerShell → descarga → ejecuta — es un patrón de comportamiento que casi nunca tiene una razón de negocio legítima y casi siempre indica entrega de malware.

Las reglas de Attack Surface Reduction (ASR) son el mecanismo de Microsoft para pillar exactamente estos patrones de comportamiento. En lugar de identificar archivos maliciosos específicos, las reglas ASR bloquean las *combinaciones* de acciones legítimas-pero-inusuales que el código malicioso usa para encadenarse en un compromiso exitoso.

Esta lección cubre la plantilla ASR Rules Standard de Panoptica365 (el conjunto comprensivo de reglas ASR) y la plantilla relacionada Block mshta.exe outbound connections (una regla de firewall enfocada que complementa el conjunto ASR). Juntas forman la capa de defensa preventiva basada en comportamiento en endpoints Windows.

## La plantilla ASR Rules Standard

La plantilla configura **19 reglas ASR — todas en modo Block** — más Controlled Folder Access (en un modo distinto; ver más abajo). Usa el tipo de plantilla Settings Catalog con `endpointSecurityAttackSurfaceReduction` como familia. La postura de la plantilla, en una línea: bloquear prácticamente todo.

Las 19 reglas, agrupadas por lo que pillan:

### Entrega de malware basada en Office (la cadena de ataque más habitual)

- **Bloquear que todas las aplicaciones de Office creen procesos hijos.** Word, Excel, PowerPoint, etc. no deberían estar lanzando procesos. Cuando lo hacen, casi siempre es una macro lanzando algo malicioso.
- **Bloquear que las aplicaciones de Office creen contenido ejecutable.** Aplicaciones de Office escribiendo .exe / .dll en disco es altamente sospechoso.
- **Bloquear que las aplicaciones de Office inyecten código en otros procesos.** La inyección de código desde Office a otros procesos es una técnica clásica de malware.
- **Bloquear que la aplicación de comunicación de Office cree procesos hijos.** Outlook específicamente — Outlook lanzando procesos es incluso más raro que otras aplicaciones de Office.
- **Bloquear llamadas a la API Win32 desde macros de Office.** Las macros que llaman a la API Win32 directamente están haciendo algo que una macro de negocio normal no haría.
- **Bloquear que JavaScript o VBScript lance contenido ejecutable descargado.** Scripts descargados lanzando ejecutables descargados es el corazón de la entrega de malware «drive-by».
- **Bloquear la ejecución de scripts potencialmente ofuscados.** PowerShell o VBScript fuertemente ofuscado es una señal fuerte de malware — los scripts legítimos no tienen razón para ofuscarse.

### Entrega basada en lectores de documentos

- **Bloquear que Adobe Reader cree procesos hijos.** Adobe Reader es un vector de ataque paralelo a Office — los PDFs maliciosos a veces incrustan scripts o invocan lanzadores que crean procesos hijos. Misma lógica defensiva que las reglas de Office: un lector de PDF no tiene por qué estar lanzando otros procesos.

### Entrega basada en correo

- **Bloquear contenido ejecutable desde el cliente de correo y webmail.** Los adjuntos de correo que son ejecutables (o que descargan ejecutables) no deberían estar corriendo directamente desde el cliente de correo.

### Robo de credenciales

- **Bloquear el robo de credenciales desde el subsistema Local Security Authority de Windows (LSASS).** Esto pilla ataques estilo Mimikatz donde el malware intenta volcar credenciales desde la memoria de LSASS. Altamente diagnóstico — un proceso accediendo a LSASS para extracción de credenciales casi siempre indica compromiso. Esta regla en la plantilla de Panoptica365 se envía con una exclusión por-regla: `wazuh-agent.exe`. Wazuh es un agente SIEM/XDR de código abierto que legítimamente lee LSASS para monitorización de credenciales; sin la exclusión, el propio agente sería bloqueado por la misma regla de la que depende observar. Ejemplo concreto de cómo funciona una exclusión por-regla en la práctica: la regla sigue disparándose para todo lo demás, pero Wazuh tiene un pase libre permanente.

### Persistencia, movimiento lateral y evasión de defensas

- **Bloquear la persistencia a través de suscripción a eventos WMI.** La suscripción a eventos WMI es una técnica sigilosa de persistencia que el malware usa para sobrevivir a reinicios; las aplicaciones legítimas casi nunca la usan.
- **Bloquear la creación de procesos desde comandos de PsExec y WMI.** PsExec y la ejecución remota basada en WMI son herramientas habituales de movimiento lateral.
- **Bloquear el reinicio de la máquina en Modo Seguro.** Algún ransomware reinicia en Modo Seguro para deshabilitar los productos de seguridad antes de cifrar.
- **Bloquear el uso de herramientas del sistema copiadas o suplantadas.** El malware a veces copia binarios legítimos del sistema (como cmd.exe) a otras ubicaciones y los ejecuta desde allí, evadiendo algunas reglas de detección.

### USB y medios extraíbles

- **Bloquear procesos no confiables y no firmados que se ejecuten desde USB.** El malware entregado por USB es un vector de larga data; esta regla pilla ejecutables no firmados lanzándose desde unidades extraíbles.

### Específico de servidor

- **Bloquear la creación de web shells en servidores.** Específicamente para instalaciones de Windows Server — pilla subidas de archivos maliciosos que dejan web shells (PHP, ASPX) en IIS u otros servidores web.

### Defensa contra controladores y explotación

- **Bloquear el abuso de controladores firmados vulnerables explotados.** Pilla el malware que usa controladores de kernel firmados con vulnerabilidades conocidas como vector de escalada de privilegios. Microsoft mantiene la lista de controladores vulnerables.
- **Bloquear la ejecución de archivos ejecutables salvo que cumplan criterios de prevalencia, edad o lista de confianza.** Una regla de archivos-sin-pedigrí — los ejecutables que son demasiado nuevos, demasiado raros, o no están en una lista conocida como segura se bloquean. Pilla variantes novedosas de malware; puede dar falsos positivos en software de nicho legítimo.

### Específico de ransomware

- **Usar protección avanzada contra ransomware.** Una regla de comportamiento que pilla patrones de cifrado característicos del ransomware.

## Controlled Folder Access — la excepción deliberada

Adyacente a las 19 reglas ASR, la plantilla también habilita **Controlled Folder Access (CFA)** — pero en **Modo Auditoría**, no Block. Este es el único sitio donde la plantilla explícitamente se aparta de la postura «bloquear todo», y es intencional.

CFA restringe qué aplicaciones pueden escribir en carpetas protegidas (Documentos, Imágenes, Escritorio, etc.). En modo Block, las aplicaciones que no están en la lista de permitidos se les impide modificar archivos en esas ubicaciones. En modo Auditoría, esas mismas escrituras se *registran* pero no se bloquean — Defender anota quién intentó escribir qué en una carpeta protegida, pero la escritura procede.

La razón del modo Auditoría: demasiadas aplicaciones legítimas escriben en carpetas protegidas en un dispositivo Windows normal. Herramientas de backup escribiendo en documentos de usuario, clientes de sincronización (Dropbox, Google Drive, OneDrive), aplicaciones creativas escribiendo archivos de proyecto a Documentos, herramientas de productividad auto-guardando — la lista es larga. Ejecutar CFA en modo Block desde el principio genera una avalancha de tickets al helpdesk («mi OneDrive dejó de sincronizar», «mi backup está fallando», «Photoshop no guarda»). El modo Auditoría mantiene la visibilidad (puedes ver qué se está intentando) sin romper los flujos de trabajo.

Los operadores que quieran una protección más fuerte contra ransomware pueden cambiar CFA a modo Block por-cliente tras construir una lista de permitidos de aplicaciones legítimas para ese entorno. La plantilla se envía en Auditoría para que el despliegue por defecto no cause rotura de flujos; el cambio a modo Block es un paso de endurecimiento por-cliente, no un valor por defecto a nivel de parque.

## Modos de reglas ASR — la distinción crucial

Cada regla ASR puede ponerse en uno de cuatro modos:

- **Auditoría** — la regla evalúa y registra coincidencias, pero no bloquea. Se usa para pruebas y descubrimiento.
- **Block** — la regla evalúa y bloquea el comportamiento que coincide. El modo de producción.
- **Aviso** — la regla avisa al usuario cuando ocurre el comportamiento que coincide; el usuario puede saltársela y proceder. Disponible para algunas reglas; intermedio entre Auditoría y Block.
- **No configurada / Off** — la regla no está activa.

La plantilla ASR Rules Standard de Panoptica365 pone **las 19 reglas ASR en Block** desde el inicio. Controlled Folder Access es la única en Auditoría (ver la sección anterior). Los autores de la plantilla escogieron las reglas específicamente porque tienen tasas bajas de falsos positivos en 2026 — Microsoft las ha afinado durante años, y el conjunto elegido evita las reglas históricamente más problemáticas. La intención de diseño de la plantilla es despliegue directo a Block.

**La realidad operativa**: incluso con reglas cuidadosamente seleccionadas, desplegar reglas ASR a Block en un parque que nunca las ha tenido pillará ocasionalmente actividad de negocio legítima-pero-inusual que los autores de la plantilla no podían predecir. Software específico de industria, herramientas de nicho, aplicaciones internas construidas a medida con patrones extraños de macros de Office — estos todavía pueden disparar reglas y ser bloqueados, rompiendo flujos de usuario.

Dos enfoques aceptables, según el cliente:

**Directo-a-Block (el valor por defecto de la plantilla).** Despliega como viene la plantilla — todas las reglas en Block. Adecuado para clientes cuyo inventario de aplicaciones conoces bien, que corren software de negocio convencional, que no tienen aplicaciones a medida heredadas con patrones extraños de Office o LOLBin. La mayoría de los tenants de pequeña empresa encajan en este perfil. Estate listo para añadir exclusiones por-regla según vaya emergiendo rotura legítima.

**Pre-vuelo en modo Auditoría (la opción cauta).** Para clientes con inventario de software desconocido o inusual — vendedores de control industrial, aplicaciones de línea-de-negocio a medida, software específico de sanidad, cualquier cosa fuera del mundo SaaS convencional — pasa cada regla a Auditoría antes del despliegue, monitoriza durante 14–30 días, construye la lista de exclusiones, luego pasa a Block:

1. Modifica la plantilla por-cliente para poner cada regla en Auditoría antes del despliegue.
2. Corre en modo Auditoría durante 14–30 días. Saca los logs de auditoría cada pocos días.
3. Para cada regla que se disparó contra actividad legítima, añade una exclusión por-regla para el proceso o archivo afectado (la exclusión de Wazuh en la regla LSASS de arriba es el modelo).
4. Una vez que el periodo de auditoría esté limpio, pasa las reglas de vuelta a Block.

La elección entre directo-a-Block y pre-vuelo de Auditoría es por-cliente. La plantilla se envía en directo-a-Block porque esa es la respuesta correcta para la mayoría de los tenants de pequeña empresa; los operadores que sepan que el entorno de un cliente es inusual deberían alcanzar el pre-vuelo de Auditoría en su lugar.

## La plantilla Block mshta.exe — el complemento enfocado

Adyacente a la plantilla ASR Rules hay una plantilla separada y enfocada: **Panoptica365 - Block mshta.exe outbound connections.**

La descripción de la plantilla es inusualmente exhaustiva: *«Bloquear las conexiones salientes desde mshta.exe tiene impacto mínimo en el usuario pero reduce significativamente la superficie de ataque al impedir que un LOLBin del que se abusa habitualmente alcance payloads externos y servidores C2.»*

El acrónimo LOLBin significa **Living Off the Land Binary** — un binario legítimo de Windows del que los atacantes abusan para hacer cosas maliciosas. mshta.exe es el ejemplo clásico: es una utilidad integrada de Windows para ejecutar archivos HTML Application (.hta), y ha sido parte de Windows durante décadas. Casi ningún flujo de negocio legítimo usa mshta.exe en 2026; casi toda familia de malware que corre en Windows incluye mshta.exe como uno de sus vectores de ejecución porque ya está en cada dispositivo Windows, está firmado por Microsoft, y puede invocarse desde muchos contextos (macros de Office, tareas programadas, línea de comandos, scripts).

La plantilla bloquea **conexiones de red salientes** específicamente desde mshta.exe. Es decir: mshta.exe todavía puede correr si un caso de uso legítimo lo invoca, pero no puede alcanzar infraestructura C2 externa ni descargar payloads desde internet. El caso de uso malicioso queda severamente degradado.

La plantilla usa la misma familia `endpointSecurityFirewall` que la plantilla principal Firewall Settings (lección 6). Es técnicamente una regla de firewall en lugar de una regla ASR, pero conceptualmente es un control de reducción-de-superficie-de-ataque — elimina una ruta específica de la que dependen los atacantes.

Este es el patrón correcto para defensa contra LOLBins: identifica los binarios legítimos-pero-raramente-usados de Windows que aman los atacantes, y restringe quirúrgicamente el comportamiento específico que los hace útiles para el ataque. La biblioteca de Panoptica365 actualmente envía esta plantilla para mshta.exe específicamente; podrían construirse plantillas similares para otros LOLBins (cscript.exe, wscript.exe, certutil.exe, regsvr32.exe, msbuild.exe, installutil.exe, rundll32.exe — hay una larga lista). Por ahora, mshta.exe es el que viene empaquetado.

## Qué puede romperse

Las reglas ASR y el bloqueo de mshta.exe pueden producir falsos positivos. Las categorías más habituales:

**Aplicaciones internas a medida que hacen cosas que no deberían.** Una aplicación de negocio construida a medida que incluye macros de Office haciendo cosas raras, o que usa mshta.exe por alguna razón heredada, o que llama a APIs Win32 desde Excel por rendimiento, será bloqueada. El arreglo son exclusiones por-aplicación en la configuración de la regla ASR.

**Software de vendedores de nicho con malas prácticas de codificación.** Algún software comercial (especialmente antiguo, de nicho o específico de industria) viola las reglas ASR como parte de la operación normal. El instalador del vendedor lanza PowerShell, la aplicación principal del vendedor inyecta código en otros procesos, etc. Los arreglos son exclusiones específicas del vendedor.

**Herramientas de gestión remota basadas en PsExec / WMI.** Algunas herramientas legítimas de gestión remota usan PsExec o ejecución remota basada en WMI, que las pilla la regla ASR correspondiente. Si el equipo de IT de un cliente usa estas herramientas, necesitan exclusiones.

**Scripts de PowerShell a medida que descargan y ejecutan.** Una automatización interna legítima que descarga un payload y lo ejecuta (p. ej., un instalador disparado por un script de logon) disparará la regla de ejecutable-descargado por JavaScript/VBScript. Exclusiones o reescribir la automatización.

**Anti-ransomware Controlled Folder Access.** Con el valor por defecto de la plantilla de CFA en modo Auditoría, no se rompe nada — las escrituras se registran pero se permiten. La lista de «qué se rompería si CFA estuviera en modo Block» es larga, sin embargo: software de backup escribiendo a documentos de usuario, clientes de sincronización (Dropbox, Google Drive, OneDrive — OneDrive normalmente está en la lista de permitidos por defecto de Microsoft), herramientas creativas escribiendo a Documentos, aplicaciones de productividad auto-guardando. Por eso la plantilla envía CFA deliberadamente en Auditoría: bloquear estas desde el inicio generaría una inundación de tickets de helpdesk. Los operadores que más tarde pasen CFA a Block para un cliente específico deberían construir la lista de permitidos desde los logs de modo Auditoría primero.

## Despliegue

Para tenants de pequeña empresa convencionales (inventario de aplicaciones conocido, entorno estándar pesado en SaaS), el valor por defecto directo-a-Block de la plantilla es la postura de despliegue correcta:

1. **Día 0** — despliega la plantilla como viene (las 19 reglas ASR en Block, CFA en Auditoría). Grupo piloto primero según la comprobación previa de la lección 1.
2. **Días 1–14** — monitoriza tickets de helpdesk y eventos de bloqueo de Defender. Los falsos positivos que necesitan exclusiones surgirán como rotura de flujos reportada por usuarios («X dejó de funcionar tras la actualización»). Tría cada uno: falso positivo (añade exclusión), positivo real (investiga como incidente de seguridad), caso límite (decide caso a caso).
3. **Día 14+** — expande la asignación del grupo piloto al ámbito completo una vez que los dispositivos piloto estén limpios. Continúa monitorizando los primeros 30 días y añade exclusiones según vayan surgiendo nuevas.

Para clientes con inventario de software inusual (control industrial, específico de sanidad, aplicaciones de línea-de-negocio a medida con patrones heredados), usa el pre-vuelo de Auditoría de la sección anterior en su lugar — pasa cada regla a Auditoría, corre durante 14–30 días, construye exclusiones, luego pasa a Block.

**Controlled Folder Access** se envía en Auditoría por diseño. Los operadores que quieran habilitarlo en modo Block (protección más fuerte contra ransomware) deberían hacerlo por-cliente tras construir una lista de permitidos de aplicaciones legítimas que escriban a carpetas protegidas. Es una mejora de endurecimiento, no parte del despliegue estándar.

**La plantilla Block mshta.exe** puede desplegarse directamente sin ventana de Auditoría — la superficie de fallo es tan estrecha que casi ningún flujo de trabajo legítimo usa mshta.exe en 2026.

## Qué monitorizar tras la aplicación

**Coincidencias de reglas ASR por regla por dispositivo.** Una vez en modo Block, las coincidencias deberían ser raras. Los picos indican o bien actividad de malware (positivos reales) o actividad legítima-pero-no-documentada que necesita una exclusión.

**Rotura de flujos reportada por usuarios.** Rastrea cada queja de «X dejó de funcionar». Tría por causa ASR probable; documenta cada exclusión añadida.

**Eventos de auditoría de Controlled Folder Access.** Incluso en modo Auditoría, CFA registra cada intento de escritura a una carpeta protegida por una aplicación no listada en los permitidos. Esto es inteligencia útil — te muestra exactamente qué aplicaciones habrían sido bloqueadas si CFA estuviera en modo Block. Si alguna vez decides pasar CFA a Block para un cliente, el log de auditoría es tu fuente prefabricada de lista de permitidos. Busca: herramientas de backup, clientes de sincronización (Dropbox, Google Drive, OneDrive), aplicaciones creativas, herramientas de productividad auto-guardando a Documentos.

**Eventos de bloqueo saliente de mshta.exe en el log del firewall.** Debería ser de muy bajo volumen en operación normal. Los picos son interesantes — o bien un intento real de malware bloqueado con éxito, o un caso de uso legítimo-pero-raro que necesita una exclusión.

**Deriva sobre cualquiera de las plantillas.** Ambas plantillas son objetivos habituales de «un admin deshabilitó esto por [queja del usuario]». La detección de deriva los marca.

## La conversación con el cliente

Cuando propones reglas ASR a un cliente, el pitch honesto:

- Estas reglas pillan los patrones específicos de comportamiento que el malware usa para encadenar un compromiso exitoso — macro-de-Office a PowerShell a descarga a ejecución, robo de credenciales en LSASS, payloads entregados por USB, patrones de cifrado de ransomware.
- Los valores por defecto de la plantilla bloquean agresivamente; esperamos que esto encaje limpiamente en la mayoría de los entornos, con exclusiones ocasionales por-aplicación para flujos legítimos-pero-inusuales.
- Si tu entorno tiene aplicaciones de línea-de-negocio inusuales — cualquier cosa construida a medida, específica de industria, o con patrones extraños de macros de Office — correremos un pre-vuelo de modo Auditoría de 14–30 días antes de pasar a Block, para que encontremos cualquier flujo legítimo que se rompería antes de que realmente se rompa.
- Controlled Folder Access está habilitado en Modo Auditoría (solo registro). La protección más fuerte contra ransomware (CFA en Block) es una mejora separada de endurecimiento que podemos aplicar una vez que hayamos inventariado las aplicaciones que legítimamente escriben a carpetas protegidas en tu parque.

Para tenants en industrias específicas — sanidad, finanzas, contratación gubernamental — las reglas ASR son a menudo una expectativa regulatoria. Para tenants sin esas motivaciones, las reglas ASR siguen siendo fuertemente recomendadas; la propuesta de valor es más clara si puedes nombrar ataques específicos que han preocupado al cliente.

## Lo que esto significa para el operador

Tres puntos para llevarte.

**La plantilla se envía agresiva — 19 reglas ASR en Block, CFA en Auditoría — y está pensada para desplegarse tal cual en tenants convencionales de pequeña empresa.** Alcanza el patrón de pre-vuelo de Auditoría cuando no conozcas el inventario de aplicaciones del cliente, cuando el cliente corra software inusual de línea-de-negocio, o cuando despliegues previos hayan marcado rotura falsa-positiva. No lo alcances como valor por defecto — la intención de diseño de la plantilla es directo-a-Block.

**La plantilla Block mshta.exe es el modelo para defensa contra LOLBins.** Quirúrgica, enfocada, radio de impacto estrecho. A medida que Microsoft añade más cobertura de LOLBin a sus defensas integradas, este tipo de regla suplementaria enfocada puede volverse menos necesaria — pero por ahora, mshta.exe específicamente es un favorito conocido de los atacantes y el bloqueo está bien dirigido.

**Mantén listas de exclusión por cliente.** Cada exclusión ASR es por-cliente (porque cada cliente tiene aplicaciones de negocio distintas y software de nicho distinto). El sistema de exenciones de Panoptica365 puede rastrearlas; necesitan mantenimiento continuo a medida que cambia el inventario de aplicaciones del cliente.

## Lo que viene

- **Lección 8: Account Protection + Block MSA.** Windows Hello for Business, Credential Guard, bloqueo de adiciones de cuentas Microsoft personales en dispositivos gestionados.
- **Lección 9: El bucle de cumplimiento en producción.** Cómo todas estas plantillas afloran como señales.

Por ahora: ASR Rules + Block mshta.exe forman la capa preventiva de defensa basada en comportamiento. Despliega como viene la plantilla para tenants convencionales (directo-a-Block, CFA en Auditoría); usa el pre-vuelo de modo Auditoría cuando el entorno del cliente sea inusual. La disciplina de saber *qué postura encaja con qué cliente* es lo que hace que esta plantilla añada valor en lugar de fricción.

---

*Fuentes de los datos en esta lección — Microsoft Learn sobre reglas ASR ([Microsoft Learn — Attack surface reduction rules reference](https://learn.microsoft.com/en-us/defender-endpoint/attack-surface-reduction-rules-reference)); orientación de despliegue de reglas ASR ([Microsoft Learn — ASR rules deployment](https://learn.microsoft.com/en-us/defender-endpoint/attack-surface-reduction-rules-deployment)); Controlled Folder Access ([Microsoft Learn — Controlled Folder Access](https://learn.microsoft.com/en-us/defender-endpoint/controlled-folders)); referencia de LOLBins ([LOLBAS project](https://lolbas-project.github.io/)); contexto del vector de ataque mshta.exe ([MITRE ATT&CK — Mshta](https://attack.mitre.org/techniques/T1218/005/)).*
