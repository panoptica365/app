---
title: "Dónde Secure Score induce a error — la historia del 92 %-y-víctima-de-BEC y la trampa de manipular la puntuación"
subtitle: "Un 92 % no evitó un BEC de 94 000 $. Los puntos ciegos, la trampa de manipular la puntuación, y el trabajo de seguridad que no aparece en ninguna cifra."
icon: "triangle-alert"
last_updated: 2026-05-29
---

# Dónde Secure Score induce a error — la historia del 92 %-y-víctima-de-BEC y la trampa de manipular la puntuación

Una empresa logística de 60 personas está en una Microsoft Secure Score del 92 %. El MSP que gestiona el tenant está orgulloso de la cifra. El equipo ejecutivo del cliente ha visto la puntuación en su revisión trimestral y está satisfecho. La cifra del año anterior era del 79 %; el trabajo para subirla apareció en la propuesta de renovación y la renovación se cerró limpiamente. Por cualquier medida convencional de cómo un MSP demuestra valor, este tenant está en el cuartil superior.

Un martes por la mañana de noviembre, la controladora reenvía una transferencia de 94 000 $ a lo que cree que es el nuevo socio logístico del cliente. Las instrucciones de la transferencia llegaron en un correo que se parecía exactamente al estilo de comunicación normal del socio. El correo pasó la autenticación SPF y DKIM — realmente vino del dominio del socio. El correo del socio había sido comprometido por un atacante equipado con AiTM dos días antes. El atacante había leído la conversación de la operación logística en curso y se había insertado con un mensaje de redirección de transferencia en el momento perfecto.

La Secure Score no se mueve. La configuración del tenant del MSP sigue en el 92 %. Las recomendaciones de Microsoft siguen implementadas. Ninguna de ellas previno este ataque.

El abogado del cliente quiere entenderlo. El suscriptor del seguro quiere entenderlo. El consultor sénior del MSP tiene que explicar la brecha entre «Secure Score del 92 %» y «fue víctima de un BEC por 94 000 $». Esta lección va de esa brecha.

## Lo que la puntuación mide vs lo que no mide

La puntuación mide **si el tenant del cliente tiene configuraciones que Microsoft recomienda.** Cada configuración ha sido elegida por Microsoft porque es una defensa de línea base útil. Implementarlas todas mueve al tenant de «configuración de fábrica por defecto» a «línea base recomendada por Microsoft». Eso es valor de seguridad genuino.

La puntuación *no* mide:

- Si las configuraciones están bien afinadas para el perfil de riesgo real del cliente
- Si el cliente ha sido atacado
- Si el operador responde rápidamente cuando algo deriva
- Si los proveedores y socios del cliente tienen seguridad de correo básica
- Si los usuarios del cliente han sido formados para reconocer phishing sofisticado
- Si existe la capacidad de respuesta a incidentes fuera de la plataforma
- Si la aplicación de DMARC del cliente está en su sitio
- Si el libro de excepciones del cliente ha sido revisado recientemente
- Si las MailTips llegan realmente a los usuarios (algunos usuarios las deshabilitan a nivel de buzón)
- Si el operador audita las reglas de transporte trimestralmente
- Si el operador detecta patrones anómalos de inicio de sesión dentro de la ventana de respuesta

La empresa logística al 92 % tenía un tenant perfectamente configurado según el conjunto de recomendaciones de Microsoft. El ataque entró por un vector que el conjunto de recomendaciones no aborda — un correo del socio comprometido, usado para insertar un mensaje de redirección en una conversación en curso. La puntuación no tenía nada que decir sobre la higiene de correo del socio, el proceso de verificación de transferencias del cliente, o el tiempo de respuesta del operador cuando el ataque aterrizó. La puntuación no estaba *equivocada*; simplemente no estaba *completa*.

## La trampa de manipular la puntuación — cuando la puntuación miente porque el operador la ayudó

Hay formas honestas de que una Secure Score suba (implementar las recomendaciones) y formas deshonestas. Los operadores a veces — bajo presión, bajo tiempo, o porque el cliente está mirando la cifra — se deslizan hacia las formas deshonestas. Esta es la trampa de manipular la puntuación, y reconocerla en tu propio trabajo es parte de la disciplina profesional.

Los tres patrones de manipulación más habituales:

**1. « Resolved through third party » sin tercero.** La lección 2 introdujo la opción: cuando una herramienta no-Microsoft cubre genuinamente la misma función de seguridad, puedes marcar una recomendación como resuelta y obtener los puntos. Algunos operadores aplican esto a recomendaciones que simplemente no quieren implementar, reclamando cobertura de «tercero» que no existe o que no cubre realmente la función. La puntuación sube. La seguridad no. El riesgo de auditoría es el mismo.

