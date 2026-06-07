---
title: "Administración del sistema"
subtitle: "El resto de la Configuración y las superficies del sistema: feed del Centro de mensajes, marca, licencias, diagnóstico, estado, actualizaciones y el registro de auditoría."
icon: "wrench"
last_updated: 2026-06-07
---

# Administración del sistema

La guía de cierre: todo lo que un Administrador toca de vez en cuando y no a diario. Todo vive en **Configuración** y en la sección **Sistema** de la barra lateral.

## Feed de mensajes de Microsoft

Microsoft anuncia los cambios de plataforma en el Centro de mensajes — incluidos cambios que alterarán configuraciones que usted supervisa. **Configuración → Feed de mensajes de Microsoft** le permite elegir **un inquilino de origen** cuyo Centro de mensajes Panoptica365 lee a diario. Claude filtra el feed buscando elementos relevantes para la configuración supervisada, y los relevantes llegan como **una sola alerta a nivel de MSP** (no spam por inquilino). Elija como origen su propio inquilino de MSP o su cliente más representativo; el contenido del feed es el mismo en todo Microsoft.

## Marca de los informes

**Configuración → Marca de los informes** — el nombre de su empresa (la línea *«Preparado por ___»* en portadas y pies de página) y su logotipo (PNG transparente, máximo 2 MB, redimensionado automáticamente). Configúrelo una vez, antes del primer entregable para un cliente.

## Clave API de Claude

**Configuración → Clave API de Anthropic** — la clave detrás de todas las funciones de IA (análisis de alertas, resúmenes, triaje, narrativas de informes). La rotación es indolora: pegue la nueva clave, **Probar clave** y luego **Guardar** — el proceso en ejecución la toma de inmediato, sin reinicio.

## Licencias

**Configuración → Licencias** — vista de solo lectura de sus puestos con licencia, el uso actual en los inquilinos supervisados, el nivel y el vencimiento, con un botón **Actualizar ahora**. Si se pasa de puestos, lo dice sin rodeos; contacte con su proveedor para añadir puestos.

## Diagnóstico y disco

**Diagnóstico** captura un paquete de soporte — registros, resúmenes de configuración, estado de la base de datos — para investigar problemas junto con el soporte. Los paquetes están **redactados**: sin secretos, contraseñas ni credenciales. Capture, descargue y adjúntelo a su correo de soporte.

**Espacio en disco** muestra el almacenamiento del servidor con avisos al 80 % y estado rojo al 90 % — en esos niveles aparece además un banner en la parte superior de la aplicación. No lo ignore; un disco lleno se lleva la supervisión por delante.

## Indicador de estado

El punto de estado de color en la cabecera es el estado de la propia plataforma: **Correcto**, **Degradado** o **Roto**. Haga clic para abrir el modal Estado del sistema — comprobaciones por componente, para que «Degradado» se convierta en «qué subsistema, exactamente». Si las alertas parecen sospechosamente calladas, este es el primer clic. *Todos los sistemas funcionan con normalidad* es la respuesta que quiere ver.

## Actualizaciones y Novedades

Tras una actualización, un aviso anuncia la nueva versión y el modal **Novedades en Panoptica365** resume lo que cambió — en su idioma. Lleva treinta segundos y con frecuencia revela funciones que de otro modo pasarían desapercibidas (estas guías llegaron precisamente en una de esas, de hecho).

## El Registro de auditoría

**Registro de auditoría** (barra lateral → Sistema, Administrador) es el registro de rendición de cuentas, en dos vistas:

- **Auditoría MSP** — las acciones de los operadores sobre la propia plataforma: inicios de sesión, CRUD de plantillas, cambios de configuración, denegaciones de rol (403), ciclo de vida de inquilinos, exportaciones. Filtre por categoría, actor, descripción, intervalo de fechas y resultado; las tarjetas de resumen muestran el volumen y los fallos de los últimos 30 días.
- **Cronología unificada** — los eventos de auditoría MSP intercalados con los eventos de cambio por inquilino (despliegues automáticos y cambios registrados a mano) en un solo flujo. Es la vista de «qué pasó hacia las 3 de la tarde del martes», que une *quién hizo qué en Panoptica365* con *qué cambió en los inquilinos*.

Haga clic en cualquier fila para ver el detalle completo: actor, IP, sesión, destino, metadatos.

---

Ese es el recorrido completo. A partir de aquí, el resto de Aprender cubre el conocimiento de *seguridad* detrás de la plataforma — diseño de Acceso Condicional, líneas base de Intune, seguridad del correo, Puntuación de seguridad y los patrones de ataque que sus alertas vigilan. Añada inquilinos, despliegue sus líneas base, ajuste las alertas — y deje que la plataforma haga las rondas.
