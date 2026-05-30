---
title: "Licencias de Microsoft 365 — qué desbloquea qué"
subtitle: "De Business Basic a E5 — qué nivel de SKU desbloquea el Acceso Condicional, Intune, Defender for Endpoint y la protección de identidad basada en riesgo."
icon: "key"
last_updated: 2026-05-29
---

# Licencias de Microsoft 365 — qué desbloquea qué

La estrategia de licencias de Microsoft puede resumirse en una frase: *llevar más clientes a Business Premium o E5*.

Una vez que ves la estrategia, el catálogo entero de licencias empieza a tener sentido. ¿Por qué Business Standard sigue conspicuamente con pocos recursos en seguridad? Porque Microsoft quiere que los clientes Standard suban a Premium. ¿Por qué a E3 le siguen añadiendo funciones en cada subida de precio? Porque Microsoft quiere convertir a E3 en el paso obvio entre Premium y E5. ¿Por qué E5 mantiene las capacidades más interesantes de Defender bloqueadas detrás de sí? Porque ahí está el margen.

Te lo digo desde el principio porque las decisiones de licencia son la conversación con mayor palanca que un MSP tiene con un cliente. Acierta el nivel y la mayoría de los controles de este programa simplemente funcionan. Falla el nivel — deja a un cliente en Business Standard, por ejemplo — y aproximadamente la mitad de lo que has aprendido en las tarjetas 2 a 6 se vuelve inaccesible, no importa cuánto te esfuerces.

Esta lección es el mapa de licencias, una lectura honesta de cada nivel, y cómo usar el nivel en las conversaciones con clientes.

## La tarjeta de precios actual (efectiva el 1 de julio de 2026)

Microsoft acaba de subir precios en la mayoría de los niveles. Compromiso anual, por usuario, por mes, en USD:

| Nivel | Precio (post-julio 2026) | Precio anterior |
|---|---|---|
| Business Basic | ~6 $ | ~6 $ (estable) |
| Business Standard | 14 $ | 12,50 $ |
| **Business Premium** | **22 $** | **22 $ (estable)** |
| Microsoft 365 E3 | 39 $ | 36 $ |
| Microsoft 365 E5 | 60 $ | 57 $ |

Fíjate en lo que hizo Microsoft. **Business Premium no subió.** Business Standard subió un 12 %. E3 y E5 subieron un 8 % y un 5 % respectivamente. El mantenimiento del precio de Premium no es generosidad; es una señal. Quieren que los clientes Standard encuentren Premium incluso más atractivo, y acaban de añadir una lista significativa de capacidades a Premium y E3 al mismo tiempo. El precio *es* el marketing.

## Qué desbloquea cada nivel realmente (solo seguridad)

La matriz completa de funciones es enorme. Abajo está la rebanada de solo-seguridad — las partes que importan para el programa que estás leyendo.

### Business Basic — ~6 $/usuario/mes

Correo y las apps de Office Web. **Exchange Online Protection (EOP)** para anti-spam y anti-malware básico sobre el flujo de correo. Sin Acceso Condicional. Sin aplicación de MFA a nivel de licencia (puedes seguir habilitando los valores por defecto de seguridad, pero son toscos). Sin Intune. Sin Defender más allá de EOP.

En términos de seguridad, Business Basic es «M365 está técnicamente presente». Si un cliente está en este nivel y tú eres responsable de su seguridad, lo *estás protegiendo con las herramientas que él posee*, que es decir casi ninguna.

### Business Standard — 14 $/usuario/mes (post-julio 2026)

Añade las apps de Office de escritorio y algunas funciones de negocio (Bookings, Forms, MileIQ). En el lado de seguridad, **idéntico a Basic.** Sin Intune. Sin Defender for Business. Sin Entra ID P1. Sin Acceso Condicional.

