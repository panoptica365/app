---
title: "Dónde encaja Panoptica365 en este cuadro"
subtitle: "Panoptica365 no reemplaza a Defender — es la capa de detección y triaje a escala de flota que los MSP no tenían por encima de los portales mono-tenant de Microsoft."
icon: "map-pin"
last_updated: 2026-05-29
---

# Dónde encaja Panoptica365 en este cuadro

*«Ya tenemos Defender. ¿Por qué estamos pagando por Panoptica365?»*

Te va a llegar esta pregunta. De clientes. De operadores nuevos en tu propio MSP. Quizás de ti mismo, tras una sesión de 90 minutos en Defender XDR que no produjo ni un solo elemento accionable. Es una pregunta justa, y la respuesta es más interesante que «monitorizamos más cosas».

Panoptica365 no es un reemplazo de Defender XDR, Acceso Condicional, Intune, ni de ningún otro producto de Microsoft. Es una capa que se sitúa *por encima* de ellos, diseñada para un solo trabajo: hacer manejable el trabajo diario del operador sobre una flota de tenants de clientes.

Esta lección es lo que eso significa en la práctica — qué vigila Panoptica365, qué *no hace* deliberadamente, por qué, y dónde encaja el producto en el ritmo diario del trabajo de un operador.

## Los cuatro trabajos de un operador de M365

Da un paso atrás de los productos por un momento. Un operador de MSP trabajando sobre M365 tiene cuatro trabajos, aproximadamente en este orden de frecuencia:

1. **Darse cuenta de cuándo algo ha cambiado** en un tenant de cliente que no debería haber cambiado.
2. **Triajear alertas** de muchos tenants y decidir cuáles necesitan acción hoy.
3. **Aplicar controles** cuando un cliente necesita una política nueva, una plantilla nueva, una nueva línea base de cumplimiento.
4. **Forense** cuando algo ha salido mal y necesitas entender qué pasó.

Microsoft ha construido herramientas de clase mundial para el **trabajo 4** — Defender XDR es excelente para el forense, especialmente para un usuario, un dispositivo, un incidente a la vez.

Microsoft ha construido herramientas razonables para el **trabajo 3** — el portal de Intune, el editor de políticas de Acceso Condicional, el centro de administración de Exchange. Funcionan, en la forma en que funcionaba el software de los años 90. Puedes gestionar un cliente así; solo pasarás mucho tiempo haciendo clic.

Donde Microsoft no ha construido mucho es en los **trabajos 1 y 2** — *darse cuenta y triajear a escala de flota*. Los portales son mono-tenant. Los paneles asumen que vives dentro del portal de un solo cliente a la vez. Las funciones multi-tenant para MSP de Defender XDR son una adición reciente y todavía no son lo que construirías si empezaras desde «un MSP gestiona 30 clientes y necesita una pantalla para mirarlos».

Panoptica365 es el producto que construimos porque *los trabajos 1 y 2 no eran manejables a escala de MSP con lo que Microsoft entrega*.

## Qué monitoriza Panoptica365 en realidad

Concretamente, a través de cada tenant conectado:

**Identidad y Acceso Condicional.** Aplicación de MFA por usuario, patrones de inicio de sesión (IP extranjera, viaje imposible), deriva de políticas de AC (una plantilla que desplegaste ayer parece distinta hoy), cambios de asignación de AC, cambios de ubicación nombrada, cambios de registro de métodos de autenticación.

**Plantillas de Intune y cumplimiento.** Deriva de plantillas, deriva de políticas de cumplimiento, patrones de inscripción de dispositivos, huecos de cobertura de EDR.

**Postura de seguridad de Exchange Online.** Preset anti-phishing, postura de auditoría de buzones, cambios de reglas de buzón, reenvío a nivel de buzón, configuración de Safe Links y Safe Attachments, cambios de reglas de flujo de correo.

**Uso compartido de SharePoint y OneDrive.** Postura de uso compartido externo, enlaces anónimos, patrones de acceso de invitados, inventario de permisos de sitio.

**Ingesta de Unified Audit Log + Defender XDR.** 25 evaluadores de detección sobre el flujo de UAL y los incidentes de Defender XDR — patrones de credential stuffing, cadenas sospechosas de inicio de sesión, consentimientos OAuth, otorgamientos de permisos de buzón, anomalías de código de dispositivo, indicadores de BEC, comportamiento de preparación de ransomware.

**Secure Score.** Captura diaria, tendencia, comparación contra líneas base de la industria.

**Motor de Ajustes de Seguridad.** 17 ajustes de seguridad de Microsoft específicos monitorizados para deriva contra una línea base que tú defines — contenido de listas anti-phishing, configuraciones de métodos de autenticación, estado de políticas DLP, y otros.

Ese es el catálogo de hoy. Se mueve. La mayor parte de la tarjeta 2 (*Amenazas de identidad*) se mapea directamente a evaluadores específicos en esta lista. Cuando decimos que una tarjeta «cubre» un patrón de ataque, lo que queremos decir es: este ataque dispara uno o más de esos evaluadores, la alerta aterriza en Panoptica365, y actúas sobre ella desde ahí.

