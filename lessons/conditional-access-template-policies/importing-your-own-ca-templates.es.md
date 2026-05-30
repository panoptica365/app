---
title: "Importar tus propias plantillas de AC — el superpoder de Panoptica365"
subtitle: "Exporta cualquier política de AC de un tenant de Entra, añádela a Panoptica365 y despliégala en tu flota."
icon: "upload"
last_updated: 2026-05-29
---

# Importar tus propias plantillas de AC — el superpoder de Panoptica365

La mayoría de las herramientas de plantillas de AC tratan las plantillas como un regalo del proveedor. El proveedor entrega una biblioteca; tú despliegas lo que está en la biblioteca; si quieres algo distinto, esperas a que el proveedor lo añada. El cliente en México no puede usar una plantilla bloqueada a Canadá. El ingeniero senior que construyó una política de AC brillante en el tenant de un cliente no puede compartirla fácilmente con el resto del MSP. La biblioteca de plantillas es un catálogo cerrado.

Panoptica365 está construido de forma distinta. Cualquier política de Acceso Condicional que exista en cualquier tenant de Entra — el tenant de tu propio MSP, el tenant de un cliente específico, el tenant de un socio — puede exportarse e importarse a Panoptica365 como una plantilla personalizada. Desde ahí, se despliega a cada tenant de cliente en tu flota de la misma forma que las plantillas entregadas.

Esta es la característica de la plataforma que convierte la biblioteca de plantillas de AC de «lo que Panoptica365 pensó» en «lo que tu MSP y tus ingenieros senior saben sobre tus clientes». Es también el mecanismo que hace posible la personalización geográfica de la lección 4 — el MSP mexicano no espera a que Panoptica365 entregue una plantilla México; la construyen y la importan.

Esta lección es el flujo de trabajo para eso — cuándo usarlo, cómo funciona, qué vigilar.

## Cuándo importar una plantilla personalizada

Cinco escenarios donde importar tiene sentido:

**1. Personalización geográfica.** La plantilla «Permitir acceso solo desde Canadá» de la lección 4 necesita convertirse en «Permitir acceso solo desde México» para un MSP basado en México, «Permitir acceso solo desde Francia / UE» para un MSP francés, etc. El patrón de condición OR sigue siendo el mismo; la ubicación nombrada cambia. La importación es el mecanismo de personalización.

**2. Una política personalizada que construiste en algún lugar y quieres reutilizar en todas partes.** Un ingeniero senior del MSP construyó una política de AC ingeniosa para un cliente — digamos, una política que exige MFA resistente al phishing específicamente para usuarios del departamento de Finanzas, con exclusiones cuidadosamente afinadas para el dispositivo móvil del empleado de cuentas por pagar. En lugar de reconstruir esa política a mano para cada tenant de cliente, exporta desde el original, importa como plantilla, despliega a través de la flota.

**3. Un requisito regulatorio que necesita una política no-predeterminada.** Un cliente en una industria regulada (salud, finanzas, contratación gubernamental) puede necesitar políticas de AC que la biblioteca estándar no incluye — una política específica de frecuencia de sesión para acceder a PII, por ejemplo, o una política que aplique una fortaleza de autenticación particular a aplicaciones específicas. Constrúyela una vez para el cliente regulado, impórtala como plantilla, despliégala a través de otros clientes similares.

**4. Una respuesta a un compromiso específico o un casi-incidente.** Después de que un cliente tuviera un incidente AiTM, apretaste su política de AC para exigir dispositivo conforme + MFA resistente al phishing para aplicaciones sensibles. Te gustaría esa misma postura endurecida para otros clientes en la misma industria. La importación es el mecanismo para ese flujo de trabajo de «extender buena política».

**5. Una nueva amenaza que requiere una nueva política.** Microsoft anuncia una nueva técnica de ataque, tu equipo de seguridad diseña una política de AC que la aborda, la construyes una vez y necesitas desplegarla a través de treinta tenants. La importación es más rápida que recrearla treinta veces.

El patrón en los cinco: una política existe en algún lugar, quieres que exista en otro lugar, la plataforma hace la transferencia trivial.

## Cómo funciona la importación

El flujo de trabajo de alto nivel:

1. **Exportar desde un tenant origen.** En el módulo de AC de Panoptica365, selecciona el tenant origen y elige exportar las políticas de Acceso Condicional. Panoptica365 lee las políticas de Entra ID vía la API Graph y produce una representación JSON estructurada.

2. **Elegir qué políticas importar.** La exportación normalmente contiene todas las políticas de AC del tenant origen. Tú seleccionas las políticas específicas que quieres traer como plantillas — normalmente una o dos, no todas.

