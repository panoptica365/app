---
title: "Mapeando el curriculum a la puntuación — qué mueve la cifra y qué no"
subtitle: "Qué controles de las tarjetas 3–5 se traducen en recomendaciones de alto impacto en Secure Score y cómo priorizar para maximizar la ganancia."
icon: "git-compare"
last_updated: 2026-05-29
---

# Mapeando el curriculum a la puntuación — qué mueve la cifra y qué no

Un miembro del consejo de un cliente, recién sintonizado con la ciberseguridad en una conferencia, le pide al MSP un plan por escrito para «mejorar nuestra Secure Score significativamente durante el próximo trimestre». El cliente está actualmente en 58 %. El miembro del consejo quiere 80 % para la próxima reunión. El MSP tiene aproximadamente doce semanas de tiempo de operador para destinar a esto, repartidas a lo largo de su cartera habitual de clientes.

¿Qué hace primero el MSP?

Esta es la pregunta operativa más habitual sobre Secure Score, y tiene una respuesta precisa: implementar la **media docena de alto impacto** — las seis recomendaciones que más mueven la Secure Score de un cliente pyme mientras también producen una mejora real de seguridad. La media docena es donde vive la mayor parte de la brecha entre un tenant al 58 % y uno al 88 %. El resto es crédito parcial, elementos limitados por licencia y la cola larga de recomendaciones más pequeñas.

Esta lección mapea el trabajo de las tarjetas 3, 4 y 5 sobre recomendaciones específicas de Secure Score, identifica la media docena y adelanta qué no aparece en la puntuación en absoluto (la lección 4 lo cubre en profundidad).

## El panorama general — dónde vive la puntuación

La mayor parte de la Secure Score de un tenant pyme reside en tres áreas, cada una correspondiente a una de las tarjetas de implementación de este curriculum:

- **Recomendaciones de identidad** (Tarjeta 3 — Acceso Condicional). MFA, bloqueos de autenticación heredada, protección de admin, postura de inicio de sesión. Para un tenant pyme de Business Premium, las recomendaciones de identidad típicamente contribuyen al 30-40 % del máximo alcanzable.
- **Recomendaciones de dispositivos** (Tarjeta 4 — Intune). Cumplimiento de dispositivos, BitLocker, reglas ASR, configuración de Defender for Endpoint. Aproximadamente el 25-35 % del máximo alcanzable.
- **Recomendaciones de aplicaciones** (Tarjeta 5 — Correo y colaboración). Antiphishing, Safe Links / Safe Attachments, auditoría de buzón, política de cuarentena, controles de reenvío automático. Aproximadamente el 25-30 % del máximo alcanzable.
- **Recomendaciones de datos** (etiquetas de sensibilidad, DLP, retención). Mayoritariamente con licencia E5; para tenants de Business Premium estas son típicamente Risk Accepted (lección 2). Contribución pequeña al máximo alcanzable en la práctica.

La forma de la puntuación de un cliente pyme: la mayor parte de los puntos están en Identidad, Dispositivos y Aplicaciones. El cliente al 41 % tiene brechas en las tres; el cliente al 88 % ha cubierto los elementos de alto impacto en cada una. La media docena de abajo saca uno o dos elementos de cada una de las tres tarjetas de implementación.

## La media docena de alto impacto

Estas seis recomendaciones mueven la puntuación más para los clientes pyme que usan Business Premium con el ecosistema Microsoft completo. Implementar las seis representa rutinariamente la mayor parte de la brecha entre un tenant de baja base y un tenant del 80 % o más.

**1. Exigir MFA para todos los usuarios — Tarjeta 3 lección 2.** Típicamente la mayor ganancia única de Secure Score disponible en cualquier tenant. La recomendación premia con crédito parcial por usuario: crédito completo cuando el 100 % de los usuarios está aplicado. Los usuarios sin aplicar (ejecutivos exigiendo excepciones, cuentas de servicio, contratistas) cuestan crédito parcial. El patrón de implementación de la Tarjeta 3 — desplegar la plantilla CA «Require MFA for all users», alcance a todos los usuarios, gestionar excepciones vía la disciplina por usuario de inclusión/exclusión — impulsa directamente esta recomendación hacia el crédito completo.

