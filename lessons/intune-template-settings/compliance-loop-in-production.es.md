---
title: "El bucle de cumplimiento en producción — deriva, señales y qué vigilar"
subtitle: "Cómo se comporta realmente la señal de cumplimiento Intune→Entra→AC en producción: tiempos, modos de fallo y lo que expone Panoptica365."
icon: "repeat"
last_updated: 2026-05-29
---

# El bucle de cumplimiento en producción — deriva, señales y qué vigilar

La tarjeta 1 lección 3 describió el bucle de cumplimiento como un diagrama de cinco pasos: Intune fija política en el dispositivo → el dispositivo reporta estado → Intune escribe cumplimiento a Entra → AC lee cumplimiento → AC decide. Limpio y abstracto.

En producción, el bucle es más enmarañado. Los dispositivos se van fuera de línea y el bucle se pausa. Las políticas se actualizan y los dispositivos tardan horas en reevaluarse. La evaluación de cumplimiento depende de señales que a su vez dependen de otras señales (Defender debe reportar saludable *y* las firmas deben estar al día *y* el firewall debe estar activo...). Cuando algo se rompe, la pregunta raramente es «¿está roto el bucle de cumplimiento?» — es «*¿cuál* de la docena de cosas que podrían ir mal ha ido mal?».

Esta lección recorre cómo se comporta realmente el bucle de cumplimiento en producción: de dónde vienen las señales, con qué frecuencia se actualizan, qué pinta tienen los modos de fallo, y cómo Panoptica365 expone los patrones que importan.

## El flujo de señal, con tiempos

El estado de cumplimiento visible en una política de AC en el momento de iniciar sesión ha viajado a través de varios sistemas con sus propias cadencias de actualización:

1. **El dispositivo evalúa su propio estado** contra la política de cumplimiento asignada. En Windows, esto típicamente ocurre al arrancar el dispositivo, al iniciar sesión el usuario, en la sincronización con Intune (cada 8 horas por defecto), y bajo demanda si el usuario o el admin disparan una sincronización. Las plataformas móviles tienen cadencias similares pero separadas.
2. **El dispositivo reporta su estado de cumplimiento a Intune.** Es la llamada de red desde el dispositivo → Intune. Requiere que el dispositivo esté en línea; se encola si está fuera de línea.
3. **Intune escribe el atributo de cumplimiento al registro de dispositivo de Entra ID.** Es un paso de sincronización Intune → Entra. Típicamente casi en tiempo real cuando ambos servicios están sanos pero puede tener retraso durante periodos de alta carga.
4. **AC lee el registro de dispositivo de Entra al iniciar sesión.** Es el momento de la evaluación. AC mira el estado actual de cumplimiento del dispositivo en Entra.

El retraso acumulado entre «el estado del dispositivo cambia» y «AC refleja el nuevo estado al iniciar sesión» puede estar en cualquier sitio desde segundos hasta unas 8 horas, dependiendo de en qué punto del ciclo ocurra el cambio. Para la mayoría de los escenarios operativos, el retraso está en el rango de minutos-a-horas.

Esto importa porque los usuarios a veces reportan «arreglé el problema pero sigo bloqueado» — y la respuesta normalmente es «la señal todavía no se ha propagado; inténtalo de nuevo en 30 minutos». Conocer los tiempos te ayuda a establecer las expectativas del usuario correctamente.

## Los modos de fallo

El bucle se rompe de formas identificables. Cada una tiene una remediación distinta.

### «Aún no evaluado»

Un dispositivo muestra estado de cumplimiento «Aún no evaluado» en el registro de dispositivo de Entra. Hay cuatro razones distintas por las que esto puede ocurrir, y necesitan respuestas distintas:

- **El dispositivo es totalmente nuevo en Intune** — recién inscrito, la primera evaluación no ha completado. Se resolverá por sí solo dentro del primer ciclo de sincronización de 8 horas.
- **El dispositivo no se ha sincronizado con Intune en mucho tiempo** — probablemente fuera de línea. Se resolverá cuando el dispositivo vuelva en línea y se resincronice.
- **El cliente de Intune del dispositivo está roto y no sincroniza.** *No* se resolverá por sí solo — necesita intervención del operador (forzar sincronización, reparar el cliente, o reinscribir).
- **El dispositivo no está realmente gestionado por Intune en absoluto.** El ejemplo clásico: un Windows Server que está incorporado en Microsoft Defender for Endpoint pero nunca se ha inscrito en Intune. El servidor aparece en la lista de Dispositivos Gestionados por Intune porque Entra sabe de él, pero no tiene política de cumplimiento de Intune asignada y nunca obtendrá un veredicto de cumplimiento por mucho que esperes. Lo mismo ocurre con dispositivos registrados en Entra pero no inscritos en MDM, dispositivos en un estado de confianza híbrido donde la inscripción en MDM falló, y dispositivos gestionados por otro MDM (raro en pequeña empresa, pero posible). Estos aparecen como «no evaluados» para siempre — no es un estado transitorio, es uno estructural.

Las políticas de AC típicamente tratan «Aún no evaluado» como **no conforme**. Es el valor por defecto seguro — un dispositivo cuyo estado desconocemos no debería recibir acceso de dispositivo-conforme. Las implicaciones difieren según la razón:

- Para las dos primeras razones (transitorias), los usuarios pueden estar bloqueados temporalmente y el acceso se restaura una vez que la evaluación completa. Planifica para esto — la incorporación de dispositivos nuevos no debería ocurrir un viernes por la tarde si el usuario necesita iniciar sesión durante el fin de semana.
- Para la tercera razón (cliente roto), los usuarios siguen bloqueados hasta que el problema subyacente se arregle. Investiga por dispositivo.
- Para la cuarta razón (no gestionado por Intune), el dispositivo *permanentemente* fallará cualquier política de AC que exija dispositivo conforme. Esto normalmente no importa para servidores (no inician sesión en M365 interactivamente), pero ocasionalmente sorprende a un operador que ha puesto un ámbito de AC «exigir dispositivo conforme» que accidentalmente incluye cuentas de servicio corriendo en esos servidores. Si alguna vez ves una cuenta de servicio bloqueada por AC que funcionaba ayer, comprueba si el dispositivo en el que corre está gestionado por Intune — si no lo está, la política de AC y el estado de inscripción del dispositivo son fundamentalmente incompatibles.

### «No conforme» persistente

Un dispositivo muestra no conforme durante horas o días y no se recupera. Causas:

- Un ajuste requerido no está realmente en su sitio. Defender está deshabilitado, BitLocker está apagado, el firewall está deshabilitado. La comprobación de cumplimiento está pillando la brecha correctamente.
- Un ajuste requerido está en su sitio pero la evaluación de Intune lo reporta mal. Habitual con: las firmas de Defender brevemente obsoletas durante una actualización, BitLocker temporalmente deshabilitado para una operación de recuperación, el firewall brevemente apagado durante un reinicio de servicio.
- El reporte del dispositivo está fuera de sincronía. El dispositivo está realmente bien pero su estado auto-reportado no se ha refrescado.

Para no conformidad persistente que dure más de 24 horas, el flujo es:

1. Comprueba el portal de Intune para la razón concreta del fallo. El estado de cumplimiento muestra *por qué* el dispositivo es no conforme — qué comprobación específica falló.
2. Verifica en el propio dispositivo. Usa `Get-MpComputerStatus` (PowerShell) para el estado de Defender, `manage-bde -status` para BitLocker, la UI de Defender Firewall para el estado del firewall.
3. Si el dispositivo es genuinamente no conforme, arregla el problema subyacente. Reactiva Defender, completa el cifrado de BitLocker, vuelve a encender el firewall.
4. Si el dispositivo está bien pero Intune lo reporta mal, fuerza una sincronización (Ajustes → Cuentas → Acceder al trabajo o centro educativo → Sincronizar, o ejecuta `dsregcmd /sync` en PowerShell). Espera 30 minutos a que el nuevo estado se propague.
5. Si la sincronización no lo resuelve, el cliente de Intune del dispositivo puede necesitar reparación o reinscripción.

