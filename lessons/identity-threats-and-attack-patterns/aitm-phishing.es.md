---
title: "Phishing AiTM — el rey de 2026"
subtitle: "Los proxies inversos adversario-en-el-medio roban cookies de sesión completamente autenticadas — el MFA estándar por push no es ninguna defensa."
icon: "fish"
last_updated: 2026-05-29
---

# Phishing AiTM — el rey de 2026

Si la fatiga de MFA es el bypass del ingeniero social, AiTM es el bypass del ingeniero. No le pide al usuario que tome una mala decisión — simplemente le deja tomar una decisión perfectamente correcta sobre una imitación perfectamente convincente. El usuario escribe su contraseña, completa el prompt de MFA, y se va pensando que no pasó nada. Mientras tanto el atacante ahora tiene una cookie de sesión completamente autenticada por MFA y puede iniciar sesión en M365 como ese usuario desde cualquier sitio, en cualquier dispositivo, hasta que la cookie expire.

Microsoft rastreó un **aumento del 146 % en ataques AiTM en 2024** y la curva no se ha doblado hacia abajo desde entonces. Los kits de phishing que automatizan este ataque — Evilginx, Muraena, Modlishka — son libres, de código abierto, y fáciles de desplegar. La barrera de costo para correr una campaña AiTM se ha ido efectivamente a cero. El MFA estándar basado en push no es ninguna defensa.

Esta es la lección más profunda y más larga de la tarjeta porque AiTM es el ataque de identidad de mayor impacto del momento. Lee despacio.

## Qué significa de verdad «adversario en el medio»

Imagina una llamada telefónica enrutada a través de un operador que puede escuchar, tomar notas, y desconectarte en cualquier momento. Ambos extremos creen que están hablando entre sí. El operador lo oye todo.

Ahora haz al operador un sitio web. El usuario escribe `outlook.office.com` en su navegador. O, más exactamente, el usuario *hace clic en un enlace en un correo* que se ve como `outlook-office.com.signin-microsoft.help` (un dominio registrado hace seis horas). Ese dominio es el operador — un proxy inverso. Reenvía cada petición HTTP al servicio *real* de inicio de sesión de Microsoft, y devuelve cada respuesta al navegador del usuario. Desde la pantalla del usuario, todo se ve normal. La página real de inicio de sesión de Microsoft. El prompt real de MFA de Microsoft. La pregunta real «¿Quieres mantenerte conectado?» de Microsoft.

Lo único distinto es la barra de URL. Y nadie lee la barra de URL.

Lo que el operador-en-el-medio está capturando no es la contraseña (aunque también la consigue). Es la **cookie de sesión** — la cosa que Microsoft devuelve tras un inicio de sesión exitoso para decir «este navegador está ahora autenticado hasta las 16:00 del viernes». Una vez que el sitio AiTM tiene esa cookie, el atacante puede pegarla en su propio navegador, y *es* el usuario. No más contraseña necesaria. No más MFA necesario. El token es el premio.

Es por esto que el resto de esta tarjeta y las próximas dos tarjetas vuelven una y otra vez a la *protección de sesión* como el juego de verdad. La contraseña es incidental; la sesión es lo que importa.

## Paso a paso

Recorre un ataque AiTM real:

**Paso 1: Llega el correo de phishing.** «Acción requerida: Su sobre de DocuSign está esperando su revisión.» El enlace se ve como `secure-docusign.helpfile-portal.com/?eid=ABC...`. El usuario hace clic.

**Paso 2: El usuario aterriza en lo que parece una página de inicio de sesión de Microsoft.** Píxel-perfecta. La barra de URL muestra el dominio del atacante, pero el usuario no mira. Escribe su dirección de correo.

**Paso 3: El proxy AiTM reenvía esa dirección de correo a `login.microsoftonline.com`.** Microsoft, servicialmente, devuelve la *marca real del tenant* para la empresa de ese usuario — el logo del cliente, el texto de bienvenida personalizado, todo. El proxy reenvía todo eso de vuelta al usuario. La página ahora se ve incluso más legítima, porque *es* la página legítima, simplemente enrutada.

**Paso 4: El usuario escribe la contraseña.** El proxy la captura, la reenvía a Microsoft. Microsoft responde con «Desafío de MFA requerido». El proxy reenvía el prompt de MFA al usuario.

**Paso 5: El usuario completa MFA.** Number matching de Microsoft Authenticator, toque de llave FIDO2, lo que sea que el usuario tenga configurado — todo se reenvía fielmente a través del proxy. El usuario está haciendo exactamente lo que normalmente hace.

**Paso 6: Microsoft devuelve una cookie de sesión.** Este es el premio. El proxy captura la cookie antes de reenviarla al usuario. El navegador del usuario ahora tiene una sesión funcional y aterriza en el Outlook real. Él cree que ha iniciado sesión con éxito. En lo que a Microsoft respecta, lo ha hecho.