**2. Bloquear autenticación heredada — Tarjeta 3 lección 3.** La segunda mayor ganancia del lado de identidad. La autenticación heredada salta el MFA; bloquearla cierra la brecha. La recomendación se puntúa de forma binaria — o la autenticación heredada está bloqueada a nivel de tenant vía Acceso Condicional, o no lo está. La implementación se mapea directamente con la plantilla CA «Block legacy authentication» de la lección 3 de la Tarjeta 3. Sin crédito parcial; un despliegue de política mueve la aguja en un paso.

**3. Habilitar BitLocker para unidades del SO — Tarjeta 4 lección 4.** La mayor ganancia del lado del dispositivo en la mayoría de los parques Windows. Se puntúa por dispositivo: crédito completo cuando cada dispositivo Windows gestionado tiene BitLocker activo en el volumen del SO. La plantilla BitLocker Settings de la Tarjeta 4 lo configura vía Intune; el crédito por dispositivo se acumula a medida que los dispositivos se cifran. Los clientes con parques en estado mixto (unos cifrados, otros no) obtienen crédito parcial; llegar al completo requiere el trabajo operativo de poner en línea los dispositivos sin cifrar.

**4. Habilitar reglas ASR en modo Block — Tarjeta 4 lección 7.** Varias reglas ASR se puntúan individualmente — cada regla que esté habilitada en modo Block contribuye a la puntuación. La plantilla ASR Rules Standard de la Tarjeta 4 despliega las 19 reglas ASR en modo Block de fábrica; desplegar esta plantilla (y confirmar que las reglas aplican a todos los dispositivos gestionados) lleva múltiples recomendaciones por regla al crédito completo simultáneamente. Este es el grupo de recomendaciones donde un solo despliegue desbloquea más elementos discretos de puntuación.

**5. Habilitar auditoría de buzón para todos los usuarios — Tarjeta 5 lección 6.** Se puntúa de forma binaria: cada buzón en el tenant o tiene el registro de auditoría habilitado, o no lo tiene. El ajuste de auditoría de buzón de la lección 6 de la Tarjeta 5 empuja esto a nivel de tenant vía Panoptica365. Los buzones nuevos derivan a los ajustes de auditoría por defecto (el ejemplo canónico de la Tarjeta 5); reaplicar la postura estricta restaura el crédito completo. La recomendación es también uno de los elementos de mayor impacto para la preparación forense — puntuación y seguridad se alinean limpiamente aquí.

**6. Habilitar la política de seguridad preestablecida Standard o Strict — Tarjeta 5 lecciones 3, 7 y 10.** Este es el multiplicador del paquete. La política de seguridad preestablecida de Microsoft configura antiphishing, Safe Links, Safe Attachments, antimalware y políticas de cuarentena todo en uno. Habilitar Standard o Strict en el tenant mueve múltiples recomendaciones discretas de Secure Score al crédito completo simultáneamente — típicamente una variación de 5-10 puntos en un tenant de Business Premium. La implementación son tres clics en el portal de Defender; esta es la recomendación más alta de impacto por esfuerzo de todo el curriculum.

Estos seis elementos, implementados de extremo a extremo en un cliente que parte del 41 %, llevarán rutinariamente a ese cliente al rango del 75-85 %. La brecha restante hasta el 88 %+ viene de la cola larga de recomendaciones más pequeñas (elementos con crédito parcial, reglas ASR adicionales fuera del conjunto estándar, afinados antiphishing más pequeños, elementos limitados por licencia gestionados vía Risk Accepted, remediación de vulnerabilidades que tiene que ocurrir continuamente, etc.).

## Habilitar DKIM — el casi-incluido de la media docena

Vale la pena llamarlo aparte porque es el elemento de autenticación de correo que la Tarjeta 5 cubrió pero que no entró en la media docena:

**Habilitar firma DKIM para todos los dominios personalizados — Tarjeta 5 lección 4.** Esto *es* una recomendación de Secure Score, puntuada por separado, y razonablemente de alto valor. No está en la media docena porque el trabajo de implementación por dominio — publicar CNAMEs DNS para cada dominio aceptado, habilitar la firma por dominio en el portal de M365 — es una tarea operativa más compleja que los elementos de la media docena, y la contribución a la puntuación por tenant es menor que la de cada uno de los seis de arriba. Pero debería estar en la lista a corto plazo del operador para cualquier cliente que use la pila de correo completa.

