---
title: "Secure Score de cara al cliente — el entregable, la tendencia, la narrativa de renovación"
subtitle: "Cómo convertir Secure Score en un entregable de cara al cliente que ancla las conversaciones de renovación y hace visible el trabajo de seguridad del MSP."
icon: "presentation"
last_updated: 2026-05-29
---

# Secure Score de cara al cliente — el entregable, la tendencia, la narrativa de renovación

Una reunión de renovación. El account manager del MSP abre el portátil, navega al panel de cliente de Panoptica365 del cliente con el que se está reuniendo, y muestra el recuadro de Secure Score: **84,1 %** hoy, frente al **47 %** cuando empezó la relación hace catorce meses. La comparación de «media de tamaño similar» debajo lee 46 %. La CFO del cliente mira la pantalla unos segundos.

«Así que pasamos de estar por debajo de la media a casi el doble de la media.»

«Sí. Nos hemos abierto camino a través de la línea base recomendada por Microsoft. La mayoría de los clientes de vuestro tamaño no han hecho este trabajo; vosotros sí.»

«Y esto es por lo que hemos estado pagando.»

«Esto y el trabajo no puntuado, sí. La puntuación es la parte que es fácil de ver.»

La renovación se cierra en menos de una hora. El cliente firma por otros dos años y pregunta si el MSP puede asumir también a su empresa hermana.

Esta es la conversación más valiosa del curriculum, y Microsoft Secure Score es el artefacto que la hace posible. No porque la cifra sea toda la historia — las lecciones 1 y 4 dejaron claro que no lo es — sino porque los clientes responden a la mejora medible, y una tendencia del 47 % al 84 % es medible. La cifra hace lo que ninguna cantidad de auto-descripción del MSP hace jamás: externaliza el trabajo, redactado por terceros, en algo que la CFO del cliente puede poner en una diapositiva para el consejo.

Esta lección va de cómo usar Secure Score en conversaciones con el cliente — qué mostrar, cuándo mostrarlo, cómo enmarcarlo, y dónde en Panoptica365 viven realmente las superficies.

## La tendencia, no la instantánea

Los operadores nuevos en la conversación sobre Secure Score a menudo lideran con el porcentaje actual: «estás en el 84 %». Ese es el marco equivocado. El porcentaje actual por sí solo no responde a ninguna pregunta que el cliente esté haciendo realmente. *¿Eso es bueno? ¿Comparado con qué? ¿Es normal? ¿Qué está haciendo?*

El marco correcto es la tendencia a lo largo del tiempo. «Tu Secure Score se ha movido del 47 % en la incorporación al 84 % hoy, una mejora de 37 puntos porcentuales en catorce meses. La media del sector para organizaciones de tamaño similar es de alrededor del 46 %. Ahora estás en el cuartil superior de los tenants de M365 por postura de configuración.»

La tendencia cuenta una historia. La instantánea es una estadística. Los clientes — especialmente los actores de negocio que no operan el tenant día a día — responden a historias.

Esto aplica incluso cuando la puntuación actual es baja:

- **Un cliente al 41 % sin tendencia aún** es la conversación de incorporación. «Este es nuestro punto de partida. Aquí está el plan para moverlo. Esperamos estar al 70 % para el próximo trimestre y al 80 %+ en nueve meses.»
- **Un cliente al 65 % con tendencia al alza** es la conversación de mitad de relación. «Aquí está lo que hemos hecho; aquí está lo que viene; aquí está la trayectoria esperada.»
- **Un cliente al 88 % con tendencia plana** es la conversación de estado estable. «Estamos en el techo de configuración para lo que tiene sentido en tu nivel. El trabajo ahora es mantenimiento — respuesta a la deriva, gestión de excepciones, concienciación sobre higiene de correo de proveedores, los elementos no puntuados que cubrimos el trimestre pasado.»
- **Un cliente al 88 % con tendencia *a la baja*** es la conversación diagnóstica. «Algo ha derivado. Vamos a mirar qué se ha movido.» (A menudo la causa de detección de vulnerabilidades de MDVM de la lección 2.)

Cada conversación tiene un marco basado en la tendencia. La cifra actual es un punto de datos en ese marco; nunca toda la conversación.

## La línea base en la incorporación — capturada automáticamente