3. **Generalizar los GUIDs específicos del tenant.** Este es el paso técnicamente interesante. Las políticas de Acceso Condicional referencian usuarios, grupos, y ubicaciones nombradas por GUID — y esos GUIDs son únicos para el tenant origen. Una política «Bloquear desde fuera de Canadá» en el tenant A referencia el GUID de ubicación nombrada `abc-123` para «Canadá»; el tenant B tiene un GUID distinto para la misma ubicación nombrada. Si importaras la política cruda, referenciaría un GUID inexistente en el tenant B y la importación fallaría o produciría una política rota.

   Panoptica365 maneja esto sustituyendo tokens de marcador de posición en el momento de la importación. Los GUIDs específicos del tenant en la exportación origen se reemplazan con marcadores como `{NAMED_LOCATION_CANADA}`. Cuando la plantilla luego se despliega al tenant B, Panoptica365 resuelve el marcador contra los GUIDs reales de ubicación nombrada del tenant B. Si el tenant B tiene una ubicación nombrada que coincide con el marcador, el despliegue procede; si no, se le pide al operador que cree una o que la reasigne a una ubicación existente.

4. **Nombrar y describir la plantilla.** Dale un nombre y descripción de una línea estilo Panoptica365. La convención de nombres usada por las plantillas entregadas es `Panoptica365 - <nombre descriptivo>` — las plantillas personalizadas deberían seguir un patrón similar (`AcmeMSP - <nombre descriptivo>` o `<nombre del MSP> - <nombre descriptivo>`) para que sean distinguibles de las entregadas en la lista de políticas en los tenants de clientes.

5. **Guardar como plantilla en la biblioteca de Panoptica365.** Desde este punto, la plantilla se comporta como cualquiera de las plantillas entregadas — está disponible para desplegar a cualquier tenant de cliente, soporta el despliegue Solo-informe-luego-Habilitado, y aparece en el detector de deriva.

## La generalización de ubicaciones nombradas, específicamente

El ejemplo del MSP mexicano de la lección 4 es el caso canónico. Recorre lo que pasa mecánicamente:

El MSP exporta la plantilla «Permitir acceso solo desde Canadá» desde uno de sus tenants de clientes canadienses (o desde la vista de plantillas entregadas de Panoptica365, dependiendo del camino de exportación). La política referencia el GUID de ubicación nombrada `xyz-canada-789` y el código de país `CA`.

En el flujo de importación de Panoptica365, la referencia a ubicación nombrada se convierte en un marcador de posición. La plantilla ahora contiene algo como:

```
condition.locations.include = ["{TRUSTED_LOCATION}"]
```

El MSP nombra esta plantilla personalizada «AcmeMSP - Permitir acceso solo desde México» y la guarda.

Para cada tenant de cliente mexicano, el MSP primero crea una ubicación nombrada llamada «México» con el código de país México. Luego despliega la plantilla AcmeMSP. En el momento del despliegue, Panoptica365 resuelve `{TRUSTED_LOCATION}` contra las ubicaciones nombradas del cliente y usa el GUID para la entrada «México». La política se crea en el tenant del cliente con la referencia de ubicación correcta.

Si un tenant de cliente todavía no tiene una ubicación nombrada «México», el despliegue le pide al operador que cree una (o que mapee el marcador de posición a una ubicación nombrada existente distinta). El sistema no falla en silencio ni crea una política rota.

Esta es la característica de la plataforma que hace que la lección 4 funcione a través de geografías. El mismo mecanismo se aplica a cualquier otra referencia específica del tenant en una plantilla importada — grupos de usuarios, ubicaciones de acceso condicional, nombres de fortaleza de autenticación, etc.

## Qué se exporta y qué no

Vale la pena ser explícito: no todos los aspectos de una política de AC son portables.

**Cosas que se exportan limpiamente:**
- Nombre y estado de la política (Habilitada, Solo informe, Deshabilitada).
- Inclusiones/exclusiones de usuarios y grupos (por referencia; el mecanismo de marcador maneja la traducción de GUID).
- Objetivos de aplicación (por ID de app; los IDs de apps de primera parte de Microsoft son universales entre tenants).
- Condiciones: ubicaciones (vía marcadores), aplicaciones cliente, plataformas, niveles de riesgo de inicio de sesión, niveles de riesgo de usuario.
- Controles de concesión y controles de sesión.
- Referencias de fortaleza de autenticación (por nombre, lo cual es consistente entre tenants).

**Cosas que no se exportan de forma portable:**
- *Exclusiones específicas de usuario* por ID de usuario individual (el usuario no existe en el tenant de destino). La exportación captura el *grupo* que contiene al usuario, pero las exclusiones individuales usuario-por-GUID típicamente se eliminan o se marcan como no transferibles.
- *Atributos de seguridad personalizados* que existen solo en el tenant origen.
- *Historial de resultados de solo-informe* — eso es un artefacto de correr la política en el tenant origen, no parte de la plantilla.

