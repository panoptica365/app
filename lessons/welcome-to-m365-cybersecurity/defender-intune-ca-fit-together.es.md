---
title: "Defender, Intune, Acceso Condicional — cómo encajan de verdad"
subtitle: "El bucle de cumplimiento en cinco pasos: cómo Intune, Defender y el Acceso Condicional se pasan el relevo en Entra para tomar cada decisión de inicio de sesión."
icon: "puzzle"
last_updated: 2026-05-29
---

# Defender, Intune, Acceso Condicional — cómo encajan de verdad

Recibes un ticket a las 9:14 de la mañana. *«Karen no puede iniciar sesión en Outlook desde su portátil. Acaba de cambiar su contraseña la semana pasada. Ayuda, por favor.»*

Abres tres pestañas del navegador. La primera es el portal de administración de Entra — miras los registros de inicio de sesión de Karen. La segunda es el portal de Intune — miras el estado de cumplimiento de su dispositivo. La tercera es el portal de Defender XDR — buscas alertas sobre su cuenta.

Tres portales. Tres equipos diferentes valen la UI. Tres modelos mentales distintos. Y la respuesta a «por qué Karen no puede iniciar sesión» vive en algún lugar de los tres.

Esta lección es por qué existen esos tres portales, cuál es el trabajo real de cada uno, y cómo encontrar la respuesta al ticket de Karen sin mirar tu reloj cada tres minutos.

## El bucle de cumplimiento

Si solo te llevas un diagrama de todo este programa, debería ser este. Es el *bucle de cumplimiento*, y es el mecanismo central de la seguridad moderna en M365.

```
   ┌─────────────────────────────────────┐
   │ 1. Intune impone una política en el │
   │    dispositivo: cifrado activado,   │
   │    SO al día, AV en ejecución.      │
   └─────────────────┬───────────────────┘
                     │
                     ▼
   ┌─────────────────────────────────────┐
   │ 2. El dispositivo reporta su estado │
   │    a Intune (conforme / no conforme)│
   └─────────────────┬───────────────────┘
                     │
                     ▼
   ┌─────────────────────────────────────┐
   │ 3. Intune escribe un atributo       │
   │    «conforme» o «no conforme» sobre │
   │    el registro del dispositivo en   │
   │    Entra ID.                        │
   └─────────────────┬───────────────────┘
                     │
                     ▼
   ┌─────────────────────────────────────┐
   │ 4. El usuario inicia sesión. El     │
   │    Acceso Condicional lee el        │
   │    atributo de cumplimiento del     │
   │    dispositivo, más el riesgo de    │
   │    usuario / inicio de sesión       │
   │    desde Entra ID Protection.       │
   └─────────────────┬───────────────────┘
                     │
                     ▼
   ┌─────────────────────────────────────┐
   │ 5. El AC decide: permitir, bloquear,│
   │    permitir-con-MFA, o permitir con │
   │    controles de sesión.             │
   └─────────────────────────────────────┘
```

Cinco pasos. Tres productos. Un resultado — una decisión en la puerta.

Fíjate en lo que el diagrama también te está diciendo: **el Acceso Condicional no configura el dispositivo, e Intune no permite ni bloquea inicios de sesión**. Cada uno hace exactamente una cosa, y se pasan el relevo a través del atributo de cumplimiento sobre el registro del dispositivo en Entra. El registro del dispositivo en Entra es el puente.

Esta separación es por qué «no puedo iniciar sesión» puede ser un problema de AC, un problema de Intune *o* un problema de Defender — y al usuario todos le parecen lo mismo.

## El trabajo real de cada uno

Recorre el bucle.

### Intune — la autoridad del estado del dispositivo

El trabajo de Intune es *configurar dispositivos y verificar su estado*. No toma decisiones de inicio de sesión. No pilla malware. No bloquea phishing. No investiga incidentes.

Sí hace:

- **Configurar** el dispositivo: empuja BitLocker, empuja políticas de Defender, empuja ajustes del navegador, empuja instalaciones de aplicaciones, empuja el fondo de pantalla si te sientes cruel.
- **Aplicar políticas de cumplimiento**: pone el listón de lo que «sano» significa (versión de Windows ≥ X, BitLocker activado, firma de AV ≤ N días, sin jailbreak).
- **Reportar el estado de cumplimiento**: el dispositivo recorre sus políticas, las pasa o las falla, y lo reporta hacia arriba. Ese estado aterriza como `isCompliant: true/false` sobre el registro del dispositivo en Entra.
- **Disparar el despliegue de Defender for Endpoint**: en la mayoría de los entornos modernos, Intune es lo que instala y configura Defender en cada dispositivo.

Si una política de Acceso Condicional dice «requerir dispositivo conforme», Intune es la *fuente de la respuesta* para ese requisito. Si Intune se equivoca sobre el estado de un dispositivo, el AC se equivocará sobre el inicio de sesión.

**Dónde se configura:** `intune.microsoft.com` — el centro de administración de Microsoft Intune. (Nombre anterior: Microsoft Endpoint Manager. Aún más anterior: SCCM-en-Internet.)

### Defender — la capa de detección de amenazas y respuesta

El trabajo de Defender es *detectar comportamiento malicioso y responder a él*. No configura dispositivos (eso lo hace Intune). No toma decisiones de inicio de sesión (eso lo hace el AC). Lo que Defender hace es *vigilar* y, cuando la correlación es lo bastante fuerte, *reaccionar*.

«Defender» en realidad es una familia de productos:

- **Defender for Endpoint** — se ejecuta en el dispositivo. Monitorización de comportamiento, EDR, remediación automática. Esto es lo que pilla procesos tipo ransomware, cadenas de scripts sospechosas, robo de credenciales.
- **Defender for Office 365** — se ejecuta sobre el flujo de correo y SharePoint. Anti-phishing, Safe Links, Safe Attachments.
- **Defender for Cloud Apps** — se ejecuta sobre los SaaS registrados. Análisis del comportamiento del usuario, monitorización de consentimientos OAuth.
- **Defender for Identity** — se ejecuta contra AD local (y sincronización híbrida). Pilla patrones de robo de credenciales y movimiento lateral.
- **Defender XDR** — la capa de *correlación* que toma las señales de todo lo anterior y las convierte en incidentes. (Lección entera sobre esto justo después — lección 4.)

Defender normalmente no bloquea un inicio de sesión individual por sí mismo. Lo que *sí hace* es alimentar señales de riesgo en Entra ID Protection, que el Acceso Condicional puede leer en el momento de evaluación de la política («el riesgo de este usuario es alto → exigir cambio de contraseña»). La señal fluye en la misma dirección que el estado de cumplimiento de Intune — hacia Entra, donde el AC la lee. Mismo puente, señal distinta.

Defender XDR *sí puede* tomar acción directa a través de Attack Disruption — deshabilitar un usuario, revocar sus tokens, contener un dispositivo. Eso es una excepción a la regla «Defender vigila, AC decide», y es una excepción deliberada (solo correlación de alta confianza).

**Dónde se configura:** `security.microsoft.com` — el portal de Microsoft Defender. (Nombre anterior: Microsoft 365 Defender. Anterior: ATP. Aún más anterior: «lo renombramos el mes que viene».)

### Acceso Condicional — el punto de decisión de la política

El trabajo del AC es *evaluar cada inicio de sesión contra un conjunto de condiciones* y decidir qué hacer. Es el único producto de los tres que toma una decisión de sí / no en tiempo de ejecución.

Una política de AC tiene cuatro partes:

- **Quién** — a qué usuarios o grupos se aplica (incluir / excluir).
- **Qué** — qué aplicaciones o acciones (Exchange, SharePoint, «todas las aplicaciones en la nube», operaciones administrativas sensibles).
- **Condiciones** — el contexto: estado del dispositivo, ubicación, riesgo del inicio de sesión, riesgo del usuario, aplicación cliente, plataforma.
- **Controles** — qué hacer si la política coincide: bloquear, exigir MFA, exigir dispositivo conforme, exigir Hybrid join, aplicar controles de sesión (frecuencia de inicio de sesión, Token Protection).