Cuando incorporas un cliente nuevo en Panoptica365, el primer sondeo de Secure Score ocurre automáticamente en cuanto el tenant se conecta. Esa primera lectura va a la base de datos. Cada sondeo posterior se almacena junto a ella, día tras día, durante todo el tiempo que dure la relación. Para la primera renovación del cliente doce meses después, el sistema ya tiene aproximadamente 365 lecturas diarias detrás de la puntuación en pantalla. La línea base no es algo que el operador tenga que acordarse de capturar — es la primera fila de la tabla de historial.

Esto importa para dos flujos de trabajo del operador:

**La conversación de renovación tiene datos detrás automáticamente.** A los seis meses, cuando el cliente pregunte «¿estamos realmente más seguros ahora?», tienes una respuesta verificable porque los datos están en la base de datos: «Tu Secure Score era del 39 % el día que te incorporamos; hoy es del 71 %». Ensamblas la trayectoria a partir de notas de hitos y tu registro del trabajo hecho; las cifras subyacentes son consultables desde el historial almacenado de Panoptica365 cuando necesites verificarlas.

**Las expectativas del cliente quedan ancladas con el tiempo.** Los clientes a veces olvidan lo desconfigurado que estaba su tenant en la incorporación. Para el mes 12 han llegado a esperar MFA, Safe Links, auditoría de buzón y políticas CA como línea base. El movimiento del 39 % al 71 % les recuerda que no siempre fue así — *tú hiciste esto por ellos*.

Para el operador, la captura continua significa que el *registro* siempre está ahí incluso si la visualización en pantalla no lo está — la base de datos guarda el historial; lo que el panel muestra es el recuadro actual. Los operadores ensamblan la tendencia a partir de la documentación y notas del operador por ahora.

## Dónde muestra Panoptica365 la puntuación

La superficie de Secure Score de Panoptica365 es una de las vistas más desarrolladas de la plataforma. Tres lugares que conocer:

**El panel principal de la consola — la vista entre tenants.** Cuando inicias sesión en Panoptica365, el panel principal incluye un **panel de Tenants** que lista cada tenant de cliente con su Secure Score actual en una columna codificada por color (verde para puntuaciones altas, rojo para bajas). El panel tiene un cuadro de filtro para que puedas buscar por nombre de tenant a lo largo de una cartera grande. La columna Status muestra el estado de sondeo; la columna Last Polled muestra cuándo se refrescó la puntuación por última vez desde Microsoft. Debajo del panel de Tenants se sitúa un **Secure Score & Alert Overview** mostrando tres gráficos de donut uno al lado del otro: la Secure Score **media** a lo largo de todos tus tenants gestionados, el tenant **más alto** (con el nombre del tenant mostrado) y el tenant **más bajo** (con el nombre). Esta vista panorámica de tres donuts es la verdadera vista de agregación entre tenants que no existe en ninguno de los portales de Microsoft — es un diferenciador significativo de Panoptica365.

**El recuadro de Secure Score por tenant.** Cuando haces clic en el panel de un cliente específico, el recuadro de Secure Score es de las primeras cosas que ves. El recuadro muestra el porcentaje de cabecera en tipografía grande (p. ej., **88,79 %**), los puntos / máximo en bruto debajo (`988,2 / 1113,0`), y la comparación **Similar size avg** (media de tamaño similar) que Microsoft publica (p. ej., `Similar size avg: 46,74 %`). El recuadro está codificado por color — verde para puntuaciones saludables, transitando a ámbar y rojo a medida que la puntuación baja.

**Historial de puntuación almacenado — todavía no mostrado como gráfico.** Panoptica365 sondea la Secure Score continuamente y almacena cada lectura en la base de datos. Los datos históricos están ahí desde el día uno de la relación con el cliente. Lo que el panel *no* incluye actualmente es una visualización de tendencia en pantalla — no hay un gráfico en la UI de Panoptica365 que un operador pueda abrir para ver «la puntuación de este cliente a lo largo de los últimos doce meses». Por ahora, la historia de tendencia se ensambla manualmente: a partir de las notas del operador capturadas en hitos significativos (despliegues, revisiones trimestrales), de capturas de pantalla guardadas en momentos clave, y de la memoria del operador del trabajo hecho.

Lo que Panoptica365 *no* muestra en el panel: un desglose recomendación por recomendación (eso está en el portal de Microsoft Defender, la lección 1 lo cubrió), un botón de acción por recomendación para aplicar la corrección (Microsoft posee la superficie de acción), un informe PDF generado para clientes (esos se exportan manualmente o se construyen a partir de los datos del recuadro), y el gráfico de tendencia descrito arriba.

