---
title: "Supervise la configuración de seguridad"
subtitle: "La superficie de deriva a nivel de inquilino: configuración de M365, Entra, Exchange, Teams y SharePoint — leída, comparada y custodiada."
icon: "sliders-horizontal"
last_updated: 2026-06-07
---

# Supervise la configuración de seguridad

Las directivas de CA e Intune son objetos que usted despliega. Pero la postura de seguridad de un inquilino también vive en docenas de interruptores dispersos: configuración de transporte de Exchange, acceso externo de Teams, uso compartido de SharePoint, valores predeterminados de Entra, directivas antiphishing. La página **Seguridad** (barra lateral → Directivas → **Seguridad**) es donde Panoptica365 lee esos interruptores en todos los inquilinos y le avisa cuando uno cambia.

## Qué ve

Elija un inquilino y obtendrá la configuración supervisada, agrupada por categoría, con chips de filtro:

- **Categoría**: Todos / Exchange / Identidad / SharePoint / Teams / Cumplimiento.
- **Prioridad**: Todos / Crítico / Alto / Medio / Bajo.

Cada fila de configuración muestra su nombre, el valor actual en vivo (interpretado en lenguaje llano, no la salida cruda de la API), la licencia que requiere si la hay, y un estado:

- **Supervisado — OK** — el valor en vivo coincide con el estado deseado que usted configuró.
- **Deriva detectada** — el valor en vivo ya no coincide. Esto también dispara una alerta de deriva de seguridad por el canal normal de alertas.
- **No aplicado** — aún no ha definido un estado deseado para esta configuración en este inquilino.
- **Error de sondeo** — el lector no pudo obtener el valor (a menudo por licencia o permisos).

Haga clic en una configuración para ver el detalle: qué hace, por qué importa, el impacto en los usuarios al cambiarla, notas para el operador, y los valores esperado vs. real cuando hay deriva.

## Aplicar y coincidir

Dos verbos cubren el flujo de trabajo:

- **Aplicar** — envía al inquilino el valor deseado configurado. Las aplicaciones se ejecutan **de forma asíncrona**: el trabajo se pone en cola, un worker lo ejecuta y la fila se actualiza cuando termina (con una comprobación de refresco poco después para confirmar que el valor quedó fijado). Puede seguir trabajando mientras se ejecuta.
- **Coincidir** — adopta el valor actual en vivo del inquilino como estado deseado. Úselo cuando la configuración existente del inquilino es correcta y solo quiere que quede *custodiada* de ahora en adelante.

Esa distinción importa durante la incorporación: en un inquilino bien configurado usará sobre todo Coincidir (capturar la realidad como línea base), y en uno descuidado usará sobre todo Aplicar (imponer su estándar). En ambos casos, el estado final es el mismo — cada configuración tiene un valor deseado, y cualquier desviación futura produce una alerta de deriva.

## Configuraciones de solo auditoría

Algunas configuraciones son deliberadamente de **solo auditoría** — Panoptica365 las lee pero no las escribe, normalmente porque la escritura está limitada por licencia o es demasiado delicada para automatizarla (la configuración de DLP es el ejemplo canónico). Para estas, usted **captura una línea base** de la configuración actual; a partir de ahí, cualquier cambio genera una alerta: *«Línea base capturada. Panoptica365 alertará sobre cualquier cambio de configuración DLP en adelante.»* La remediación, cuando hace falta, se hace a mano en el portal de Microsoft.

## Valores recomendados

Las vistas de detalle describen la postura recomendada, pero «lo más seguro» no es «lo universalmente correcto» — algunas configuraciones varían legítimamente según el modelo de negocio del cliente (el uso compartido externo en una empresa que colabora con sus clientes en SharePoint, por ejemplo). El texto de recomendación dice *para quién* se recomienda un valor. Léalo antes de aplicar nada en masa.

## Dónde más aparece esto

El **Mapa de calor** (vea *Vistas de parque*) se construye exactamente con estos datos — cada inquilino × cada control supervisado, como puntos de colores. Un control en rojo o sin configurar en la mayoría del parque se convierte en una campaña de remediación; el mapa de calor le entregará esa lista.
