---
title: "Reenvío automático y reglas de bandeja de entrada — el par de indicadores post-compromiso"
subtitle: "Cómo los atacantes usan el reenvío automático y reglas ocultas para persistir tras el compromiso — y los controles de transporte que los detienen."
icon: "forward"
last_updated: 2026-05-29
---

# Reenvío automático y reglas de bandeja de entrada — el par de indicadores post-compromiso

El contable de un cliente llama en pánico un martes por la mañana. «Mi contacto en nuestro proveedor acaba de llamar. Me dijo que respondió a mi correo sobre la transferencia de la semana pasada y nunca recibió respuesta, luego envió dos seguimientos y al final llamó. Yo nunca recibí ninguno de sus correos. Yo nunca le envié ningún correo de transferencia. Él está viendo tres mensajes en su carpeta de enviados a mi nombre».

Te conectas al buzón del contable. En Outlook web, miras las reglas. Hay una que tú no creaste:

- **Nombre de regla:** `.` (un único punto)
- **Condición:** el asunto contiene «transferencia» o «pago» o «proveedor» o «remesa»
- **Acción:** mover a la carpeta `Fuentes RSS`; marcar como leído; eliminar

Miras los ajustes de reenvío. No configurado. Miras el Registro de Auditoría Unificado. La regla se creó a las 3:42 de la madrugada del miércoles anterior desde una IP en un país que el contable nunca ha visitado, usando una sesión que autenticó con éxito — lo que significa que o bien el atacante tenía una cookie de sesión robada (AiTM) o había hecho phishing previamente de la credencial y usó algún método que saltó MFA de alguna manera.

El atacante ha estado leyendo el correo del contable durante seis días. Envió tres instrucciones de transferencia al proveedor, interceptó las respuestas del proveedor (la regla las movió a Fuentes RSS y las marcó como leídas) y cosechó al menos una transferencia exitosa de 52 000 $. El contable no vio una sola traza entrante ni saliente del ataque.

Este es el escenario de libro de texto post-compromiso de correo, y se apoya en dos cosas que casi cada atacante hace tras tomar un buzón:

1. **Reglas de bandeja de entrada** para ocultar la actividad del usuario legítimo.
2. **Reenvío automático** (a veces) para asegurarse de que el atacante recibe una copia de cada mensaje entrante sin tener que mantenerse conectado continuamente a la cuenta comprometida.

Esta lección trata de cerrar ambos vectores, los límites de lo que es posible cerrar y lo que te dan las superficies de monitorización de Panoptica365.

## Dos controles distintos, dos historias diferentes

Los operadores confunden «reenvío» y «reglas de bandeja de entrada» porque se ven similares en la interfaz de usuario. Son diferentes, y necesitan controles diferentes.

**El reenvío automático a dominios externos** es una funcionalidad a nivel de buzón (o a nivel de tenant) que copia cada mensaje entrante a una dirección de correo externa. Configurable en los ajustes del buzón o vía una regla de bandeja de entrada con una acción de «reenviar a». Microsoft endureció el comportamiento por defecto en 2020 — los tenants nuevos bloquean el reenvío automático externo por defecto. Los tenants más antiguos, y los tenants donde administradores anteriores permitieron explícitamente el reenvío por alguna razón, aún pueden tenerlo habilitado.

**Las reglas de bandeja de entrada** son filtros a nivel de usuario que actúan sobre el correo entrante: mover, eliminar, marcar como leído, marcar como importante, reenviar, redirigir, asignar categorías, ejecutar scripts (en clientes heredados), etc. Los usuarios las crean legítimamente por razones organizativas todo el tiempo. Los atacantes las crean post-compromiso para ocultar sus pasos.

El reenvío automático es la señal más ruidosa — más fácil de bloquear a nivel tenant, más fácil de detectar, más difícil de usar para los atacantes sin que los pillen. Las reglas de bandeja de entrada son la señal más sutil — imposibles de bloquear (los usuarios legítimos las necesitan), solo detectables vigilando patrones anómalos.

## Reenvío automático — el bloqueo a nivel tenant

