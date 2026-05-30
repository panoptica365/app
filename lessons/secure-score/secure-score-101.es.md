---
title: "Secure Score 101 — qué mide realmente la cifra y qué no mide"
subtitle: "Qué mide realmente Microsoft Secure Score, qué no mide, y cómo usarlo con honestidad en conversaciones con clientes."
icon: "gauge"
last_updated: 2026-05-29
---

# Secure Score 101 — qué mide realmente la cifra y qué no mide

Un MSP incorpora a un cliente nuevo en marzo. El proveedor de TI anterior del cliente se había pasado los dos últimos años asegurándole que su entorno de Microsoft 365 estaba «totalmente protegido» — ese argumento había sido parte de la propuesta de renovación que mantuvo al proveedor anterior en su puesto durante esos dos años. El cliente se lo creyó. El nuevo MSP, tomando las riendas de la cuenta, abre Panoptica365, añade el tenant y deja que el sondeo se complete. La Secure Score sale al **41 %**.

El nuevo MSP se lo enseña al cliente. El cliente está, brevemente, muy enfadado — con el proveedor anterior, consigo mismo por no haber preguntado antes, con la situación. Una vez que pasa la reacción inmediata, hace la pregunta que hace todo cliente: «¿qué significa realmente esa cifra?».

Esta lección va de poder responder a esa pregunta con honestidad. Microsoft Secure Score es la métrica de seguridad más citada del ecosistema M365 y una de las más malinterpretadas. Los operadores que saben leerla correctamente — que saben qué mide el porcentaje, qué no mide, dónde coincide con la realidad y dónde induce a error — pueden usarla como una de las herramientas de cara al cliente más potentes del arsenal MSP. Los operadores que la tratan como una caja negra o bien la subestiman (ignorando una señal útil) o bien la sobrevaloran (vendiendo un porcentaje en lugar de vender trabajo real de seguridad).

La tarjeta 6 son seis lecciones sobre leer la Secure Score con honestidad, mapear nuestro curriculum sobre ella, saber dónde miente, y usarla como entregable de cara al cliente que justifica la línea de servicio.

## Qué es realmente Microsoft Secure Score

Microsoft Secure Score es una métrica de postura de seguridad a nivel de tenant que Microsoft calcula diariamente para cada tenant de M365. Expresa, como porcentaje, cuántas de las configuraciones de seguridad recomendadas por Microsoft ha implementado el tenant en relación con el total posible.

Lo básico:

- **La cifra es un porcentaje**, calculado como `(puntos obtenidos) / (puntos máximos disponibles) × 100`. Un cliente con 988,2 puntos sobre un posible 1113,0 tiene una Secure Score de aproximadamente 88,79 %.
- **Microsoft calcula la puntuación diariamente** en función de la configuración del tenant. No tienes que activar nada; cada tenant de M365 tiene una Secure Score.
- **La puntuación cubre un conjunto definido de recomendaciones.** Cada recomendación tiene un valor máximo de puntos que Microsoft asigna basándose en su evaluación del impacto en seguridad de la recomendación. Implementar una recomendación gana los puntos (o una fracción, por crédito parcial).
- **Las recomendaciones se organizan en categorías** — típicamente Identidad, Dispositivos, Aplicaciones, Datos. El desglose te permite ver qué áreas del tenant están fuertes y cuáles débiles.
- **Microsoft publica comparaciones sectoriales** — la «media de puntuación de organizaciones de tamaño similar». Un tenant con 88,79 % puede compararse con una media de organizaciones de tamaño similar del 46,74 %, que es el tipo de comparación que convierte la cifra en un recurso visual para la conversación de renovación.

La puntuación vive en el **portal de Microsoft 365 Defender** (`security.microsoft.com` → Secure Score). Esa es la superficie canónica y, en la práctica, la única superficie de Microsoft para la cabecera de Microsoft Secure Score. Para operadores MSP, el portal es por tenant — cada cliente requiere abrir su tenant individualmente. La agregación entre tenants no es algo que Microsoft proporcione de forma nativa; ahí es donde la vista de Panoptica365 (cubierta en la lección 5) se convierte en una superficie operativa significativa.

## Cómo se ven las recomendaciones

Una recomendación en Secure Score tiene varias piezas móviles:

- **Un título** que describe qué hacer (p. ej., «Exigir MFA para roles administrativos», «Asegurar que la auditoría de buzón esté habilitada para todos los usuarios», «Habilitar BitLocker para unidades del SO»).
- **Una categoría** (Identidad, Dispositivos, Aplicaciones, Datos).
- **Un valor máximo de puntos** — cuántos puntos aporta la recomendación si se implementa completamente.
- **Los puntos obtenidos actualmente** — cero si no está implementada, el máximo si está plenamente implementada, o algún valor intermedio por crédito parcial (cubierto en la lección 2).
- **Un requisito de licencia** — algunas recomendaciones solo aplican si el tenant tiene una licencia específica (p. ej., Entra P2, Defender for Endpoint, funciones de E5). Las recomendaciones para las que el tenant no tiene licencia no cuentan contra el máximo.
- **Una acción** — el enlace o las instrucciones para implementar realmente la recomendación, a menudo con enlace profundo al portal de Microsoft correspondiente.

