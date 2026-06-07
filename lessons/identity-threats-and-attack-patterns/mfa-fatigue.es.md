---
title: "Fatiga de MFA — la historia de Uber"
subtitle: "Cómo los atacantes bombardean a usuarios con notificaciones push hasta que aprueban una — y por qué el MFA por push es ingenierizable socialmente."
icon: "bell-ring"
last_updated: 2026-05-29
---

# Fatiga de MFA — la historia de Uber

El 15 de septiembre de 2022, un contratista de 18 años en Uber tocó «Aprobar» sobre una notificación push de Microsoft Authenticator en su casa, tarde por la noche, después de que su teléfono llevara vibrando aproximadamente una hora. No estaba iniciando sesión en nada. El atacante al otro lado del prompt le envió entonces un mensaje de WhatsApp diciendo que era de Uber IT, contándole que las notificaciones push pararían si simplemente aprobaba una.

Aprobó.

Por la mañana, el atacante — identificado más tarde como parte del grupo Lapsus$ — había pivotado desde aquel único push aprobado hacia acceso de lectura al Slack interno de Uber, la consola de AWS, el admin de Google Workspace, la plataforma de bug bounty HackerOne, y el código fuente de la empresa. La intrusión se hizo pública cuando el atacante empezó a publicar capturas en los propios canales de Slack de ingeniería de Uber anunciando que estaba allí.

Eso es fatiga de MFA. El incidente de Uber es el caso de estudio canónico, y el patrón de ataque está vivo y coleando en 2026.

Esta lección trata sobre por qué el MFA basado en push es socialmente ingenierable, qué hacen (y qué no) el number matching y el contexto adicional, y cómo empujar a los clientes hacia métodos de autenticación que no se pueden fatigar.

## Qué está pasando en realidad

La fatiga de MFA (también llamada «bombardeo MFA» o «push bombing») requiere que el atacante ya tenga la contraseña del usuario. A menudo viene de un vertido de credenciales (lección 1). El prompt de MFA es la única cosa entre el atacante y la cuenta.

La mecánica del ataque es vergonzosamente simple:

1. El atacante tiene nombre de usuario + contraseña. Los introduce en `login.microsoftonline.com`.
2. Entra ID pide MFA — envía una notificación push al teléfono del usuario vía Microsoft Authenticator.
3. El usuario ve el prompt, sabe que no intentó iniciar sesión, lo descarta.
4. El atacante introduce la contraseña otra vez. Otro push.
5. El atacante repite. Cinco pushes. Diez. Veinte. El usuario está dormido a las 2 de la madrugada, o en una reunión, o simplemente exhausto.
6. Eventualmente, el usuario o bien hace clic en «Aprobar» en lugar de «Denegar» por error, o se rinde y aprueba para que las vibraciones paren, o el atacante añade una capa de ingeniería social («Hola, soy de IT, el sistema está fallando, simplemente aprueba para que podamos terminar la prueba»).
7. El atacante está dentro.

Todo el ataque *no tiene sofisticación técnica*. Funciona porque los seres humanos se cansan y se irritan, y porque el binario descartar-o-aprobar no comunica ningún contexto.

## Por qué esto funciona específicamente contra notificaciones push

Existen tres sabores de MFA en M365, y el ataque de fatiga funciona en exactamente uno de ellos.

**MFA por SMS / llamada telefónica.** No vulnerable a la fatiga de la misma forma — el atacante puede marcar al usuario una vez por intento, pero llamadas repetidas rápidas disparan la detección de abuso a nivel del operador y no son gratuitas. SMS tiene *otros* problemas (intercambio de SIM, interceptación) que lo convierten en el método de MFA más débil en general, pero la fatiga no es uno de ellos.

**MFA por notificación push (el valor por defecto del Authenticator).** Vulnerable. Empujar una notificación es gratis para Microsoft, así que un atacante puede disparar docenas por minuto. El usuario ve `Aprobar / Denegar` con quizás un nombre de usuario y un nombre de aplicación. Se le está pidiendo tomar una decisión sí/no basada en casi cero contexto.

