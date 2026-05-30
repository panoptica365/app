---
title: "Firewall Settings — defensa de red de Windows"
subtitle: "51 ajustes en perfiles Dominio, Privado y Público — garantizar que Windows Defender Firewall esté activo, registrando y ajustado en cada contexto de red."
icon: "flame"
last_updated: 2026-05-29
---

# Firewall Settings — defensa de red de Windows

Si Defender for Endpoint es la capa que vigila archivos y procesos, el Windows Defender Firewall es la capa que vigila las conexiones de red. Las dos se complementan: Defender pilla el malware que ya está en el dispositivo; el Firewall impide que el malware llegue al dispositivo en primer lugar — o impide que el software comprometido en el dispositivo alcance su infraestructura de mando y control.

La plantilla Firewall Settings Windows de Panoptica365 es la configuración no-Security-Baseline más grande de la biblioteca, con 34KB y 51 ajustes distintos. Configura Windows Defender Firewall a través de los tres perfiles de red (Dominio, Privado, Público) más los ajustes globales, asegurando que el firewall está activo, registrando, y usando valores por defecto sensatos.

Esta lección recorre lo que se configura, el modelo de tres perfiles que hace confuso al Windows Defender Firewall, y las realidades operativas de hacer correr firewalls de host en producción.

## El modelo de tres perfiles — lo que hace que esta plantilla parezca grande

Windows Defender Firewall tiene el diseño inusual de mantener tres perfiles de firewall separados, cada uno aplicado según la red a la que está conectado el dispositivo:

- **Perfil de Dominio** — se aplica cuando el dispositivo está en una red que contiene un controlador de dominio al que está unido. Típicamente la red de la oficina corporativa.
- **Perfil Privado** — se aplica cuando el dispositivo está en una red que el usuario ha marcado como Privada (red de casa, pequeña oficina de confianza).
- **Perfil Público** — se aplica cuando el dispositivo está en una red marcada como Pública (cafetería, aeropuerto, hotel). El perfil por defecto para cualquier red no reconocida.

Cada perfil tiene aproximadamente el mismo conjunto de ajustes configurables: habilitar/deshabilitar, acción entrante por defecto, acción saliente por defecto, modo silencioso, comportamiento de registro, ubicación del archivo de registro, tamaño del registro, permitir fusión con la política local. Así que los 51 ajustes de la plantilla son sobre todo *17 ajustes × 3 perfiles* con un puñado de ajustes globales superpuestos encima.

La razón por la que los tres perfiles necesitan configuración explícita es que el perfil Público en particular necesita ser más estricto que el de Dominio. Un dispositivo en la red corporativa tiene vecinos de confianza e infraestructura de confianza; un dispositivo en la red de una cafetería comparte la LAN con extraños. La acción por defecto para tráfico entrante debe diferir en consecuencia.

## Lo que configura la plantilla, por perfil

Para **cada uno de los tres perfiles**, la plantilla establece:

- **`enablefirewall`** — Firewall habilitado en este perfil.
- **`defaultinboundaction`** — Bloquear el tráfico entrante por defecto (la baseline segura; las reglas específicas de permitir se ponen encima).
- **`defaultoutboundaction`** — Permitir el tráfico saliente por defecto (la postura típica para dispositivos cliente; las reglas de bloqueo saliente se ponen encima).
- **`disablestealthmode`** — Modo silencioso habilitado (no, el ajuste tiene un nombre confuso — `disablestealthmode: false` significa que el modo silencioso SÍ está activo). El modo silencioso significa que el dispositivo no responde a sondeos de red (escaneos de puertos, eco ICMP, etc.), lo que lo hace menos descubrible para atacantes en el mismo segmento de red.
- **`disablestealthmodeipsecsecuredpacketexemption`** — Los paquetes asegurados con IPSec están exentos del modo silencioso (así las conexiones IPSec siguen funcionando incluso con el modo silencioso activado).
- **`disableunicastresponsestomulticastbroadcast`** — Deshabilita las respuestas unicast a multicast/broadcast — cierra un pequeño vector de divulgación de información.
- **`disableinboundnotifications`** — No mostrar al usuario notificaciones de bloqueo entrante. Es la elección laxa; la versión estricta notificaría al usuario cuando algo intentara alcanzarle.
- **`enablelogdroppedpackets`** — Registrar los paquetes descartados por el firewall. Importante para la respuesta a incidentes.
- **`enablelogsuccessconnections`** — Registrar conexiones exitosas. Pesado en disco pero útil para análisis forense.
- **`enablelogignoredrules`** — Registrar reglas que estaban configuradas pero fueron ignoradas (p. ej., reglas deshabilitadas que habrían coincidido). Diagnóstico.
- **`logfilepath`** — Dónde va el archivo de registro (típicamente `%systemroot%\system32\logfiles\firewall\pfirewall.log` o similar).
- **`logmaxfilesize`** — Tamaño máximo del registro del firewall antes de que rote.
- **`allowlocalpolicymerge`** — Si las reglas de firewall configuradas localmente pueden fusionarse con la política central. Típicamente `false` (la política gestionada centralmente gana; los usuarios no pueden añadir sus propias reglas).
- **`allowlocalipsecpolicymerge`** — Igual, para la política IPSec.
- **`authappsallowuserprefmerge`** — Si las aplicaciones autorizadas pueden fusionarse con las preferencias del usuario. Típicamente `false`.
- **`globalportsallowuserprefmerge`** — Si las reglas globales de puertos pueden fusionarse con las preferencias del usuario.