Cuando los operadores miran la Secure Score de un tenant en el portal, lo que ven es esencialmente una lista priorizada de recomendaciones, ordenable por categoría o por valor en puntos, con el estado de implementación visible para cada recomendación. El trabajo de mover la puntuación es el trabajo de ir bajando por esa lista, implementando primero los elementos de alto valor y aceptando que algunos elementos no aplicarán a todos los clientes.

## La Identity Secure Score — la prima de Entra que conviene conocer

Existe una segunda métrica llamada **Identity Secure Score** que vive en Entra ID y que se confunde con Microsoft Secure Score con regularidad. Los operadores deberían conocer la distinción.

- **Microsoft Secure Score** — a nivel de tenant, cubre Identidad / Dispositivos / Aplicaciones / Datos. Es de lo que va esta lección. Vive en el portal de Defender.
- **Identity Secure Score** — específica de Entra, cubre solo recomendaciones relacionadas con identidad. Vive en el centro de administración de Entra. Tiene una metodología de puntuación separada centrada exclusivamente en la postura de seguridad de Entra ID.

Las dos puntuaciones se solapan (ambas incluyen recomendaciones de identidad) pero se calculan de forma distinta y aparecen en portales distintos. Microsoft Secure Score es la métrica más completa y la que hay que usar para conversaciones de cara al cliente. Identity Secure Score es ocasionalmente útil para profundizar en el panorama específico de identidad pero no es la cifra de cabecera.

Cuando un cliente pregunta «¿cuál es nuestra puntuación de seguridad?», casi siempre se refiere a Microsoft Secure Score. Si te encuentras mirando una cifra distinta de la que esperabas, comprueba en qué portal estás — tanto Entra como Defender muestran «Secure Score» sin dejar siempre obvio cuál es cuál.

## Lo que la puntuación NO te dice

Este es el encuadre que importa más que la definición. La puntuación es **útil pero limitada**. Los operadores que entienden los límites la usan bien; los que no, o bien la sobrevenden a los clientes (creando expectativas que la puntuación no puede cumplir) o bien la descartan (perdiéndose lo que sí señala con utilidad).

Lo que el porcentaje *no* mide:

- **Si el tenant ha sido atacado o comprometido.** Un 95 % en un tenant que está siendo silenciosamente exfiltrado por un atacante equipado con AiTM sigue siendo un 95 % hasta que se disparen las detecciones de Microsoft. La puntuación es una instantánea de configuración, no un estado de amenaza.
- **Si los ajustes configurados están *bien afinados* para el cliente.** Secure Score otorga puntos por «política antiphishing habilitada» — no sabe si la lista de usuarios protegidos contiene a las personas correctas, si la lista de remitentes de confianza se ha mantenido al día, si los umbrales de la política se ajustan al perfil real de riesgo del cliente. Dos clientes con Secure Scores idénticas pueden tener una protección antiphishing real en el mundo radicalmente distinta dependiendo del afinado por cliente subyacente.
- **Disciplina operativa.** La detección de deriva, el triaje de alertas, la gestión de excepciones, la revisión anual — nada de ese trabajo continuo se refleja en la puntuación. Un cliente cuyo MSP configuró todo correctamente hace dos años y luego ignoró la cuenta tiene la misma puntuación que un cliente cuyo MSP responde a las alertas de deriva en cuestión de horas.
- **Recomendaciones que no están en la lista de Microsoft.** La publicación de DMARC (el trabajo del lado de DNS de la lección 4 de la tarjeta 5) no se puntúa — Microsoft no puede verificar de forma fiable registros DNS externos, así que todo el viaje `p=none → p=quarantine → p=reject` no aparece. La publicación de SPF tampoco se puntúa. Higiene de reglas de flujo de correo, libros de excepciones específicos del cliente, formación en concienciación de seguridad, respuesta a incidentes fuera de la plataforma — nada de esto se mide.
- **El panorama de amenazas real del cliente.** Un pequeño despacho contable y un gran despacho de abogados pueden tener Secure Scores idénticas mientras se enfrentan a perfiles de amenaza completamente distintos. La puntuación es una línea base genérica contra la idea de Microsoft de «lo que todo tenant de M365 debería hacer», no una evaluación de riesgo a medida.
- **Si lo que está *configurado* coincide con lo que está *aplicado*.** Secure Score lee la configuración. No verifica de forma independiente que la configuración esté haciendo realmente lo que se supone que debe hacer en tiempo de ejecución.

