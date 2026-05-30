---
title: "Phishing por consentimiento OAuth — el ataque que sobrevive a un restablecimiento de contraseña"
subtitle: "Engañar a usuarios para que otorguen permisos OAuth a una app maliciosa da acceso persistente al buzón que sobrevive a cualquier cambio de contraseña."
icon: "link"
last_updated: 2026-05-29
---

# Phishing por consentimiento OAuth — el ataque que sobrevive a un restablecimiento de contraseña

Un usuario recibe un correo: «Ver archivo compartido en PerformanceReview-Pro». Hace clic. Un diálogo de consentimiento de Microsoft de apariencia familiar aparece. El diálogo dice: «PerformanceReview-Pro quiere permiso para: leer tu correo, enviar correo en tu nombre, leer todos los archivos a los que tienes acceso». El usuario tiene prisa. Hace clic en «Aceptar».

No hay contraseña que escribir. Ni prompt de MFA. Nada que *parezca* un ataque. El diálogo se ve como los diálogos de consentimiento que el usuario ve una vez al mes para aplicaciones legítimas. Dos segundos y un clic, y el usuario acaba de entregar a un atacante acceso persistente a su buzón y a sus archivos.

Tres semanas más tarde, el equipo de seguridad restablece la contraseña del usuario por culpa de alguna alerta sin relación. El atacante sigue dentro del buzón. Porque el atacante nunca necesitó la contraseña.

Esto es el phishing por consentimiento OAuth, y es el ataque peligroso más silencioso del ecosistema de M365.

## Por qué este ataque es estructuralmente distinto

Cada otro ataque en esta tarjeta depende de obtener la *autenticación* del usuario — su contraseña, su MFA, su cookie de sesión. El usuario cambia su contraseña y el ataque termina.

El phishing por consentimiento OAuth no toca la autenticación. Convence al usuario para que conceda a una aplicación de terceros *permiso* para acceder a sus datos en su nombre. Microsoft emite a esa aplicación un token de actualización que está atado a la *aplicación*, no a la contraseña del usuario. La aplicación ahora puede pedir tokens de acceso frescos cuando quiera, indefinidamente, hasta que o bien el usuario revoque el consentimiento o un administrador deshabilite el registro empresarial de la aplicación.

Restablecer la contraseña del usuario no revoca el consentimiento. Deshabilitar la cuenta del usuario no siempre revoca el consentimiento (depende de la configuración). Forzar al usuario a rehacer MFA no revoca el consentimiento. El consentimiento es el ataque, y el consentimiento se pega.

Eso es lo que hace este ataque únicamente valioso para los atacantes en 2026: *la persistencia*. La mayoría de los compromisos terminan en el restablecimiento de la contraseña. Este no.

## El flujo OAuth, brevemente

OAuth 2.0 es el protocolo legítimo que te permite decir «quiero usar esta aplicación de calendario, y la aplicación de calendario necesita leer mi calendario de Outlook». En lugar de darle a la aplicación tu contraseña de Microsoft (lo que sería imprudente), inicias sesión en Microsoft, Microsoft pregunta si estás seguro de querer darle a la aplicación los permisos específicos que está pidiendo, y si dices que sí, Microsoft le entrega a la aplicación un token que puede usar para actuar en tu nombre para esos permisos específicos.

Este es un *buen* protocolo. Cada integración legítima de productividad lo usa — tu plugin de Zoom, tu Calendly, tu Trello, tu asistente de IA de la semana. El patrón está bien.

El ataque abusa del patrón. El atacante registra una aplicación maliciosa en Entra ID (o bien en su propio tenant o en un tenant comprometido), le pone un nombre convincente, y engaña a los usuarios para que consientan a ella. El protocolo funciona correctamente; el usuario hizo clic en el botón. Desde la perspectiva de Microsoft, el consentimiento es legítimo.

## Qué permisos importan

No todos los ámbitos OAuth son igualmente peligrosos. El catálogo de permisos de Microsoft Graph es enorme, y un atajo útil para el triaje es mirar tres cosas:

**Permisos delegados vs permisos de aplicación.** Los permisos delegados actúan *como el usuario* — la aplicación puede hacer lo que el usuario puede hacer. Los permisos de aplicación son *autónomos* — la aplicación puede actuar en nombre del tenant entero sin que un usuario esté presente. Los permisos de aplicación son mucho más peligrosos y requieren consentimiento de administrador (no los puedes aprobar como usuario regular). La mayoría de los ataques de phishing por consentimiento se dirigen a los permisos delegados porque pasan por un flujo de consentimiento de usuario normal.