Este es el nivel trampa. Los clientes piensan que están «en Office 365» y asumen que eso incluye seguridad. No lo hace. Los clientes Standard no pueden usar Acceso Condicional, no pueden gestionar dispositivos a través de Intune, no pueden aplicar anti-phishing significativo más allá de la base de EOP. Si un cliente está en Standard y un atacante le hace phishing, tus opciones de respuesta se limitan a «restablecer su contraseña» — que ya hemos establecido (lección 1, tarjeta 2) que no es suficiente en 2026.

### Business Premium — 22 $/usuario/mes

El primer nivel con herramientas de seguridad reales, y el nivel más importante de toda esta lección.

- **Intune Plan 1** — gestión de dispositivos completa, políticas de cumplimiento, despliegue de aplicaciones.
- **Defender for Business** — EDR enfocado en PYME con gestión de políticas simplificada. Menos capaz que Defender for Endpoint Plan 2, pero cubre el modelo de amenazas para la mayoría de las PYME.
- **Entra ID P1** — *Acceso Condicional*, más restablecimiento de contraseña de autoservicio, grupos dinámicos, asignación de licencias basada en grupos.
- **Defender for Office 365 Plan 1** — políticas anti-phishing, Safe Links, Safe Attachments, protección contra suplantación. (Añadido a Premium y E3 a finales de 2025.)
- **Information Protection P1** — etiquetas de confidencialidad (clasificación manual).
- **Cumplimiento de Microsoft Purview** — retención básica y eDiscovery (limitado).

Business Premium es la **base de seguridad PYME**. Es el nivel más bajo donde los controles de este programa son en su mayoría utilizables. Si un cliente tiene menos de 300 usuarios y está en cualquier cosa por debajo de Premium, tu primera conversación con él debería ser sobre subirlo. Premium también es un nivel con precio fijo — Microsoft lo está dejando en 22 $ específicamente para hacer esta conversación más fácil.

Las dos brechas notables en Premium que los operadores sienten:

**Sin Entra ID P2.** P2 es donde vive Identity Protection (puntuación basada en riesgo de usuarios e inicios de sesión). El Acceso Condicional basado en riesgo — «bloquear el inicio de sesión cuando el riesgo del usuario es alto» — no está disponible en Premium. Puedes exigir MFA en general, pero no puedes escalar dinámicamente basándote en la propia telemetría de riesgo de Microsoft.

**Sin Defender XDR completo.** Defender for Business te da EDR para terminales pero no es lo mismo que Defender for Endpoint Plan 2, y muchas de las capacidades más profundas de correlación entre productos de Defender XDR (Threat Explorer, Custom Detection Rules a escala, advanced hunting con retención larga) son funciones de Plan 2 / E5.

Para el 80 % de los clientes PYME, esas brechas no importan en el día a día. Para el otro 20 % — industrias reguladas, clientes con datos sensibles, clientes que ya han sido vulnerados una vez — importan mucho.

### Microsoft 365 E3 — 39 $/usuario/mes (post-julio 2026)

Diseñado para organizaciones más grandes o aquellas que quieren la pila completa de Microsoft sin el salto a Defender for Endpoint Plan 2 / Entra ID P2 de E5. E3 ha ido siendo mejorado paulatinamente — finales de 2025 añadió Defender for Office 365 Plan 1 e Intune Plan 2, más Remote Help y Intune Advanced Analytics.

Comparado con Business Premium, E3 añade:

- **Intune Plan 2** — Remote Help, funciones avanzadas de gestión de dispositivos.
- **Microsoft Defender Antivirus** incluido (este es el AV de Windows que viene con el sistema — *no* Defender for Endpoint).
- **Funciones de Office 365 E3** — límites de buzón más altos, archivado, cumplimiento más avanzado.
- **Sin tope de usuarios** — Business Premium está topado en 300 usuarios.

Lo que E3 *no* te da que podrías pensar:

- **Defender for Endpoint Plan 2** (EDR con acciones de respuesta avanzadas) — solo E5.
- **Entra ID P2** (Identity Protection) — solo E5.
- **Defender for Identity**, **Defender for Cloud Apps** — solo E5.
- **Defender XDR completo** — parcial en E3; completo solo en E5.