**Paso 7: El atacante importa la cookie capturada a su propio navegador.** Ahora ha iniciado sesión como el usuario. Sin desafío de contraseña. Sin prompt de MFA. Microsoft ve un navegador presentando un token de sesión válido y con MFA, y concede acceso.

**Paso 8: El atacante hace lo que vino a hacer.** Leer correo, configurar reglas de reenvío, buscar «transferencia bancaria» o «factura» en la bandeja de entrada del usuario, registrar un nuevo dispositivo de MFA para sí mismo (para no tener que repetir toda esta danza), quizás moverse lateralmente. La cookie de sesión expira tras algunas horas, pero para entonces el atacante o bien tiene persistencia en otro sitio o ha terminado su trabajo.

El flujo completo tarda minutos. El usuario a menudo nunca sabe que pasó — completó el inicio de sesión, vio su correo, cerró la pestaña, siguió con su día.

## Por qué MFA no ayuda

Esta es la parte que confunde a la gente que se formó en seguridad hace diez años. Se suponía que MFA iba a ser la respuesta. ¿Por qué no detiene esto?

Porque MFA prueba *que el usuario está presente en el momento del inicio de sesión*. *No* prueba que *el inicio de sesión va al sitio correcto*. El proxy AiTM se mete entre el usuario y Microsoft, y MFA valida correctamente con el proxy en medio. El usuario prueba que está presente; el proxy roba el resultado.

Esta es la fisura estructural que el robo de tokens explota en general, y que AiTM explota en particular. La defensa tiene que ser algo que *ate la autenticación a un destino específico*, no solo al usuario.

Eso es lo que hace el MFA resistente al phishing — y por qué realmente importa.

## MFA resistente al phishing: qué es distinto

**Las llaves de seguridad FIDO2, las passkeys y Windows Hello for Business** usan una técnica criptográfica llamada *vinculación al origen*. Cuando el usuario registra una passkey para `login.microsoftonline.com`, la passkey está matemáticamente atada a ese dominio específico. Cuando el usuario más tarde inicia sesión, el navegador le dice a la passkey contra qué dominio se está autenticando. Si el dominio es `outlook-office.com.signin-microsoft.help` en lugar de `login.microsoftonline.com`, la passkey *se niega a firmar*.

El usuario no puede saltarse esto. El proxy no puede hacer proxy alrededor de esto, porque la firma criptográfica incluye el dominio como un campo firmado. No hay manera de engañar a una passkey para que firme para el sitio equivocado.

Esa es la defensa técnica significativa contra AiTM, y es la *única* defensa que funciona en el momento de la autenticación mismo. Todo lo demás en esta lección es mitigación que ocurre después de que la cookie es capturada.

Tres métodos resistentes al phishing que verás en el campo, con sus compromisos:

**Passkeys** — almacenan la clave privada en el teléfono del usuario (passkeys sincronizadas) o en el dispositivo (passkeys vinculadas al dispositivo). Mejor UX. El más universal. Microsoft ha estado empujando con fuerza la adopción de passkeys desde finales de 2024.

**Llaves de seguridad FIDO2** — token hardware (YubiKey, etc.). Mejor postura de seguridad; requiere posesión física. Un poco más de fricción (llevar una llave, enchufarla). Adecuado para usuarios de alto valor — administradores, finanzas, ejecutivos.

**Windows Hello for Business** — biometría o PIN atado a una credencial respaldada por TPM en un dispositivo Windows gestionado. UX excelente si el usuario está en un endpoint Windows gestionado. No se extiende a móvil ni a no-Windows.

Si el cliente está en Business Premium o superior, los tres son configurables. La migración es gradual pero el trabajo se acumula: cada usuario que cambia se vuelve inmune a AiTM, fatiga de MFA y credential stuffing simultáneamente.

## Qué más ayuda (las mitigaciones secundarias)

El MFA resistente al phishing es la defensa central. El resto de los controles en esta lista son *reducción de riesgo* — reducen el radio de explosión de un compromiso AiTM, o suben la probabilidad de detección.

**Acceso Condicional: exigir dispositivo conforme.** Si la cookie de sesión capturada se reproduce desde un dispositivo que no está inscrito en Intune y marcado como conforme, Microsoft la rechaza. El atacante robó la cookie pero no puede usarla. Este control es aplicable desde Business Premium en adelante. Es una de las defensas prácticas más fuertes para tenants que no pueden llegar a passkeys de la noche a la mañana.

**Acceso Condicional: exigir Microsoft Entra hybrid join.** Variante del anterior para tenants con AD híbrido. Misma idea — token solo usable desde un dispositivo conocido.