**Read vs ReadWrite.** Un ámbito `Mail.Read` le permite a la aplicación leer correo. Un ámbito `Mail.ReadWrite` le permite enviar correo y modificar el estado del buzón. Read solo es malo; ReadWrite es mucho peor. Busca `.ReadWrite`, `.Send`, `.Manage`, `.All` en los ámbitos solicitados — esos son los de alto valor.

**Mail, Files, Contacts, Calendar — los ámbitos de datos.** `Mail.ReadWrite`, `Files.ReadWrite.All`, `Contacts.Read`, `Calendars.Read`. Esto es lo que quieren los atacantes. Una aplicación maliciosa con `Mail.ReadWrite` puede leer cada correo que el usuario tenga y enviar correo como él. Eso es suficiente para correr una operación de BEC completamente a través de OAuth, sin que ninguna contraseña cambie de manos.

**El ámbito asesino: `offline_access`.** Este es el que concede un token de actualización. Sin él, la aplicación solo puede actuar mientras el usuario esté interactuando. Con él, la aplicación puede actuar sobre los datos del usuario indefinidamente, incluso cuando el usuario no esté en línea. Casi cada aplicación legítima de productividad lo solicita, y por eso no parece sospechoso. Casi cada maliciosa también.

## Qué ve el usuario

El diálogo de consentimiento es la última línea de defensa de Microsoft, y funciona solo en la medida en que el usuario lo lea.

La mayoría de los usuarios ven algo así y hacen clic en Aceptar sin leer:

> **PerformanceReview-Pro** quiere:
> - Iniciar tu sesión y leer tu perfil
> - Leer tu correo
> - Tener acceso completo a tu buzón
> - Mantener acceso a los datos a los que le has dado acceso
> - Leer todos los archivos a los que tienes acceso

Si el usuario lee, las señales de aviso están ahí. «Leer tu correo» no es algo que la mayoría de las aplicaciones necesiten. «Tener acceso completo a tu buzón» es la asesina. «Mantener acceso a los datos a los que le has dado acceso» es el ámbito `offline_access` con otro nombre.

Pero la gente no lee los diálogos de consentimiento. La investigación de Microsoft sobre su guía de phishing por consentimiento es inequívoca al respecto: los usuarios hacen clic a través de los diálogos casi universalmente si el nombre de la aplicación parece plausible. El diálogo es un control de defensa en profundidad; no es, por sí mismo, la defensa.

## Cómo registra el atacante la aplicación maliciosa

Dos caminos, ambos comunes:

**Camino 1: registrar en su propio tenant.** El atacante crea un tenant gratuito de desarrollador de Microsoft, registra una aplicación allí, y configura la aplicación para soportar autenticación multi-tenant. La aplicación puede entonces invocarse contra los usuarios de cualquier otro tenant. El atacante controla la aplicación y recibe todos los tokens consentidos a ella.

**Camino 2: registrar en un tenant previamente comprometido.** Si el atacante ya ha vulnerado un tenant (vía AiTM, credential stuffing, o lo que sea), puede registrar una aplicación allí y luego usar esa aplicación para hacer phishing a usuarios de otros tenants. El campo `publisher` de la aplicación muestra el nombre del tenant comprometido, lo que a veces añade una capa de falsa legitimidad («ah, esto es de un proveedor con el que trabajamos»).

En ambos casos, la aplicación maliciosa termina siendo reportada a Microsoft y deshabilitada — pero «termina» es de días a semanas, y el atacante ya tiene los tokens de consentimiento para entonces. Deshabilitar la aplicación después no revoca retroactivamente los tokens ya emitidos.

## Cómo llega el correo

El correo de phishing es típicamente uno de tres pretextos:

**El pretexto «archivo compartido».** «Ver archivo compartido en [Nombre de aplicación plausible]». El clic lleva a un diálogo de consentimiento para una aplicación que supuestamente aloja el archivo.

**El pretexto «tu herramienta de IA/seguridad/productividad».** «Tu cuenta ha sido aprovisionada para [Herramienta plausible]». El clic lleva a un diálogo de consentimiento bajo el pretexto de incorporación.

**El pretexto OAuth-como-bypass-de-MFA.** «Inicia sesión para verificar tu identidad para RRHH / IT / Finanzas». La variante más sofisticada. El usuario piensa que se está autenticando; en realidad está consintiendo.

