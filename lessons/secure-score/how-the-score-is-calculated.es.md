---
title: "Cómo se calcula la puntuación — puntos, crédito parcial y por qué se mueve sola"
subtitle: "La mecánica bajo el porcentaje: puntos, crédito parcial, restricción por licencia y por qué la puntuación se mueve sin que cambies nada."
icon: "calculator"
last_updated: 2026-05-29
---

# Cómo se calcula la puntuación — puntos, crédito parcial y por qué se mueve sola

Una operadora abre Panoptica365 un lunes por la mañana. El viernes anterior había dejado al Cliente X exactamente en 88,79 %. Esta mañana el mismo cliente lee 86,94 %. Nada cambió en el cliente durante el fin de semana — sin buzones nuevos, sin ediciones de políticas, sin actividad administrativa alguna según el Tenant Change Log. La Secure Score del cliente bajó casi dos puntos sin que nadie tocara nada.

Ya ha visto esto antes. Es el rompecabezas más habitual de Secure Score con el que se topan los operadores, y la respuesta casi siempre es algo del lado de Microsoft. Añadieron una nueva recomendación, cambiaron cómo se puntúa una existente, retiraron una y las cuentas se desplazaron, una función limitada por licencia pasó a estar disponible y el máximo alcanzable se movió — o, lo más frecuente para clientes con Defender for Endpoint desplegado, se detectó una nueva vulnerabilidad en software instalado en un dispositivo gestionado, haciendo bajar la puntuación hasta que se apliquen los parches.

La Secure Score no es una medición estática del tenant. Es una *diana móvil* — el conjunto de recomendaciones de Microsoft evoluciona continuamente, el estado de licencias del tenant cambia ocasionalmente, y las cuentas debajo del porcentaje se desplazan en consecuencia. Los operadores que entienden la mecánica pueden leer el movimiento correctamente; los que no, acaban persiguiendo derivas fantasma que en realidad no son deriva en absoluto.

Esta lección recorre las cuentas bajo el porcentaje, la mecánica del crédito parcial, la restricción por licencia que afecta al máximo, y las cinco razones más habituales por las que la puntuación se mueve de la noche a la mañana.

## Las cuentas básicas

El porcentaje es directo:

```
% de Secure Score = (puntos obtenidos en todas las recomendaciones aplicables) ÷ (puntos máximos posibles) × 100
```

Toma un ejemplo hipotético: un tenant cuyo recuadro de Secure Score lee `88,79 %` con `988,2 / 1113,0` debajo. El numerador (988,2) son los puntos que el tenant ha obtenido realmente. El denominador (1113,0) es el máximo posible — la suma de valores en puntos para cada recomendación que aplica a este tenant dada su licencia. El porcentaje es 988,2 ÷ 1113,0 × 100 = 88,79 %.

Dos cosas que notar sobre ese denominador:

- **Es el máximo *aplicable*, no el máximo absoluto.** Las recomendaciones para las que el tenant no tiene licencia no contribuyen al denominador. A un tenant de Business Premium no se le infla el denominador con recomendaciones exclusivas de E5 como Etiquetas de Sensibilidad o Insider Risk Management — esas simplemente no aplican. Esto es justo e importante: significa que a tu cliente no se le penaliza por no tener un nivel de licencia por el que no paga.
- **Cambia cuando Microsoft cambia su conjunto de recomendaciones.** Si Microsoft añade una nueva recomendación que vale 10 puntos, tu denominador sube en 10, tu numerador se queda igual (todavía no has implementado la nueva recomendación), y tu porcentaje baja ligeramente. Este es el mecanismo detrás de la mayoría de los misterios de «la puntuación bajó sin que cambiáramos nada».

## Crédito parcial — qué significa realmente

Muchas recomendaciones de Secure Score otorgan **crédito parcial** basado en cuán completamente ha implementado el tenant la recomendación. El porcentaje que ves en una recomendación en el portal — pongamos «8,5 / 10 puntos obtenidos» — típicamente refleja la implementación parcial.

El patrón de crédito parcial más habitual es la **cobertura por usuario**. La recomendación «Exigir MFA para todos los usuarios» no se activa simplemente con un interruptor; escala con qué fracción de tus usuarios tiene realmente MFA aplicado. Si tienes 40 usuarios y 36 están aplicados, ganas 36/40 de los puntos máximos de la recomendación. Los cuatro usuarios restantes (el ejecutivo que insistió en una excepción, la cuenta de servicio, los dos contratistas que se te olvidaron) te cuestan puntos parciales.

Otros patrones de crédito parcial:

- **Cobertura por política.** «Asegurar que todas las políticas antiphishing usen mailbox intelligence» otorga crédito completo solo si *cada* política antiphishing en el tenant tiene la función habilitada — crédito parcial para las políticas que sí.
- **Basado en umbral.** Algunas recomendaciones miden valores que tienen que alcanzar un umbral. «Asegurar que tu política de riesgo de inicio de sesión esté habilitada» podría otorgar crédito parcial basado en cuánto de la base de usuarios cubre la política.
- **Basado en tiempo.** Un puñado de recomendaciones comprueba que los registros de auditoría se retengan durante al menos N días — crédito parcial si estás reteniendo menos de la duración recomendada.

Esto importa para dos flujos de trabajo del operador:

**Leer una recomendación correctamente.** Cuando ves una recomendación que muestra el 80 % de su máximo, eso no es «lo intentamos pero más o menos fallamos». Es probablemente «hemos cubierto el 80 % de los objetivos y cuatro usuarios / políticas / configuraciones específicas están sin cubrir». Profundizar en la recomendación en el portal típicamente revela exactamente qué subconjunto falta.

**Mover la puntuación de forma eficiente.** Cuando estés planificando la siguiente pasada de trabajo de seguridad para un cliente, las recomendaciones con crédito parcial son a menudo la fruta más al alcance de la mano. Una recomendación al 8,5/10 puede que solo necesite que apliques MFA en una cuenta de servicio más para reclamar los 1,5 puntos restantes. Es un cambio de cinco minutos para un movimiento medible de puntuación. Detectarlas es parte del trabajo de la lección 3.

## Recomendaciones limitadas por licencia y el flujo «Risk accepted»

Microsoft Secure Score incluye recomendaciones que requieren licencias específicas para implementar. Ejemplos:

- **Despliegue de Defender for Identity** (requiere Defender for Identity por separado o E5 con el paquete).
- **Customer Lockbox** (E5).
- **Políticas de etiquetado automático y clasificación de datos** (Information Protection P2 / E5 Compliance).
- **Políticas de riesgo de inicio de sesión** (Entra ID P2).
- **Políticas de riesgo de usuario** (Entra ID P2).
- **Insider Risk Management** (E5).
- **Attack Simulation Training** (E5).

Aquí está la parte que pilla a los operadores por sorpresa: **estas recomendaciones siguen apareciendo en la lista de recomendaciones del tenant y siguen contribuyendo al denominador máximo incluso cuando el tenant no tiene la licencia requerida**. Abre la Secure Score de un tenant de Business Premium en el portal de Defender y verás Defender for Identity, Customer Lockbox, etiquetado automático y otros elementos limitados a E5 sentados en la lista con `0 / X puntos` al lado. Están arrastrando el porcentaje hacia abajo a pesar de no poder implementarse en Business Premium.

Microsoft da a los operadores tres estados alternativos para manejar recomendaciones que no pueden o no quieren implementar:

- **« Resolved through third party » (resuelto mediante un tercero).** Úsalo cuando una herramienta no-Microsoft maneje la misma función de seguridad. Microsoft otorga puntos completos por la recomendación como si la hubieras implementado. Casos de uso honestos: un MDR de terceros cubriendo la función de Defender-for-Identity; un producto de DLP de terceros cubriendo la recomendación de etiquetado de Microsoft. Casos de uso deshonestos — y los operadores lo hacen — son marcar cosas como «third party» sin que nada esté proporcionando realmente la función. La puntuación sube, la seguridad no.

- **« Risk accepted » (riesgo aceptado).** Úsalo cuando has revisado la recomendación y decidido no implementarla (a menudo porque la licencia no está ahí, o el perfil de riesgo del cliente no justifica el coste operativo). La recomendación se queda en el máximo en cero puntos, pero queda documentada como una decisión deliberada en lugar de un elemento sin atender. Encuadre honesto en conversaciones con el cliente: «revisamos esto, aquí está por qué aceptamos el riesgo».

- **« Planned » (planificado).** Úsalo cuando te has comprometido a implementar en un plazo pero aún no lo has hecho. No se otorgan puntos, pero la recomendación queda marcada como trabajo en cola.

Para la mayoría de los tenants de Business Premium, **la mayoría de las recomendaciones limitadas por licencia se marcan como Risk accepted** — el cliente no tiene la licencia, el MSP ha documentado la decisión, y la recomendación ya no se lee como «descuidada». El porcentaje de Secure Score no sube al aceptar el riesgo; sube la documentación.

El flujo de Risk Accepted es parte de la higiene del operador. Periódicamente (la lección 6 cubre la cadencia) revisa la lista de Risk Accepted y confirma que el razonamiento sigue siendo válido. Si un cliente más tarde se actualiza a E5, varios elementos de Risk Accepted pasan a ser implementables y el operador debería revisar las decisiones. Si el perfil de riesgo de un cliente cambia, lo mismo.

