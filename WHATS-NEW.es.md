# Novedades de Panoptica365

Notas de versión orientadas al cliente. Cada versión a continuación describe
lo que cambió en esa entrega, comenzando por la más reciente.

---

## Versión 0.2.23 — 2026-06-23

### Aut. correo: detección de DKIM corregida para el nuevo formato de registro de Microsoft 365

Un seguimiento rápido de la nueva pestaña Aut. correo. Microsoft está migrando el DKIM de Microsoft 365 del antiguo destino CNAME `*.onmicrosoft.com` a un nuevo destino `*.dkim.mail.microsoft`. La primera versión solo reconocía la forma antigua; un dominio con el nuevo formato — incluso con DKIM correctamente publicado y firmando activamente — se informaba por error como **DKIM con fallo** («selectores esperados no encontrados»). Esta versión reconoce ambos y, lo más importante, ya no trata el nombre de host de destino del proveedor como un criterio de aprobado o fallo: cualquier selector de Microsoft 365 que resuelva con una clave válida ahora se considera correcto, de modo que los futuros cambios en la infraestructura DKIM de Microsoft tampoco causarán un falso fallo.

También en esta versión: el análisis con IA ya no repite la puntuación numérica (a veces la recalculaba de forma incorrecta y podía contradecir el medidor en pantalla), y un análisis de IA obsoleto ahora se borra en lugar de mostrarse cuando los registros de un dominio cambian pero el análisis no se puede regenerar.

---

## Versión 0.2.22 — 2026-06-22

### Nueva pestaña Aut. correo — audite, califique y supervise el DNS anti-suplantación de cada dominio

Cada panel de cliente tiene una nueva pestaña **Aut. correo** que audita el DNS público de autenticación de correo de un cliente y lo sigue vigilando. Haga clic en **Actualizar** y Panoptica365 lee los registros en vivo de cada dominio aceptado — MX, SPF, DKIM y DMARC, además de los mecanismos complementarios (DNSSEC, MTA-STS, TLS-RPT, BIMI, DANE) — califica la postura en un medidor ponderado de A a F y usa IA para explicar cada registro en lenguaje claro, con una breve lista de correcciones priorizadas que puede aplicar en el registrador.

Lo que lo convierte en algo más que un verificador genérico es la **inteligencia DKIM**. Panoptica365 detecta quién envía realmente el correo del dominio (a partir de los registros MX y SPF) y lo contrasta con los selectores DKIM publicados. Así, un inquilino que funciona en Microsoft 365 pero cuyos registros `selector1`/`selector2` faltan se señala correctamente como **correo saliente sin firmar** — en lugar de recibir un falso 100 % porque respondió algún selector de marketing sin relación. Y cuando un remitente usa legítimamente selectores impredecibles por cuenta (Amazon SES, Salesforce, Mimecast y similares), el resultado es un honesto **«indeterminado»** con la indicación de confirmarlo desde un mensaje enviado — nunca un falso fallo.

Y lo más importante: es **supervisión continua, no una instantánea única**. Tras la primera lectura, Panoptica365 vuelve a comprobar a diario los dominios de los inquilinos gestionados y genera una alerta de desviación en cuanto la postura retrocede — DMARC debilitado de reject a none, un selector DKIM eliminado o revocado, SPF relajado a `~all` o `+all`. La alerta indica exactamente qué cambió (antes → después). Si usted hizo el cambio, haga clic en **Aceptar** para fijar una nueva línea base y resolver la alerta; si no, investíguelo en su proveedor de DNS.

Como siempre, Panoptica365 **solo lee el DNS y nunca cambia sus registros** — detecta, aconseja y enlaza directamente; usted hace la corrección en el registrador. Actualizar está disponible para inquilinos gestionados y de solo auditoría; la supervisión diaria y las alertas de desviación se aplican a los inquilinos gestionados.

---

## Versión 0.2.21 — 2026-06-22

### Indicaciones más claras cuando un inquilino obtiene Defender para Office 365 tras un cambio de licencia

Cuando un cliente pasa de una licencia sin Defender para Office 365 (por ejemplo, Business Standard) a una que lo incluye (Business Premium), el ajuste **Habilitar la directiva de seguridad preestablecida** ahora gestiona el cambio correctamente, en lugar de quedarse en un callejón sin salida.

Si ya había activado la preconfiguración Standard (o Strict) de Microsoft mientras el inquilino estaba en la licencia inferior, la mejora desbloquea las protecciones de Defender para Office 365 — Vínculos seguros, Datos adjuntos seguros y protección contra suplantación — pero Microsoft no las activa automáticamente ni hay forma de activarlas fuera del portal de Defender. Panoptica365 marcaba correctamente la diferencia como desviación, pero los botones **Aplicar** y **Aceptar** se detenían con un mensaje confuso: «no corresponde a ninguna opción documentada».

Panoptica365 ahora reconoce esta situación concreta y muestra una breve guía hacia el paso único, en el portal de Microsoft Defender, que termina de activar la protección. Una vez hecho y tras actualizar, Panoptica365 adopta la protección ya completa como línea base y reanuda la supervisión automáticamente.

---

## Versión 0.2.20 — 2026-06-21

### Acceso con un clic a las consolas de administración de Microsoft de cada inquilino

La Gestión de inquilinos incorpora una nueva pestaña **Consolas de administración** que convierte Panoptica365 en su punto de partida hacia cada portal de administración de Microsoft. Elija un inquilino — o use la cuadrícula densa **Todos los inquilinos** — y entre directamente en su consola de Entra, Azure, Exchange, Microsoft 365, Intune, Defender, SharePoint o Teams. Cada enlace se abre en el contexto de inquilino correcto usando sus propios permisos delegados de GDAP: sin buscar el portal adecuado, sin copiar identificadores de inquilino y sin malabarismos de inicio de sesión.

Dos formas de trabajar:

- **Todos los inquilinos** — una matriz compacta (una fila por inquilino, una columna por consola) con un encabezado fijo y una búsqueda por nombre que ignora los acentos, para llegar a cualquier consola de cualquier inquilino con un solo clic, incluso con una lista de clientes larga.
- **Enfocar un inquilino** — un selector de inquilino con tarjetas de consola más grandes, cada una con un recordatorio de una línea sobre para qué sirve ese portal, cuando trabaja con un solo cliente.

También puede hacer clic en el **nombre** de cualquier inquilino en la lista para ir directamente a sus consolas.

Todo aquí es **solo de navegación** — Panoptica365 sigue sin escribir nada en los inquilinos de sus clientes ni hacer cambios. Simplemente le da el camino más rápido a la consola correcta.

No se requiere configuración: los dominios de cada inquilino se detectan automáticamente. Las cuatro consolas que solo necesitan el identificador del inquilino (Entra, Azure, Microsoft 365, Defender) funcionan de inmediato; las demás se activan en cuanto se detecta el dominio — poco después de añadir un inquilino — y muestran un breve estado «Resolviendo…» mientras tanto.

---

## Versión 0.2.19 — 2026-06-20

### La campana de alertas ahora se vacía una vez que ha hecho el triaje

La campana de notificaciones — y el contador **Alertas** en la barra lateral — mantenía un número hasta que todas las alertas estuvieran resueltas, así que una alerta que ya había tomado y marcado como *En investigación* aún encendía la campana. Ahora cuenta solo las **alertas nuevas y sin tocar**: en cuanto marca una como En investigación, la resuelve o la descarta como falso positivo, desaparece de la campana y de la barra lateral. En otras palabras, la campana significa «algo nuevo merece una mirada», no «aún hay trabajo en curso».

La cifra **Alertas abiertas** en la barra de estado inferior no cambia — sigue mostrando todo lo que está actualmente activo (nuevo *y* en investigación), para que mantenga un vistazo de su carga de trabajo abierta.

---

## Versión 0.2.18 — 2026-06-20

### Supervisión de DLP en inquilinos nuevos — corrección finalizada

Esto finaliza la corrección de DLP para inquilinos nuevos iniciada en la versión 0.2.16. En un inquilino donde Microsoft Purview nunca se había abierto, el error subyacente de «referencia de objeto» se generaba en realidad durante la *conexión* al servicio de cumplimiento — un paso que se ejecuta antes de la protección añadida en 0.2.16 — por lo que la comprobación **Supervisar la configuración de políticas DLP** aún podía mostrar un *error de sondeo* y **Coincidir** aún podía fallar.

Panoptica365 ahora reconoce un servicio DLP nunca inicializado sin importar qué paso lo informe, y lo trata por lo que es: una línea base vacía válida. Haga clic en **Coincidir** para capturarla, y Panoptica365 le avisará en cuanto se cree una política DLP en ese inquilino. Los inquilinos que realmente no se pueden leer — un rol de administrador que falta, por ejemplo — siguen informando un error claro y accionable en lugar de una línea base vacía engañosa.

---

## Versión 0.2.17 — 2026-06-20

### Las lecciones de Aprender ahora se abren en todas las implementaciones

Abrir una lección desde el centro Aprender podía fallar — mostrando un mensaje de «conexión rechazada» en lugar del artículo — en las instalaciones servidas a través del proxy inverso seguro estándar. La protección contra el secuestro de clics del proxy se negaba, correctamente, a permitir que cualquier página incrustara la aplicación en un marco, y eso también impedía que el visor de lecciones mostrara la lección. Las lecciones ahora se cargan mediante un método al que esa protección no se aplica, por lo que se abren de forma fiable en todas las implementaciones — manteniendo plenamente activa la protección contra el secuestro de clics.

---

## Versión 0.2.16 — 2026-06-20

### Sus botones de acción ya no pueden ser silenciados por el navegador

Las confirmaciones que aparecen antes de una acción de escritura — implementar una política de acceso condicional, enviar una plantilla, quitar una implementación de Intune, deshabilitar un inquilino, etc. — antes dependían del cuadro de diálogo integrado de su **navegador**. Si alguna vez marcó la casilla «impedir que esta página cree diálogos adicionales» del navegador (a veces etiquetada «No volver a preguntar»), cada uno de esos botones dejaba de responder en silencio — sin error, sin diálogo — hasta que recargaba la página.

Panoptica365 ahora muestra su **propio** cuadro de confirmación para cada una de esas acciones, en todo el producto. Una configuración del navegador ya no puede deshabilitar sus botones. Las acciones que eliminan o quitan algo muestran un botón de confirmación rojo claramente marcado, para que la consecuencia sea evidente antes de hacer clic.

### La supervisión de DLP ahora funciona en inquilinos nuevos

Cuando incorporaba un inquilino que **nunca** había tenido configurada la prevención de pérdida de datos en el portal de Microsoft Purview, la comprobación **Supervisar la configuración de políticas DLP** mostraba un *error de sondeo* y **Coincidir** fallaba con un mensaje técnico. Panoptica365 ahora trata «sin DLP configurada» por lo que es: una línea base vacía válida. Haga clic en **Coincidir** para capturarla, y Panoptica365 le avisará en cuanto se cree una política DLP en ese inquilino. Los inquilinos que realmente no se pueden leer (por ejemplo, un rol de administrador que falta) siguen informando un error claro y accionable en lugar de una línea base vacía engañosa.

---

## Versión 0.2.15 — 2026-06-19

### Nuevo aspecto para las lecciones + La capa humana

Cada lección de **Aprender** — en los ocho temas — se ha rehecho como un artículo con diseño completo, con diagramas, recuadros y tablas, y el centro Aprender ahora las muestra correctamente. Abra cualquier tema y haga clic en una lección: se abre en una vista de lectura limpia con una sola barra de desplazamiento fluida, y sigue el tema de su aplicación — lecciones claras en modo claro, oscuras en modo oscuro. (Los diagramas permanecen sobre su lienzo oscuro, por diseño, para leerse como figuras integradas en la página.) Todo lo demás funciona como antes — los puntos azules de «sin leer», las insignias *Actualizado* y el seguimiento de lectura por usuario — y las lecciones siguen su preferencia de idioma en español, inglés y francés.

### Un informe de estado de la base de datos más claro

La comprobación **Tamaño de la base de datos** en *Estado* ya no muestra una advertencia ámbar solo porque el historial de un inquilino haya crecido — una base de datos sana y activa debe crecer. Ahora simplemente informa el tamaño actual y las tablas más grandes, como referencia, y nunca afecta al estado de salud general.

---

## Versión 0.2.14 — 2026-06-18

### ¡Sus datos se ven hermosos!

Desde el día en que incorporó cada inquilino, Panoptica365 ha estado registrando discretamente una instantánea diaria de su seguridad. Esta versión convierte todo ese historial en gráficos — para que por fin pueda *ver* cómo mejora la seguridad con el tiempo, no solo comprobar dónde está hoy.

Cada panel de inquilino tiene ahora una pestaña **Tendencias**, justo al lado de **Resumen**. Cuenta la historia de ese inquilino durante el período que usted elija — desde 7 días hasta un año completo: su **puntuación de seguridad de Microsoft** comparada con la referencia de las empresas de tamaño similar, la puntuación desglosada **por categoría**, cuántas de las recomendaciones de Microsoft ha **aplicado** con el tiempo, los **problemas detectados y resueltos** cada mes, cuánto tardaron en despejarse, el volumen de alertas por semana y las políticas que más se activan. Está dispuesta como *lo que ve el cliente* arriba y *lo que ve el proveedor* abajo — lista para incluir directamente en una revisión con el cliente.

También hay una página **Tendencias** de toda la cartera, nueva, en la barra lateral, justo después de **Mapa de calor**. Eleva la misma idea a toda su cartera de **inquilinos gestionados a la vez**: una **puntuación de seguridad** de la cartera con una banda sombreada que muestra su mejor y su peor inquilino cada día junto con la referencia de Microsoft, cómo ha crecido la cartera gestionada, las recomendaciones aún pendientes en todos los clientes, dónde es más débil la cartera por categoría y el panorama completo de las operaciones de alertas — resueltos, abiertos, tiempo de resolución, volumen y sus políticas más ruidosas en todos los clientes. Cuando incorpora inquilinos a mitad del período, una línea aparte mantiene constantes a sus clientes existentes, para que un nuevo inquilino con puntuación baja no haga parecer que todos retrocedieron.

