---
title: "Antes de tocar una plantilla de Intune — la lista de comprobación previa al despliegue"
subtitle: "Qué verificar antes de desplegar cualquier plantilla de Intune: cobertura de plataforma, familias de tipos y el riesgo de pérdida de asignaciones."
icon: "clipboard-check"
last_updated: 2026-05-29
---

# Antes de tocar una plantilla de Intune — la lista de comprobación previa al despliegue

Un técnico de un MSP que conocemos probó una vez un nuevo Perfil de Configuración de Intune desplegándolo en un único dispositivo de prueba, confirmando que funcionaba, y luego desplegándolo en bloque en los 47 tenants de clientes que gestionaba a lo largo de la hora siguiente. Al final del día siguiente, ocho tenants habían reportado problemas relacionados con las asignaciones — el despliegue masivo había disparado el comportamiento de borrar-y-recrear de Intune, que silenciosamente eliminó los grupos de exclusión por-tenant que esos clientes tenían configurados. Dispositivos que se suponía debían estar excluidos de la política estaban ahora en su ámbito. Dispositivos que habían sido cuidadosamente eximidos de un control de cumplimiento específico ahora lo estaban fallando.

El técnico había hecho todo lo correcto según los estándares del despliegue de plantillas de AC. Pero Intune no es AC. La disciplina previa al despliegue para plantillas de Intune es diferente.

Esta lección es la comprobación previa que ejecutas antes de desplegar cualquier plantilla de Intune de la tarjeta 4. Es distinta de la comprobación previa de AC de la tarjeta 3 porque los modos de fallo de Intune son diferentes — y porque Intune arrastra una herencia histórica que AC no carga.

## Por qué Intune merece su propia comprobación previa

Tres diferencias estructurales entre Intune y AC que importan para el despliegue:

**Intune es específico por plataforma.** Una política de AC se aplica a «todas las aplicaciones en la nube» o a «Exchange Online» — destinos universales y abstractos. Un perfil de Intune se aplica a Windows 10/11, o a iOS, o a Android Enterprise, o a macOS. La misma plantilla no puede abarcar plataformas. Desplegar sin confirmar que el cliente tiene de verdad dispositivos en esa plataforma produce una política sin destinatarios — silenciosa, inofensiva, pero también sin hacer nada.

**Intune tiene tres familias distintas de tipos de plantilla en uso activo.** Microsoft ha enviado tres generaciones de infraestructura de políticas de Intune y nunca ha jubilado del todo las más antiguas. En la biblioteca de Panoptica365 verás las tres:

- **Settings Catalog** (`configurationPolicies`) — la interfaz moderna y granular de ajustes. La mayoría de las plantillas Windows de Panoptica365 usan esta: ASR Rules, Block Microsoft Consumer Accounts, Block mshta.exe, Defender Settings (Windows + macOS), Firewall Settings, Security Baseline. Es lo que usa la documentación nueva de Microsoft.
- **Intents / Plantillas de Endpoint Security** (`intents`) — el estilo de plantilla de seguridad de endpoint más antiguo. La plantilla Account Protection Settings de Panoptica365 usa este. Microsoft no lo ha deprecado; sigue conviviendo con Settings Catalog. El portal de Intune lo renderiza de forma distinta a las políticas de Settings Catalog.
- **Device Configurations** (`deviceConfigurations`) — el estilo más antiguo. Las plantillas BitLocker Settings y Windows Health Monitoring usan este. La interfaz para estas en el portal de Intune se aloja en una hoja separada de las otras dos.

Cuando un operador abre el portal de Intune buscando una plantilla de Panoptica365 desplegada, la plantilla puede estar en cualquiera de las tres secciones distintas de la interfaz. La plantilla vive en la sección que coincide con su tipo subyacente. No hay unificación retocada por Panoptica365 — Microsoft eligió la estructura, y las plantillas la siguen.

**Los despliegues de Intune no tienen un modo «Solo informe» limpio.** AC tiene Solo informe como estado de primera clase. Intune no. Los equivalentes más cercanos son:

- *Modo auditoría* para reglas ASR (una elección por regla entre Auditoría, Bloqueo o Aviso — se cubre en la lección 7).
- *Política de cumplimiento en asignación piloto* (puedes desplegar una política de cumplimiento a un grupo piloto pequeño primero, evaluar, luego expandir la asignación).
- *Perfil de configuración desplegado a un grupo piloto pequeño* (mismo patrón — desplegar a unos pocos dispositivos, verificar, expandir).