**Por qué esto importa para la comparación entre tenants.** Dos tenants de Business Premium pueden tener configuraciones idénticas pero Secure Scores distintas dependiendo de cuántas recomendaciones haya marcado el operador como Risk accepted o Resolved through third party. Un tenant donde el operador haya hecho el trabajo de higiene de Risk Accepted mostrará un porcentaje más bajo pero más honesto que un tenant donde elementos sin licencia y sin tocar están en cero sin ninguna decisión registrada. Usa el porcentaje como punto de partida para la conversación sobre *qué hizo el operador con cada recomendación* — no como una cifra de comparación directa.

## El desglose por categoría

Bajo el porcentaje de cabecera, Microsoft desglosa la puntuación en categorías — típicamente Identidad, Dispositivos, Aplicaciones y Datos. Cada categoría tiene su propio subtotal: puntos obtenidos vs máximo posible dentro de esa categoría.

La vista por categoría es útil con fines diagnósticos. Un cliente con una puntuación global del 88 % podría tener:

- Identidad al 95 % (MFA, auth heredada, protección de admin todo en buena forma)
- Dispositivos al 92 % (plantillas de Intune bien desplegadas)
- Aplicaciones al 78 % (configuraciones del lado del correo parcialmente ausentes)
- Datos al 65 % (DLP, etiquetas de sensibilidad sin tocar — habitual para tenants de Business Premium que no tienen la licencia)

Leer las categorías te dice *dónde* vive la puntuación y *dónde* están las brechas. Un operador haciendo revisión previa a renovación puede usar el desglose por categoría para enfocar el trabajo del siguiente trimestre — «Identidad está sólida, Aplicaciones es de donde viene la ganancia del próximo trimestre» — en lugar de tratar el porcentaje de cabecera como la única señal.

## Por qué la puntuación se mueve sola — las seis razones más habituales

Volvamos a la anécdota de apertura. La caída del lunes por la mañana del 88,79 % al 86,94 % sin ningún cambio del lado del tenant. Seis explicaciones plausibles:

**1. Se detectó una nueva vulnerabilidad en software instalado.** Para clientes con Defender for Endpoint desplegado, Microsoft Defender Vulnerability Management (MDVM) alimenta a Secure Score. Cuando se anuncia un nuevo CVE que afecta a software que se ejecuta en un terminal gestionado — una actualización de Windows, una versión de Chrome, un release de Acrobat Reader, el cliente SQL en el servidor de archivos — la puntuación baja hasta que se despliegue el parche. Esta es la causa *más frecuente* de caídas de puntuación de la noche a la mañana en tenants con MDE desplegado, porque el mundo produce nuevos CVE constantemente y los parches van por detrás de la detección por días. La buena noticia: cuando el RMM ejecuta su ciclo de parcheo y el software vulnerable se actualiza, los puntos vuelven.

**2. Microsoft añadió una nueva recomendación.** Microsoft introduce nuevas recomendaciones a medida que el panorama de seguridad evoluciona — un nuevo patrón de amenaza, una nueva función de Defender, un nuevo requisito de cumplimiento. La nueva recomendación contribuye al máximo (el denominador sube); el tenant todavía no la ha implementado (numerador sin cambios); el porcentaje baja. El historial de cambios de Secure Score del portal de Microsoft 365 Defender muestra qué se añadió.

**3. Microsoft retiró o reponderó una recomendación existente.** Menos común pero real. Una recomendación que Microsoft considera obsoleta se elimina; el máximo se encoge; el porcentaje se mueve. Una recomendación se repondera (el valor en puntos cambia); mismo efecto.

**4. Las licencias del tenant cambiaron.** Si el cliente añadió o quitó licencias durante el fin de semana (un nuevo empleado activado, una baja desactivada, un cambio de SKU de licencia), el conjunto aplicable de recomendaciones se desplazó, y el máximo se movió en consecuencia.

**5. La configuración del tenant cambió del lado de Microsoft.** Algunas recomendaciones comprueban configuración que Microsoft gestiona o para la que Microsoft actualiza los valores por defecto. Cuando Microsoft endurece o afloja un valor por defecto, las recomendaciones que puntúan contra ese valor por defecto pueden moverse.

**6. La configuración del tenant cambió del lado del operador.** Bien deliberada (deriva que deberías investigar vía el Tenant Change Log y las alertas de deriva de Panoptica365) o accidental (alguien deshabilitó algo que no debería). Este es el caso en el que la puntuación te está diciendo algo sobre *tu* cliente específicamente.

