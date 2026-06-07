---
title: "Trabaje las alertas"
subtitle: "Su verdadero día a día: triaje, el panel lateral de detalle, el análisis de IA, la Cronología de identidad y resolver con disciplina."
icon: "bell-ring"
last_updated: 2026-06-07
---

# Trabaje las alertas

Todo lo demás en Panoptica365 existe para alimentar esta página. Las alertas son la forma en que la plataforma le habla: deriva, inicios de sesión de riesgo, eventos del registro de auditoría, incidentes de Defender, cambios de configuración — todo normalizado en una sola cola con análisis de IA adjunto.

## La cola

**Alertas** (barra lateral) muestra todas las alertas del parque; la pestaña **Alertas** de un panel de inquilino muestra lo mismo acotado a un solo inquilino. La barra de filtros cubre inquilino, gravedad, estado, categoría y si se muestran las alertas resueltas.

- **Gravedades**: información, bajo, medio, alto, severo.
- **Estados**: **Nuevo** → **En investigación** → **Resuelta** o **Falso positivo**.

Cada fila muestra la insignia de gravedad, el inquilino (o *Todo el parque* para alertas a nivel de flota, como los elementos del Centro de mensajes), el mensaje, la categoría, la hora, un contador de recurrencias y la píldora de estado.

## El triaje, también en masa

Seleccione alertas con las casillas y use la barra de acciones masivas: **Marcar en investigación**, **Marcar como resuelta**, **Marcar como falso positivo** o **Combinar**. Combinar agrupa 2 o más alertas relacionadas del mismo inquilino en una alerta madre — útil cuando un incidente ruidoso produjo una docena de hermanas. Se le propondrá un título sensato y podrá escribir el suyo.

Cuando resuelve alertas con tickets de PSA vinculados, un solo modal pregunta una vez: *¿cerrar también los tickets vinculados, o dejarlos abiertos?* — y aplica su decisión a todo el lote.

## El panel lateral: donde ocurre la investigación

Haga clic en una fila y se abre el panel lateral de detalle:

- **Detalles** — los hechos estructurados del evento.
- **Análisis de IA** — la lectura que hace Claude de la alerta: qué ocurrió probablemente, cuán grave es y qué comprobar. Es su punto de partida, no su conclusión.
- **Datos sin procesar** — la carga del evento subyacente, para cuando necesita la verdad de base.
- **Cronología** — las recurrencias de esta alerta a lo largo del tiempo.
- **Cambio de operador vinculado** — si un cambio registrado en el Registro de cambios del inquilino explica esta alerta (dentro de la ventana de atribución), aparece enlazado aquí. «Deriva detectada» más «Jacques desplegó una plantilla actualizada 40 minutos antes» es un caso cerrado.
- **Notas** — sus notas de investigación, guardadas con la alerta.

Junto al nombre de la directiva encontrará el **icono del birrete** — el explicador de alertas. Abre *Acerca de esta alerta*: qué es este tipo de alerta, por qué importa, los vectores de ataque que hay detrás, qué hacer y un escenario de ejemplo. En su idioma, escrito para el técnico de nivel 1 en quien usted delega.

## La Cronología de identidad

Para cualquier alerta asociada a un usuario, abra la **Cronología de identidad** desde el panel lateral. Reúne, para ese usuario, una sola cronología a partir de cuatro fuentes — inicios de sesión, eventos del registro de auditoría unificado, incidentes de Defender y alertas relacionadas — en una ventana de 24 horas o 7 días, y luego pide a Claude que la correlacione: *posible compromiso, fuerza bruta, rociado de contraseñas, solo intentos fallidos* o *no concluyente*, con su razonamiento.

Es deliberadamente conservadora — no va a narrar un compromiso que los eventos no respalden. Los enlaces directos le llevan al usuario en Entra y al incidente en Defender; **Reanalizar** (rol de Operador o superior) vuelve a ejecutar la correlación cuando las cosas cambian.

## Disciplina de resolución

Dos hábitos marcan la diferencia entre un sistema bien afinado y uno ruidoso:

1. **Falso positivo es una señal, no un encogimiento de hombros.** Si un tipo de alerta sigue produciendo falsos positivos para un patrón conocido y legítimo, deje de resolverlos uno a uno — cree una exención o ajuste la directiva (las dos guías siguientes).
2. **Resuelva junto con el ticket.** Si trabaja con un PSA, deje que la sincronización bidireccional haga su trabajo: cerrar el ticket de Autotask resuelve la alerta, y viceversa. Un solo registro del trabajo, no dos registros a medias.
