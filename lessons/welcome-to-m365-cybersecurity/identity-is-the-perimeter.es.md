---
title: "Por qué la identidad es el nuevo perímetro"
subtitle: "Cómo los atacantes evitan el firewall tomando prestadas credenciales — y por qué cada inicio de sesión es ahora tu frontera de seguridad."
icon: "scan-face"
last_updated: 2026-05-29
---

# Por qué la identidad es el nuevo perímetro

Son las 2:14 de la mañana. El teléfono de tu usuaria vibra — Microsoft Authenticator pide aprobar un inicio de sesión. Ella está medio dormida. Toca «Sí» para que las vibraciones paren.

Ocho horas más tarde, tu mesa de ayuda nota algo raro: todos los correos de facturas se están reenviando en silencio a una dirección de Gmail que nadie reconoce. Lleva pasando tres días.

Ese ataque empezó sin malware. Sin exploit. Sin que nadie atravesara un firewall. El atacante tenía su contraseña (la compró, probablemente, en un volcado de fuga de algún SaaS sin relación) y simplemente siguió haciendo vibrar su teléfono hasta que ella se rindió. Ese es todo el ataque. El «muro» alrededor de su empresa nunca entró en juego — porque el atacante nunca tuvo que escalarlo.

Bienvenido a la seguridad en 2026.

## El muro ya no está donde están los datos

Hace veinte años, la seguridad parecía un edificio. Tus datos vivían en un servidor dentro de un armario al final del pasillo. Para llegar a ellos, un atacante tenía que entrar físicamente al edificio, conectarse a la red, vencer al firewall, esquivar al antivirus y exfiltrar los datos — todo sin disparar ninguna alarma. A eso lo llamábamos «defensa en profundidad», y lo dibujábamos como círculos concéntricos. Los datos estaban en el centro. El firewall era el anillo exterior. La vida era simple. La vida también era una mentira, pero da igual.

Hoy, tus datos viven en M365. Tus usuarios acceden a ellos desde el wifi de un hotel en Lisboa, un teléfono en un partido de fútbol, un iPad sobre la encimera de la cocina y, ocasionalmente — *ocasionalmente* — una portátil gestionada en la red de la oficina. El firewall que rodea a la oficina hoy en día no protege prácticamente nada. Ya no hay un «adentro». Solo hay credenciales, sesiones y tokens.

Esto no es un eslogan. Es un organigrama. Microsoft, Google, Amazon, Cloudflare, tu banco y la Agencia Tributaria funcionan todos con el mismo modelo ahora. Lo que decide si una petición se permite no es *de dónde viene la petición*. Es *quién la hace*, *en qué dispositivo*, *qué intenta hacer* y *si hay algo raro en este momento*.

Ese conjunto de preguntas — quién, qué, dónde, cuándo, raro — es lo que queremos decir con «la identidad es el perímetro».

## El edificio de apartamentos, no el castillo

Olvídate de los castillos medievales. Cada artículo de seguridad de la historia ha usado la metáfora del castillo. La metáfora del castillo está agotada. La metáfora del castillo necesita jubilarse en una playa en alguna parte.

Piensa en un edificio de apartamentos.

En un edificio de apartamentos, la puerta principal es para todo el mundo. El portero no te pregunta si «vives ahí», porque docenas de desconocidos entran cada día — mensajeros de Amazon, el técnico del ascensor, tus suegros de visita, el personal de limpieza. Lo que importa es tu **llavero electrónico**.

El llavero abre tu piso, tu apartamento, el gimnasio y el estacionamiento. *No* abre los otros pisos, los otros apartamentos, la oficina del administrador ni la azotea. Si lo pierdes, recepción lo desactiva en su sistema, y deja de funcionar en todas partes al mismo tiempo. Si tu llavero de pronto intenta entrar al gimnasio a las 3 de la mañana después de haber sido usado en el estacionamiento 90 segundos antes de una forma físicamente imposible — eso es interesante. El sistema puede notarlo. El sistema puede decidir decir que no.

Ese es el modelo. El «muro» dejó de ser un muro hace mucho tiempo. El llavero lo es todo.

En términos de M365:

- **Entra ID** es la recepción. Lleva la lista maestra de quién tiene un llavero y de qué puede hacer cada llavero.
- **El MFA** es el hecho de que el llavero tenga un PIN que tienes que introducir — la prueba de que la persona que sostiene el llavero es la persona a la que se le emitió, y no alguien que lo encontró en la barra de un bar.
- **El Acceso Condicional** es el ordenador del edificio que dice «este llavero está intentando entrar a la piscina de la azotea desde un país en el que nunca ha estado, a las 3 de la mañana, en un dispositivo no gestionado — di que no».
- **Defender XDR** es el guardia de seguridad que mira las cámaras buscando *patrones* — tres llaveros distintos golpeando la misma puerta en cinco minutos, alguien probando todas las puertas del piso 14, ese tipo de cosa.
- **Intune** es la política que dice qué llaveros funcionan en qué dispositivos, y cómo deben verse esos dispositivos (bloqueados, cifrados, actualizados) antes de que se les permita pasar.

