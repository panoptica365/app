---
title: "Bloquear autenticación heredada — cerrando el bypass de auth básica"
subtitle: "Por qué IMAP y SMTP AUTH evitan MFA, y cómo una política de AC cierra ese agujero para todos los usuarios."
icon: "ban"
last_updated: 2026-05-29
---

# Bloquear autenticación heredada — cerrando el bypass de auth básica

Activas Exigir MFA para todos los usuarios un lunes por la mañana. Para el martes por la tarde, el atacante que ya tenía la contraseña de un usuario de una fuga de LinkedIn de 2019 inicia sesión en el buzón de ese usuario sobre IMAP. Sin prompt de MFA. Sin desafío. Sin alerta. Solo un inicio de sesión exitoso a un buzón al que no debería tener acceso.

La política de MFA no ayudó porque IMAP no habla MFA. Tampoco POP3, ni SMTP AUTH, ni ninguno de la media docena de otros protocolos de «autenticación heredada» que Microsoft lleva una década intentando retirar. Para una política de AC que dice «exigir MFA», un cliente de auth heredada inicia sesión *como si nunca se hubiera pedido MFA*. El usuario tiene credenciales correctas. No hay prompt de MFA. El inicio de sesión tiene éxito.

Este es el agujero que cierra la plantilla Bloquear Autenticación Heredada.

**Panoptica365 - Block Legacy Authentication.** Concesión: Ninguna (es decir, bloquear). Usuarios: Todos los usuarios. Aplicaciones: Todas las aplicaciones en la nube.

Es la política emparejada con la lección 2. Sin ella, Exigir MFA para todos los usuarios tiene un agujero. Juntas, cierran el camino más común de ataque por robo de credenciales en M365.

## Qué es la «autenticación heredada», exactamente

El término cubre cualquier protocolo de autenticación que no soporte características modernas como MFA, Acceso Condicional, o vinculación de tokens. Los principales infractores:

- **Autenticación básica** — el protocolo nombre-de-usuario-y-contraseña-sobre-HTTP-Basic-Auth. Usado históricamente por Outlook para Mac, Mail.app en iOS antes de iOS 11, remitentes SMTP scripteados.
- **IMAP / POP3 / SMTP AUTH** — los protocolos de correo clásicos. Usados por clientes de correo de terceros, dispositivos de escaneo-a-correo, scripts viejos.
- **Exchange ActiveSync (EAS) auth básica** — la variante de ActiveSync que no soporta auth moderna. Usada por clientes de correo móviles más antiguos.
- **MAPI sobre HTTP auth básica** — la variante de MAPI heredada. Usada por clientes de Outlook muy antiguos.
- **Outlook Anywhere (RPC sobre HTTP) auth básica** — misma familia.

Microsoft lleva años retirando estos. En octubre de 2022, deshabilitaron auth básica para la mayoría de los protocolos de Exchange Online. En 2023 y 2024, extendieron la depreciación a los caminos heredados restantes. Para 2026, la superficie es significativamente más pequeña de lo que era — pero quedan bolsas, y cualquier bolsa es un agujero.

La alternativa no heredada es la **autenticación moderna** — basada en OAuth 2.0, soporta MFA, soporta Acceso Condicional, soporta controles de sesión basados en tokens. Cada cliente M365 soportado desde 2020 habla auth moderna.

## Por qué esta política todavía es necesaria en 2026

Si Microsoft ha retirado la mayoría de la auth heredada, ¿por qué entregar una política que la bloquee?

Tres razones:

**1. La retirada es incompleta.** Microsoft desactivó la auth básica para *la mayoría* de los protocolos de Exchange Online, pero el estado «desactivado por defecto» no significa desactivado en todas partes. Algunos principales de servicio aún pueden autenticarse vía caminos heredados. SMTP AUTH todavía está disponible (Microsoft lo ha estado reactivando y desactivando tenant por tenant durante años). Tenants específicos que pidieron excepciones durante la depreciación pueden todavía tener auth básica activada para uno o más protocolos.