## Lo que Panoptica365 deliberadamente no hace

Esta parte es más importante que el catálogo de arriba, porque es lo que hace a Panoptica365 distinto de Inforcer, Octiga, 365Sentri, y los demás productos tipo forzador-de-políticas en este espacio.

**No auto-remediamos.** Panoptica365 no va a empujar cambios al tenant M365 de un cliente por su propia iniciativa. Cuando algo deriva, te decimos qué derivó y recomendamos un arreglo. No ejecutamos el arreglo.

Por qué: el modo de fallo de la remediación automática es entregar una línea base mal configurada a las 2 de la madrugada a través de 30 tenants. Recuperarse de eso es mucho peor que el trabajo marginal adicional de un operador haciendo clic en «aplicar». La garantía de «nunca vamos a romper a tus clientes» solo funciona si mantenemos las manos fuera del volante.

**No ejecutamos acciones destructivas dentro del portal de Microsoft en tu nombre.** No hay un botón «deshabilitar usuario» en Panoptica365, ni «restablecer contraseña», ni «revocar sesión». Esas acciones existen en los portales de Microsoft; te enlazamos directamente al sitio donde vive la acción, y tú tomas la decisión.

Por qué: misma lógica. Envolver las acciones destructivas de Microsoft en una UI de terceros es un incidente de cliente esperando a ocurrir. Solo-lectura por diseño.

**No somos un SIEM.** Panoptica365 no ingiere registros de firewall, registros de aplicaciones de terceros, ni telemetría no-Microsoft. Si un cliente necesita eso, la respuesta es Microsoft Sentinel (lección 4) o un SIEM dedicado, no Panoptica365.

**No reemplazamos a Defender XDR.** Cuando se despliega una cadena de ataque y necesitas adentrarte en la línea de tiempo de sesión de un usuario, ese es un trabajo de Defender XDR. Panoptica365 hace aflorar la existencia de la cadena; Defender XDR te muestra el interior. Las dos herramientas están diseñadas para usarse juntas, no en competencia.

**No somos una oferta de servicios gestionados.** Panoptica365 es un producto. No hay un equipo SOC de Panoptica365 manejando alertas en tu nombre. (Augmentt vende eso por separado; Acronis vende Octiga así. Nosotros no.) El trabajo del operador sigue siendo el trabajo del operador.

## Cómo encaja Panoptica365 en el día del operador

El ritmo diario realista para un operador de MSP usando Panoptica365:

**Mañana.** Abre Panoptica365. El panel principal te muestra, a través de todos los tenants de clientes, qué alertas se dispararon durante la noche, qué deriva se detectó, cómo lucen los incidentes de Defender XDR. El correo de briefing matinal resume esto en 30 segundos de lectura; el panel es para los elementos que necesitan atención.

**Triaje.** Haz clic dentro de una alerta específica. El panel deslizable de la alerta te da el detalle estructurado (quién, qué, cuándo), el análisis con IA (explicación generada por Haiku adaptada al nivel de licencia del cliente), el explicador relacionado (el icono de birrete — el primo en-contexto de este programa), y la siguiente acción recomendada. Desde el panel deslizable decides: acusar recibo, eximir, o abrir el portal de Microsoft relevante para investigar y actuar.

**Aplicar.** Cuando un cliente necesita una política nueva — una plantilla de AC, una política de cumplimiento de Intune, un ajuste de EXO — la despliegas desde la biblioteca de plantillas de Panoptica365. Panoptica365 *sí escribe* aquí, pero solo para acciones que el operador eligió explícitamente y solo con pista de auditoría completa.

**Forense.** Cuando un incidente requiere investigación real, sales de Panoptica365 y vas a Defender XDR. El trabajo de Panoptica365 en ese momento es haber hecho obvio que la investigación era necesaria.

**Documentación.** Panoptica365 mantiene un Registro de Cambios del Tenant por cliente (cada acción del operador), un Registro de Auditoría del MSP a través de todos los operadores (quién hizo qué, cuándo, desde qué rol), y un registro de Exenciones (cuándo una alerta se suprimió deliberadamente por una razón). La mayor parte del trabajo para «muéstrame qué cambió en los últimos 30 días», «qué necesitaba ver el equipo de auditoría», o «cuál es la evidencia de que hicimos nuestro trabajo» vive en esas tres vistas.

## La postura «preventivo por diseño»

Panoptica365 tiene una postura filosófica que los otros productos en esta categoría en su mayoría no comparten: creemos que el operador debe estar en el bucle de cada cambio al tenant de un cliente.

Esto se manifiesta en una constelación de decisiones de diseño:

- **Solo-lectura por defecto.** Podemos monitorizar todo; modificamos solo lo que el operador pide explícitamente.
- **Las exenciones son de primera clase.** Cuando un control no se aplica a un cliente (razones regulatorias, razones de modelo de negocio, razones técnicas), el operador registra una exención con justificación y fecha de caducidad. Los operadores futuros ven la justificación.
- **Mutaciones registradas en auditoría.** Cada cambio que Panoptica365 hace a un tenant de cliente se registra con la identidad del operador, su rol, y su razón. Si no hiciste el cambio, puedes probarlo. Si *sí* lo hiciste, puedes mostrar tu trabajo.
- **Sin arreglos silenciosos.** Cuando Microsoft hace algo que recrea deriva (un cambio de valor por defecto del lado de Microsoft, por ejemplo), el operador recibe una alerta. No re-asentamos silenciosamente — eso borraría la visibilidad sobre lo que Microsoft hizo, y esa visibilidad es todo el sentido.

La competencia no está de acuerdo con esta postura, y es un desacuerdo legítimo. Las tiendas de auto-remediación creen que el riesgo marginal de un cambio malo está compensado por el trabajo ahorrado en arreglos rutinarios. Pueden tener razón para algunos clientes; definitivamente están equivocadas para otros. Panoptica365 es la herramienta correcta para los MSP cuya base de clientes no tolera «rompimos algo a las 2 de la madrugada» como modo de fallo aceptable.

## Cómo los MSP inteligentes cobran por Panoptica365

Un consejo de modelo de negocio que debería llegarte cuanto antes mejor: Panoptica365 es una herramienta para hacer a tu MSP mejor protegiendo a los clientes — no un producto para vender directamente a esos clientes.

Cuando tu MSP adopta Panoptica365, la jugada inteligente es agrupar el coste dentro de tu tarifa mensual existente por usuario o por dispositivo. No lo pongas como línea aparte en la factura del cliente. A aproximadamente 1 $ por usuario por mes, es un coste pequeño absorbible dentro de un servicio que ya estás facturando. Ponerlo como línea aparte crea dos conversaciones que no quieres: el cliente pregunta «¿qué es Panoptica365?» — y ahora tienes que explicar una herramienta que se suponía invisible — y puede intentar negociarla fuera — *«no necesitamos una herramienta de monitorización de seguridad, ¿verdad?»* Ambas conversaciones hacen a tu MSP más débil, no más fuerte.

El pitch al cliente sigue siendo simple: «monitorizamos tu seguridad de M365 continuamente, triajeamos alertas a diario, reportamos sobre la postura mensualmente, desplegamos y revisamos plantillas de políticas». Panoptica365 es el *cómo*. El cliente paga por el *qué*. No necesita ver la marca para beneficiarse de ella.

Esta es también la razón por la que nuestro propio marketing se inclina hacia el lado MSP, no hacia el lado del cliente final. No estamos intentando ser un nombre reconocido para el director financiero de tu cliente. Estamos intentando ser la herramienta que un operador abre tranquilamente cada mañana para hacer el día manejable.

## Lo que esto significa para el operador

Tres puntos para llevarte para el trabajo diario.

**Panoptica365 te dice que algo necesita atención; las herramientas de Microsoft te dicen qué hacer al respecto.** El relevo es intencional. Cuando haces clic en «abrir en Defender» desde una alerta, no estás abandonando Panoptica365; lo estás usando como se diseñó.

**Solo-lectura es la característica, no la limitación.** Cuando el CISO de un cliente pregunta «¿qué hace Panoptica365 a nuestro tenant?», la respuesta es: nada que el operador no haya aprobado. Esa es una posición vendible en industrias reguladas y clientes de mercado medio aversos al riesgo.

**Documentar la mitad de «darse cuenta» es la mitad del trabajo.** Cada alerta acusada, cada exención otorgada, cada plantilla desplegada queda registrada. Si necesitas demostrar diligencia debida — a un auditor, a una aseguradora, a un cliente en una conversación de renovación — el registro de auditoría y el registro de cambios son donde vive la evidencia. Úsalos. Referénclalos en los informes a clientes.

## Lo que viene

Has terminado la tarjeta de bienvenida. El mapa está trazado.

A continuación viene **la tarjeta 2: Amenazas de identidad y patrones de ataque**, donde recorremos los seis ataques específicos para los que Panoptica365 fue construido para sacar a la superficie — credential stuffing, fatiga de MFA, phishing AiTM, phishing por consentimiento OAuth, abuso de código de dispositivo, y los patrones de BEC que siguen al compromiso. Al final de la tarjeta 2, cada alerta en tu cola debería mapearse a uno de esos seis (o, ocasionalmente, a varios a la vez).

Después de eso, las tarjetas de controles: Acceso Condicional (tarjeta 3), Intune (tarjeta 4), Endurecimiento del correo (tarjeta 5), y Secure Score (tarjeta 6).

Por ahora: Panoptica365 es la capa que hace «gestionar 30 tenants» manejable sin quitarle a Microsoft el trabajo de Microsoft. Las amenazas de la tarjeta 2 van a llegar a tu cola. Tu trabajo, como operador, es darte cuenta. El nuestro, como herramienta, es hacer que darse cuenta sea fácil.
