---
title: "Antes de tocar una plantilla — la lista de comprobación previa al despliegue de AC"
subtitle: "Cinco pasos previos a cualquier política de AC: break-glass, inventario de cuentas, solo informe y comunicación."
icon: "clipboard-check"
last_updated: 2026-05-29
---

# Antes de tocar una plantilla — la lista de comprobación previa al despliegue de AC

Un consultor en Calgary una vez activó una política de Acceso Condicional «Exigir MFA para todos los usuarios» un viernes a las 4 de la tarde. A las 4:15 de la tarde, las cuentas de servicio del cliente — las que corren la copia de seguridad nocturna, el mantenimiento de SQL, el procesador de facturas no atendido — todas estaban fallando la autenticación. Ninguna de ellas tenía MFA. El consultor no sabía que existían. El director de IT del cliente se enteró cuando el reporte de copias de seguridad del lunes por la mañana llegó mostrando cero trabajos exitosos durante el fin de semana.

El Acceso Condicional no perdona la prisa.

Esta lección no trata sobre ninguna plantilla específica de la biblioteca de Panoptica365. Es la lista de comprobación previa al despliegue que se ejecuta antes de que toques *cualquiera* de ellas. Cada plantilla en la tarjeta 3 — Exigir MFA, Bloquear Autenticación Heredada, la política geográfica, el conjunto de endurecimiento de admins — asume que has hecho las cinco cosas que vienen abajo. Sáltate el pre-despliegue y entregas un incidente de viernes por la tarde.

## Las cuatro partes de una política de AC (repaso)

La tarjeta 1 lección 3 ya cubrió el bucle de cumplimiento y la estructura de una política de AC. La versión muy corta:

- **Quién** — a qué usuarios o grupos se aplica la política (incluir / excluir).
- **Qué** — qué aplicaciones o acciones (Exchange, SharePoint, «todas las aplicaciones en la nube», gestión de Azure).
- **Condiciones** — contexto: estado del dispositivo, ubicación, riesgo del inicio de sesión, riesgo del usuario, aplicación cliente, plataforma.
- **Controles** — qué hacer cuando la política coincide: bloquear, exigir MFA, exigir dispositivo conforme, exigir Hybrid join, aplicar controles de sesión.

Cada plantilla de AC de Panoptica365 rellena esos cuatro campos con valores por defecto sensatos. El pre-despliegue es sobre adaptar los valores por defecto a la realidad de un cliente específico antes de que pongas la política en su estado activo.

## Cinco pasos previos al despliegue, en orden

### 1. Identifica la cuenta break-glass

Cada tenant de M365 debería tener al menos una (idealmente dos) cuentas break-glass — cuentas que existen con el único propósito de recuperar acceso administrativo si todas las demás cuentas de admin están comprometidas, expiradas, bloqueadas, o de otra forma inutilizables.

Las cuentas break-glass están **excluidas de cada política de Acceso Condicional que actives.** Su MFA no se aplica vía AC (todavía deberían tener MFA resistente al phishing inscrito — típicamente una llave FIDO2 guardada físicamente en un sobre sellado en dos ubicaciones separadas). No están bloqueadas por restricciones geográficas. No están sujetas a requisitos de dispositivo conforme.

La razón es estructural: si cada política de AC se aplica a cada cuenta y una política de AC sale mal, *nadie* puede iniciar sesión para arreglarla. La cuenta break-glass es el bote salvavidas.

Antes de tocar cualquier plantilla de AC:

- Confirma que el cliente tiene al menos una cuenta break-glass.
- Confirma que tiene MFA resistente al phishing inscrito (passkey, llave FIDO2, o similar).
- Confirma que está en la lista de exclusión de cada política de AC que estás a punto de desplegar.
- Confirma que las credenciales están almacenadas en algún sitio donde el equipo legítimo de respuesta a emergencias pueda acceder — y en algún sitio donde el ransomware no.

Si alguno de los cuatro falta, *detén el despliegue*. Arregla la historia del break-glass primero.

### 2. Inventariar las cuentas de servicio y las cargas de trabajo no atendidas

