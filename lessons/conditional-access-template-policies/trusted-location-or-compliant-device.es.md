---
title: "Ubicación de confianza O dispositivo conforme — la política geográfica inteligente"
subtitle: "Sustituye el bloqueo por país y sus exclusiones por una política geo que confía en el dispositivo, no la ubicación."
icon: "map-pin"
last_updated: 2026-05-29
---

# Ubicación de confianza O dispositivo conforme — la política geográfica inteligente

Un MSP que auditamos recientemente tenía una política de Acceso Condicional en el tenant de un cliente que decía, llanamente, «bloquear inicio de sesión desde fuera de Canadá». Se había desplegado hacía dos años. La lista de exclusiones había crecido a treinta y ocho entradas.

España (para las vacaciones del contralor en 2023).
Estados Unidos (para el comercial que viaja a ferias).
Francia (para la visita familiar del ejecutivo, configurada hace un año).
México (para el viaje invernal del contable).
Italia (todavía activa desde hace dos veranos, cuando el CFO visitó a la familia durante tres semanas).

La mayoría de esas exclusiones estaban obsoletas. El comercial no había ido a una feria en EE. UU. en ocho meses pero la excepción de EE. UU. seguía en vigor. La exclusión de España era para un contratista que ya no trabajaba allí. La exclusión de Italia existía porque nadie se acordó de quitarla.

Cada exclusión era un agujero en la política geográfica. Juntas equivalían a «la política geo está activada, pero todo el hemisferio occidental más la mayor parte de Europa está excluida para varios usuarios por duraciones desconocidas». Cualquier seguridad que la política se suponía proporcionar había sido silenciosamente sacrificada un ticket de helpdesk a la vez.

Esta lección es la política que no acumula ese tipo de deuda.

**Panoptica365 - Only allow access from Canada.** Descripción: *Inicios de sesión solo desde Canadá o desde dispositivos conformes.* Concesión: Ninguna (bloquear). Usuarios: Todos los usuarios. Aplicaciones: Todas las aplicaciones en la nube. Condiciones: Ubicaciones = 1 ubicación (la ubicación nombrada «Canadá»).

El título de la lección dice «Canadá» porque ese es el valor por defecto; en la práctica esta es la plantilla para *cualquier* patrón ubicación-de-confianza-más-dispositivo-conforme. Cubriremos la personalización geográfica más adelante en la lección.

## El patrón OR es el punto entero

La mayoría de las herramientas de seguridad MSP entregan una plantilla «bloquear fuera de ubicación de confianza» que parece directa: definir una ubicación nombrada, y bloquear inicios de sesión desde cualquier otro lugar. Simple, defendible, encaja con el modelo de seguridad.

También crea el problema de acumulación de excepciones. Cada viajero es una excepción. Cada contratista es una excepción. Cada vacación de un ejecutivo es una excepción. Las excepciones se acumulan, nunca se eliminan, y la política se convierte silenciosamente en una defensa tan delgada como el papel.

La plantilla de Panoptica365 no usa ese patrón. Usa **(ubicación-de-confianza) O (dispositivo-conforme)**. El control de concesión está configurado de forma que un inicio de sesión satisface la política si *cualquiera* de las condiciones es verdadera:

- El inicio de sesión es desde una ubicación nombrada de confianza (las IPs de la oficina, el rango de país, lo que hayas definido), O
- El dispositivo del usuario está marcado como conforme en Intune.

Ambas condiciones prueban la misma intención subyacente — el usuario ha demostrado que está operando desde un contexto fiable — y cualquiera es suficiente. Fallar ambas significa que la política deniega el inicio de sesión.

La consecuencia: los viajeros en portátiles gestionados no disparan la política, porque su dispositivo satisface el OR. Los viajeros en dispositivos personales *sí* disparan la política. La distinción que la política aplica ya no es «canadiense o no»; es «contexto fiable o no». Esa es la distinción correcta.

## Qué significa esto en la práctica

Un comercial en un viaje el martes a Chicago:

- Política geo ingenua: bloqueado. Llamada al helpdesk. Excepción añadida para EE. UU. Excepción olvidada en seis semanas.
- Plantilla de Panoptica365: no bloqueado si su portátil gestionado está inscrito en Intune y conforme. No se necesita excepción. No hay llamada al helpdesk.

