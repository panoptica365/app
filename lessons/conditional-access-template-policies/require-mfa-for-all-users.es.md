---
title: "Exigir MFA para todos los usuarios — el fundamento"
subtitle: "La política de AC que bloquea el 99,9 % de los compromisos automatizados — la primera en todo tenant."
icon: "shield-check"
last_updated: 2026-05-29
---

# Exigir MFA para todos los usuarios — el fundamento

El equipo de Microsoft Identity Security lleva seis años diciendo lo mismo: habilitar MFA bloquea más del 99,9 % de los intentos automatizados de compromiso de cuenta. El número ha sido citado en cada formación de Acceso Condicional que Microsoft ha publicado y en cada formulario de suscripción de seguros cibernéticos desde 2022.

La otra cara de esa estadística es la parte que nadie cita: en tenants donde MFA *no* está aplicado universalmente, ese mismo 99,9 % solo describe lo que les está pasando a todos los demás tenants. El usuario desprotegido en el tenant desprotegido es exactamente lo que las botnets de credential stuffing están buscando.

Esta es la plantilla que cierra esa brecha.

**Panoptica365 - Require MFA for all users.** Concesión: Exigir MFA. Usuarios: Todos los usuarios. Aplicaciones: Todas las aplicaciones en la nube.

Es la política de AC más simple de la biblioteca, la más importante, y la que debería estar habilitada en cada tenant de Business Premium o superior antes de que empiece cualquier otro trabajo de AC.

## Qué hace

La mecánica no tiene complicación. Cada vez que cualquier usuario inicia sesión en cualquier aplicación en la nube, Microsoft evalúa la política. Si el usuario ya ha satisfecho MFA en su sesión actual, el inicio de sesión procede. Si no, Microsoft pide MFA antes de dejar que el inicio de sesión continúe.

El control único es `Exigir autenticación multifactor`. No hay condiciones más allá de «todos los usuarios, todas las aplicaciones». Es la línea base — cada inicio de sesión completa MFA antes de que pase cualquier otra cosa.

Lo que la política *no* le importa:

- La ubicación del usuario. Esté en la oficina, en casa, o en una cafetería de Lisboa, MFA es obligatorio.
- El dispositivo. Portátiles personales, dispositivos gestionados, teléfonos móviles — MFA en todos.
- La aplicación. Outlook, SharePoint, Teams, Power BI, el centro de administración — todas.
- La hora del día o el rol del usuario. Todos, siempre, cada inicio de sesión.

Esa uniformidad es la fuerza y la debilidad de la política. La fuerza: ningún caso límite queda sin cubrir, no existe ninguna brecha «pero mi cuenta de servicio no tiene MFA». La debilidad: cada inicio de sesión, incluso desde un dispositivo gestionado perfectamente fiable, pasa por el camino MFA. Ese es el compromiso que la lección 5 revisitará.

## Qué derrota

Aproximadamente la mitad inferior del catálogo de amenazas de la tarjeta 2.

**Credential stuffing** (tarjeta 2 lección 1) — la contraseña es correcta porque el atacante la compró en un vertido de fuga, pero no tiene el método MFA, así que el inicio de sesión falla. Este es exactamente el ataque contra el que se midió la estadística del 99,9 %.

**Password spray** — misma defensa. El atacante probó «Primavera2024!» contra 50 000 cuentas; las pocas cuentas donde la contraseña coincide todavía necesitan el MFA que el atacante no tiene.

**Credenciales robadas de fugas no relacionadas** — misma defensa. El usuario reutilizó su contraseña de LinkedIn en M365; el atacante la tiene; el prompt MFA lo detiene.

Lo que no derrota:

- **Fatiga de MFA** (tarjeta 2 lección 2) — el usuario es quien aprueba el prompt; MFA no ayuda cuando el usuario es el eslabón débil.
- **Phishing AiTM** (tarjeta 2 lección 3) — el atacante proxiea el prompt MFA; el usuario completa MFA en el sitio falso.
- **Phishing por consentimiento OAuth** (lección 4) — no hay contraseña ni MFA involucrado; el ataque corre por el diálogo de consentimiento.
- **Abuso del código de dispositivo** (lección 5) — el usuario completa MFA correctamente en la página real de Microsoft; el atacante obtiene el token de todos modos.