**Number matching + contexto adicional.** Notificaciones push, pero el usuario tiene que escribir un número de dos dígitos mostrado en la pantalla de inicio de sesión en la aplicación Authenticator, y el prompt ahora muestra el nombre de la aplicación solicitante más la ubicación geográfica del intento de inicio de sesión. *Esto es ahora el valor por defecto de Microsoft* para Authenticator y lo es desde 2023.

**MFA resistente al phishing (llaves FIDO2, passkeys, Windows Hello for Business, basado en certificado).** No vulnerable a la fatiga en absoluto. El usuario tiene que tocar físicamente la llave, presentar su cara, o insertar una tarjeta inteligente. No hay «toca para aprobar» — la operación criptográfica requiere presencia. Vamos a pasar la lección 3 de esta tarjeta mostrando por qué el MFA resistente al phishing importa también para AiTM.

## ¿Cuánto resuelve esto el number matching en realidad?

El number matching hace el ataque más difícil, no imposible. Tres cosas cambian:

**El usuario tiene que leer activamente un número de la pantalla de inicio de sesión y escribirlo en su aplicación Authenticator.** Hacer clic en «Aprobar» por error ya no funciona — no hay un botón de Aprobar que pulsar mal. El usuario tiene que hacer algo *intencional*. Esto mata el modo de fallo «me di la vuelta en la cama y toqué Sí».

**El contexto adicional muestra el nombre de la aplicación y la ubicación geográfica.** «Inicio de sesión desde Microsoft Outlook en Bucarest, Rumanía» debería disparar alarmas incluso para un usuario cansado en Montreal. (Si efectivamente las dispara depende de lo atento que esté el usuario a las 2:14 de la madrugada, pero al menos la información está ahí.)

**El atacante ahora necesita una capa de ingeniería social.** Sin number matching, el ataque es puramente mecánico — empujar, repetir, esperar. Con number matching, el atacante tiene que *hablar* con el usuario para que escriba el número. Eso normalmente significa un mensaje de WhatsApp, un mensaje de Teams, o una llamada telefónica diciendo que es de IT.

Así que el number matching convierte la fatiga de MFA de un ataque puro de molestia en uno que requiere ingeniería social. Esa es una mejora real. También es la razón por la que cada campaña en 2025 y 2026 que pega a un tenant con number matching viene empaquetada con un pretexto de ingeniería social — exactamente lo que le pasó a Uber.

Lo que el number matching *no* hace: hacer al usuario inmune a un argumento de ingeniería social convincente. Si el atacante puede falsificar una llamada de ayuda de IT lo bastante bien como para que el usuario escriba activamente el código de dos dígitos, el ataque todavía funciona. El number matching sube el listón; no elimina la clase.

## Cómo se ve esto en la telemetría de M365

Cuando la fatiga de MFA está en curso, Microsoft ve:

- **Una ráfaga de intentos de inicio de sesión fallidos en una cuenta**, todos con contraseña correcta (porque el atacante tiene la contraseña) pero sin completar MFA. Estos aparecen en el registro de inicios de sesión de Entra con el resultado «Desafío de MFA requerido, no completado».
- **Un inicio de sesión exitoso inmediatamente después de la ráfaga**, cuando el usuario finalmente aprueba.
- **A menudo, actividad de seguimiento desde un dispositivo nuevo** — el atacante está ahora iniciando sesión desde su propia máquina usando la sesión aprobada por MFA.

Entra ID Protection (solo P2, E5) puede puntuar este patrón como sospechoso y disparar controles de AC basados en riesgo. En Business Premium (P1), el patrón ráfaga-de-MFA-fallido no genera automáticamente una alerta de Microsoft de alta confianza, pero el inicio de sesión *exitoso* desde un país nuevo o un dispositivo nuevo debería seguir disparando los detectores de IP extranjera y viaje imposible de Panoptica365.