## La conversación de renovación — usando las superficies

Un patrón que funciona bien para una revisión anual o renovación de contrato:

1. **Abre el panel principal de Panoptica365** con el tenant del cliente filtrado o desplazado a la vista. Muestra brevemente el panel de Tenants — el cliente ve su puntuación en el contexto de tus otros clientes (sin nombrar a los otros), lo cual señala «tenemos una cartera de clientes similares y nos comparamos contra ellos».

2. **Haz clic en el tenant del cliente.** El recuadro de Secure Score está justo ahí. Lee las tres cifras en voz alta: el porcentaje, los puntos / máximo, la comparación con la media de tamaño similar. «Estás en 88,79 %; la media para empresas de tamaño similar es 46,74 %; estás aproximadamente al doble de la media.»

3. **Recorre la tendencia.** A partir de tu documentación del cliente — las notas de hitos, las capturas de pantalla tomadas en puntos de despliegue, tu registro de qué se hizo cuándo — narra la trayectoria. «Tu línea base en la incorporación era 47 %. Llegamos al 62 % después de desplegar las plantillas CA en marzo. Llegamos al 74 % después del despliegue de Intune en mayo. Estamos en 84 % hoy.» Cada movimiento se ata a trabajo específico por el que el cliente pagó y que tú entregaste.

4. **Reconoce el trabajo no puntuado.** «Y aquí está lo que la cifra no muestra — la aplicación de DMARC está ahora en p=reject, tus reglas de flujo de correo han sido auditadas y limpiadas, tu libro de excepciones tiene 14 decisiones documentadas revisadas en el último trimestre. Microsoft no puntúa nada de esto, pero es donde reside la mayor parte del valor real de seguridad.»

5. **Fija el objetivo del próximo trimestre.** «Nuestro objetivo para los próximos 12 meses es mantener la puntuación en los 80 altos mientras trabajamos la disciplina no puntuada. Estamos en el techo de lo que tiene sentido para Business Premium sin cruzar a funciones de E5 que no se pagan a sí mismas a tu tamaño.»

La conversación dura 15-20 minutos. Está anclada en cifras visibles y atada a trabajo específico. Al final, el cliente entiende por lo que está pagando de una manera que no entendía antes de sentarse.

## Cómo hablar de una puntuación baja

Las puntuaciones bajas pasan — clientes recién incorporados, clientes que se incorporaron bajo mala gestión previa, clientes que no tenían MSP en absoluto. La conversación necesita enhebrar entre «esto está mal y tenemos que actuar» (urgencia) y «esto no es culpa tuya y no te estamos culpando» (preservación de la relación).

Una estructura funcional:

- **Lidera con la trayectoria, no con la acusación.** «Tu punto de partida es una Secure Score del 41 %. La mayoría de los clientes que incorporamos empiezan entre 35 y 55 %; estás en medio de ese rango. Tenemos un camino claro para mover esta cifra.» No: «Tu proveedor anterior se perdió muchas cosas.»
- **Identifica la media docena** (lección 3) como el plan visible de mejora. Recorre qué elementos se implementarán y el impacto esperado en puntuación de cada uno.
- **Fija expectativas realistas de calendario.** Ir de 41 % a 80 %+ es típicamente un viaje de seis a nueve meses para el equipo de operadores. No prometas más rápido; más rápido normalmente significa atajos en el afinado específico del cliente.
- **Muestra el trabajo no puntuado que corre en paralelo.** «Mientras movemos la puntuación, también estamos haciendo el trabajo de aplicación de DMARC, la auditoría de reglas de flujo de correo, la documentación de excepciones. Estos no aparecen en la cifra pero son una parte significativa de la mejora de seguridad.»

Un cliente al 41 % que ve una lectura del 47 % tres semanas después, una lectura del 58 % a los tres meses y una lectura del 78 % a los nueve meses se queda como cliente. Un cliente al 41 % al que se le ha dicho «te llevaremos al 100 % el mes que viene» y termina al 62 % se siente engañado.

## Cómo hablar de una puntuación alta

El problema opuesto: los clientes que ven una cifra del 92 % a veces concluyen que han terminado. Han ganado. Están «seguros». El trabajo del MSP en ese punto es reanclar suavemente.