**2. Los clientes reactivan la auth básica.** Cuando el viejo dispositivo de escaneo-a-correo de un cliente deja de funcionar, el camino de menor resistencia es llamar al soporte de Microsoft y pedir que reactiven la auth básica para SMTP. Algunos clientes lo han hecho. La política de AC es lo que atrapa esa decisión — y previene que se haga en silencio.

**3. Algunas aplicaciones no-Microsoft todavía la usan.** Aplicaciones de terceros que se integran con M365 sobre IMAP o SMTP — herramientas más antiguas de automatización de marketing, apps de negocio con credenciales codificadas, el script auto-construido ocasional — hablan auth heredada por diseño. La política de AC fuerza una conversación: o modernizar la integración, o documentar la exclusión.

La política de AC es la red de seguridad duradera. La depreciación de Microsoft a nivel de protocolo puede revertirse a nivel de tenant; una política de AC que está habilitada y monitorizada no puede revertirse en silencio.

## Qué hace

La mecánica de la política es simple:

- **Concesión: Bloquear.** Los inicios de sesión que coinciden con la política son rechazados directamente. Sin prompt de MFA, sin desafío — solo rechazados.
- **Condiciones: Aplicaciones cliente = Otros clientes.** Esta es la condición de AC que captura todo lo que *no es* auth moderna: Exchange ActiveSync auth básica, IMAP, POP3, SMTP AUTH, MAPI sobre HTTP, y algunos otros. La política se aplica solo a inicios de sesión desde esos clientes heredados; los inicios de sesión por auth moderna no se ven afectados.

Así que un usuario abriendo Outlook (auth moderna) no se ve afectado; un script viejo intentando SMTP AUTH desde una caja Linux es bloqueado. La experiencia de usuario para la gran mayoría de usuarios es *sin cambio* — ya están en auth moderna y no notan nada.

## Qué puede romperse cuando lo activas

El pre-despliegue importa aquí, porque el bloqueo de auth heredada es una de las políticas más propensas a sacar a la superficie integraciones desconocidas.

Rotura común:

**Escaneo-a-correo en impresoras.** Las impresoras multifunción más antiguas fueron configuradas hace años para enviar correo vía SMTP AUTH con una cuenta de servicio. Cuando la auth heredada está bloqueada, la impresora ya no puede enviar. El arreglo: o reconfigurar la impresora para usar un relé SMTP moderno (la mayoría de las impresoras modernas soportan OAuth 2.0 SMTP ahora) o mover el escaneo-a-correo a través de un conector que maneje el camino heredado.

**Viejas aplicaciones de negocio con credenciales SMTP codificadas.** Muchas apps internas tienen una función «enviar correo cuando esto pase» configurada con credenciales SMTP codificadas desde 2017. Fallan en silencio cuando son bloqueadas. El cliente lo nota cuando un flujo de trabajo que solía enviar notificaciones deja de enviarlas.

**Herramientas CRM / marketing de terceros con integración de correo basada en IMAP.** Viejas integraciones de Salesforce, viejas configuraciones de HubSpot, herramientas personalizadas de análisis de correo. Algunas todavía usan IMAP por defecto. La mayoría de las versiones modernas soportan IMAP OAuth 2.0, pero las instalaciones heredadas pueden no haber sido actualizadas.

**Macs con versiones antiguas de Mail.app.** Mail.app pre-iOS 11 / pre-macOS 10.14 usa auth básica. Los usuarios con hardware verdaderamente antiguo no pueden conectarse. El arreglo es normalmente «tu ordenador es demasiado antiguo para autenticarse a un sistema de correo empresarial moderno; aquí tienes un presupuesto de 400 $ para uno nuevo». Esta conversación es incómoda pero correcta.

**Scripts PowerShell personalizados que envían correo.** Scripts internos usando `Send-MailMessage` con credenciales codificadas. El arreglo es migrar a `Send-MailKitMessage` o usar la API Graph.