**2. Marcar la implementación como «completa» cuando no lo está.** Algunas recomendaciones de Secure Score comprueban configuración del tenant que Microsoft puede verificar automáticamente (binaria: ¿está el ajuste activado o desactivado?). Otras requieren la auto-atestación del operador — «sí, hemos completado esto». Cuando un operador marca algo como completo sin haberlo completado realmente, la puntuación refleja la atestación, no la realidad. En algunos contextos de cumplimiento, esto es genuinamente fraude.

**3. Risk-Accepting recomendaciones para limpiar el ruido visual.** Las recomendaciones sentadas en cero puntos arrastran el porcentaje hacia abajo. Marcarlas como Risk-Accepted no mueve los puntos pero sí cambia la presentación visual en el portal. Un operador que marca como Risk-Accepted todo lo que no puede o no quiere implementar está siendo honesto. Un operador que marca como Risk-Accepted elementos que *deberían* ser implementados — porque hacerlo hace que el panel parezca más limpio — está manipulando. La línea entre higiene (Risk-Accept lo que genuinamente no es aplicable) y manipulación (Risk-Accept lo que es inconveniente) es el juicio profesional del operador.

La prueba honesta para cualquiera de estas: ¿te sentirías cómodo mostrando la recomendación y la acción tomada al cliente en una reunión de renovación? «Marcamos Customer Lockbox como Risk Accepted porque el tenant no tiene licencia E5 y documentamos las alternativas que usamos en su lugar» — eso es defendible. «Marcamos Defender for Identity como Resolved through third party porque... eh... bueno, la cifra de la puntuación se ve mejor» — eso no lo es.

## Recomendaciones que se puntúan pero son operativamente dolorosas

Una trampa aparte: algunas recomendaciones de Secure Score están configuradas para otorgar puntos por ajustes que, cuando se implementan a ciegas, perjudican las operaciones del cliente. Implementarlas correctamente requiere el afinado específico del cliente que la puntuación no mide.

Ejemplos:

**«Habilitar Controlled Folder Access en modo Block».** La Tarjeta 4 lección 7 cubrió esto directamente. Microsoft otorga más puntos de Secure Score por CFA configurado en Block que en Audit — Block efectivamente previene escrituras a carpetas protegidas por aplicaciones no incluidas en la lista de permitidos, mientras que Audit solo las registra. Pero el modo Block sin una lista de permitidos de aplicaciones específica del cliente genera una avalancha de tickets de mesa de ayuda el primer día: herramientas de backup escribiendo en documentos de usuario, clientes de sincronización (Dropbox, Google Drive, variantes de OneDrive), aplicaciones creativas escribiendo en Documentos, herramientas de productividad guardando automáticamente. La plantilla ASR de Panoptica365 entrega CFA en modo Audit específicamente porque Block-desde-el-principio es operativamente insostenible. Pasar CFA a Block puramente por los puntos de Secure Score, sin la revisión del registro de auditoría y la construcción de la lista de permitidos, rompe flujos de trabajo legítimos. El patrón correcto del operador es el de la lección 7: enviar en Audit, vigilar durante dos a cuatro semanas, construir la lista de permitidos a partir de los intentos de escritura del modo audit, luego pasar a Block. La puntuación se mueve al final, no al principio.

**«Bloquear autenticación heredada».** La Tarjeta 3 lección 3 ya cubrió esto — y es la decisión correcta. Pero si lo implementas sin identificar primero las impresoras heredadas, las aplicaciones de negocio heredadas y el flujo de trabajo incompatible con MFA heredado que el cliente tiene, rompes cosas. La puntuación se mueve; la mesa de ayuda se inunda. El patrón correcto del operador es la auditoría previa seguida del despliegue, no el despliegue solo.

**«Designar más de un administrador global».** Microsoft premia tener varios administradores globales (resiliencia frente a que cualquiera pierda el acceso). Algunos clientes tienen solo uno — a menudo deliberadamente, a menudo por buenas razones (menor superficie de amenaza, auditoría más simple). Implementar la recomendación añadiendo más administradores globales sin reflexión añade superficie de ataque por la puntuación. La disciplina de endurecimiento de admin de la Tarjeta 3 lección 6 es la respuesta correcta aquí.

