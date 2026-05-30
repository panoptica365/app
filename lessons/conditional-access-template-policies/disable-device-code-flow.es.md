---
title: "Deshabilitar el flujo de código de dispositivo — la defensa contra Storm-2372"
subtitle: "Cómo Storm-2372 usa el código de dispositivo para eludir MFA, y la política de AC que cierra ese vector de ataque."
icon: "smartphone"
last_updated: 2026-05-29
---

# Deshabilitar el flujo de código de dispositivo — la defensa contra Storm-2372

La lección 5 de la tarjeta 2 recorrió qué es el abuso del código de dispositivo, por qué evita MFA, y cómo Storm-2372 — un actor de amenazas alineado con Rusia — lo ha estado usando a escala contra gobiernos, ONGs, servicios de IT y otros objetivos desde agosto de 2024. La defensa en esa lección era una sola política de AC: bloquear el flujo de autenticación de código de dispositivo para usuarios que no lo necesitan.

Esta es esa política.

**Panoptica365 - Disable Device Code Flow.** Descripción: *Previene la explotación del flujo de código de dispositivo.* Concesión: Ninguna (bloquear). Usuarios: Todos los usuarios. Aplicaciones: Todas las aplicaciones en la nube.

Es una de las políticas de AC más baratas y de mayor palanca que puedes desplegar en un tenant de cliente. La mayoría de los tenants no tienen necesidad legítima del flujo de código de dispositivo. Bloquearlo no cuesta nada en esos tenants y cierra toda la superficie de ataque de Storm-2372.

Esta lección es el detalle operativo — qué hace la política, cuándo desplegarla, qué vigilar, cuándo se aplican las raras excepciones.

## Qué hace

La política usa la condición de **flujos de autenticación** del Acceso Condicional — una condición de AC relativamente reciente (preview hasta 2024, generalmente disponible en 2025) que te permite apuntar a inicios de sesión por *cómo* se autenticaron. Uno de los interruptores dentro de esa condición es «Flujo de código de dispositivo».

La política está configurada:

- **Condición de flujo de autenticación: Flujo de código de dispositivo.**
- **Concesión: Bloquear.**
- **Usuarios: Todos los usuarios.**
- **Aplicaciones: Todas las aplicaciones en la nube.**

Cualquier intento de inicio de sesión que use el flujo de código de dispositivo es rechazado directamente. El código de usuario que un atacante envió a la víctima vía WhatsApp / Teams / Signal no puede ser canjeado. El manual de Storm-2372 falla en el primer paso.

La mecánica de la lección 5 de la tarjeta 2 vale la pena repetirla en una frase: el phishing por código de dispositivo funciona porque el usuario completa MFA correctamente en la página real de Microsoft, pero el dispositivo que recibe el token resultante pertenece al atacante. Bloquear el flujo de código de dispositivo a nivel de política significa que el token nunca se emite, sin importar si el usuario completó MFA.

## Por qué «Todos los usuarios» es el predeterminado correcto

La mayoría de las políticas de AC se despliegan con un enmarcado reflexivo — grupos de usuarios específicos, apps específicas. Esta se despliega por defecto a «Todos los usuarios / Todas las apps en la nube» y eso es correcto.

La razón: el flujo de código de dispositivo es un *camino de autenticación legítimo de Microsoft*, pero es usado por un conjunto muy estrecho de clientes legítimos. Específicamente:

- Impresoras y dispositivos IoT haciendo escaneo-a-correo o similares — pero estos normalmente usan cuentas de servicio, no cuentas de usuario, y la cuenta de servicio a menudo tiene su propia política de AC dedicada.
- Microsoft Graph PowerShell o Microsoft 365 CLI cuando se ejecuta en una máquina que no tiene un navegador disponible — caso de uso estrecho, normalmente un desarrollador o admin haciendo trabajo de automatización.
- Apps de muestra de Microsoft viejas y tutoriales — raras en 2026, mayormente retiradas.

Para la gran mayoría de los usuarios en la gran mayoría de los tenants, el flujo de código de dispositivo no se usa legítimamente. Las pocas excepciones (cuentas de servicio específicas, escenarios específicos de desarrollador) se excluyen por nombre en lugar de recortando ampliamente poblaciones de usuarios.

Un tenant con cero casos de uso documentados de código de dispositivo debería bloquear el flujo para todos los usuarios. Un tenant con uno o dos casos de uso documentados debería bloquear para todos los usuarios *excepto* las cuentas de servicio específicas que lo necesitan. No hay escenario donde «flujo de código de dispositivo abierto para todos» sea el ajuste correcto en 2026.

## Qué puede romperse — y cómo manejarlo

La rotura más común cuando esta política está activada:

**Automatización PowerShell multi-tenant.** Un MSP que usa Microsoft Graph PowerShell para gestionar múltiples tenants de clientes a menudo ejecuta scripts que se autentican vía código de dispositivo. El script muestra un código, el operador lo introduce en un navegador, el script luego opera sobre el tenant del cliente. Si el tenant del cliente tiene el bloqueo de código de dispositivo activado, el script falla.

