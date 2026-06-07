---
title: "Compromiso del correo de empresa — lo que los atacantes hacen de verdad una vez que están dentro"
subtitle: "BEC convierte el acceso al buzón en fraude por transferencia bancaria — 2770 M$ perdidos solo en 2024; todos los demás ataques existen para habilitarlo."
icon: "mail-warning"
last_updated: 2026-05-29
---

# Compromiso del correo de empresa — lo que los atacantes hacen de verdad una vez que están dentro

La empleada de cuentas por pagar de una firma de construcción recibe un correo del proveedor habitual de la firma en Quebec: «Hola Susan, por favor toma nota de que nuestros datos bancarios han cambiado. Nueva información ACH adjunta. Por favor actualiza por tu lado para la próxima factura.» El correo viene de la dirección real del proveedor. La gramática es buena. Hay un correo de seguimiento dos días más tarde preguntando el estado de la próxima factura. Susan actualiza los datos bancarios y procesa el pago de 187 000 $.

El proveedor nunca envió ese correo. Su buzón había sido comprometido seis semanas antes a través de una campaña de phishing AiTM. El atacante había estado leyendo el correo del proveedor durante más de un mes, esperando que llegara el siguiente ciclo de facturas de la firma de construcción. El atacante envió el mensaje de cambio bancario desde dentro de la propia carpeta de enviados del proveedor, lo eliminó de elementos enviados inmediatamente, y enrutó todo el correo de respuesta de la firma de construcción a una carpeta oculta del buzón de modo que el proveedor nunca vio la conversación produciéndose en su nombre.

Eso es el compromiso del correo de empresa, y según el Internet Crime Complaint Center del FBI, costó a las empresas estadounidenses **2,77 mil millones de dólares solo en 2024**, a través de 21 442 incidentes reportados. Pérdidas totales BEC 2022–2024: casi **8,5 mil millones de dólares**. El número real es mayor — la mayoría de los incidentes BEC no se reportan porque las víctimas están avergonzadas y las aseguradoras no pagan sin prueba.

Cada otro ataque en esta tarjeta — credential stuffing, fatiga de MFA, AiTM, consentimiento OAuth, abuso del código de dispositivo — existe principalmente *para habilitar BEC*. BEC es el día de cobro. Sin BEC al final, nada del resto vale el tiempo del atacante.

Esta lección trata sobre qué aspecto tiene BEC realmente dentro de un buzón comprometido, cómo los atacantes se quedan callados durante semanas, qué señales específicas vigilar, y por qué «regla de buzón rara» importa más que «inicio de sesión raro» una vez que el compromiso ha ocurrido.

## La forma económica de BEC

BEC funciona porque convierte el compromiso de identidad en transferencias bancarias. La cadena de ataque se ve así:

1. **Compromiso inicial** de la identidad M365 de un usuario, vía cualquiera de los métodos de las lecciones 1–5.
2. **Reconocimiento** dentro del buzón: a quién paga este usuario, quién le paga, cuál es el ciclo de facturas, quién tiene autoridad sobre las transferencias bancarias, dónde se almacenan los datos bancarios.
3. **Manipulación silenciosa**: crear reglas ocultas de bandeja de entrada, configurar reenvío, a veces registrar un dominio homoglifo que se parece al dominio real de un proveedor (`d̲i̲enamex.com` vs `dienamex.com` — `i` distintas).
4. **Golpe**: típicamente el momento en que una factura real está en curso, el atacante inyecta un cambio fraudulento de datos bancarios. Las partes legítimas nunca ven el correo de la otra porque las reglas lo suprimen.
5. **Cobro**: el dinero se mueve a una cuenta bancaria controlada por el atacante, a menudo en cadena a través de mulas de dinero.
6. **Limpieza**: las reglas se quitan, el correo se elimina, el atacante a menudo retiene el acceso para campañas de seguimiento.

El ciclo completo desde el compromiso hasta el cobro puede ser de días, semanas, o meses. Los tiempos de permanencia más largos — seis meses o más — son habitualmente compromisos de asistente ejecutivo donde el atacante monitoriza pacientemente las comunicaciones del C-suite esperando el momento adecuado.