La superficie de control a conocer es **Remote Domains** en el centro de administración de Exchange (Mail flow → Remote Domains; PowerShell: `Set-RemoteDomain Default -AutoForwardEnabled $false`). Cada entrada de Remote Domain define el comportamiento del flujo de correo para los mensajes que salen de tu tenant hacia un dominio externo específico. La entrada **Default** es la cláusula general — cada dominio externo que no hayas configurado explícitamente cae bajo sus reglas. Poner la propiedad de reenvío automático de Default a **deshabilitada** bloquea el reenvío automático externo a nivel tenant excepto para dominios que hayas permitido explícitamente vía entradas Remote Domain por dominio (cubierto en «Qué se puede romper» abajo).

El ajuste de seguridad de Panoptica365 «Disable Automatic Forwarding to External Domains» opera exactamente aquí: empuja la Default Remote Domain a AutoForwardEnabled=$false en el tenant del cliente y vigila ese valor para detectar deriva. Que alguien abra el centro de administración de Exchange y lo vuelva a poner habilitado — típicamente en respuesta a un ticket del cliente del tipo «mi usuario ya no puede reenviar su correo de trabajo a su Gmail personal» — dispara una alerta de deriva. Reviertes (o, si hay una necesidad de negocio genuina, aplicas el flujo de excepción por dominio de abajo) y hablas con el cliente sobre por qué existe el bloqueo.

Microsoft expone un control relacionado pero separado en la **política de spam saliente** (portal de Defender → Threat policies → Anti-spam → Outbound spam) — tres valores, Automatic / On / Off, controlando la política de reenvío automático a nivel de política. Algunos MSPs usan esto como cinturón y tirantes junto al bloqueo de Default Remote Domain. Panoptica365 hoy no opera ni monitoriza esta superficie; la Default Remote Domain es el control canónico para este ajuste de seguridad.

**Una excepción a conocer:** las reglas de flujo de correo (transport rules) que redirigen o ponen BCC del correo a direcciones externas *no* son reenvío automático desde la perspectiva de este control. Tienen sus propios ajustes y su propia monitorización. La lección 8 cubre las reglas de flujo de correo; por ahora, sabe que los controles de reenvío automático no pillan el reenvío basado en transport rules.

## Reglas de bandeja de entrada — por qué no se pueden deshabilitar

Los usuarios necesitan reglas de bandeja de entrada. El contable de la historia inicial tiene media docena de legítimas — filtrar boletines a una carpeta, marcar los correos de su jefe como importantes, autocategorizar correos de clientes por proyecto. Las reglas de bandeja de entrada son parte de cómo funciona el correo como herramienta de productividad.

No hay control a nivel tenant para deshabilitar las reglas de bandeja de entrada. No puede haberlo — deshabilitarlas rompería el caso de uso legítimo de productividad.

Lo que *sí* hay:

- **Entradas del Registro de Auditoría Unificado** cuando se crean, modifican o eliminan reglas de bandeja de entrada. Los nombres de operación incluyen `New-InboxRule`, `Set-InboxRule`, `Remove-InboxRule` y `UpdateInboxRules` (para la gestión de reglas del Outlook de escritorio).
- **Alertas de Microsoft Defender** cuando una regla de bandeja de entrada coincide con patrones sospechosos. El ML de Microsoft marca reglas que parecen comportamiento de atacante — nombres de un solo carácter, acciones de redirigir a externos, filtros sobre palabras clave de finanzas, combinaciones de eliminar-y-marcar-como-leído.
- **Enumeración por buzón** vía `Get-InboxRule -Mailbox usuario@dominio.com` en Exchange Online PowerShell. Los operadores pueden correr esto manualmente; Panoptica365 lo expone para todo el tenant.

La postura defensiva para las reglas de bandeja de entrada es **detección, no prevención**. No puedes impedir a los usuarios crear reglas. Puedes monitorizar las reglas que crean los atacantes.

## Los patrones de regla de atacante que vigilar

Después de una década de investigaciones BEC en M365, las mismas formas de regla aparecen en miles de incidentes. Entrénate a ti mismo y a tu equipo de operadores para detectarlas.

