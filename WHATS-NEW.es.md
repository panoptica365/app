# Novedades de Panoptica365

Notas de versión orientadas al cliente. Cada versión a continuación describe
lo que cambió en esa entrega, comenzando por la más reciente.

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