Cada uno de estos es un caso de uso *conocido* de auth heredada que el operador encuentra durante la ventana de solo informe. Ninguno es una razón para *no* activar la política — son razones para planificar la transición cuidadosamente y migrar las integraciones afectadas.

## Despliegue

Esta plantilla se despliega en estado Habilitado como las otras, pero con una diferencia importante: **la rotura de auth heredada es más difícil de predecir que la rotura de MFA**. Las cuentas de servicio que solo se autentican una vez por trimestre (para el informe de fin de año, para el lote de facturación recurrente) no aparecen en el inventario pre-despliegue ni en la primera semana de monitorización. Su fallo se manifiesta meses después.

Por esa razón, el paso manual de solo informe en el portal de Entra es **fuertemente recomendado para esta política específica sin importar el tamaño del tenant**, incluso en tenants de pequeña empresa donde las otras plantillas pueden desplegarse en caliente. Despliega vía Panoptica365 (crea la política en estado Habilitado), luego cambia inmediatamente la política a solo informe en el portal de Entra, y ejecuta una ventana de solo informe de *14 días*.

Durante la ventana de solo informe, saca el registro de inicios de sesión filtrado por «Bloqueo requerido — Resultado de solo informe, Cliente = Otros clientes». Inventariar:

- ¿Qué usuarios? (Sobre todo cuentas de servicio; algunos usuarios reales en clientes viejos.)
- ¿Qué protocolos? (SMTP AUTH es el más común.)
- ¿Qué IPs / dispositivos? (Impresoras, scripts, integraciones de terceros.)

Luego trabaja a través del inventario:

- Para cada caso de uso legítimo, identifica un camino de modernización, o acepta que la cuenta se queda en auth heredada y documenta la exclusión en Panoptica365 con una fecha de retiro.
- Para cada inicio de sesión sospechoso o desconocido, trátalo como compromiso potencial — mismo manual que la respuesta al credential stuffing de la lección 1 de la tarjeta 2.

Comunícale a los usuarios con clientes viejos sobre el cambio que viene. Proporciona instrucciones de modernización. Luego cambia la política de vuelta a Habilitado en el portal de Entra.

La ventana de solo informe de 14 días para auth heredada es más larga que para la mayoría de las políticas porque los casos de uso de auth heredada se esconden en ciclos mensuales y trimestrales. Una ventana de 3 días se pierde demasiadas integraciones silenciosas.

## Qué monitorizar después de la aplicación

**Intentos de inicio de sesión con `Otros clientes` que tienen éxito.** Debería ser cero después de la aplicación (la política los bloquea). Cualquier inicio de sesión exitoso vía caminos heredados significa una brecha de política — una exclusión que es demasiado amplia, o un protocolo que la política no cubre.

**Intentos de inicio de sesión con `Otros clientes` que fallan con un bloqueo de AC.** Debería ser el ruido diario normal — atacantes sondeando, scripts viejos en cuentas excluidas. Presta atención al *origen*. Una ráfaga de intentos de auth heredada en múltiples cuentas desde una sola IP es credential stuffing usando una botnet que no ha seguido el ritmo de la auth moderna.

**Deriva en la política.** La misma detección de deriva que se aplica a Exigir MFA se aplica aquí. Si la política se deshabilita o su alcance se reduce, alguien (el otro administrador del cliente, un técnico del soporte de Microsoft) ha aflojado el perímetro.

## El orden importa

Bloquear Auth Heredada debería activarse *después* de Exigir MFA, no antes. Razonamiento:

- Exigir MFA cubre todos los inicios de sesión por auth moderna. La política de MFA pone el segundo factor delante del camino solo-contraseña.
- Bloquear Auth Heredada cubre todos los inicios de sesión no por auth moderna. La política de bloqueo pone un muro delante del camino solo-contraseña que *no soporta* MFA.