Ambas páginas leen datos que Panoptica365 ya recopila, así que se abren al instante y no añaden carga a Microsoft. Un inquilino recién incorporado todavía no tendrá mucha línea que trazar — déle unas semanas y el panorama se completa. Una nueva guía, **Paneles de tendencias**, en **Aprender → Guías de Panoptica365**, recorre cada gráfico de ambas páginas.

---

## Versión 0.2.13 — 2026-06-17

### Cuadro de diálogo de acciones más cuidado para las configuraciones de origen del inquilino

Algunas pequeñas correcciones visuales de las tarjetas de origen del inquilino (Adopción en su sitio) introducidas en la 0.2.11. El cuadro de diálogo **Administrar la configuración** — el que abre desde las **Acciones** de una tarjeta — ahora es una fila limpia de botones con iconos: **Dejar de supervisar**, **Desactivar** (o **Restaurar**) y **Eliminar**, con Eliminar claramente en rojo. También corregimos un problema de contraste del texto que dificultaba la lectura de ese cuadro de diálogo en el tema claro.

---

## Versión 0.2.12 — 2026-06-16

### La clasificación de aplicaciones de confianza ahora funciona con inquilinos de cualquier tamaño

En la pestaña **Aplicaciones**, marcar aplicaciones como **De confianza** y guardar podía devolver antes **«0 clasificadas por Sonnet»** sin ningún error en inquilinos con más de una decena de aplicaciones — la clasificación por IA se enviaba como una sola solicitud sobredimensionada que se truncaba de forma silenciosa. Ahora la clasificación se realiza por lotes, de modo que cada aplicación recibe un veredicto, sin importar cuántas haya. Si alguna aplicación no se puede clasificar en una pasada (por ejemplo, se alcanzó el presupuesto diario de IA), verá un mensaje claro **«X de Y clasificadas — Guarde de nuevo para reintentar el resto»** en lugar de un cero silencioso. Marcar una aplicación como de confianza también se registra ahora correctamente en el registro de auditoría del MSP.

### La captura de diagnósticos ahora es rápida

La captura de un paquete de soporte desde **Configuración → Diagnósticos** podía quedarse bloqueada varios minutos en instalaciones con un gran historial de eventos de auditoría. Ahora se completa en unos segundos, muestra un contador de tiempo transcurrido en vivo mientras se ejecuta y ya no puede bloquearse por una consulta lenta a la base de datos.

### Nuevo control de retención para los eventos del registro de auditoría unificado

**Configuración → Retención de datos** ahora incluye los **eventos del registro de auditoría unificado** — la actividad sin procesar de Microsoft 365 que Panoptica365 ingiere para las alertas y la línea de tiempo de identidad, y con diferencia la tabla más grande. El valor predeterminado es de **90 días**, que es más que suficiente, ya que Microsoft Purview conserva la copia autoritativa a largo plazo. Auméntelo o redúzcalo según sus necesidades.

---

## Versión 0.2.11 — 2026-06-15

### Adopte la configuración de acceso condicional e Intune existente de un inquilino — supervise en su sitio

Cuando incorpora un inquilino que ya tiene sus propias directivas de acceso condicional y configuraciones de Intune, ahora puede **empezar a supervisarlas sin necesidad de enviar primero sus propias plantillas**. En las pestañas **Directivas de AC** e **Intune**, un nuevo botón **Importar la configuración existente** lee lo que ya hay en el inquilino y crea una tarjeta por directiva — marcada como **Origen: inquilino** (borde izquierdo rojo y distintivo claro) para distinguirlas de un vistazo de sus plantillas implementadas. Panoptica registra cada una como estado inicial y vigila los cambios a partir de ahí.

Desde cada tarjeta de origen del inquilino puede:

- **Dejar de supervisar** — quitar la tarjeta; esto **nunca modifica el inquilino**.
- **Desactivar** — desactivarla de forma reversible (acceso condicional: se establece como deshabilitada; Intune: se quitan las asignaciones), con la opción de seguir vigilándola. **Restaurar** la devuelve exactamente a su estado.
- **Eliminar** — quitarla permanentemente del inquilino, tras una confirmación deliberada.

Importar, desactivar, restaurar y eliminar están disponibles para **Operadores y Administradores**; la confirmación es proporcional al riesgo (Eliminar le pide escribir su propio nombre), y cada acción queda registrada en el **registro de auditoría** y en el **registro de cambios** del inquilino.

Panoptica ahora también vigila **cada** inquilino para detectar **configuración creada fuera de Panoptica** — una nueva directiva de AC o un perfil de Intune creado directamente en la consola de Microsoft — y la muestra como una tarjeta de origen del inquilino junto con una alerta, para que un cambio realizado fuera de su proceso no pase desapercibido. Para el acceso condicional, esto es **casi en tiempo real**.

Los inquilinos vacíos o sin licencia se gestionan con cuidado: si un inquilino no tiene directivas, o si su plan no incluye acceso condicional o Intune, recibe un mensaje claro en lugar de un error.

---

## Versión 0.2.10 — 2026-06-15

### Corrección: el resumen ejecutivo de un informe podía mostrar texto de código sin procesar

En inquilinos muy activos — con muchas alertas, incidentes, aplicaciones y administradores —, el texto redactado al inicio del informe de **Postura de seguridad** (y, en casos más raros, de los informes de **Evaluación rápida** y de **Documentación de la configuración**) podía aparecer con texto parecido a código en el resumen ejecutivo, incluida una etiqueta `json` y caracteres `\n` visibles, en lugar de texto limpio. Esto ocurría sobre todo en los informes generados en **francés** o **español**, donde el texto es más largo.

La causa era un límite de longitud: en un inquilino con muchos datos, el análisis redactado se cortaba antes de terminar y el resultado incompleto se imprimía tal cual. Hemos aumentado el límite para que quepa cómodamente el texto completo, añadido una protección que detecta un corte y lo sustituye por un resumen limpio basado en los datos, y garantizado que un análisis incompleto no pueda volver a imprimirse en un informe.

Si tiene un informe que muestra este problema, basta con regenerarlo después de actualizar — la nueva copia estará limpia.

---

## Versión 0.2.9 — 2026-06-14

### Exportación a CSV en toda la consola

Tres tablas ahora tienen un botón **Exportar** que descarga un CSV limpio y listo para Excel — UTF-8 con marca de orden de bytes, para que los acentos en francés y español se conserven al abrirlo en Excel para Mac:

- **Aplicaciones** (panel del inquilino) — cada aplicación con su editor, estado, indicador «Aprobada» y veredicto de riesgo almacenado.
- **Revisión de acceso** — dos exportaciones: el registro de roles con privilegios (cuenta, roles, habilitado, MFA, última actividad) y la lista completa de usuarios (cuenta, tipo, habilitado, última actividad, inactivo). La exportación de usuarios siempre contiene **todas** las cuentas, sin importar el filtro en pantalla.
- **Registro de auditoría** — todas las filas que coinciden con los filtros activos, en **todas** las páginas (no solo las 100 visibles), para la vista activa (auditoría MSP o cronología unificada).

### Los informes ahora cubren la higiene de identidades y el riesgo de aplicaciones

Los tres informes — **Postura de seguridad**, **Evaluación rápida** y **Documentación de la configuración** — ahora incluyen las mismas señales de identidad y aplicaciones que ve en las pestañas Revisión de acceso y Aplicaciones:

- **Cuentas inactivas** y **cuentas con roles de administrador** (con su estado de MFA), tomadas de la instantánea de la Revisión de acceso y respetando el umbral de inactividad que configuró.
- **Preparación de las cuentas de emergencia** — si hay un grupo de acceso de emergencia configurado y quién lo integra.
- **Riesgo de aplicaciones** — qué aplicaciones están aprobadas o no, con el veredicto de riesgo almacenado de cada aplicación no aprobada y los permisos que posee.

En los dos informes con IA (Postura de seguridad y Evaluación rápida), Claude ahora incorpora estas señales al análisis redactado; el informe de Documentación de la configuración las añade como tablas. Todo está completamente localizado en inglés, francés y español, y se degrada correctamente cuando un inquilino aún no se ha analizado (el informe lo indica en lugar de inventar hallazgos).

### Mejoras: una consola principal totalmente localizada y una pantalla de actualización más limpia

La consola principal ahora está completamente traducida — los encabezados de columna de la lista de inquilinos, el gráfico de severidad de alertas (que ahora muestra **Severo** en todas partes, igual que el resto de la aplicación, en lugar de «Crítico»), el conteo de inquilinos y la insignia de estado de cada fila siguen el idioma seleccionado. La pantalla de Actualización de software de la aplicación ya no muestra una línea en inglés redundante debajo de cada paso traducido.

### Fiabilidad: guardar la pestaña Aplicaciones ya no se agota

En inquilinos con muchas aplicaciones, el botón **Guardar** de la pestaña Aplicaciones podía fallar con un error HTTP 504 porque la evaluación con IA de los permisos de las aplicaciones no aprobadas tardaba más de lo que la puerta de enlace esperaba. Ahora el guardado transmite su progreso (igual que la generación de informes), de modo que se completa sin importar cuánto tarde la evaluación — la aprobación es inmediata y los puntos de evaluación verde/amarillo/rojo se completan a medida que termina el análisis.

---

## Versión 0.2.8 — 2026-06-13

### Nuevo: Revisión de acceso — cuentas con privilegios, cuentas inactivas y acceso de emergencia

Una nueva pestaña **Revisión de acceso** en el panel del inquilino (entre Seguridad y Aplicaciones) responde, por inquilino, a tres preguntas: quién tiene roles administrativos, qué cuentas son peso muerto y qué pasa si una directiva de Acceso condicional bloquea a todos.

La primera tabla es una lista de solo lectura de cada titular de un rol con privilegios, agrupada por nivel, que muestra para cada cuenta sus roles, su estado de habilitación, el registro de MFA y su última actividad. La segunda enumera todas las cuentas de usuario con filtros **Todas / Miembros / Invitados / Inactivas** y le permite **deshabilitar, volver a habilitar o eliminar** una cuenta directamente. Cada escritura se confirma, queda registrada tanto en el registro de auditoría del MSP como en el registro de cambios del inquilino, y está protegida en el servidor: no puede eliminar una cuenta que tiene un rol de administrador, ni deshabilitar al último Administrador global, y una eliminación es recuperable durante 30 días. La inactividad se calcula a partir de los informes de uso de Microsoft 365 en lugar de los registros de inicio de sesión del directorio, por lo que **funciona también en inquilinos Business Standard**.

### Cuentas de emergencia («break-glass»), configuradas como recomienda Microsoft

Desde la misma pestaña puede designar **cuentas de emergencia** — el administrador de respaldo al que recurre cuando una directiva de Acceso condicional mal configurada, o un proveedor de MFA caído, ha bloqueado a todos los administradores normales. Indique a Panoptica365 un grupo de seguridad dedicado y excluirá ese grupo de **cada** directiva de Acceso condicional. Una barrera de seguridad se niega a excluir un grupo con más de unos pocos miembros (para que no exima a toda su empresa por accidente), y el resultado se muestra directiva por directiva, de modo que un fallo parcial nunca se presente como un éxito. Designar una cuenta es entonces simplemente añadirla al grupo.

La acompañan dos alertas: una **alerta CRÍTICA en cuanto una cuenta de emergencia inicia sesión** — que funciona sin licencia Premium y sigue funcionando aunque haya cambiado el dominio de la cuenta — y una alerta de cobertura si el grupo deja en algún momento de estar excluido de una directiva. Una nota importante sobre el contexto actual: Microsoft ahora exige MFA en los inicios de sesión de los portales de administración con independencia del Acceso condicional, así que una cuenta de emergencia debería llevar una **llave resistente a la suplantación (FIDO2)** guardada junto con sus credenciales. La configuración guiada lo acompaña en todo esto, incluidas las prácticas de nomenclatura que evitan que estas cuentas destaquen ante un atacante.

### Fiabilidad: las alertas del registro de auditoría ahora se mantienen al día entre reinicios

Un error de temporización en el evaluador del registro de auditoría unificado podía congelar su marca de evaluación en un servidor con una zona horaria fuera de UTC, de modo que las alertas del registro de auditoría — cambios de rol de administrador, consentimientos de OAuth, concesiones de permisos de buzón y la nueva alerta de inicio de sesión de emergencia — solo se disparaban de forma fiable justo después de un reinicio. La marca ahora se lee en UTC, por lo que estas alertas se mantienen al día de forma continua.

### También en esta versión

El encabezado del panel del inquilino se rediseñó para que la barra de pestañas tenga espacio para crecer — el selector de inquilino ahora se encuentra en la barra de información como título de la página, y los botones Sondear ahora / Registrar cambio se le unieron. Se añadió una nueva guía de **Revisión de acceso** en Aprendizaje (Guías de Panoptica365), en inglés, francés y español.

---

## Versión 0.2.7 — 2026-06-12

### Los informes de evaluación rápida ahora abren con un resumen en lenguaje claro para el dueño del negocio

La evaluación rápida siempre ha producido un informe de nivel operador — hallazgos técnicos, detalle de configuración, plantillas desplegables en un clic. Esta versión añade un nuevo **resumen ejecutivo** como primera página de cada evaluación rápida, redactado para el dueño del negocio (o el cliente potencial) sin perfil técnico a quien usted entrega el informe.

Dice, en términos de negocio sencillos: dónde se encuentra el tenant hoy, qué podría salir mal de verdad para el negocio (un portátil perdido que expone archivos de clientes, una toma de control de cuenta, una interrupción del servicio — y no los nombres de controles técnicos), el único próximo paso más importante y lo que requiere, y cómo se ve una buena postura una vez dado ese paso. No contiene deliberadamente ninguna clave de configuración, nombre de campo ni jerga de producto — de modo que puede presentárselo a un dueño sin tener que traducirlo antes.

Nada más del informe cambió: la evaluación técnica completa — acceso condicional, Intune, configuración de seguridad, fortalezas y acciones prioritarias — sigue inmediatamente después, exactamente como antes. El resumen está totalmente localizado en inglés, francés y español junto con el resto del informe, y cualquier contexto que escriba en la ventana de evaluación orienta su redacción.

---

## Versión 0.2.6 — 2026-06-12

### La vía de IA ya no puede atascarse, descontrolarse ni llevarse las alertas consigo

