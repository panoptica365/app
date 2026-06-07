---
title: "Despliegue directivas de Acceso Condicional"
subtitle: "Asigne plantillas desde su biblioteca, despliéguelas en el inquilino y deje que la detección de deriva las custodie después."
icon: "key-round"
last_updated: 2026-06-07
---

# Despliegue directivas de Acceso Condicional

El Acceso Condicional es donde Panoptica365 deja de ser una cámara y se convierte en una barrera de protección. Usted mantiene una **biblioteca de plantillas** de directivas de CA (barra lateral → **Directivas de CA**), asigna plantillas a inquilinos, las despliega, y Panoptica365 vigila después las directivas activas en busca de deriva — para siempre.

**Antes de su primer despliegue real, lea la lección de la *lista de verificación previa* en la tarjeta de Acceso Condicional de Aprender.** Las cuentas de emergencia (break-glass) y el inventario de cuentas de servicio no son opcionales. Una directiva de CA desplegada con prisas puede dejar fuera a un cliente entero.

## Asignar plantillas a un inquilino

1. Abra el panel del inquilino → pestaña **Directivas de CA**. En un inquilino recién incorporado verá *«Aún no hay plantillas de política CA asignadas a este inquilino.»*
2. Haga clic en **Asignar plantilla**. Un selector lista su biblioteca de plantillas (menos lo que ya esté asignado).
3. Marque las plantillas que quiera — o **Seleccionar todo** — y confirme.

Cada asignación se convierte en una tarjeta en la pestaña, con el nombre de la plantilla, una insignia de estado de desviación, los controles de **Concesión**, los **Usuarios** y **Aplicaciones** de destino, un desplegable de enrutamiento de **Alertas** (correo, PSA, ambos o ninguno — por asignación) y la **Última verificación**.

## Desplegar

Una plantilla asignada todavía no está activa. En la tarjeta de la asignación:

- **Desplegar** — crea la directiva activa en el inquilino a partir de la plantilla. Los marcadores específicos del inquilino (como las ubicaciones con nombre) se resuelven en el momento del despliegue.
- **Verificar desviación** — compara la directiva activa con la plantilla ahora mismo, bajo demanda (el ciclo programado de deriva también lo hace continuamente).

Despliegue primero en **modo solo informe** cuando la plantilla esté configurada así, observe el impacto en los inicios de sesión y luego pase a Activado — esa disciplina se trata en las lecciones de CA.

## La deriva: las insignias

Cada tarjeta de asignación lleva una insignia de estado:

- **OK** — la directiva activa coincide con la plantilla.
- **con desviación** — algo cambió en el inquilino; la directiva ya no coincide.
- **aceptada** — la desviación existe, pero un operador la revisó y la aceptó.
- **faltante** — la directiva no existe en el inquilino (eliminada, o nunca desplegada).
- **no verificada** — aún sin comparar.

Cuando se detecta una desviación, también recibe una **alerta** por el enrutamiento que eligió, con análisis de IA adjunto. El registro de desviaciones de la tarjeta muestra la cronología: qué campo cambió, esperado vs. real, eventos de desactivación o eliminación, y remediaciones.

## Responder a la deriva

Tiene tres opciones honestas:

1. **Aplicar plantilla** (también mostrado como **Remediar**) — sobrescribe la directiva activa con la plantilla. **Advertencia, y el botón habla en serio:** esto borra los `excludeUsers` / `excludeGroups` propios del inquilino que se añadieron directamente en el portal. Si esas exclusiones son legítimas, deben vivir en la plantilla o como exenciones, no como ediciones hechas en la consola de Microsoft.
2. **Aceptar la desviación.** Hacer clic en una directiva con desviación abre **Aceptar desviación de política CA**, que muestra lo esperado vs. lo real campo por campo, con dos caminos:
   - **Aceptar con vencimiento** *(recomendado)* — la desviación queda aceptada hasta la fecha que elija (180 días por defecto), con un **motivo obligatorio**, y los principales excluidos pasan a la tabla de **Exenciones**, de modo que los evaluadores de alertas los omiten hasta el vencimiento. Acotado en el tiempo, documentado, auditable.
   - **Aceptar una vez, para siempre** — aceptada indefinidamente; solo vuelve a dispararse si cambia la firma de la desviación. Úselo con moderación.
3. **Actualizar la plantilla** — si el cambio es en realidad correcto para todos los inquilinos, corríjalo en el origen, en la biblioteca de Directivas de CA.

## Nota operativa

La deriva en una directiva de CA es una de las alertas más valiosas que produce la plataforma. Un técnico de soporte que excluye «temporalmente» a un usuario de la MFA es exactamente así como empiezan las brechas — y exactamente lo que esto detecta. No se acostumbre a aceptar desviaciones por reflejo; cada aceptación debería tener un motivo que le resulte cómodo leer en el registro de auditoría dentro de un año.