Juntas, cierran la superficie: cualquier inicio de sesión o tiene MFA (moderno) o es bloqueado directamente (heredado). No hay camino a través con solo una contraseña.

Si activaras Bloquear Auth Heredada *primero*, los inicios de sesión por auth moderna sin MFA seguirían teniendo éxito. Si activaras Exigir MFA *primero* sin Bloquear Auth Heredada, los inicios de sesión por auth heredada seguirían teniendo éxito. La pareja tiene que desplegarse junta; el orden es «MFA primero, luego Bloquear Auth Heredada unos días después». La política de MFA puede activarse con alcance más amplio y menor riesgo de rotura; Bloquear Auth Heredada luego cierra el agujero restante.

## Qué ve Panoptica365

La detección exitosa de intentos bloqueados por esta política llega por la ingesta estándar del registro de inicios de sesión. Tres señales que importan:

- **Una ráfaga de bloqueos de auth heredada** en múltiples cuentas desde una sola IP — credential stuffing por un protocolo heredado. Mismo triaje que el patrón de credential stuffing por auth moderna.
- **Un inicio de sesión exitoso inesperado por auth heredada** — alguien aflojó la política. Investiga.
- **Una lista de exclusiones que crece de forma inesperada** — deriva en la propia política, sacada a la superficie por el detector de deriva de AC de Panoptica365.

El dónut de Actividad Diaria saca el volumen de bloqueos de AC en casi-tiempo-real, incluyendo los bloqueos de auth heredada. Después de la aplicación, el volumen de bloqueos de auth heredada debería ser un número bajo estable (atacantes sondeando) sin picos.

## Lo que esto significa para el operador

Tres puntos para llevarte.

**Bloquear Auth Heredada es la compañera de Exigir MFA, no un reemplazo.** Ambas son necesarias. La política de MFA cubre el camino que usan los usuarios; la política de Bloquear Auth Heredada cubre el camino que prefieren los atacantes.

**La ventana de solo informe es más larga aquí que para otras políticas.** Los casos de uso de auth heredada se esconden en automatizaciones mensuales y trimestrales que no aparecen en una muestra de solo informe de 3 días. Presupuesta dos semanas.

**Resiste la presión del cliente para hacer exclusiones amplias.** «Nuestra impresora necesita SMTP AUTH» es cierto; «necesitamos excluir a todo el departamento de IT» no lo es. Cada exclusión es una cuenta específica en una IP específica con un caso de uso documentado y una fecha de retiro. Las exclusiones amplias son cómo esta política se compromete en cámara lenta.

## Lo que viene

- **Lección 4: Ubicación de confianza O dispositivo conforme.** La próxima capa de AC — basada en ubicación con una válvula de escape inteligente para dispositivos conformes.
- **Lección 5: Conforme O híbrido O MFA.** El camino de actualización que usa señales de confianza de dispositivo para reducir la fricción en inicios de sesión por dispositivo gestionado.

Por ahora: esta política más Exigir MFA de la lección 2 son la línea base. Hasta que ambas estén habilitadas y verificadas en un tenant de cliente, ninguno de los trabajos de AC más sofisticados en lecciones posteriores importa — el camino de ataque solo-credenciales sigue abierto.

---

*Fuentes de los datos en esta lección — Microsoft Learn sobre autenticación heredada y retiro de auth básica ([Microsoft Learn — Deprecation of Basic authentication in Exchange Online](https://learn.microsoft.com/en-us/exchange/clients-and-mobile-in-exchange-online/deprecation-of-basic-authentication-exchange-online)); referencia de la condición «Otros clientes» de Acceso Condicional ([Microsoft Learn — Conditional Access: Client apps condition](https://learn.microsoft.com/en-us/entra/identity/conditional-access/concept-conditional-access-conditions#client-apps)); resumen de autenticación moderna ([Microsoft Learn — Modern authentication](https://learn.microsoft.com/en-us/microsoft-365/enterprise/modern-auth-for-office-2013-and-2016)).*