Un usuario en su teléfono personal intentando iniciar sesión en Outlook mientras visita familia en París:

- Política geo ingenua: bloqueado. Llamada al helpdesk. Excepción añadida para Francia. Excepción olvidada.
- Plantilla de Panoptica365: bloqueado (porque el teléfono personal no es conforme). El usuario puede volver al portátil gestionado, o esperar hasta estar de vuelta en casa. *No se añadió excepción; no se acumuló deuda de seguridad.*

Un atacante nuevo intentando iniciar sesión en la cuenta de un usuario desde Europa del Este:

- Política geo ingenua: bloqueado. Con éxito.
- Plantilla de Panoptica365: bloqueado (el dispositivo del atacante no es conforme; la ubicación del atacante no es de confianza). Con éxito.

La política aplica la misma frontera de seguridad que el cliente quería — los inicios de sesión están restringidos a contextos fiables — sin la deuda operativa.

## Qué asume la plantilla

Para que el patrón de condición OR funcione, **el cumplimiento de Intune tiene que estar en su sitio y ser fiable.** Si el cliente no tiene Intune (Business Standard o inferior), o tiene Intune pero no ha inscrito dispositivos o configurado políticas de cumplimiento, entonces el camino «dispositivo-conforme» del OR está efectivamente vacío. Cada inicio de sesión cae al chequeo de ubicación, la política se comporta como un bloqueo geo ingenuo, y la acumulación de excepciones vuelve.

Así que los prerrequisitos:

- **Intune Plan 1 o superior** (línea base de Business Premium).
- **Políticas de cumplimiento configuradas** para las plataformas de dispositivos que usa el cliente (Windows, iOS, Android, macOS).
- **Dispositivos inscritos** — una fracción significativa de la base de usuarios en dispositivos gestionados.
- **Evaluación de cumplimiento funcionando** — los dispositivos reportan conformes cuando deberían serlo.

La tarjeta 4 (ajustes de plantillas de Intune) cubre el lado del cumplimiento en detalle. Para la plantilla de AC aquí, el operador necesita verificar que el cumplimiento es fiable antes de pasar la política de solo informe a Habilitado. El pre-despliegue (lección 1) lo cubre.

## El predeterminado de Canadá es solo un predeterminado — personaliza por cliente

La plantilla entregada nombra «Canadá» porque Panoptica365 fue construido originalmente en un contexto MSP canadiense. Para clientes no canadienses, la ubicación nombrada necesita personalizarse:

- Un MSP que sirve a clientes en México define una ubicación nombrada «México» con los rangos de IP relevantes y el código de país, e importa una versión personalizada de esta plantilla con esa ubicación seleccionada.
- Un MSP francés define «Francia» o «UE» dependiendo de los patrones de viaje.
- Un MSP multi-región con clientes de EE. UU. y Canadá puede tener plantillas separadas por región.

La mecánica de personalización está cubierta en la lección 8 (Importar tus propias plantillas de AC). Por ahora: el *concepto* de la plantilla es portable. La ubicación es parametrizada. El patrón de condición OR sigue siendo el mismo independientemente de la geografía.

## Qué decide el operador en el despliegue

Cuando despliegas esta plantilla, el operador responde a cuatro preguntas:

**1. ¿Cuál es la ubicación de confianza?**

Para la mayoría de los clientes, es su país, definido como el código de país (Microsoft mantiene los mapeos país-a-IP). Para clientes con ubicaciones de oficina específicas solamente, son los rangos de IP de la oficina como ubicaciones nombradas separadas. Para clientes multi-región, múltiples ubicaciones nombradas.

La ubicación de confianza debería ser el lugar donde se origina *la vasta mayoría* de los inicios de sesión legítimos. Si tu cliente hace negocios en múltiples países, define cada uno. Si tiene trabajadores remotos que genuinamente trabajan desde cualquier sitio, el camino basado en ubicación es menos útil y te apoyas más en el camino dispositivo-conforme.

**2. ¿A quién cubre?**

Por defecto: todos los usuarios. Misma lógica que Exigir MFA para todos los usuarios (lección 2). Los usuarios reales están cubiertos; las cuentas de servicio se excluyen por nombre con justificación documentada.

