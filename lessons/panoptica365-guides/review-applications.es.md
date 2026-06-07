---
title: "Revise las aplicaciones — apruebe lo que es de confianza y deje el triaje al resto"
subtitle: "El flujo de la pestaña Aplicaciones: Actualizar, marcar De confianza, Guardar — y dejar que Sonnet haga el triaje de todo lo que no aprobó."
icon: "app-window"
last_updated: 2026-06-07
---

# Revise las aplicaciones — apruebe lo que es de confianza y deje el triaje al resto

Todo inquilino acumula aplicaciones empresariales y registros de aplicaciones — algunas instaladas a propósito, otras consentidas por usuarios hace años, otras maliciosas. La pestaña **Aplicaciones** del panel del inquilino convierte ese montón en un inventario revisado con una línea base protegida.

Las aplicaciones propias de Microsoft quedan excluidas automáticamente — usted solo revisa lo que es de terceros o personalizado.

## El flujo de trabajo

1. Abra el panel del inquilino → pestaña **Aplicaciones**.
2. Haga clic en **Actualizar** si el inventario no se ha extraído recientemente. Verá *«Actualizando desde Microsoft Graph…»* mientras obtiene la lista en vivo.
3. Recorra la lista. Para cada aplicación que reconozca y en la que confíe — las que usted instaló, las que el cliente confirma que usa — marque su casilla **De confianza**. Expanda una fila para ver sus permisos delegados y de aplicación, sus credenciales y sus URI de redirección si necesita mirar más de cerca. La marca de *Editor verificado* y la etiqueta *todo el inquilino* en los permisos le ayudan a juzgar.
4. Ante la duda, **pregunte al cliente**. «¿Usan algo llamado Acme Sync?» es una llamada de treinta segundos que vale más que adivinar.
5. Haga clic en **Guardar**. Ocurren dos cosas:
   - Las aplicaciones que marcó quedan **registradas como de confianza** y reciben una **línea base protegida**: se toma una instantánea de su conjunto actual de permisos.
   - Cada aplicación que *no* marcó se envía a **Sonnet para triaje**. La línea de progreso dice algo como *«Guardando… 12 aplicación(es) de confianza; enviando 9 a Sonnet para triaje.»*

## Cómo leer los resultados del triaje

Cada aplicación no aprobada vuelve con un punto de evaluación de color:

- **Verde — nada alarmante.** Editor, antigüedad, tipo de consentimiento y permisos parecen normales.
- **Amarillo — conviene revisar.** Hay algo lo bastante inusual como para merecer sus ojos.
- **Rojo — investigar.** Revise esta aplicación ahora, con el cliente si hace falta.

Tenga presente la advertencia que muestra la interfaz: esto es *triaje, no una garantía*. El punto refleja lo que Sonnet pudo inferir del editor, la antigüedad, el tipo de consentimiento y los permisos. Solo marcar una aplicación como **De confianza** guarda una línea base protegida. Use los puntos rojos y amarillos como lista de trabajo: investigue, y luego marque la aplicación como de confianza o elimínela del inquilino (el enlace **Eliminar ↗** le lleva al lugar correcto en Entra).

## Qué le compra la línea base

Una vez que una aplicación es de confianza, Panoptica365 la vigila. Si más adelante **gana permisos por encima de su línea base aprobada**, la fila se marca con *«Permisos cambiados desde la aprobación»* y se dispara una alerta. Las *eliminaciones* de permisos no disparan nada — solo el crecimiento más allá de lo que usted aprobó. La comparación se ejecuta en cada Actualizar y en un ciclo automático diario.

Esta es la defensa contra un patrón de ataque clásico: una aplicación legítima y de confianza desde hace años cuyas credenciales son robadas y que de pronto brota con `Mail.Read` para todo el inquilino. Usted aprobó lo que era — Panoptica365 le avisa cuando se convierte en otra cosa.

## Cuándo repetir esto

- Tras la incorporación: haga la pasada completa una vez, con la confirmación del cliente donde haga falta.
- Cuando se dispare una alerta de aplicación nueva o de consentimiento: revise la aplicación y luego apruébela o elimínela. Aprobar una aplicación resuelve automáticamente su alerta de consentimiento abierta.
- Periódicamente (con una vez por trimestre basta): pulse Actualizar y busque nuevos puntos amarillos o rojos.