Cada llamada al servicio de IA lleva ahora un límite de tiempo estricto (antes, el ajuste predeterminado subyacente permitía que una llamada quedara colgada diez minutos, reteniendo con ella un proceso en segundo plano). Un **presupuesto diario de tokens de IA** actúa como fusible: si un bucle descontrolado llegara a agotarlo, las narrativas de IA se pausan hasta la medianoche UTC, una alerta en el panel le explica el motivo y todo se reanuda automáticamente — importante sobre todo en instalaciones que usan su propia clave de IA, donde un descontrol es una factura sorpresa. Un **cortacircuitos** deja de insistir al servicio de IA tras fallos repetidos y reintenta por sí solo unos minutos después. En todas estas situaciones se mantiene la invariante: **las alertas siempre se disparan — solo se omite la narrativa de IA.**

### Las actualizaciones se vigilan a sí mismas durante tres minutos

El actualizador automático siempre ha comprobado la salud de una versión nueva al arrancar y revertido automáticamente en caso de fallo. Ahora además **observa la versión nueva durante tres minutos después** de superar la comprobación inicial, y revierte si se vuelve inestable — cubriendo el caso más difícil de una versión que arranca limpia y entra en bucle de fallos un minuto después. Las versiones pasan también por un **canal anticipado**: la instalación del proveedor absorbe cada versión unos días antes de que las instalaciones de clientes del canal estable la vean.

### Telemetría de salud — para que el soporte vea el problema antes de que usted escriba

Una vez al día, su instalación envía un pequeño resumen de salud al servidor de licencias: versión de la aplicación, canal de actualización, estados de las comprobaciones de salud, nombres de procesos atrasados, contador de fallos, tamaño de la base de datos, uso de disco y *número* de tenants. **Nunca nombres de tenants, identidades de usuarios, contenido de alertas ni textos de error — los datos de clientes y tenants nunca salen de su instalación.** La lista exacta de campos está documentada en la plantilla de configuración, y `TELEMETRY_ENABLED=false` la desactiva por completo.

### Cada versión pasa ahora controles de calidad automatizados

Nuevos controles de integración continua se ejecutan con cada cambio: una verificación de seguridad que prueba que cada ruta de la API lleva su guarda de autenticación, un control de completitud de los tres idiomas (inglés, francés, español — más de 3.400 cadenas verificadas estructuralmente idénticas) y una prueba de doble arranque contra una base de datos vacía — exactamente el escenario que un cliente nuevo encuentra primero.

---

## Versión 0.2.5 — 2026-06-12

### Hecho para resistir: recuperación de fallos, límites de tiempo de red y vigilantes

Panoptica365 funciona sin supervisión, así que esta versión refuerza todo lo que antes podía fallar en silencio. Si la aplicación sufre un fallo inesperado, la razón completa se escribe ahora en el archivo de registro, se anota un contador de fallos (incluido en los paquetes de diagnóstico) y el proceso se reinicia limpiamente. Cada llamada saliente — Microsoft Graph, descargas de registros de auditoría, su PSA, el servidor de licencias — tiene ahora un límite de tiempo estricto, de modo que un punto de conexión de Microsoft que deja de responder ya no puede congelar un proceso en segundo plano indefinidamente. Y si aun así un ciclo se atasca, un vigilante lo detecta, lo registra claramente y deja que el siguiente ciclo se ejecute — ningún bucle en segundo plano puede volver a quedarse bloqueado permanentemente.

### Cada proceso en segundo plano informa ahora de su pulso

El panel de salud (haga clic en el indicador de estado de la barra inferior) tiene una nueva comprobación de **Procesos en segundo plano**. Todos los bucles en segundo plano de Panoptica365 — sondeo de métricas, ingesta de registros de auditoría, sincronización de tiques PSA, planificadores de desviación de CA e Intune, resumen matinal, limpieza nocturna y más — registran ahora un latido tras cada ciclo. Si alguno queda en silencio más allá de su ritmo esperado, el panel de salud le dice cuál, desde hace cuánto y con su último error. Los procesos sin configurar (por ejemplo, PSA sin proveedor) aparecen como *inactivos por configuración* en lugar de generar avisos falsos.

### La base de datos ahora se limpia sola

Una limpieza nocturna (03:30) aplica ventanas de retención a los datos históricos que antes crecían sin límite. La nueva tarjeta **Ajustes → Retención de datos** muestra cada ventana, precargada con los valores recomendados que puede ajustar — cada una con una nota clara sobre el impacto de cambiarla, y con límites de seguridad para que un valor no pueda romper las alertas ni los informes. Los cambios se aplican desde la siguiente limpieza nocturna, sin reinicio, y quedan registrados en el registro de auditoría. **Las alertas nunca se eliminan automáticamente.**

La mayor ganancia está en las instantáneas del sondeo: el detalle completo se conserva una semana (las alertas de detección de cambios solo necesitan el sondeo anterior), mientras que el historial más antiguo se consolida en un valor compacto de Secure Score por tenant y día — exactamente lo que usan las líneas de tendencia de los informes. Paneles, alertas e informes se comportan igual. En nuestra propia instalación de producción, una base de datos de dos meses pasó de 28 GB a 10 GB.

### Nueva comprobación de salud « Tamaño de la base de datos »

El panel de salud incorpora también una comprobación de **Tamaño de la base de datos** que muestra el total real y las tablas más grandes — leyendo estadísticas frescas en lugar de las almacenadas en caché por MySQL, para reflejar la realidad de inmediato. Avisa cuando la base de datos supera un umbral configurable (10 GB por defecto), dándole tiempo para planificar el disco antes de que importe.

### Una capa de base de datos más silenciosa y robusta

Bajo carga o durante un bloqueo de la base de datos, la aplicación ahora falla rápido en lugar de acumularse: la cola de conexiones está acotada, la espera de una conexión tiene un plazo, el tamaño del pool es ajustable, y cualquier consulta que tarde más de dos segundos se registra (solo el texto de la consulta — nunca sus datos) para que las ralentizaciones puedan diagnosticarse desde un paquete de soporte.

---

## Versión 0.2.4 — 2026-06-11

### Los ajustes de seguridad ahora están en el panel de cada inquilino

Los ajustes de seguridad son, por naturaleza, propios de cada inquilino, así que ahora tienen su propia pestaña **Seguridad** en el panel del inquilino — entre **Alertas** y **Aplicaciones**. Ya no tiene que salir del inquilino en el que está trabajando, abrir la página de Seguridad aparte y volver a elegir el inquilino: todo lo de ese inquilino, incluida su postura de seguridad, está ahora en un solo lugar. La pestaña incluye el mismo botón **Actualizar** para volver a sondear los ajustes de seguridad de un inquilino cuando lo necesite, y los enlaces de «explorar un ajuste» del Mapa de calor ahora lo llevan directamente a esta pestaña, con el ajuste abierto.

La página de Seguridad independiente (en **Políticas**) sigue funcionando exactamente como antes — no se eliminó nada.

### Abrir un incidente de Defender directamente desde su alerta

Las alertas generadas a partir de un incidente de Microsoft Defender ahora muestran un botón **Abrir el incidente en Defender** que lo lleva directamente a ese incidente en el portal de Microsoft Defender — ya no hay que copiar el enlace de los datos sin procesar de la alerta. Abrirlo requiere una sesión del navegador iniciada con una cuenta habilitada para GDAP del inquilino cliente.

### Haga clic en el nombre de un inquilino en una alerta para abrir su panel

En el panel de detalle de la alerta, el nombre del inquilino ahora es un enlace. Haga clic en él para ir directamente al panel de ese inquilino, en lugar de cerrar la alerta, volver a la consola principal y buscar el inquilino a mano. (Las alertas multiinquilino del Centro de mensajes siguen mostrando sus inquilinos afectados como texto simple, ya que no apuntan a un solo panel.)

### «Solo Strict» ahora es una configuración de preajuste admitida

El ajuste de **preajuste de directiva de seguridad** (Standard / Strict) ahora reconoce como configuración válida a un inquilino que ejecuta **Strict sin la línea base Standard**. Antes, si un inquilino se desviaba a ese estado, **Aceptar** terminaba en un callejón sin salida («no corresponde a ninguna opción documentada») y tenía que corregirlo desde Configurar. Ahora puede aceptar ese estado como línea base — o elegirlo deliberadamente — como cualquier otra opción de preajuste.

---

## Versión 0.2.3 — 2026-06-11

### Corregido: los tickets de desviación ahora se vinculan a su alerta y se cierran al aceptar la desviación

Los tickets abiertos para **alertas de desviación de configuración** —desviación de Acceso condicional y desviación de política de Intune— se creaban en su PSA pero **no se vinculaban** con la alerta. Por eso no mostraban etiqueta de ticket y, cuando usted **aceptaba (o resolvía de otro modo) la desviación**, el ticket quedaba abierto: un huérfano que debía cerrar a mano. Ahora se vinculan correctamente y se cierran automáticamente al aceptar/resolver, igual que cualquier otro ticket del PSA. (Las alertas de bloqueo de cuenta e inicio de sesión nunca se vieron afectadas.)

Nota: los tickets de desviación creados *antes* de esta corrección no tienen vínculo, así que no se cerrarán solos; vacíe ese pendiente manualmente en su PSA una última vez.

### Las agrupaciones ahora consolidan sus tickets en lugar de dejarlos huérfanos

Cuando combina varias alertas en una **agrupación**, sus tickets del PSA ahora se consolidan en consecuencia. El ticket **más antiguo** se conserva como superviviente —renombrado con el título de su agrupación y vinculado a la alerta de agrupación— y los demás tickets se **cierran con una nota que apunta al superviviente**. Antes, combinar alertas dejaba abierto el ticket de cada hijo. Como el PSA no ofrece una verdadera operación de «combinar tickets», esto reproduce lo que usted haría a mano: un ticket lleva el trabajo y los demás se cierran con una referencia cruzada.

---

## Versión 0.2.2 — 2026-06-10

### Restablecimiento de contraseña de autoservicio: cada método de autenticación es ahora una casilla independiente

El control **Habilitar el restablecimiento de contraseña de autoservicio (SSPR)** antes trataba a Microsoft Authenticator, SMS y correo electrónico como un único bloque «Estándar» de todo o nada. Eso hacía imposible expresar una estrategia de refuerzo común y recomendada por Microsoft: desactivar el SMS (el método más débil) y conservar Authenticator y el correo. La pestaña Configurar no dejaba desmarcar el SMS, y si lo quitaba directamente en Entra, Panoptica365 detectaba correctamente la desviación pero **Aceptar** fallaba con el mensaje *«El valor actual desviado no corresponde a ninguna opción documentada.»*

La pestaña Configurar ahora muestra **cada** método de autenticación como su propia casilla, con el trío recomendado al principio. **Estándar** y **Deshabilitado** se convierten en preajustes de un clic — Estándar marca el conjunto recomendado, Deshabilitado borra todo — pero usted puede habilitar cualquier combinación. Lo que elija se sincroniza con exactitud: los métodos marcados se habilitan para todos los usuarios y los desmarcados se deshabilitan, de modo que la detección de desviación sigue captando cualquier cambio externo en cualquier método.

**Aceptar** (y **Coincidir**) ahora adoptan la configuración en vivo como nueva línea base sin importar cómo esté establecida, así que quitar el SMS — o cualquier otro método — ya no queda en un punto muerto. Las líneas base existentes no se ven afectadas: siguen funcionando igual que antes y pasan a la nueva forma por método la próxima vez que aplique, acepte o haga coincidir.

---

## Versión 0.2.1 — 2026-06-09

### Selección más clara al definir el alcance de una exención de alerta

Cuando crea una exención de alerta, las opciones de **alcance por país** y de **duración** se muestran como botones tipo píldora. La píldora seleccionada ahora se rellena con color mientras que las demás permanecen neutras, de modo que se ve de un vistazo qué opción está activa; antes el resaltado era tan tenue que era fácil pensar que pulsar una píldora no había hecho nada. Al pasar el cursor sobre una píldora también aparece ahora un contorno de color para indicar que se puede pulsar.

Es un cambio solo visual. La forma en que las exenciones coinciden con las alertas y las suprimen no cambia.

---

## Versión 0.2.0 — 2026-06-07

### Los tickets del PSA ahora se cierran solos cuando se resuelve la desviación subyacente

Cuando una alerta de desviación de configuración está vinculada a un ticket del PSA y esa desviación se resuelve en Panoptica365 —ya sea que haga clic en **Aceptar**, **Corregir** o **Coincidir** en el ajuste, que aplique una corrección confirmada en la siguiente comprobación, o que alguien simplemente la corrija en el portal de administración de Microsoft— Panoptica365 **ahora cierra el ticket vinculado automáticamente** y añade una nota que explica el motivo. Antes, la alerta se resolvía pero el ticket quedaba abierto, dejando tickets huérfanos tras una ronda de aceptaciones de desviación.

La única excepción es deliberada: si resuelve una alerta desde el panel de alertas y elige **«Dejar el ticket abierto»**, el ticket permanece abierto para que su técnico lo termine. Solo una resolución real de desviación activa el cierre automático.

---

## Versión 0.1.54 — 2026-06-07

### Cambiar de idioma ahora actualiza la página en la que está

Antes, cambiar el idioma de la interfaz en **Configuración** cambiaba de inmediato la barra superior y la barra lateral izquierda al nuevo idioma, pero la página del centro — un panel de inquilino, una guía de Aprender, etc. — permanecía en el idioma anterior. La única forma de verla traducida era recargar el navegador, lo que además lo devolvía a la Consola principal y lo obligaba a navegar de nuevo hasta donde estaba.

Ahora, cuando guarda un nuevo idioma, la página que está viendo se actualiza en el sitio en el nuevo idioma y usted permanece exactamente donde estaba. La barra superior y la barra lateral siguen cambiando al instante, y nada más de su sesión cambia.

---

## Versión 0.1.53 — 2026-06-07

### Nuevo en Aprender: la tarjeta Guías de Panoptica365

La sección Aprender ahora se abre con una nueva tarjeta, **Guías de Panoptica365** — 18 guías breves para el operador, paso a paso, que cubren toda la plataforma en el orden real de una instalación nueva. La secuencia comienza con **Comience aquí** y **Añada su primer inquilino** (incluida la decisión entre gestionado y solo auditoría y el flujo de consentimiento de administrador), y continúa con la consola principal, el panel del inquilino, la revisión de aplicaciones, el despliegue de directivas de Acceso Condicional e Intune, la supervisión de la configuración de seguridad, el trabajo y el ajuste de las alertas, las exenciones, las vistas de flota, los informes, las notificaciones, la integración con el PSA, los roles de usuario y la administración del sistema.

