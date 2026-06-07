---
title: "Operar Intune a escala — deriva, exclusiones, ciclo de vida, el problema de pérdida de asignaciones"
subtitle: "El patrón operativo más costoso en Intune: cómo borrar-y-recrear descarta silenciosamente las exclusiones por-tenant, y cómo evitarlo."
icon: "settings-2"
last_updated: 2026-05-29
---

# Operar Intune a escala — deriva, exclusiones, ciclo de vida, el problema de pérdida de asignaciones

Un MSP en crecimiento descubrió a finales de 2025 que 12 de sus clientes habían perdido silenciosamente sus grupos de exclusión por-tenant en la plantilla de Intune Account Protection. Las exclusiones habían sido configuradas cuidadosamente — dispositivos kiosko excluidos para que no recibieran prompts de Windows Hello que no podían satisfacer, cuentas de servicio específicas excluidas de políticas que habrían roto sus flujos. Luego alguien actualizó la plantilla Account Protection en Panoptica365 — modernizó algunos ajustes, añadió un nuevo requisito — y empujó la actualización. La actualización redesplegó la plantilla a través de todos los clientes. El comportamiento subyacente de la plantilla estilo Intents es borrar-y-recrear. Las configuraciones de exclusión por-tenant antiguas se descartaron silenciosamente.

Nadie lo notó durante seis semanas. Para entonces, varios clientes habían reportado bloqueos inexplicables de usuarios en dispositivos que no deberían haber estado en el ámbito.

Es el patrón operativo más caro en Intune. El arreglo no es difícil; la conciencia sí. Esta lección es el cierre de la tarjeta 4 — cómo operar Intune a escala, qué significa la deriva aquí, cómo se descomponen las exclusiones, y el problema de pérdida de asignaciones que se ha mencionado en cada lección pero merece tratamiento explícito.

## El problema de pérdida de asignaciones, completo

La tarjeta 4 lección 1 lo introdujo; merece tratamiento completo.

Las plantillas de Intune vienen en tres familias de tipo de plantilla: Settings Catalog (`configurationPolicies`), Endpoint Security Intents (`intents`), y Device Configurations más antiguas (`deviceConfigurations`). Cuando Panoptica365 despliega una actualización de plantilla a través de tenants de clientes, el comportamiento subyacente difiere por tipo:

- **Políticas de Settings Catalog** — actualización en sitio vía PATCH de la API Graph. El ID de la política se mantiene; las asignaciones se preservan. Seguro.
- **Device Configurations** — normalmente actualización en sitio. Mayormente seguro.
- **Plantillas Intents / Endpoint Security** — *borrar-y-recrear*. La política antigua se elimina y se crea una nueva. Cualquier exclusión de asignación por-tenant configurada contra el ID de la política antigua no se transfiere — se pierde silenciosamente.

De las 14 plantillas en la biblioteca de Panoptica365, este comportamiento de borrar-y-recrear afecta a **Account Protection Settings** específicamente (la única plantilla estilo Intents en la biblioteca). También afecta a cualquier plantilla estilo Intents importada que el MSP añada (lección 10).

Microsoft ha estado trabajando en cambiar las plantillas de Endpoint Security a un modelo PATCH de verdad en lugar de borrar-recrear, pero a mediados de 2026 el comportamiento persiste. Hasta que Microsoft arregle la API subyacente, la responsabilidad del operador es sortearlo manualmente.

La disciplina operativa:

**Antes de actualizar cualquier plantilla estilo Intents a través del parque:**
1. Captura las asignaciones por-tenant actuales para la plantilla abriendo el portal de Intune de cada cliente afectado y registrando los grupos de asignación + exclusión manualmente. No hay una vista de despliegue a nivel de parque en Panoptica365 hoy, así que esto es trabajo de click por cliente.
2. Anota cualquier exclusión no por defecto específicamente. La asignación estándar «Todos los Dispositivos» se redesplegará correctamente; las exclusiones por-cliente a medida son las que se pierden.