**El nombre de un solo carácter.** Reglas llamadas `.` (punto), `,` (coma), `..` (dos puntos), ` ` (un solo espacio), o un carácter Unicode de ancho cero. El atacante no quiere que el usuario note que la regla existe en su lista de reglas. Cuanto más corto y raro el nombre, mayor la sospecha.

**El filtro por palabra clave en términos financieros.** Condiciones que comprueban `transferencia`, `pago`, `remesa`, `factura`, `cuenta`, `banco`, `proveedor`, `vendor`, además de los nombres de personas específicas en la cadena financiera (director financiero, interventora, contabilidad). Combinado con una acción de ocultar al usuario, esta es la regla complementaria del BEC.

**La combinación de ocultar.** Acciones que mueven mensajes a carpetas oscuras (`Fuentes RSS`, `Correo no deseado`, `Historial de conversación`, `Notas`, `Problemas de sincronización`), los marcan como leídos y/o los eliminan. Las reglas legítimas raramente combinan «mover a carpeta oscura» con «marcar como leído» con «eliminar a los pocos días». Las reglas de atacante sí.

**La redirección externa.** Reglas de bandeja de entrada con una acción «reenviar a» o «redirigir a» donde el destino es una dirección de correo externa. Esto es reenvío automático vía regla de bandeja de entrada, y el bloqueo de Default Remote Domain de arriba mayoritariamente lo pilla. Pero algunos atacantes usan redirigir-con-modificación (p. ej., redirigir vía una regla de flujo de correo) para evadir el bloqueo.

**La regla de «eliminar notificaciones de rebote».** Condiciones que coinciden con patrones de remitente típicos de Informes de No Entrega o asuntos como «No entregable» o «Fallo en la entrega del correo». El atacante está enviando correos de transferencia fraudulenta y no quiere que los rebotes lleguen al usuario legítimo.

**El supresor de respuestas del director general / la interventora.** Reglas que mueven los mensajes entrantes de remitentes específicos de alto valor (el director, el contacto primario del cliente, el director financiero) a carpetas oscuras. Usadas cuando el atacante ha secuestrado un hilo saliente y quiere evitar que el usuario legítimo vea las respuestas del destinatario.

Cuando cualquiera de estos patrones aparece en las reglas de buzón de un cliente y el usuario no puede explicarlo, trata el buzón como comprometido. Restablece credenciales, revoca sesiones, audita los enviados recientes, comprueba el Registro de Auditoría Unificado de los últimos 14 días y arranca un flujo apropiado de respuesta a incidentes.

## Qué ve Panoptica365

La monitorización de Reglas de Bandeja de Entrada es una de las superficies más útiles de Panoptica365 en el lado de Exchange. También es deliberadamente simple — solo la estructura justa para hacer las reglas escaneables, sin más ceremonia.

**El panel de Reglas de Bandeja de Entrada.** Un panel, dos secciones plegables:

- **Reglas de Reenvío (Reenviar o Redirigir Correo).** Una tabla plana mostrando cada regla en el tenant que reenvía o redirige correo. Columnas: Usuario, Nombre de regla, Destino (la dirección de destino), Tipo (EXTERNAL o Internal). Los destinos externos se marcan visualmente. La insignia de recuento en el encabezado de sección muestra el total. Esta es la vista de alta señal — cada fila merece un vistazo, porque el reenvío externo es raro en flujos legítimos y los destinos EXTERNAL son específicamente los que crean los atacantes.
- **Todas las Reglas de Bandeja de Entrada (Cada Regla Habilitada, Por Usuario).** Una tabla plana agrupada por dueño del buzón, mostrando cada regla de bandeja de entrada habilitada en el tenant. Columnas: Usuario, Nombre de regla, Acciones (una descripción corta como «Mover a carpeta · Detener procesamiento» o «FORWARD → external `dirección`»). La insignia de recuento muestra el total. Esta es la vista de desplazar-y-escanear — la mayoría de las filas son reglas mundanas de productividad, y lo que estás buscando son las sospechosas (nombres de un solo carácter, palabras clave financieras, combinaciones de ocultar).