Cada guía es deliberadamente breve y explícita — nombres exactos de botones, nombres exactos de pestañas, qué pulsar y en qué orden — y complementa el plan de estudios existente de Aprender, que cubre los conocimientos de seguridad detrás de la plataforma. Como el resto de la sección Aprender, las guías están disponibles en inglés, francés y español, con los habituales puntos de no leído e insignias de ACTUALIZADO.

---

## Versión 0.1.52 — 2026-06-07

### Novedad: las instalaciones nuevas incluyen la biblioteca de plantillas inicial

Una instalación nueva de Panoptica365 ahora llega con la biblioteca completa y curada de plantillas de Acceso Condicional e Intune ya cargada — el conjunto inicial **«Panoptica365 - …»** — en lugar de una página de Plantillas vacía. Puede revisarlas y desplegarlas de inmediato en los inquilinos de sus clientes, o usarlas como punto de partida junto a sus propias plantillas importadas.

**Las instalaciones existentes no se ven afectadas.** El conjunto inicial solo se carga cuando su biblioteca de plantillas está vacía, de modo que todo lo que ya haya importado o personalizado permanece exactamente igual: nada se sobrescribe ni se duplica, ni en esta actualización ni en ninguna futura.

**Diseñadas para adaptarse a cualquier inquilino.** Las plantillas de Acceso Condicional incluidas referencian las ubicaciones mediante los marcadores de posición portátiles de Panoptica365 (así una plantilla «bloquear inicios de sesión fuera de Canadá» se resuelve a la ubicación con nombre correcta en cada inquilino cliente), se entregan con listas de exclusión de cuentas de emergencia vacías para que usted las complete, y no contienen ningún identificador propio de un inquilino específico.

---

## Versión 0.1.51 — 2026-06-07

### Refuerzo de seguridad antes del despliegue ampliado

Esta versión refuerza varios valores de seguridad predeterminados en la configuración, el inicio de sesión y los diagnósticos. No hay funciones nuevas y las instalaciones existentes no requieren cambios de configuración, pero algunos comportamientos ahora son más seguros de forma predeterminada.

**La configuración ahora exige un grupo de acceso (RBAC).** El asistente de primer arranque trataba antes los tres grupos de roles (Admins / Operadores / Visualizadores) como opcionales. El **ID de objeto del grupo Admins ahora es obligatorio** para completar la configuración. Esto cierra un valor predeterminado demasiado permisivo: si se dejaban los tres campos de grupo en blanco, cualquier cuenta que pudiera iniciar sesión en su inquilino de Microsoft obtenía acceso de Admin completo en Panoptica365. Ahora debe apuntar Panoptica365 a un grupo de seguridad de Entra, y solo los miembros de los grupos configurados pueden iniciar sesión. Las instalaciones existentes no se ven afectadas: esto se aplica a instalaciones nuevas y reinstalaciones. Los niveles Operadores y Visualizadores siguen siendo opcionales.

**El inicio de sesión falla de forma segura.** Si no se configura ningún grupo de acceso, Panoptica365 ahora deniega el inicio de sesión en lugar de admitir a todos, y nunca asigna el rol de Admin de forma predeterminada. El secreto de firma de sesión también se genera y guarda automáticamente si falta o es débil, de modo que una instalación nunca puede ejecutarse en silencio con un secreto predeterminado incorporado, y usted nunca puede quedar bloqueado por una configuración incorrecta. Una vista de datos interna que era accesible sin iniciar sesión ahora requiere una sesión válida.

**El paquete de diagnóstico es más seguro de compartir.** El paquete depurado (Ajustes → Diagnósticos) ahora enmascara sus credenciales de API del PSA (Autotask), y su resumen de configuración pasó a un modelo de «solo valores seguros conocidos»: todo lo que no reconozca explícitamente como no sensible —incluidos los secretos añadidos por futuras integraciones— se enmascara en lugar de incluirse. El paquete sigue siendo seguro para enviar al soporte, por diseño.

**Imagen más pequeña y limpia.** Los archivos de trabajo temporales obsoletos ya no se incluyen en la imagen de contenedor publicada.

---

## Versión 0.1.50 — 2026-06-06

### Nuevo: tickets nativos en el PSA — integración con Autotask

Panoptica365 ya puede crear y gestionar sus tickets directamente en su PSA mediante su API, en lugar de enviarlos por correo. El primer PSA compatible es **Autotask**, y está **desactivado de forma predeterminada**: nada cambia hasta que lo active en **Ajustes → Integración con PSA**.

Una vez activado, y con un cliente asignado a su empresa de Autotask, cualquier alerta dirigida a «soporte» abre un ticket real de Autotask —con la empresa, la cola, la prioridad y el vencimiento correctos, el análisis de IA y un enlace a la alerta en Panoptica365— en lugar de un correo analizado. Las alertas repetidas del mismo cliente y la misma política (por ejemplo, varias alertas de bloqueo de cuenta seguidas) se agrupan: la primera crea un ticket y las siguientes se añaden como notas, para no inundar su cola de duplicados.

La resolución se mantiene sincronizada en ambos sentidos. Cuando un técnico cierra el ticket en Autotask, la alerta vinculada se resuelve automáticamente en Panoptica365 en unos minutos, con una nota que explica el motivo. Cuando usted resuelve una alerta en Panoptica365, se le pregunta si también desea cerrar su ticket de Autotask: ciérrelo (con una nota de cierre) o déjelo abierto para que el técnico lo termine. Cada alerta muestra una etiqueta de ticket que enlaza directamente con el ticket de Autotask.

Los clientes que no haya asignado —y los inquilinos de solo auditoría— siguen usando la ruta de correo a ticket, de modo que puede adoptarlo cliente por cliente. Las credenciales, las opciones de cola, prioridad y estado, y la asignación cliente-empresa están todas en la nueva tarjeta **Ajustes → Integración con PSA**. La compatibilidad con ConnectWise Manage está prevista a continuación; la integración se construyó detrás de una capa de proveedor para que añadirla no afecte a Autotask.

---

## Versión 0.1.49 — 2026-06-06

### Corregido: el monitor de estado ya no marca como fallidos los puntos de conexión de Graph limitados por la licencia

La comprobación de estado de los **puntos de conexión de la API de Graph** (y el indicador en la esquina inferior izquierda) mostraba inquilinos con puntos de conexión fallidos cuando lo único «mal» era el nivel de licencia del inquilino. Varios puntos de conexión de Microsoft Graph — registros de inicio de sesión, detecciones de riesgo, informes de métodos de autenticación y las colas de alertas e incidentes de seguridad — solo están disponibles en niveles superiores (Microsoft Entra ID P1/P2, Microsoft Defender XDR). En un inquilino que no los tiene, Microsoft rechaza la solicitud, y Panoptica contaba cada rechazo como un fallo — acumulando miles de «errores» y dejando la caja de estado en rojo, de forma permanente, para inquilinos que se comportaban exactamente según su licencia.

Ahora Panoptica reconoce estas respuestas por lo que son: la capacidad no está incluida en la licencia de ese inquilino (o, en el caso de las colas de seguridad, Microsoft Defender aún no ha terminado el aprovisionamiento tras una actualización reciente de licencia). Esos puntos de conexión se marcan como **no disponibles** en lugar de fallidos: ya no cuentan para la comprobación de estado, ya no encienden la barra de estado y dejan de reintentarse innecesariamente. En cuanto un inquilino se actualiza (o Defender termina el aprovisionamiento), el punto de conexión vuelve por sí solo a «correcto» en el siguiente sondeo. Los problemas de permisos reales — un consentimiento revocado o un permiso de API que falta — se siguen notificando como fallos reales, de modo que nada realmente roto queda oculto.

Esto complementa la corrección de la versión 0.1.46, que hacía la misma distinción durante la configuración inicial; esta versión la aplica a la supervisión de estado continua.

---

## Versión 0.1.47 — 2026-06-06

### Corregido: orientación más clara para el permiso de Exchange durante la configuración

La guía de registro de aplicaciones le pide que añada el permiso `Exchange.ManageAsApp`. Microsoft expone un permiso con ese mismo nombre en **dos** API diferentes: **Office 365 Exchange Online** (el correcto) y **Microsoft Exchange Online Protection** (el incorrecto). Parecen idénticos y ambos aceptan el consentimiento del administrador, pero solo el primero funciona; elegir el incorrecto deja silenciosamente todos los ajustes de seguridad de Exchange y Cumplimiento bloqueados e ilegibles.

La guía ahora muestra una advertencia destacada en ese paso que indica exactamente qué API elegir (con su Id. de aplicación), además de un consejo: si «Office 365 Exchange Online» no aparece al buscarlo por su nombre, pegue su Id. de aplicación en el cuadro de búsqueda y aparecerá.

### Corregido: el campo del nombre en el contrato de licencia era difícil de leer

En el contrato de licencia del primer arranque, la casilla donde escribe su nombre completo mostraba texto claro sobre fondo blanco con el tema oscuro, por lo que lo que escribía parecía vacío. El campo ahora usa texto oscuro sobre blanco y es claramente legible.

---

## Versión 0.1.46 — 2026-06-06

### Corregido: la «Prueba de conexión» de la configuración ya no genera falsas alarmas con permisos limitados por licencia

El paso **Prueba de conexión** del asistente de configuración comprueba que los permisos de su registro de aplicación de Entra estén concedidos. Marcaba dos permisos —el acceso a los registros de inicio de sesión (`AuditLog.Read.All`) y el acceso a los incidentes de seguridad (`SecurityIncident.Read.All`)— como errores, incluso cuando el consentimiento del administrador estaba correctamente concedido. El motivo: esos dos extremos de Microsoft Graph también requieren que el *inquilino* tenga un nivel superior —Microsoft Entra ID P1/P2 para los registros de inicio de sesión, Microsoft Defender XDR para los incidentes de seguridad— y rechazan la solicitud en los inquilinos que no lo tienen, sin importar cómo se haya concedido el consentimiento. Eso es una capacidad del inquilino, no una configuración incorrecta.

La Prueba de conexión ahora distingue ambos casos. Un permiso solo se marca en rojo cuando falta realmente el consentimiento del administrador; los permisos que simplemente no están disponibles con las licencias actuales de su inquilino se muestran como una nota informativa («no se aplica a este inquilino: puede continuar con seguridad») en lugar de como un error. No más falsas alarmas en una instalación nueva.

---

## Versión 0.1.44 — 2026-06-05

### Nuevo: aceptación del contrato de licencia

Panoptica365 ahora presenta su contrato de licencia de usuario final durante la configuración inicial. En una instalación nueva, el asistente de configuración se detiene en el paso de bienvenida hasta que lea el contrato, escriba su nombre completo y haga clic en **Aceptar y continuar**: una aceptación deliberada y registrada en nombre de su organización. La aceptación (su nombre escrito, la versión del contrato, el idioma en que lo leyó y la hora exacta) se conserva de forma permanente.

Una nueva tarjeta **Contrato de licencia** en Configuración (solo para administradores) le permite volver a leer el contrato en cualquier momento y muestra quién lo aceptó y cuándo. Si una actualización futura incluye un contrato revisado, se solicitará a los administradores que revisen y acepten la nueva versión en el siguiente inicio de sesión antes de continuar; sus técnicos y observadores siguen trabajando sin interrupciones, de modo que la supervisión nunca se detiene.

---

## Versión 0.1.43 — 2026-06-05

### Nuevo: combine una avalancha de alertas relacionadas en una agrupación

Cuando un mismo inquilino genera muchas alertas por un mismo problema de fondo —por ejemplo, seis alertas «MFA disabled users» durante una incorporación—, ahora puede ordenarlas en una sola. Seleccione las alertas (el nuevo botón **Combinar** de la barra de acciones se habilita en cuanto marca dos o más), confirme un título y Panoptica crea una única alerta de **agrupación** para dar seguimiento a la investigación. Las alertas originales quedan marcadas como resueltas y enlazadas en ambos sentidos: la agrupación enumera cada alerta que absorbió (cada una a un clic) y cada alerta original muestra un enlace «Agrupada en →» de regreso a la agrupación.

Mientras la agrupación permanece abierta, las detecciones repetidas de las mismas condiciones se acumulan discretamente en las alertas originales en lugar de generar nuevos duplicados, de modo que el ruido se detiene sin ocultar nada. Resuelva la agrupación y, si una condición sigue presente, se generará una alerta totalmente nueva en la siguiente comprobación: su señal de «creía que esto ya estaba resuelto». Una agrupación solo puede combinar alertas de un mismo inquilino y queda deliberadamente fuera de cada estadística, informe y resumen matutino (las alertas originales siguen siendo el registro contabilizado).

### Mejorado: la barra de acciones masivas ya no hace saltar la tabla

La barra de acciones masivas del panel de alertas ahora está siempre visible, con altura fija y sus botones atenuados hasta que selecciona algo. Antes, la barra aparecía solo tras marcar la primera casilla, lo que empujaba la tabla hacia abajo y podía hacer que su clic cayera en la fila equivocada. Ese salto de diseño desapareció.

---

## Versión 0.1.42 — 2026-06-04

### Nuevo: monitor de espacio en disco

Configuración ahora incluye una tarjeta de **Espacio en disco** que muestra cuánto almacenamiento ha usado su servidor — usado, libre, total y un porcentaje con una barra de uso. Y lo más importante: Panoptica ahora lo **vigila por usted**: un aviso aparece en la parte superior de la aplicación al **80 % de uso** (y se vuelve rojo al **90 %**) para darle tiempo a liberar espacio antes de que algo falle. La misma señal alimenta el indicador de estado en la barra de estado. Esto cubre una carencia real — un disco lleno puede tumbar toda la aplicación, y ahora recibe un aviso con suficiente antelación.

### Fiabilidad: los registros ya no pueden llenar su servidor

Reforzamos el manejo de los registros de principio a fin para que un proceso ruidoso en segundo plano nunca consuma el disco: el registro de PowerShell del motor de monitoreo se reduce en el origen (dentro de la imagen de la aplicación, de modo que todas las instalaciones quedan protegidas igual) y los registros de los contenedores tienen un tope. No hay nada que configurar — viene integrado.

