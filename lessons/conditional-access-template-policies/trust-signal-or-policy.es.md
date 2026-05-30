---
title: "Conforme O híbrido O MFA — la política OR de señales de confianza"
subtitle: "El sucesor con Intune de Exigir MFA: acceso si el dispositivo es gestionado, hybrid-joined, o MFA satisfecho."
icon: "git-branch"
last_updated: 2026-05-29
---

# Conforme O híbrido O MFA — la política OR de señales de confianza

La lección 2 cubrió la política Exigir MFA para todos los usuarios: simple, fundamental, siempre-MFA-pase-lo-que-pase. Esta lección es su sucesora — la versión más sofisticada para tenants que tienen Intune funcionando y quieren dar a los usuarios en dispositivos gestionados una experiencia más fluida sin renunciar al suelo de seguridad.

**Panoptica365 - Require compliant or hybrid Azure AD joined device or MFA for all users.** Descripción: *Comprueba varias condiciones para permitir conexiones.* Concesión: Exigir MFA, Exigir dispositivo conforme, Exigir Hybrid Azure AD joined (OR). Usuarios: Todos los usuarios. Aplicaciones: Todas las aplicaciones en la nube.

Esta plantilla usa el mismo patrón de condición OR que la lección 4 introdujo — múltiples caminos para satisfacer la misma intención. La política de la lección 4 combinaba la confianza de ubicación con la confianza de dispositivo. La política de esta lección combina tres formas distintas de probar que la postura del usuario es de confianza: dispositivo gestionado, dispositivo hybrid-joined, o MFA.

Elige cualquiera, el inicio de sesión procede. No elijas ninguna, el inicio de sesión es bloqueado.

## Los tres caminos

**Camino 1: Dispositivo conforme.** El dispositivo desde el que el usuario inicia sesión está inscrito en Intune y actualmente reporta como conforme. El cumplimiento normalmente significa: cifrado activado, SO parcheado dentro de una ventana aceptable, AV activo, sin jailbreak, la política específica del cliente se cumple. Si el dispositivo pasa esa barra, el inicio de sesión procede — *sin necesidad de prompt MFA*. El dispositivo ha probado que la postura del usuario es de confianza.

**Camino 2: Dispositivo Hybrid Azure AD joined.** El dispositivo es una máquina Windows gestionada por la empresa unida tanto al Active Directory local como a Entra ID. Los dispositivos hybrid-joined son típicamente estaciones de trabajo corporativas en entornos donde el cliente mantiene un controlador de dominio. Como los dispositivos conformes, los dispositivos hybrid-joined han probado que están gestionados y son de confianza. El inicio de sesión procede sin MFA.

**Camino 3: MFA.** El usuario completa un desafío de autenticación multifactor. Este es el camino de respaldo para usuarios en dispositivos personales, dispositivos no gestionados, o dispositivos aún no inscritos. Si pueden probar identidad mediante MFA, entran.

Cualquiera de los tres es suficiente. El control de concesión está configurado con «Exigir uno de los controles seleccionados» en lugar de «Exigir todos los controles seleccionados» — esa es la diferencia estructural entre esta plantilla y una política ingenua de «exigir todo».

## Qué está haciendo *en realidad*

Lee la intención de la política a través del lente de la tarjeta 1: *quién, qué, dónde, cuándo, raro?* Esta política está respondiendo a una pregunta — «¿es de confianza este inicio de sesión?» — y aceptando tres pruebas distintas:

- **El dispositivo lo prueba** (conforme o hybrid-joined). Microsoft e Intune ya han verificado el dispositivo; la confianza se transfiere al inicio de sesión.
- **El usuario lo prueba** (MFA). El humano frente al teclado ha demostrado que es el usuario legítimo.

Si ni el dispositivo ni el usuario lo prueban, el inicio de sesión es denegado. No hay un cuarto camino. No hay excepción «confiar porque es miércoles».