## Lo que un atacante hace en la primera hora tras el compromiso

Conocer el manual del atacante ayuda al operador a triajear más rápido cuando un compromiso es fresco. Aquí está la actividad típica de la primera hora, en orden:

**Hora 0, minuto 0–5: Verificar que el acceso funciona.** Iniciar sesión en el buzón vía web. Abrir Outlook. Leer algunos correos recientes. Confirmar que esto no es una trampa o un honeypot.

**Minutos 5–15: Reconocer el buzón.** Buscar en la bandeja de entrada términos como `transferencia`, `factura`, `pago`, `ACH`, `enrutamiento`, `banco`. Examinar contactos. Mirar el calendario del usuario para entender con quién se reúne. Leer hilos recientes con proveedores y clientes.

**Minutos 15–30: Configurar persistencia.** Tres patrones, a menudo en combinación:
- *Regla de bandeja de entrada*: reenviar todo el correo que coincida con «factura OR pago OR transferencia» a una carpeta oculta (por ejemplo, una carpeta llamada «Feeds RSS» que nadie abre). Moverlo de la bandeja de entrada inmediatamente.
- *Reenviar a dirección externa*: copia de cada correo auto-reenviada a una dirección de Gmail o Proton controlada por el atacante.
- *Reenvío a nivel de buzón* (usando `Set-Mailbox -ForwardingSmtpAddress`): reenvía incluso cuando no existe regla de bandeja de entrada. Más difícil para el usuario de notar porque no está en la UI de reglas.

**Minutos 30–45: Registrar su propio método MFA.** Para no necesitar repetir el compromiso inicial. A menudo un número de teléfono bajo su control, a veces un autenticador de software que él controla. Esta es una de las señales más fiables de que un atacante está dentro.

**Minutos 45–60: Callarse.** Detener actividad activa. Esperar al tráfico natural del buzón. La configuración está en su sitio; el golpe ocurrirá después.

Al final de la hora 1, el atacante tiene *persistencia, reconocimiento, y control del canal*. El usuario no ha notado nada.

## Lo que un atacante hace durante las dos a seis semanas siguientes

Si el atacante es paciente (y los de alto valor siempre lo son), espera la oportunidad correcta. Durante esta ventana, él:

- Lee el correo a medida que llega vía las reglas de reenvío.
- Rastrea los ciclos de facturas — cuándo paga este cliente, cuál es el importe típico, quién lo aprueba, cuál es la redacción de los cambios bancarios legítimos normales.
- Identifica el objetivo más valioso. A veces el usuario comprometido *no es* el objetivo — es un punto de entrada hacia una relación más grande. El buzón de un empleado júnior puede ser valioso porque revela el horario del CFO.
- Prueba los límites. Envía pequeños correos experimentales (a veces borradores guardados y luego eliminados) para calibrar si alguien nota actividad inusual en la bandeja de salida.
- Configura dominios homoglifos para el golpe eventual. A veces compra certificados para que el dominio parezca creíble.

Cuando llega el golpe, a menudo es *un solo correo*. El pretexto está bien elaborado, el momento es exacto, la redacción coincide con el estilo normal del usuario legítimo (que el atacante lleva semanas estudiando). El usuario legítimo a menudo nunca ve el correo del golpe porque sus propias reglas lo enrutan a otro sitio.

## Qué se pilla y qué no

**Lo que la pila de Microsoft pilla bien:**

- Reenvío automático a nivel de buzón a direcciones externas (Exchange Online Protection lo bloquea por defecto en muchas configuraciones a partir de 2024).
- Enlaces de SharePoint compartidos anónimamente desde cuentas comprometidas a dominios externos.
- Registro súbito de nuevos métodos MFA (señal del registro de auditoría de Entra, pilable).
- Attack Disruption de Defender XDR para incidentes BEC de alta confianza (cuando se correlacionan con anomalías de inicio de sesión).

**Lo que es más difícil de pillar:**