Arreglo: usar autenticación por principal de servicio (secreto de cliente o certificado) en lugar de código de dispositivo. Graph PowerShell moderno lo soporta. El script cambia de «inicio de sesión interactivo por código de dispositivo» a «inicio de sesión no interactivo por principal de servicio», lo cual es más seguro de todos modos porque no hay un paso de humano-en-el-bucle donde la ingeniería social pueda secuestrar el flujo.

**Tutoriales de muestra específicos de Microsoft.** La documentación de Microsoft a veces usa código de dispositivo como flujo de autenticación de ejemplo para los novatos. Seguir esos tutoriales contra un tenant con esta política activada fallará. El arreglo normalmente es usar el flujo de inicio de sesión interactivo en su lugar, que funciona a través de un navegador normal.

**Impresoras viejas y dispositivos IoT.** Algunos dispositivos multifunción heredados usan código de dispositivo para la configuración de escaneo-a-correo. Los dispositivos más nuevos se han movido a SMTP OAuth 2.0 con credenciales guardadas. Si tienes una impresora vieja que aún usa código de dispositivo, tienes una elección: excluir la cuenta de servicio de la impresora de esta política (con justificación documentada y fecha de retiro para reemplazo de la impresora), o reemplazar la impresora por un modelo moderno.

**Herramientas caseras del cliente.** Ocasionalmente un cliente tiene una herramienta construida en casa que se autentica vía código de dispositivo. Misma respuesta que para impresoras: excluir la cuenta específica con documentación, o migrar la herramienta a autenticación por principal de servicio.

El patrón en cada caso: la excepción es *una cuenta específica en un caso de uso específico*. Las exclusiones amplias como «excluir al departamento de IT» son el movimiento equivocado. El departamento de IT no necesita código de dispositivo como clase.

## Despliegue

Despliegue más corto de la tarjeta porque la superficie de uso legítimo es pequeña. El inventario pre-despliegue es el ensayo.

Inventario pre-despliegue: comprueba el registro de inicios de sesión de Entra de los últimos 30 días, filtrado por `authenticationProtocol == "deviceCode"`. Lista cada cuenta que haya usado con éxito el código de dispositivo. Para la mayoría de los clientes, esta lista será muy corta o vacía.

Para cada coincidencia del pre-despliegue:

- Caso de uso legítimo (cuenta de servicio, automatización documentada) → añade a la lista de exclusión de la política con una fecha de retiro *antes* del despliegue.
- Usuario inesperado → indicador potencial de compromiso (un atacante puede ya estar haciendo phishing de código de dispositivo a este usuario). Investiga inmediatamente, *antes* de desplegar esta política.

Una vez que el pre-despliegue esté completo, despliega. La plantilla se habilita en estado Habilitado — típicamente con cero impacto en usuarios legítimos porque casi nadie en un tenant de pequeña empresa usa el código de dispositivo legítimamente. Monitoriza las primeras 48 horas para cualquier usuario inesperado bloqueado por la política. O te perdiste algo en el pre-despliegue (raro pero posible), o un atacante acaba de ser frustrado (la política está funcionando).

Para tenants más grandes o más complejos con múltiples casos de uso documentados de código de dispositivo, el paso manual de solo informe en el portal de Entra puede usarse como precaución extra — pero para la mayoría de los tenants, el inventario pre-despliegue es suficiente y el enfoque de despliegue-en-caliente es apropiado.

## Qué monitorizar después de la aplicación

El widget de Actividad Diaria mostrará bloqueos de AC en esta política. En un tenant sano, el volumen debería ser:

- **Cercano a cero** en régimen permanente. Los usuarios reales en dispositivos reales no usan código de dispositivo, así que no disparan la política.
- **Picos ocasionales** cuando un atacante sondea — típicamente campañas estilo Storm-2372 que intentan iniciar un flujo de código de dispositivo en el tenant. Cada pico es una *defensa exitosa* — la política está haciendo su trabajo.

Lo que específicamente quieres ver si Storm-2372 alguna vez apunta a un cliente:

1. **Una ráfaga de inicios de sesión fallidos** con `authenticationProtocol == "deviceCode"` — la iniciación automatizada de código de dispositivo del atacante golpeando la política.
2. **Ningún inicio de sesión exitoso por código de dispositivo** — la política está bloqueando el abuso intentado antes de que pueda completarse.
3. **Ningún nuevo registro de dispositivo** en el registro de auditoría siguiendo a los intentos fallidos.

El tercer punto importa específicamente por la evolución de Storm-2372 de febrero de 2025: el atacante intenta registrar su propia máquina en Entra ID usando el token adquirido por código de dispositivo. Si el flujo de código de dispositivo fue bloqueado, ningún token fue emitido, y ningún registro de dispositivo sigue. Toda la cadena de ataque se detiene en el primer paso.

Si alguna vez ves inicios de sesión exitosos por código de dispositivo en un tenant donde se supone que esta política está activada, eso es una alerta que vale la pena investigar inmediatamente — o la política fue deshabilitada (deriva) o una exclusión es demasiado amplia (mala configuración). Ambas son urgentes.