**Tras la actualización:**
3. Verifica las asignaciones en cada tenant de cliente afectado.
4. Para cualquier cliente donde falten exclusiones, restáuralas manualmente.

Esto es molesto, y no hay atajo automatizado hoy — actualizar en bloque plantillas estilo Intents a través de un parque sin el paso manual de captura-y-replay es un disparo al pie. Hasta que Microsoft reemplace el comportamiento de borrar-recrear, el flujo manual es el único camino seguro.

Para el operador típico, la conclusión práctica: **antes de empujar cualquier actualización a la plantilla Account Protection** (o a cualquier plantilla estilo Intents importada), inventaria las exclusiones de los clientes afectados. No actualices en bloque plantillas estilo Intents sin el paso de replay.

## Detección de deriva en plantillas de Intune

Como AC, las plantillas de Intune derivan a lo largo del tiempo. Las categorías de deriva son similares pero los modos de fallo difieren:

**Deriva de estado** — el estado de despliegue de una plantilla cambió inesperadamente. Menos habitual en Intune que en AC (Intune no tiene un estado equivalente a Solo-informe que pueda voltearse de la misma forma) pero posible: otro admin de un cliente puede haber borrado una política por completo, o haber acotado su asignación tan estrechamente que ya no aplica a nadie.

**Deriva de ámbito** — el ámbito de asignación cambió. Nuevos grupos de inclusión añadidos, grupos de exclusión añadidos, grupos eliminados. Esta es la categoría de deriva más consecuente para Intune porque cambiar el ámbito puede cambiar dramáticamente a qué dispositivos afecta la política. Otro admin de un cliente añadiendo un grupo de exclusión amplio puede deshabilitar efectivamente la política sin deshabilitarla formalmente.

**Deriva de ajustes** — ajustes individuales dentro de una plantilla cambiaron. Un ajuste específico fue afinado por-cliente (una ruta de exclusión de Defender añadida, una regla de firewall ajustada, un mínimo de PIN de Windows Hello aflojado). Estas son las personalizaciones legítimas por-cliente que *deberían* derivar — pero el operador necesita saber de ellas.

**Deriva de valor de configuración** — el valor de una política de Settings Catalog para un ajuste específico fue cambiado centralmente (el admin de un cliente hizo clic y modificó un valor específico). La más difícil de detectar manualmente porque la política todavía parece «correcta» a alto nivel; solo la comparación ajuste-a-ajuste lo pilla.

El detector de deriva de Panoptica365 cubre las cuatro categorías para las 14 plantillas empaquetadas. Para plantillas personalizadas importadas (lección 10), la responsabilidad del operador incluye verificar que la detección de deriva está funcionando — Panoptica365 expone deriva para plantillas para las que tiene una referencia; si una plantilla personalizada fue importada a Panoptica365 correctamente, la referencia se captura y la detección de deriva funciona automáticamente.

El flujo del operador para alertas de deriva:

1. **Acepta la alerta** e identifica el tipo (estado / ámbito / ajuste / valor).
2. **Identifica la causa vía log de auditoría.** Quién hizo el cambio, cuándo, desde qué rol.
3. **Decide: aceptar o revertir.**
   - ¿Personalización legítima por-cliente? Acepta y actualiza la referencia (o acepta que el cliente tenga su propia variante).
   - ¿Cambio no autorizado o modificación accidental? Revierte a la referencia de la plantilla.
4. **Documenta la decisión** en el registro de cambios del cliente (Panoptica365 lo hace automáticamente).

## Exclusiones — el problema persistente de descomposición

Igual que AC, las exclusiones de Intune se acumulan silenciosamente. El mecanismo que lo previene:

**Cada exclusión tiene una fecha de caducidad.** Cuando un operador añade un dispositivo o grupo a la lista de exclusión de una plantilla de Intune, Panoptica365 pide una justificación y una fecha de expiración. La expiración por defecto es 180 días; el operador puede ajustar.