**Token Protection** (evolución de preview a GA en 2024-2026). Una característica de Microsoft que vincula criptográficamente el token emitido al dispositivo que lo solicitó. Sin el secreto del dispositivo, el token vinculado es inútil para un atacante que robó la cookie. Actualmente soporta Exchange Online, SharePoint Online y Teams; aún no es universal. Disponible en Entra ID P1 (Business Premium en adelante) vía los controles de sesión de Acceso Condicional. Vale la pena activarlo donde se soporte.

**Continuous Access Evaluation (CAE).** Revocación en tiempo real de tokens cuando las condiciones del usuario cambian. Si el usuario es detectado como comprometido, o si cambia su pertenencia a un grupo, o si cambia su ubicación a media sesión, los tokens se revocan en minutos en lugar de en la expiración. Disponible en la mayoría de SKUs de M365. Actívalo.

**Microsoft Defender SmartScreen + filtrado de contenido web.** SmartScreen marca dominios de phishing conocidos en tiempo real. El filtrado de contenido web de Defender for Endpoint puede bloquear dominios recién registrados por completo (la mayoría de los dominios AiTM son de días u horas). Ninguno es una defensa completa — los dominios del primer día aún no están marcados — pero juntos reducen significativamente la tasa de éxito.

**Defender for Office 365 Safe Links.** Reescritura de URL y verificaciones en el momento del clic. Cuando el usuario hace clic en un enlace en su correo, Defender for Office 365 vuelve a comprobar la URL contra la inteligencia de amenazas actual antes de redirigir. Pilla enlaces que pasaron de desconocidos a maliciosos entre el momento del envío del correo y el momento del clic.

## Qué hace Defender XDR sobre esto (Attack Disruption)

Lo único más útil que Microsoft ha construido para AiTM en los últimos tres años es **Attack Disruption** — la capacidad de acción automática cubierta en la tarjeta 1, lección 4. Se aplica específicamente a AiTM (y a BEC, HumOR, y password spray).

Cuando Defender XDR correlaciona un incidente AiTM de alta confianza — típicamente detectado vía la combinación de una alerta de Defender for Office 365 (el usuario hizo clic en un sitio de phishing AiTM), una anomalía de Defender for Cloud Apps (token de sesión robado siendo usado), y una señal de riesgo de Entra ID Protection — no espera a un operador. Deshabilita la cuenta del usuario en Entra ID, revoca todas las sesiones activas incluyendo la cookie robada, y (si el dispositivo del atacante puede identificarse) lo contiene.

Esta es la defensa moderna «después del hecho». El ataque ocurrió; el token fue robado; el atacante tuvo acceso brevemente. Attack Disruption cortó el acceso antes de que el daño se propagara. El operador ve el incidente cerrado por la mañana con una nota «cuenta comprometida deshabilitada automáticamente».

Dos notas prácticas:

**Verificar antes de rehabilitar.** Cuando Attack Disruption se dispara, el operador recibirá una llamada de soporte del cliente («¡estoy bloqueado!»). Resiste el impulso de rehabilitar al usuario de inmediato. Primero verifica que el AiTM era real (mira la IP origen, la anomalía geográfica, el momento), restablece la contraseña del usuario, mata cualquier nuevo método de autenticación que el atacante pueda haber registrado, *entonces* rehabilita. Disrumpir y rehabilitar sin forense derrota la protección.

**Attack Disruption requiere la combinación correcta de productos.** Defender for Endpoint en modo activo, Defender for Cloud Apps conectado, Defender for Identity para señales locales si tienes uno, Defender for Office 365 P1 como mínimo. La mayoría de los tenants modernos de Business Premium tienen los requisitos; algunos no. Comprueba antes de asumir que Attack Disruption está activado.

## Qué ve Panoptica365

Varias categorías de alertas en Panoptica365 son disparadas por AiTM:

**Inicio de sesión exitoso desde IP extranjera.** Cuando un usuario que normalmente inicia sesión desde un país de repente tiene un inicio de sesión exitoso desde otro, la alerta se dispara. La mayoría de los atacantes de AiTM hacen proxy de su reproducción a través de la misma infraestructura usada para alojar el kit de phishing, que rara vez está en la geografía normal del usuario.

**Inicio de sesión de viaje imposible.** Dos inicios de sesión exitosos del mismo usuario separados por imposibilidad física (Toronto, luego Bucarest, separados por 90 minutos). Señal clásica post-AiTM — el usuario está en Toronto, el atacante reprodujo su cookie desde Bucarest.

**Nuevo método de autenticación registrado.** A los atacantes les gusta añadir su propio método MFA después de un AiTM exitoso para no tener que repetir toda la danza. Esto aparece en el registro de auditoría de Entra y Panoptica365 lo saca a la superficie como alerta.