Ninguno de estos es exactamente como el Solo informe de AC. El operador tiene que usar el despliegue por grupo piloto como su ensayo, no un interruptor a nivel de política.

## Los cinco pasos previos al despliegue

### 1. Inventaria los dispositivos por plataforma y por estado de gestión

Antes de desplegar cualquier plantilla de Intune, saca el inventario de dispositivos. Necesitas saber:

- **¿Cuántos dispositivos hay en cada plataforma?** La biblioteca de Panoptica365 es muy Windows-pesada (10 de las 14 plantillas son solo para Windows) y eso casa con la realidad de la pequeña empresa — la mayoría de los dispositivos gestionados son estaciones de trabajo Windows. Si un cliente tiene cero dispositivos Windows, la mitad de las plantillas de la tarjeta 4 son irrelevantes. Si tiene todos Windows excepto un Mac extraviado, las plantillas de macOS afectan a un dispositivo.
- **¿Cuántos dispositivos hay en cada estado de gestión?** Los dispositivos pueden estar gestionados por Intune (totalmente inscritos en MDM), registrados en Entra (más ligero — conocidos por Entra pero no gestionados) o sin inscribir (BYOD sin presencia de MDM). Las plantillas se aplican a dispositivos inscritos en MDM; los dispositivos sin inscribir ignoran el despliegue por completo.
- **¿Cuál es la mezcla de BYOD?** La mayoría de los tenants de pequeña empresa con los que trabajarás son fuertemente BYOD en móvil — los usuarios usan sus iPhones y dispositivos Android personales. Esos dispositivos normalmente no están inscritos en MDM en absoluto. Las plantillas de cumplimiento móvil de Panoptica365 asumen inscripción MDM; sin ella, no aplican. Establecer las expectativas del cliente sobre «no gestionamos dispositivos móviles personales a través de esta plantilla» es importante.

Hoy sacarás estos datos directamente del portal de Intune — Panoptica365 saca a la superficie la lista de dispositivos y el desglose por SO en el panel del cliente, pero el inventario más profundo (estado de gestión por dispositivo, BYOD vs propiedad corporativa, antigüedad de la inscripción) se hace en la consola de Microsoft.

### 2. Confirma que el bucle de cumplimiento está cableado

La tarjeta 1 lección 3 cubrió el bucle de cumplimiento: Intune evalúa el estado del dispositivo → escribe el estado de cumplimiento en el registro de dispositivo de Entra → Acceso Condicional lee ese estado al iniciar sesión. Si el bucle está roto en cualquier punto, la señal de cumplimiento es inútil aunque la plantilla de Intune se despliegue correctamente.

Roturas habituales:

- **Dispositivo aún no sincronizado.** Los dispositivos recién inscritos pueden tardar entre 1 y 8 horas en completar su primer ciclo de evaluación de cumplimiento. Durante esa ventana, aparecen como «Aún no evaluado» en el estado de cumplimiento. AC trata «Aún no evaluado» de forma distinta según la configuración de la política — a veces como no conforme, a veces como inconcluso.
- **Cadencia de evaluación de cumplimiento demasiado lenta.** El intervalo de comprobación por defecto de Intune es cada 8 horas en Windows. Un dispositivo que se vuelve no conforme al mediodía puede seguir apareciendo conforme en el registro de Entra a las 16:00 porque la comprobación todavía no ha ocurrido.
- **Registro de dispositivo en Entra roto.** Si el dispositivo está inscrito en Intune pero su objeto de dispositivo en Entra está en mal estado (huérfano, duplicado, sincronización rota desde AD on-premise en entornos híbridos), la señal de cumplimiento no puede escribir de vuelta a Entra. Habitual en tenants que han crecido por adquisiciones o han tenido problemas con AD Connect.

Antes de desplegar una plantilla de cumplimiento, verifica que el bucle funciona en un dispositivo de prueba conocido y en buen estado. Si el bucle está roto, arregla el bucle antes de desplegar — de lo contrario, las plantillas producen estados falsos de «conforme» o «no conforme».

### 3. Elige el ámbito de asignación adecuado