Defender XDR también puede plegar estas señales en un incidente si el usuario va a hacer algo ruidoso después — registrar un nuevo dispositivo MFA, crear una regla de buzón, enviarse correo a sí mismo a una dirección de Gmail. Ese es el patrón BEC de la lección 6.

## Qué ve Panoptica365

Tres señales de la fatiga de MFA:

**La ráfaga de intentos de inicio de sesión fallidos en casi-tiempo-real** vía el widget de Actividad Diaria en el panel del tenant. El gráfico de dónut se refresca aproximadamente cada 15 minutos y muestra el desglose de resultados de inicio de sesión — autenticaciones exitosas, autenticaciones fallidas, y bloqueos de Acceso Condicional. Durante un ataque de fatiga de MFA, la rebanada de autenticaciones-fallidas del dónut se hincha visiblemente. Vigila los picos súbitos concentrados en *un usuario o un grupo pequeño* — ese es el patrón de fatiga de MFA. Distribuido-entre-muchos-usuarios es credential stuffing (lección 1); concentrado-en-un-usuario es fatiga de MFA o un ataque dirigido de credenciales.

**El propio inicio de sesión exitoso.** Cuando el usuario eventualmente aprueba y el atacante entra — típicamente desde una IP extranjera o en proximidad de viaje imposible con el usuario legítimo — la alerta se dispara en tu cola.

**La actividad de seguimiento.** Creación de reglas de buzón, reenvío de buzón, otorgamientos de permisos de buzón, a veces nuevas asignaciones de rol de administrador — estas acciones post-compromiso son típicamente más ruidosas que el propio evento de inicio de sesión. La lección 6 sobre BEC las cubre en detalle.

Distinguir la fatiga de MFA del credential stuffing y de AiTM importa para el informe de incidentes del cliente. En la fatiga de MFA, el registro de inicios de sesión de Entra mostrará una ráfaga de desafíos de MFA que no se completaron, seguidos de uno que sí — y el dónut de Actividad Diaria de Panoptica365 ya habrá mostrado el pico de autenticaciones-fallidas en casi-tiempo-real. En credential stuffing la contraseña funcionó sin que se requiriera MFA en absoluto (porque el usuario no tenía MFA inscrito). En AiTM (lección 3) el MFA *fue* completado por el usuario, simplemente sobre un sitio falso. La remediación es similar en los tres; las lecciones aprendidas son diferentes.

## Defenderse contra la fatiga de MFA

Defensas, ordenadas por impacto:

**Migrar usuarios a MFA resistente al phishing.** Passkeys, llaves de seguridad FIDO2, Windows Hello for Business. Ninguno de estos puede ser fatigado — requieren una interacción física que el atacante no puede replicar. La migración es gradual (los usuarios necesitan inscribir passkeys), pero cada usuario que cambia se elimina de la superficie de ataque por completo. Esta también es la respuesta correcta para el problema de AiTM de la lección 3, así que el trabajo se compone.

**Asegurarse de que el number matching está activado** para cualquier tenant que aún use push de Authenticator. Ha sido el valor por defecto de Microsoft desde 2023, pero tenants más antiguos o tenants con políticas personalizadas pueden tenerlo desactivado. Comprobar a través de la política de métodos de autenticación de Entra ID. El motor de ajustes de seguridad de Panoptica365 lo monitoriza.

**Entrenar a los usuarios de los clientes para que *nunca* aprueben un prompt que ellos no iniciaron.** Esto suena obvio. No lo es. La versión más eficaz de este entrenamiento es una hoja de una página que incluya la línea «Microsoft nunca te llamará para pedirte que apruebes un prompt de inicio de sesión». Pónla en la incorporación de usuarios nuevos. Refrescala trimestralmente.

