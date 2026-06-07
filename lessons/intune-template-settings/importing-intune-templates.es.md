---
title: "Importar tus propias plantillas de Intune — cuando la biblioteca empaquetada no basta"
subtitle: "Cómo importar plantillas de Intune personalizadas a Panoptica365 y desplegarlas en tenants de clientes junto a la biblioteca empaquetada."
icon: "upload"
last_updated: 2026-05-29
---

# Importar tus propias plantillas de Intune — cuando la biblioteca empaquetada no basta

La biblioteca de Intune de Panoptica365 envía 14 plantillas enfocadas en el endurecimiento de endpoints Windows, con señales de cumplimiento para iOS, Android y macOS. Es deliberado y casa con la realidad de la pequeña empresa: la mayoría de los dispositivos gestionados son Windows, móvil es mayoritariamente BYOD, macOS es minoría. Para el cliente típico de pequeña empresa, la biblioteca empaquetada cubre la superficie de configuración crítica para la seguridad.

Pero «pequeña empresa típica» no es toda pequeña empresa. Algunos clientes tienen:

- Un parque pesado de Android Enterprise (empresas de logística, negocios de servicio en campo) que necesita perfiles de configuración más allá de la señal de cumplimiento.
- Un entorno mayoritariamente macOS (agencias creativas, empresas de desarrollo de software) que necesita perfiles de configuración para FileVault, gatekeeper, actualizaciones de software, despliegue de aplicaciones.
- Requisitos específicos de industria que necesitan perfiles de configuración a medida — modos kiosko para dispositivos sanitarios, bloqueo en planta de fabricación, endurecimiento de punto-de-venta en retail.
- Plantillas internas maduras del MSP que el responsable senior de IT ha afinado durante años y quiere desplegar a través de toda la base de clientes.
- Baselines regulatorias (CIS, NIST, específicas de HIPAA) que necesitan desplegarse como plantillas de Intune junto a la biblioteca de Panoptica365.

Para todas estas, la respuesta es la misma: **importa tus propias plantillas de Intune** a la biblioteca de Panoptica365, despliégalas a través de los tenants de clientes de la misma forma en que se despliegan las plantillas empaquetadas.

Esta lección recorre ese flujo — el paralelo de la tarjeta 3 lección 8, adaptado a las particularidades de Intune.

## Cuándo importar una plantilla de Intune personalizada

Los mismos cinco escenarios que aplicaban a las plantillas de AC aplican aquí:

**1. Cobertura de plataforma que la biblioteca empaquetada no aborda.** Perfiles de configuración de Android Enterprise, políticas de configuración de aplicaciones de iOS, perfiles de configuración de macOS para FileVault y gatekeeper. Todos estos viven como plantillas exportables de Intune en cualquier tenant donde se hayan construido; pueden levantarse a Panoptica365.

**2. Una configuración de endurecimiento personalizada construida en un cliente que debería estar disponible para otros.** La configuración brillante de Windows de un ingeniero senior para un vertical de industria específico (imagen sanitaria, gestión de documentos legales, despachos de contabilidad) se exporta una vez, se generaliza, se importa como plantilla, se despliega a través de clientes similares.

**3. Baselines de marcos de cumplimiento.** Mapeos del CIS Microsoft 365 Foundations Benchmark, controles NIST 800-171, endurecimiento específico de HIPAA. Estos existen como perfiles de configuración detallados que pueden desplegarse vía Intune. Constrúyelos una vez para un cliente que los necesita; impórtalos como plantilla; despliega a otros clientes en el mismo cubo regulatorio.

**4. Respuesta a un incidente específico o un susto.** Tras un cliente que ha experimentado un incidente de robo de credenciales, construyes un conjunto más estricto de perfiles de configuración. Te gustaría que ese endurecimiento estuviera disponible para otros clientes con el mismo perfil de riesgo. Importar es el mecanismo.

**5. Nuevas amenazas que requieren nuevas configuraciones.** Microsoft anuncia una nueva técnica de ataque; tu equipo de seguridad construye una configuración de Intune que la aborda; necesitas desplegarla a través de treinta tenants. Constrúyelo una vez, impórtalo una vez, despliégalo treinta veces.

