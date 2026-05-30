---
title: "Políticas de cumplimiento — definiendo «conforme» a través de cuatro plataformas"
subtitle: "Las cuatro políticas de cumplimiento de Panoptica365 — Windows, iOS, Android, macOS — y el listón mínimo que cada una aplica."
icon: "monitor-check"
last_updated: 2026-05-29
---

# Políticas de cumplimiento — definiendo «conforme» a través de cuatro plataformas

Una política de cumplimiento es el documento que responde a una sola pregunta: *¿qué significa que un dispositivo se considere «conforme» en el tenant de este cliente?*

La respuesta alimenta directamente al Acceso Condicional. Cuando una política de AC dice «exigir dispositivo conforme» (el patrón anti-AiTM de la tarjeta 3 lección 4), la señal de cumplimiento del dispositivo que lee viene de la política de cumplimiento que tú escribiste. No del perfil de configuración de Intune que *aplica* ajustes en el dispositivo — la política de cumplimiento que *evalúa* si el dispositivo alcanza el listón.

Esta distinción importa y se confunde a menudo. La plantilla BitLocker Settings de Panoptica365 *hace que BitLocker ocurra* en los dispositivos Windows. La política de Windows Compliance de Panoptica365 *comprueba si BitLocker está activado* y reporta conforme o no conforme en consecuencia. Mismo resultado (BitLocker habilitado), dos políticas distintas haciendo trabajos distintos. Necesitas las dos.

Esta lección recorre las cuatro políticas de cumplimiento de la biblioteca de Panoptica365: Windows, iOS/iPadOS, Android y macOS. Cada una es pequeña (menos de 2KB de JSON), opinionada e intencionadamente laxa — definen el listón mínimo, no el objetivo aspiracional.

## Las cuatro políticas

### Panoptica365 - Windows Compliance

La política de cumplimiento de Windows es la más consecuente porque Windows es la plataforma de dispositivos gestionados dominante en los entornos MSP de pequeña empresa. Lo que comprueba realmente:

- **Defender habilitado** (`defenderEnabled: true`) — Microsoft Defender Antivirus debe estar funcionando.
- **Protección en tiempo real habilitada** (`rtpEnabled: true`) — RTP tiene que estar activa, no solo instalada.
- **Antivirus requerido** (`antivirusRequired: true`) — debe haber un antivirus presente.
- **Anti-spyware requerido** (`antiSpywareRequired: true`) — motor anti-spyware presente.
- **Firewall activo requerido** (`activeFirewallRequired: true`) — Windows Defender Firewall debe estar activo.
- **Comprobación de firmas desactualizadas** (`signatureOutOfDate: true`) — marca los dispositivos con firmas de AV obsoletas.
- **Protección de amenazas del dispositivo habilitada** (`deviceThreatProtectionEnabled: true`) en nivel `low` — Defender for Endpoint no debe reportar amenazas de alta confianza.

Lo que *deliberadamente no comprueba:*

- **BitLocker** *no* es obligatorio. (Fíjate en el `bitLockerEnabled: false`.) Es una elección real. La aplicación de BitLocker se hace vía la plantilla BitLocker Settings (lección 4); la política de cumplimiento no lo exige.
- **Contraseña** *no* es obligatoria. (`passwordRequired: false`.) La aplicación de contraseñas de Windows viene de la Security Baseline (lección 3) o de la Group Policy en otro sitio.
- **TPM** *no* es obligatorio. (`tpmRequired: false`.) La mayoría del hardware Windows moderno tiene TPM, pero exigirlo haría fallar el cumplimiento de los dispositivos más antiguos del parque.
- **Secure Boot** *no* es obligatorio. Mismo motivo.
- **Versión mínima del SO** *no* está fijada. La política de cumplimiento no exige Windows 11 ni ninguna compilación específica.

¿Por qué la laxitud? Porque la política de cumplimiento es el *listón mínimo para el control de dispositivo-conforme de AC*. Si lo pones demasiado alto, dispositivos que por lo demás están correctamente configurados fallan el cumplimiento y pierden acceso a M365 — incluso cuando no hay nada mal con ellos desde el punto de vista de seguridad. La política de Windows Compliance de Panoptica365 peca por el lado de «si Defender está corriendo, este dispositivo es lo bastante conforme para acceder a M365». El endurecimiento más allá de ese listón ocurre en las plantillas de configuración (BitLocker, Security Baseline, ASR Rules) — separadamente de la evaluación de cumplimiento.