A través de los tres perfiles, eso suma aproximadamente 51 ajustes, con variaciones menores entre Dominio (más permisivo — la red corporativa es de confianza), Privado (medio) y Público (el más estricto — la red de la cafetería es hostil).

## Ajustes globales del firewall

Además de los ajustes por perfil, la plantilla configura algunos ajustes globales que afectan a los tres perfiles:

- **`crlcheck`** — Comportamiento de comprobación de Listas de Revocación de Certificados para la evaluación de reglas del firewall. Asegura que los certificados revocados no se aceptan para autenticación.
- **`disablestatefulftp`** — Filtrado FTP con estado. Endurecimiento moderno — el soporte FTP con estado introduce complejidad de parseo que se ha explotado históricamente.
- **`presharedkeyencoding`** — Codificación para claves precompartidas de IPSec (típicamente UTF-8).

Estos ajustes globales son elecciones deliberadas de endurecimiento que cierran vectores de ataque históricos en el propio componente del firewall de Windows.

## Las elecciones opinionadas a conocer

Un puñado de ajustes de esta plantilla que afectan a la experiencia del usuario o tienen implicaciones específicas de seguridad:

**Modo silencioso habilitado.** El dispositivo no responderá a sondeos de red. Significa que el descubrimiento de red estándar (ping, escaneos de puertos) no verá el dispositivo. Ayuda en redes hostiles; mayormente invisible para los usuarios; ocasionalmente confunde a ingenieros de red que intentan diagnosticar desde otra máquina («¿por qué este PC no responde a ping?»). Documéntalo si el equipo de IT del cliente depende del ping para monitorización.

**Notificaciones entrantes deshabilitadas.** Los usuarios no ven el pop-up «Windows Defender Firewall ha bloqueado algunas características de esta aplicación». Es más amigable — los pop-ups son molestos y la mayoría de los usuarios hacen clic a través sin entender. El compromiso: un usuario instalando una aplicación legítima que necesita una excepción entrante no se le preguntará para añadir una; el operador necesitará añadir la excepción centralmente. Para escenarios de pequeña empresa, este suele ser el compromiso correcto (excepciones gestionadas por el operador > excepciones gestionadas por el usuario).

**Fusión con la política local deshabilitada.** Los usuarios (incluso los que tienen admin local) no pueden añadir sus propias reglas de firewall que entren en conflicto con la política central. Es la elección segura, pero ocasionalmente sorprende a usuarios avanzados que solían poder permitir sus propias aplicaciones. La mitigación es la misma que arriba — añade excepciones legítimas centralmente según vayan surgiendo.

**El registro es verboso.** `enablelogdroppedpackets`, `enablelogsuccessconnections` y `enablelogignoredrules` están todos activados. Esto genera actividad sustancial en el registro del firewall del dispositivo. El archivo de registro rota al tamaño máximo configurado, así que no llena el disco indefinidamente, pero los dispositivos que hacen actividad de red legítima de alto volumen verán escrituras de registro significativas. El beneficio es la respuesta a incidentes — cuando algo va mal, el registro del firewall es uno de los artefactos forenses más útiles disponibles.

## Qué puede romperse

El despliegue del firewall puede romper cosas de formas que el despliegue de Defender raramente hace, porque el firewall se sienta en la ruta de red de cada conexión:

**Servicios entrantes legítimos.** Cualquier cosa en el dispositivo que escuche conexiones entrantes (un servidor web de desarrollo en localhost, un controlador de impresora compartido por red, una herramienta de gestión remota, una aplicación de línea-de-negocio heredada que usa conexiones peer-to-peer) necesita una regla explícita de permitir. Sin una, la conexión se bloquea. El `defaultinboundaction: block` de la plantilla de Panoptica365 hace esto estricto por diseño — pero significa que los casos de uso entrante necesitan excepciones.

**Compartición de archivos e impresoras.** La compartición de archivos SMB de Windows depende de reglas entrantes específicas. Los valores por defecto de la plantilla los manejan correctamente para configuraciones estándar, pero clientes con configuraciones SMB no estándar (servidores Samba antiguos específicos, puertos no estándar) pueden necesitar ajustes.

**Aplicaciones de red personalizadas.** Las aplicaciones específicas de industria (imagen médica, CAD con servidores de licencias compartidas, sistemas de control de fabricación) a menudo tienen comportamientos de red no estándar. Los valores por defecto estrictos de la plantilla pueden romperlas. El arreglo son excepciones de firewall por aplicación añadidas a la política desplegada por cliente.

**Descubrimiento de red en entornos sin dominio.** Un usuario que intenta encontrar una impresora de red en una red de perfil Privado puede tener dificultades porque el modo silencioso y el bloqueo entrante por defecto dificultan el descubrimiento. Normalmente está bien con procedimientos apropiados de instalación de impresoras; puede surgir como queja en entornos de cliente menos maduros.

## Despliegue

Despliegue por grupo piloto de la comprobación previa de la lección 1, con atención extra a los flujos de trabajo de negocio dependientes de la red:

1. **Día 0** — despliega en 3–5 dispositivos piloto. *Crítico*: elige dispositivos que ejerciten los flujos de red del cliente (recursos compartidos de archivos, impresoras, aplicaciones de línea-de-negocio con componentes de red).
2. **Días 1–7** — verifica el éxito del despliegue en el portal de Intune. Prueba cada flujo dependiente de red en los dispositivos piloto: imprimir, acceso a recursos compartidos, aplicaciones de negocio, VPN, escritorio remoto. *Cualquier cosa* relacionada con la red debería probarse.
3. **Días 7–14** — observa los dispositivos piloto. La primera semana es cuando emerge la rotura obvia; la segunda semana es cuando los flujos de una-vez-a-la-semana y de una-vez-al-mes exponen problemas más sutiles.
4. **Día 14** — despliegue más amplio si el piloto está limpio.

Para los cambios de firewall específicamente, la ventana de despliegue de 14 días es el mínimo. Un cliente con flujos de procesamiento por lotes mensuales o informes trimestrales puede necesitar una ventana de 30 días antes de que puedas decir con confianza «no se rompió nada».

## Qué monitorizar tras la aplicación

**Firewall habilitado por dispositivo por perfil.** Debería estar 100% habilitado en los tres perfiles tras el despliegue. Los dispositivos que muestran el firewall deshabilitado en algún perfil son dispositivos donde la plantilla falló al aplicarse (poco común) o donde un admin local lo ha deshabilitado (más común — investiga).

**Logs de paquetes descartados.** El registro verboso significa que el log del firewall está lleno de entradas de paquetes descartados. La mayoría son ruido (escaneo de fondo de Internet pegando al dispositivo). Señales reales a vigilar: ráfagas de paquetes descartados desde una IP interna específica (podría indicar un dispositivo interno comprometido sondeando), descartes repetidos desde la misma fuente externa (podría indicar un escaneo dirigido), descartes de protocolos de apariencia legítima (podría indicar una aplicación mal configurada).

**Rotura de flujos reportada por el usuario.** Rastrea cada queja de «X dejó de funcionar tras el despliegue del firewall». Algunas son rotura real que requiere excepciones por aplicación; algunas son coincidencia; algunas son error de usuario. Documenta cada una.

**Deriva sobre la plantilla.** Como otras plantillas, la plantilla Firewall Settings puede derivar si otro admin del cliente la modifica. La deriva puede ser peligrosa aquí — ampliar la acción entrante por defecto o deshabilitar el modo silencioso reduciría la seguridad materialmente.

## La plantilla Block mshta.exe es adyacente al firewall