La fuerza de la política está en el efecto *combinado*: en dispositivos gestionados, los usuarios tienen una experiencia de inicio de sesión sin fricción (sin prompt MFA en cada sesión); en dispositivos no gestionados, el camino MFA los pilla. El cliente obtiene el suelo de seguridad de siempre-de-confianza-o-MFA sin la fricción de siempre-MFA.

## Cuándo usar esta plantilla en lugar de «Exigir MFA para todos los usuarios»

La plantilla de la lección 2 (Exigir MFA para todos los usuarios) y la plantilla de esta lección son las dos elecciones estratégicas principales para la política de AC de línea base de un tenant. Son alternativas, no complementos. La elección depende de la postura de Intune del cliente y la tolerancia a la fricción.

**Usa Exigir MFA para todos los usuarios (lección 2) cuando:**

- El cliente aún no tiene Intune (Business Standard o inferior — aunque esos clientes no deberían estar ahí en primer lugar según la tarjeta 1 lección 5).
- El cliente tiene Intune pero la cobertura de dispositivos es desigual — algunos usuarios en portátiles gestionados, otros en BYOD.
- Estás en medio del despliegue de Intune y el cumplimiento todavía no es fiable.
- La dirección del cliente quiere la postura «MFA en cada inicio de sesión» más simple posible por razones de cumplimiento.

**Usa la plantilla de esta lección (Conforme O híbrido O MFA) cuando:**

- Intune está desplegado y el cumplimiento es fiable.
- La mayoría de los usuarios están en dispositivos gestionados.
- Quieres mejor UX para esos usuarios sin comprometer la seguridad de los usuarios en dispositivos no gestionados.
- El cliente está cómodo con que la señal de confianza de dispositivo lleve peso (en lugar de exigir MFA en cada inicio de sesión).

En la práctica, la segunda plantilla encaja en la mayoría de los tenants bien-gestionados de Business Premium una vez que Intune está en su sitio. La primera plantilla es el valor por defecto seguro durante la ventana de despliegue de Intune o para tenants sin historia de Intune.

## Qué pasa si ambas están activadas simultáneamente

Esta es la pregunta que a menudo surge — y la respuesta afecta cómo un operador piensa sobre la migración entre estrategias.

Las políticas de Acceso Condicional *se acumulan vía AND lógico entre políticas*. Un inicio de sesión debe satisfacer cada política aplicable. Dentro de una política individual, las concesiones se combinan según las reglas de esa política (OR para «cualquiera de», AND para «todas de»).

Así que si tanto Exigir MFA para todos los usuarios (lección 2) como Conforme O híbrido O MFA (esta lección) están activadas:

- La política de la lección 2 dice: *debe completar MFA*.
- La política de esta lección dice: *debe tener dispositivo conforme, O dispositivo hybrid-joined, O completar MFA*.
- Combinadas: *debe satisfacer ambas políticas*.

El requisito de MFA de la política de la lección 2 es incondicional. Los caminos OR de la política de la lección 5 incluyen MFA. Así que la única forma de satisfacer *ambas* es completar MFA. Los caminos dispositivo-conforme y hybrid-joined de la lección 5 se vuelven irrelevantes — incluso en un dispositivo perfectamente conforme, el usuario todavía tiene que hacer MFA porque la lección 2 lo exige.

**Efecto neto de ambas activadas: igual que activar la lección 2 sola.** Las partes «OR» de la plantilla de esta lección quedan suprimidas por el requisito de MFA incondicional de la lección 2.

Esta *no* es una configuración útil. No es «defensa en profundidad» — es redundancia con la severidad de la política más estricta. El camino dispositivo-conforme que la plantilla de la lección 5 fue diseñada para habilitar es inalcanzable.

Las configuraciones correctas:

- **Activa solo la lección 2** si quieres semántica de MFA-siempre-estricto.
- **Activa solo la lección 5** si quieres semántica de OR-basada-en-confianza inteligente.
- **No actives ambas** esperando que los caminos OR se apliquen.

El camino de migración entre estrategias:

1. Empieza con la política de la lección 2 activada (siempre-MFA). La mayoría de los tenants aterrizan aquí primero porque Intune aún no está listo.
2. Despliega el cumplimiento de Intune. Prepara el lado dispositivo.
3. Cuando el cumplimiento sea fiable, despliega la política de la lección 5 en modo solo informe.
4. Verifica que los inicios de sesión desde dispositivos conformes coincidan con la política y serían permitidos sin MFA.
5. Cambia la lección 5 a Habilitada.
6. *Deshabilita la lección 2* una vez que la lección 5 esté aplicándose. (O mantén la lección 2 en solo informe como referencia de documentación; está bien, simplemente no tengas ambas aplicándose.)
7. La experiencia del usuario cambia: los usuarios en dispositivos gestionados ya no ven un prompt MFA en cada sesión.

El punto de decisión es entre los pasos 5 y 6. Si el cliente está nervioso con el cambio, puedes mantener ambas políticas aplicándose durante un breve período de solapamiento — los usuarios seguirán viendo prompts MFA incluso en dispositivos conformes — y luego deshabilitar la lección 2. El pre-despliegue (lección 1) debería haber verificado ya que el cumplimiento es fiable; el solapamiento es solo una medida de confianza.

## Qué vigilar durante la migración

**Fiabilidad de los informes de cumplimiento.** Toda la estrategia depende de que los dispositivos reporten su estado con precisión. Si un dispositivo genuinamente conforme pero Intune lo reporta como no conforme (problemas de red, retardo de sincronización, estado obsoleto), el usuario obtiene un prompt MFA donde no debería. Lo inverso es peor: si un dispositivo no es conforme pero Intune lo reporta como conforme, el inicio de sesión se salta MFA cuando no debería.

Ejecuta comprobaciones periódicas de reconciliación de dispositivos. Si un dispositivo se muestra conforme en Intune pero está fallando alguna comprobación de cumplimiento a nivel de SO, la brecha importa.

**Evaluación perezosa del cumplimiento.** Intune no reevalúa continuamente cada dispositivo. Hay una cadencia de check-in. Un dispositivo que se vuelve no conforme (el usuario deshabilita BitLocker, se atrasa en parches) puede seguir reportando conforme durante algunas horas después del cambio. AC lee el estado actual en el momento del inicio de sesión, así que puede haber una ventana corta donde el camino de confianza-de-dispositivo de esta política sea «conforme» cuando no debería serlo.

No te preocupes por el retardo a nivel de minuto — es el retardo a nivel de hora el que importa. Configura los intervalos de check-in de cumplimiento de dispositivo apropiadamente en Intune.

**Deriva de dispositivos hybrid-joined.** Si el cliente tiene un entorno Hybrid AD, los dispositivos pueden caerse del estado hybrid-joined sin que nadie se dé cuenta (problemas de sincronización de Azure AD Connect, retardo de replicación, controladores de dominio retirados). Los dispositivos que ya no están hybrid-joined silenciosamente pierden el camino de confianza hybrid-joined. No te das cuenta hasta que el usuario está en una red personal y el inicio de sesión falla.

Monitoriza la salud de tu sincronización de Hybrid AD regularmente; Panoptica365 no saca directamente esta señal a la superficie pero la salud de sincronización de Entra subyacente es visible en los centros de administración de Microsoft.

## Despliegue

Migrar de la política de la lección 2 a esta es el camino de migración típico. El trabajo es lo bastante sustancial como para que **el paso manual de solo informe en el portal de Entra sea recomendable para esta migración independientemente del tamaño del tenant**. La razón: esto no es una política nueva única; es un cambio de estrategia. Los errores son más ruidosos.

La verificación pre-despliegue (según la lección 1) confirma que el cumplimiento de Intune es fiable en una fracción sustancial de la base de usuarios, los dispositivos hybrid-joined están con sincronización-sana si aplica.

Luego:

1. **Día 0** — despliega esta plantilla vía Panoptica365 (crea la política en estado Habilitado). Cambia inmediatamente la política a solo informe en el portal de Entra. Mantén la plantilla de la lección 2 aplicándose durante esta ventana.
2. **Días 1–7** — saca el registro de inicios de sesión filtrado por el resultado de solo informe de esta política. Para cada inicio de sesión:
   - ¿Tuvo éxito el camino dispositivo-conforme o hybrid-joined? (El usuario está en un dispositivo gestionado.) Bien — el patrón OR está funcionando como se diseñó.
   - ¿Solo tuvo éxito el camino MFA? (El usuario completó MFA, ningún otro camino estaba disponible.) Este usuario o está en un dispositivo personal o en un dispositivo gestionado donde el cumplimiento está reportando mal. Investiga.
   - ¿Falló el inicio de sesión los tres caminos? (Bloqueado.) Este es un usuario que no pudo autenticarse incluso con MFA — probablemente un problema de configuración. Investiga.
3. **Días 7–14** — arregla cualquier problema de reporte de cumplimiento que aflore durante solo informe.
4. **Día 14** — cambia esta plantilla de vuelta a Habilitada en el portal de Entra.
5. **Día 14 (mismo día)** — deshabilita la plantilla de la lección 2 en Panoptica365 (o cámbiala a solo informe como referencia de documentación, pero no la mantengas aplicándose junto a esta).
6. **Día 14 en adelante** — monitoriza el comportamiento del usuario. Los usuarios en dispositivos gestionados notarán la experiencia más fluida; los usuarios en dispositivos personales no notarán cambio (estaban obteniendo MFA antes y obtienen MFA ahora).

Ventana total: dos semanas. El coste de fricción está justificado — este cambio de estrategia recompensa la verificación cuidadosa.

## Lo que esto significa para el operador

Tres puntos para llevarte.

**Este es el objetivo de actualización para tenants con Intune fiable.** Mueve a los clientes aquí tan pronto como su postura de Intune sea buena. Mejor UX para usuarios en dispositivos gestionados, mismo suelo de seguridad para usuarios en dispositivos no gestionados, menos fricción en total.

**No corras la lección 2 y esta lección en paralelo.** Los caminos OR quedan suprimidos. Estás corriendo efectivamente la lección 2 con ruido adicional en el registro de auditoría. Elige una estrategia por tenant.

**La elección de estrategia sigue el despliegue de Intune.** Un cliente nuevo típicamente empieza en la lección 2 (siempre-MFA) porque Intune aún no se ha desplegado. A medida que la cobertura de Intune crece, la señal de confianza-de-dispositivo se vuelve fiable, y el cliente está listo para graduarse a la plantilla de esta lección. La transición es en sí misma un hito en la madurez de seguridad del cliente.

## Lo que viene

- **Lección 6: Endurecer el acceso de admin.** Cuatro plantillas específicas de admin en una lección. La combinación de aplicación de MFA, MFA-para-portales, y controles de sesión.
- **Lección 7: Deshabilitar el flujo de código de dispositivo.** La defensa contra Storm-2372.

Por ahora: si un cliente tiene Intune funcionando, esta es la plantilla en la que debería estar. La migración desde la lección 2 es un ejercicio de dos semanas que se paga inmediatamente en UX del usuario y con el tiempo en horas de operador ahorradas (menos quejas de «el prompt MFA es tan molesto» de usuarios senior).

---

*Fuentes de los datos en esta lección — Microsoft Learn sobre controles de concesión de Acceso Condicional y semántica OR-vs-AND ([Microsoft Learn — Conditional Access: Grant](https://learn.microsoft.com/en-us/entra/identity/conditional-access/concept-conditional-access-grant)); cumplimiento de dispositivo de Intune y flujo de señal a AC ([Microsoft Learn — Device compliance for Conditional Access](https://learn.microsoft.com/en-us/mem/intune/protect/conditional-access)); resumen de Hybrid Azure AD join ([Microsoft Learn — Hybrid Azure AD join](https://learn.microsoft.com/en-us/entra/identity/devices/concept-hybrid-join)).*