El patrón es idéntico al de AC: una plantilla existe en alguna parte, quieres que exista en otra parte, Panoptica365 hace tratable la transferencia.

## Cómo funciona la importación — particularidades de Intune

El flujo de alto nivel es directo y deliberadamente menos mágico que su primo de AC. Pon las expectativas con honestidad: no hay generalización automática de referencias específicas del tenant pasando por detrás. Lo que exportas es aproximadamente lo que importas.

**Paso 1: Apunta Panoptica365 a un tenant de origen.** Un operador del MSP escoge cualquier tenant al que la plataforma tenga acceso y saca la configuración de Intune vía Microsoft Graph. La extracción produce una representación JSON estructurada de las Políticas de Configuración, Políticas de Cumplimiento, Perfiles de Configuración y plantillas de Endpoint Security del tenant de origen — la misma forma que las plantillas empaquetadas `Panoptica365 - ...`, que fueron construidas exportando desde un tenant de origen, limpiando referencias específicas del tenant y empaquetando el resultado.

**Paso 2: Elige qué importar como plantilla.** De la lista de políticas extraídas, el operador escoge las específicas a registrar como plantillas de Panoptica365. La mayoría de las exportaciones se mapean uno a uno — una política en el origen se convierte en una plantilla en Panoptica365. La elección de *qué merece convertirse en plantilla reusable* es una llamada de juicio; no toda política específica de cliente debería plantillarse.

**Paso 3: Sé consciente de lo que no se generaliza automáticamente.** Aquí es donde Intune es más doloroso que AC. El flujo de importación de AC hace generalización de ubicaciones nombradas (trabajo del 23 de abril, `project_named_location_generalization`); el flujo de importación de Intune **no** hace generalización equivalente hoy. Las referencias que no llevarán limpiamente a otros tenants incluyen:

- **Referencias a grupos** — las asignaciones y exclusiones apuntan a grupos de seguridad de Entra por GUID. Un grupo con el mismo nombre en el tenant B tiene un GUID distinto al del tenant A. Una plantilla importada que referencia un GUID de grupo del tenant de origen no se desplegará limpiamente en otros sitios.
- **Referencias a certificados** — los perfiles que referencian certificados por número de serie o thumbprint no llevan a través de tenants.
- **Referencias a filtros** — los filtros de asignación por plataforma/modelo/fabricante de dispositivo son específicos del tenant por GUID.
- **Referencias a plantillas de notificación** — para políticas de cumplimiento que disparan notificaciones de usuario.

La responsabilidad del operador hoy es limpiar manualmente estas referencias de la plantilla importada, o aceptar que la plantilla necesitará ajuste en cada tenant de destino antes de poder desplegarse.

**Paso 4: Nombra y describe la plantilla.** Usa la convención `Nombre-del-MSP - <nombre descriptivo>`. Las plantillas personalizadas deberían ser distinguibles de las plantillas empaquetadas `Panoptica365 - ...` en la lista de políticas desplegadas del cliente.

**Paso 5: Guarda a la biblioteca.** A partir de este punto, la plantilla se comporta como las empaquetadas para despliegue, detección de deriva y redespliegue.

## Cómo se ve la forma de la exportación

La exportación de Microsoft Graph que Intune produce — y la forma desde la que se construyeron las plantillas empaquetadas `Panoptica365 - ...` — es JSON estructurado. Cada política exportada tiene:

- Un campo `policyType` — `deviceCompliancePolicies`, `configurationPolicies`, `deviceConfigurations` o `intents` — identificando a qué familia de políticas de Intune pertenece.
- Un `name` y `category` identificando el propósito de la plantilla.
- O bien un objeto `policy` (los datos de configuración) o un array `settings` (las configuraciones por-ajuste), según la familia de la política.

Las plantillas empaquetadas han sido todas generalizadas — no cargan GUIDs de grupos del tenant de origen, referencias a certificados ni otros objetos específicos del tenant. Se despliegan limpiamente a cualquier tenant de cliente. El mismo trabajo de generalización — actualmente manual — aplica a cualquier plantilla personalizada que importes.

## Qué puede exportarse portablemente y qué no

Vale la pena ser explícito sobre los límites de portabilidad de Intune:

**Portable limpiamente:**
- Políticas de Settings Catalog (Configuration Policies) — el formato moderno, casi todos los ajustes son portables.
- Políticas de cumplimiento — la estructura de la política es portable; algunos ajustes referencian valores específicos del tenant que necesitan sustitución.
- Plantillas de Endpoint Security (ASR Rules, Firewall, Defender, Account Protection) — mayormente portables; los grupos de asignación necesitan sustitución.

**Mayormente portable con marcadores de posición:**
- Configuration Profiles (Device Configurations) — tipo de plantilla más antiguo; algunas propiedades atan a redes Wi-Fi, servidores VPN, autoridades certificadoras específicas del tenant.
- Políticas de Configuración de Aplicaciones — referencian aplicaciones que existen como aplicaciones gestionadas en el tenant; la referencia a la aplicación es portable pero el cliente debe tener la aplicación disponible.

**Difícil o imposible de portar portablemente:**
- **Políticas de Protección de Aplicaciones (APP/MAM).** Referencian aplicaciones específicas; su comportamiento depende de la configuración de identidad específica del tenant. A menudo necesitan re-creación por-tenant en lugar de plantilla.
- **Plantillas que despliegan certificados** — los certificados son inherentemente por-tenant. La estructura de la plantilla porta; el propio certificado no.
- **Plantillas que referencian filtros personalizados** — los filtros de asignación necesitan crearse en el tenant de destino antes de que la plantilla pueda desplegarse.
- **Configuraciones de despliegue de aplicaciones** — asignar una aplicación específica a un grupo específico es mayormente por-tenant.
- **Cualquier cosa que dependa del estado de Acceso Condicional** — algunas configuraciones de Intune interactúan con políticas de AC (p. ej., notificaciones de política de cumplimiento enrutadas a través de AC); esas referencias necesitan re-creación.

El flujo de importación de Panoptica365 hoy no te marca los elementos no portables — vienen a través en el JSON importado y el operador tiene que detectarlos y limpiarlos manualmente antes de confiar en la plantilla para el despliegue entre clientes. Las plantillas empaquetadas `Panoptica365 - ...` pasaron exactamente por esta limpieza manual cuando se construyeron; tus importaciones personalizadas necesitan la misma disciplina.

## Cuándo *no* importar

Dos casos específicos donde importar es el movimiento equivocado para Intune:

**La plantilla está bloqueada a una plataforma.** Un perfil de configuración que apunta solo a `windows10` no ayuda a un cliente sin dispositivos Windows. Importarlo añade a la biblioteca pero no proporciona valor a ese cliente. Si estás importando para reúso entre clientes, apúntalo a las plataformas que tus clientes realmente tienen.

**La plantilla depende de infraestructura específica del tenant que no se generaliza.** Una configuración que referencia un dominio Active Directory on-premise específico, una autoridad certificadora específica emitiendo certificados de dispositivo gestionado, una infraestructura Wi-Fi on-premise específica — estas no se generalizan. Incluso tras la limpieza manual, el tenant de destino necesita infraestructura equivalente para que la plantilla sea útil. Si el tenant de origen tiene AD CS corporativo y el destino es solo nube, la plantilla no encaja.

Para estos casos, construye políticas de Intune por-tenant directamente en lugar de plantillas.

## La biblioteca empaquetada es el suelo, no el techo

El mismo punto hecho en la tarjeta 3 lección 8: las plantillas que Panoptica365 envía son un punto de partida, no el límite. El MSP que se toma Intune en serio construye sus propias plantillas encima de la biblioteca empaquetada:

- Plantillas para industrias específicas (imagen médica, legal, contabilidad).
- Plantillas para marcos de cumplimiento específicos (CIS, NIST, HIPAA, SOC 2).
- Plantillas para endurecimiento post-incidente (desplegadas tras un compromiso de cliente).
- Plantillas que el ingeniero senior ha construido para su postura preferida de endurecimiento.

Estas plantillas viven en la instancia del MSP de Panoptica365, no en la distribución del producto Panoptica365. Se convierten en parte de la ventaja competitiva del MSP — la IP que distingue a un MSP del siguiente.

## Mantener plantillas importadas

Como las plantillas de AC (tarjeta 3 lección 8), las plantillas de Intune necesitan mantenimiento:

- **Cambios de esquema de Microsoft Graph.** Microsoft renombra propiedades, depreca ajustes, añade nuevos. Las plantillas importadas pueden necesitar actualización.
- **Cambios del entorno del cliente.** La configuración del tenant de un cliente evoluciona; plantillas que funcionaban perfectamente hace seis meses pueden necesitar ajuste.
- **Divergencia plantilla-vs-política desplegada.** Ajustes por-tenant por admins individuales desvían el despliegue de la referencia de la plantilla.

El detector de deriva de Panoptica365 cubre las plantillas empaquetadas; las plantillas personalizadas necesitan que el MSP verifique periódicamente. La sobrecarga de mantenimiento es real — importar 20 plantillas personalizadas significa comprometerse a mantener 20 plantillas.

## Despliegue para una plantilla de Intune personalizada

Despliegue por grupo piloto, igual que las plantillas empaquetadas, con una salvedad extra: las plantillas importadas están a menudo **menos probadas** que las empaquetadas. Vinieron de la experiencia de un tenant; pueden no haber sido validadas a través de la variación de entornos que representan los clientes.

1. **Inspección pre-importación.** Audita la plantilla de origen. ¿Está limpia? ¿Bien afinada? ¿Al día? ¿Alguna referencia hardcodeada que no transferirá? Arregla los problemas en el origen.
2. **Importar.** Generaliza referencias, guarda como plantilla.
3. **Primer despliegue a un único tenant**, con despliegue por grupo piloto dentro de ese tenant. Trata al primer cliente como el piloto más amplio para esta plantilla.
4. **Días 1–14** — verifica que la plantilla se comporta como se espera. Señales de cumplimiento correctas, configuraciones aplicándose, sin impacto inesperado al usuario.
5. **Día 14+** — si el despliegue del primer cliente está limpio, expande a más tenants de clientes. Cada despliegue subsiguiente es más rápido (la plantilla está validada).

Una vez que una plantilla personalizada se ha desplegado en 3–5 tenants de clientes con éxito, trátala como validada para producción y continúa usándola con la disciplina normal de despliegue.

## Lo que esto significa para el operador

Tres puntos para llevarte.

**La biblioteca empaquetada es el suelo.** Trata las 14 plantillas de Panoptica365 como el punto de partida para cualquier cliente. Construye encima con importaciones para lo que el cliente necesite que el suelo no cubra.

**Las importaciones de Intune tienen más tipos de marcadores de posición que las importaciones de AC.** Referencias a grupos, referencias a certificados, referencias a filtros, plantillas de notificación. El trabajo de generalización es más laborioso. Reserva más tiempo para la primera importación de cualquier tipo de plantilla dado.

**Valida antes de escalar.** Una mala plantilla importada desplegada a través de treinta tenants de clientes son treinta despliegues rotos. Piloto en primer cliente, valida, luego expande.

## Lo que viene

- **Lección 11: Operar Intune a escala.** El cierre. Deriva, exclusiones, ciclo de vida, el problema de pérdida de asignaciones.

Por ahora: el flujo de importación es lo que convierte el módulo de Intune de Panoptica365 de «lo que enviamos» a «lo que tu MSP sabe». Úsalo para los huecos de cobertura de plataforma, las plantillas de marcos de cumplimiento, el endurecimiento específico de industria, las configuraciones curadas por el ingeniero senior.

---

*Fuentes de los datos en esta lección — API de Microsoft Graph para políticas de configuración de Intune ([Microsoft Learn — Intune Graph API reference](https://learn.microsoft.com/en-us/graph/api/resources/intune-graph-overview)); exportación e importación de políticas de Settings Catalog ([Microsoft Learn — Settings catalog](https://learn.microsoft.com/en-us/mem/intune/configuration/settings-catalog)); tipo de recurso de política de cumplimiento ([Microsoft Learn — deviceCompliancePolicy](https://learn.microsoft.com/en-us/graph/api/resources/intune-shared-devicecompliancepolicy)); referencias de plantillas de políticas de Endpoint Security ([Microsoft Learn — Endpoint security policies](https://learn.microsoft.com/en-us/mem/intune/protect/endpoint-security-policy)).*