Cuando un vendedor en una feria comercial te dice «nosotros aseguramos tu perímetro», lo que realmente quiere decir — si está hablando de una pila moderna — es *tomamos decisiones en cada paso de llavero*. Eso es todo. Cualquiera que aún te esté vendiendo «el muro» te está vendiendo algo que protege un edificio vacío.

## El atacante de 2026 no rompe cosas; las toma prestadas

El cambio mental aquí importa porque los ataques han cambiado con él.

En 2010 el atacante intentaba forzar la entrada a tu servidor. En 2026 el atacante intenta *ser* tu usuario. Es un ataque más suave — sin kits de exploit, sin firma de malware, a veces sin carga útil — pero también es mucho más difícil de ver, porque desde el punto de vista del sistema parece simplemente un inicio de sesión.

Algunas formas específicas que toma esto en 2026:

**Credential stuffing.** El atacante compra una lista de pares correo/contraseña de alguna fuga (LinkedIn, Adobe, MyFitnessPal, escoge tu favorita — todas están a la venta por el precio de un café), y los prueba contra M365. Aproximadamente uno de cada cien funciona, porque la gente reutiliza contraseñas. Esa es toda la razón de existir del MFA. Microsoft ha declarado que activar MFA bloquea más del 99,9 % de estos ataques automatizados de compromiso de cuenta (Weinert, 2019, y el número solo se ha vuelto más exacto desde entonces).

**Fatiga de MFA.** Cuando el MFA está activado, el atacante compra la contraseña de todas formas y simplemente bombardea al usuario con avisos de Authenticator a media noche hasta que toca «Sí». Así fue exactamente como hackearon a Uber en 2022. Y sigue funcionando hoy. El «number matching» y el contexto adicional en la aplicación Authenticator ayudan. No lo resuelven.

**Phishing AiTM (adversary-in-the-middle, «adversario en el medio»).** Este es el grande de 2026. El atacante envía un correo de phishing con un enlace a una página de inicio de sesión falsa que *hace de proxy* de la página real de Microsoft en tiempo real. El usuario teclea su contraseña. La página falsa la envía a la Microsoft real. Microsoft devuelve el aviso de MFA. La página falsa se lo muestra al usuario. El usuario lo aprueba. Microsoft devuelve una **cookie de sesión**. La página falsa captura esa cookie. Ahora el atacante tiene una sesión perfectamente válida y totalmente autenticada por MFA — ya no necesita la contraseña ni el MFA, tiene el *token*. Para M365, *es* el usuario. Microsoft reportó un **aumento del 146 % en los ataques AiTM en 2024** (Microsoft Defender Threat Intelligence, 2025). Los kits de phishing que hacen esto — Evilginx, Muraena, Modlishka — son de código abierto y gratuitos.

**Phishing por consentimiento OAuth.** En lugar de robar una contraseña, el atacante le pide al usuario que dé su consentimiento a una aplicación maliciosa que solicita permisos del tipo «leer todo tu correo» o «enviar correos en tu nombre». El usuario hace clic en «Aceptar» sin leer el diálogo (porque nunca lee el diálogo), y ahora hay una aplicación de terceros con acceso persistente a su buzón, sin necesidad de contraseña, sin necesidad de MFA. Restablecer la contraseña del usuario no expulsa a la aplicación. Deshabilitar la cuenta tampoco siempre lo hace.

**Phishing por código de dispositivo.** El flujo de código de dispositivo de Microsoft existe para cosas como impresoras y televisores que no tienen teclado. Los atacantes abusan de él: generan un código de dispositivo, le envían al usuario un mensaje «introduce este código para verificarte», y el usuario — queriendo ser servicial — introduce el código. El atacante ahora tiene la sesión completa del usuario en su propia máquina.

Cada uno de estos ataques empieza y termina con una identidad. Ninguno toca el firewall.

Vamos a dedicar toda la siguiente tarjeta (*Amenazas de identidad y patrones de ataque*) a profundizar en cómo funciona cada uno de estos ataques en detalle y qué los detecta. Por ahora, el único punto que necesitas es: cuando decimos que la identidad es el perímetro, no lo decimos como pose estética. Queremos decir que el atacante ya no está entrando por la fuerza. Al atacante lo están dejando entrar. Tu trabajo es notarlo.

## Lo que esto significa cada día

La mayoría de los operadores con los que hemos trabajado intentan aprender esta pila de la manera equivocada: empiezan configurando algo. Abren el portal de Defender. Ven diecisiete pestañas. Eligen una. La configuran. Se sienten productivos.

Ese es, casi siempre, el lugar equivocado para empezar.

El lugar correcto para empezar es: *qué petición se ve sospechosa, y qué hace nuestro entorno al respecto?* Si puedes responder eso para un usuario, en un dispositivo, entiendes la pila. Si no puedes — ni el tenant de Defender más agresivamente configurado del mundo te va a salvar, porque nada dentro de él va a estar haciendo el trabajo que crees que está haciendo.