El flujo de importación de Panoptica365 saca a la superficie cualquier elemento no portable durante el paso de importación. El operador decide si eliminarlo, generalizarlo, o aceptar la limitación.

## Cuándo *no* importar

Algunas advertencias honestas — importar no siempre es el movimiento correcto:

**La política está rota o mal afinada en el origen.** Si la política original ha acumulado basura (exclusiones olvidadas, objetivos obsoletos, métodos de autenticación deprecados), importarla extiende la basura a cada tenant de cliente. El movimiento correcto es limpiar la política origen primero, *luego* exportar e importar.

**La política es demasiado específica del cliente.** Algunas políticas de AC son profundamente específicas del entorno de un cliente — sus grupos de usuarios específicos, sus aplicaciones específicas, su estado de cumplimiento específico. Intentar generalizar una política así en plantilla puede producir algo que no funcione del todo para el cliente nuevo y requiera ajustes por despliegue. Si la personalización por despliegue es sustancial, la plantilla añade menos valor que simplemente desplegar ad-hoc.

**La política depende de características solo-E5 y el tenant de destino es Business Premium.** El AC basado en riesgo, las fortalezas de autenticación con requisitos resistentes al phishing, y las políticas conscientes de PIM a menudo asumen un tenant E5. Importarlas en un tenant de cliente Business Premium produce una política que no se aplica como se pretende (porque la señal subyacente no está disponible).

**La política está en la lista de exclusión del tenant origen por una razón obvia.** Si la política en el origen está actualmente deshabilitada o tiene una exclusión amplia porque algo no funcionó, esa es información sobre si la política está lo bastante madura como para extenderse. Importar una política que el cliente origen apagó porque estaba rompiendo cosas es solo extender la rotura.

El principio honesto: importa políticas que han sido validadas, son limpias, son portables, y que el operador entiende bien. Las plantillas importadas heredan la reputación de tu MSP. Las plantillas malas cuestan más de lo que ahorran las políticas buenas.

## Mantener plantillas personalizadas

Una plantilla personalizada necesita mantenimiento continuo — Microsoft cambia cosas, el entorno del cliente cambia, la política puede necesitar evolucionar. El MSP que importó la plantilla ahora es dueño de su ciclo de vida:

- **Cambios de esquema en Microsoft Graph.** Microsoft ocasionalmente renombra propiedades de AC o cambia el esquema JSON. Las plantillas importadas pueden necesitar actualización para seguir los cambios de esquema. El detector de deriva de AC de Panoptica365 cubre las plantillas entregadas; las plantillas personalizadas necesitan que el MSP verifique periódicamente.

- **Divergencia específica del cliente.** Cuando el entorno de un cliente cambia (añade Intune, fusiona una filial, se expande a una región nueva), la plantilla que funcionaba perfectamente hace seis meses puede necesitar ajuste. El patrón es el mismo que para las plantillas entregadas — la detección de deriva saca las diferencias, el operador las aborda.

- **Divergencia plantilla-vs-política-desplegada.** Con el tiempo, los despliegues individuales de clientes pueden derivar de la plantilla (un admin hace un ajuste por-tenant). El detector de deriva de Panoptica365 lo señala; el MSP decide si (a) actualizar la plantilla para que coincida con la divergencia, o (b) revertir la política del cliente para que coincida con la plantilla, o (c) aceptar la divergencia como personalización específica del cliente.

El costo de mantenimiento es real. Importar 15 plantillas personalizadas significa comprometerse a mantener 15 plantillas. La mayoría de los MSPs se benefician de un número pequeño de plantillas personalizadas cuidadosamente curadas en lugar de una colección grande no mantenida.

## La propuesta de valor del MSP

La línea individual que captura por qué importa: *la mejor política de AC de cada cliente puede convertirse en la política de AC de línea base de cada cliente*. La política brillante del ingeniero senior no se queda encerrada en el tenant de un cliente; el endurecimiento regulatorio no se reconstruye treinta veces; la respuesta post-incidente no tiene que inventarse dos veces.

La mecánica de la plataforma — exportar, generalizar, importar, desplegar — es la diferencia entre «el catálogo de Panoptica365» y «el catálogo de tu MSP, construido sobre los cimientos de Panoptica365». Para un MSP que se toma en serio el AC, esta es una de las características de producto con mayor palanca. Es por lo que las siete plantillas entregadas en la tarjeta 3 no son el techo — son el suelo, y el MSP construye encima.

## Despliegue para una plantilla personalizada