**3. ¿Cuáles son las aplicaciones?**

Por defecto: todas las aplicaciones en la nube. La política se aplica a cada inicio de sesión independientemente de la aplicación. No hay buena razón para limitarlo más estrictamente para la mayoría de los clientes.

**4. ¿Funciona realmente el cumplimiento de Intune?**

Si la respuesta es «sí», despliega la plantilla tal como se entrega.

Si la respuesta es «no, pero lo hará pronto», despliega con el cumplimiento de Intune todavía en proceso de despliegue y acepta que hasta que el cumplimiento esté en su sitio, el camino OR está vacío y la política se comporta como un bloqueo geo estricto. Pon un recordatorio en el calendario para verificar después del despliegue de Intune.

Si la respuesta es «no, y no lo será pronto» (porque el cliente no ha comprado licencias de Intune), entonces esta plantilla es la elección equivocada para este cliente. Usa Exigir MFA para todos los usuarios (lección 2) y acepta que el contexto geográfico no se aplica.

## Despliegue

Esta plantilla se despliega en estado Habilitado. Para tenants de pequeña empresa sin ejecutivos que viajen internacionalmente y con una postura fiable de cumplimiento de Intune, despliega y monitoriza de cerca — el inventario pre-despliegue debería haber pillado las excepciones típicas.

Para tenants con viajeros internacionales frecuentes o donde el cumplimiento de Intune todavía se está desplegando, el paso manual de solo informe en el portal de Entra es recomendable. La razón: los patrones de viaje se esconden en ciclos mensuales y trimestrales. Una ventana de 3 días se pierde al ejecutivo que visita a la familia cada seis semanas. Presupuesta una ventana de solo informe de 14 días si tomas ese camino.

Durante la ventana de verificación (ya sea solo informe o monitorización en vivo después del despliegue), busca bloqueos y clasifica cada uno:

- Viaje fuera de ubicación de confianza en un dispositivo conforme → la política *no* los habría bloqueado (bien — el patrón OR está haciendo su trabajo).
- Viaje fuera de ubicación de confianza en un dispositivo no conforme → bloqueado. ¿Fue un viaje legítimo? Si sí, el usuario necesita estar en un dispositivo gestionado, o este usuario es candidato a exclusión. Si el patrón de viaje es raro, planea gestionarlo vía exención con fecha de retiro; si es frecuente, este usuario necesita un dispositivo inscrito en Intune.
- Inicio de sesión desde fuera de ubicación de confianza, sin buena explicación → potencial atacante. Investiga.

Arregla exclusiones para viajeros legítimos sin dispositivo gestionado (con fechas de retiro en Panoptica365). Aborda los problemas de cumplimiento de dispositivo para usuarios que deberían estar en dispositivos gestionados pero no lo están.

## Qué monitorizar después de la aplicación

**Inicios de sesión bloqueados por esta política.** Debería ser raro en régimen permanente. Cada bloqueo es una oportunidad de preguntar: ¿fue un ataque real, o un usuario legítimo sin dispositivo conforme? El dónut de Actividad Diaria saca los bloqueos de AC en casi-tiempo-real.

**La lista de exclusiones.** Debería ser estable. Nuevas entradas apareciendo sin tu conocimiento significa que alguien — otro admin, un técnico de helpdesk, un usuario GDAP delegado — está añadiendo excepciones. Investiga. La pista de auditoría de Panoptica365 saca a la superficie quién, cuándo, y por qué para cada mutación de política.

**Cambios de IP de ubicación de confianza.** Si la IP de la oficina del cliente cambia (migración de ISP, apertura de oficina sucursal), la definición de ubicación nombrada necesita actualizarse. Hasta que se actualice, los inicios de sesión legítimos desde la nueva IP serán tratados como ubicación-no-de-confianza. La primera queja después de una mudanza de oficina suele ser esta.

## Qué ve Panoptica365

Tres categorías de señales:

**Inicios de sesión exitosos desde IP extranjera** — cuando el camino de ubicación-de-confianza de la política falló pero el camino dispositivo-conforme tuvo éxito. No es un problema (es la política funcionando), pero es una señal que vale la pena saber — el usuario está viajando.