**Regla sospechosa de reenvío de buzón creada.** El usuario no estaría creando una regla que reenvíe todo correo con `factura OR pago OR transferencia` a una dirección de Gmail. Eso es un atacante. Las alertas sobre reglas de reenvío y reglas de buzón aparecen con frecuencia en la actividad de seguimiento de AiTM.

**Incidentes AiTM de Defender XDR** ingeridos directamente. Cuando Microsoft ha puntuado un incidente como AiTM y o bien lo ha disrumpido o ha alertado, eso llega a Panoptica365 como una alerta de alta gravedad con la gravedad y el análisis originales de Microsoft preservados.

El enfoque de triaje: cuando veas *cualquiera* de estas alertas sobre un usuario, asume AiTM hasta que puedas probar lo contrario. Saca el registro de inicio de sesión de Entra del usuario, busca el inicio de sesión que precedió inmediatamente a la actividad sospechosa, comprueba la IP origen y el user-agent. Un inicio de sesión exitoso desde una IP residencial en un país donde el usuario nunca ha estado, con un user-agent de navegador por defecto, el mismo día que una alerta de IP extranjera — ese es el patrón. Trátalo como un compromiso.

## Lo que esto significa para el operador

Cuatro puntos para llevarte para el trabajo diario.

**AiTM es la amenaza más importante para la que diseñar defensas en 2026.** Es el ataque que derrota al MFA que la mayoría de los clientes creen que les está protegiendo. Cada conversación que tengas sobre endurecimiento de identidad debería llegar a passkeys / FIDO2 / Hybrid join / AC de dispositivo conforme antes de llegar a cualquier otra cosa.

**El MFA basado en push ya no es adecuado para usuarios de alto valor.** Administradores, finanzas, ejecutivos, cualquiera con acceso a datos sensibles — estos usuarios deberían estar en métodos resistentes al phishing. Usa las políticas de fortaleza de autenticación de Acceso Condicional para *exigir* MFA resistente al phishing para apps sensibles incluso cuando el método por defecto del usuario siga siendo push.

**Token Protection y CAE no son opcionales.** Actívalos para cada tenant de Business Premium en adelante. No previenen AiTM en el momento de la autenticación, pero encogen la ventana durante la cual un token robado es útil.

**Confiar en Attack Disruption, luego verificar.** Cuando Defender XDR dispara Attack Disruption sobre un usuario, el flujo de trabajo correcto del operador es: confirmar que la acción se ve correcta, recolectar evidencia forense, arreglar el compromiso subyacente (nuevos métodos de autenticación, reglas de buzón, etc.), entonces rehabilitar. No al revés.

## Lo que viene

- **Lección 4: Phishing por consentimiento OAuth.** El ataque que sobrevive a un restablecimiento de contraseña. AiTM es ruidoso; el phishing por consentimiento es silencioso, y dura.
- **Lección 5: Abuso del código de dispositivo.** El flujo de código de dispositivo de Microsoft mal usado. Más cercano a AiTM en mecanismo, pero con una carga útil distinta.
- **Lección 6: BEC.** El final económico. Lo que el atacante hace de verdad con la sesión adquirida por AiTM.

Por ahora: AiTM es el ataque que enseñó a la industria que el MFA-solo no es suficiente. Las defensas existen. El trabajo es operativo — migrar a métodos resistentes al phishing, activar Token Protection y CAE, configurar Attack Disruption, entrenar a los usuarios de los clientes para que nunca confíen en la barra de URL. Es manejable. Simplemente aún no está hecho.

---

*Fuentes de los datos en esta lección — Microsoft Defender Threat Intelligence sobre el aumento de ataques AiTM ([Microsoft Security Blog — Defeating adversary-in-the-middle](https://www.microsoft.com/en-us/security/blog/2022/07/12/from-cookie-theft-to-bec-attackers-use-aitm-phishing-sites-as-entry-point-to-further-financial-fraud/)); panorama de técnicas AiTM 2026 ([Jeffrey Appel — AiTM/MFA phishing 2026 edition](https://jeffreyappel.nl/)); mecánicas de Token Protection ([Microsoft Learn — Token protection in Conditional Access](https://learn.microsoft.com/en-us/entra/identity/conditional-access/concept-token-protection)); Continuous Access Evaluation ([Microsoft Learn — Continuous access evaluation](https://learn.microsoft.com/en-us/entra/identity/conditional-access/concept-continuous-access-evaluation)); configuración de Attack Disruption ([Microsoft Learn — Configure automatic attack disruption](https://learn.microsoft.com/en-us/defender-xdr/configure-attack-disruption)); vinculación al origen de FIDO2 / passkey ([Microsoft Learn — Passwordless authentication](https://learn.microsoft.com/en-us/entra/identity/authentication/concept-authentication-passwordless)).*