En otras palabras: Exigir MFA para todos los usuarios derrota los ataques *basados en credenciales*. No derrota los ataques *basados en tokens* o *basados en consentimiento*. Esos necesitan capas adicionales — requisitos de dispositivo conforme (lecciones 4 y 5), MFA resistente al phishing para usuarios de alto valor (lección 6), y el bloqueo del flujo de código de dispositivo (lección 7).

Pero antes de que cualquiera de esas capas importe, el fundamento tiene que estar en su sitio. Un tenant sin MFA universal está expuesto al ataque más simple, más barato, más automatizado posible. No hay razón defendible para dejar esa brecha abierta en 2026.

## A quién se aplica

La plantilla viene con **Usuarios: Todos los usuarios**. La intención es cobertura universal.

En la práctica, la política casi siempre tiene un puñado de exclusiones:

- **Las cuentas break-glass** — del pre-despliegue de la lección 1. Excluidas por defecto. Su MFA se aplica por otros medios (la llave FIDO2 almacenada físicamente), no a través de AC.
- **Cuentas de servicio documentadas** que aún no han sido migradas a identidades gestionadas — excluidas temporalmente con una fecha de expiración documentada. Cada exclusión de cuenta de servicio es una brecha de seguridad conocida y debería estar en un plan de retiro.
- **Cuentas de invitado específicas en configuraciones inusuales** — raro. La mayoría de los invitados B2B deberían tener MFA. Si una cuenta de invitado está excluida, documenta por qué.

Lo que *no* debería estar en la lista de exclusión:

- Ejecutivos. («Es más fácil así» no es un argumento de seguridad.)
- Trabajadores de campo. (Su MFA está en su teléfono; ya está en su bolsillo.)
- «Equipo de servicio al cliente» u otros grupos genéricos. (Si usan aplicaciones en la nube, necesitan MFA.)

Si un cliente se resiste al MFA universal — «nuestro equipo de ventas lo encuentra demasiado molesto» — la respuesta correcta es inscribirlos en la app Authenticator con number matching, o mejor, en passkeys. El prompt MFA a las 8 AM del lunes por la mañana no es la fricción; la alternativa es la fricción de explicar un compromiso por credential stuffing a la lista entera de clientes de ese usuario.

## Despliegue

Conforme a la lista de comprobación previa al despliegue de la lección 1: esta plantilla se despliega en estado Habilitado. Para la mayoría de los tenants de pequeña empresa, el inventario pre-despliegue (break-glass excluido, cuentas de servicio catalogadas, comunicación enviada al usuario) es tu ensayo; despliega y monitoriza de cerca. Para entornos complejos con principales de servicio heredados, despliega vía Panoptica365 y luego cambia manualmente la política a solo informe en el portal de Entra durante una ventana de verificación de 3 a 7 días antes de dejar que se aplique — la sección 3 de la lección 1 cubre el flujo de solo informe en detalle.

Antes del despliegue, asegúrate de que cada usuario tiene al menos un método MFA registrado. La página de registro combinado de Microsoft (`mysignins.microsoft.com/security-info`) es el camino de cara al usuario. Envía el enlace con instrucciones unos días antes del despliegue para que los usuarios no se sorprendan con un prompt MFA un lunes por la mañana.

En la primera semana después de la aplicación, el widget de Actividad Diaria de Panoptica365 mostrará un pico de desafíos MFA exitosos. Esa es la política funcionando — cada inicio de sesión ahora completa el segundo factor. Las alertas de MFA-deshabilitado que se disparaban antes del despliegue deberían estar en silencio para los usuarios que completaron la inscripción. Los usuarios que todavía disparan alertas de MFA-deshabilitado una semana después de la aplicación son inscripciones incompletas (persíguelas) o exclusiones genuinas (verifica y documenta).

Gestiona la cola larga de cuentas de servicio e integraciones de terceros a medida que las alertas afloran en la primera semana. Documenta cada exclusión con una justificación y una fecha de retiro en el sistema de exenciones de Panoptica365.

## Qué monitorizar después de la aplicación

Tres cosas que vigilar:

**Fallos de desafío MFA.** Una ráfaga súbita de desafíos MFA fallidos sobre un usuario es el patrón de fatiga de MFA de la lección 2 de la tarjeta 2. El dónut de Actividad Diaria lo saca a la superficie en casi-tiempo-real. El enfoque de triaje es el mismo: IP extranjera + ráfagas de MFA fallidos + éxito eventual = trátalo como compromiso.

