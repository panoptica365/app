# Novedades de Panoptica365

Notas de versión orientadas al cliente. Cada versión a continuación describe
lo que cambió en esa entrega, comenzando por la más reciente.

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