Es una elección *defendible*. Otro MSP podría exigir BitLocker como criterio de cumplimiento. El compromiso: criterios de cumplimiento más estrictos atrapan más brechas de seguridad pero también producen más hallazgos falsos positivos de no conformidad cuando el estado del dispositivo está brevemente inconsistente (BitLocker temporalmente deshabilitado para una operación de recuperación, firmas brevemente obsoletas durante una ventana de actualización, etc.). El listón laxo prioriza la estabilidad de la señal dispositivo-conforme de AC sobre el endurecimiento agresivo.

### Panoptica365 - iOS/iPadOS Compliance

El cumplimiento móvil es ligero por diseño. Los dispositivos iOS en el contexto de pequeña empresa son abrumadoramente BYOD — teléfonos personales usados para leer correo corporativo. La inscripción completa en MDM en un teléfono personal es algo a lo que los usuarios oponen resistencia y muchos MSP no intentan forzar.

Lo que comprueba la política iOS:

- **Código de acceso requerido** (`passcodeRequired: true`) — el dispositivo debe tener un código de acceso.
- **Longitud mínima del código: 4 caracteres.**
- **Máximo 5 minutos de inactividad antes del bloqueo** (`passcodeMinutesOfInactivityBeforeLock: 5`).
- **Bloqueo de los últimos 24 códigos** — no puedes reutilizar los últimos 24 códigos.
- **Detección de jailbreak** (`securityBlockJailbrokenDevices: true`) — bloquea dispositivos marcados como jailbroken.

Lo que no comprueba:

- **Versión mínima del SO** no está fijada. iOS recibe actualizaciones de seguridad agresivamente; los usuarios suelen estar en versiones actuales; exigir un mínimo específico atraparía un número pequeño de dispositivos en versiones de iOS antiguas que probablemente no pueden actualizarse de todas formas.
- **Protección de amenazas del dispositivo** no es obligatoria (Defender for Endpoint en iOS existe pero no es estándar para BYOD de pequeña empresa).
- **Perfil de correo gestionado** no es obligatorio. Los usuarios acceden al correo a través de su aplicación de consumo Outlook/Apple Mail, no a través de una configuración gestionada.

El encuadre honesto: esta política asegura lo básico (código de acceso + pantalla de bloqueo + no-jailbreak) y acepta que el resto del endurecimiento de dispositivo móvil está fuera del ámbito del MSP de pequeña empresa. Si un cliente quiere MDM móvil más estricto, quiere una relación distinta con su MSP.

### Panoptica365 - Android Compliance

La política Android está configurada para el modo **Android Open Source Project (AOSP) Device Owner** — el modelo de Android Enterprise. Lo que comprueba:

- **Cifrado de almacenamiento requerido** (`storageRequireEncryption: true`) — el cifrado del dispositivo debe estar habilitado.
- **Contraseña requerida** (`passwordRequired: true`).
- **15 minutos de inactividad antes del bloqueo** (`passwordMinutesOfInactivityBeforeLock: 15`).
- **Detección de jailbreak / root** (`securityBlockJailbrokenDevices: true`).

Notablemente ausente: versión mínima del SO, nivel mínimo del parche de seguridad de Android, verificación de aplicaciones. Mismo razonamiento que iOS — estos harían fallar el cumplimiento en dispositivos que los clientes no pueden actualizar fácilmente.

El modo AOSP Device Owner es específicamente para dispositivos Android *propiedad de la empresa, totalmente gestionados*. Para dispositivos Android *de propiedad personal* usando un perfil de trabajo, la estructura de la política de cumplimiento es ligeramente distinta y no está representada en la biblioteca de Panoptica365. Si un cliente tiene un parque significativo de Android-BYOD, esta plantilla no cubre ese escenario directamente — y el ámbito móvil de Panoptica365 es «señal de cumplimiento para lo que está inscrito, nada más».

### Panoptica365 - macOS Compliance