Las cuentas de servicio son la causa más común de incidentes de Acceso Condicional un viernes por la tarde. Típicamente se autentican por contraseña (sin MFA), a menudo desde una IP fija que puede o no estar en tus ubicaciones de confianza, a menudo usando protocolos heredados, y se rompen ruidosamente cuando una política que no fue diseñada para ellas se dispara sobre ellas.

Antes de activar cualquier política, saca la lista de cuentas de servicio en el tenant. Comprueba:

- Qué aplicaciones las usan (agentes de SQL Server, principales de servicio para escaneo-a-correo, autenticación de aplicaciones de negocio, etc.).
- Desde qué direcciones IP inician sesión.
- Si usan autenticación moderna o heredada.
- Qué permisos tienen.

Luego, por cada cuenta de servicio, decide:

- **Migrar a una identidad gestionada** si la aplicación lo soporta. Las aplicaciones modernas deberían usar principales de servicio con autenticación basada en certificado, no cuentas de usuario con contraseñas. Donde el cliente pueda costear la migración, esta es la respuesta correcta.
- **Excluir de las políticas de AC específicas** que de otra forma la romperían — típicamente Exigir MFA, Bloquear Auth Heredada, restricciones geográficas. Documenta la exclusión y la razón.
- **Planificar un fin de vida** para la cuenta de servicio si está atada a una app heredada que debería retirarse.

El sistema de exenciones de Panoptica365 soporta esto directamente: cada exclusión de política de AC puede llevar una justificación y una fecha de expiración. Cuando la exclusión expira, el operador recibe una alerta para revisarla. Así es como evitas el patrón de «acumulación de excepciones» de la lección 6 de la tarjeta 2 — las exclusiones nunca desaparecen en silencio.

### 3. Decide si necesitas una red de seguridad en modo solo informe

Las plantillas de Panoptica365 se despliegan en estado Habilitado por defecto. Cuando haces clic en Desplegar sobre una plantilla, la política se crea en el tenant del cliente y empieza a aplicarse inmediatamente.

Para la mayoría de los tenants de pequeña empresa, este es el comportamiento correcto. Los pasos de pre-despliegue de arriba (exclusión break-glass, inventario de cuentas de servicio, comunicación al usuario) cubren las preocupaciones típicas. Microsoft lleva años empujando a las aplicaciones a alejarse de los principales de servicio con nombre de usuario/contraseña — las aplicaciones modernas se espera que usen registros de aplicaciones / aplicaciones empresariales con autenticación basada en certificado o secreto de cliente — así que el modo de fallo «una app heredada se queda bloqueada» es más raro de lo que solía ser. La mayoría de los tenants que te encontrarás no tienen nada que se rompa en el momento en que una política de MFA o geo entra en vigor.

Si estás incorporando un cliente con infraestructura heredada significativa — aplicaciones de negocio más antiguas que aún usan principales de servicio con autenticación por nombre de usuario/contraseña, credenciales SMTP codificadas en scripts, automatizaciones personalizadas usando flujos de auth heredados, entornos maduros con años de integraciones acumuladas — el enfoque desplegar-en-caliente conlleva un riesgo real. La política puede empezar a bloquear inicios de sesión legítimos de inmediato, y las cuentas de servicio afectadas fallarán lo suficientemente ruidosamente como para perturbar el negocio del cliente.

Para esos tenants, el flujo de trabajo recomendado es:

1. Despliega la plantilla vía Panoptica365 (crea la política en estado Habilitado).
2. Abre inmediatamente el portal de Entra y cambia el estado de la política a **Solo informe**.
3. Ejecuta una ventana de solo informe de 3 a 7 días.
4. Saca el registro de inicios de sesión filtrado por el resultado de solo informe de esta política. Por cada coincidencia, clasifica: caso de uso legítimo que necesita una exclusión, o objetivo legítimo que necesita migración.
5. Arregla las exclusiones en Panoptica365 (para que la pista de auditoría capture la razón), moderniza las integraciones heredadas donde sea posible.
6. Cambia la política de vuelta a Habilitado en el portal de Entra.

El modo solo informe significa que Acceso Condicional evalúa la política en cada inicio de sesión relevante, registra lo que *habría* pasado si la política hubiera estado aplicada, pero no aplica nada de verdad. El inicio de sesión procede como si la política no existiera. Obtienes la telemetría sin la rotura.

