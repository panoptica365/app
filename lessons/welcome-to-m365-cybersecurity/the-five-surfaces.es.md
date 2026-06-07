---
title: "Las cinco superficies que M365 asegura"
subtitle: "Identidad, terminales, correo, colaboración y apps en la nube — las cinco paradas del recorrido de todo atacante por M365."
icon: "layers"
last_updated: 2026-05-29
---

# Las cinco superficies que M365 asegura

En 2024, un pequeño bufete de contabilidad fue comprometido. El atacante empezó haciendo phishing a las credenciales de un asociado júnior. Eso le dio acceso al buzón. En el buzón encontró un hilo que mencionaba «la carta de compromiso está en el SharePoint del cliente». Navegó hasta SharePoint, encontró 18 meses de declaraciones fiscales para 30 clientes, las descargó vía OneDrive sync, y cerró sesión en silencio.

Identidad → correo → colaboración → aplicaciones en la nube. Una credencial. Cuatro superficies. El MSP del bufete solo tenía monitorización configurada para una de ellas.

Cuando decimos que M365 «es» cinco superficies, esto es lo que queremos decir. No son contenedores independientes. Son paradas en el recorrido de un atacante. Un control sobre cualquiera de ellas solo importa si es lo bastante bueno para detener el recorrido donde empieza.

Esta lección es el mapa.

## Qué significa «superficie» aquí

Una superficie es una categoría de objetivo de ataque — algo que el atacante quiere, y un sitio donde M365 lo almacena o lo enruta. M365 tiene aproximadamente cinco.

No somos los únicos que organizan la pila así. Microsoft misma divide el portal de Defender XDR en «Identidades», «Terminales», «Correo y colaboración», «Aplicaciones en la nube». El CIS Microsoft 365 Benchmark divide los controles según líneas parecidas. Inforcer, Octiga, Overe, y la mayoría de los proveedores en este espacio agrupan sus productos en cubos similares. No es arbitrario; es como se divide naturalmente el modelo de amenazas.

Aquí están.

## 1. Identidad

**Qué es:** Entra ID — cuentas, grupos, dispositivos, aplicaciones, principales de servicio, el directorio mismo.

**Qué quieren los atacantes de ella:** Credenciales, tokens, sesiones, la capacidad de *ser* alguien. La identidad es la puerta principal a todas las demás superficies. Comprometes una identidad y no necesitas romper el servidor de correo ni el sitio de SharePoint; simplemente inicias sesión como alguien que tiene acceso.

**Qué la protege dentro de M365:**

- **Entra ID** mismo — el directorio, MFA, métodos de autenticación, protección de contraseñas.
- **Acceso Condicional** — aplica *qué* inicios de sesión están permitidos según el contexto (cumplimiento del dispositivo, ubicación, aplicación, puntuación de riesgo).
- **Entra ID Protection** (solo en SKUs P2) — puntuación basada en riesgo de usuarios e inicios de sesión.
- **Microsoft Defender for Identity** — supervisa Active Directory local si todavía tienes uno, más actividad de sincronización híbrida.

**Dónde la monitoriza Panoptica365:** Esta es la superficie más pesada para nosotros. Monitorización de inicios de sesión, comprobación de aplicación de MFA, deriva de métodos de autenticación, postura de Acceso Condicional, alertas de IP extranjera y viaje imposible, además de las alertas de identidad de Defender XDR que entran por el Unified Audit Log (UAL) — el flujo de eventos a nivel de tenant de Microsoft, que registra cada acción administrativa y la mayoría de la actividad de usuario.

## 2. Terminales

**Qué es:** Los dispositivos físicos — portátiles Windows, Macs, iPhones, Androids — desde los que los usuarios inician sesión. Cada dispositivo es un trozo del perímetro, en el sentido que explicó la lección 1: ya no hay perímetro, solo llaveros electrónicos y las personas que los sostienen.