La lista podría continuar. El punto no es ser cínico sobre la métrica — es genuinamente útil. El punto es ser honesto contigo mismo y con los clientes sobre lo que el porcentaje señala y lo que no.

## Por qué la puntuación sigue mereciendo la pena

A pesar de los límites, Microsoft Secure Score se gana su sitio en el arsenal MSP por tres razones específicas:

**Es una cifra cuantificable.** Los clientes responden a cifras. «Tu postura de seguridad ha mejorado» es vago; «tu Secure Score pasó del 62 % al 84 % en nueve meses» es concreto y presentable en una reunión de renovación.

**Está redactada por un tercero.** Microsoft define las recomendaciones y asigna las ponderaciones. El MSP no se está corrigiendo a sí mismo el examen — está siendo evaluado contra una línea base que Microsoft mantiene. Esa credibilidad de tercero importa cuando los clientes se preguntan si el MSP simplemente está inventando métricas que les hacen quedar bien.

**Es direccionalmente honesta en el suelo.** Un tenant al 41 % tiene recomendaciones serias sin tocar. Un tenant al 88 % ha hecho la mayor parte de lo que Microsoft recomienda. La precisión de la puntuación se degrada en el extremo alto (la diferencia entre 88 % y 95 % pueden ser recomendaciones limitadas por licencia o elementos que no aplican), pero en el extremo bajo es fiable como señal de «este cliente está infragestionado».

El nuevo MSP de la anécdota de apertura usa la cifra del 41 % para anclar la conversación con el cliente. No «tu proveedor anterior te mintió» (demasiado confrontacional, además de que el proveedor anterior puede haber creído genuinamente que su trabajo era adecuado), sino «aquí está la medición de partida; aquí está lo que hay detrás; aquí está el plan para subirla». En nueve meses esa puntuación está en 82 %. El cliente renueva. La Secure Score fue la métrica que hizo visible el trabajo.

## Lo que esto significa para el operador

Tres puntos para llevarte.

**Secure Score es una instantánea de configuración, no una garantía de seguridad.** Una puntuación alta no significa estar a salvo; una puntuación baja no significa estar comprometido. Trátala como un indicador de postura útil, no como un veredicto. Cuando los clientes pregunten «¿estamos seguros?», la puntuación es parte de la respuesta, nunca toda la respuesta.

**La Identity Secure Score es una métrica distinta en un portal distinto.** No confundas las dos en conversaciones con el cliente. Microsoft Secure Score es la cabecera; Identity Secure Score es el desglose para trabajo específico de identidad.

**El uso más potente de la puntuación es la tendencia a lo largo del tiempo.** Un único porcentaje de Secure Score es una cifra. Una Secure Score que se ha movido del 41 % al 82 % en nueve meses es una historia — y las historias son lo que los clientes recuerdan en la renovación. El trabajo de las tarjetas 3, 4 y 5 impulsa directamente ese movimiento; el resto de la tarjeta 6 va de leerlo correctamente y usarlo bien.

## Lo que viene

- **Lección 2: Cómo se calcula la puntuación.** La mecánica bajo el porcentaje — puntos, ponderaciones, crédito parcial, restricción por licencia, y por qué la puntuación se mueve sola sin que tú cambies nada.
- **Lección 3: Mapeando el curriculum a la puntuación.** Cómo el trabajo de las tarjetas 3, 4 y 5 se traduce en recomendaciones específicas de Secure Score, y la media docena de alto impacto que más mueve la puntuación.

Por ahora: abre el panel principal de Panoptica365. Mira la columna de Secure Score a través de tus tenants de cliente. Fíjate en el rango — algunos están en los 80, otros más bajos, el más bajo es el que necesita la conversación más pronto. Haz clic en el más bajo. La puntuación tiene una historia. El resto de la tarjeta 6 va de leerla y contarla.

---

*Fuentes de los datos en esta lección — Microsoft Learn sobre la visión general de Microsoft Secure Score ([Microsoft Learn — Microsoft Secure Score](https://learn.microsoft.com/en-us/defender-xdr/microsoft-secure-score)); metodología de cálculo de Secure Score ([Microsoft Learn — How Secure Score is calculated](https://learn.microsoft.com/en-us/defender-xdr/microsoft-secure-score-improvement-actions)); visión general de Identity Secure Score ([Microsoft Learn — Identity Secure Score in Entra ID](https://learn.microsoft.com/en-us/entra/fundamentals/identity-secure-score)); referencia de comparación sectorial para promedios de organizaciones de tamaño similar ([Microsoft Learn — Secure Score comparisons](https://learn.microsoft.com/en-us/defender-xdr/microsoft-secure-score-history-metrics-trends)); categorías de recomendaciones y puntuación limitada por licencia ([Microsoft Learn — Secure Score data](https://learn.microsoft.com/en-us/defender-xdr/microsoft-secure-score-required-permissions)).*