Las decisiones que toma el AC son *la* frontera de seguridad de M365 en la práctica. Si tienes una buena política de AC en su sitio — «los usuarios pueden leer correo solo desde un dispositivo conforme, o después de MFA desde una ubicación de confianza» — la mayoría de las amenazas de la tarjeta 2 fallan directamente o disparan detección en algún otro punto de la pila.

Lo que el AC NO hace:

- No configura dispositivos. (Intune.)
- No pilla malware. (Defender for Endpoint.)
- No bloquea correos de phishing. (Defender for Office 365.)
- No investiga incidentes. (Defender XDR.)

**Dónde se configura:** `entra.microsoft.com` (o el más antiguo `portal.azure.com` → Entra ID → Seguridad → Acceso Condicional). El centro de administración de Microsoft Entra.

## Tres portales, un modelo mental

La dispersión a tres portales es real. Microsoft lleva años prometiendo consolidarlos. No lo han hecho, y se puede argumentar que no lo harán, porque cada portal tiene una audiencia distinta dentro de Microsoft (equipo de Endpoint, equipo de Seguridad, equipo de Identidad) y una cadencia de lanzamiento distinta.

El modelo mental que hace la dispersión manejable:

| Pregunta | Portal |
|---|---|
| «¿Está sano este dispositivo?» | Intune |
| «¿Está pasando algo malicioso?» | Defender |
| «¿Se permitió este inicio de sesión, y por qué?» | Entra (registros de inicio de sesión + Acceso Condicional) |

Cuando vuelves al ticket de Karen, la pregunta «¿por qué no puede iniciar sesión?» se descompone por portal:

- Si el **registro de inicio de sesión en Entra** dice «bloqueado por la política de Acceso Condicional *X*» → problema de AC. Abre esa política en Entra, mira las condiciones coincidentes, encuentra la que está fallando.
- Si el inicio de sesión tuvo éxito pero Outlook está lanzando errores de acceso, y el **dispositivo muestra no conforme en Intune** → problema de Intune. Abre la política de cumplimiento, mira qué está fallando en el dispositivo (probablemente BitLocker desactivado o SO no actualizado).
- Si el **inicio de sesión está permitido y el dispositivo es conforme**, pero el usuario está siendo expulsado repetidamente y hay **alertas de Defender** sobre la cuenta → probablemente revocación de token por Defender XDR Attack Disruption. Lo cual, en algún sitio bajo la frustración, es algo *bueno* — alguien acaba de hacerle phishing a Karen y el sistema lo pilló.

Mismo ticket, tres causas raíz completamente distintas, tres remediaciones completamente distintas.

## Malas configuraciones comunes, y cómo se manifiestan

Una pequeña guía de campo, porque estas aparecen una y otra vez.

**Política de AC que excluye al grupo equivocado.** «Exigir MFA para todos los usuarios» con la exclusión «Invitados» aplicada por error a un grupo sincronizado que incluye a parte del personal. La mitad del personal no recibe la aplicación de MFA. La alerta de MFA-deshabilitado en Panoptica365 va a dispararse sobre esos usuarios; antes de asumir que es un problema de métodos de autenticación por usuario, comprueba la lista de exclusión del AC. El fallo casi siempre está al nivel de la política, no al nivel del usuario.

**Política de cumplimiento de Intune demasiado laxa.** «Exigir BitLocker» suena bien, pero si la política no *falla* el dispositivo cuando BitLocker está desactivado, los dispositivos pueden reportar conformes sin estar realmente cifrados. Comprueba las condiciones de fallo de la política de cumplimiento, no solo su estado objetivo. Una política de cumplimiento sin dientes es peor que ninguna política — te da una falsa confianza.