No hay ordenación, ni filtrado, ni caja de búsqueda. El flujo es desplazarse por las listas con los ojos calibrados para los patrones de atacante de arriba. El compromiso que Panoptica365 hace aquí: en lugar de un explorador de datos cargado de funcionalidades que los operadores tendrían que aprender, es una lista legible simple optimizada para el escaneo a ojo humano.

**Deriva sobre el ajuste de seguridad «Disable Automatic Forwarding to External Domains».** Panoptica365 vigila la propiedad AutoForwardEnabled de la Default Remote Domain. Si alguien la cambia de deshabilitada a habilitada — típicamente vía la UI de Remote Domains del centro de administración de Exchange — el detector de deriva se dispara.

**Evaluadores de alertas basados en UAL.** El motor de alertas de Panoptica365 incluye evaluadores que vigilan el Registro de Auditoría Unificado para patrones sospechosos de creación de reglas de bandeja de entrada. Cuando hay una coincidencia, la alerta fluye por el pipeline estándar (panel, notificación por correo, atribución al cliente).

Lo que Panoptica365 *no* expone en el panel: el historial de reglas por buzón (cambios a lo largo del tiempo), el historial del estado de reenvío por buzón, los eventos UAL en crudo, ordenación/filtrado/búsqueda sobre las tablas de reglas de bandeja de entrada. Para trabajo forense más profundo, entra en la búsqueda del registro de auditoría del portal de Microsoft 365 Defender o en el centro de administración de Exchange.

## Qué se puede romper

**Reenvío legítimo a socios de negocio específicos.** Los flujos de negocio reales sí implican reenvío a dominios externos nombrados — un cliente enrutando correos relacionados con finanzas a la empresa de su contable externo, un cliente reenviando ciertas peticiones de soporte a un proveedor de terceros, un cliente espejando correo específico temático a la firma de un consultor. La disciplina no es debilitar el bloqueo a nivel tenant; es añadir una **excepción por dominio vía reglas de Remote Domain** en Exchange.

En el centro de administración de Exchange: Mail flow → Remote Domains. La entrada Default pilla todo lo que no hayas configurado explícitamente — deja su ajuste de reenvío automático apagado (esto es lo que empuja el ajuste de seguridad de Panoptica365). Luego crea una entrada Remote Domain específica para cada dominio externo donde el cliente tenga un flujo de reenvío documentado — `firma-contable.com`, `nombre-proveedor.com`, `consultora.com` — y habilita el reenvío automático solo para esos dominios nombrados.

Distinción crítica: las excepciones por dominio son para **dominios específicos nombrados de socios de negocio**, nunca para proveedores genéricos de consumidor. Un usuario que quiere reenviar su correo de trabajo a su Gmail / Hotmail / Outlook.com / Yahoo / iCloud personal es exactamente el caso que el bloqueo a nivel tenant existe para prevenir. Eso no es un flujo de negocio; es una conveniencia personal que pone datos corporativos en bandejas alcanzables por atacantes y rompe tanto la defensa BEC como la mayoría de las expectativas de residencia de datos. Enruta a esos usuarios a acceso delegado, un buzón compartido o iniciar sesión en su correo de trabajo en la app de Outlook del móvil — no una entrada de Remote Domain para gmail.com.

Misma disciplina que el patrón de remitentes de confianza de la lección 2: las excepciones por socio nombrado son manejables; las excepciones de dominio en bloque son tiros al pie.

**Reglas de bandeja de entrada útiles marcándose como sospechosas.** Un usuario crea una regla perfectamente legítima para limpiar el desorden de boletines, y el motor de alertas de Panoptica365 la marca porque coincide con un patrón genérico de «ocultar mensajes». Tría estos como harías con cualquier falso positivo: confirma la regla con el usuario, documéntala, sigue adelante. Con el tiempo, los evaluadores del motor de alertas se afinan a la normalidad del cliente.