---

## Versión 0.1.41 — 2026-06-03

### Nuevo: Diagnóstico — capture un paquete de soporte con un clic

Configuración ahora incluye una tarjeta de **Diagnóstico** (solo administradores). Cuando algo no funcione, haga clic en **Capturar diagnóstico** y Panoptica ensambla un único paquete descargable con todo lo que necesitamos para investigar: registros de la aplicación, resúmenes de configuración, estado de la base de datos, estadísticas recientes de alertas e ingesta, espacio en disco y — en instalaciones Docker — los registros de los contenedores. Envíelo al soporte y podremos depurar de forma remota, incluso en servidores a los que no tenemos acceso directo.

El paquete se puede **enviar con seguridad**: no contiene ningún secreto, contraseña ni credencial. Cada valor de la lista de secretos se enmascara, y una pasada de depuración elimina los tokens y las claves de cada archivo antes de empaquetarlo. (Los nombres de los inquilinos se incluyen a propósito, para que el soporte pueda indicarle el inquilino afectado.) Si algún elemento no se puede recopilar — por ejemplo, si la base de datos está caída — el paquete se genera igualmente con todo lo demás, y un manifiesto en su interior indica exactamente qué faltaba. Se conservan los tres paquetes más recientes para volver a descargarlos.

### Tras bambalinas: registros en archivo duraderos + un actualizador reforzado

Los registros de la aplicación ahora también se escriben en archivos diarios con rotación (retención de 7 días), de modo que sobreviven al reinicio de un contenedor y alimentan el nuevo paquete de Diagnóstico. Además, el autoactualizador ahora ejecuta una **carga firmada criptográficamente** que el componente de actualización verifica antes de cada uso — una mejora de defensa en profundidad que mantiene bloqueada la parte más privilegiada del sistema. No requiere ninguna acción de su parte.

---

## Versión 0.1.40 — 2026-06-03

### Nuevo: activación guiada de la primera puesta en marcha de la directiva de seguridad preconfigurada Standard (MDO)

Microsoft solo crea las directivas de seguridad de correo preconfiguradas Standard/Strict de un inquilino la **primera vez** que se activan en el portal de Defender — no existe ninguna API ni comando de PowerShell que pueda crearlas desde cero. Hasta entonces, aplicar la opción en Panoptica no tenía nada sobre lo que actuar, por lo que podía parecer que la directiva «no se mantenía».

Panoptica ahora **detecta cuándo un inquilino nunca ha activado el préréglage** y, en la pestaña Remediar de la opción, reemplaza los botones Restaurar/Aceptar por un **recorrido paso a paso**. Le guía por el asistente de Defender — Exchange Online Protection y Defender para Office 365 para todos los destinatarios, a quién agregar como personas protegidas contra suplantación (ejecutivos, finanzas, RR. HH.), agregar el dominio del cliente y activar la directiva — y luego explica cómo devolver la supervisión a Panoptica. Tras activarla, haga clic en **Actualizar** y después en **Aceptar este cambio** para adoptar el préréglage de Microsoft en vivo como su línea base. A partir de entonces, Panoptica supervisa sus desviaciones como cualquier otra opción.

En inquilinos que aún no tienen Defender para Office 365 (por ejemplo, Business Standard), el recorrido cambia automáticamente a una versión más corta **solo EOP**. La Exchange Online Protection del préréglage Standard (antispam, antimalware, antiphishing) igual se aplica y debería activarse allí — el asistente de Microsoft solo omite los pasos de Vínculos seguros/Datos adjuntos seguros y suplantación. Panoptica ahora los activa correctamente y ya no informa el confuso error de sondeo que producía antes en estos inquilinos.

---

## Versión 0.1.39 — 2026-06-02

### Nuevo: tarjeta de Licencias en Configuración

Configuración ahora tiene una tarjeta de **Licencias** (solo administradores). Muestra el total de asientos con licencia, el recuento actual de asientos en todos los inquilinos que supervisa, a quién está emitida la licencia, su nivel y la fecha de vencimiento. Un botón **Actualizar ahora** informa de inmediato el recuento actual de asientos al servidor de licencias, sin esperar a la actualización semanal.

Si el recuento actual supera su total con licencia, la tarjeta indica por cuántos asientos se ha excedido para que pueda gestionar más con su proveedor.

---

## Versión 0.1.38 — 2026-06-02

### Recuperación más sencilla cuando agregar un inquilino encuentra un problema de consentimiento

A veces, finalizar el consentimiento de administrador de un nuevo inquilino falla con el error de Microsoft **AADSTS650051**. Suele ser un problema temporal en el primer intento de consentimiento de Microsoft; volver a intentarlo funciona. En lugar de mostrar un error críptico, Panoptica365 ahora explica lo ocurrido y ofrece un botón **Volver a intentar** que repite el consentimiento (lo que lo resuelve en la mayoría de los casos). Para el caso más raro en que sigue fallando — un registro de aplicación sobrante de una conexión anterior que permanece en el inquilino — el cuadro incluye una sección «Mostrar pasos de limpieza» con un script de PowerShell listo para ejecutar, rellenado con los identificadores del inquilino y de la aplicación, que elimina por completo el sobrante para que pueda agregar el inquilino sin problemas.

Consejo: cuando quite un inquilino de Panoptica365, no necesita eliminar la aplicación empresarial en el inquilino; al volver a agregarlo, simplemente se reutiliza, lo que evita por completo esta situación.

### Corregido: el resumen diario ahora funciona en instalaciones nuevas

En una instalación totalmente nueva, una discrepancia interna en la configuración de la base de datos impedía que el resumen diario (informe matutino) se guardara o cargara, por lo que la función nunca producía un resumen, sin error visible. La estructura de la base de datos ahora se reconcilia automáticamente al iniciar, incluida la autorreparación de cualquier instalación ya afectada. Las instalaciones nuevas obtienen la estructura correcta desde el principio y las existentes se reparan en el próximo reinicio.

---

## Versión 0.1.37 — 2026-06-01

### Corregido: la supervisión de Exchange Online y Cumplimiento ahora se configura durante la incorporación

Varios lectores de seguridad de Panoptica365 usan Exchange Online y Microsoft Purview, que requieren asignar dos roles de directorio de Entra — **Administrador de Exchange** y **Administrador de cumplimiento** — a la aplicación en cada inquilino. Otorgar el consentimiento de administrador crea la aplicación y sus permisos, pero **no** asigna estos roles, así que antes había que agregarlos a mano en cada inquilino, y si se omitían, los lectores de Exchange/Purview quedaban detenidos en «Esperando infraestructura».

Panoptica365 ahora asigna estos dos roles automáticamente justo después de que un inquilino otorga el consentimiento de administrador, usando un permiso que ya posee. Sin pasos manuales en el portal por cada inquilino.

Si la asignación automática no se completa la primera vez — por ejemplo, cuando el principal de servicio de la aplicación todavía se está propagando en un inquilino recién creado — puede reintentarlo desde **Inquilinos → Editar → Reasignar roles de Exchange** (solo administradores). La acción se puede ejecutar varias veces sin problema.

---

## Versión 0.1.36 — 2026-06-01

### Nuevo: eliminar un inquilino y todos sus datos

Ahora puede quitar un inquilino de Panoptica365. Resulta útil cuando un MSP pierde un cliente, o cuando desea quitar y volver a agregar un inquilino para repetir la incorporación.

En la sección **Inquilinos**, haga clic en **Editar** en un inquilino y encontrará un botón rojo **Eliminar inquilino** (visible solo para administradores). Abre una confirmación que detalla exactamente lo que se quitará: alertas, instantáneas, configuración de seguridad, asignaciones de acceso condicional, auditorías e historial de cambios. Haga clic en **No, conservarlo** para cancelar, o en **Sí, eliminar todo** para quitar permanentemente el inquilino y todos los datos relacionados. La eliminación queda registrada en el registro de auditoría.

Esta acción no se puede deshacer.

---

## Versión 0.1.35 — 2026-06-01

### Corregido: el progreso de la actualización a veces informaba un fallo falso

Al aplicar una actualización desde la aplicación, el cuadro de progreso podía mostrar brevemente «la actualización no se completó» aunque la actualización en realidad estaba teniendo éxito en segundo plano. Esto ocurría cuando un registro de estado de un intento de actualización anterior seguía en el disco: el cuadro leía ese registro más antiguo por un momento antes de que la nueva actualización lo sobrescribiera.

El cuadro de progreso ahora hace seguimiento de la actualización específica que inició e ignora cualquier estado sobrante de un intento anterior, de modo que siempre informa el resultado de la actualización que usted realmente activó.

---

## Versión 0.1.34 — 2026-06-01

### Instrucciones más claras para el registro de la aplicación de Entra

La guía de registro de la aplicación de Entra integrada en el asistente ahora muestra los tres URI de redirección que necesita su aplicación, no solo el de inicio de sesión. Las instalaciones anteriores registraban únicamente la URL de inicio de sesión, lo que servía para iniciar sesión pero hacía que Microsoft rechazara la primera incorporación de un inquilino de cliente con el error «AADSTS50011: el URI de redirección no coincide». La página de configuración ahora muestra las dos URL adicionales —una para incorporar inquilinos de clientes y otra para las funciones de configuración de Microsoft Teams—, cada una con un botón de copia y el lugar exacto donde añadirla.

El paso de permisos de API también es mucho más claro sobre dónde se encuentra cada permiso. Los permisos de Microsoft Graph están en una pestaña, pero los de Exchange Online, las API de administración de Office 365 y Microsoft Teams están en otra (`API que usa mi organización`) y hay que buscarlos por nombre. El asistente ahora indica qué pestaña usar para cada API, proporciona el nombre y el Id. de aplicación exactos que buscar, advierte que el permiso de Teams `user_impersonation` está oculto en un grupo contraído `Otros permisos` y explica qué hacer si una API no aparece en un inquilino recién creado.

---

## Versión 0.1.33 — 2026-06-01

### Corrección de fiabilidad en la configuración del certificado

Seguimiento de la configuración guiada del certificado introducida en la versión 0.1.32. En algunas instalaciones nuevas, el certificado no podía generarse porque la carpeta de destino no permitía escritura, y la etiqueta del botón **Descargar certificado** era difícil de leer. Ambos problemas están corregidos: Panoptica365 ahora siempre escribe el certificado en una ubicación con permisos de escritura, y el botón es legible. No se requiere ninguna acción más allá de instalar esta actualización.

---

## Versión 0.1.32 — 2026-06-01

### Configuración guiada del certificado para la supervisión de Exchange Online

Las instalaciones nuevas ahora aprovisionan el certificado que requiere la supervisión de Exchange Online, directamente en el asistente de configuración. Antes, una instalación nueva podía leer la mayor parte de la postura de seguridad de sus inquilinos a través de Microsoft Graph, pero las dos docenas de parámetros que dependen de Exchange Online PowerShell quedaban atenuados como «Esperando infraestructura», porque Exchange, a diferencia de Graph, rechaza un secreto de cliente y exige un certificado, y nada creaba uno por usted.

El paso de Registro de aplicación del asistente ahora tiene una nueva sección **Cargar el certificado de supervisión**. Panoptica365 genera el certificado por usted automáticamente; solo tiene que hacer clic en **Descargar certificado (.cer)**, cargar ese único archivo en la página **Certificados y secretos** de su registro de aplicación en el portal de Microsoft y continuar. Sin `openssl`, sin escribir la huella digital, sin acceso al intérprete de comandos. El botón **Probar conexión** del siguiente paso ahora también confirma que el certificado se cargó correctamente y le indica claramente si falta.

Esto afecta solo a las instalaciones nuevas — las instalaciones existentes ya configuraron su certificado durante la incorporación y no sufren cambios.

---

## Versión 0.1.31 — 2026-05-31

### Actualizaciones de software con un clic y reversión automática

Panoptica365 ahora puede actualizarse a sí mismo. Cuando se publica una versión más reciente, todos los operadores ven un aviso discreto que les informa de su disponibilidad, y un administrador puede aplicarla con un solo clic desde el menú de la cuenta, sin terminal, sin comandos `docker` y sin necesidad de acceso al intérprete de comandos.

Al hacer clic en **Actualizar ahora**, Panoptica365 crea una copia de seguridad de su base de datos, descarga la nueva versión, la pone en marcha y confirma que arranca correctamente antes de dar la actualización por exitosa. Si la nueva versión **no** arranca correctamente, se **revierte automáticamente** a la versión que estaba usando y se le informa con claridad de lo sucedido: su instancia nunca queda en un estado defectuoso. La base de datos nunca se restaura de forma automática; la copia de seguridad se conserva únicamente como medida de seguridad.

El aviso de actualización se muestra a todos, pero solo los administradores ven la acción **Actualizar**. Una actualización obligatoria se señala con un texto más firme, pero aplicarla siempre es una decisión deliberada del administrador. Cada intento de actualización (éxito, reversión o error) queda registrado en el registro de auditoría.

---

## Versión 0.1.30 — 2026-05-31

### Corregido: la configuración de una instalación nueva ahora se conserva, y se completa sola

Lo primero que se hace en un servidor Panoptica365 nuevo es ejecutar el asistente de configuración. Hasta ahora, en una instalación nueva en contenedor, el asistente podía parecer que se completaba mientras las credenciales que recopilaba —el registro de aplicación de Entra, la clave de licencia y lo demás— no se conservaban, dejando la aplicación incapaz de iniciar su sesión. La configuración ahora es totalmente sólida: todo lo que el asistente recopila se guarda en el host y sobrevive a los reinicios de contenedor y a las actualizaciones de imagen.

El último paso también se completa por sí solo. Cuando termina el asistente, Panoptica365 se reinicia una vez para aplicar su configuración, muestra brevemente una pantalla **«Finalizando la configuración: reconectando…»** y luego lo lleva directamente al inicio de sesión (o al consentimiento de administrador) en cuanto vuelve a estar disponible, sin comandos en la terminal ni reinicios manuales.

Esta es la corrección principal para las primeras instalaciones. Si configuró una instalación anterior de forma manual, nada cambia para usted.

### También en esta versión