**Defender for Endpoint no desplegado en todos los dispositivos.** Intune *se supone* que empuja Defender, pero los grupos de exclusión, las variantes de SO, o los dispositivos pre-Intune se cuelan. Aparecen dispositivos en Intune pero no en Defender. El inventario de dispositivos de Defender XDR y la lista de dispositivos de Intune deberían coincidir dentro de un par de puntos porcentuales; si difieren significativamente, falta algo. Haz esa reconciliación periódicamente.

**Política de AC «Report-only» dejada para siempre.** El modo Report-only es genial para probar — el AC evalúa la política y registra lo que habría pasado, pero no aplica de verdad. El error es entregar una política en Report-only y olvidarse de cambiarla a On. La política «existe» pero no aplica nada. El detector de deriva de AC de Panoptica365 no marca esto por su cuenta; tienes que comprobar el estado de la política a mano. Sí, es molesto. Sí, lo sabemos.

**Defender alerta sobre un usuario pero el AC no recoge el riesgo.** Entra ID Protection P2 es necesario para AC basado en riesgo. Si el cliente está en Business Premium (solo P1), el AC no puede leer la señal de riesgo del usuario aunque Defender la esté generando. La alerta se queda ahí. El usuario inicia sesión de todas formas. Este es uno de los argumentos más fuertes para subir a E5 los tenants de mayor riesgo — cubierto en la lección 5.

## Lo que esto significa para el operador

Dos puntos prácticos.

**Cuando algo va mal, nombra la capa primero.** «El inicio de sesión falló» no es una causa raíz; es un síntoma. La causa raíz vive en el AC, en Intune, en Defender, o directamente en los métodos de autenticación del usuario. Identificar la capa antes de empezar a cambiar ajustes es la diferencia entre un arreglo de 10 minutos y una pesca de 90 minutos a través de tres portales.

**La mayor parte de tu *tiempo* en esta pila se irá en Acceso Condicional.** Intune se configura-y-se-revisa. Defender se ejecuta en gran parte solo. El AC necesita atención continua — cada aplicación nueva, cada grupo nuevo de usuarios, cada requisito nuevo de cumplimiento crea presión sobre el conjunto de políticas de AC. Por eso la tarjeta 3 está dedicada enteramente a las políticas-plantilla de AC. Las otras herramientas se configuran; el AC se *opera*.

## Lo que viene

- **Lección 4: Defender XDR — qué es, qué no es.** Lo hemos tocado como la capa de correlación; la lección 4 es la inmersión profunda sobre por qué XDR no es EDR, no es SIEM, y no es un producto único.
- **Lección 5: Licencias de Microsoft 365 — qué desbloquea qué.** La razón por la que Entra ID Protection (y el AC basado en riesgo) no está disponible en todos los tenants.
- **Lección 6: Dónde encaja Panoptica365 en este cuadro.** Pista: no reemplaza a ninguno de estos tres portales. Solo hace manejable la mitad-observación del trabajo.

Por ahora: tres portales, tres trabajos, un bucle. Intune produce señales de confianza. Defender produce señales de riesgo. El Acceso Condicional lee ambas y decide. Cada inicio de sesión en M365 recorre ese bucle.

---

*Fuentes de los datos en esta lección — Microsoft Learn sobre el bucle de cumplimiento de Acceso Condicional y la evaluación del estado del dispositivo ([Microsoft Learn — Construir una política de Acceso Condicional](https://learn.microsoft.com/en-us/entra/identity/conditional-access/concept-conditional-access-policies)); Microsoft Learn — mecánicas de Attack Disruption de Defender XDR ([Microsoft Learn — Automatic attack disruption](https://learn.microsoft.com/en-us/defender-xdr/automatic-attack-disruption)); referencia de las políticas de cumplimiento de Intune ([Microsoft Learn — Use compliance policies](https://learn.microsoft.com/en-us/mem/intune/protect/device-compliance-get-started)).*
