---
title: "Vistas de parque — Mapa de calor, Actividad diaria y SharePoint"
subtitle: "Las superficies multiinquilino: la postura como cuadrícula, el clima de autenticación de hoy y las auditorías de uso compartido."
icon: "layout-grid"
last_updated: 2026-06-07
---

# Vistas de parque — Mapa de calor, Actividad diaria y SharePoint

Las páginas por inquilino responden a «¿cómo va este cliente?». Tres páginas responden a la pregunta del MSP: «¿cómo va el *parque*, y dónde invierto el siguiente esfuerzo?»

## Mapa de calor

El **Mapa de calor** (barra lateral) es cada inquilino gestionado × cada control de seguridad supervisado, como una cuadrícula de puntos de estado.

Arriba, la **puntuación del parque** — el porcentaje de controles *aplicables* que están en buen estado en los inquilinos gestionados — con tres tarjetas de estadísticas: Inquilinos gestionados, Datos obsoletos y Exenciones activas. Lo de «aplicables» importa: los controles que un inquilino no puede tener (limitados por licencia, no pertinentes) cuentan como *No disponible*, no como fallos.

Las dos franjas de abajo son donde está la palanca:

- **Cambios — mayores variaciones en 7 días.** Qué inquilinos retrocedieron (o mejoraron) más esta semana. Un inquilino que cae cinco puntos es una conversación que hay que tener *ahora*.
- **Debilidades generalizadas — candidatos a campaña.** Controles en rojo o sin configurar en la mayoría de los inquilinos. Esta es su lista de campañas de remediación: un control, corregido en todas partes, en una sola pasada. Haga clic en una fila para abrir el panel lateral de campaña — inquilinos afectados, los detalles del control y enlaces directos a la página de Seguridad de cada inquilino.

La cuadrícula en sí empieza plegada por categorías; haga clic en el encabezado de una categoría para expandirla en columnas por control. Leyenda de los puntos: **En buen estado** (verde), **Desviado** (rojo), **Sin configurar** (amarillo), **No disponible en este inquilino** (gris), **Sin datos** (obsoleto). Haga clic en cualquier punto para ir directamente a ese inquilino y control en la página de Seguridad.

## Actividad diaria

**Actividad diaria** (barra lateral) es el clima de autenticación de hoy: dos gráficos de anillo, **Errores de inicio de sesión — Hoy** y **Bloqueos de CA — Hoy**, segmentados por inquilino.

La parte útil es la matemática de desviación: la fila de leyenda de cada inquilino muestra el recuento de hoy frente a su propia media móvil de 7 días — «media 12/día» con un porcentaje de desviación. Cuarenta fallos son un martes cualquiera para un inquilino de 200 puestos y un rociado de contraseñas para uno de 12; la línea base los distingue. Haga clic en una fila de la leyenda para ver el detalle: una evaluación de IA del patrón, luego la tabla de eventos (hora, usuario, aplicación, IP, ubicación, error, nivel de riesgo), y haga clic en cualquier evento para ver el detalle completo del inicio de sesión.

Esta página es una superficie de *contexto*, no un sistema de alarma — los patrones de ataque genuinos (rociado, fuerza bruta, viaje imposible) disparan alertas por sí solos. Use Actividad diaria cuando una línea del resumen o una alerta le hagan querer ver la forma del tráfico de hoy.

## SharePoint

**SharePoint** (barra lateral) agrega los eventos de auditoría de uso compartido y acceso de todos los inquilinos: creación de enlaces anónimos, eventos de uso compartido externo, cambios de administradores de sitio, detecciones de malware en SharePoint/OneDrive y cambios en las directivas de uso compartido. Complementa las tarjetas del Resumen por inquilino (Sitios SP, Enlaces anónimos) con la vista a nivel de evento — quién creó ese enlace anónimo, en qué sitio, cuándo.

## Cómo encajan en su semana

Las alertas gobiernan su día; las vistas de parque gobiernan su semana. Un ritmo razonable: el Mapa de calor una vez por semana para elegir una campaña (limpiar un control generalizado débil en todo el parque), los Cambios para atrapar al inquilino que retrocede, y Actividad diaria y SharePoint bajo demanda cuando algo le despierte curiosidad. Todo esto se queda en solo lectura — estas páginas le dicen dónde actuar; la acción ocurre en Seguridad, CA, Intune y la conversación con el cliente.