- Los estados vacíos de primera ejecución de la consola principal —«no hay inquilinos» y «aún no hay resumen diario»— ahora aparecen en el idioma de su interfaz (español, inglés o francés) en lugar de siempre en inglés.
- Se reforzó una migración interna de base de datos para que una instalación nueva ya no registre advertencias transitorias mientras arranca.

---

## Versión 0.1.29 — 2026-05-31

### Novedad: personalice sus informes con su nombre y su logotipo

Los informes de Panoptica365 ahora pueden llevar su marca en lugar de la nuestra. Una nueva tarjeta **Marca de los informes**, en **Configuración**, le permite establecer el nombre de su empresa y subir un logotipo. Un PNG transparente da el mejor resultado — se integra limpiamente en la portada, sin un recuadro blanco detrás.

Su logotipo ahora aparece en la portada de cada informe — Postura de Seguridad, Documentación de Configuración y Evaluación Rápida — en la esquina superior izquierda, con el título, el nombre del cliente y la fecha alineados a la izquierda debajo. La línea «Preparado por» de la portada muestra el nombre de quien generó el informe en lugar de un nombre de empresa genérico: así, un comercial puede entregar a un cliente un informe con su propio nombre. El nombre de su empresa sigue figurando en el pie de página confidencial de cada página.

Si no sube nada, los informes conservan la portada predeterminada de Panoptica365.

---

## Versión 0.1.28 — 2026-05-31

### Novedad: cronología de identidad — un clic desde una alerta hacia toda la historia

Cuando se dispara una alerta de identidad —casi siempre un bloqueo de cuenta por inicios de sesión fallidos repetidos— la pregunta es siempre la misma: ¿fue una contraseña olvidada y un rociado inofensivo desde el extranjero, o la única vez en que una cuenta fue realmente tomada? Hasta ahora, responderla implicaba salir de la alerta, abrir la Actividad diaria, elegir el inquilino y filtrar a mano los inicios de sesión del usuario.

El nuevo botón **Ver cronología de identidad**, en el panel de detalle de cualquier alerta de identidad, reduce todo eso a un solo clic. Un panel de solo lectura se desliza en pantalla y muestra las últimas 24 h de actividad del usuario (ampliable a 7 días), reunidas a partir de cuatro fuentes que Panoptica365 ya recopila —inicios de sesión, registro de auditoría unificado, incidentes de Defender y otras alertas de Panoptica— en una sola pantalla ordenada por hora. Los inicios de sesión exitosos y fallidos se distinguen por color, de modo que un único éxito en un muro de fallos es imposible de pasar por alto; las ráfagas repetidas de la misma acción se agrupan en una línea con un recuento, y cada dirección IP se etiqueta como IPv4 o IPv6.

Arriba, Claude lee el panorama completo y redacta una breve evaluación en lenguaje claro —si se trata de un intento de fuerza bruta que la cuenta resistió, o de un posible compromiso que requiere acción— citando los eventos exactos en que se basó. Los ataques que solo fallan se señalan claramente como «cuenta protegida», no disfrazados de intrusiones. La evaluación se redacta en el idioma de su interfaz y se almacena en caché, de modo que reabrir la misma alerta no cuesta nada; pulse **Reanalizar** para actualizarla. Panoptica365 nunca toca el inquilino: el panel es de solo lectura, con enlaces al Centro de aprendizaje y a las consolas de Entra y Defender para cuando quiera actuar.

---

## Versión 0.1.26 — 2026-05-30

### Novedad: pestaña Aplicaciones — conozca cada aplicación de un inquilino y detecte las que cambian

Cada inquilino de Microsoft 365 acumula aplicaciones con consentimiento: herramientas de terceros a las que alguien hizo clic en «aceptar», además de registros de aplicaciones creados para scripts e integraciones. Con el tiempo nadie recuerda qué son la mitad de ellas, y cualquiera puede tener acceso permanente al correo, los archivos o el directorio. La nueva pestaña **Aplicaciones**, en el panel de cada inquilino entre Alertas y Directivas de CA, las enumera todas en un solo lugar, muestra exactamente qué puede hacer cada una y le permite marcar las que reconoce como **De confianza**.

Marcar una aplicación como de confianza guarda sus permisos actuales como base de referencia. A partir de entonces, Panoptica365 vigila esa aplicación y solo le avisa si más tarde **obtiene** permisos más allá de lo que usted aprobó: el mismo modelo de aceptar la desviación que ya usa para el acceso condicional. Quitar permisos nunca genera una alerta; solo el crecimiento más allá de su base, porque es la dirección que añade riesgo. Una aplicación que se desvía genera una sola alerta **Cambios en aplicación de confianza**, acompañada de una ficha explicativa completa en lenguaje claro.

Las aplicaciones que no ha revisado reciben una evaluación de triaje única de Claude (Sonnet): un punto verde, amarillo o rojo que le indica por dónde empezar. Despliegue cualquier aplicación para leer el razonamiento completo de Claude, sus permisos agrupados por tipo y su historial. El punto es un triaje, nunca un veredicto de «segura»: solo marcar una aplicación como de confianza guarda una base de referencia protegida.

Cuando marca una aplicación como de confianza, cualquier alerta de consentimiento OAuth abierta sobre ella se resuelve automáticamente, y esa alerta ahora enlaza directamente con la fila de la aplicación. Panoptica365 sigue sin modificar nunca un inquilino: cuando quiera quitar una aplicación obsoleta, cada fila tiene un enlace **Eliminar** que abre esa aplicación exacta en el centro de administración de Entra, donde usted confirma la eliminación (Microsoft la mantiene recuperable durante 30 días).

### Corrección: las listas de aplicaciones del Resumen ahora muestran todas las aplicaciones

En el Resumen del inquilino, los paneles **Aplicaciones empresariales** y **Registros de aplicaciones** mostraban solo las primeras 30 filas con un «+N más» silencioso: una lista de seguridad incompleta que parecía completa. Ahora muestran todas las aplicaciones en una lista desplazable, y el recuento de aplicaciones empresariales coincide con lo que ve en el portal de Entra.

---

## Versión 0.1.25 — 2026-05-30

### Novedad: Feed de mensajes de Microsoft — avísese cuando Microsoft mueve el piso

Existe un tercer tipo de desviación de configuración y, hasta ahora,
Panoptica365 solo vigilaba dos. Ya recibe alertas cuando un operador cambia
algo (desviación causada por un operador) y cuando un atacante cambia algo
(desviación causada por un atacante). La que no podía ver era Microsoft
cambiando en silencio un valor predeterminado, retirando un control o
reduciendo a quién se aplica una política: la **desviación causada por
Microsoft**. Nadie tocó el inquilino; el ajuste simplemente dejó de significar
lo que significaba la semana pasada, y no hay ningún inicio de sesión que
investigar ni nada en el registro de auditoría.

El nuevo **Feed de mensajes de Microsoft** cierra esa brecha. Elija un inquilino
en **Ajustes → Feed de mensajes de Microsoft** (su propio inquilino de MSP o
cualquier cliente incorporado: es la misma hoja de ruta de Microsoft en ambos
casos) y, una vez al día, Panoptica365 lee el Centro de mensajes de Microsoft
365 de ese inquilino, envía cada anuncio nuevo a Claude y genera una alerta
**solo cuando el cambio parece afectar un ajuste que ya vigilamos para usted**.
La mayoría de las publicaciones del Centro de mensajes son ruido; esto resalta
las pocas que importan, normalmente con semanas de antelación para que pueda
ajustarse a su propio ritmo en lugar de enterarse cuando algo se rompe.

Estas alertas son para **todo el parque**, no para un solo cliente. Un cambio de
Microsoft que afecta a toda su cartera produce **una sola** alerta que nombra a
los inquilinos afectados, nunca una docena de alertas casi idénticas. Cada
alerta incluye una explicación en lenguaje claro en su idioma, un enlace directo
a la publicación original de Microsoft y el explicativo (icono de birrete) si
quiere el «por qué importa» completo. La función se entrega **desactivada**: no
ocurre nada hasta que elige un inquilino de origen, y puede cambiarlo o volver a
«Ninguno» en cualquier momento.

De forma predeterminada, estas alertas aparecen **solo en el panel** y no se
envían por correo, ya que la desviación causada por Microsoft es de
concienciación, no un incidente. Si prefiere recibir también un correo, cambie
la política de alertas **«Cambio planificado de Microsoft»** a
soporte/personal/ambos. Y la primera vez que se lee un inquilino de origen, todo
su historial del Centro de mensajes se incorpora de una vez al panel sin
enviarle correo, de modo que activar el feed nunca satura su bandeja de entrada.

Esto requiere un nuevo permiso de Microsoft, `ServiceMessage.Read.All`,
concedido en el inquilino del que lee. Las instalaciones nuevas lo toman en la
guía de configuración; las instalaciones existentes lo conceden una vez en el
inquilino de origen elegido.

---

## Versión 0.1.24 — 2026-05-30

### Novedad: Mapa de calor — la postura de seguridad de cada inquilino, en paralelo

Una nueva página **Mapa de calor** se incorpora a la sección Consola (justo
encima de Inquilinos). Muestra la postura de seguridad de cada inquilino
gestionado según las mismas categorías — Identidad, Correo y Exchange,
SharePoint, Teams, Cumplimiento — en una sola cuadrícula, para detectar de un
vistazo qué control es débil en toda la cartera de clientes y lanzar una única
campaña de «corregir en todas partes».

Cada celda de categoría muestra una fila de puntos de estado, uno por control,
coloreados según el estado real del control: verde (en buen estado), rojo
(desviado), ámbar (sin configurar todavía), un punto neutro rayado (no
disponible en ese inquilino) y un punto texturizado (aún sin datos). Haga clic
en el encabezado de una categoría para expandirla en sus controles
individuales, y haga clic en cualquier inquilino, celda o punto para ir
directamente a la página de detalle de Seguridad de ese inquilino. Toda la
página es de solo lectura: nunca modifica nada en un inquilino.

Encima de la cuadrícula: un porcentaje de estado para toda la cartera, un panel
de «Debilidades generalizadas» que clasifica los controles débiles en la mayor
cantidad de inquilinos (haga clic en uno para ver los inquilinos afectados y la
descripción del control) y un panel de «Cambios» que destacará qué inquilino
empeoró más en una ventana móvil de 7 días. El panel de Cambios muestra un
mensaje de «recopilando línea base» hasta que se acumule una semana de
historial diario, y luego comienza a presentar tendencias reales.

El porcentaje principal bajo el nombre de cada inquilino se lee como «en buen
estado ÷ controles aplicables» y ahora también muestra la fracción en bruto —
p. ej. **100 % (17/17)** — para que quede claro que significa «de los controles
que aplican a este inquilino, esta cantidad está en buen estado», y no una
proporción de todos los controles que ofrece Panoptica365. Los inquilinos en
modo auditoría se excluyen en todas partes, con una leyenda en el encabezado que
explica la diferencia de recuento respecto a la lista de Inquilinos.

El Mapa de calor se basa en los mismos veredictos por control que alimentan la
página de Seguridad de cada inquilino, de modo que ambos nunca pueden
contradecirse. Está disponible para todos los niveles de usuario
(administrador, operador, observador) y totalmente traducido al inglés, francés
y español.

---

## Versión 0.1.23 — 2026-05-30

### Precisión de alertas: se acabaron las falsas oleadas por sondeos fallidos

Cuando Panoptica revisa un inquilino, compara lo que ve ahora con lo que vio la
última vez y le alerta sobre la diferencia — una nueva aplicación empresarial,
una regla de bandeja de entrada eliminada, etc. El problema: si una revisión
encontraba una API de Microsoft momentáneamente limitada o no disponible,
Panoptica podía leer el inventario del inquilino como brevemente *vacío*,
almacenar esa lectura vacía y luego — en la siguiente revisión correcta —
marcar **todo** el inventario como recién creado (o, en sentido contrario,
totalmente eliminado). El resultado era una ráfaga de falsas alertas, a menudo
fechadas en la creación original del objeto, meses o años atrás.

Los sondeos fallidos ya no sobrescriben los datos buenos. Cuando una
recolección falla o regresa incompleta, Panoptica ahora conserva la última
imagen válida en lugar de almacenar una vacía, de modo que un fallo transitorio
de Microsoft no puede fabricar una oleada de falsas alertas de «creado» /
«eliminado».

### Las alertas de MFA ahora nombran al usuario

Las alertas «MFA no registrado» antes mostraban `undefined` en lugar del nombre
de la persona y agrupaban a todos los usuarios afectados en una sola alerta.
Ahora muestran al usuario real y rastrean una alerta por persona.

### Los informes excluyen las alertas descartadas

Las alertas que marque como **falso positivo** ya no cuentan en las cifras de
los informes PDF, el resumen matutino ni los mosaicos del panel. Las alertas
que marque como **resueltas** siguen apareciendo — una alerta resuelta es
historial de seguridad real, y sus informes deben reflejarlo.

---

## Versión 0.1.22 — 2026-05-29

### Novedad: Aprender — el plan de formación en seguridad integrado

Panoptica365 ahora incluye una sección **Aprender** en la barra lateral
(debajo de SharePoint). Lleva todo el plan de formación en seguridad
directamente a la consola: 49 lecciones repartidas en seis temas — desde una
orientación al panorama de seguridad de Microsoft 365, pasando por los ataques
de identidad reales que afectan a los inquilinos hoy, hasta el acceso
condicional, Intune, la seguridad del correo y el Secure Score.

Haga clic en **Aprender** para ver las seis tarjetas de temas, abra un tema
para explorar sus lecciones y haga clic en cualquier lección para leerla en un
espacio de lectura amplio y cómodo. Un punto azul indica las lecciones que aún
no ha leído — desaparece en cuanto las abre — y una etiqueta **ACTUALIZADO**
señala las lecciones modificadas en las últimas dos semanas, para reconocer de
un vistazo lo que es nuevo. Todo sigue el idioma de su interfaz: español,
inglés o francés.

La sección es de solo lectura. Está ahí para aprender, ya sea que esté
poniendo al día a un técnico nuevo o repasando un control concreto antes de
configurarlo.

---

## Versión 0.1.21 — 2026-05-29

### La Evaluación rápida ahora usa Claude Opus 4.8