macOS recibe menos atención en la mayoría de los contextos MSP de pequeña empresa porque el parque es pequeño. La política de cumplimiento refleja eso:

- **Contraseña requerida** (`passwordRequired: true`).
- **Longitud mínima de la contraseña: 6 caracteres.**
- **Cifrado de almacenamiento requerido** (`storageRequireEncryption: true`) — FileVault debe estar activo.
- **Firewall habilitado** (`firewallEnabled: true`) — firewall de macOS activo.
- **El firewall bloquea todo el tráfico entrante** (`firewallBlockAllIncoming: true`) — bloqueo entrante estricto.

Notablemente *no* requerido: System Integrity Protection (SIP). La mayoría de las instalaciones modernas de macOS tienen SIP habilitado por defecto, pero puede ser deshabilitado por usuarios sofisticados. La política de cumplimiento no lo exige.

También notable: `gatekeeperAllowedAppSource: "anywhere"` — la política de cumplimiento no impone restricciones de Gatekeeper sobre las fuentes de aplicaciones. Es permisiva; una política más estricta pondría esto en `macAppStore` o `macAppStoreAndIdentifiedDevelopers`. El valor por defecto de Panoptica365 acepta lo que sea que el cliente haya configurado a nivel del SO.

Para la mayoría de los tenants de pequeña empresa con uno o dos usuarios de Mac, este listón de cumplimiento es apropiado. Para clientes con parques sustanciales de Mac (agencias creativas, empresas de desarrollo), el operador debería plantearse endurecer esta plantilla mediante el flujo de personalización de la lección 10.

## La señal de cumplimiento vs la configuración

Un patrón que vale la pena nombrar explícitamente: la biblioteca de Panoptica365 trata el cumplimiento y la configuración como asuntos separados. Cada política de cumplimiento se empareja con una o más plantillas de configuración que *hacen* que el dispositivo alcance ese listón.

Para Windows:
- La política de cumplimiento dice «Defender debe estar habilitado» → la configuración la entrega la plantilla Defender Settings (lección 5).
- La política de cumplimiento dice «el firewall debe estar activo» → la configuración la entrega la plantilla Firewall Settings (lección 6).
- (BitLocker no está en el listón de cumplimiento pero SÍ está en la configuración → plantilla BitLocker Settings, lección 4.)

Para macOS *sí* hay una plantilla de configuración emparejada — **Panoptica365 - Defender Settings macOS** (cubierta en la lección 5). Activa Defender para macOS, habilita la protección en tiempo real y habilita el envío automático de muestras. Así que el par macOS existe, pero es estructuralmente más ligero que el par Windows — y la razón es Microsoft, no Panoptica365. La política de cumplimiento macOS en Intune expone exactamente estos criterios: System Integrity Protection, versión del SO, reglas de contraseña, FileVault, firewall + modo silencioso, y Gatekeeper. Esa es la lista completa. Sin fila de Defender, sin fila de protección en tiempo real, sin nivel de Protección de Amenazas del Dispositivo (que en Windows es la señal de salud de Defender-for-Endpoint). Puedes *configurar* Defender en macOS vía la plantilla de configuración; no puedes *comprobar* su estado a través de la política de cumplimiento en absoluto. La política de cumplimiento de macOS de Panoptica365 por tanto comprueba las cosas que Microsoft expone, y la plantilla Defender Settings macOS gestiona la parte de configuración sin un control de cumplimiento que case con ella. Si te has preguntado por qué la historia de macOS se siente a medio terminar, esta es la razón.

Para iOS y Android: no hay plantilla de configuración emparejada en la biblioteca de Panoptica365 — solo la política de cumplimiento. La configuración es responsabilidad del usuario (él pone su propio código de acceso, él mantiene el cifrado activado).

Esta separación refleja el modelo de negocio real: gestión completa de configuración-más-cumplimiento en Windows (porque el MSP efectivamente posee esos dispositivos a través del cliente); un par de configuración más ligero en macOS limitado por lo que la API de cumplimiento de Microsoft soporta; señal-de-cumplimiento-solamente en iOS y Android (porque el MSP no posee esos dispositivos y no puede empujar configuración).