### Flapping de cumplimiento

Un dispositivo oscila entre conforme y no conforme rápidamente — cada pocas horas, cada día, en su propio calendario. Esto es «flapping» y es uno de los patrones más molestos de diagnosticar. Causas habituales:

- **Tiempos de las firmas de Defender.** Las firmas de Defender expiran en una cadencia regular. Si la actualización llega ligeramente después de la evaluación de cumplimiento, el dispositivo pasa a no conforme brevemente hasta que llega la siguiente actualización de firmas.
- **Conflicto entre perfiles de configuración.** Dos perfiles de configuración de Intune configuran el mismo ajuste de forma distinta. El dispositivo alterna entre los dos estados según cuál se aplicó más recientemente.
- **Deshabilitación iniciada por el usuario.** Un usuario con derechos de admin local deshabilita Defender (u otro servicio requerido), la comprobación de cumplimiento lo pilla, el dispositivo es no conforme. El usuario vuelve a encender Defender (o se reinicia automáticamente según un calendario). El dispositivo vuelve a conforme. Se repite.
- **Condición de carrera en los tiempos de sincronización.** La evaluación de cumplimiento corre en un calendario ligeramente distinto al de la aplicación del perfil de configuración. Un dispositivo que está justo al borde de un umbral puede oscilar de un lado a otro según qué comprobación ocurrió más recientemente.

El flapping suele arreglarse identificando la causa subyacente. Detectarlo hoy es manual — observa el historial de cumplimiento por-dispositivo del portal de Intune para dispositivos que han oscilado de estado varias veces en una ventana corta, e investiga esos específicamente.

### Conforme pero roto

Un dispositivo muestra conforme pero el usuario no puede iniciar sesión en M365. La política de AC está exigiendo dispositivo conforme, el dispositivo es conforme, y sin embargo el inicio de sesión falla. Esto es raro pero pasa. Causas:

- **Objeto de dispositivo en Entra obsoleto.** El registro de dispositivo en Entra está duplicado o huérfano de inscripciones anteriores. AC lee un registro de dispositivo distinto del que Intune está reportando.
- **Discrepancia de estado de confianza.** La unión híbrida a Azure AD está rota; el dispositivo cree que está unido en híbrido pero Entra tiene una vista distinta.
- **Discrepancia de condición de política de AC.** La política de AC lee una señal de cumplimiento específica que es distinta del estado general de cumplimiento.

Para estos casos, el dispositivo normalmente necesita ser limpiado — desunir y reunir Entra, reparar el estado de confianza, o eliminar el registro de dispositivo huérfano manualmente.

### Bucle de cumplimiento roto silenciosamente

El peor modo de fallo: el bucle parece estar funcionando pero no lo está. Un dispositivo es no conforme en el SO pero Intune lo está reportando conforme. AC concede acceso. Nadie lo nota porque nada aflora como problema.

Las causas suelen ser estructurales — cliente de Intune manipulado, malware afectando al agente de reporte, estado profundamente roto de una inscripción chapuza. Estos casos son raros pero merece la pena conocerlos: no asumas que el estado de cumplimiento es verdadero solo porque se reporte como verdadero. Comprobaciones puntuales periódicas en dispositivos aleatorios, comparando el estado reportado con el estado real, son una práctica útil de auditoría.

## El papel de Windows Health Monitoring

La biblioteca de Panoptica365 incluye una pequeña plantilla (595 bytes) llamada **Windows Health Monitoring**. Hace una sola cosa:

- Habilita `allowDeviceHealthMonitoring`.
- Limita la monitorización a `bootPerformance,windowsUpdates`.

Esta plantilla configura Windows para recoger telemetría de salud sobre el rendimiento de arranque y la actividad de Windows Update. Los datos alimentan a la vista de salud de dispositivo de Intune y a Endpoint Analytics si el cliente lo tiene habilitado.

