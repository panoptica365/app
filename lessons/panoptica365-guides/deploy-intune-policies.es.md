---
title: "Despliegue directivas de Intune"
subtitle: "El mismo modelo de plantilla y deriva que en CA, aplicado a la configuración de dispositivos: asignar, desplegar, vigilar."
icon: "monitor-smartphone"
last_updated: 2026-06-07
---

# Despliegue directivas de Intune

Si ya leyó la guía de directivas de CA, esta le resultará familiar — a propósito. Los despliegues de Intune usan el mismo modelo de plantilla y deriva: una biblioteca que usted mantiene (barra lateral → **Directivas de Intune**), despliegues por inquilino y detección continua de deriva sobre lo que está activo.

Las plantillas en sí — qué opciones elegir, cómo es una línea base de Windows sensata — se tratan en la tarjeta **Intune Template Settings** de Aprender. Esta guía es la mecánica.

## Desplegar directivas en un inquilino

1. Abra el panel del inquilino → pestaña **Directivas de Intune**. En un inquilino nuevo: *«No hay plantillas de política Intune asignadas a este inquilino todavía. Haga clic en «Agregar políticas» para comenzar.»*
2. Haga clic en **Agregar políticas**. El selector lista su biblioteca de plantillas de Intune — catálogos de configuración, configuraciones de dispositivo, directivas de cumplimiento, plantillas administrativas, líneas base de seguridad.
3. Seleccione las directivas a desplegar y elija el **destino de asignación**: **Todos los usuarios**, **Todos los dispositivos** o **Ninguno** (desplegar sin asignar y conectar la asignación en el portal más adelante).
4. Despliegue. Cada directiva se convierte en una tarjeta con su nombre, tipo, estado, destino de asignación y una insignia de desviación.

## Detección de deriva

El ciclo de deriva compara cada directiva desplegada con su plantilla, exactamente igual que en CA:

- **OK** — la directiva activa coincide.
- **con desviación** — alguien cambió un ajuste del lado del inquilino.
- **aceptada** — desviación revisada y aceptada por un operador.

Acciones por tarjeta: **Verificar desviación** (comparar ahora), **Desplegar** (volver a aplicar) y **Aceptar** (abrir el modal de aceptación).

## Aceptar una desviación de Intune

El modal de aceptación ofrece los mismos dos caminos que en CA:

- **Aceptar con vencimiento** *(recomendado)* — aceptada hasta la fecha que elija (180 días por defecto), con motivo obligatorio. La aceptación aparece en la página de **Exenciones**. Tenga en cuenta que las exenciones de Intune son **a nivel de toda la directiva** — aceptan la desviación actual del despliegue como un todo, no como una excepción por usuario.
- **Aceptar una vez, para siempre** — indefinida; solo vuelve a dispararse si la desviación cambia de forma.

Cuando una exención caduca o se revoca, el siguiente ciclo de deriva de Intune vuelve a marcar el despliegue como desviado y exige una nueva revisión. Nada queda aceptado en silencio.

## Una precaución importante

Evite editar directamente en el portal de Intune las directivas desplegadas por Panoptica365 para hacer ajustes por inquilino (grupos de exclusión adicionales, cambios puntuales de configuración). El trabajo de la plataforma es hacer converger las directivas activas de vuelta a la plantilla — las personalizaciones hechas en el portal o bien disparan alertas de desviación perpetuas o bien se sobrescriben en el siguiente despliegue. Si un inquilino necesita de verdad una variación, hágala explícita: una plantilla aparte, o una desviación aceptada, documentada y acotada en el tiempo.

## El ritmo

Incorporar el inquilino → desplegar su línea base estándar de Intune → olvidarse. A partir de ahí, las alertas de desviación llegan cuando alguien cambia una directiva desplegada en el inquilino del cliente, y la tarjeta **Dispositivos que cumplen** de la pestaña Resumen le dice si los dispositivos realmente alcanzan el listón que usted fijó.