La conclusión honesta: un cliente que quiere que sus iPhones, iPads o dispositivos Android estén *gestionados* (no solo *comprobados para cumplimiento*) necesita una conversación distinta. La biblioteca empaquetada de Panoptica365 no cubre ese escenario por diseño. Los operadores que lo necesiten — o que necesiten configuración macOS más profunda más allá de Defender — pueden construir sus propias plantillas de configuración e importarlas mediante el flujo de la lección 10.

## Despliegue

Las políticas de cumplimiento se despliegan en estado Habilitado, como todas las plantillas de Panoptica365. Para estas políticas específicas, el enfoque de desplegar-en-caliente es casi siempre seguro — el listón es intencionadamente bajo y las comprobaciones son conservadoras:

- Un dispositivo Windows nuevo con Defender corriendo pasa inmediatamente.
- Un iPhone nuevo con código de acceso y sin jailbreak pasa inmediatamente.
- Un Mac nuevo con FileVault activado pasa inmediatamente.

El despliegue por grupo piloto de la comprobación previa de la lección 1 sigue siendo recomendable, pero la ventana de verificación es corta — 24–48 horas suele bastar. Busca:

- Dispositivos marcados como **Aún no evaluados** que deberían haberse evaluado ya (indica rotura del bucle de cumplimiento — ver lección 9).
- Dispositivos marcados como **No conformes** por una razón que te sorprenda. Sorpresa habitual: una ventana de temporización de firmas de Defender donde un dispositivo aparece brevemente no conforme por obsolescencia.
- Dispositivos que *no aparecen* en la evaluación de cumplimiento en absoluto. Normalmente significa que no están inscritos en Intune y la política no tiene destinatario.

Después de la aplicación (que para las políticas de cumplimiento es «desplegada y siendo evaluada»), monitoriza:

- **Ratio general de cumplimiento.** El tile de dispositivos de Panoptica365 te da el titular (p. ej., «32/57 conformes»). Saludable es 95%+ conformes para el conjunto evaluado. Por debajo del 90% significa que algo estructural está mal — plantilla mal configurada, problema de infraestructura, o un grupo de dispositivos que no deberían estar inscritos.
- **Comprobación de salud por plataforma.** Usa el desglose de Dispositivos por SO para confirmar que la mezcla de plataformas es la que esperas. Si ves contadores que se mueven inesperadamente (un grupo de dispositivos Windows desaparece, aparece un SO desconocido), eso merece investigación.
- **Razones habituales de no conformidad.** Profundiza en los dispositivos no conformes en el portal de Intune y lee la razón concreta del fallo — Microsoft expone qué comprobación falló por dispositivo. Si «Defender deshabilitado» aparece en varios dispositivos, tienes un problema real (Defender no debería estar apagado en máquinas Windows gestionadas). Unos pocos sueltos son ruido; un grupo con la misma razón es señal. Panoptica365 no agrega estas razones por ti, así que el reconocimiento de patrones es trabajo manual en el portal de Intune.
- **Dispositivos que oscilan repetidamente entre conforme y no conforme.** Esto es «flapping de cumplimiento» — normalmente un problema de temporización de sincronización o un ajuste aplicado de forma desigual por una plantilla de configuración. Pillarlo es manual: nota en el portal de Intune que un dispositivo ha cambiado de estado varias veces en una semana, luego investiga por dispositivo. La lección 9 recorre los modos de fallo.

## Qué ve Panoptica365

El estado de cumplimiento por dispositivo fluye a Panoptica365 desde Microsoft Graph. El panel del cliente saca a la superficie tres cosas al respecto, deliberadamente mantenidas a alto nivel:

- **La lista de Dispositivos Gestionados por Intune** — cada dispositivo inscrito con su SO, el estado actual de cumplimiento (conforme / no conforme / no evaluado), el usuario asignado y el timestamp de la última sincronización. El cubo «no evaluado» incluye cosas como los Windows Server que Intune no gestiona en absoluto — aparecen porque están registrados en Entra pero nunca obtienen un veredicto de cumplimiento.
- **Un tile de «Dispositivos Conformes»** — el titular es el porcentaje de cumplimiento en tipografía grande (p. ej., «94%» o «60%»), coloreado según la postura (verde cuando sano, rojo cuando débil). El subtítulo dice «X de Y conformes, Z no evaluados» — tres números que te cuentan toda la historia: cuántos dispositivos evaluó Panoptica365 con éxito, cuántos de esos pasaron y cuántos dispositivos inscritos nunca recibieron veredicto (típicamente servidores que Intune no gestiona, dispositivos recién inscritos aún en su primera ventana de sincronización, o dispositivos con clientes de Intune rotos). Cuando el porcentaje cambia entre sondeos, una flecha de tendencia muestra la dirección — roja hacia abajo en una caída, verde hacia arriba en una mejora.
- **Dispositivos por SO** — un desglose por cuenta (Windows N, iOS N, Android N, Windows Server N, etc.).

Esa es la superficie. La razón del fallo por dispositivo, la cola de triaje >24 horas, el patrón de flapping — esos no viven en el panel de Panoptica365. Viven en el portal de Intune, dispositivo a dispositivo. La plataforma señala *que* algo va mal (un dispositivo cayó del conforme, el contador de conformes bajó); Microsoft te dice *por qué*.

Esto es consistente con cómo se posiciona Panoptica365 en general — solo lectura, orientado a alertas, profundiza en las consolas propias de Microsoft para el diagnóstico hondo. La lección del bucle de cumplimiento (lección 9) recorre cómo es la monitorización operativa en la práctica con este reparto.

## Lo que esto significa para el operador

Tres puntos para llevarte.

**El cumplimiento es un listón, no una configuración.** Estas cuatro políticas *evalúan* dispositivos; no *configuran* dispositivos. Las plantillas de configuración de las lecciones 3–8 hacen la configuración. Ambas son necesarias.

**Los listones de cumplimiento laxos son una característica, no un defecto.** Una política de cumplimiento estricta que pilla cada inconsistencia del estado del dispositivo produce una señal de AC ruidosa. Los valores por defecto de Panoptica365 pecan por el lado de la estabilidad. Los clientes que necesitan cumplimiento más estricto (industrias reguladas, endurecimiento posterior a incidentes) pueden personalizar — pero los valores por defecto son apropiados para la mayoría de los tenants de pequeña empresa.

**El cumplimiento móvil y de macOS son declaraciones de ámbito tanto como controles de seguridad.** Le dicen al cliente «esto es lo que comprobamos; esto es lo que no». Los operadores que quieren una gestión más profunda de móvil/macOS necesitan construir sus propias plantillas (lección 10) o aceptar que esas plataformas se gestionan ligeramente.

## Lo que viene

- **Lección 3: La Security Baseline.** El paquete curado de endurecimiento de Windows — tu plantilla individual más grande.
- **Lección 4: BitLocker Settings.** Configuración de cifrado de disco que la política de cumplimiento de Windows *no* exige pero que la postura de endurecimiento de Panoptica365 sí despliega.

Por ahora: despliega las cuatro políticas de cumplimiento como una unidad. Son la base para el camino de dispositivo-conforme de AC. Sin ellas, las plantillas de las tarjetas 3.4 y 3.5 no tienen nada contra lo que leer.

---

*Fuentes de los datos en esta lección — Microsoft Learn sobre la estructura de las políticas de cumplimiento ([Microsoft Learn — Device compliance policies](https://learn.microsoft.com/en-us/mem/intune/protect/device-compliance-get-started)); referencia de la política de cumplimiento de Windows ([Microsoft Learn — Windows 10/11 compliance settings](https://learn.microsoft.com/en-us/mem/intune/protect/compliance-policy-create-windows)); ajustes de cumplimiento de iOS ([Microsoft Learn — iOS/iPadOS compliance settings](https://learn.microsoft.com/en-us/mem/intune/protect/compliance-policy-create-ios)); cumplimiento de Android Enterprise ([Microsoft Learn — Android Enterprise compliance settings](https://learn.microsoft.com/en-us/mem/intune/protect/compliance-policy-create-android-for-work)); cumplimiento de macOS ([Microsoft Learn — macOS compliance settings](https://learn.microsoft.com/en-us/mem/intune/protect/compliance-policy-create-mac-os)).*