**Qué quieren los atacantes:** Un punto de apoyo inicial. Un dispositivo que ellos controlan es un sitio donde ejecutar malware, recolectar tokens en caché, capturar pulsaciones, y persistir después de que el usuario restablezca su contraseña. Los terminales también son donde *viven* muchas sesiones de M365 — Outlook, OneDrive sync, el cliente de Teams de escritorio guardan todos tokens en el disco local.

**Qué los protege dentro de M365:**

- **Intune** — gestión de dispositivos. Inscribe el dispositivo, lo configura, aplica políticas, comprueba cumplimiento (cifrado activado, versión de SO actualizada, AV ejecutándose, sin jailbreak).
- **Defender for Endpoint** — EDR. Monitorización de comportamiento en el propio dispositivo; esto es lo que pilla el malware, los procesos sospechosos, el comportamiento tipo ransomware.
- **Defender Antivirus** — el AV que viene con Windows. Cada vez más enriquecido por la nube y subestimado.
- **Reglas de reducción de superficie de ataque (ASR)** — controles preventivos que bloquean patrones de comportamiento conocidos como malos (macros de Office lanzando procesos, scripts en carpetas temp, ese tipo de cosa).

**Dónde los monitoriza Panoptica365:** Deriva de despliegues de Intune, postura de cumplimiento de dispositivos, cobertura del despliegue de EDR. No analizamos la telemetría cruda de los terminales — ese es el trabajo de Defender, y replicarlo sería un error.

## 3. Correo

**Qué es:** Exchange Online. Buzones, flujo de correo, calendario, contactos. El canal de mayor volumen en cualquier empresa.

**Qué quieren los atacantes:** Dos cosas. Primero, *como objetivo* — fraude financiero (manipulación de facturas, redirección de transferencias, compromiso del correo de empresa, BEC). Segundo, *como vehículo* — correo de phishing enviado a otros usuarios, incluidos los de otras empresas con las que la víctima hace negocios. Los buzones comprometidos son cómo ocurre el phishing de *remitente confiable*, que es el tipo que realmente funciona.

**Qué lo protege dentro de M365:**

- **Exchange Online Protection (EOP)** — el filtro de base sobre el flujo de correo. Anti-spam, anti-malware, reglas de flujo.
- **Defender for Office 365** Planes 1 y 2 — políticas anti-phishing, Safe Links (reescritura de URL y verificación en el momento del clic), Safe Attachments (cámara de detonación), protección contra suplantación. El Plan 1 ahora está incluido en Business Premium y E3 desde 2026; el Plan 2 añade Threat Explorer, Attack Simulation Training y Automated Investigation and Response.
- **Auditoría de buzones** — rastrea quién hizo qué dentro de un buzón (cambios de reglas, eliminaciones, configuración de reenvío).
- **Monitorización de reglas de buzón y reenvío a nivel de buzón** — para detectar la regla silenciosa de reenvío a Gmail que les encanta a los atacantes.

**Dónde lo monitoriza Panoptica365:** preset anti-phishing, postura de auditoría de buzones, detección de reglas de buzón y reenvío a nivel de buzón, configuración de Safe Links y Safe Attachments. Esta es la categoría más profunda en nuestro catálogo de monitorización.

## 4. Colaboración

**Qué es:** SharePoint Online, OneDrive, Teams. Los sitios donde los archivos viven de verdad y donde se hace el trabajo en equipo.

**Qué quieren los atacantes:** Los archivos. Declaraciones fiscales. Cartas de compromiso. Expedientes de RRHH. Código fuente. Documentos de fusiones y adquisiciones. Una vez dentro, ahí están los datos *interesantes*. También quieren movimiento lateral — un sitio de SharePoint con permisos demasiado abiertos y el uso compartido externo activado permite a un atacante invitarse a sí mismo desde una dirección de Gmail. La mayor parte de la exfiltración de datos en ataques de M365 termina aquí.

**Qué la protege dentro de M365:**