**Cuándo saltarse el solo informe:** tenants de pequeña empresa sin infraestructura heredada significativa, una postura limpia de Intune, y un inventario pre-despliegue bien acotado. La mayoría de los despliegues de Panoptica365 encajan en este perfil.

**Cuándo usar el solo informe:** entornos grandes o complejos con integraciones heredadas sustanciales; endurecimiento post-incidente donde el cliente no puede tolerar ningún falso positivo; primer despliegue de una plantilla personalizada importada (la lección 8 cubre este caso específicamente). Algunas plantillas específicas en esta tarjeta — Bloquear Autenticación Heredada (lección 3), la migración de estrategia en la lección 5, y cualquier plantilla importada en la lección 8 — recomiendan solo informe sin importar el tamaño del tenant, porque sus modos de rotura son más difíciles de predecir solo a partir del inventario pre-despliegue. Cada lección lo señala.

Si no estás seguro, inclínate hacia el solo informe. El coste de fricción es de 3 a 7 días de un paso de revisión adicional. El coste de un despliegue en la dirección equivocada en un entorno complejo es una caída del cliente en un día laborable.

### 4. Comunicar a los usuarios afectados antes de la aplicación

El Acceso Condicional cambia la experiencia del usuario. Una política que exige MFA donde no la había sorprenderá al usuario. Una política que exige un dispositivo conforme bloquea el acceso desde un portátil personal. Una política geográfica puede pillar a un comercial en un viaje de negocios un martes.

Antes de la aplicación (durante la ventana de solo informe cuando se aplique):

- Envía un aviso a todo el tenant explicando qué cambia, qué verá el usuario, y qué hacer si se queda bloqueado.
- Informa al servicio de ayuda sobre qué alertas esperar y cómo se ve la resolución correcta.
- Identifica a cualquier usuario de alto impacto (ejecutivos, comerciales viajeros, contratistas) y contáctalos individualmente.
- Documenta el cambio en el registro de cambios del cliente (Panoptica365 lo registra automáticamente cuando despliegas desde la biblioteca de plantillas).

El objetivo es que cuando empiece la aplicación, cada usuario sepa qué esperar. Ningún usuario sorprendido = ningún ticket de pánico.

### 5. Sabe a qué se parece el éxito, y cómo monitorizarlo

Para cada política de AC que despliegues, deberías poder responder por adelantado:

- **¿Qué inicios de sesión debería coincidir esta política?** (Por ejemplo: «Todos los inicios de sesión sin MFA desde fuera del rango de IP de confianza».)
- **¿Qué inicios de sesión *no* debería coincidir?** (Por ejemplo: «El comercial en un viaje conocido con aprobación previa; cuentas de servicio en su IP estática».)
- **¿Cuál es el volumen diario esperado de coincidencias?** (Aproximadamente cero para un tenant sano; coincidencias no-cero significan o bien amenazas reales o mala configuración.)
- **¿Qué señales indican que la política está mal configurada?** (Pico súbito de usuarios legítimos siendo bloqueados; una integración que funcionaba antes empieza a fallar.)

El detector de deriva de AC de Panoptica365 cubre la parte de monitorización a largo plazo — te dice cuándo una política que desplegaste ayer se ve diferente hoy. Pero el operador todavía necesita definir qué significa «se ve bien» al momento del despliegue. Sin esa línea base, la detección de deriva es solo ruido.

## El trabajo de preparación de ubicaciones nombradas

Varias plantillas de Panoptica365 dependen de ubicaciones nombradas — la plantilla «Permitir acceso solo desde Canadá» y cualquier política geográfica personalizada importada de otro tenant. Antes de activar cualquiera de esas:

- Confirma que la ubicación nombrada en el tenant coincide con la geografía real del cliente. La plantilla por defecto de Panoptica365 viene con Canadá; el tenant de un cliente mexicano necesita que México esté definido como la ubicación de confianza en su lugar. La lección 8 cubre el flujo de personalización.
- Confirma que los rangos de IP en la ubicación nombrada están actualizados. Las IPs de oficina cambian. Las sucursales se mudan. No te fíes de una ubicación nombrada que no se haya verificado en los últimos 6 meses.
- Confirma que «IPs de confianza» no incluye ningún rango de IP que no sea realmente de confianza. Un error común es incluir el rango VPN de un proveedor o la oficina de una empresa matriz, ninguno de los cuales el MSP puede avalar.