**Cada exclusión se revisa antes de la expiración.** Panoptica365 alerta al operador responsable antes de la fecha de caducidad. Revisión: ¿todavía necesaria? ¿Renovar con justificación fresca? ¿O dejar que expire y traer el dispositivo de vuelta al ámbito?

**Las exclusiones basadas en grupo se auditan periódicamente.** Excluir «Dispositivos Kiosko» (un grupo de Entra) significa que cualquiera añadido a ese grupo más tarde hereda la exclusión. La pertenencia al grupo puede cambiar sin que la plantilla cambie. Las auditorías periódicas de la pertenencia al grupo son parte de la disciplina.

Los patrones a evitar:

- «Exclusión permanente» sin expiración. Nada es permanente; las plantillas cambian, los dispositivos cambian, las regulaciones cambian. Las exclusiones permanentes se convierten en brechas de seguridad invisibles.
- «Excluir al departamento de IT por comodidad». Si estás excluyendo a admins de una política de endurecimiento porque la encuentran molesta, has invertido el modelo de seguridad — los admins son los objetivos de mayor valor y necesitan *más* endurecimiento, no menos.
- «Excluir un dispositivo por un incidente específico, nunca volver a incluir». Un dispositivo excluido por una razón técnica temporal a menudo se queda excluido para siempre porque nadie recuerda la razón.

El flujo de exenciones de Panoptica365 hace que añadir exclusiones sea ligeramente más difícil que ignorarlas. Esa fricción es intencional — hace que los patrones malos sean más difíciles de cometer que los buenos.

## Ciclo de vida — cómo evolucionan las plantillas de Intune

El despliegue de Intune de un cliente evoluciona según su negocio lo hace. Eventos que deberían disparar una revisión de plantilla de Intune:

- **Nueva plataforma de dispositivos introducida.** El cliente adquiere un parque Mac para un equipo creativo. Las plantillas macOS necesitan atención.
- **Actualización mayor de característica de Windows.** Windows 11 25H2 cambia algunos valores por defecto de ajustes; las plantillas pueden necesitar ajuste para aplicar comportamientos previos.
- **Nuevo marco de cumplimiento.** El cliente firma un contrato que exige cumplimiento del CIS Microsoft 365 Foundations; necesita plantillas alineadas con CIS importadas.
- **Mudanzas de oficina o el negocio se expande.** Nuevos rangos de IP de confianza, nuevos endpoints de VPN, nuevas aplicaciones de negocio que necesitan estar en lista de permitidos.
- **Respuesta a incidente.** Post-compromiso, la postura de Intune del cliente normalmente se endurece.
- **El cliente reduce o fusiona.** La población de dispositivos cambia; plantillas antiguas pueden necesitar limpieza.
- **Microsoft retira o reemplaza una característica.** Microsoft ha estado retirando silenciosamente tipos antiguos de política de Intune en favor de Settings Catalog. Las plantillas pueden necesitar migración.

Para cada cliente, una **revisión anual de Intune** es la cadencia correcta:

1. Lista todas las plantillas de Intune desplegadas por cliente.
2. Para cada plantilla: ¿sigue siendo apropiada? ¿Sigue siendo necesaria? ¿Los ajustes siguen siendo correctos?
3. Revisa las listas de exclusión. Cada entrada: ¿sigue siendo necesaria? ¿La fecha de caducidad sigue siendo apropiada?
4. Revisa el historial de deriva. ¿Hubo cambios en el año pasado que no se resolvieron del todo?
5. Compara contra la biblioteca empaquetada actual de Panoptica365. ¿Plantillas que el cliente debería estar desplegando pero no? ¿Plantillas nuevas añadidas desde la última revisión?
6. Documenta la revisión.

Esta es la misma cadencia de revisión anual que la tarjeta 3 lección 9 recomendaba para AC. Aplican los mismos principios: es una disciplina operativa, no opcional, facturable al cliente como parte del servicio de seguridad.

## Dependencias de licencia