**Flujos de correo heredados basados en conectores.** Algunos clientes tienen conectores heredados de Exchange Online que enrutan el correo por un gateway de terceros. Esos gateways ocasionalmente inyectan comportamiento parecido al reenvío. Auditar los conectores durante el chequeo previo (lección 1) pilla la mayor parte de esto; si un patrón de reenvío basado en conector aflora después, el arreglo está en el conector, no en el buzón.

## Lo que esto significa para el operador

Tres puntos para llevarte.

**Bloquea el reenvío automático externo a nivel tenant; haz excepciones por dominio donde se justifiquen.** Deshabilitar el reenvío automático en la Default Remote Domain es el control de mayor palanca sobre el radio de impacto post-compromiso. Cuando un cliente tenga una razón de negocio real para reenviar a un socio nombrado — contable, consultor, proveedor — añade una entrada Remote Domain por dominio para ese dominio externo específico. Cuando la petición sea reenviar a un proveedor de consumidor (gmail.com, hotmail.com, etc.), enruta al usuario a acceso delegado, un buzón compartido o iniciar sesión en su correo de trabajo en el móvil — no una excepción Remote Domain.

**No puedes deshabilitar las reglas de bandeja de entrada, solo vigilar los patrones de atacante.** Los nombres de un solo carácter, los filtros por palabra clave financiera, las combinaciones de ocultar — entrena a tu equipo de operadores para reconocerlos a primera vista. Cuando los ves, el buzón ya está comprometido; la velocidad de detección determina si contienes el ataque en 10 K $ o en 100 K $.

**El panel de Reglas de Bandeja de Entrada de Panoptica365 es la superficie diaria del operador.** Dos secciones (Reglas de Reenvío, Todas las Reglas de Bandeja de Entrada) en una vista. Escanéalas cuando un cliente reporte algo inusual (un correo perdido, una entrega denegada, un proveedor confuso). Los patrones son visibles si los miras. El coste de mirar es bajo. El coste de no mirar es el incidente de transferencia fraudulenta de la historia inicial.

## Lo que viene

- **Lección 6: Auditoría de buzón.** La postura estricta de auditoría de buzón, el ejemplo de deriva del nuevo buzón, y lo que la auditoría de buzón te da para forense post-incidente.
- **Lección 7: Políticas de cuarentena y liberación de usuario.** Quién puede liberar qué; el riesgo complementario al BEC del phishing autoliberado.

Por ahora: abre el panel de Reglas de Bandeja de Entrada del cliente en Panoptica365. Léete la lista. Busca los patrones. Si algo coincide, entra en el buzón en el centro de administración de Exchange, confirma con el usuario, y arranca el flujo de respuesta a incidentes si el usuario no puede explicarlo. El contable de la historia inicial habría perdido menos dinero si su MSP hubiera estado haciendo esto cada lunes por la mañana.

---

*Fuentes de los datos en esta lección — referencia de los ajustes de reenvío automático de Remote Domain ([Microsoft Learn — Set-RemoteDomain](https://learn.microsoft.com/en-us/powershell/module/exchange/set-remotedomain)); visión general del bloqueo del reenvío automático externo ([Microsoft Learn — External email forwarding](https://learn.microsoft.com/en-us/defender-office-365/outbound-spam-policies-external-email-forwarding)); controles de reenvío automático en la política de spam saliente (la superficie relacionada de Microsoft) ([Microsoft Learn — Outbound spam policies](https://learn.microsoft.com/en-us/defender-office-365/outbound-spam-policies-configure)); manipulación de reglas de bandeja de entrada como indicador post-compromiso ([Microsoft Learn — Detect and respond to suspicious inbox rules](https://learn.microsoft.com/en-us/defender-xdr/alert-grading-suspicious-inbox-manipulation-rules)); nombres de operación de reglas de bandeja de entrada en el Registro de Auditoría Unificado ([Microsoft Learn — UAL search](https://learn.microsoft.com/en-us/purview/audit-log-search)); tipo de recurso messageRules de Microsoft Graph ([Microsoft Learn — messageRules](https://learn.microsoft.com/en-us/graph/api/resources/messagerule)).*