Estas recomendaciones no son malas recomendaciones. Son recomendaciones que requieren el juicio del operador sobre *cómo* implementar, no solo *si* implementar. La puntuación no premia el juicio; premia el estado de configuración.

## Las recomendaciones que la puntuación no rastrea en absoluto

Este es el corazón de la lección. Una fracción significativa del trabajo de seguridad que hace un MSP competente es invisible para Microsoft Secure Score. No porque Microsoft no piense que importa — sino porque la puntuación solo puede medir lo que Microsoft puede verificar programáticamente en el tenant.

**Publicación y aplicación de DMARC y SPF.** El viaje completo de SPF / DKIM / DMARC desde `p=none` a `p=reject` importa enormemente para la protección anti-spoofing del correo entrante. **La habilitación de DKIM** (el interruptor del lado del tenant en el centro de administración de M365) se puntúa — Microsoft puede verificarlo. **La publicación de SPF y DMARC no** — son registros DNS externos que Microsoft no puede verificar de forma fiable a la escala de todos los tenants de M365 del mundo, así que la puntuación no los incluye. Los clientes que han hecho el trabajo completo de autenticación de correo se ven igual en Secure Score que los clientes que solo han habilitado DKIM. El trabajo importa; la puntuación no lo mide.

**Disciplina operativa.** Tiempo de triaje de deriva. Tiempo de respuesta a alertas. Mantenimiento del libro de excepciones. Finalización de revisiones anuales. La disciplina de *realmente hacer el trabajo entre instantáneas* — esa es toda la tesis operativa de las tarjetas 4 y 5, y nada de eso aparece en la puntuación. Un tenant cuyo MSP responde a las alertas de deriva en una hora tiene la misma puntuación que un tenant cuyo MSP responde en una semana, dada una configuración actual idéntica.

**Afinado específico del cliente.** Listas de usuarios protegidos de antiphishing. Listas de remitentes de confianza con alcance a socios de negocio específicos. Excepciones de reenvío automático por Remote Domain por cliente. Auditoría de reglas de flujo de correo. Todo el contenido de la Tarjeta 5. La habilitación de la política de seguridad preestablecida se puntúa; el afinado específico del cliente subyacente no.

**Capacidad de respuesta a incidentes.** ¿Tiene el MSP un runbook escrito de respuesta a BEC? ¿Se ha probado? ¿Hay un canal de contacto fuera de horario para el cliente? ¿Puede el equipo de operadores ejecutar un restablecimiento de credenciales / revocación de sesiones / auditoría de reglas de buzón en 30 minutos cuando se dispara una alerta? Nada de esto se puntúa. Nada de esto forma parte del conjunto de recomendaciones de Microsoft.

**Higiene de correo de proveedores y socios.** El ataque del 92 % de la apertura vino a través de un proveedor comprometido. Si los proveedores del cliente tienen autenticación de correo correcta, si han sido comprometidos recientemente, si el proceso de verificación de transferencias del cliente trata los mensajes provenientes de proveedores con un escepticismo apropiado — todo sin puntuar.

**Concienciación de seguridad del usuario.** Tasas de finalización de simulación de phishing. Ratios entrenados-vs-no-entrenados. Tasa de reportadores por usuario. Nada de esto está directamente en Microsoft Secure Score (Attack Simulation Training es exclusivo de E5, e incluso eso puntúa la configuración de la herramienta de simulación, no los resultados de formación del usuario del cliente).

La lista podría continuar. El patrón: **cualquier cosa que requiera juicio humano, trabajo operativo continuo, o visibilidad sobre cosas que Microsoft no puede verificar programáticamente sobre el entorno del cliente queda sin puntuar.** Secure Score mide la instantánea de configuración. El trabajo no puntuado es lo que mantiene al cliente seguro en los momentos entre instantáneas.

## Por qué perseguir el 100 % es el objetivo equivocado

Una Secure Score del 100 % es alcanzable en principio pero rara vez correcta en la práctica. Razones:

- **Algunas recomendaciones no encajan con algunos clientes.** Un pequeño despacho contable no necesita Insider Risk Management. Forzar la recomendación a estado «completo» con una falsa atribución a terceros es manipulación.
- **Las recomendaciones limitadas por licencia requieren actualizaciones de licencia.** Un cliente de Business Premium no puede honestamente implementar funciones exclusivas de E5. Aceptarlas como Risk-Accepted y aceptar un porcentaje más bajo es más honesto que manipular la solución.
- **Algunas recomendaciones entran en conflicto con las realidades operativas del cliente.** Política de spam saliente puesta en su acción más estricta de restringir-y-bloquear sin afinar para los remitentes legítimos de alto volumen del cliente (gente de ventas en un día de campaña, gente de comunicaciones enviando la carta anual a empleados). Varios administradores globales en un negocio de un solo propietario. Bloqueo de autenticación heredada en un tenant con aplicaciones de negocio heredadas críticas que aún no se han modernizado.
- **Los puntos marginales por encima de ~88 % requieren rendimientos decrecientes.** Cada recomendación restante contribuye menos; el coste operativo de implementar es a menudo desproporcionado a la ganancia de seguridad.