Algunas características de Intune requieren Intune Plan 2 (E3 o E5) en lugar de Intune Plan 1 (Business Premium). Para la biblioteca empaquetada de Panoptica365, las plantillas funcionan en Intune Plan 1 — fueron curadas para encajar en el ámbito de Business Premium. Pero algunas características avanzadas que el MSP podría importar no:

- **Endpoint Privilege Management (EPM)** — control de elevación de admin local. Requiere Intune Plan 2 / E5.
- **Remote Help** — soporte remoto integrado en Intune. Requiere Intune Plan 2 / E5.
- **Advanced Endpoint Analytics** — telemetría más profunda. Requiere Intune Plan 2 / E5.
- **Integración con Mobile Threat Defense** — socios MTD de terceros. Requiere Intune Plan 1 mínimo pero la configuración varía.

Cuando importes plantillas personalizadas que dependan de estas características, verifica que el tenant de destino tiene la licencia. Desplegar una característica de Plan 2 a un tenant de Plan 1 produce un fallo silencioso — la política existe pero no puede activarse.

## Qué expone Panoptica365

No hay una vista única de «operar a escala» en Panoptica365 hoy que agregue el parque a través de clientes — sé honesto con tu equipo sobre esto y no se lo prometas a tus clientes. El modelo de lectura de la plataforma es por-tenant, y el flujo a escala del operador hoy es una mezcla de tres cosas:

- **Alertas de deriva por plantilla por cliente.** La detección de deriva corre a través de las plantillas desplegadas; cuando el tenant de un cliente diverge de la referencia empaquetada (o importada), una alerta se dispara. Esta es la señal principal de «algo cambió en algún sitio a lo largo de mi parque» que Panoptica365 proporciona hoy.
- **La sección de Exenciones.** Cuando un operador ha aprobado exenciones a través de tenants de clientes, la vista de Exenciones las lista con la opción de revocar. No es una cola de «pendiente de revisión» — es un registro de lo que se ha concedido. La disciplina del operador de abrirla periódicamente y preguntarse «¿son todas estas todavía defendibles?» es lo que la convierte en un flujo de caducidad.
- **Paneles por-tenant, uno a uno.** Tile de cuenta de cumplimiento, lista de dispositivos, Dispositivos por SO — la misma superficie que describió la lección 9. Para hacer una revisión «a escala» hoy, el operador hace clic a través de los tenants uno a uno.

Lo que *no* existe hoy, por si el resto de esta lección te llevó a esperarlo:

- Una agregación de «cumplimiento de parque» entre clientes
- Una vista matriz de «estado de despliegue de plantilla por cliente por plantilla»
- Una línea de tiempo de «actividad reciente de despliegue a través de todos los clientes»
- Una lista de «dispositivos en estados problemáticos de cumplimiento»
- Una cola de revisión de exclusiones con fechas de caducidad

Las flechas de tendencia del tile de cumplimiento dan al operador una señal direccional por-sondeo — útil para pillar deriva de postura rápidamente sin recordar el número de ayer. Por ahora, ese es el nivel de visibilidad entre-clientes que Panoptica365 proporciona; la agregación más profunda requiere el click por-tenant descrito arriba.

## La revisión anual de Intune — cadencia recomendada

Para cada cliente, una vez al año (habitualmente sincronizado con la revisión anual de seguridad y la conversación de renovación):

1. **Lista todas las plantillas de Intune desplegadas.** Qué está habilitado, qué está desplegado en modo auditoría, qué se desplegó pero no se usa activamente.
2. **Para cada plantilla, verifica que sigue siendo apropiada.** ¿Las condiciones coinciden con la realidad actual del cliente? ¿Las exclusiones siguen siendo defendibles?
3. **Revisa el historial de deriva.** ¿Qué cambió en el año pasado? ¿Cada cambio se resolvió apropiadamente (aceptado con referencia actualizada, o revertido)?
4. **Compara contra la biblioteca actual de Panoptica365.** ¿Plantillas empaquetadas que deberían desplegarse pero no lo están (recién añadidas, recientemente actualizadas)?
5. **Compara contra el estado actual del cliente.** ¿Ha cambiado el entorno del cliente (nuevas plataformas, nuevas licencias, nuevas obligaciones regulatorias) de formas que sugieran nuevas plantillas?
6. **Documenta la revisión.** El director de IT del cliente debería tener un registro de la revisión anual y sus conclusiones.