Los tres presentan el *diálogo real de consentimiento de Microsoft* porque el atacante está usando el protocolo OAuth legítimo contra los endpoints reales de Microsoft. No hay una barra de URL falsa que notar. La única señal disponible para el usuario es el *contenido* del diálogo de consentimiento — que, como ya se ha establecido, no lee.

## Qué hace Microsoft al respecto

Algunas defensas están en su sitio por defecto; otras requieren configuración.

**Verificación del editor de la aplicación.** Microsoft ofrece una insignia «editor verificado» para aplicaciones de organizaciones confirmadas. Los usuarios pueden configurarse para que solo consientan a aplicaciones verificadas. Esto es significativo — verificarse requiere un registro de Microsoft Partner y algún papeleo no trivial — pero las aplicaciones no verificadas siguen estando permitidas por defecto en la mayoría de los tenants.

**Políticas de consentimiento del usuario (Entra ID).** El administrador puede restringir qué permisos pueden consentir los usuarios sin aprobación del administrador. Microsoft revisó estas opciones a finales de 2024 / 2025, así que el menú en el portal de Entra hoy se ve así:

- *No permitir el consentimiento del usuario.* Todo requiere aprobación del administrador. Muy seguro, a menudo demasiado restrictivo para organizaciones con integraciones legítimas de productividad.
- *Permitir el consentimiento del usuario para aplicaciones de editores verificados, para permisos seleccionados.* Los usuarios pueden consentir a aplicaciones de editores verificados o a aplicaciones registradas en la propia organización del usuario, y solo para permisos que Microsoft clasifica como «de bajo impacto». El terreno medio explícito y predecible.
- *Dejar que Microsoft gestione los ajustes de consentimiento* (la opción recomendada de Microsoft a partir de 2025, y el nuevo valor por defecto en tenants frescos). Microsoft actualiza automáticamente la política de consentimiento del tenant para alinearse con sus directrices actuales. Un sub-interruptor — *Habilitar consentimiento del usuario para clientes de correo populares* — permite a los usuarios consentir a aplicaciones populares de correo de terceros para permisos específicos de Mail (Apple Mail, Thunderbird y similares). El sub-interruptor es una concesión de usabilidad que la mayoría de los tenants necesitan, pero afloja la política en el rincón de permisos de Mail de la superficie.

La antigua opción «Permitir el consentimiento del usuario para todas las aplicaciones» que quizá recuerdes del portal de Entra más antiguo ha sido retirada. Esa retirada es en sí misma un reconocimiento por parte de Microsoft de que la era de permisivo-por-defecto ha terminado.

Para un MSP que gestiona tenants de clientes, **la opción de editores-verificados-y-bajo-impacto suele seguir siendo la mejor elección** — no porque sea más segura que la opción gestionada por Microsoft en términos absolutos, sino porque es *predecible*. Sabes exactamente cuál es tu política; tú controlas cuándo cambia; el rastro de auditoría es tuyo. «Dejar que Microsoft gestione» es apropiado para tenants sin MSP que quieren mantenerse al día con los valores por defecto cambiantes de Microsoft; para tenants que tú gestionas, quieres ser tú quien decide qué cambia y cuándo — y quieres que cualquier cambio de política aterrice en tu registro de cambios, no en las notas de versión de Microsoft.

Cualquiera de las dos opciones no-bloqueantes que elijas, la mayor parte de los ataques de phishing por consentimiento OAuth fallan en la etapa del diálogo de consentimiento porque la aplicación maliciosa no es de un editor verificado y no está pidiendo un permiso de «bajo impacto».

**Flujo de aprobación del administrador.** Cuando los usuarios intentan consentir a una aplicación que excede sus permisos permitidos, pueden enviar una «solicitud de consentimiento del administrador» en su lugar. El administrador revisa y aprueba o rechaza. Añade un paso de revisión humana antes de que aplicaciones de alto permiso entren en el tenant.

**Descubrimiento de aplicaciones anómalas de Defender for Cloud Apps.** MDA (E5 o como complemento) detecta comportamiento inusual de aplicación — una aplicación que de repente empieza a acceder a muchos más buzones de lo habitual, o una aplicación que no se veía ayer pero está exfiltrando datos hoy. Las alertas se disparan sobre la anomalía *comportamental*, que pilla incluso aplicaciones que lograron pasar por el diálogo de consentimiento.

**Attack Disruption de Defender XDR** también cubre incidentes de abuso OAuth — cuando MDA + correlación de inicio de sesión alcanza alta confianza de que una aplicación consentida está exfiltrando, Disruption puede deshabilitar la aplicación y revocar sus tokens.

