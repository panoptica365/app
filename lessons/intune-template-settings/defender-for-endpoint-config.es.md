---
title: "Configuración de Defender for Endpoint — Windows + macOS"
subtitle: "28 ajustes Windows y 3 macOS que endurecen los valores de fábrica de Defender Antivirus frente al robo de credenciales, AiTM y preparación de ransomware."
icon: "shield"
last_updated: 2026-05-29
---

# Configuración de Defender for Endpoint — Windows + macOS

Un endpoint Windows con Microsoft Defender Antivirus corriendo en su modo de fábrica está razonablemente protegido contra malware drive-by. Está mucho menos protegido contra el tipo de ataques que la tarjeta 2 pasó siete lecciones describiendo — robo de credenciales, AiTM, continuación BEC, preparación de ransomware — porque la configuración por defecto deja varias de las capacidades de detección más fuertes de Defender mal afinadas.

Las plantillas Defender Settings de Panoptica365 existen para endurecer esa configuración por defecto. La plantilla Windows configura 28 comportamientos específicos de Defender Antivirus; la plantilla macOS configura tres. Ambas son necesarias si el cliente tiene dispositivos en la plataforma correspondiente.

Esta lección recorre lo que cada plantilla configura, las elecciones que importan, y las realidades operativas de hacer correr Defender a escala de producción.

## Defender Settings Windows — qué configura

La plantilla Defender Settings Windows de Panoptica365 usa el tipo de plantilla Settings Catalog (`configurationPolicies`) con plataformas puestas en `windows10` y tecnologías `mdm,microsoftSense`. El `templateDisplayName` es «Microsoft Defender Antivirus» y la familia de la plantilla es `endpointSecurityAntivirus`. En otras palabras: esto es fundamentalmente una configuración de Defender *Antivirus*, desplegada a través del área de política Endpoint Security de Intune (la misma superficie donde viven las configuraciones de MDE / Defender XDR). El marcador de tecnología `microsoftSense` señala que la plantilla integra con la cartera de Defender for Endpoint; no significa que la plantilla configure ajustes de la capa EDR. Cada uno de los 28 ajustes afina el comportamiento de Defender Antivirus.