## El trabajo de preparación de fortalezas de autenticación

Algunas de las políticas en la tarjeta 3 (específicamente las plantillas de endurecimiento de admin en la lección 6) usan fortalezas de autenticación — una característica de Acceso Condicional que te permite especificar *qué* método MFA debe usarse, no solo *que* debe usarse MFA. «MFA resistente al phishing» es la fortaleza de autenticación estándar de alto nivel; acepta llaves FIDO2, passkeys, y Windows Hello para Empresas y rechaza SMS, voz, y push de Authenticator.

Antes de activar una política basada en fortaleza de autenticación:

- Confirma que los usuarios afectados ya han inscrito el método más fuerte. Si exiges MFA resistente al phishing para los admins el martes y los admins todavía usan push de Authenticator, están bloqueados el martes.
- Usa la ventana de solo informe para verificar la inscripción. Si la política habría bloqueado a un admin durante solo informe porque no se inscribió, arregla la inscripción primero.
- Para los admins específicamente, planifica el despliegue en fases. Empieza con el equipo de operaciones de IT (pueden arreglarse a sí mismos si se quedan bloqueados). Luego expande a otros roles de admin.

## Lo que esto significa para el operador

Tres puntos para llevarte.

**El Acceso Condicional es la capa donde los errores son más visibles para los usuarios.** Una regla anti-phishing mal configurada descarta silenciosamente un correo; una política de AC mal configurada bloquea a un departamento. Trata cada despliegue como un evento de gestión de cambios. El inventario pre-despliegue es el ensayo típico para pequeña empresa; el cambio manual a solo informe en el portal de Entra es el ensayo para entornos complejos.

**La cuenta break-glass no es negociable.** Cada conversación con un cliente sobre Acceso Condicional empieza con «verifiquemos la historia del break-glass». Si no tienen una, el primer trabajo de AC que haces para ellos es crear una. Todo lo demás espera.

**Documenta las exclusiones con expiración.** El sistema de exenciones de Panoptica365 fue construido específicamente para hacer esto fácil. Úsalo. El coste de una exclusión que olvidaste es un año de alertas falso-positivas, una brecha de seguridad que alguien más no conoce, y un hallazgo de cumplimiento cuando llega el auditor.

## Lo que viene

El resto de la tarjeta 3 recorre cada plantilla de AC de Panoptica365 una por una. Cuando termines:

- **Lección 2: Exigir MFA para todos los usuarios** — el fundamento.
- **Lección 3: Bloquear autenticación heredada** — cerrando el bypass de auth básica.
- **Lección 4: Ubicación de confianza O dispositivo conforme** — la política geo inteligente.
- **Lección 5: Dispositivo conforme O híbrido O MFA** — la política OR de señales de confianza, y cómo se relaciona con la política de la lección 2 cuando ambas están activadas.
- **Lección 6: Endurecer el acceso de admin** — cuatro plantillas de admin en una lección.
- **Lección 7: Deshabilitar el flujo de código de dispositivo** — la defensa contra Storm-2372.
- **Lección 8: Importar tus propias plantillas de AC** — el flujo de personalización de Panoptica365.
- **Lección 9: Operar AC a escala** — deriva, exclusiones, ciclo de vida.

Cada una de esas lecciones asume que has hecho los cinco pasos de pre-despliegue de arriba. Las lecciones en sí no repiten la lista. Van directo a *qué hace cada plantilla y cómo desplegarla*. El pre-despliegue es el fundamento; las plantillas son la implementación.

Por ahora: lee las plantillas, pero no actives ninguna en un tenant de cliente hasta que hayas hecho el pre-despliegue para ese tenant específico. El Acceso Condicional es la única superficie de M365 donde «confía en los valores por defecto» puede dejar al cliente fuera de línea. El pre-despliegue es la inoculación.