Vale la pena ser explícitos sobre qué se puntúa y qué no del lado de la autenticación de correo: **la habilitación de DKIM se puntúa** (Microsoft puede verificar el interruptor del lado del tenant y los registros DNS publicados). **La publicación de SPF no se puntúa como una recomendación de Secure Score de la forma que los operadores a veces asumen** — aunque SPF es crítico para el panorama más amplio de autenticación de correo. **La publicación de DMARC y el viaje completo `p=none → p=quarantine → p=reject` no se puntúan en absoluto** — Microsoft no puede verificar de forma fiable lo que hay en `_dmarc.cliente.com` para dominios externos arbitrarios. El trabajo de DMARC importa para la seguridad; simplemente no mueve la puntuación. La lección 4 de esta tarjeta cubre esto y otros trabajos no puntuados pero críticos en profundidad.

## La cola larga — crédito parcial y elementos limitados por licencia

Más allá de la media docena, docenas de recomendaciones más pequeñas contribuyen a la puntuación. Algunos ejemplos:

- **MFA para roles administrativos** — distinto de «MFA para todos los usuarios»; a menudo ya cubierto si la política de todos los usuarios está en su sitio, pero se llama como su propia recomendación.
- **Deshabilitar métodos individuales de inicio de sesión** (MFA basado en SMS, MFA por llamada de voz) — pequeñas recomendaciones por método.
- **Reglas ASR específicas no incluidas en el conjunto estándar** — reglas adicionales que no son parte de las 19 de la plantilla ASR de la Tarjeta 4 pero se puntúan individualmente.
- **Remediación de vulnerabilidades** — recomendaciones por CVE impulsadas por MDVM que aparecen y desaparecen a medida que Microsoft detecta nuevas vulnerabilidades en terminales gestionados (la causa diaria del movimiento de la puntuación de la lección 2).
- **Configurar la política antispam saliente para restringir** — Tarjeta 5 lección 9; contribución individual más pequeña.
- **Deshabilitar Basic Auth para el envío SMTP** — Tarjeta 5 lección 9; pequeña pero rastreada.
- **Bloquear reenvío automático externo** — Tarjeta 5 lección 5; pequeña pero rastreada.

Estos elementos no mueven individualmente la puntuación por mucho, pero en conjunto representan la brecha entre un tenant del 80 % y uno del 88 %. El trabajo de llevar a un cliente de «suficientemente bueno» a «ejemplar» es el trabajo de moler a través de esta cola larga — la mayor parte de la cual el curriculum ya ha cubierto en las tarjetas 3, 4 y 5.

## Lo que NO está en la puntuación — la vista previa

Para anticiparnos a la pregunta natural del operador: mucho del trabajo de las tarjetas 3, 4 y 5 no aparece en la Secure Score en absoluto. La lección 4 cubre esto en detalle, pero la lista de cabecera:

- **Publicación de DMARC y el viaje completo de aplicación** — del lado de DNS; no puntuado.
- **Publicación de SPF** — no puntuada como comprobación verificada del lado de DNS.
- **Listas de remitentes de confianza antiphishing específicas del cliente** — la *preestablecida* se puntúa; el afinado por cliente no.
- **Higiene de las reglas de flujo de correo** — el trabajo de auditar las reglas de transporte trimestralmente; no puntuado.
- **Excepciones de reenvío automático por Remote Domain específicas de dominio** — el bloqueo a nivel de tenant se puntúa; la disciplina del libro de excepciones no.
- **Detección de deriva y triaje** — el ritmo operativo en el corazón de las tarjetas 4 y 5; no puntuado.
- **Revisiones anuales de deuda de configuración** — el trabajo de auditoría; no puntuado.
- **Mantenimiento del libro de excepciones del cliente** — la disciplina que se compone; no puntuada.
- **Formación en concienciación de seguridad y simulaciones de phishing** — incluso cuando se ejecutan; no puntuadas directamente (el «Attack Simulation Training» relacionado, exclusivo de E5, se puntúa si lo tienes, pero el propio trabajo de concienciación no).
- **Capacidad de respuesta a incidentes** — la disciplina fuera de la plataforma de tener un runbook, haberlo probado, tener un contacto fuera de horario — nada de esto se puntúa.