**Inicios de sesión que completan MFA vía SMS o voz.** Estos métodos son más débiles que el push, mucho más débiles que las passkeys. El informe de Métodos de Autenticación en el portal de Entra muestra el desglose. Los clientes con demasiada dependencia de SMS son candidatos para la actualización de endurecimiento admin de la lección 6 (MFA resistente al phishing para usuarios de alto valor).

**Deriva sobre la propia política.** El detector de deriva de AC de Panoptica365 marca si la política se deshabilita, la lista de usuarios se estrecha, o la lista de exclusión crece. Una lista de exclusión que crece sin tu conocimiento es alguien más desactivando MFA para un usuario — investiga.

## El solapamiento con la lección 5

Notarás cuando leas la lección 5 que la plantilla **Require compliant or hybrid Azure AD joined device or MFA for all users** ofrece un camino alternativo: los dispositivos gestionados se saltan MFA, los dispositivos no gestionados obtienen MFA. Ambas plantillas existen en la biblioteca; no están pensadas para activarse juntas como estrategia coherente.

Si activas ambas: gana la combinación más estricta. La política de la lección 2 exige MFA incondicionalmente, la política de la lección 5 dice «MFA es una de tres pruebas aceptables». Cuando ambas se aplican, MFA es exigido porque la lección 2 no acepta los caminos de confianza de dispositivo. La lección 5 se vuelve redundante.

La forma correcta de pensarlo:

- **Habilita Exigir MFA para todos los usuarios (esta lección)** como política por defecto cuando el tenant aún no tiene un cumplimiento de Intune fiable, cuando estás temprano en el despliegue, o cuando quieres semántica simple de «siempre MFA».
- **Habilita Exigir conforme O híbrido O MFA (lección 5)** como mejora cuando el cumplimiento de Intune está en su sitio y es fiable, el cliente quiere mejor UX para usuarios en dispositivos gestionados, y confías en la señal de cumplimiento.

La lección 5 tiene el tratamiento completo de la elección de estrategia. Por ahora: elige una. No corras las dos esperando que los caminos OR se apliquen — no se aplicarán.

## Lo que esto significa para el operador

Tres puntos para llevarte.

**Esta es la política que despliegas primero.** Antes de cualquier otro trabajo de AC, antes de cualquier plantilla de Intune, antes de cualquier control más sofisticado en lecciones posteriores. Un tenant sin MFA universal está expuesto al ataque más simple posible; cerrar esa brecha es lo de mayor palanca que puedes hacer para un cliente nuevo.

**La estadística del 99,9 % gana su sueldo aquí.** Cuando un cliente se resiste a la fricción del MFA universal, esa estadística es la respuesta correcta. No es un eslogan; es un resultado medido de la propia telemetría de Microsoft. Cítala. Úsala.

**Documenta cada exclusión.** Cada cuenta de servicio, cada caso especial, cada entrada de «este usuario no puede tener MFA porque…» en la lista de exclusión es un agujero en el perímetro. Trata cada una como un problema conocido con una fecha de retiro. El sistema de exenciones de Panoptica365 hace esto concreto — úsalo.

## Lo que viene

- **Lección 3: Bloquear autenticación heredada.** La política compañera de esta. Sin el bloqueo de auth heredada, el atacante que tiene la contraseña del usuario puede simplemente usar un protocolo heredado que no soporte MFA y saltarse toda esta política. Las lecciones 2 y 3 son un despliegue emparejado.
- **Lección 5: Dispositivo conforme O híbrido O MFA.** El camino de mejora para tenants con Intune en su sitio — mejor UX, mismo suelo de seguridad.

Por ahora: esta es la política sin la que no puedes entregar. Haz que se despliegue en cada tenant de cliente. Documenta exclusiones. Pasa a la lección 3.

---

*Fuentes de los datos en esta lección — Microsoft Identity Security Group sobre el bloqueo por MFA del 99,9 % de las compromisiones automatizadas de cuenta ([Weinert, agosto de 2019](https://techcommunity.microsoft.com/blog/microsoft-entra-blog/your-pa%24%24word-doesn%E2%80%99t-matter/731984)); Microsoft Learn sobre la estructura de políticas de Acceso Condicional ([Microsoft Learn — Conditional Access policies](https://learn.microsoft.com/en-us/entra/identity/conditional-access/concept-conditional-access-policies)); referencia de la página de registro combinado ([Microsoft Learn — Combined registration](https://learn.microsoft.com/en-us/entra/identity/authentication/concept-registration-mfa-sspr-combined)).*