Las plantillas de Intune soportan varios modelos de asignación:

- **Todos los dispositivos.** Se aplica a todos los dispositivos inscritos en Intune.
- **Todos los usuarios.** Se aplica a los dispositivos propiedad de cualquier usuario del tenant.
- **Grupo específico (incluir).** Se aplica solo a dispositivos/usuarios en el grupo nombrado.
- **Grupo específico (excluir).** Se aplica a todos excepto a los dispositivos/usuarios en el grupo nombrado.

La mayoría de las plantillas de Panoptica365 vienen con «Todos los dispositivos» o «Todos los usuarios» como asignación por defecto. Esa es la elección correcta para el endurecimiento fundamental. La excepción es cuando el cliente tiene categorías específicas de dispositivos que deben excluirse — dispositivos kiosko, estaciones de trabajo de laboratorio, terminales de punto de venta — que normalmente viven en su propio grupo de Entra y se excluyen de las plantillas estándar.

Error habitual: un operador incluye la cuenta de admin break-glass del cliente en el ámbito de «Todos los usuarios» sin pretenderlo. El dispositivo del admin break-glass recibe la misma configuración de Intune que el resto, lo que puede incluir restricciones que el flujo break-glass depende de poder saltarse. La disciplina break-glass de la tarjeta 3 lección 1 se aplica también aquí: excluye la cuenta break-glass de cualquier plantilla de Intune que afecte al estado de gestión del dispositivo.

### 4. Planifica el despliegue por grupo piloto

Como Intune no tiene el modo Solo informe de AC, el ensayo del operador es un despliegue por grupo piloto. La cadencia estándar:

1. **Día 0** — despliega la plantilla asignada a un grupo piloto (típicamente 1–3 dispositivos de prueba conocidos en buen estado, o los dispositivos del propio equipo de IT).
2. **Días 1–3** — verifica que la plantilla se desplegó correctamente en los dispositivos piloto. Comprueba los contadores de éxito del despliegue en el portal de Intune. Haz una comprobación puntual en un dispositivo piloto para confirmar que los ajustes esperados están realmente aplicados (a veces los ajustes se despliegan con éxito según el portal pero no se aplican en el dispositivo — tiempos de sincronización, políticas en conflicto).
3. **Días 3–7** — verifica la experiencia del cliente en los dispositivos piloto. ¿Se ha roto algo? ¿Se quejan los usuarios? ¿Hay aplicaciones de negocio afectadas?
4. **Día 7** — expande la asignación del grupo piloto al ámbito completo.

Esta ventana es más larga para plantillas que cambian la experiencia del usuario (Security Baseline, ASR Rules, BitLocker) y más corta para plantillas que son de pura monitorización (políticas de cumplimiento, Windows Health Monitoring).

### 5. Documenta lo que esperas y cómo lo vas a verificar

Antes del despliegue, escribe (en el ticket, en el registro de cambios, en algún sitio):

- Qué hace esta plantilla a nivel de cliente.
- A qué dispositivos se aplica.
- Qué esperas ver en el portal de Intune 24 horas después del despliegue.
- Qué pinta tiene el éxito en un dispositivo piloto (valores específicos del Registro, comportamiento concreto de la interfaz, estado específico de cumplimiento).
- Qué hacer si se rompe.

Panoptica365 registra el evento de despliegue automáticamente en el Registro de Cambios del Tenant. El trabajo del operador es hacer que el *resultado esperado* forme parte del registro, no solo el evento de despliegue en sí. Los futuros operadores que lean el rastro de auditoría necesitan saber qué debería haber pasado, no solo qué se desplegó.

## El error de pérdida de asignaciones — nombrado explícitamente

Este es el modo de fallo que describía la historia inicial. Merece un nombre explícito porque es específico de Intune y los operadores caen en él una y otra vez.

Cuando actualizas una plantilla de Intune existente (cambias un ajuste, modificas una configuración), el mecanismo de despliegue en algunos tipos de plantilla de Intune es *borrar-y-recrear* en lugar de actualizar en sitio. Específicamente:

- **Políticas de Settings Catalog (la mayoría de las plantillas):** actualización en sitio. Seguro. El ID de la política se mantiene; las asignaciones se preservan.
- **Device Configurations (BitLocker, Health Monitoring):** también típicamente actualización en sitio.
- **Plantillas Intents / Endpoint Security (Account Protection):** *borrar-y-recrear.* La política antigua se elimina y se crea una nueva. Cualquier exclusión de asignación por-tenant configurada contra el ID de la política antigua no se transfiere a la nueva — se pierde silenciosamente.

La disciplina del operador para sortearlo:

- **Antes de actualizar una plantilla del estilo Intents, captura las asignaciones actuales por tenant** abriendo el portal de Intune de cada cliente y anotando los grupos de asignación + exclusión sobre la política relevante.
- **Después de la actualización, verifica que las asignaciones siguen siendo correctas en cada tenant** — otra vez, por cliente, en el portal de Intune.
- **Si falta alguna, restáuralas a mano.**

Esto es molesto y genuinamente tedioso a través de muchos tenants. Es una restricción impuesta por Microsoft a nivel de API — hasta que Microsoft reemplace el comportamiento borrar-recrear por una actualización en sitio fiable para las plantillas del estilo Intents (en lo que llevan trabajando lentamente), el paso manual de replay de asignaciones es el único camino seguro.

## Lo que esto significa para el operador

Tres puntos para llevarte.

**Intune es más propenso a errores en el despliegue que AC.** La especificidad por plataforma, las tres familias de tipos de plantilla, el error de pérdida de asignaciones, la ausencia de un modo Solo informe — todos estos incrementan la superficie de fallo. Trata los despliegues de Intune con más disciplina previa que los despliegues de AC, no menos.

**El despliegue por grupo piloto es el ensayo del operador.** Úsalo. Saltárselo es el mismo tipo de error que saltarse el modo Solo informe de AC — excepto que las consecuencias aterrizan en dispositivos de usuario, no en la ruta de inicio de sesión en la nube. Es más fácil recuperarse de un mal despliegue de AC que de un mal despliegue de Intune que empujó una mala configuración a 500 endpoints.

**Documenta el resultado esperado, no solo la acción.** El rastro de auditoría de Panoptica365 captura el evento de despliegue automáticamente. El operador captura el resultado esperado y los pasos de verificación. Los futuros operadores necesitan ambos para operar con seguridad la postura de Intune del cliente.

## Lo que viene

El resto de la tarjeta 4 recorre cada plantilla de Intune de Panoptica365:

- **Lección 2: Políticas de cumplimiento** — Windows, iOS, Android, macOS combinados.
- **Lección 3: La Security Baseline** — el paquete curado de endurecimiento de Windows de 60KB.
- **Lección 4: BitLocker Settings** — postura de cifrado de disco.
- **Lección 5: Defender for Endpoint (Win + Mac)** — configuración de antivirus / EDR.
- **Lección 6: Firewall Settings (Windows)** — firewall de host.
- **Lección 7: ASR Rules + Block mshta.exe** — reducción de la superficie de ataque.
- **Lección 8: Account Protection + Block MSA** — Windows Hello, Credential Guard, bloqueo de MSA.
- **Lección 9: El bucle de cumplimiento en producción** — detección de deriva y flujo de señales.
- **Lección 10: Importar tus propias plantillas de Intune** — flujo de personalización.
- **Lección 11: Operar Intune a escala** — deriva, exclusiones, ciclo de vida.

Cada lección asume que has hecho la comprobación previa de arriba. Las lecciones mismas no repiten la lista. Van directamente a *qué hace cada plantilla y cómo desplegarla*.

Por ahora: la comprobación previa es la vacuna. Los despleigues de Intune sin ella son la forma de que los dispositivos del cliente acaben mal configurados a las 16:00 de un viernes.

---

*Fuentes de los datos en esta lección — Microsoft Learn sobre la cadencia de evaluación de cumplimiento de Intune ([Microsoft Learn — Compliance policies](https://learn.microsoft.com/en-us/mem/intune/protect/device-compliance-get-started)); Microsoft Learn sobre los tres tipos de políticas de Intune ([Microsoft Learn — Settings Catalog vs Templates](https://learn.microsoft.com/en-us/mem/intune/configuration/settings-catalog)); referencia del comportamiento de asignación de Intune ([Microsoft Learn — Assign user and device profiles](https://learn.microsoft.com/en-us/mem/intune/configuration/device-profile-assign)).*
