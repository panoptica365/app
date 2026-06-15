---
title: "Despliegue directivas de Acceso Condicional"
subtitle: "Asigne plantillas desde su biblioteca, despliéguelas en el inquilino y deje que la detección de deriva las custodie después."
icon: "key-round"
last_updated: 2026-06-15
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

## Adoptar la configuración existente en su sitio (origen del inquilino)

A veces incorpora un inquilino que **ya tiene** sus propias directivas de Acceso Condicional — directivas que usted no envió desde su biblioteca. No está obligado a imponer sus plantillas el primer día. **Importar la configuración existente** le permite adoptar lo que ya está allí y supervisarlo primero — una etapa deliberada de «supervisar lo que hay aquí, no imponer todavía».

En la pestaña **Directivas de AC**, haga clic en **Importar la configuración existente**. Panoptica lee las directivas de AC vigentes en el inquilino y crea una tarjeta para cada una que aún no administra, marcada como **Origen: inquilino** (borde izquierdo rojo y distintivo) para distinguirlas de sus plantillas implementadas. Registra el estado actual de cada directiva como estado inicial y vigila los cambios a partir de ahí.

Algunos puntos que conviene saber:

- **Sin duplicados.** Las directivas que ya implementó desde una plantilla se reconocen por su identificador de objeto y se omiten — incluso si las renombró en el inquilino. El botón permanece disponible, y volver a hacer clic es seguro: solo se adopta lo que es genuinamente nuevo.
- **Las directivas administradas por Microsoft** también se adoptan, señaladas como tales. Donde Microsoft rechaza un cambio, la acción se degrada con elegancia («administrada por Microsoft, no se puede cambiar aquí») en lugar de fallar. Los **valores predeterminados de seguridad** *no* son una directiva — se muestran como un simple indicador activado/desactivado, nunca como una tarjeta.
- **Deriva respecto al estado original.** La alerta de una tarjeta de origen del inquilino dice *«cambió respecto al estado original»* — no «se desvía de su estándar», porque todavía no hay una plantilla detrás. La supervisión diaria detecta los cambios; una directiva de AC totalmente nueva creada directamente en la consola se detecta en minutos.

### Qué puede hacer con una tarjeta de origen del inquilino

Abra las **Acciones** de una tarjeta para tres opciones distintas:

1. **Dejar de supervisar** — quita la tarjeta y deja de vigilarla. **Esto nunca modifica el inquilino** — es una acción solo de Panoptica.
2. **Desactivar en el inquilino** — desactiva la directiva de forma reversible (la pone como *deshabilitada*). La tarjeta permanece, marcada como Inactiva, y **Restaurar** la devuelve exactamente a su estado. De forma predeterminada, una tarjeta desactivada solo alerta si alguien la reactiva fuera de Panoptica.
3. **Eliminar del inquilino** — quita permanentemente la directiva del inquilino. La confirmación es proporcional al riesgo: eliminar le pide que escriba su propio nombre.

Cada una de estas acciones queda registrada en el registro de auditoría y en el registro de cambios del inquilino, con su nombre y el nombre de la directiva.

### Vigilar lo que aparezca más tarde

Más allá de la adopción, Panoptica vigila **cada** inquilino — con plantillas o sin ellas — en busca de una directiva de AC que aparezca **fuera de Panoptica** (creada directamente en la consola de Entra). Cuando surge, se convierte en una tarjeta de origen del inquilino y activa una alerta *«configuración creada fuera de Panoptica»*, para que un cambio hecho al margen de su proceso no se le escape. A medida que después implemente sus propios estándares, puede desactivar o eliminar las directivas nativas desordenadas — o simplemente seguir supervisándolas.

## Nota operativa

La deriva en una directiva de CA es una de las alertas más valiosas que produce la plataforma. Un técnico de soporte que excluye «temporalmente» a un usuario de la MFA es exactamente así como empiezan las brechas — y exactamente lo que esto detecta. No se acostumbre a aceptar desviaciones por reflejo; cada aceptación debería tener un motivo que le resulte cómodo leer en el registro de auditoría dentro de un año.