La biblioteca de Panoptica365 incluye una plantilla separada — Block mshta.exe outbound connections — que vive en la misma familia de plantillas `endpointSecurityFirewall` que la plantilla principal Firewall Settings. Se cubre en la lección 7 (junto con ASR Rules) porque conceptualmente es una regla de reducción-de-superficie-de-ataque más que una configuración general de firewall. Vale la pena saber: cuando un operador abre el portal de Intune buscando configuraciones relacionadas con el firewall, verá tanto la plantilla principal Firewall Settings como la plantilla Block mshta.exe en la misma lista. Sirven a propósitos distintos.

## Qué ve Panoptica365

Dos cosas reales, y lo que no está ahí.

**Lo que Panoptica365 expone:**

- **Deriva sobre la plantilla Firewall Settings.** Mismo modelo que el resto: si la plantilla desplegada de un cliente diverge de la referencia de Panoptica365 — alguien abre la consola de Intune y deshabilita el modo silencioso, abre un bloqueo entrante, baja el registro — el detector de deriva se dispara y el operador puede revertir, reaplicar o aceptar.
- **Detecciones de Defender XDR** (cuando la ingestión de Defender XDR está configurada según la tarjeta 1 lección 4) — los incidentes que incorporan conexiones bloqueadas por el firewall en su contexto fluyen al motor de alertas. Esto no es «eventos de firewall»; son incidentes de Microsoft de más alto nivel que pueden referenciar actividad de firewall.

**Lo que Panoptica365 *no* expone:** estado de firewall habilitado por dispositivo, estado por perfil (Dominio/Privado/Público) por dispositivo, eventos brutos del log del firewall. Nada de eso vive en el panel. La señal de cumplimiento de Intune incluye `activeFirewallRequired: true`, así que un dispositivo con el firewall apagado se enrolla en el contador general de conforme/no-conforme — pero no puedes mirar «qué dispositivos específicamente tienen qué perfil apagado» desde Panoptica365. Eso es un drill-down al portal de Intune y a la consola de Defender.

El propio archivo de registro del firewall es un artefacto Windows local que los respondedores de incidentes extraen cuando investigan un dispositivo específico. No ingerido por Panoptica365 — para la telemetría de defensa de red a lo largo del parque, la superficie visible es la cartera de alertas de Defender XDR.

## Lo que esto significa para el operador

Tres puntos para llevarte.

**El despliegue del firewall es la plantilla con más probabilidad de romper algo en la tarjeta 4.** Cualquier cosa que escuche en la red o que viva en comportamiento de red no estándar puede verse afectada. Planifica una ventana de despliegue de 14–30 días con pruebas exhaustivas de flujos.

**El modelo de tres perfiles es real y vale la pena entenderlo.** Cuando un usuario se queja «el firewall está bloqueando [X]», la primera pregunta es *¿qué perfil está activo cuando ocurre esto?* El mismo dispositivo se comporta de forma distinta en el Wi-Fi de la oficina vs. el Wi-Fi de la cafetería porque el perfil activo cambia.

**El modo silencioso y los valores por defecto de bloqueo entrante son las elecciones estrictas.** Documéntalos con el cliente. La estrictez es el punto — la alternativa es el valor por defecto laissez-faire que dio a los atacantes descubrimiento de red fácil durante dos décadas.

## Lo que viene

- **Lección 7: ASR Rules + Block mshta.exe.** Reducción de superficie de ataque — las características preventivas de bloqueo de comportamiento que pillan amenazas antes de que se entreguen al disco.
- **Lección 8: Account Protection + Block MSA.** Windows Hello for Business, Credential Guard, bloqueo de adiciones de MSA personales.

Por ahora: la plantilla Firewall es la compañera de capa de red para la plantilla de capa de archivos de Defender. Juntas constituyen la capa de defensa activa en endpoints Windows. Despliega con pruebas exhaustivas de flujos; tolera la ventana de despliegue de 14–30 días; resiste la tentación de debilitar los valores por defecto estrictos.

---

*Fuentes de los datos en esta lección — Microsoft Learn sobre la configuración de Windows Defender Firewall vía Intune ([Microsoft Learn — Configure Windows Defender Firewall via Intune](https://learn.microsoft.com/en-us/mem/intune/protect/endpoint-security-firewall-policy)); modelo de perfiles del Windows Defender Firewall ([Microsoft Learn — Windows Defender Firewall with Advanced Security](https://learn.microsoft.com/en-us/windows/security/operating-system-security/network-security/windows-firewall/windows-firewall-with-advanced-security)); referencia de registro del Firewall ([Microsoft Learn — Firewall logging](https://learn.microsoft.com/en-us/windows/security/operating-system-security/network-security/windows-firewall/configure-firewall-logging)).*