Los valores específicos de esta plantilla no son arbitrarios — la mayoría siguen la [serie MDE de Jeffrey Appel](https://jeffreyappel.nl/tag/mde-series/), una referencia práctica de endurecimiento ampliamente citada en la comunidad de seguridad M365. Appel es un MVP de seguridad de Microsoft que recorre los ajustes individuales de Defender con el razonamiento detrás de cada uno. Por eso la postura de la plantilla aterriza en el extremo agresivo de lo que Microsoft considera razonable en lugar de en el término medio — sigue una baseline curada por expertos en lugar de valores improvisados. Los operadores que quieran entender por qué un ajuste es como es, o necesiten defender una elección ante un cliente, pueden encontrar el escrito correspondiente en la serie.

Los ajustes se agrupan en cuatro clústeres funcionales:

### 1. Protección en la nube y ciclo de vida de las firmas

Los ajustes más consecuentes. La capacidad moderna de detección de Defender depende fuertemente de la protección entregada por la nube — la coincidencia de patrones, el análisis de comportamiento y la inteligencia de amenazas ocurren en la nube de Microsoft, no en el dispositivo.

- **`allowcloudprotection`** — protección en la nube habilitada.
- **`cloudblocklevel`** = **High Plus** (valor 4). La escala de Microsoft va Default → Moderate → High → High Plus → Zero Tolerance. La plantilla se salta el medio y aterriza en el segundo más agresivo. Más bloqueos, más falsos positivos, más confianza en que los archivos sospechosos se detienen.
- **`cloudextendedtimeout`** = **50 segundos**. Defender esperará hasta 50 segundos por un veredicto en la nube sobre un archivo sospechoso antes de caer en una decisión local. El valor por defecto de Microsoft es 0 (no esperar nada). 50 está en el extremo alto de lo que Microsoft considera razonable — la plantilla valora un análisis más profundo sobre un veredicto más ágil.
- **`submitsamplesconsent`** = **Enviar todas las muestras automáticamente** (valor 3). Existen cuatro opciones: «Preguntar siempre» (0), «Enviar muestras seguras» (1, la baseline típica), «No enviar nunca» (2) y «Enviar todas las muestras» (3). La plantilla escoge la opción más agresiva. Esto significa que *cualquier* archivo sospechoso — incluyendo contenido potencialmente sensible — puede subirse a Microsoft para análisis. Vale la pena saberlo para clientes con requisitos estrictos de residencia de datos o privacidad; algunos querrán bajarlo a 1.
- **`signatureupdateinterval`** = **1 hora**. El valor por defecto de Microsoft es una vez al día. Poner esto en 1 hora significa que Defender tira de actualizaciones de firmas 24× más frecuentemente. Es agresivo — cierra la ventana entre que una nueva firma está disponible y el dispositivo la tiene, aproximadamente al tiempo de un solo ciclo de sincronización. Tiene algunas implicaciones de ancho de banda en redes lentas pero la mayoría de los parques no lo notarán.
- **`checkforsignaturesbeforerunningscan`** — ejecuta una actualización de firmas antes de cualquier escaneo programado, asegurando que el escaneo usa las últimas definiciones.
- **`signatureoutofdate`** — no está en esta plantilla directamente, pero la política de cumplimiento de Windows (lección 2) comprueba firmas obsoletas, cerrando el bucle.

### 2. Monitorización de comportamiento y cobertura de protección

Ajustes que aseguran que Defender está realmente vigilando las cosas que necesitan ser vigiladas:

- **`allowbehaviormonitoring`** — detección basada en comportamiento habilitada (atrapa comportamiento malicioso incluso cuando el archivo no se reconoce).
- **`allowrealtimemonitoring`** — escaneo en tiempo real de la actividad de archivos.
- **`realtimescandirection`** = **0** (monitorizar todos los archivos, tanto entrantes como salientes). Las otras opciones (1 = solo entrantes, 2 = solo salientes) crearían puntos ciegos; la plantilla mantiene intencionadamente cobertura bidireccional.
- **`allowioavprotection`** — protección IOAV (Internet/Outlook Attachment) habilitada. Escanea contenido descargado por las rutas de Internet Explorer / Edge / adjuntos de Outlook.
- **`allowarchivescanning`** — escanea dentro de .zip, .tar, .rar, etc.
- **`allowemailscanning`** — escanea adjuntos de correo a nivel del cliente de correo local.
- **`allowscriptscanning`** — escanea la ejecución de scripts (PowerShell, JScript, VBScript).
- **`allowscanningnetworkfiles`** — escanea archivos accedidos a través de recursos de red.
- **`allowfullscanonmappednetworkdrives`** = **DESHABILITADO**. Los escaneos completos programados excluyen explícitamente las unidades de red mapeadas. Es una elección deliberada — escanear completamente unidades mapeadas puede llevar una eternidad, puede martillear el servidor de archivos y tiende a producir detecciones espurias en archivos compartidos. El escaneo en tiempo real de archivos de red (vía `allowscanningnetworkfiles` arriba) sigue aplicándose; solo la pasada pesada programada los salta.
- **`allowfullscanremovabledrivescanning`** — los escaneos programados incluyen unidades extraíbles (memorias USB, SSDs externos).
- **`enablenetworkprotection`** — Network Protection (la característica de Defender que bloquea conexiones a URLs maliciosas conocidas, complementando a SmartScreen).
- **`puaprotection`** = habilitado en modo **block**. La otra opción (audit, valor 2) registraría sin bloquear. La plantilla escoge block — pilla grayware (bundleware, adware, secuestradores de navegador) y previene la instalación en lugar de solo registrar.

El ajuste `enablenetworkprotection` merece destacarse específicamente — es la característica de Defender que pilla los sitios de phishing AiTM cuando los datos de reputación de URL de SmartScreen los marcan. El recorrido de AiTM en la lección 3 de la tarjeta 2 mencionaba esto como una de las mitigaciones secundarias. La plantilla lo activa.

### 3. Programación de escaneos y rendimiento

Ajustes que controlan *cuándo* y *con qué agresividad* Defender consume los recursos del dispositivo:

- **`schedulequickscantime`** = **600** (minutos desde medianoche) = **10:00 AM**. No fuera de horario — deliberadamente media mañana. El razonamiento: los portátiles de pequeña empresa suelen estar apagados por la noche. Programar un escaneo a las 2 AM significa que la mayoría de los dispositivos se lo pierden y tienen que esperar al siguiente turno. Las 10 AM pega en una ventana donde la mayoría de los dispositivos están encendidos, con sesión iniciada y conectados a redes rápidas. El usuario nota una pequeña subida de CPU durante el escaneo, pero la alternativa es escaneos que nunca corren.
- **`avgcpuloadfactor`** = **20** (por ciento). Defender usará hasta el 20% de CPU durante los escaneos — conservador, prioriza el rendimiento percibido por el usuario sobre la velocidad del escaneo. El valor por defecto de Microsoft es 50%. El ajuste más bajo significa que los escaneos llevan más tiempo pero no hacen que el dispositivo se sienta lento.
- **`enablelowcpupriority`** — los escaneos de Defender corren con baja prioridad de proceso cuando es posible.
- **`scanparameter`** = **1** (escaneo rápido, no completo). Los escaneos completos pueden llevar horas; los escaneos rápidos cubren las rutas de infección de alta probabilidad en minutos.
- **`disablecatchupquickscan`** = **0** (los escaneos rápidos de recuperación **sí** están permitidos). Un dispositivo que estaba apagado cuando le tocaba el escaneo rápido programado lo ejecutará en la siguiente oportunidad. No deshabilites el catchup.
- **`disablecatchupfullscan`** = **0** (los escaneos completos de recuperación **sí** están permitidos). Misma lógica, para escaneos completos.
- **`randomizescheduletasktimes`** — aleatoriza los tiempos de inicio de escaneos a través del parque para evitar que todos los dispositivos escaneen simultáneamente y disparen la carga de infraestructura.

### 4. Endurecimiento del endpoint y endurecimiento interno de Defender

Un puñado de ajustes que protegen al propio Defender de ser manipulado:

- **`disablelocaladminmerge`** = **1** (la fusión con admin local **deshabilitada**). Los administradores locales no pueden sobrescribir la política gestionada centralmente. Sin esto, un admin local podría deshabilitar la protección en tiempo real en el dispositivo.
- **`allowdatagramprocessingonwinserver`** = **1** (habilitado). Procesamiento de datagramas en instalaciones Windows Server (un caso límite de nicho donde Defender se comporta ligeramente diferente en SKUs de servidor vs SKUs de estación de trabajo).
- **`allowuseruiaccess`** = **1** (acceso a la UI de usuario **habilitado**). Los usuarios no-admin pueden ver la interfaz de Defender — ver los resultados de los escaneos recientes, ver qué se bloqueó, ver el historial de amenazas. Es una elección de *usabilidad*, no de endurecimiento (bloquear la UI a los usuarios sería más restrictivo). La plantilla valora la transparencia para el usuario final sobre ocultarle Defender.

El ajuste `disablelocaladminmerge` es el crítico para la seguridad de este grupo. Sin él, un usuario con derechos de admin local en su dispositivo puede deshabilitar Defender por completo — lo que silenciosamente rompería la señal de cumplimiento (ya que la política de cumplimiento de Windows exige Defender habilitado). Ponerlo en disable-merge asegura que gana la política central.

## Defender Settings macOS — qué configura

La plantilla macOS es dramáticamente más simple que la de Windows — tres ajustes frente a treinta. Esto refleja la realidad de que Defender for Endpoint en macOS tiene una superficie mucho más pequeña que en Windows, y la mayoría de la configuración de Defender para macOS ocurre en la fase de instalación/incorporación en lugar de vía política de Intune.

Los tres ajustes:

- **`com.apple.managedclient.preferences_enabled`** — Defender habilitado en macOS.
- **`com.apple.managedclient.preferences_enablerealtimeprotection`** — protección en tiempo real habilitada.
- **`com.apple.managedclient.preferences_automaticsamplesubmission`** — envío automático de muestras a Microsoft para análisis.

Eso es todo. El cliente de Defender for Endpoint en macOS es ampliamente autoconfigurable una vez instalado; esta plantilla está principalmente ahí para asegurar que las tres cosas esenciales están activadas.

Lo que *no* está en la plantilla macOS:

- Sin ajuste de nivel de bloqueo en la nube (Defender de macOS usa la protección en la nube de Microsoft por defecto y no expone un mando granular de nivel-de-bloqueo vía MDM).
- Sin programación de escaneos — el comportamiento de escaneo de Defender en macOS es bajo-acceso, no programado.
- Sin controles específicos de tipo de escaneo — Defender de macOS no expone escaneo de archivos, escaneo de correo, escaneo de archivos de red como mandos separados.
- Sin ajustes explícitos de protección contra manipulación — el sandboxing de macOS maneja mucho de esto a nivel del SO.

Si la postura macOS de un cliente demanda más de lo que estos tres ajustes pueden expresar, la configuración se estratifica en la instalación de Defender for Endpoint (p. ej., vía la configuración del paquete de incorporación) o vía perfiles de configuración macOS separados fuera del ámbito de esta plantilla.

## El emparejamiento con la política de cumplimiento

Las configuraciones de Defender solo importan si la política de cumplimiento realmente las comprueba. La política de cumplimiento de Windows de Panoptica365 (lección 2) comprueba:

- `defenderEnabled: true` — Defender debe estar habilitado. La plantilla Defender Settings se lo asegura.
- `rtpEnabled: true` — protección en tiempo real habilitada. El `allowrealtimemonitoring` de la plantilla Defender Settings la entrega.
- `antivirusRequired: true` y `antiSpywareRequired: true` — antivirus y motores anti-spyware requeridos. Defender proporciona ambos.
- `signatureOutOfDate: true` — marca dispositivos con firmas obsoletas. El intervalo más rápido de actualización de firmas de la plantilla Defender Settings reduce la ventana para esto.
- `deviceThreatProtectionEnabled: true` en nivel «low» — Defender for Endpoint reporta sin amenazas de alta confianza. La plantilla Defender Settings no configura esto directamente (es un estado, no un ajuste), pero las configuraciones ayudan a reducir las probabilidades de que los dispositivos sean marcados.

Así que las dos plantillas trabajan juntas: la plantilla de configuración hace al dispositivo merecedor de cumplimiento; la política de cumplimiento verifica que el dispositivo alcanza el listón.

El par macOS es más ligero — la política de cumplimiento macOS de Panoptica365 no incluye `deviceThreatProtectionEnabled` porque Defender for Endpoint en macOS no siempre está instalado en escenarios de pequeña empresa. La plantilla Defender Settings macOS, cuando se despliega, configura lo que Defender está ahí para configurar, pero la presencia de Defender no es en sí misma un requisito de cumplimiento.

## Qué puede romperse

Las configuraciones de Defender son mayormente seguras pero vale la pena conocer:

**Falsos positivos de protección en la nube.** Niveles agresivos de bloqueo en la nube (más altos que el por defecto) atrapan más amenazas pero también marcan más archivos legítimos como sospechosos. Fuentes habituales de falsos positivos: aplicaciones de negocio construidas a medida, versiones más antiguas de herramientas comunes, software de nicho. El arreglo son las *exclusiones* — excluir rutas o archivos específicos del escaneo vía el ajuste de exclusiones de Defender (no directamente en la plantilla de Panoptica365; se configura por cliente según se necesite).

**Quejas de rendimiento en dispositivos más antiguos.** El escaneo en tiempo real + monitorización de comportamiento + escaneo de archivos comprimidos es más pesado que los valores por defecto de fábrica. Dispositivos con 4GB de RAM y HDDs giratorios pueden sentirse más lentos con la plantilla activa. Los ajustes `avgcpuloadfactor` y `enablelowcpupriority` ayudan, pero el problema subyacente es hardware antiguo. El arreglo honesto es actualizar el hardware; el workaround son las exclusiones.

**Network Protection bloqueando URLs legítimas.** Cuando `enablenetworkprotection` está activado, ocasionalmente una URL legítima de negocio queda atrapada (falso positivo en la inteligencia de amenazas de Microsoft). El usuario ve una pantalla de «este sitio está bloqueado». El arreglo es una lista de permitidos personalizada en la lista de URLs permitidas de Defender, configurada vía un ajuste separado de Defender Settings por cliente.

**Escaneo de PowerShell + scripts legítimos.** `allowscriptscanning` atrapa PowerShell malicioso, pero también atrapa algunos scripts legítimos pesados (automatización de admin, scripts operativos grandes de IT). El rendimiento puede degradarse para usuarios que los ejecutan. Las exclusiones son por cliente según se necesite.

## Despliegue

Despliegue por grupo piloto de la comprobación previa de la lección 1:

1. **Día 0** — despliega la plantilla Windows en un grupo piloto de 3–5 dispositivos. Despliega la plantilla macOS si el cliente tiene Macs.
2. **Días 1–7** — verifica el despliegue en el portal de Intune (contadores de éxito). Haz una comprobación puntual en los dispositivos piloto — abre la UI de Defender, confirma que la Protección en la Nube aparece habilitada, las definiciones de firmas están al día, la protección en tiempo real está activa.
3. **Días 7–14** — observa el comportamiento de los dispositivos piloto. Vigila bloqueos falsos positivos, quejas de rendimiento, fallos de actualización de firmas.
4. **Día 14** — despliegue más amplio si el piloto está limpio.

La plantilla Defender está entre las más seguras de desplegar porque Microsoft tiene décadas de experiencia afinando Defender para compatibilidad. La mayoría de los clientes no ven cambios de comportamiento visibles al usuario; el trabajo ocurre en los procesos de fondo de Defender.

## Qué monitorizar tras la aplicación

**Defender habilitado / deshabilitado por dispositivo.** Debería estar 100% habilitado en el parque Windows tras el despliegue. Los dispositivos que muestran Defender deshabilitado son dispositivos donde la plantilla falló al aplicarse o donde la manipulación por admin local lo deshabilitó — investiga.

**Frescura de firmas.** Los dispositivos que reportan firmas obsoletas (más de 24 horas) normalmente indican problemas de conectividad, mecanismo de actualización de firmas roto o — raramente — el propio Defender ha sido deshabilitado por otro producto. Vigila esto en el estado de cumplimiento de Intune para el dispositivo (signature-out-of-date es uno de los controles que ejecuta la política de cumplimiento de Windows de Panoptica365); un dispositivo que se sale del conforme se enrollará en el tile del contador general de cumplimiento, pero la antigüedad de firmas por dispositivo no es una vista dedicada en Panoptica365.

**Detecciones de amenazas de Defender.** Los picos de detecciones a menudo se correlacionan con una oleada de phishing pegando al cliente, o con un único usuario haciendo clic repetidamente a través de bloqueos de Network Protection (sugiriendo que está siendo atacado). Investiga el patrón de la fuente.

**Falsos positivos reportados por usuarios.** Rastrea cada uno. Algunos necesitan exclusiones; algunos son amenazas reales que el usuario identificó mal como legítimas.

**Deriva sobre la plantilla.** Los ajustes de Defender son un objetivo habitual de deriva. Otro admin del cliente puede haber bajado el nivel de bloqueo en la nube, o habilitado características que la plantilla no habilita. El detector de deriva de Panoptica365 lo marca.

## Qué ve Panoptica365

Dos cosas reales, y una larga lista de cosas que no ve.

**Lo que Panoptica365 expone:**

- **Detecciones de Defender XDR como alertas.** Cuando la ingestión de Defender XDR del cliente está configurada (tarjeta 1 lección 4), los incidentes y las alertas de alta severidad fluyen al motor de alertas de Panoptica365, donde se exponen a través del mismo panel y cartera de correos que otras alertas de seguridad. Esta es la fuente de detecciones por cliente — pero vive en la superficie de alertas, no en una vista por dispositivo.
- **Deriva sobre la plantilla Defender Settings.** Si el tenant de un cliente se desvía de la plantilla desplegada — alguien ajustó el nivel de bloqueo en la nube, habilitó características que la plantilla no habilita, deshabilitó la protección contra manipulación — el detector de deriva se dispara. Revertir, reaplicar o aceptar, igual que el resto del flujo de deriva.

**Lo que Panoptica365 *no* expone** (por si el currículo te llevó a esperarlo):

- Estado de Defender habilitado por dispositivo
- Antigüedad de firmas por dispositivo
- Estado de protección en tiempo real por dispositivo
- Cualquier postura de Defender por dispositivo en absoluto

La visibilidad por dispositivo del estado de Defender vive en el portal de Microsoft 365 Defender y en la hoja de dispositivo de Intune. Esa es la superficie de diagnóstico hoy. El papel de Panoptica365 es alertas (cuando algo malo pasa) y deriva (cuando la configuración se debilita) — no reportes de postura por dispositivo.

El papel de Defender XDR en este par de plantillas es exponer los *eventos de detección* que la configuración permite encontrar a Defender. La tarjeta 1 lección 4 cubrió XDR; aquí, la plantilla Defender Settings es lo que hace que las señales de XDR realmente lleguen — sin la configuración apropiada de Defender, el flujo de señales de XDR es flaco.

## Lo que esto significa para el operador

Tres puntos para llevarte.

**La configuración de Defender importa tanto como la presencia de Defender.** Una instalación de Defender por defecto de fábrica es significativamente más débil que una correctamente configurada. La plantilla de Panoptica365 es la diferencia. Despliégala en cada parque Windows.

**La protección en la nube es el clúster más consecuente.** De los 28 ajustes Windows, los de protección en la nube (nivel de bloqueo High Plus, consentimiento de envío-de-todas-las-muestras, timeout en la nube de 50 segundos, intervalo de firmas de 1 hora) mueven más la aguja. También son los más agresivos de la plantilla — si estás personalizando para un cliente regulado o con preocupaciones de residencia de datos, el ajuste de envío de muestras (actualmente «Enviar todas las muestras») es el primero a considerar bajar a «Enviar muestras seguras».

**La protección contra manipulación importa operacionalmente.** `disablelocaladminmerge` previene que un usuario con admin local deshabilite Defender. Sin él, la señal de cumplimiento es frágil — un usuario puede romper su propio cumplimiento apagando Defender, y la política central no puede sobrescribirlo.

## Lo que viene

- **Lección 6: Firewall Settings (Windows).** Configuración del firewall de host — la otra mitad de la defensa de red del endpoint Windows.
- **Lección 7: ASR Rules + Block mshta.exe.** Reglas de reducción de superficie de ataque — las características preventivas de bloqueo de comportamiento de Defender.

Por ahora: Defender Settings es la configuración que hace que Defender realmente defienda. Despliégala en cada parque Windows; despliega el equivalente macOS donde aplique; empareja ambas con la política de cumplimiento correspondiente.

---

*Fuentes de los datos en esta lección — la mayoría de los valores de Defender Settings Windows de Panoptica365 siguen la serie MDE de Jeffrey Appel ([jeffreyappel.nl/tag/mde-series](https://jeffreyappel.nl/tag/mde-series/)), la referencia práctica de endurecimiento M365 sobre la que está construida la plantilla. Microsoft Learn sobre la configuración de Defender Antivirus vía Intune ([Microsoft Learn — Configure Defender Antivirus](https://learn.microsoft.com/en-us/defender-endpoint/microsoft-defender-antivirus-windows)); protección entregada por la nube y niveles de bloqueo en la nube ([Microsoft Learn — Cloud-delivered protection](https://learn.microsoft.com/en-us/defender-endpoint/cloud-protection-microsoft-defender-antivirus)); Network Protection ([Microsoft Learn — Network protection](https://learn.microsoft.com/en-us/defender-endpoint/network-protection)); Defender for Endpoint en macOS ([Microsoft Learn — Defender for Endpoint on macOS](https://learn.microsoft.com/en-us/defender-endpoint/microsoft-defender-endpoint-mac)).*