E3 es, de manera algo incómoda, *menos seguro que Business Premium* en el eje de EDR. Business Premium viene con Defender for Business; E3 viene solo con el Defender Antivirus de Windows. El cliente correcto de E3 empareja su licencia con Defender for Endpoint Plan 1 o 2 como complemento, o sube a E5.

Por eso «E3 vs Business Premium» es una conversación real con el cliente, y no una con una respuesta de una línea. Muchas PYME terminan mejor protegidas en Premium que en E3 porque Premium viene con un EDR real por defecto.

### Microsoft 365 E5 — 60 $/usuario/mes (post-julio 2026)

La pila completa.

- **Defender for Endpoint Plan 2** — el EDR completo con advanced hunting, automatic investigation, seis meses de retención de telemetría, integración completa con XDR.
- **Defender for Identity** — monitorización de AD local.
- **Defender for Cloud Apps** — monitorización a nivel de SaaS y descubrimiento de shadow IT.
- **Defender for Office 365 Plan 2** — añade Threat Explorer, Attack Simulation Training, Automated Investigation and Response.
- **Entra ID P2** — Identity Protection (puntuación de riesgo), Privileged Identity Management (PIM), revisiones de acceso.
- **Insider Risk Management** — el módulo de Purview para la fuga de datos por insiders.
- **Cloud PKI** — autoridad de certificación alojada por Microsoft.
- **Microsoft Security Copilot agents** (despliegue en 2026) — asistencia de flujo de trabajo de seguridad impulsada por IA a través de Defender, Entra, Intune, Purview.

E5 es correcto para clientes que tienen un equipo de seguridad real, cargas de trabajo reguladas, o que le han pedido a su MSP que «sea el SOC». La mayoría de las PYME no necesitan E5; algunas sí lo necesitan, sin duda.

## Cuándo E5 vale la pena de verdad

El pitch honesto de E5 no es «más funciones por más dinero». Son *tres capacidades específicas que no están disponibles por debajo de E5*.

**Acceso Condicional basado en riesgo.** Entra ID P2 (solo E5) le da al Acceso Condicional la capacidad de leer el riesgo del usuario y el riesgo del inicio de sesión desde Entra ID Protection en el momento de la política. Eso significa que puedes escribir «bloquear inicio de sesión cuando el riesgo del usuario es alto» en lugar de «exigir MFA siempre». Es la diferencia entre MFA de instrumento contundente y seguridad contextual. Para clientes que ven con frecuencia ataques sofisticados de identidad, esto importa.

**Defender for Endpoint Plan 2.** El EDR completo. La cobertura de detección comportamental en Plan 2 es materialmente más profunda que Defender for Business (Premium) o Defender Antivirus solo (E3). Incluye Live Response (shell remoto a un dispositivo para investigación), Threat & Vulnerability Management completo, seis meses de retención de telemetría.

**Privileged Identity Management (PIM).** Elevación administrativa justo-a-tiempo. Los administradores no tienen Global Admin permanente; solicitan elevación, aprueban mediante flujo, y el rol se revoca automáticamente después de un tiempo definido. Para cualquier cliente donde la amenaza interna es real (casi siempre lo es), PIM es una de las mejores mitigaciones disponibles y existe solo en E5.

Si un cliente no se beneficia de al menos dos de esas tres, E5 probablemente es excesivo. Véndele Business Premium con una explicación clara de *por qué* — ese es un pitch más honesto que subirle por razones de ingresos.

## Lo que significa la subida de precio de julio de 2026 para las conversaciones con clientes

Vas a tener conversaciones sobre precios con la mayoría de tus clientes en los próximos 6–9 meses. Algunas cosas a tener en cuenta.

**El diferencial de precio entre Standard y Premium acaba de encogerse.** Premium está a 22 $, Standard a 14 $. La brecha era de 9,50 $; ahora es de 8 $. El argumento para subir clientes de Standard a Premium acaba de hacerse un 16 % más barato de hacer. Úsalo.