## Cómo es realmente la revocación

Cuando descubres una aplicación consentida maliciosa — o bien vía una alerta o porque el cliente reportó comportamiento extraño — los pasos son:

**1. Identificar la aplicación en Entra ID.** Aplicaciones empresariales → buscar por nombre o por registro reciente → encontrar la maliciosa. Confirmar los permisos sospechosos (Mail.ReadWrite + offline_access es la firma clásica).

**2. Retirar el consentimiento del usuario.** Por cada usuario afectado, el consentimiento está en su colección `oauth2PermissionGrants`. El administrador puede revocar por usuario o a nivel de toda la organización.

**3. Deshabilitar o eliminar el principal de servicio de la aplicación.** Esto detiene la aplicación de autenticarse en absoluto. Hecho desde el blade de aplicaciones empresariales.

**4. Revocar todos los tokens de actualización de los usuarios afectados.** Este es el paso *crítico*. Hasta que los tokens de actualización se revoquen, el atacante puede seguir generando tokens de acceso. Usa `Revoke-AzureADUserAllRefreshToken` (heredado) o la llamada equivalente a la API de Graph. Nota que Microsoft está en medio de una evolución de cómo funciona esto — algunos tokens de actualización están vinculados a aplicaciones específicas y sobreviven a la revocación a nivel de usuario. El movimiento más seguro es invalidar también la contraseña del usuario, aunque estrictamente eso no deshabilite la aplicación.

**5. Auditar los buzones afectados.** Mira correo enviado, reglas de reenvío, descargas de archivos, cualquier cosa que la aplicación pudiera haber hecho mientras tuvo acceso. Trátalo como un compromiso confirmado y ejecuta el manual completo de recuperación de BEC (lección 6).

**6. Bloquear la URL de respuesta de la aplicación o el tenant de la aplicación.** Si la aplicación maliciosa está registrada en un tenant conocido-malo, puedes usar Acceso Condicional para bloquear inicios de sesión a ese tenant.

La limpieza completa es más involucrada que para un compromiso de restablecimiento de contraseña. Ese es el punto del ataque — lo eligen los atacantes porque es difícil de limpiar.

## Qué ve Panoptica365

El phishing por consentimiento OAuth sale a la superficie en Panoptica365 a través de varios tipos de alertas:

**Alertas de nuevas concesiones OAuth.** Cuando un usuario consiente a una nueva aplicación en el tenant de un cliente, el consentimiento aparece en el Unified Audit Log y Panoptica365 puede sacarlo a la superficie (especialmente si los permisos solicitados incluyen `Mail.ReadWrite`, `Files.ReadWrite.All`, o `offline_access`). La alerta exacta depende de si se usó el patrón concesión-de-usuario o concesión-de-administrador.

**Anomalías de Defender for Cloud Apps** ingeridas vía Defender XDR. Cuando MDA detecta que una aplicación previamente consentida se está comportando de forma anómala (volumen inusual de lecturas de buzón, actividad súbita en una región donde la aplicación nunca había estado antes, etc.), la alerta resultante fluye a Panoptica365.

**Actividad sospechosa de aplicación correlacionada con inicios de sesión.** Cuando la cuenta del mismo usuario muestra una concesión OAuth + un evento de seguimiento como una concesión de permisos de buzón o una regla de reenvío, ambas alertas aparecerán cerca una de la otra. Trátalas como el mismo incidente.

Lo que Panoptica365 no hace actualmente es un inventario completo de aplicaciones OAuth por tenant con puntuación de riesgo. Por ahora, el flujo de trabajo manual es: cuando una alerta se dispara, abre la vista de aplicaciones empresariales del portal de Entra para el tenant del cliente, filtra por consentidas recientemente, y revisa.

## Defender al cliente

Defensas en capas, por orden de impacto:

**Configurar el consentimiento del usuario en «editores verificados, solo permisos de bajo impacto».** Este es el cambio de configuración con mayor palanca. Elimina la mayor parte del phishing por consentimiento en la etapa del diálogo. Para tenants gestionados por MSP, esta opción explícita es preferible a «Dejar que Microsoft gestione» porque tú controlas la política y cualquier cambio aterriza en tu rastro de auditoría en lugar de las notas de versión de Microsoft. Configurar una vez por tenant.

**Implementar el flujo de aprobación del administrador.** Cuando los usuarios quieren consentir a aplicaciones más allá del ámbito permitido, envían una solicitud. El administrador revisa. Añade una comprobación de sentido común sin bloquear aplicaciones legítimas.