**Configurar alertas para eventos inusuales de registro de MFA.** Cuando un atacante fatiga con éxito a un usuario, lo siguiente que hace a menudo es *registrar su propio dispositivo MFA* — para no necesitar fatigar al usuario otra vez después. El registro de auditoría de Entra captura esto como un evento «Método de autenticación registrado». Es una de las señales de mayor valor para pillar un compromiso *mientras el atacante todavía solo tiene un punto de apoyo*.

**En clientes regulados, mandar MFA resistente al phishing vía políticas de fortaleza de autenticación de Acceso Condicional.** «Exigir MFA resistente al phishing para acceso a sistemas financieros» es una política de AC disponible en Entra ID P1 (Business Premium en adelante). Así se protege a los usuarios de alto valor sin forzar a todo el tenant a pasar a passkeys de la noche a la mañana.

## Lo que esto significa para el operador

Tres puntos para llevarte.

**Un inicio de sesión exitoso que sigue a una ráfaga de intentos de MFA fallidos es un compromiso.** Trátalo como tal. Deshabilita las sesiones actuales del usuario, fuerza un restablecimiento de contraseña, exige una nueva inscripción de MFA, audita la actividad reciente del buzón. No esperes a que se desarrolle el patrón BEC antes de responder.

**La aplicación Authenticator es buena. Las notificaciones push vía la aplicación Authenticator son más débiles que las passkeys.** Esta es una distinción real y significativa, y deberías sentirte cómodo haciéndola en conversaciones con clientes. El cliente que insiste en que «ya tiene MFA, todos usan la app» está sobreestimando la protección. El number matching ayuda; los métodos resistentes al phishing resuelven.

**Las cuentas de servicio casi nunca necesitan mitigación de fatiga de MFA, porque las cuentas de servicio casi nunca tienen MFA en absoluto.** Este es su propio problema (cubierto en la lección 1, de pasada). Las cuentas de servicio comprometidas vía credential stuffing no se fatigan; simplemente se usan. Pero la lección relacionada es la misma: en cualquier sitio donde haya una cuenta sin autenticación resistente al phishing, la fatiga de MFA (o peor) está sobre la mesa.

## Lo que viene

- **Lección 3: Phishing AiTM.** El bypass técnico de MFA. Donde la fatiga engaña al usuario para que apruebe un prompt real, AiTM engaña al usuario para que apruebe un prompt en un *sitio falso que hace de proxy del inicio de sesión real de Microsoft*. El atacante captura la cookie de sesión en lugar de pelear con el MFA en absoluto.
- **Lección 6: BEC.** El final de cada compromiso exitoso de las lecciones 1, 2 y 3 — lo que el atacante realmente hace una vez que está dentro.

Por ahora: la fatiga de MFA es el bypass de ingeniería social de MFA. Funciona porque las notificaciones push están diseñadas para tocarse rápido. El number matching la hace más difícil pero no imposible. La respuesta real son los métodos resistentes al phishing, y el trabajo para migrar a los clientes hacia ellos empieza el día que te tomas en serio esta lección.

---

*Fuentes de los datos en esta lección — resumen del incidente de Uber de septiembre de 2022 ([Uber Newsroom — Security update](https://www.uber.com/newsroom/security-update/)); atribución a Lapsus$ y análisis del modus operandi ([Microsoft Security Blog — DEV-0537 / Lapsus$](https://www.microsoft.com/en-us/security/blog/2022/03/22/dev-0537-criminal-actor-targeting-organizations-for-data-exfiltration-and-destruction/)); despliegue del number matching por defecto en Microsoft Authenticator ([Microsoft Learn — Number matching for Microsoft Authenticator](https://learn.microsoft.com/en-us/entra/identity/authentication/how-to-mfa-number-match)); políticas de fortaleza de autenticación de Entra ID ([Microsoft Learn — Conditional Access authentication strengths](https://learn.microsoft.com/en-us/entra/identity/authentication/concept-authentication-strengths)).*
