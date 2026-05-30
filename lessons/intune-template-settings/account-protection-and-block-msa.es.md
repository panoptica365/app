---
title: "Account Protection + Block Microsoft Consumer Accounts — endurecimiento de credenciales en el endpoint"
subtitle: "Windows Hello for Business, Credential Guard y bloqueo de cuentas Microsoft personales — hacer las credenciales más difíciles de robar si el dispositivo está comprometido."
icon: "user-lock"
last_updated: 2026-05-29
---

# Account Protection + Block Microsoft Consumer Accounts — endurecimiento de credenciales en el endpoint

La mayoría de las amenazas de identidad de la tarjeta 2 terminan en el momento en que el atacante tiene las credenciales. El phishing AiTM captura la cookie de sesión; el credential stuffing acierta con una contraseña reutilizada; el phishing de consentimiento OAuth consigue que el usuario otorgue acceso. La defensa en cada caso ha sido *no dejar que el atacante consiga la credencial* (MFA resistente al phishing), *no dejar que la credencial sea robada* (passkeys, autenticación basada en certificado), o *no dejar que una credencial robada sea útil* (Token Protection, Acceso Condicional).

Hay una defensa complementaria que vive en el propio endpoint: hacer que las credenciales sean *más difíciles de robar de entrada* si el dispositivo está comprometido. Eso es lo que hacen las dos plantillas de esta lección.

La plantilla Account Protection Settings configura Windows Hello for Business (autenticación biométrica o por PIN estilo passkey, atada al TPM del dispositivo) y Credential Guard (una capa de aislamiento basada en virtualización que protege las credenciales en memoria contra la extracción por malware).

La plantilla Block Microsoft Consumer Accounts impide que los usuarios añadan cuentas Microsoft personales (las de consumidor de Outlook.com / Hotmail / Live.com) a dispositivos Windows corporativos, lo que cierra una puerta trasera donde un usuario podría accidentalmente — o deliberadamente — meter su dispositivo en una identidad de nube personal junto a la corporativa.

Esta lección cubre ambas.

## Account Protection Settings — qué configura

La plantilla usa el tipo de plantilla más antiguo **Intents** (`policyType: intents`) con el ID de plantilla de seguridad de endpoint de Microsoft `0f2b5d70-d4e9-4156-8c16-1397eb6c54a5`. Ese ID de plantilla corresponde a la familia de políticas Account Protection de seguridad de endpoint de Microsoft.

Los ajustes (unos 15 de ellos) se agrupan en tres áreas:

### Windows Hello for Business — política de PIN

Windows Hello for Business (WHfB) es el mecanismo de autenticación sin contraseña de Microsoft en Windows. En lugar de teclear una contraseña para iniciar sesión, el usuario se autentica vía PIN (respaldado por el TPM), biometría (cara o huella, respaldada por el hardware de Windows Hello), o una llave de seguridad. La credencial se almacena criptográficamente en el TPM del dispositivo, así que no puede ser extraída por malware leyendo memoria.

Los ajustes de política de PIN:

- **Longitud mínima del PIN: 6** (la elección de la plantilla — el mínimo por defecto de Microsoft es 4; más largo es más fuerte pero más fricción).
- **Longitud máxima del PIN: 127** (efectivamente ilimitado).
- **Bloqueo de los últimos PINs: 24** — no se pueden reutilizar los últimos 24 PINs.
- **Expiración del PIN en días: 0** — sin expiración del PIN. Es el ajuste moderno recomendado; la rotación forzada de PINs crea peores desenlaces (los usuarios eligen PINs más débiles que pueden recordar).
- **Caracteres en mayúscula / minúscula / especiales del PIN: notConfigured** — sin requisitos de caracteres más allá de la longitud mínima. Los PINs son locales al dispositivo y respaldados por TPM; la complejidad importa menos que la longitud.
- **Recuperación de PIN habilitada: true** — los usuarios pueden recuperar un PIN perdido vía el método de recuperación configurado.