No es un control de seguridad. Es un control de *observabilidad*. Le cuenta al operador cómo se está comportando el parque Windows del cliente a lo largo del tiempo — arranques lentos, fallos frecuentes, fallos repetidos de actualización. Los datos son útiles para diagnóstico proactivo («este dispositivo va a fallar pronto»), no para evaluación de cumplimiento.

Para los propósitos del bucle de cumplimiento de Panoptica365, Windows Health Monitoring es esencialmente invisible — los datos no fluyen al estado de cumplimiento. Pero vale la pena saber que la plantilla existe y qué hace, porque los operadores que miren el portal de Intune la verán desplegada junto a las plantillas de seguridad.

## Cómo expone Panoptica365 el bucle de cumplimiento

El panel del cliente de Panoptica365 toma una rebanada deliberadamente fina del bucle de cumplimiento. Tres superficies, todas de alto nivel:

**La lista de Dispositivos Gestionados por Intune.** Cada dispositivo inscrito en Intune, con SO, estado actual de cumplimiento (conforme / no conforme / no evaluado), usuario asignado y timestamp de la última sincronización. El cubo «no evaluado» también cubre dispositivos que Intune no gestiona en absoluto (como Windows Server) — aparecen en la lista porque Entra sabe de ellos, pero nunca obtienen un veredicto de cumplimiento. La tabla que escaneas cuando algo huele mal.

**El tile «Dispositivos Conformes».** Porcentaje como titular (p. ej., «94%» o «60%»), coloreado por postura — verde cuando saludable, rojo cuando débil. El subtítulo dice «X de Y conformes, Z no evaluados», dándote tres números en una línea: cuántos dispositivos evaluó Panoptica365, cuántos de esos pasaron, y cuántos dispositivos inscritos nunca obtuvieron veredicto en absoluto. El denominador del porcentaje es el conjunto evaluado; los no evaluados se exponen por separado en lugar de tirar la ratio hacia abajo. Aparece una flecha de tendencia cuando el porcentaje se mueve entre sondeos — roja hacia abajo en una caída, verde hacia arriba en una mejora. El punto: no tienes que recordar el número de ayer para saber en qué dirección se está moviendo el cliente.

**Dispositivos por SO.** Un desglose por cuenta por sistema operativo (Windows, Windows Server, iOS, Android, etc.). Útil para comprobar la mezcla de plataformas y para notar cuando una cuenta se mueve inesperadamente (un Mac nuevo aparece, un grupo de dispositivos Windows desaparece).

Esa es la superficie. Panoptica365 **no** expone, en el panel, las cosas que podrías esperar de un «panel de cumplimiento» en el sentido más pesado:

- Un desglose de «principales razones de no conformidad» a lo largo del parque
- Una cola de triaje de «no conforme durante más de 24 horas»
- Una lista de dispositivos en flapping
- Llamadas explícitas a la razón de fallo por-dispositivo

Esas investigaciones ocurren en el propio portal de Intune, dispositivo a dispositivo. El reparto es intencional: Panoptica365 te dice *que* el cumplimiento se está moviendo — el contador cayó, un dispositivo cayó a desconocido, la postura general del tenant se está debilitando. La consola de Intune de Microsoft te dice *por qué* — qué comprobación específica falló, qué ajuste falta, cuál fue el último error del dispositivo.

La implicación para los operadores: usa la vista de cumplimiento de Panoptica365 como cable trampa (escaneo diario, busca cambios) e Intune como la consola de diagnóstico (profundiza una vez que algo parezca mal). Saltarse cualquiera de los lados rompe el flujo — Panoptica365 sola te da la señal sin el diagnóstico; Intune sola te hace iniciar sesión en 30 portales uno a uno para notar la señal en primer lugar.

## Qué hacen los operadores realmente con esto

El flujo de trabajo del día-a-día del operador en torno al bucle de cumplimiento:

**Comprobación matinal (semanal como mínimo, diaria como ideal):** abre el panel del cliente. Mira el tile de dispositivos (contador de conformes, contador de evaluados, total). Si la ratio de conformes ha caído frente a lo que recuerdas de ayer, o la brecha de «desconocidos» se ha ensanchado, escanea la lista de Dispositivos Gestionados por Intune buscando outliers — dispositivos que cayeron a desconocido, dispositivos con timestamps de última sincronización obsoletos, dispositivos que no reconoces.

**Triaje por incidente:** cuando un usuario reporta que no puede iniciar sesión en M365 porque su dispositivo no es conforme, el playbook es el triaje de modo de fallo del principio de esta lección. Abre el dispositivo en el portal de Intune, lee la razón concreta del fallo, verifica en el dispositivo, fuerza la sincronización si es necesario, arregla el problema subyacente.

**Revisión mensual:** para cada cliente, abre el portal de Intune y mira las razones de cumplimiento por-dispositivo a lo largo de los dispositivos no conformes. Reconocimiento de patrones manual: si «Defender deshabilitado» aparece en dispositivos a lo largo de varios clientes, puede haber un script de despliegue o herramienta de RMM deshabilitando Defender inadvertidamente. Si «BitLocker no habilitado» está apareciendo, puede haber hardware (dispositivos sin TPM) que no está pillando la plantilla de BitLocker. Este es trabajo genuinamente manual hoy — Panoptica365 no agrega las razones para ti a lo largo del parque, así que el reconocimiento de patrones depende de que el operador haga los drill-downs.

**Auditoría trimestral:** haz una comprobación puntual de unos pocos dispositivos conformes aleatorios por cliente. Compara el estado reportado con el estado real. Confirma que el bucle está funcionando para esos dispositivos. Normalmente todo bien; ocasionalmente saca a la luz el modo de fallo «roto silenciosamente» que nada más pilla.

## Lo que esto significa para el operador

Tres puntos para llevarte.

**El bucle de cumplimiento tiene tiempos. Comunícaselo a los usuarios.** Cuando un usuario arregla su dispositivo y sigue bloqueado, la explicación más probable es el retraso de propagación, no un problema más profundo. Decirle que espere 30 minutos y vuelva a intentarlo resuelve la mayoría de los casos.

**La no conformidad persistente es una cola de triaje, no un arreglo único.** Los dispositivos aparecen en no conformidad por muchas razones; algunos necesitan atención inmediata (brecha de seguridad), algunos necesitan paciencia (retraso de sincronización), algunos necesitan remediación (cliente de Intune roto). Trata la lista como una responsabilidad operativa recurrente.

**Haz comprobaciones puntuales del caso roto silenciosamente trimestralmente.** El fallo más insidioso del bucle de cumplimiento es el que nunca aflora como problema. Las auditorías de dispositivos aleatorios lo pillan donde nada más lo hace.

## Lo que viene

- **Lección 10: Importar tus propias plantillas de Intune.** Cuando la biblioteca empaquetada no cubre lo que necesitas.
- **Lección 11: Operar Intune a escala.** Deriva, exclusiones, ciclo de vida.

Por ahora: el bucle de cumplimiento es la base que hace que todo en la tarjeta 4 sea *valioso*. Sin monitorizarlo en producción, las plantillas se despliegan pero su efecto es invisible. Trata el panel de cumplimiento como una superficie operativa diaria.

---

*Fuentes de los datos en esta lección — Microsoft Learn sobre la cadencia de evaluación de políticas de cumplimiento ([Microsoft Learn — Compliance policies](https://learn.microsoft.com/en-us/mem/intune/protect/device-compliance-get-started)); referencia de los tiempos de sincronización de Intune ([Microsoft Learn — Common ways to use Intune](https://learn.microsoft.com/en-us/mem/intune/remote-actions/device-sync)); monitorización de salud de dispositivos ([Microsoft Learn — Endpoint Analytics](https://learn.microsoft.com/en-us/mem/analytics/overview)).*