Un encuadre funcional:

- **Reconoce la puntuación con honestidad.** «Tu Secure Score está en el decil superior de los tenants de M365. La línea base recomendada por Microsoft está implementada de extremo a extremo para tu nivel.»
- **Recuérdales los límites.** Referencia el encuadre de la lección 4. «La puntuación mide configuración. No mide si tus proveedores tienen buena higiene de correo, si tus usuarios reconocerían un ataque de phishing sofisticado, si nuestra respuesta a incidentes detectaría un compromiso dentro de la ventana que importa. La mayor parte del trabajo real de seguridad entre ahora y el próximo año está en esas áreas — no en la cifra.»
- **Usa la renovación para redirigir hacia la disciplina.** «No vamos a centrarnos en mover la puntuación de 92 % a 95 % — eso significaría o manipular la métrica o implementar recomendaciones que no encajan con tu negocio. Nos vamos a centrar en el trabajo no puntuado: respuesta a la deriva, concienciación de proveedores, formación de usuarios, revisión del libro de excepciones. Eso es lo que evita que el 92 % se convierta en falso consuelo.»

La conversación evita que el cliente se desconecte porque piensa que el trabajo de seguridad está hecho. Nunca está hecho; la puntuación simplemente no te lo dice.

## Lo que esto significa para el operador

Tres puntos para llevarte.

**La tendencia es la conversación con el cliente; la instantánea es solo el punto de datos.** Lidera con la trayectoria. El movimiento del 47 % al 84 % es la historia; el 84 % de hoy es la línea en el gráfico. Los clientes recuerdan historias.

**La línea base del día uno se captura automáticamente — asegúrate de que tu documentación del cliente la referencia.** Panoptica365 registra el primer sondeo de Secure Score en el momento en que un tenant se conecta, y cada sondeo posterior. Los datos están en la base de datos; lo que el panel muestra hoy es el recuadro actual. Los operadores ensamblan la tendencia a partir de sus propios registros — notas de hitos, capturas guardadas en despliegues, la documentación capturada en cada paso importante. El día uno es la cifra más citada a la que harás referencia sobre un cliente; la disciplina es mantener el registro de hitos junto a la captura automática.

**Usa la vista entre tenants de Panoptica365 como el diferenciador genuino.** El panel de Tenants + la vista panorámica de tres donuts muestra al cliente (cuando es apropiado) que operas una cartera real de clientes similares. El portal de Microsoft no puede hacer esto. La CFO del cliente que ve «la media de nuestros clientes gestionados es 85,8 %» y «tú estás en 88,79 %» recibe dos mensajes al mismo tiempo: tienes pares, y estás por delante de ellos.

## Lo que viene

- **Lección 6: Operar Secure Score a escala + cierre del curriculum.** La cadencia de revisión trimestral, el encuadre del objetivo del 80 %+, qué hacer cuando las puntuaciones tienden en direcciones preocupantes a lo largo de la cartera, y el argumento de cierre de cómo es la buena seguridad MSP.

Por ahora: elige al cliente cuya revisión anual se acerca. Abre el panel principal de Panoptica365. Toma una captura de pantalla de su recuadro de puntuación y el contexto entre tenants. Reúne la tendencia a partir de su historial. Entra en la reunión de renovación con una historia, no una estadística. La historia del 47 % al 84 % es la historia que quieres contar — y la que el cliente quiere oír.

---

*Fuentes de los datos en esta lección — Microsoft Learn sobre el historial de Secure Score y el seguimiento de tendencias ([Microsoft Learn — Track Secure Score history](https://learn.microsoft.com/en-us/defender-xdr/microsoft-secure-score-history-metrics-trends)); comparaciones sectoriales de Secure Score y promedio de organizaciones de tamaño similar ([Microsoft Learn — Secure Score comparisons](https://learn.microsoft.com/en-us/defender-xdr/microsoft-secure-score-improvement-actions)); visión general de Secure Score y estructura de datos del recuadro ([Microsoft Learn — Microsoft Secure Score](https://learn.microsoft.com/en-us/defender-xdr/microsoft-secure-score)); API de Secure Score para acceso programático a los datos que Panoptica365 muestra ([Microsoft Learn — Secure Score API in Graph](https://learn.microsoft.com/en-us/graph/api/resources/securescore)).*
