---
title: "Despliegue directivas de Intune"
subtitle: "El mismo modelo de plantilla y deriva que en CA, aplicado a la configuración de dispositivos: asignar, desplegar, vigilar."
icon: "monitor-smartphone"
last_updated: 2026-06-15
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

## Adoptar la configuración existente en su sitio (origen del inquilino)

Igual que con CA, puede adoptar las configuraciones de Intune **existentes** de un inquilino en lugar de enviar primero sus plantillas. En la pestaña **Directivas de Intune**, haga clic en **Importar la configuración existente**. Panoptica lee las configuraciones vigentes en el inquilino — para los mismos tipos que admite su biblioteca (catálogos de configuración, configuraciones de dispositivos, directivas de cumplimiento, plantillas administrativas, líneas base de seguridad) — y crea una tarjeta **Origen: inquilino** (borde rojo y distintivo) para cada una que aún no administra. Todo lo que implementó desde una plantilla se reconoce por su identificador de objeto y se omite, por lo que nunca obtiene duplicados; volver a hacer clic es seguro.

Cada tarjeta se registra tal como se encontró — la configuración **y sus asignaciones** — y se vigila ante cualquier cambio. La alerta de una tarjeta de origen del inquilino dice *«cambió respecto al estado original»*. La deriva de Intune se detecta en la supervisión **diaria**: a diferencia de las directivas de AC nuevas, los cambios de Intune no están en el flujo del registro de auditoría, por lo que no hay una vía con latencia de minutos — la reconciliación diaria es la red de seguridad.

Abra las **Acciones** de una tarjeta para tres opciones:

1. **Dejar de supervisar** — quita la tarjeta; nunca toca el inquilino.
2. **Desactivar en el inquilino** — Intune no tiene un interruptor global de «apagado», así que Panoptica **registra primero el conjunto completo de asignaciones** y luego quita todas las asignaciones para que la configuración no se aplique a nadie. **Restaurar** vuelve a aplicar exactamente las asignaciones. Ese registro previo es lo que hace que desactivar sea reversible — sin él, quitar las asignaciones sería una puerta de un solo sentido.
3. **Eliminar del inquilino** — quita permanentemente la configuración; eliminar le pide que escriba su propio nombre.

Las tres acciones quedan registradas en el registro de auditoría del MSP y en el registro de cambios del inquilino. Y como con CA, Panoptica vigila cada inquilino en busca de una configuración de Intune creada **fuera de Panoptica** y la presenta como una tarjeta de origen del inquilino junto con una alerta.

## El ritmo

Incorporar el inquilino → desplegar su línea base estándar de Intune → olvidarse. A partir de ahí, las alertas de desviación llegan cuando alguien cambia una directiva desplegada en el inquilino del cliente, y la tarjeta **Dispositivos que cumplen** de la pestaña Resumen le dice si los dispositivos realmente alcanzan el listón que usted fijó.