- *Reglas ocultas de bandeja de entrada* que enrutan correo a carpetas oscuras dentro del buzón sin reenviar externamente. Desde la perspectiva de Exchange, esto es el usuario organizando su propio buzón. La regla existe en el estado del buzón pero no dispara alertas de regla-de-reenvío.
- *Correos de dominio homoglifo enviados a los contactos del usuario desde un buzón externo atacante*. Estos no se originan en la cuenta del usuario comprometido, así que la auditoría de buzón del usuario no los ve. El cliente del proveedor ve un correo «del proveedor» y actúa en consecuencia.
- *Las instrucciones fraudulentas reales de transferencia bancaria*. Para cuando el correo se envía, es simplemente un correo. El fraude se comete en la cuenta bancaria, no en el buzón.

Por eso la detección tiene que estar en capas a través de múltiples señales — patrón de inicio de sesión + actividad de reglas de bandeja de entrada + patrón de correo saliente + detección de anomalías post-pago.

## Señales específicas que vigilar

Una lista no exhaustiva de los patrones que, en combinación, casi siempre indican BEC:

**Regla de bandeja de entrada creada con una acción «reenviar a» o «mover a carpeta» donde la carpeta es oscura** (Feeds RSS, subcarpetas de Archivo, Notas). Especialmente si las condiciones de la regla incluyen palabras clave financieras. El patrón de regla es la firma BEC individual más fiable.

**Reenvío a nivel de buzón configurado** vía `Set-Mailbox -ForwardingSmtpAddress`. Esto requiere PowerShell o acceso al portal de administración — la mayoría de los usuarios legítimos no configuran esto ellos mismos. Panoptica365 monitoriza esto específicamente.

**Un nuevo método MFA registrado poco después de un inicio de sesión desde IP extranjera o de viaje imposible.** Señal fuerte de persistencia de atacante.

**Una ráfaga de correos salientes desde la cuenta comprometida a contactos financieros** (clientes, proveedores, bancos) a horas inusuales o con redacción inusual. La analítica del comportamiento del usuario de Defender for Cloud Apps pilla parte de esto; el resto requiere observación directa.

**Concesiones sospechosas de permisos de buzón** — particularmente `FullAccess` o `SendAs` concedidos a una cuenta desconocida. Los atacantes a veces se conceden a sí mismos acceso a buzones de *otros* usuarios vía los privilegios administrativos del usuario comprometido, si el usuario comprometido es un administrador.

**Búsquedas en el buzón por términos financieros** apareciendo en el registro de consultas de búsqueda. Defender for Cloud Apps puede sacar esto a la superficie; el Unified Audit Log captura los eventos `MailItemsAccessed` y `Search`.

**Correos de cambio de datos bancarios enviados al o desde el usuario que no coinciden con la redacción o el formato de las solicitudes históricas legítimas de cambio.** Este es el más difícil de automatizar; a menudo se pilla por revisión manual de una persona atenta del área de finanzas.

## Qué ve Panoptica365

Esta es la categoría de detección más profunda del catálogo de Panoptica365. Muchos de los evaluadores enfocados en EXO en Panoptica365 existen específicamente por BEC:

- **Cambios de reglas de bandeja de entrada**, incluyendo la creación de reglas con acciones sospechosas (mover a carpeta oscura, reenviar externamente, eliminar al recibir).
- **Reenvío a nivel de buzón configurado** — Panoptica365 monitoriza la propiedad `ForwardingSmtpAddress` en cada buzón y emite una alerta cuando aparece un destino de reenvío externo.
- **Concesiones de permisos de buzón** — cuando alguien obtiene FullAccess o SendAs en un buzón que no debería tener.
- **Estado del preset anti-phishing** — asegurándose de que las protecciones anti-phishing de Defender for Office 365 siguen activadas (los atacantes a veces las bajan si han ganado acceso administrativo).
- **Nuevo método MFA registrado** — la señal de persistencia post-compromiso.
- **Inicio de sesión exitoso desde IP extranjera** — el inicio de sesión aguas arriba que a menudo precede al BEC.
- **Incidentes BEC de Defender XDR** ingeridos desde la capa de correlación de Microsoft.

Cuando varias de estas se disparan en el mismo usuario dentro de la misma semana, trátalo como un compromiso confirmado y ejecuta el manual de respuesta de abajo.