**Los clientes solo-E3 deberían evaluarse para presión de subida.** Los clientes de E3 que pagan 39 $ están gastando casi el doble de lo que cuesta Premium pero están obteniendo *menos cobertura de EDR* en sus terminales. Muchos deberían o bien bajar a Premium (si tienen menos de 300 usuarios) o subir a E5. Quedarse en E3 sin Defender for Endpoint Plan 2 como complemento es un terreno medio de seguridad que debería revisitarse.

**E5 ahora es un cliente de 60 $.** Las conversaciones de renovación a 60 $ son distintas de las de 57 $. Asegúrate de que el cliente está *usando de verdad* lo suficiente de la pila de E5 para justificarlo — ¿PIM activado y configurado? ¿Identity Protection alimentando realmente políticas de AC basadas en riesgo? ¿Defender XDR siendo revisado semanalmente? Si tres de esas respuestas son «no», el cliente podría estar pagando por capacidades que no está operando, y tienes una conversación sobre o bien ajustar el tamaño de su licencia *o* ayudarle a operar lo que posee.

## Lo que esto significa para el operador

Dos puntos prácticos.

**Conoce el nivel de licencia antes de proponer un control.** «Activa el Acceso Condicional basado en riesgo» es una recomendación excelente, salvo que no existe por debajo de E5. Recomendar controles a los que el cliente no tiene acceso es un problema de credibilidad. La consciencia de licencias en las alertas de Panoptica365 (la capa de análisis con IA) es en parte para evitar esto — pero tú, el operador, también deberías interiorizar qué controles requieren qué nivel.

**La conversación sobre la licencia forma parte de la conversación sobre la seguridad.** Los MSP que tratan el nivel de licencia como una pregunta de ventas y la seguridad como una pregunta técnica separada se pierden esto. La licencia *es* la frontera de seguridad. Si no puedes habilitar Acceso Condicional, no puedes hacer cumplir fronteras de identidad. Si no puedes desplegar Defender for Endpoint, no puedes responder de forma significativa al ransomware. Vender Business Premium es vender seguridad; vender Business Standard es vender un producto distinto del que el cliente cree que está comprando.

## Lo que viene

- **Lección 6: Dónde encaja Panoptica365 en este cuadro.** La última lección de orientación antes de meternos en las amenazas y los controles reales.

Después arranca la tarjeta 2 (*Amenazas de identidad y patrones de ataque*). Para entonces, cuando una alerta recomiende «MFA resistente al phishing» o «AC basado en riesgo» o «Defender for Identity», sabrás si el cliente puede actuar sobre esa recomendación o si la recomendación misma es una conversación de subida de licencia disfrazada.

Por ahora: las licencias no son un detalle de facturación. Son la frontera de seguridad. Vende Business Premium. Trata Standard como una brecha de seguridad. Trata E5 como un gasto justificado solo cuando el cliente está usando de verdad sus tres capacidades diferenciadas.

---

*Fuentes de los datos en esta lección — cambios de precio y funciones de Microsoft 365 efectivos el 1 de julio de 2026 ([Microsoft 365 Blog — Advancing Microsoft 365, diciembre de 2025](https://www.microsoft.com/en-us/microsoft-365/blog/2025/12/04/advancing-microsoft-365-new-capabilities-and-pricing-update/)); matrices de comparación de planes y funciones de Microsoft 365 ([Compare Microsoft 365 Enterprise Plans and Pricing](https://www.microsoft.com/en-us/microsoft-365/enterprise/microsoft-365-plans-and-pricing)); análisis Business Premium vs E3 ([TrustedTech — Business Premium or E3?](https://www.trustedtechteam.com/blogs/microsoft-365/business-premium-vs-e3)); resumen de cambios de precio de Microsoft 365 en 2026 ([CloudCapsule 2026 pricing analysis](https://blog.cloudcapsule.io/blog/microsoft-365-pricing-changes-in-2026-what-you-really-need-to-know)).*