**Inventariar las aplicaciones consentidas existentes periódicamente.** Cada tenant de Entra de cliente tiene una lista de aplicaciones empresariales. Revísala trimestralmente. Busca aplicaciones con nombres que no reconozcas, aplicaciones con permisos amplios, aplicaciones que fueron concedidas por usuarios que no deberían consentir a aplicaciones con permisos amplios. Quita cualquier cosa sospechosa.

**Entrenar a los usuarios para que lean los diálogos de consentimiento.** Específicamente: cualquier cosa pidiendo `Mail.ReadWrite` o `Files.ReadWrite.All` de un editor desconocido es casi siempre maliciosa. Este es uno de los pocos entrenamientos de seguridad que tiene una acción concreta («mira los permisos, luego o haz clic en Cancelar o consulta con IT primero»).

**Usar Acceso Condicional para exigir aprobación del administrador para nuevos inicios de sesión de aplicación.** Una política de AC puede exigir aprobación del administrador antes del primer inicio de sesión de un usuario a una aplicación recién registrada. Ralentiza significativamente el ataque.

**Para tenants E5, activar Defender for Cloud Apps y configurar políticas de gobernanza de aplicaciones.** MDA puede poner en cuarentena aplicaciones de alto riesgo automáticamente y alertar sobre comportamiento anómalo. Vale la pena activarlo.

## Lo que esto significa para el operador

Tres puntos para llevarte.

**El consentimiento se pega; trátalo como instalar software.** Una vez que un usuario consiente a una aplicación, esa aplicación tiene acceso hasta que alguien lo revoque explícitamente. Trata el consentimiento OAuth como tratarías instalar software en un endpoint — revisar, aprobar, documentar. En cualquier sitio donde los usuarios de un cliente puedan auto-consentir ampliamente, tienes un agujero.

**Mail.ReadWrite + offline_access es el equivalente OAuth de «preparación de ransomware».** Cuando ves esta combinación de ámbitos en una aplicación, mírala largo. Hay aplicaciones legítimas que la necesitan, pero la mayoría no, y las aplicaciones atacantes casi siempre sí.

**La limpieza es más difícil que para compromisos de contraseñas.** Planifica en consecuencia. Cuando se dispare la alerta, dedícale más tiempo del que dedicarías a un incidente de restablecimiento de contraseña, porque los pasos son: identificar la aplicación, revocar consentimientos por usuario, deshabilitar el principal de servicio, revocar tokens de actualización, auditar los datos afectados, y restablecer la contraseña del usuario por si acaso. Trata cada incidente de aplicación-consentida-maliciosa como un proyecto pequeño, no un arreglo rápido.

## Lo que viene

- **Lección 5: Abuso del código de dispositivo.** Estrechamente relacionado con el phishing por consentimiento en el sentido de que abusa de un flujo de autenticación legítimo de Microsoft. Storm-2372 — el actor vinculado a Rusia — ha estado corriendo campañas de código de dispositivo a escala desde agosto de 2024.
- **Lección 6: BEC.** Donde el acceso adquirido por OAuth a menudo termina — monitorización silenciosa de buzón, manipulación de facturas, fraude de transferencia.

Por ahora: el phishing por consentimiento OAuth es el compromiso persistente más silencioso del catálogo M365. Las defensas están a nivel de configuración — fijar las restricciones de consentimiento del usuario correctamente y la mayoría de los ataques fallan en el diálogo. La limpieza está implicada. La lección para los clientes es que no todas las amenazas necesitan usar la contraseña.

---

*Fuentes de los datos en esta lección — Microsoft Learn sobre ajustes de consentimiento de usuario y administrador ([Microsoft Learn — Configure user consent settings](https://learn.microsoft.com/en-us/entra/identity/enterprise-apps/configure-user-consent)); patrones de phishing por consentimiento OAuth ([Microsoft Learn — Illicit consent grant attacks](https://learn.microsoft.com/en-us/defender-office-365/detect-and-remediate-illicit-consent-grants)); referencia de permisos de Microsoft Graph ([Microsoft Graph permissions reference](https://learn.microsoft.com/en-us/graph/permissions-reference)); gobernanza de aplicaciones de Defender for Cloud Apps ([Microsoft Learn — App governance](https://learn.microsoft.com/en-us/defender-cloud-apps/app-governance-manage-app-governance)); procedimiento de revocación de tokens de actualización ([Microsoft Learn — Revoke user access in an emergency](https://learn.microsoft.com/en-us/entra/identity/users/users-revoke-access)).*