Cuando la puntuación se mueve y no puedes explicarlo desde los casos 4 y 6 (las causas del lado del tenant que controlas), la respuesta es casi siempre 1, 2, 3 o 5 — del lado de Microsoft. El historial de cambios de Secure Score en el portal de Defender es donde lo confirmas.

## Verificación con el portal de Microsoft Defender

Cuando la puntuación se mueve inesperadamente, el flujo de diagnóstico es:

1. **Abrir el portal de Microsoft 365 Defender** del cliente (`security.microsoft.com` → Secure Score).
2. **Mirar la pestaña History.** Microsoft muestra los cambios recientes de puntuación con los deltas subyacentes a nivel de recomendación.
3. **Para cualquier recomendación que cambió de estado:** haz clic en ella. Lee la descripción, el historial de acciones, el detalle por objetivo (si es una recomendación por usuario/por política con crédito parcial).
4. **Cruza la información con el Tenant Change Log de Panoptica365** para confirmar si el cambio vino del lado del operador o del de Microsoft.

Esto es trabajo por tenant. No hay una vista «qué cambió en los 30 clientes esta semana» en el portal de Microsoft; cada cliente se investiga individualmente cuando su puntuación se mueve lo suficiente como para justificar una mirada.

## Lo que esto significa para el operador

Tres puntos para llevarte.

**El movimiento de la puntuación suele ser del lado de Microsoft, no del lado del cliente.** Una Secure Score que baja sin ningún cambio del lado del tenant es más a menudo una nueva vulnerabilidad apareciendo en un terminal gestionado (el ciclo de parcheo se pone al día; los puntos vuelven), o Microsoft añadiendo / reponderando una recomendación. Comprueba la pestaña History en el portal de Defender antes de asumir que la seguridad del cliente realmente ha retrocedido.

**El crédito parcial es amigo del operador.** Las recomendaciones al 80-95 % de su máximo suelen estar a uno o dos cambios dirigidos del crédito completo. Trabajar esas es el camino más eficiente al movimiento de puntuación. Las recomendaciones al 0 % suelen ser los elementos arquitectónicos más grandes que requieren más trabajo.

**Las recomendaciones limitadas por licencia se quedan en el máximo — gestionarlas vía Risk Accepted es parte de la higiene del operador.** La Secure Score de un cliente de Business Premium incluye recomendaciones exclusivas de E5 (Defender for Identity, Customer Lockbox, etiquetado automático, etc.) sentadas en cero puntos. El trabajo del operador es decidir qué hacer con cada una: implementar (si es posible), Resolved through third party (si una herramienta cubre la función), Risk accepted (con razón documentada), o Planned (si está programada). Los elementos limitados por licencia sin tocar arrastran la puntuación hacia abajo sin aportar valor de seguridad — las decisiones explícitas de Risk Accepted hacen que el porcentaje se lea de forma más honesta y crean el rastro de auditoría que los clientes quieren en la renovación.

## Lo que viene

- **Lección 3: Mapeando el curriculum a la puntuación.** Qué recomendaciones del catálogo de Microsoft corresponden al trabajo que ya has hecho en las tarjetas 3, 4 y 5 — y la media docena de alto impacto que impulsa la mayor parte de la puntuación para un cliente pyme.
- **Lección 4: Dónde Secure Score induce a error.** Los puntos ciegos, la trampa de manipular la puntuación, y el trabajo que no aparece en ninguna cifra.

Por ahora: elige al cliente cuya puntuación más te desconcierte. Abre el portal de Defender para ese tenant. Lee la pestaña History. La mayor parte del tiempo, lo que parecía deriva es en realidad Microsoft moviendo la portería — y leer la puntuación bajo esa luz cambia cómo actúas sobre ella.

---

*Fuentes de los datos en esta lección — Microsoft Learn sobre cómo se calcula Microsoft Secure Score ([Microsoft Learn — How Secure Score is calculated](https://learn.microsoft.com/en-us/defender-xdr/microsoft-secure-score-improvement-actions)); mecánica del crédito parcial y la puntuación de recomendaciones ([Microsoft Learn — Track your Microsoft Secure Score history](https://learn.microsoft.com/en-us/defender-xdr/microsoft-secure-score-history-metrics-trends)); datos y categorías de Secure Score ([Microsoft Learn — Microsoft Secure Score overview](https://learn.microsoft.com/en-us/defender-xdr/microsoft-secure-score)); recomendaciones limitadas por licencia y permisos requeridos ([Microsoft Learn — Required licenses and permissions](https://learn.microsoft.com/en-us/defender-xdr/microsoft-secure-score-required-permissions)); referencia de la API de Secure Score para acceso programático ([Microsoft Learn — Secure Score API in Graph](https://learn.microsoft.com/en-us/graph/api/resources/securescore)).*