### Comportamiento de desbloqueo de Windows Hello

- **Desbloqueo con biometría: true** — se permite el desbloqueo con cara o huella junto al PIN.
- **Anti-suplantación mejorado: true** — el desbloqueo biométrico usa detección anti-suplantación (previene engañar el reconocimiento facial con una foto).
- **Usar llave de seguridad para iniciar sesión: false** — las llaves de seguridad FIDO2 para iniciar sesión no son el valor por defecto. Se pone así porque no todos los clientes han emitido llaves FIDO2; los tenants que lo hayan hecho pueden sobrescribirlo por-tenant.
- **Usar certificados para autenticación on-prem: false** — la autenticación basada en certificados on-prem no es el valor por defecto para esta plantilla.
- **Windows Hello for Business requerido: false** — WHfB está *disponible* pero no *requerido*. Los usuarios todavía pueden iniciar sesión con contraseña si lo prefieren. La combinación de la infraestructura de WHfB presente y el usuario eligiéndola es la ruta típica de adopción.
- **Dispositivo de seguridad requerido: false** — TPM no requerido para WHfB. (En la práctica, casi cada dispositivo Windows tiene un TPM; este ajuste es permisivo.)

### Credential Guard

- **Device Guard / Credential Guard: enableWithoutUEFILock** — Credential Guard está habilitado, pero el bloqueo UEFI que impediría deshabilitar Credential Guard desde fuera del SO no se aplica.

Credential Guard es la característica de seguridad que más importa en esta plantilla. Usa la virtualización de Windows (aislamiento de Hyper-V) para aislar el proceso LSASS — la parte de Windows que almacena credenciales con hash en memoria. Con Credential Guard activo, el malware corriendo en el dispositivo (incluso con privilegios elevados) no puede extraer credenciales de la memoria de LSASS — las credenciales están en un contenedor aislado por hardware que el resto del SO no puede alcanzar.

Esta es la defensa contra herramientas como Mimikatz, que vuelcan la memoria de LSASS para extraer hashes NTLM y tickets Kerberos que pueden ser replicados para atacar otros sistemas. La regla ASR «Bloquear el robo de credenciales desde LSASS» (lección 7) pilla a Mimikatz a nivel de comportamiento; Credential Guard impide que el ataque subyacente tenga éxito incluso si la detección de comportamiento fuera evadida.

La elección de «habilitar sin bloqueo UEFI» cambia una pequeña cantidad de seguridad por una gran cantidad de flexibilidad operativa. El bloqueo UEFI haría imposible deshabilitar Credential Guard sin reflashar físicamente el firmware del dispositivo. Es el ajuste de máxima seguridad pero es frágil — si surge un problema (compatibilidad de controladores, necesidad de diagnóstico), el operador no puede deshacerlo vía Intune. La variante sin bloqueo UEFI da a los MSPs la capacidad de deshabilitar Credential Guard vía política cuando sea necesario, al coste de permitir la misma vía de deshabilitar a un atacante sofisticado que ya ha comprometido el dispositivo.

## Block Microsoft Consumer Accounts — qué configura

La plantilla usa el tipo de plantilla moderno Settings Catalog. Su trabajo es estrecho y deliberado: impedir que los usuarios añadan cuentas Microsoft personales (Outlook.com / Hotmail / Live.com / Xbox / OneDrive personal) a un dispositivo Windows corporativo, dejando intacta la autenticación de cuenta de trabajo/escuela vía el Web Account Manager (WAM) — el mecanismo que usan las aplicaciones de Microsoft 365 para iniciar sesión.

