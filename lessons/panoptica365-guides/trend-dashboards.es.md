---
title: "Paneles de tendencias — la seguridad a lo largo del tiempo"
subtitle: "Las dos superficies longitudinales: la pestaña Tendencias de un inquilino y la página Tendencias de la cartera, gráfico por gráfico."
icon: "trending-up"
last_updated: 2026-06-18
---

# Paneles de tendencias — la seguridad a lo largo del tiempo

La Consola principal y el Resumen de un inquilino responden a *«¿cómo van las cosas ahora mismo?»*. Los paneles de tendencias responden a la pregunta más difícil: *«¿estamos mejorando o empeorando, y cómo lo demuestro?»* Hay dos — una **pestaña Tendencias en cada panel de inquilino** y una **página Tendencias de toda la cartera** en la barra lateral. Ambas leen el historial que Panoptica365 acumula con sus sondeos diarios, así que abrirlas no cuesta nada y no añaden carga a Microsoft. Ambas llevan un **selector de período** — 7 d / 30 d / 90 d / 1 a — arriba a la derecha.

Un inquilino recién incorporado todavía no tendrá mucha línea que trazar. Donde el historial aún se está construyendo, el gráfico lo dice (*«La tendencia comienza el…»*) en lugar de dibujar una línea plana engañosa. Déle unas semanas.

## La pestaña Tendencias de un inquilino

Abra un inquilino y haga clic en **Tendencias** (la segunda pestaña, junto a Resumen). Se divide en dos mitades — *lo que ve el cliente* y *lo que ve el proveedor* — con una franja de estadísticas de cobertura arriba.

**Franja de cobertura** — una tranquilidad de una línea: cuántos de los controles recomendados por Microsoft están configurados y sanos para este inquilino. Es la postura como número, no como gráfico, porque un inquilino bien llevado se mantiene al 100 % y una línea plana no le dice nada.

Lo que ve el cliente:

- **Puntuación de seguridad de Microsoft** (el gráfico principal) — la medida de seguridad canónica de Microsoft para este inquilino a lo largo del tiempo, con una línea discontinua que muestra el promedio de las **empresas de tamaño similar** (la referencia del propio Microsoft). La puntuación se mueve a medida que Microsoft sube el listón; mantener la línea continua por encima de la discontinua es el trabajo. La etiqueta indica cuántos puntos le saca, o le faltan, a los inquilinos comparables.
- **Puntuación de seguridad por categoría** — la misma puntuación desglosada según las categorías de Microsoft (Identidad, Datos, Dispositivos, Aplicaciones, Infraestructura) en áreas apiladas. Muestra *de dónde* salen los puntos y *dónde quedan las brechas* — la banda más delgada es su próxima campaña.
- **Recomendaciones de seguridad aplicadas** — cuántas de las acciones recomendadas por Microsoft están realmente en marcha, a lo largo del tiempo. Es el trabajo que nunca termina: Microsoft no deja de añadir recomendaciones, así que una línea plana aquí significa que va al día y una ascendente que está ganando terreno.
- **Problemas detectados y resueltos** — las desviaciones y amenazas que Panoptica detectó y que su equipo despejó, por mes y gravedad. Es el relato del valor: la prueba de que el servicio hace algo.
- **Problemas abiertos a lo largo del tiempo** — cuántos elementos quedaban pendientes de acción cada día. Tender a cero es la meta; una línea que sube significa que el atraso crece más rápido de lo que el equipo lo despeja.

Lo que ve el proveedor:

- **Tiempo de resolución** — mediana de horas desde que se dispara una alerta hasta su resolución. Su capacidad de respuesta, con pruebas — útil para las conversaciones sobre acuerdos de servicio.
- **Volumen de alertas por semana** — alertas nuevas por semana, por gravedad. ¿Este inquilino se vuelve más ruidoso o más tranquilo?
- **Políticas que más se activan** — qué políticas generan el volumen en los últimos 90 días, en barras ordenadas. Las barras más largas son sus candidatas de ajuste: una política que se dispara sin parar es o un problema real o una política que hay que ajustar.

## La página Tendencias de la cartera

Haga clic en **Tendencias** en la barra lateral izquierda (justo después de Mapa de calor). Es la misma idea, elevada a toda la cartera de golpe. Cubre **solo sus inquilinos gestionados** — los inquilinos en modo auditoría no forman parte del relato de postura de la cartera — y se organiza en *Puntuación de seguridad y postura* y *Operaciones de alertas*, de nuevo con una franja de cobertura arriba.