Esto es disciplina operativa. Es el trabajo que evita que la postura de Intune del cliente se descomponga con los años. Es facturable como parte del servicio de seguridad del MSP — y es lo que diferencia a un MSP cuidadoso de uno que despliega y olvida.

## Lo que esto significa para el operador

Tres puntos para llevarte.

**El problema de pérdida de asignaciones es la trampa operativa más consecuente en Intune.** Account Protection Settings (y cualquier plantilla estilo Intents importada) requiere la disciplina de inventario-actualización-replay. Saltársela es como las exclusiones de los clientes se evaporan sin que nadie lo note.

**Las listas de exclusión son deuda silenciosa.** Se acumulan, se descomponen, se convierten en brechas de seguridad invisibles. El flujo de exenciones con fechas de caducidad es la herramienta para combatir esto; úsala.

**La revisión anual es innegociable.** Las plantillas de Intune que eran apropiadas hace tres años pueden no ser apropiadas hoy. Sin una cadencia de revisión estructurada, la postura de Intune del cliente se descompone. Factúrala; documéntala; hazla visible al cliente.

## Cerrando la tarjeta 4

Ya has visto las 14 plantillas de Intune de Panoptica365 y la mecánica operativa que las convierte en una práctica de endurecimiento de endpoints que funciona.

El arco de la tarjeta 4:

1. Comprobación previa para plantillas de Intune — la disciplina antes de cualquier despliegue.
2. Políticas de cumplimiento — definiendo «conforme» a través de cuatro plataformas.
3. La Security Baseline — tu paquete curado de endurecimiento de Windows.
4. BitLocker Settings — postura de cifrado de disco.
5. Configuración de Defender for Endpoint — Windows + macOS.
6. Firewall Settings — defensa de red de Windows.
7. ASR Rules + Block mshta.exe — reducción de superficie de ataque.
8. Account Protection + Block MSA — endurecimiento de credenciales en el endpoint.
9. El bucle de cumplimiento en producción — deriva, señales, monitorización.
10. Importar tus propias plantillas de Intune — el flujo de personalización.
11. Operar Intune a escala — deriva, exclusiones, ciclo de vida, el problema de pérdida de asignaciones (esta lección).

La tarjeta 5 (Endurecimiento de Exchange / Correo) empieza a continuación. Esa tarjeta cambia del endpoint a la superficie de correo — los ajustes de EXO que protegen el canal que los atacantes usan más.

Por ahora: las plantillas de la tarjeta 4 te han dado la base de endurecimiento del lado Windows. El bucle de cumplimiento señala a AC. La postura de endpoint del cliente pasa de por-defecto-de-fábrica a genuinamente endurecida con la biblioteca empaquetada desplegada. El MSP que acierta con esto cierra el mayor avenida individual de ataque contra parques Windows de pequeña empresa.

---

*Fuentes de los datos en esta lección — Microsoft Learn sobre los tipos de política de Intune y comportamiento de actualización ([Microsoft Learn — Intune policy types](https://learn.microsoft.com/en-us/mem/intune/configuration/device-profiles)); plantillas de Endpoint Security y su modelo de actualización ([Microsoft Learn — Endpoint security policy](https://learn.microsoft.com/en-us/mem/intune/protect/endpoint-security-policy)); requisitos de licencia de Intune por característica ([Microsoft Learn — Intune licensing](https://learn.microsoft.com/en-us/mem/intune/fundamentals/licenses)); API de Microsoft Graph para asignación de políticas ([Microsoft Learn — Assignment resource type](https://learn.microsoft.com/en-us/graph/api/resources/intune-shared-deviceconfigurationassignment)).*