La distinción importa porque la política «bloquear cuentas Microsoft» de Windows es un único CSP que puede configurarse de varias formas, y el valor equivocado bloquea demasiado. WAM usa flujos de autenticación estilo cuenta Microsoft para cuentas de trabajo/escuela por debajo, así que un ajuste tosco que bloquee toda la autenticación con sabor MSA también romperá los inicios de sesión de Outlook, Teams y otras aplicaciones de Office. La plantilla está ajustada para bloquear solo la adición de MSA personal, dejando abierta la ruta de autenticación de trabajo/escuela.

La configuración real de la plantilla:

- **Allow Microsoft Accounts:** configurado para bloquear la adición de MSA personales mientras permite la autenticación de cuenta de trabajo/escuela vía WAM.
- Algunos ajustes relacionados del Account Manager ajustados consistentemente con esa intención.

La intención: un dispositivo corporativo gestionado debería iniciar sesión solo en identidades corporativas. Los usuarios no deberían estar añadiendo su cuenta personal de Outlook.com, su OneDrive personal, su MSA relacionada con gaming al dispositivo. Las razones:

- **Riesgo de fuga de datos.** Una MSA personal configurada en un dispositivo corporativo puede sincronizar carpetas de OneDrive personal que contienen documentos corporativos. Los datos corporativos están ahora en la nube personal, fuera del control del MSP.
- **Confusión de identidades.** Los usuarios con MSAs corporativas y personales en el mismo dispositivo frecuentemente se autentican en la identidad equivocada, causando tickets de soporte y ocasionalmente exponiendo datos corporativos al almacenamiento en la nube personal.
- **Exposición a phishing.** Un correo de phishing dirigido a la MSA personal del usuario, abierto en el dispositivo corporativo, puede resultar en un compromiso que afecte al dispositivo corporativo aunque la identidad atacada sea personal.
- **Cumplimiento.** Varios marcos regulatorios (incluyendo algunas interpretaciones del RGPD y CCPA) tratan la mezcla de datos corporativos y personales en el mismo dispositivo como un problema de cumplimiento.

El encuadre honesto: bloquear la adición de MSA personal es una mejora de seguridad significativa con impacto mínimo para el usuario. Los usuarios que legítimamente quieren sus cuentas personales disponibles lo hacen en sus dispositivos personales. Los dispositivos corporativos son corporativos.

## Qué puede romperse

Estas plantillas son generalmente más seguras que las plantillas ASR Rules y Firewall, pero tienen pillas específicas:

**La adopción de Windows Hello for Business necesita infraestructura.** Desplegar la plantilla Account Protection sin la infraestructura de WHfB (la configuración de confianza Kerberos en la nube, la configuración de la autoridad certificadora para escenarios on-prem híbridos, el flujo de inscripción del dispositivo) significa que los usuarios no pueden usar WHfB de verdad. Iniciarán sesión con contraseñas como siempre han hecho, y los ajustes de WHfB quedan sin usar. Es benigno pero significa que el beneficio de seguridad no se materializa. La adopción de WHfB suele ser un proyecto separado del despliegue de esta plantilla.

**Incompatibilidad de Credential Guard.** Un pequeño número de aplicaciones legítimas no funciona con Credential Guard activo. Culpables habituales: clientes VPN antiguos, productos anti-malware específicos que enganchan LSASS, algunas herramientas de autenticación basadas en certificados. El arreglo suele ser actualizar el software afectado; el workaround es deshabilitar Credential Guard para el usuario/dispositivo específico vía una exclusión.

**La plantilla Block MSA rompiendo MSAs previamente configuradas.** Los usuarios que tenían MSAs personales configuradas antes de desplegar la plantilla pueden ver sus cuentas personales eliminadas o volverse incapaces de refrescarse. Comunícalo al cliente con antelación — los usuarios con patrones legítimos de cuenta-personal-en-dispositivo-corporativo necesitarán ajustar sus flujos.

**Fricción de reseteo de PIN en WHfB.** Los usuarios que olvidan su PIN necesitan una ruta de reseteo. Si el cliente no ha configurado infraestructura de recuperación de PIN (el almacenamiento de claves de recuperación, la UI de reseteo de cara al usuario), los usuarios quedan bloqueados. Verifica que la ruta de recuperación funcione antes de desplegar.