El informe de Evaluación rápida — el análisis profundo de las brechas en la
postura de seguridad de un inquilino, redactado por la IA — ahora usa el
modelo de nivel superior más reciente de Anthropic, Claude Opus 4.8, lanzado
esta semana. Anteriormente estaba fijado en Opus 4.7.

Se trata únicamente de una actualización del modelo: nada cambia en la forma
en que genera una evaluación ni en lo que cubre el informe. Opus 4.8 aporta un
razonamiento más sólido y un análisis más preciso, así que espere hallazgos
más ajustados y mejor priorizados. El modelo aún puede sobrescribirse por
instalación mediante la variable de entorno `OPUS_MODEL` para los operadores
que deseen fijar una versión específica.

---

## Versión 0.1.20 — 2026-05-28

### Panel del inquilino: los conteos de dispositivos Intune ahora cuadran

El panel del inquilino mostraba tres conteos de dispositivos que no
coincidían: la tarjeta **Dispositivos** (total de dispositivos
registrados en Entra), el subtítulo `X/Y cumplen` debajo (dispositivos
con un veredicto de cumplimiento registrado en Entra) y el contador de
la tabla **Dispositivos administrados por Intune** (dispositivos
inscritos en Intune). Entra e Intune rastrean poblaciones diferentes —
Entra cuenta cada dispositivo que alguna vez se registró en el
directorio, Intune solo cuenta los dispositivos actualmente inscritos en
MDM — así que los tres números eran cada uno correctos por separado
pero parecían contradictorios juntos.

Las tarjetas Dispositivos y Administrados se reemplazaron por una sola
tarjeta **Dispositivos que cumplen**. Muestra el porcentaje de
dispositivos Intune evaluables que cumplen — la única fuente donde
Microsoft realmente produce un veredicto de cumplimiento por
dispositivo. El subtítulo indica `X de Y cumplen`, más `Z no evaluados`
cuando algunos dispositivos caen en la categoría no evaluados
(típicamente servidores administrados por Defender for Endpoint en lugar
de Intune). Los servidores en MDE ya no arrastran la puntuación a la
baja — simplemente no forman parte del porcentaje.

Aparece una pequeña flecha de tendencia junto al porcentaje cuando la
puntuación de cumplimiento ha cambiado desde el sondeo anterior:
`▲ +N%` verde si mejoró, `▼ −N%` rojo si empeoró, nada cuando está
estable o es el primer sondeo. La tendencia se calcula por inquilino
en cada ciclo de sondeo y se incrusta en la métrica
`intune_compliance`.

### Panel del inquilino: la tabla de Intune muestra todos los dispositivos

El panel **Dispositivos administrados por Intune** estaba limitado a
30 filas con un sustituto `... y N más` — inútil en inquilinos con más
de 100 dispositivos. El panel ahora muestra cada dispositivo en un
contenedor desplazable (≈25 filas visibles, el resto accesibles
desplazándose) con encabezado fijo. La columna **Cumplimiento** muestra
`Cumple`, `No cumple` o `No evaluado` en lugar del vocabulario crudo
de ocho estados de Microsoft (`unknown`, `inGracePeriod`, `conflict`,
`error`, `notAssigned`, `configManager`, etc.). Las reglas de
agrupación: `compliant` y `inGracePeriod` cuentan como cumplen
(Microsoft mismo trata los dispositivos en período de gracia como
conformes para el acceso condicional); `noncompliant`, `conflict` y
`error` cuentan como no cumplen; todo lo demás es no evaluado.

### Panel del inquilino: el subtítulo de Usuarios totales ahora cuadra

El subtítulo de la tarjeta **Usuarios totales** decía antes
`{licensed} con licencia, {guests} invitados` — lo que excluía
silenciosamente a los miembros sin licencia, por lo que las dos cifras no
sumaban el total (por ejemplo, un inquilino con 58 usuarios mostraba
`8 con licencia, 40 invitados`, dejando 10 miembros sin licencia
invisibles). El subtítulo ahora indica `{licensed} con licencia,
{unlicensed} sin licencia, {guests} invitados` para que las tres cifras
siempre cuadren con el total.

El conteo `licensed` en el subtítulo ahora excluye a los invitados con
licencia — útil para comprender el tamaño de la plantilla interna. La
telemetría interna de facturación de asientos al servidor de licencias
permanece sin cambios (sigue contando todos los usuarios con licencia,
miembros o invitados); solo se ajustó el subtítulo del panel.

---

## Versión 0.1.19 — 2026-05-25

### Corrección: la instanciación MSAL de auth.js ahora es perezosa

Una instalación completamente nueva (instalador + `ENTRA_CLIENT_SECRET`
vacío en `.env` hasta que el asistente lo recopile) hacía que la
aplicación fallara al arrancar, antes de que `setupMiddleware` pudiera
redirigir al usuario a `/setup`. Causa raíz:
`new ConfidentialClientApplication(...)` de MSAL se llamaba en el momento
de carga del módulo en `src/auth.js` y lanza `invalid_client_credential`
cuando el secreto está vacío.

El cliente MSAL único ahora se construye de forma perezosa mediante
`getCCA()` en el primer uso. El módulo carga limpiamente con
configuración de Entra vacía; cualquier llamada de ruta de autenticación
antes de que el asistente se complete falla con un error claro «complete
primero el asistente de configuración en /setup» en lugar de hacer caer
el proceso. La exportación `cca` se reemplaza por `getCCA` (ningún
llamador externo usaba `auth.cca`).

Este era el último error que bloqueaba el flujo
`curl install.panoptica365.com/run` → arranque de la pila Docker →
recorrido del asistente → llegada a la Consola Principal. Detectado por
la prueba de extremo a extremo de la fase 4 parte A en P365-Test, que
es la primera ruta de instalación que realmente ejerció una
configuración de Entra completamente vacía al arranque.

---

## Versión 0.1.18 — 2026-05-25

### Asistente: paso de Nombre de host eliminado (ahora 7 pasos)

El asistente de configuración inicial ya no pregunta por el nombre de
host ni el correo de Let’s Encrypt. Esos valores ahora son recopilados
por el instalador de la etapa 4 en `install.panoptica365.com/run` ANTES
de que arranque la pila Docker — así Caddy aprovisiona el TLS desde el
arranque, y el operador va directamente a la URL
`https://<nombre-de-host>/setup` con TLS válido ya en su lugar. El
asistente pasa de 8 a 7 pasos: Bienvenida → Registro de aplicación →
Credenciales de Entra → SMTP → Anthropic → Licencia → Primer inquilino.

Las instalaciones existentes que ya superaron la configuración no se
ven afectadas. Las instalaciones que ejecutaron el asistente de las
versiones v0.1.10 a v0.1.17 ya tienen el nombre de host marcado como
completado en su estado de configuración; la nueva lista de pasos sigue
respetando la red de seguridad `setup-completed-once.flag`. El endpoint
heredado `/api/setup/hostname` permanece en `api-setup.js` para
compatibilidad hacia atrás pero ya no es llamado por el frontend.

---

## Versión 0.1.17 — 2026-05-25

### Consola principal: cuadro de búsqueda de inquilinos

El panel de inquilinos en la Consola Principal ahora tiene un cuadro
de búsqueda justo debajo del encabezado. Empiece a escribir cualquier
parte del nombre de visualización de un inquilino — la lista se filtra
en tiempo real, sin distinguir mayúsculas, por coincidencia de
subcadena. Útil cuando un MSP tiene decenas (o cientos) de clientes y
necesita saltar a uno rápidamente sin desplazarse.

- **Subcadena, no prefijo.** Escribir `CAE` coincide con todos los
  inquilinos que contengan «CAE» en cualquier parte del nombre, no solo
  los que empiezan por `CAE`.
- **Sin distinguir mayúsculas.** `cae`, `CAE` y `Cae` devuelven las
  mismas coincidencias.
- **Botón de limpiar + Esc.** Aparece un botón `×` en la barra de
  búsqueda cuando hay un filtro activo; al hacer clic se borra el
  campo y se restaura la lista completa. Pulsar Esc mientras el cuadro
  de búsqueda tiene el foco hace lo mismo.
- **Sobrevive al refresco automático.** El panel de inquilinos
  recarga los puntajes cada 5 minutos; su filtro y lo que ha escrito
  se conservan a través del refresco.
- **El contador refleja el filtro.** El contador del encabezado pasa
  de «12 inquilinos» a «3 de 12 inquilinos» durante el filtrado, para
  que sea obvio cuánto de la lista completa está oculto.

Localizado en/fr/es.

---

## Versión 0.1.16 — 2026-05-25

### Remediación automática CA retirada — corrección de seguridad

El verificador de desviación de Acceso Condicional ya no aplica
automáticamente (PATCH) las directivas activas para restaurarlas al
estado de la plantilla, incluso en asignaciones previamente configuradas
como «Supervisar + Remediar». Es una corrección de seguridad.

**Por qué.** La lista de denegación `NON_REMEDIABLE_FIELDS` añadida en
abril estaba destinada a proteger las listas `excludeUsers` /
`excludeGroups` propias del inquilino, omitiendo esos campos del cuerpo
del PATCH. Pero la semántica PATCH de Microsoft Graph sobre un objeto
anidado (`conditions.users`) **reemplaza todo el subobjeto** con lo que
se envía — por lo que omitir `excludeUsers` hacía que Graph lo vaciara a
un arreglo vacío. Confirmado en producción el 2026-05-25: se eliminaron
nueve exclusiones de usuarios en cinco inquilinos en un solo ciclo de
desviación, justo después de que v0.1.15 habilitara la detección de
desviación en la lista de exclusión de la plantilla solo-Canadá.

**Lo que cambia.**

- El planificador de desviación horario ahora solo **detecta** la
  desviación y dispara alertas. Nunca hace PATCH de una directiva
  activa. La columna `enforcement` se conserva por compatibilidad
  retroactiva pero ya no la lee el código de la aplicación.
- El botón **CAMBIAR A SUPERVISAR / CAMBIAR A REMEDIAR** se elimina de
  la tarjeta de asignación CA. La fila «Aplicación» también se elimina.
- El antiguo botón «REMEDIAR» sobre una asignación con desviación se
  renombra a **APLICAR PLANTILLA** y se estiliza como acción destructiva.
  El cuadro de confirmación advierte explícitamente sobre la semántica
  de borrado de `excludeUsers` / `excludeGroups`, para que un operador
  no pueda ser sorprendido sin consentimiento.
- El modal de asignación de plantilla ya no pregunta por el modo de
  aplicación — todas las nuevas asignaciones se crean en modo
  supervisar por defecto.

**Modelo operativo a partir de ahora** (ahora coincide con Despliegues
Intune): se detecta la desviación → se dispara la alerta → el operador
hace clic en **Aceptar desviación** para reconocer la variación propia
del inquilino como intencional (estado naranja ACEPTADO, suprimido por
hash) o **Aplicar plantilla** para sobrescribir explícitamente la
directiva activa con el estado de la plantilla, aceptando el borrado.

**Para los inquilinos afectados**: nueve exclusiones de usuarios en
Calogy Solutions, Dienamex, Tatum, Thymox y Trilogiam fueron eliminadas
durante la ventana del incidente v0.1.15. La tabla `ca_drift_log` de
Panoptica365 conserva cada GUID eliminado en `actual_value`, por lo que
la restauración consiste en pegar los GUID en el selector de usuarios
del portal Entra. Se requiere acción del operador.

---

## Versión 0.1.15 — 2026-05-25

### Detección de desviación CA: los cambios en listas de exclusión ya se detectan

Agregar o quitar un usuario/grupo de la lista **excludeUsers** o
**excludeGroups** de una política de Acceso Condicional pasaba
silenciosamente inadvertido para la detección de desviación en algunas
plantillas — el comparador nunca comparaba esos campos porque no
figuraban en la lista de campos supervisados de la plantilla. Un
operador que agregara un usuario excluido a una política CA desplegada
(por ej. «Permitir acceso solo desde Canadá») no veía ninguna
desviación, ninguna alerta, ninguna entrada en la tarjeta CA.

La corrección reinyecta `conditions.users.excludeUsers` y
`conditions.users.excludeGroups` en los campos supervisados de cada
plantilla CA al arrancar el servidor. Idempotente — las plantillas que
ya los tenían quedan intactas. Los mismos valores predeterminados ya se
aplicaban a las *nuevas* importaciones de plantillas desde que llegó el
sistema de exenciones, pero el rellenado para las plantillas
preexistentes solo vivía en una migración SQL manual no cableada al
arranque — lo que significaba que una instalación nueva o cualquier
importación posterior al arreglo podía caer en el estado roto. Ahora
ambos caminos convergen.

Tras la actualización, el siguiente ciclo de desviación (o un «Verificar
desviación» manual en la tarjeta CA) detectará correctamente los
cambios en las listas de exclusión y disparará la alerta informativa
«Lista de exención CA modificada», que luego puede aceptar como una
exención intencional o revertir a través de la política en vivo.

---

## Versión 0.1.14 — 2026-05-24

### Modal de registro de app: las etiquetas de negrita se muestran + no más icono de copia duplicado

Dos pequeñas correcciones detectadas durante la verificación de v0.1.13
en P365-Test:

- Tres viñetas en el modal (pasos 3.5, 3.6 sobre el secreto del cliente,
  y paso 1.5 sobre hacer clic en Registrar) mostraban
  `<strong>Agregar</strong>`, `<strong>Valor</strong>` y
  `<strong>Registrar</strong>` como texto HTML en bruto en lugar de
  poner las palabras en negrita. Misma corrección que en v0.1.12 — tres
  atributos `data-i18n` cambiados a `data-i18n-html`.

- Las filas de permisos en el modal tenían dos iconos de copia uno al
  lado del otro por fila. Causado por pasar el carácter del icono como
  texto de visualización del botón además del span del icono siempre
  presente. Ahora usa un ayudante de botón de copia solo con icono
  dedicado.

---

## Versión 0.1.13 — 2026-05-24

### Asistente: guía completa de registro de aplicación de Entra + botón Probar conexión

El paso de Entra en el asistente de configuración inicial era el bloque
manual más largo de la instalación — los operadores tenían que saber
crear ellos mismos el registro de aplicación con la configuración
multi-inquilino correcta, los ~58 permisos correctos, el consentimiento
de administrador y los dos roles RBAC para los módulos de PowerShell.
Es fácil omitir algo y enterarse meses después cuando una funcionalidad
no funciona en silencio.