**Inicios de sesión bloqueados desde IP extranjera** — el dónut de Actividad Diaria muestra el conteo de bloqueos de AC. Bajo en régimen permanente; un pico súbito sugiere un intento de credential stuffing contra este cliente.

**Deriva en la definición de ubicación nombrada.** Si la lista de IPs o de países de la ubicación nombrada cambia de forma inesperada, Panoptica365 alerta. Esta es una forma silenciosa de atacar una política — ampliar la ubicación de confianza hasta que la IP del atacante encaje dentro de ella.

## El patrón retirado, nombrado explícitamente

Muchos MSPs (nosotros incluidos, en iteraciones anteriores de esta plantilla) entregaban una plantilla de bloqueo geo ingenuo. Ya no lo hacemos, por las razones de arriba. La anécdota de auditoría del comienzo de esta lección es real, reciente, y no inusual. Si heredas un cliente que tiene el patrón antiguo en su sitio — un bloqueo geo estricto con una lista larga de exclusiones — el movimiento correcto es:

1. Inventariar las exclusiones existentes.
2. Identificar cuáles nunca fueron necesarias en primer lugar (usuarios que se fueron hace tiempo, proyectos completados).
3. Para las legítimas restantes, verificar la cobertura de Intune y migrar a esos usuarios a dispositivos conformes.
4. Reemplazar el bloqueo geo ingenuo por esta plantilla.
5. Retirar la lista de exclusiones — debería estar vacía después de la migración, excepto por cuentas de servicio documentadas.

Esta es una de las limpiezas de mayor palanca que puedes hacer en un tenant heredado. La postura de seguridad antes/después es dramáticamente diferente aunque la *intención* de ambas políticas sea la misma.

## Lo que esto significa para el operador

Tres puntos para llevarte.

**La condición OR es la lección.** Cada vez que veas una política que tenga una sola comprobación binaria (solo ubicación, solo dispositivo, solo MFA), pregúntate si una condición OR serviría la misma intención de seguridad con menos carga operativa. A menudo lo hará. La plantilla de esta lección es el ejemplo canónico; el mismo patrón aparece en la lección 5.

**No añadas exclusiones geográficas a esta plantilla.** Si un usuario realmente está viajando y está en un dispositivo no conforme, la respuesta correcta es «tu dispositivo necesita ser conforme», no «déjame añadir Italia a la lista de excepciones». El punto entero de la condición OR es hacer innecesarias las exclusiones. Añadir exclusiones deshace el diseño.

**Verifica que el cumplimiento de Intune sea real antes de desplegar.** Si el cumplimiento no funciona, esta plantilla degenera en un bloqueo geo ingenuo. El pre-despliegue de la lección 1 cubre la verificación de Intune; no te lo saltes.

## Lo que viene

- **Lección 5: Dispositivo conforme O híbrido O MFA.** La aplicación más amplia del patrón de condición OR — tres señales de confianza como caminos alternativos. Mismo principio de diseño, mayor alcance.
- **Lección 8: Importar tus propias plantillas de AC.** Cómo un MSP fuera de Canadá personaliza la ubicación nombrada de esta plantilla para su propia geografía.

Por ahora: esta es la plantilla que reemplaza el patrón de acumulación de excepciones. Hereda un tenant con un bloqueo geo ingenuo, migra a esta plantilla, y la postura de AC del cliente se vuelve silenciosamente más segura *y* menos trabajo de operar. Ambas cosas importan.

---

*Fuentes de los datos en esta lección — Microsoft Learn sobre ubicaciones nombradas en Acceso Condicional ([Microsoft Learn — Conditional Access: Locations](https://learn.microsoft.com/en-us/entra/identity/conditional-access/concept-assignment-network)); semántica de concesión OR en Acceso Condicional ([Microsoft Learn — Conditional Access: Grant](https://learn.microsoft.com/en-us/entra/identity/conditional-access/concept-conditional-access-grant)); señal de cumplimiento de dispositivo de Intune en Acceso Condicional ([Microsoft Learn — Device compliance](https://learn.microsoft.com/en-us/mem/intune/protect/device-compliance-get-started)).*