## Manual de respuesta para BEC confirmado

Cuando has establecido que BEC está ocurriendo (o ha ocurrido), la limpieza está implicada. Los pasos de alto nivel:

**1. Aislar al usuario.** Revocar todas las sesiones, forzar restablecimiento de contraseña, deshabilitar cualquier método MFA nuevo añadido durante la ventana de compromiso. Si el usuario tiene privilegios administrativos y crees que se usaron, auditar y restablecer las asignaciones administrativas.

**2. Encontrar y eliminar las reglas.** Reglas de bandeja de entrada (`Get-InboxRule`), reenvío a nivel de buzón (`Get-Mailbox -ForwardingSmtpAddress`, `Set-Mailbox -ForwardingSmtpAddress $null`). Obtener el historial de reglas del Unified Audit Log si es necesario — a veces los atacantes crean y luego eliminan reglas para cubrir su rastro.

**3. Identificar a quién se le enviaron correos fraudulentos.** Sacar los elementos enviados del buzón de las últimas 4–8 semanas. El registro de auditoría mostrará correos que fueron enviados y luego eliminados. Busca correos a contactos financieros que parezcan solicitudes de cambio bancario o confirmaciones de pago de factura.

**4. Notificar a los destinatarios de los correos fraudulentos.** Esta es la parte que a nadie le gusta. Cualquiera que recibiera un correo del usuario comprometido durante el período de permanencia necesita saberlo — tanto porque pueden haber actuado en consecuencia (necesitan detener un pago, revertir una transferencia) como porque su propia cuenta puede ser la siguiente.

**5. Coordinar con el banco del cliente si una transferencia ya se ha movido.** La mayoría de los bancos pueden revertir transferencias bancarias si se reportan rápido (típicamente dentro de 72 horas). El IC3 del FBI también tiene un proceso de recuperación de transferencias para transferencias transfronterizas. La velocidad importa.

**6. Auditar otros usuarios en el mismo tenant.** Los atacantes a menudo pivotan desde la víctima inicial a otros usuarios (especialmente administradores). Comprueba patrones de inicio de sesión y reglas de bandeja de entrada para todos en el tenant.

**7. Documentar para el seguro cibernético.** La mayoría de las reclamaciones BEC requieren evidencia del vector de compromiso, la línea de tiempo, los controles que estaban en su sitio, y las acciones de respuesta. El registro de auditoría de Panoptica365 y el registro de cambios del tenant son útiles aquí. Mantén registros limpios.

**8. Informar al cliente sobre lo que cambió y lo que arreglar estructuralmente.** Esta es la parte que convierte un incidente en postura de seguridad mejorada. A menudo el problema subyacente es «sin MFA en el usuario comprometido» o «licencia de Business Standard así que no hay Acceso Condicional» — esas son conversaciones reales para las que el incidente BEC es ahora tu evidencia.

## Defenderse contra BEC estructuralmente

Las defensas para BEC son las defensas acumulativas de las lecciones 1–5, más algunas específicas de BEC:

**Bloquear el reenvío automático externo** a nivel de regla de transporte de Exchange. La mayoría de los tenants no necesitan que los usuarios reenvíen automáticamente al exterior; los tenants que sí lo necesitan pueden listar específicamente los casos de negocio. La postura por-defecto-desactivado elimina una de las técnicas de persistencia favoritas del atacante.

**Alertar sobre la creación de reglas de bandeja de entrada** que incluyan acciones de reenvío o de carpeta oculta. Panoptica365 saca esto a la superficie.

**Exigir aprobación de administrador para nuevas configuraciones de reenvío a nivel de buzón.** Los clientes con roles financieros sensibles deberían considerar evitarlo del todo.

**Entrenar específicamente al equipo de finanzas.** Los cambios de datos bancarios siempre deben verificarse fuera de banda — una llamada telefónica a un número en archivo, no a un número del correo. Este es uno de los pocos entrenamientos de seguridad que ha ahorrado dinero medible en incidentes reales.