## Qué ve Panoptica365

Dos categorías principales de señales:

**Intentos sospechosos de inicio de sesión por código de dispositivo (fallidos o exitosos).** El pipeline de ingesta de UAL de Panoptica365 incluye evaluadores que buscan actividad de código de dispositivo. Cuando la política está activada y funcionando, deberías ver intentos fallidos (la política los bloqueó) y muy pocos o ningún intento exitoso. Un inicio de sesión exitoso por código de dispositivo a una cuenta inesperada vale la pena investigarlo.

**Nuevo dispositivo registrado.** Cuando un atacante completa con éxito el ataque evolucionado de Storm-2372 (la variante del Microsoft Authentication Broker de febrero de 2025), el siguiente paso es registrar su máquina como un dispositivo en el tenant. Panoptica365 alerta sobre eventos de nuevo registro de dispositivo. Cruza con la actividad de inicio de sesión — ¿hubo un inicio de sesión reciente por código de dispositivo para este usuario antes de que el dispositivo se registrara? Esa es la cadena de ataque.

El dónut de Actividad Diaria también saca los bloqueos de AC en casi-tiempo-real, incluyendo los bloqueos en esta política.

## La conversación con el cliente

Cuando propones activar esta política en un tenant de cliente, la pregunta típica del cliente es «¿qué rompe esto?». La respuesta honesta es «casi nada, porque casi nada usa legítimamente el código de dispositivo en tu entorno». El inventario pre-despliegue te lo dirá con certeza — y si hay uno o dos casos de uso legítimos, excluyes esas cuentas y procedes.

El pitch:

- La amenaza Storm-2372 es real, documentada, en curso.
- La propia Microsoft ha recomendado bloquear el código de dispositivo para tenants sin casos de uso documentados desde febrero de 2025.
- La política se habilita primero en solo informe, así que puedes verificar que nada se rompa antes de aplicarla.
- El coste es esencialmente cero (sin fricción para usuarios normales; exclusiones específicas para cualquier automatización legítima).

Para tenants en sectores objetivo (gobierno, ONGs, servicios IT, defensa, telecomunicaciones, salud, educación superior, energía — la lista de objetivos de Storm-2372), esta política es especialmente recomendable. Para otros sectores, sigue siendo recomendable; el objetivo del actor puede cambiar, y la política es lo bastante barata para que se aplique la defensa en profundidad.

## Lo que esto significa para el operador

Tres puntos para llevarte.

**Añade esto a la lista de comprobación de incorporación de clientes nuevos.** De todas las plantillas de AC en la tarjeta 3, esta tiene la mayor relación impacto-esfuerzo para la mayoría de los tenants. Despliegue de tres días, fricción de usuario cercana a cero, defensa completa contra una amenaza sofisticada identificada.

**Vigila el registro de inicios de sesión por uso legítimo de código de dispositivo como línea base.** Si encuentras un tenant donde el código de dispositivo se está usando por algo que no esperabas, es interesante — podría ser legítimo (un script olvidado) o podría ser un compromiso parcial existente. De cualquier modo, investiga antes de desplegar la política.

**Esta política no reemplaza a las otras.** Está estrechamente acotada — solo el flujo de código de dispositivo. El resto de la biblioteca de AC (aplicación de MFA, restricciones geográficas, endurecimiento de admin) sigue siendo necesario. Esta política cierra un vector de ataque específico que las políticas más amplias no abordan.

## Lo que viene

- **Lección 8: Importar tus propias plantillas de AC.** Cómo tomar una política de AC personalizada de un tenant y convertirla en una plantilla de Panoptica365 que se despliegue por la base de clientes del MSP. La generalización de ubicaciones nombradas que hace que las plantillas sean portables.
- **Lección 9: Operar AC a escala.** El cierre meta sobre deriva, exclusiones, y ciclo de vida.

Por ahora: despliega esta política en cada tenant de cliente que no tenga un requisito documentado de código de dispositivo. El riesgo del cliente contra la amenaza Storm-2372 pasa de «expuesto» a «cubierto» con tres días de trabajo y fricción cercana a cero. No hay muchas otras políticas de AC con ese ROI.

---

*Fuentes de los datos en esta lección — Microsoft Security Blog sobre la campaña de phishing por código de dispositivo de Storm-2372 ([Microsoft Security Blog — Storm-2372 conducts device code phishing campaign, febrero de 2025](https://www.microsoft.com/en-us/security/blog/2025/02/13/storm-2372-conducts-device-code-phishing-campaign/)); condición de flujos de autenticación de Acceso Condicional ([Microsoft Learn — Conditional Access: Authentication flows](https://learn.microsoft.com/en-us/entra/identity/conditional-access/concept-conditional-access-cloud-apps#authentication-flows)); referencia técnica del flujo de autorización de dispositivo OAuth 2.0 ([Microsoft Learn — OAuth 2.0 device code flow](https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-device-code)).*