**Franja de cobertura de la cartera** — cuántos inquilinos gestionados están al 100 % de los controles recomendados, y la cobertura promedio de la cartera. La estrella polar de toda la cartera.

Puntuación de seguridad y postura:

- **Puntuación de seguridad de Microsoft de la cartera** (el principal) — la puntuación de seguridad promedio de los inquilinos gestionados a lo largo del tiempo. Tres cosas se superponen a la línea de promedio: una **banda máx.–mín.** sombreada que muestra su mejor y su peor inquilino cada día (números reales, sin suavizar — verificables a mano), una **referencia de tamaño similar** discontinua y — solo cuando incorporó inquilinos durante el período — una línea verde de **«inquilinos existentes»** que mantiene constante la misma cohorte. La información emergente le dice sobre cuántos inquilinos se calculó el promedio ese día.
- **Crecimiento de la cartera — inquilinos gestionados** — cuántos inquilinos gestionados existían cada día, con un marcador en los días de incorporación. Este gráfico explica el de arriba: cuando añade un inquilino que parte de bajo, el promedio de la cartera baja — es la cartera que cambia, no sus clientes existentes que empeoran. La línea verde del principal y este gráfico, juntos, le permiten distinguir esos dos relatos.
- **Recomendaciones pendientes** — total de acciones recomendadas por Microsoft aún abiertas en toda la cartera. ¿Van al día de forma colectiva?
- **Puntuación de seguridad por categoría** — la puntuación promedio de la cartera por categoría de Microsoft a lo largo del tiempo. Donde *toda la cartera* es más débil está el lugar de mayor palanca para lanzar una campaña en todos los clientes a la vez.

Operaciones de alertas:

- **Problemas detectados y resueltos** — total resuelto de la cartera, por mes y gravedad. ¿Cuánto despejó el equipo en todos los clientes?
- **Problemas abiertos a lo largo del tiempo** — total de elementos pendientes de acción cada día en la cartera. ¿El equipo va al día en toda la cartera?
- **Tiempo de resolución** — mediana de horas por semana de la cartera, con una **línea p90** encima. La mediana es el caso típico; el p90 atrapa la cola — unos pocos inquilinos lentos de despejar que la mediana oculta. Evidencia de acuerdo de servicio para toda la cartera.
- **Volumen de alertas por semana** — alertas nuevas de la cartera por semana, por gravedad. ¿Hay más ruido en general?
- **Distribución de alertas por categoría a lo largo del tiempo** — alertas nuevas de la cartera agrupadas por categoría de política (inicios de sesión de riesgo, gestión de amenazas, uso compartido externo, cambios de configuración, permisos, gobernanza de la información) por semana. Le dice *qué tipo de trabajo* genera la cartera, que es lo que deben seguir la dotación de personal y la formación.
- **Políticas que más se activan — últimos 90 días** — las políticas más ruidosas en todo, ordenadas. Son sus objetivos de ajuste a nivel de cartera — ajuste una política y la silencia para todos los clientes.

## Cómo leerlas bien

- **La puntuación de seguridad se mueve porque Microsoft sube el listón.** Una bajada no siempre significa que algo empeoró de su lado — Microsoft puede haber añadido una recomendación. La línea de referencia es el contexto que le mantiene honesto sobre eso.
- **En el principal de la cartera, vigile la banda, no solo el promedio.** Un promedio sano que oculta un mínimo muy bajo significa que un cliente tira hacia abajo — la banda lo saca a la luz; el promedio lo entierra.
- **Use el período correcto para la pregunta.** 7 d / 30 d para una retrospectiva de incidente o una semana ruidosa; 90 d / 1 a para una revisión de negocio o una diapositiva de junta. El relato cambia con la lente.
- **Las políticas que más se activan son una invitación, no un veredicto.** La barra más larga es o un problema recurrente real en ese cliente o una política demasiado sensible. Ambas merecen acción — una con el inquilino, otra con la política.

*Los paneles le dicen el estado. Las tendencias le dicen la trayectoria — y la trayectoria es lo que realmente está en juego en una renovación de cliente, una revisión de acuerdo de servicio o una revisión trimestral de negocio.*