El objetivo correcto de Secure Score, para clientes de Business Premium que usan el ecosistema completo, es **80 % o superior con decisiones honestas de Risk Accepted documentadas para todo lo de debajo**. Los 80 altos son alcanzables para clientes donde el operador ha hecho el trabajo de implementación completo. 90 %+ requiere que se alineen factores específicos del cliente (sin recomendaciones aplicables exclusivas de E5, sin restricciones operativas) y rara vez viene de la persecución incremental de puntuación.

La lección 6 cubre el encuadre del objetivo en detalle operativo. Para esta lección, el principio: un objetivo del 100 % distorsiona el trabajo. Un objetivo de 80 %-con-disciplina lo enfoca.

## Lo que esto significa para el operador

Tres puntos para llevarte.

**Secure Score mide configuración, no seguridad.** La historia del 92 %-y-víctima-de-BEC es el caso de advertencia que todo operador necesita tener en la cabeza. Una puntuación alta es un logro de configuración; no es una garantía de seguridad. Úsala como una de varias señales, no como la conclusión de cabecera.

**Reconoce los patrones de manipulación en tu propio trabajo.** « Resolved through third party » sin tercero. Auto-atestación sin seguimiento. Risk-Accepting para limpiar el ruido visual en lugar de para documentar no-aplicabilidad genuina. Estos son fáciles de deslizarse bajo presión. La prueba honesta: ¿defenderías la acción al cliente en una reunión de renovación? Si no, no la tomes.

**El trabajo no puntuado es lo que mantiene al cliente seguro.** Publicación de DMARC, triaje de deriva, mantenimiento del libro de excepciones, afinado específico del cliente, capacidad de respuesta a incidentes, concienciación de higiene de correo de proveedores — nada de esto puntúa, todo importa. El valor profesional del operador reside en gran medida en el trabajo no puntuado. Comunica eso a los clientes explícitamente; no dejes que confundan la puntuación con toda la historia.

## Lo que viene

- **Lección 5: Secure Score de cara al cliente.** Cómo usar el porcentaje en conversaciones con el cliente honestamente — la narrativa de renovación, la tendencia a lo largo del tiempo, la historia de línea-base-en-incorporación.
- **Lección 6: Operar Secure Score a escala + cierre del curriculum.** La cadencia de revisión trimestral, el encuadre del objetivo del 80 %+, y el argumento de cierre del curriculum.

Por ahora: elige al cliente con la Secure Score más alta de tu cartera. Mira su lista de recomendaciones. Para cada recomendación marcada como « Resolved through third party », ¿puedes nombrar la herramienta de terceros y confirmar que realmente cubre la función? Para cada « Risk accepted », ¿puedes defender la razón de la aceptación? Los patrones de manipulación suelen ser silenciosos — encontrarlos en tu propio trabajo es la disciplina. Encuéntralos antes que un cliente o un auditor lo haga.

---

*Fuentes de los datos en esta lección — Microsoft Learn sobre las limitaciones de Secure Score y qué mide la métrica ([Microsoft Learn — Microsoft Secure Score overview](https://learn.microsoft.com/en-us/defender-xdr/microsoft-secure-score)); opciones de estado de recomendaciones incluyendo terceros y Risk Accepted ([Microsoft Learn — Track recommendation completion](https://learn.microsoft.com/en-us/defender-xdr/microsoft-secure-score-improvement-actions)); contexto de patrones de ataque BEC y AiTM ([CISA — Business Email Compromise](https://www.cisa.gov/topics/cyber-threats-and-advisories/business-email-compromise-bec)); modos de Controlled Folder Access (Audit vs Block) y consideraciones operativas ([Microsoft Learn — Controlled Folder Access](https://learn.microsoft.com/en-us/defender-endpoint/controlled-folders)); orientación de buenas prácticas para administrador global ([Microsoft Learn — Protect admin accounts](https://learn.microsoft.com/en-us/microsoft-365/admin/security-and-compliance/protect-global-admin)).*