Algunas implicaciones concretas de «la identidad es el perímetro» para ti, el operador:

**Lo que estás protegiendo no es la portátil. Es la sesión.** Una vez que un usuario está conectado a M365, lo que tiene es una sesión — un fragmento de estado criptográfico que dice «esta persona tiene permiso para leer correo hasta las 16:00». Los atacantes modernos no intentan romper el MFA; intentan robar la sesión. Protegerla — con cosas como el requisito de dispositivo conforme en Acceso Condicional, la Protección de Token y la Evaluación de Acceso Continuo (CAE) — es todo el trabajo. Vamos a profundizar en todo esto en lecciones posteriores.

**El MFA por sí solo no basta.** Esto solía ser una opinión polémica. Ahora es consenso. El push de Microsoft Authenticator que les vienes diciendo a todos que usen es bueno — detiene la abrumadora mayoría de ataques tontos de credential stuffing — pero *no hace nada* contra un sitio de phishing AiTM que pasa el aviso al usuario en tiempo real. La protección real es el *MFA resistente al phishing*: passkeys, llaves FIDO2, Windows Hello para Empresas. Cubriremos hacia qué empujar a los clientes en la lección de Acceso Condicional.

**La señal «rara» importa tanto como las credenciales.** Tu trabajo no es solo «está bien la contraseña». Es «hay algo en este inicio de sesión que parezca inusual?». País distinto del que ha usado el usuario los últimos 30 días? Estado de cumplimiento cambiado? Dirección IP desde la que ayer se conectaron 600 cuentas comprometidas? Microsoft tiene todo esto. Acceso Condicional puede actuar sobre ello. Defender XDR lo señala. Nada de esto tiene que ver con el firewall.

**Las cuentas de servicio suelen ser lo peor protegido de tu entorno.** Los usuarios reales tienen MFA, tienen Acceso Condicional, tienen Defender for Endpoint en su portátil. Las cuentas de servicio a menudo tienen autenticación por contraseña sin MFA, permisos amplios y ninguna supervisión — porque alguien, en algún sitio, «no quería romper la integración». Los atacantes lo saben. Nosotros también.

**Tu trabajo es mitad configuración y mitad observación.** La mitad de configuración es donde se enfoca la mayoría de la documentación: elegir las políticas correctas de Acceso Condicional, poner las reglas correctas de cumplimiento de Intune, activar la Protección de Token. La mitad de observación es lo que realmente salva a los clientes: mirar una alerta y preguntarse «espera, por qué *este* usuario inició sesión desde *ese* país a *esa* hora?». Panoptica365 existe para hacer la mitad de observación manejable. La mitad de configuración sigue siendo tu responsabilidad.

## Lo que te tienes que llevar

Si solo recuerdas una cosa: la pregunta «está permitido esto?» ya no tiene una respuesta de sí o no. Tiene una respuesta que depende de *quién*, *qué*, *dónde*, *cuándo* y *qué tan raro se ve esto*. El trabajo de M365 es responder esa pregunta para cada petición. Tu trabajo, como operador, es asegurarte de que esté configurado para responderla bien — y de notar cuando sus respuestas dejen de verse correctas.

El resto de esta tarjeta traza el mapa del territorio:

- **Las cinco superficies que M365 asegura** — identidad, terminales, correo, colaboración, aplicaciones en la nube. Qué es cada una, a qué amenazas enfrenta cada una.
- **Defender, Intune, Acceso Condicional — cómo encajan de verdad** — el bucle de cumplimiento y dónde vive cada uno.
- **Defender XDR — qué es, qué no es** — XDR vs EDR vs SIEM, y por qué la mayoría de los MSP nunca abren el portal de Defender.
- **Licencias de Microsoft 365 — qué desbloquea qué** — porque la mitad de los controles de los que vamos a hablar están condicionados a SKUs específicos.
- **Dónde encaja Panoptica365 en este cuadro** — qué supervisamos, qué no tocamos y por qué no remediamos automáticamente.

Después de eso, la tarjeta 2 (*Amenazas de identidad y patrones de ataque*) profundiza en los ataques que esbozamos arriba. Luego nos metemos en los controles de verdad.

Por ahora: deja de pensar en muros. Empieza a pensar en llaveros.

---

*Fuentes de los datos en esta lección — Microsoft Identity Security Group sobre el bloqueo por MFA del 99,9 % de las compromisiones de cuenta automatizadas ([Weinert, agosto de 2019](https://techcommunity.microsoft.com/blog/microsoft-entra-blog/your-pa%24%24word-doesn%E2%80%99t-matter/731984)); Microsoft Defender Threat Intelligence reportando un alza del 146 % en ataques AiTM en 2024 ([Microsoft Security Blog](https://www.microsoft.com/en-us/security/blog/), 2025); panorama de los kits Evilginx / Muraena / Modlishka y referencia de detección: [Jeffrey Appel — AiTM/MFA phishing attacks in combination with new Microsoft protections, 2026 edition](https://jeffreyappel.nl/).*
