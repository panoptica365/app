# Novedades de Panoptica365

Notas de versión orientadas al cliente. Cada versión a continuación describe
lo que cambió en esa entrega, comenzando por la más reciente.

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