Igual que para cualquier plantilla entregada, con dos diferencias. Primero, un paso explícito de inspección pre-importación. Segundo, **el paso manual de solo informe en el portal de Entra está fuertemente recomendado para el primer despliegue de cualquier plantilla personalizada, sin importar el tamaño del tenant** — las plantillas importadas no están pre-validadas, y el operador no ha visto esta política específica aplicada antes.

0. **Inspección pre-importación.** Antes de importar, audita la política origen. ¿Está limpia? ¿Está bien afinada? ¿Es la versión de esta política que el cliente está usando ahora mismo (y con la que está contento), o es un borrador más antiguo? ¿Son todas las referencias portables, o hay exclusiones usuario-por-GUID codificadas que no se transferirán? Arregla cualquier problema en el origen antes de importar.
1. **Importar.** Saca la política del tenant origen. Resuelve los marcadores. Guarda como plantilla.
2. **Pre-despliegue en cada tenant de destino.** Igual que para las plantillas entregadas (lección 1). Confirma que las ubicaciones nombradas existen, break-glass excluida, etc.
3. **Día 0** — despliega vía Panoptica365 (crea la política en estado Habilitado). Abre inmediatamente el portal de Entra y cambia la política a solo informe.
4. **Días 1–N** — revisión de solo informe. N es más largo para políticas más complejas; presupuesta 7-14 días para una plantilla personalizada sustancial.
5. **Día N+1** — cambia la política de vuelta a Habilitada en el portal de Entra.

La ventana de solo informe más larga para plantillas personalizadas refleja la incertidumbre adicional. Una plantilla entregada ha sido validada contra muchos tenants; una plantilla importada ha sido validada contra solo el tenant origen. La ventana de verificación pilla las diferencias entre los entornos origen y destino.

Una vez que una plantilla personalizada ha sido desplegada a varios tenants de clientes y verificado que funciona limpiamente, los despliegues posteriores pueden seguir el flujo de plantilla entregada (desplegar directamente, saltarse el cambio manual a solo informe) — la validación se ha acumulado.

## Qué monitorizar después de la aplicación

Misma monitorización que para las plantillas entregadas, más una específica:

**Deriva de plantilla a través de la flota del MSP.** Cuando múltiples clientes tienen la misma plantilla personalizada desplegada, la divergencia individual crea una pregunta de deriva a nivel de flota — ¿debería actualizarse la plantilla para coincidir con la forma de despliegue más común, o deberían los clientes atípicos realinearse con la plantilla? Panoptica365 saca a la superficie ambos tipos de deriva.

El estado estable saludable es *divergencia cercana a cero* entre la plantilla y las políticas desplegadas. Una divergencia sustancial indica o bien (a) la plantilla necesita actualizarse, o (b) los despliegues se están modificando por cliente de formas que la plantilla no captura.

## Lo que esto significa para el operador

Tres puntos para llevarte.

**Las plantillas entregadas son el suelo, no el techo.** Trata las siete plantillas de Panoptica365 como el punto de partida para cualquier cliente. Construye las propias plantillas del MSP encima de ese suelo para cualquier necesidad regional, regulatoria o específica del cliente.

**Valida antes de extender.** Una plantilla importada mala multiplicada a través de treinta tenants de cliente es treinta políticas rotas. El paso de inspección pre-importación es el paso más importante del flujo de trabajo.

**Las plantillas personalizadas son una inversión, no una victoria gratis.** Cada una que importas requiere mantenimiento continuo. Mejor tener cinco plantillas personalizadas bien mantenidas que cincuenta obsoletas.

## Lo que viene

- **Lección 9: Operar AC a escala.** El cierre meta. Cómo evoluciona un conjunto de políticas de AC a lo largo de los años, cómo funciona la detección de deriva, cómo retirar exclusiones limpiamente, cómo el registro de auditoría de Panoptica365 hace tratable la operación a largo plazo.

Por ahora: el flujo de trabajo de importar plantillas es lo que convierte el módulo de AC de Panoptica365 de una biblioteca de proveedor en una biblioteca de tu MSP. Es la diferencia entre desplegar lo que entregamos y desplegar lo que tus ingenieros senior saben sobre tus clientes. Úsalo.

---

*Fuentes de los datos en esta lección — referencia de la API de Microsoft Graph para exportación/importación de políticas de Acceso Condicional ([Microsoft Learn — Conditional Access policy resource type](https://learn.microsoft.com/en-us/graph/api/resources/conditionalaccesspolicy)); ubicaciones nombradas de Acceso Condicional como objetos referenciados ([Microsoft Learn — Conditional Access: Locations](https://learn.microsoft.com/en-us/entra/identity/conditional-access/concept-assignment-network)); IDs de objetos de Microsoft Graph entre tenants ([Microsoft Learn — Object IDs and properties](https://learn.microsoft.com/en-us/graph/best-practices-concept)).*