**Aplicar Acceso Condicional para exigir MFA resistente al phishing para usuarios financieros de alto riesgo.** El mismo control que derrota a AiTM también derrota a la mayoría de los métodos de acceso inicial aguas arriba que llevan a BEC.

**Desplegar las políticas anti-phishing de Defender for Office 365 con protección contra suplantación de identidad.** Ayuda a pillar los correos de dominio homoglifo antes de que se entreguen.

**Monitorizar la retención del registro de auditoría del buzón.** Por defecto son 90 días; para clientes sensibles, extender a un año. Cuando BEC se descubre seis meses después del hecho, necesitarás el registro de auditoría más antiguo para reconstruir lo que pasó.

## Lo que esto significa para el operador

Cuatro puntos para llevarte.

**BEC es lo que hace que los ataques anteriores sean rentables.** Cada control defensivo de las lecciones 1–5 es, en efecto, una mitigación de BEC. Cuando recomiendas MFA resistente al phishing o AC de dispositivo conforme a un cliente, el discurso de ascensor es: «esto es lo que detiene el ataque silencioso de fraude por factura que ha costado a las empresas estadounidenses 8,5 mil millones de dólares en los últimos tres años».

**Las reglas de bandeja de entrada son la pista delatora de BEC.** Cuando aterriza una alerta de inicio de sesión desde IP extranjera, la siguiente comprobación inmediata son las reglas de bandeja de entrada del usuario. ¿Nueva regla con acciones «reenviar a» o «mover a Feeds RSS» sobre palabras clave financieras? Eso es una operación BEC activa. Abre el ticket con gravedad alta y empieza el manual.

**El «tiempo de permanencia de noventa días» es real.** Cuando descubres BEC, mira hacia atrás al menos tres meses en el registro de auditoría. El atacante a menudo ha estado callado durante semanas. Cualquier cosa que veas en los últimos 30 días es la punta; la extensión completa normalmente va más atrás.

**BEC es un problema de entrenamiento financiero tanto como un problema de tecnología de seguridad.** Los controles técnicos recortan la superficie de ataque; el control cultural («nunca aceptes un cambio bancario por correo; siempre verifica fuera de banda») recorta el impacto. Asegúrate de que tus interacciones con clientes incluyan la conversación con el equipo financiero, no solo la conversación con el equipo de IT.

## Lo que viene

- **Lección 7: Cuando el MSP es el objetivo.** El ataque en dirección inversa. Tus clientes dependen de ti; cualquier atacante que quiera sus datos también. El compromiso de la cadena de suministro de un MSP es una realidad de 2026 hacia la que ha conducido toda la tarjeta: cada ataque en esta lección, multiplicado por 30 o 100 si el atacante llega al MSP primero.

Por ahora: BEC es el cobro, la razón por la que todo lo demás existe, y la mayor categoría individual de pérdida por cibercrimen en los libros del FBI durante los últimos tres años consecutivos. El compromiso mismo es *el* problema de negocio del que estás protegiendo a los clientes. Trata cada alerta de esta tarjeta con el final BEC en mente.

---

*Fuentes de los datos en esta lección — datos de pérdidas BEC del IC3 del FBI 2024 ([FBI IC3 2024 Annual Report](https://www.ic3.gov/AnnualReport/Reports/2024_IC3Report.pdf)); cifra agregada de pérdidas BEC a tres años ([Nacha — IC3 finds $8.5B BEC losses](https://www.nacha.org/news/fbis-ic3-finds-almost-85-billion-lost-business-email-compromise-last-three-years)); Microsoft sobre el bloqueo del reenvío externo a nivel de buzón ([Microsoft Learn — Block external email auto-forwarding](https://learn.microsoft.com/en-us/defender-office-365/outbound-spam-policies-external-email-forwarding)); Attack Disruption relacionado con BEC de Defender XDR ([Microsoft Learn — Automatic attack disruption](https://learn.microsoft.com/en-us/defender-xdr/automatic-attack-disruption)); políticas anti-suplantación de Defender for Office 365 ([Microsoft Learn — Anti-phishing policies](https://learn.microsoft.com/en-us/defender-office-365/anti-phishing-policies-about)).*