Esta versión añade un paso dedicado de **Registro de aplicación** con
un modal grande que contiene instrucciones detalladas clic por clic:

- El catálogo completo de los 58 permisos (47 de aplicación de
  Microsoft Graph + 6 delegados, 1 Exchange Online, 2 Management APIs,
  2 Skype/Teams), ordenado para coincidir con la interfaz del portal
  de Entra, con un icono de copia en cada nombre de permiso (más un
  botón «copiar todo» por categoría).
- La URI de redirección derivada del nombre de host, copiable con un
  solo clic.
- Asignaciones de roles del principal de servicio paso a paso
  (Administrador de Exchange + Administrador de cumplimiento), con
  advertencias explícitas contra los roles con nombres similares
  «Administrador de destinatarios de Exchange» / «Administrador de
  datos de cumplimiento» que parecen correctos pero no funcionarán.
- Guía para crear los tres grupos RBAC (Panoptica365 Admins / Operators
  / Viewers) con nombres sugeridos que coinciden con la nomenclatura
  interna de roles de Panoptica365, más botones de copia.
- Cuadros codificados por color: rojo para trampas «NO hacer», ámbar
  para pasos fáciles de omitir, verde para señales «debería ver» de
  confirmación.
- Enlace «Ya tengo un registro de app — saltar» para operadores que
  aprovisionaron mediante PowerShell o están reinstalando.

El paso de pegar credenciales ahora tiene:

- Tres campos de ID de grupo (Admins / Operators / Viewers) en lugar
  de solo el de admin, con admin marcado como recomendado y los otros
  dos opcionales.
- Un botón **Probar conexión** que adquiere un token de aplicación y
  lanza ~9 llamadas Graph representativas en paralelo. Si la solicitud
  de token falla, diagnostica códigos de error comunes de Microsoft
  (AADSTS7000215 = valor de secreto incorrecto pegado, AADSTS90002 =
  ID de inquilino incorrecto, etc.). Si el token funciona pero las
  llamadas Graph devuelven 403, lista exactamente qué permisos faltan
  (la causa más común es «olvidó hacer clic en Otorgar consentimiento
  de administrador»).
- Un enlace «Reabrir el modal de instrucciones del registro de
  aplicación» por si el operador necesita volver a verificar un paso.

Completamente localizado en/fr/es.

---

## Versión 0.1.12 — 2026-05-24

### Asistente: los enlaces y bloques de código incrustados se muestran correctamente

Varias descripciones del asistente hacen referencia a Entra
(entra.microsoft.com), a la consola de Anthropic, a ejemplos de nombres
de host y al formato de clave de activación `PNX-...`. Esos enlaces
`<a>` y fragmentos `<code>` se mostraban como texto HTML en bruto. El
renderizado utiliza ahora el modo innerHTML correcto para las claves de
i18n que contienen marcado.

(Detectado durante la verificación del pulido de v0.1.11 en P365-Test.)

---

## Versión 0.1.11 — 2026-05-24

### Pulido del asistente

Dos pequeñas correcciones detectadas durante la verificación de extremo
a extremo en P365-Test (v0.1.10):

- **El botón Atrás conserva ahora los valores introducidos.** Los
  campos del formulario (incluidos los largos GUID de Entra, el
  servidor, el usuario y la contraseña SMTP, la clave de Anthropic y la
  clave de activación de licencia) ya no se borran al hacer clic en
  Atrás. Los valores se recuerdan al navegar entre los pasos dentro de
  la misma sesión del asistente.

- **Banner de encabezado rediseñado.** El asistente cuenta ahora con un
  banner cromado de ancho completo en la parte superior, con un logotipo
  de Panoptica365 destacado y el selector de idioma, en el estilo visual
  del encabezado de la aplicación principal. Reemplaza el pequeño logo
  flotante que era poco visible sobre el fondo oscuro.

---

## Versión 0.1.10 — 2026-05-24

### Asistente de configuración inicial

Las nuevas instalaciones ahora arrancan en un asistente web guiado de 7
pasos en lugar de requerir la edición manual del archivo `.env` y una
llamada `curl` de activación de licencia. El asistente guía a los
operadores a través del nombre de host y TLS, el registro de aplicación
de Entra, el SMTP con envío de prueba, la clave API de Anthropic con
llamada de prueba, la activación de licencia contra el servidor de
licencias y un onboarding opcional del primer inquilino.

Las instalaciones existentes se detectan automáticamente — si ya hay un
`LICENSE_TOKEN` válido en `.env`, la configuración se marca como
completada retroactivamente y el asistente nunca aparece. No se
requiere ninguna acción de los operadores actuales.

El asistente está completamente localizado en inglés, francés de Quebec
y español. Los operadores eligen el idioma mediante el selector en la
esquina superior derecha; la elección se traslada a las preferencias
del operador una vez completada la configuración.

---

## Versión 0.1.9 — 2026-05-24

### Las imágenes de contenedor ahora se descargan desde GitHub Container Registry

Las nuevas instalaciones de clientes ya no construyen la imagen de
Panoptica365 a partir del código fuente. La imagen Docker publicada está
ahora disponible públicamente en `ghcr.io/panoptica365/app:latest`, y
`docker-compose.yml` la descarga directamente. Este es el requisito previo
para el instalador de la etapa 4 (`install.panoptica365.com/run`, próximo
a publicarse) — un comando de instalación de una sola línea podrá levantar
una pila Panoptica365 funcional en un host Ubuntu nuevo en minutos, sin
entorno de desarrollo.

Las instalaciones existentes no verán ningún cambio de comportamiento.
Para quienes iteran sobre el código fuente local con fines de desarrollo,
el bloque `build:` del archivo compose se conserva — `docker compose build
&& docker compose up` sigue funcionando exactamente igual que antes.

---

## Versión 0.1.8 — 2026-05-24

### Validación de licencia

Panoptica365 ahora requiere una licencia válida para iniciarse. Cada
instalación se activa una sola vez contra `license.panoptica365.com` para
canjear una clave de activación por un token firmado, y luego renueva ese
token cada semana para mantenerlo al día. El servidor de licencias solo se
contacta para la activación y la renovación — la verificación diaria es
totalmente fuera de línea, así que una caída del servidor de licencias no
puede dejar fuera de servicio su instalación.

La activación se hace una sola vez por instalación. Después de que el
instalador (o un `curl` contra `/api/v1/activate`) coloque el token en
`.env`, el arranque lo verifica y guarda una copia de respaldo en
`data/state/license-cache.json`, de modo que un borrado accidental de
`.env` nunca le costará tiempo de inactividad.

### Banner de caducidad

Si una licencia de pago supera su fecha de caducidad, aparece un banner en
la parte superior de la página — ámbar durante el período de aviso de 14
días, ligeramente más oscuro durante los días 15 al 21, cuando ya no se
pueden añadir nuevos inquilinos, plantillas de Intune ni plantillas de
acceso condicional, y rojo a partir del día 22, cuando la instalación pasa
a modo de solo lectura. Las licencias NFR nunca ven el banner porque son
perpetuas por diseño.

El texto del banner y el botón **Contacte con license@panoptica365.com**
están completamente localizados en inglés, francés de Quebec y español.

### Lo que NO cambia

Las alertas existentes, el sondeo, la detección de desviaciones, los
ajustes de seguridad, los informes y todas las demás funcionalidades
siguen funcionando exactamente como antes. La validación de licencia es
una capa fina en el arranque y un middleware — no afecta a ningún
comportamiento operativo cuando la licencia está en regla.

---

## Versión 0.1.7 — 2026-05-22

### Ver las novedades — dentro de la aplicación

El encabezado ahora incluye un menú **Novedades** (haga clic en su nombre en
la esquina superior derecha). Cada versión muestra sus puntos destacados a un
solo clic — la versión más reciente aparece de forma predeterminada, con una
pestaña expandible **Versiones anteriores** para consultar el historial
completo.

También verá un pequeño punto de no leído junto a su nombre cada vez que
exista una versión que aún no haya consultado, y una notificación única al
primer ingreso después de una actualización — para que ninguna versión nueva
pase desapercibida.

Dos pequeños añadidos en la misma área: el botón **Cerrar sesión** se ha
incorporado al mismo menú desplegable (junto a Preferencias), y la versión
actual de la aplicación ahora aparece al pie de la barra lateral izquierda.

---

## Versión 0.1.6 — 2026-05-22

### Nuevo informe — Evaluación rápida

Un nuevo tipo de informe está disponible en **Informes → Evaluación rápida**.
Mientras que el informe Documentación de configuración es una instantánea
puramente fáctica, la Evaluación rápida es un informe *consultivo*: toma la
configuración actual de un inquilino y la somete a un análisis profundo por
IA que destaca las fortalezas, las debilidades y — sobre todo — **lo que
falta**.

Revisa el Acceso condicional, Intune y la postura completa de configuración
de seguridad, y señala las brechas respecto a las líneas base recomendadas
por Microsoft: políticas de Acceso condicional faltantes, políticas de Intune
ausentes o débiles, parámetros de seguridad que se han desviado de su estado
recomendado. Cuando Panoptica365 ya cuenta con una plantilla capaz de cerrar
una brecha, la recomendación se marca como un despliegue de un solo clic — y
la brecha se reporta de todas formas aunque no exista una plantilla para
cubrirla.

Al hacer clic en **Generar informe**, aparece un cuadro donde puede agregar
contexto en texto libre para el análisis — el tipo de negocio del cliente,
inquietudes conocidas, cualquier elemento que el análisis deba considerar
(puede pegar notas allí). El informe es una instantánea puntual — sin rango
de fechas — y está disponible para inquilinos en modo solo-auditoría, lo que
lo convierte en un entregable natural para un compromiso de prueba.

### «Sondear ahora» ya no reporta un tiempo de espera falso

Iniciar un sondeo bajo demanda de un inquilino — especialmente uno recién
agregado, donde el primer sondeo debe traer todo — podía mostrar un error
«Sondeo fallido: HTTP 504» aunque el sondeo continuara ejecutándose y
terminara con éxito.

Los sondeos bajo demanda ahora se ejecutan en segundo plano. El sondeo se
inicia de inmediato, el panel mantiene su estado «Sondeando…», y la página
se actualiza por sí sola en el momento en que el sondeo termina (o reporta
un error claro si efectivamente falla). Un sondeo de larga duración ya no
puede provocar un tiempo de espera de la pasarela.

### Los informes PDF ahora se generan en instalaciones de servidor

La generación de un informe de Documentación o Postura de seguridad de un
inquilino podía fallar en una instalación de servidor con un error «No
module named …» — el instalador no aprovisionaba las bibliotecas de Python
(ReportLab, matplotlib) de las que dependen los generadores de PDF. El
script de instalación ahora crea un entorno de Python dedicado con esas
bibliotecas, de modo que la generación de informes PDF funciona desde el
primer momento en una instalación nueva.

### Agregar un nuevo inquilino ahora es confiable al primer intento

La incorporación de un inquilino completamente nuevo podía fallar al primer
intento con un error de consentimiento — la aplicación Panoptica365
terminaba registrada en el inquilino del cliente con sus permisos
concedidos, pero el inquilino no aparecía en su lista, por lo que era
necesario ejecutar **Agregar inquilino** una segunda vez para que se
mostrara.

La causa: el punto de consentimiento de administrador de Microsoft fallaba
intermitentemente la redirección cuando se solicitaban permisos para dos
API diferentes (Microsoft Graph y la API de administración de Teams) en un
único consentimiento — aunque el consentimiento en sí hubiera tenido éxito.
Agregar inquilino ahora los solicita como dos pasos de consentimiento
separados: el primero registra el inquilino, el segundo concede los
permisos de administración de Teams. Un fallo en el primer intento ya no
ocurre. Verá dos pantallas de consentimiento de Microsoft durante Agregar
inquilino en lugar de una, y el inquilino se guarda después de la primera,
independientemente del resultado de la segunda.

---

## Versión 0.1.5 — 2026-05-21

### Eliminaciones más limpias de inquilinos en modo solo-auditoría

Cuando un inquilino en modo solo-auditoría llega al final de su ciclo de
vida de 21 días y se limpia automáticamente de Panoptica365, el operador
recibe un correo de resumen que confirma lo que se eliminó. Anteriormente,
ese correo podía incluir una advertencia espuria «1 error durante la
cascada» que se refería a una tabla de catálogo de reglas globales que la
limpieza nunca necesitaba tocar. La advertencia era visualmente alarmante
pero no tenía ningún efecto en la limpieza real.

El inventario de limpieza ha sido corregido. Las futuras eliminaciones de
inquilinos en modo solo-auditoría reportarán cero errores en el correo de
resumen — lo que ve en el correo ahora corresponde a lo que realmente
ocurrió.

### Documento de diseño del modo solo-auditoría actualizado

El documento de diseño en `Documentation/Audit-Only-Tenant-Mode.docx` se ha
ampliado con un apéndice de estado con fecha 2026-05-21. El apéndice
registra la validación de extremo a extremo en producción sobre el primer
inquilino de pago en modo solo-auditoría (consentimiento → sondeo →
exportación de instantánea → correo de advertencia a los 14 días →
eliminación en cascada a los 21 días + recordatorio de revocación), la
revisión de integración añadida el 29 de abril para excluir a los inquilinos
en modo solo-auditoría de alertas/IA/notificaciones/comprobaciones de salud,
la extracción de Graph en vivo añadida al empaquetador de instantáneas el
mismo día, y la corrección del inventario de cascada mencionada arriba.

---

## Versión 0.1.4 — 2026-05-21

### Cambio rápido entre inquilinos desde el panel

El encabezado del panel del inquilino ahora incluye un **selector de
inquilino** — una lista desplegable con todos sus inquilinos, en el lugar
donde antes aparecía el nombre del inquilino.

- Pase directamente del panel de un inquilino al de otro sin volver a la
  consola principal y elegir un inquilino de la lista.
- Su pestaña actual se conserva al cambiar. Si está mirando las **Políticas
  de Intune** de un inquilino, elegir otro inquilino lo lleva directamente a
  las **Políticas de Intune** de ese inquilino — y lo mismo ocurre con las
  pestañas Resumen, Alertas, Políticas de AC y Registro de cambios.

Esto elimina varios clics en la tarea común de revisar la misma área a
través de varios inquilinos.