Esto no es una queja sobre la puntuación; es un hecho sobre lo que la puntuación mide. Un tenant al 92 % sin disciplina operativa es menos seguro que un tenant al 82 % con un MSP que responde a las alertas de deriva en cuestión de horas y ejecuta revisiones anuales. La lección 4 lo hace explícito.

## Lo que esto significa para el operador

Tres puntos para llevarte.

**La media docena es donde vive el plan de mejora del cliente.** Cuando un cliente pregunte «¿cómo mejoramos nuestra puntuación?» — y lo harán — la respuesta son los seis elementos de arriba, en orden de impacto. La mayor parte de la brecha entre un tenant de baja base y un tenant pyme saludable vive en estas seis recomendaciones. Documenta la media docena como un plan trabajado; llévalo a las reuniones de renovación como el camino de mejora visible.

**El curriculum es el motor de la puntuación.** La mayor parte del trabajo de las tarjetas 3, 4 y 5 sube directamente la Secure Score. Los operadores que han interiorizado el curriculum ya han hecho — o saben exactamente cómo hacer — el trabajo que mueve el porcentaje. La Secure Score no es un proyecto separado; es la capa de medición sobre el trabajo que el curriculum enseña.

**La disciplina operativa no puntúa. Hazla de todas formas.** Una fracción significativa del valor de seguridad entregado por un buen MSP no aparece en Secure Score en absoluto — triaje de deriva, revisiones anuales, gestión de excepciones del cliente, aplicación de DMARC, higiene de reglas de flujo de correo. Los clientes te miden por la puntuación porque es la cifra que pueden ver; tú tienes que saber que el trabajo no puntuado es lo que los mantiene seguros entre instantáneas.

## Lo que viene

- **Lección 4: Dónde Secure Score induce a error.** Los puntos ciegos, las trampas de manipulación, y la historia del 92 %-y-víctima-de-BEC. Por qué perseguir el 100 % es el objetivo equivocado — y cómo es el objetivo correcto.
- **Lección 5: Secure Score de cara al cliente.** Cómo usar el porcentaje en conversaciones de renovación, informes de línea base y narrativas de tendencia.

Por ahora: abre el panel principal de Panoptica365, encuentra al cliente con la Secure Score más baja de tu cartera. Ese es el cliente cuyo plan de media docena deberías escribir esta semana. Seis recomendaciones, cada una mapeada a una lección de la Tarjeta 3 / 4 / 5, cada una con una implementación definida. Para cuando llegue la próxima conversación de renovación, la puntuación de ese cliente se ha movido.

---

*Fuentes de los datos en esta lección — Microsoft Learn sobre el catálogo de recomendaciones de Microsoft Secure Score ([Microsoft Learn — Improvement actions](https://learn.microsoft.com/en-us/defender-xdr/microsoft-secure-score-improvement-actions)); puntuación de recomendaciones de Acceso Condicional para MFA y autenticación heredada ([Microsoft Learn — Conditional Access Secure Score recommendations](https://learn.microsoft.com/en-us/entra/identity/conditional-access/concept-conditional-access-policy-common)); recomendaciones de BitLocker y cumplimiento de Intune ([Microsoft Learn — Intune Secure Score recommendations](https://learn.microsoft.com/en-us/mem/intune/protect/security-baseline-settings-mdm-all)); referencia de Secure Score para reglas de reducción de superficie de ataque ([Microsoft Learn — Enable ASR rules](https://learn.microsoft.com/en-us/defender-endpoint/enable-attack-surface-reduction)); recomendación de auditoría de buzón ([Microsoft Learn — Enable mailbox auditing](https://learn.microsoft.com/en-us/purview/audit-mailboxes)); impacto en Secure Score de la política de seguridad preestablecida ([Microsoft Learn — Preset security policies](https://learn.microsoft.com/en-us/defender-office-365/preset-security-policies)); recomendación de firma DKIM ([Microsoft Learn — Use DKIM to validate outbound email](https://learn.microsoft.com/en-us/defender-office-365/email-authentication-dkim-configure)).*