- **Controles de uso compartido de SharePoint y OneDrive** — quién puede compartir qué hacia fuera, políticas de enlaces anónimos, expiración de enlaces, expiración de invitados.
- **Etiquetas de confidencialidad** — clasificación automática y manual de documentos (Confidencial, Altamente Confidencial, etc.) con cifrado y controles de acceso adjuntos.
- **Prevención de pérdida de datos (DLP)** — políticas que detectan datos sensibles (SSNs, números de tarjeta de crédito, patrones personalizados) y bloquean el uso compartido.
- **Políticas de Teams** — quién puede crear equipos, qué aplicaciones están permitidas, acceso de invitados.
- **Acceso Condicional para SharePoint y OneDrive** — aplica las mismas reglas de dispositivo conforme y ubicación de confianza al acceso a archivos.

**Dónde la monitoriza Panoptica365:** Postura de uso compartido de SharePoint, inventario de permisos de sitio, auditoría de uso compartido externo (el módulo de auditoría de SharePoint). La cobertura de etiquetas de confidencialidad y la visibilidad de DLP son parciales hoy.

## 5. Aplicaciones en la nube

**Qué es:** Cada SaaS al que tu usuario inicia sesión con su identidad de M365 que *no es* M365. Salesforce, GitHub, Dropbox, la herramienta de IA a la que se apuntó un martes. Más todas las aplicaciones registradas vía OAuth y los principales de servicio dentro del propio Entra ID.

**Qué quieren los atacantes:** Dos cosas. Primero, acceso persistente vía consentimiento OAuth — una aplicación que engañaron al usuario para que aprobara se queda incluso después de un restablecimiento de contraseña. Segundo, exfiltración lateral de datos — si tu usuario tiene acceso a Salesforce y un atacante compromete la identidad de M365, probablemente también tenga Salesforce. El SaaS federado es un multiplicador de fuerza para la compromisión.

**Qué las protege dentro de M365:**

- **Registros de aplicaciones y aplicaciones empresariales de Entra ID** — qué tiene permiso para pedir permisos, qué consentimientos deben aprobar los administradores.
- **Políticas de consentimiento OAuth** — restringir a los usuarios de aprobar aplicaciones con ámbitos de privilegio alto.
- **Defender for Cloud Apps (MDA)** — monitorización a nivel de SaaS sobre aplicaciones registradas; análisis del comportamiento del usuario; descubrimiento de shadow IT.
- **Acceso Condicional para aplicaciones en la nube** — las mismas reglas pueden aplicarse a SaaS no-Microsoft federado a través de Entra.

**Dónde las monitoriza Panoptica365:** Más ligero hoy que las otras cuatro superficies. El inventario de consentimientos OAuth es parcial. Las alertas de Defender for Cloud Apps llegan por la ingesta de Defender XDR.

## Las cinco superficies no son cinco productos

El error que cometen los operadores júnior una vez que ven esta lista es tratar cada superficie como «responsabilidad de un producto». La identidad es Entra. Los terminales son Intune. El correo es Defender for Office 365. Y así sucesivamente.

Ese modelo está equivocado, y está equivocado de una forma que importa.

Mira las listas de protección de arriba y nota el solapamiento:

- **El Acceso Condicional** aparece bajo Identidad, Colaboración y Aplicaciones en la Nube. Es una capa de aplicación *transversal* que opera dondequiera que ocurra un inicio de sesión.
- **El cumplimiento de Intune** es un producto de *terminal*, pero su salida (un estado de cumplimiento por dispositivo) es consumida por el Acceso Condicional en *cada* inicio de sesión en *cada* superficie.
- **Defender XDR** no aparece en la lista de ninguna superficie individual porque se sitúa *por encima* de las cinco — correlacionando señales entre ellas y buscando incidentes que abarquen varias.

El modelo mental correcto es *capas*, no silos:

1. **Identidad** es la capa de la que dependen todas las demás superficies (señal: *quién*).
2. **Terminales** es la capa que produce la señal de confianza (señal: *desde qué*).
3. **Correo** y **Colaboración** son las dos capas principales de *datos* (donde vive lo valioso de verdad).
4. **Aplicaciones en la nube** es la capa que extiende esas capas de datos hacia el SaaS que no es de Microsoft.

Y **el Acceso Condicional** es el *motor de políticas* que opera sobre todas. **Defender XDR** es el *motor de detección y respuesta* que las vigila todas.

Si solo recuerdas una forma de esta lección: las superficies son *objetivos de datos y de acceso*, los productos son *mecanismos de aplicación y de detección*. Son ortogonales. Un operador júnior que piense «Correo = Defender for Office 365» perderá la mitad de la seguridad del correo que vive en el Acceso Condicional, Entra ID Protection y DLP. (Que es la mitad interesante.)

## Lo que esto significa para el operador

Tres implicaciones concretas.

**No eliges una superficie para defender; eliges una cadena.** Phishing → correo → identidad → aplicaciones en la nube es una cadena. Portátil comprometido → malware en el terminal → robo de token → identidad → SharePoint es otra. Diseñar tu monitorización en torno a cadenas, no a superficies, es como pillas los ataques que se mueven.

**El Acceso Condicional es el control con mayor palanca de toda la pila.** Es la única cosa que opera sobre varias superficies en el momento de la política. Configurar mal una política de Acceso Condicional puede romper el acceso *o* dejar un agujero en tres superficies a la vez. La buena noticia: configurar bien el Acceso Condicional también es lo de mayor palanca que puedes hacer. Tenemos una tarjeta entera sobre ello (tarjeta 3).

**La detección sola está incompleta sin correlación.** Vigilar los eventos de correo a solas es la mitad de un trabajo. Vigilar los eventos de inicio de sesión a solas es la mitad de un trabajo. El ataque que te importa — la cadena — toca varias. Defender XDR (lección 4) y la correlación de alertas de Panoptica365 son ambos intentos de resolver el mismo problema de correlación desde ángulos distintos.

## Lo que viene

El resto de esta tarjeta:

- **Lección 3: Defender, Intune, Acceso Condicional — cómo encajan de verdad.** El diagrama del bucle de cumplimiento y dónde se configura cada herramienta. Aquí «el Acceso Condicional es el motor de políticas» se vuelve concreto.
- **Lección 4: Defender XDR — qué es, qué no es.** La historia de la correlación transversal.
- **Lección 5: Licencias de Microsoft 365 — qué desbloquea qué.** Porque varios de los controles de arriba solo existen en ciertos niveles de SKU, y un cliente de Business Standard se queda sin la mitad.
- **Lección 6: Dónde encaja Panoptica365 en este cuadro.** Qué supervisamos, qué no tocamos, por qué no remediamos automáticamente.

Después, la tarjeta 2 (*Amenazas de identidad y patrones de ataque*) recorre cadenas de ataque reales sobre estas superficies. Para entonces, las cadenas deberían sonar familiares — leerás «credencial → buzón → SharePoint» y contarás instintivamente las traversías de superficies.

Por ahora: las superficies son paradas en el recorrido del atacante. Los productos son aplicación y detección. Acierta con el modelo y el resto del programa se vuelve forma, no memorización.

---

*Fuentes de los datos en esta lección — la organización del portal Microsoft 365 Defender en torno a identidades, terminales, correo y colaboración, aplicaciones en la nube como dominios principales de seguridad ([Microsoft Learn — Resumen de Defender XDR](https://learn.microsoft.com/en-us/defender-xdr/microsoft-365-defender)); Microsoft 365 Defender Threat Intelligence sobre cadenas de ataque transversales ([Microsoft Security Blog](https://www.microsoft.com/en-us/security/blog/), 2025); CIS Microsoft 365 Foundations Benchmark para la taxonomía de controles basada en superficies ([CIS](https://www.cisecurity.org/benchmark/microsoft_365)).*