## Despliegue

Despliegue por grupo piloto para ambas plantillas:

1. **Día 0** — despliega Account Protection y Block MSA en 3–5 dispositivos piloto. Característica crítica del dispositivo piloto: al menos un dispositivo con MSA personal ya configurada (para probar el comportamiento de Block MSA sobre estado existente) y al menos un dispositivo donde el usuario sea probable que pruebe WHfB (para verificar que la infraestructura funciona).
2. **Días 1–7** — verifica el éxito del despliegue en Intune. Haz una comprobación puntual en los dispositivos piloto. Confirma que Credential Guard aparece activo en `msinfo32.exe` (busca «Credential Guard» en el Resumen del Sistema — debería mostrar «Configurado» y «Corriendo»). Confirma el efecto de Block MSA — intenta añadir una MSA personal en un dispositivo piloto; debería fallar con el error apropiado.
3. **Días 7–14** — observa el uso de los dispositivos piloto. Vigila problemas de VPN (compatibilidad de Credential Guard), problemas de autenticación con software de nicho, quejas de usuarios sobre Block MSA.
4. **Día 14** — despliegue más amplio si el piloto está limpio.

Para la plantilla Block MSA específicamente, comunícate con los usuarios del cliente *antes* del despliegue. Los usuarios con MSAs personales en sus dispositivos corporativos necesitan saber qué está a punto de cambiar.

## Qué monitorizar tras la aplicación

**Credential Guard activo por dispositivo.** Debería estar 100% activo en dispositivos Windows 10/11 tras el despliegue. Los dispositivos que muestran «Configurado pero no corriendo» indican problemas de compatibilidad de hardware (raro; normalmente hardware de virtualización más antiguo) o un conflicto con otro producto.

**Tasa de inscripción de WHfB.** Rastrea cuántos usuarios han adoptado WHfB realmente. La plantilla hace que WHfB esté *disponible*; la adopción del usuario es voluntaria. La adopción baja es normal en las primeras semanas; debería subir a lo largo de los meses según los usuarios descubran la comodidad.

**Fallos de autenticación tras el despliegue.** Vigila un pico de tickets de helpdesk relacionados con autenticación. Podría ser incompatibilidad de VPN (Credential Guard), confusión con Block MSA (usuarios intentando iniciar sesión con MSA personal), o problemas de reseteo de PIN.

**Eventos de acceso a la memoria de LSASS** (desde la ingestión de Defender XDR, cuando esté configurada según la tarjeta 1 lección 4). Con Credential Guard activo, el volumen de eventos de intento de acceso a memoria de LSASS que se bloquean debería estar cerca de cero en operación normal. Cualquier volumen distinto de cero es interesante — o bien Credential Guard está haciendo su trabajo contra malware activo, o un proceso legítimo está haciendo algo que dispara la protección.

**Deriva sobre cualquiera de las plantillas.** Ambas plantillas pueden derivar — un admin deshabilitando Credential Guard para un dispositivo específico que tuvo problemas de compatibilidad, un admin aflojando Block MSA a petición del cliente, etc.

## Qué ve Panoptica365

Honestamente: no mucho específicamente sobre Account Protection. El panel no tiene estado de Credential Guard por dispositivo, estado de inscripción de WHfB por usuario, ni una matriz de despliegue de Block MSA. Ninguno de esos existe en el producto hoy, y nada por-dispositivo está fuera del modelo de lectura de Panoptica365.

Lo que Panoptica365 *sí* expone que es relevante:

- **Deriva sobre cualquiera de las plantillas.** Account Protection y Block Microsoft Consumer Accounts están ambas vigiladas por el detector de deriva. Si un admin deshabilita Credential Guard para un dispositivo problemático, o afloja Block MSA a petición del cliente, la deriva se dispara y el operador puede revertir, reaplicar o aceptar.
- **Detecciones de Defender XDR.** Cuando la ingestión de Defender XDR está configurada (tarjeta 1 lección 4), los incidentes relacionados con ataques de credenciales — intentos de acceso a LSASS, patrones sospechosos de extracción de credenciales — fluyen al motor de alertas. Si Credential Guard está haciendo su trabajo, esos incidentes deberían ser raros; un pico es interesante.

Para el estado de Credential Guard por dispositivo, la inscripción de WHfB por usuario, o la verificación por dispositivo de Block MSA, los operadores profundizan en la hoja de dispositivo de Intune, los registros de dispositivo de Entra, o el portal de Defender for Endpoint. Ese reparto — Panoptica365 para alertas y deriva, consolas de Microsoft para postura por dispositivo — es la forma consistente de la plataforma a través de toda la tarjeta 4.

## Lo que esto significa para el operador

Tres puntos para llevarte.

**Credential Guard es el ajuste de mayor palanca de esta plantilla.** De los 15 ajustes de Account Protection, la activación de Credential Guard es la que más importa. Defiende contra toda una clase de ataques de extracción de credenciales. Desplegar sin él deja una brecha mayor; desplegar con él cierra la brecha con poco coste operativo.

**Block MSA es una plantilla silenciosa, de alto valor.** Las MSAs personales en dispositivos corporativos son una fuente crónica de incidentes de fuga de datos y confusión de identidades. Bloquearlas aborda el problema en la capa de configuración. La plantilla está ajustada con precisión para bloquear la adición de MSA personal mientras deja la ruta de autenticación WAM de trabajo/escuela de la que dependen las aplicaciones M365 totalmente intacta — un objetivo más estrecho de lo que sugeriría el CSP por defecto de «Allow Microsoft Accounts», y la razón por la que esta plantilla merece tratarse como una configuración curada en lugar de un cambio de política de una línea.

**La adopción de WHfB es un movimiento de plazo más largo.** Esta plantilla hace WHfB *posible*. Conseguir que los usuarios realmente la usen (vs. seguir tecleando contraseñas) es un ejercicio separado de gestión del cambio. No esperes 100% de adopción de WHfB en un mes desde el despliegue; espera una adopción gradual a lo largo de seis a doce meses.

## Lo que viene

- **Lección 9: El bucle de cumplimiento en producción.** Cómo todas estas plantillas de Intune afloran como señales — qué vigila Panoptica365, qué significa la deriva aquí.
- **Lección 10: Importar tus propias plantillas de Intune.** El flujo de personalización.

Por ahora: Account Protection + Block MSA juntas cierran la brecha del lado de credenciales en endpoints Windows. Despliega ambas; verifica que Credential Guard se active; comunica el cambio de Block MSA a los usuarios; rastrea la adopción de WHfB a lo largo de los meses.

---

*Fuentes de los datos en esta lección — Microsoft Learn sobre Windows Hello for Business ([Microsoft Learn — Windows Hello for Business](https://learn.microsoft.com/en-us/windows/security/identity-protection/hello-for-business/)); referencia de Credential Guard ([Microsoft Learn — Credential Guard](https://learn.microsoft.com/en-us/windows/security/identity-protection/credential-guard/)); política Account Protection en seguridad de endpoint ([Microsoft Learn — Account Protection policies](https://learn.microsoft.com/en-us/mem/intune/protect/endpoint-security-account-protection-policy)); el CSP de política Allow Microsoft Accounts ([Microsoft Learn — Accounts CSP](https://learn.microsoft.com/en-us/windows/client-management/mdm/policy-csp-accounts)); Web Account Manager y M365 ([Microsoft Learn — WAM and M365](https://learn.microsoft.com/en-us/entra/identity-platform/scenario-desktop-acquire-token-wam)).*
