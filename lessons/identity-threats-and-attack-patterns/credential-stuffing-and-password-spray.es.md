---
title: "Credential stuffing y password spray — los ataques más tontos que aún funcionan"
subtitle: "Cómo los datos de fugas reciclados y los ataques de una contraseña contra muchas cuentas siguen comprometiendo M365."
icon: "key-round"
last_updated: 2026-05-29
---

# Credential stuffing y password spray — los ataques más tontos que aún funcionan

En algún lugar, en un canal de Telegram en este preciso momento, un atacante está pagando 4 $ por un archivo CSV que contiene 28 millones de pares de correo y contraseña recolectados de una fuga de Dropbox de 2012. No le importa que el archivo tenga catorce años. Ni siquiera le importa que el 95 % de las contraseñas ya se hayan cambiado. Va a meter los 28 millones de pares en un script que prueba cada uno contra `login.microsoftonline.com`, y en algún lugar de ahí, unos cientos seguirán funcionando — porque en algún lugar, unos cientos de personas usaron su contraseña de Dropbox como su contraseña de M365, nunca la cambiaron, y nunca activaron MFA.

Eso es el credential stuffing. Es el ataque más aburrido del catálogo, y en 2026 sigue siendo el punto de entrada para una parte significativa de las compromisiones de M365.

Esta lección trata de por qué los ataques tontos siguen funcionando, qué aspecto tienen en la telemetría de Microsoft, y dónde se gana el sueldo el MFA.

## Los dos sabores

Hay dos ataques en esta lección, y a menudo se confunden porque se parecen desde el lado de Microsoft.

**El credential stuffing** usa credenciales *reales* extraídas de fugas. El atacante tiene pares reales `correo → contraseña` de alguna parte (LinkedIn 2012, Adobe 2013, Yahoo 2014, MyFitnessPal 2018, LastPass 2022, elige un año). Aproximadamente una de cada cien todavía funciona en algún sitio sin relación, porque los humanos reutilizan contraseñas. El atacante pasa la lista contra M365, Gmail, bancos, y cualquier otro servicio que acepte un correo como nombre de usuario.

**El password spray** le da la vuelta. En lugar de *muchas* contraseñas contra *una* cuenta (lo que dispara el bloqueo), el atacante prueba *una* contraseña contra *muchas* cuentas. «Primavera2024!» contra 50 000 direcciones de correo, en una sola pasada lenta, a un ritmo bastante bajo para evadir los límites de tasa por cuenta. Aproximadamente el 0,5 % de esas cuentas estará usando «Primavera2024!» porque las contraseñas estacionales predecibles son un hábito que no se mata.

Ambos ataques comparten la misma característica definitoria: **el atacante está usando una contraseña que de verdad funciona en la cuenta.** Desde la perspectiva de Microsoft, esto es un *intento de inicio de sesión legítimo con las credenciales correctas*. La señal de que algo va mal tiene que venir *de algún sitio distinto a que la contraseña sea incorrecta* — que es todo el desafío de detectar esta clase de ataque.

## Cómo lo ve Microsoft

Microsoft ve un montón de estos. Cientos de millones de intentos al día, a través de todo el parque de Entra ID. Las mitigaciones que Microsoft superpone a nivel de plataforma significan que la mayoría de estos ataques fallan antes de generar siquiera una alerta en tu tenant. Tres capas de defensa están ahí por defecto:

**Smart Lockout.** Entra ID rastrea los intentos de inicio de sesión fallidos por cuenta y por IP. Si demasiados fallan demasiado rápido, la cuenta se bloquea brevemente o la IP se limita en velocidad. El atacante o ralentiza (vence el volumen) o se distribuye en muchas IPs (vence el límite por IP de Smart Lockout, pero ahora su botnet es una operación más cara).

**La lista de contraseñas prohibidas de Microsoft.** Entra ID tiene una lista integrada de malas contraseñas comunes («Password1», «Welcome2024», «Primavera2024!», unos pocos miles más). Si un usuario intenta poner una de esas, el cambio de contraseña se rechaza. Las listas personalizadas de contraseñas prohibidas permiten al MSP añadir cadenas específicas de la empresa («CustomerCo2024», el propio nombre de la empresa, etc.). Las listas personalizadas requieren Entra ID P1 (Business Premium o superior).

**Puntuación comportamental de riesgo** (solo P2). Entra ID Protection — disponible solo en E5 — puntúa cada inicio de sesión por riesgo. Un inicio de sesión desde un país nuevo, en una IP anonimizadora, con una contraseña que llegó de un vertido filtrado conocido, será marcado como alto riesgo y se puede bloquear o escalar para exigir MFA a través de Acceso Condicional.

La realidad honesta es esta: en Business Premium o por debajo, tu defensa contra el credential stuffing es **MFA, Smart Lockout y la lista de contraseñas prohibidas.** Eso es todo. En E5 también obtienes AC basado en riesgo. La brecha importa porque el credential stuffing es exactamente la clase de ataque en la que el AC basado en riesgo es mejor pillando.

## Cómo lo ve Panoptica365

Panoptica365 no intenta detectar los intentos de credential stuffing al nivel del *intento* — Microsoft tiene cientos de motores de detección para eso, y Defender XDR hace correlación entre tenants que sería tonto replicar. Lo que Panoptica365 saca a la superficie es el *resultado*: un inicio de sesión exitoso que se ve fuera de patrón, un inicio de sesión desde una IP extranjera a una cuenta que solo se había conectado desde un país, un patrón de viaje imposible entre dos inicios de sesión separados por minutos y un continente.

Estas señales a nivel de resultado son las alertas que verás más a menudo en la tarjeta 6 (donde empieza el comportamiento de BEC post-compromiso). El evento de credential stuffing en sí está aguas arriba — lo que sacamos a la superficie es *la consecuencia*.

También vale la pena saber: la comprobación de aplicación de MFA de Panoptica365 es la defensa más directa contra toda esta clase de ataque. Cada alerta legible por el operador que dice «este usuario tiene MFA deshabilitado» es, en efecto, «este usuario está expuesto al credential stuffing». Trata las alertas de MFA-deshabilitado como prioritarias. La cifra del 99,9 % de la tarjeta 1, lección 1 (la afirmación de Microsoft de que MFA bloquea la abrumadora mayoría de los compromisos automatizados de cuenta) trata *específicamente sobre esta clase de ataque*.

## Cómo se ve un ataque en la línea de tiempo

Una campaña típica de credential stuffing, desde el lado del atacante, se ve así:

1. **Obtener la lista.** Comprar un vertido en un foro, o sacarlo gratis de la API de `haveibeenpwned`. Los vertidos modernos están desnormalizados — ya están en formato `correo:contraseña`, ordenados por dominio.
2. **Filtrar por dominio.** Sacar cada dirección `@empresadelcliente.com` del vertido. El atacante ahora tiene un subconjunto del tamaño del objetivo.
3. **Probar despacio, distribuido.** Pasar los intentos por infraestructura de proxies residenciales (5–10 intentos por IP por hora, miles de IPs). Esto está *específicamente* diseñado para derrotar los límites de velocidad por IP de Smart Lockout sin disparar los límites por cuenta.
4. **Recolectar los éxitos.** Cualquier cuenta que inicie sesión sin MFA queda capturada. Cualquier cuenta que pida MFA se registra para después (la siguiente fase será o bien fatiga de MFA o AiTM — cubiertos en las lecciones 2 y 3 de esta tarjeta).
5. **Persistir.** Las cuentas exitosas se añaden a una lista separada. Algunos atacantes las usarán inmediatamente para BEC (lección 6); otros las venderán en los mismos foros donde compraron el vertido original.

El ciclo completo, de punta a punta, puede correr en un solo fin de semana. La economía es favorable al atacante porque las entradas no cuestan prácticamente nada.

## Cómo se ve un ataque desde el lado del operador

En realidad puedes ver una campaña de credential stuffing *mientras está pasando* si estás mirando el widget correcto. Vas a ver:

- **Un pico de inicios de sesión fallidos en el widget de Actividad Diaria de Panoptica365** en el panel del tenant. El gráfico de dónut se refresca aproximadamente cada 15 minutos e incluye intentos de autenticación fallidos y bloqueos de Acceso Condicional. La firma del credential stuffing en el dónut es *fallos distribuidos entre muchos usuarios* — distinto de la fatiga de MFA (lección 2), donde los fallos se concentran en uno o pocos usuarios. Los datos por evento de mayor fidelidad están en el registro de inicios de sesión de Entra filtrado por intentos fallidos.
- **Un usuario quejándose de haber sido bloqueado** sin razón obvia. Smart Lockout se disparó. La IP del atacante hizo que su cuenta se deshabilitara temporalmente, y el usuario legítimo está ahora afectado.
- **Una alerta de MFA-deshabilitado o IP extranjera en Panoptica365** por un inicio de sesión exitoso. Esta es la *cola exitosa* del ataque — el uno entre miles de intentos que aterrizó.

La interesante para el triaje es la tercera. Cuando una alerta de inicio de sesión exitoso desde IP extranjera se dispara en un usuario que tenía MFA deshabilitado, tu suposición por defecto debería ser que la cuenta está *actualmente comprometida*. La respuesta correcta es: rehabilitar MFA, forzar un restablecimiento de contraseña, revocar todas las sesiones, escanear su buzón en busca de cualquier regla de reenvío o cambio reciente de reglas (anticipando la cadena de la tarjeta 1 lección 2 «phishing → correo → identidad»), y notificar al cliente. No esperes «más evidencia» — los éxitos de credential stuffing son compromisos confirmados, no «quizás».

## Defender al cliente

El pastel defensivo en capas para el credential stuffing, ordenado por impacto por unidad de esfuerzo:

**Forzar MFA universalmente, con Acceso Condicional.** Esta es la defensa de mayor impacto y la que se deshace de la gran mayoría de estos ataques. Microsoft ha citado que activar MFA bloquea más del 99,9 % de los intentos automatizados de compromiso de cuenta. El 0,1 % que pasa es sobre todo AiTM, fatiga de MFA, y phishing por consentimiento — las próximas tres lecciones. Sin MFA, el 99,9 % vuelve.

**Añadir una lista personalizada de contraseñas prohibidas.** Más allá de la lista por defecto de Microsoft, añade el nombre de la empresa, la ciudad, los nombres comunes de productos, el año. «CustomerCo2024» no es una contraseña fuerte y aún así la gente la usa. La lista personalizada de Entra ID P1 es una de las victorias más fáciles en un tenant.

**Configurar Smart Lockout con un umbral sensato.** Los valores por defecto de Microsoft son razonables pero se pueden apretar en tenants de alto valor. El ajuste está en los ajustes de protección de contraseñas de Entra ID.

**En tenants de E5, activar políticas de Acceso Condicional basadas en riesgo.** «Bloquear inicio de sesión cuando el riesgo del usuario es alto» y «exigir cambio de contraseña cuando el riesgo del usuario es medio» son las dos políticas de partida. Usan la puntuación comportamental de Microsoft (la función P2) para pillar los inicios de sesión que *parecen* legítimos pero están puntuados como sospechosos. Los tenants de Business Premium no pueden hacer esto — ver la tarjeta 1, lección 5 para la conversación sobre licencias.

**Empujar a los clientes hacia autenticación sin contraseña / resistente al phishing.** Passkeys, Windows Hello for Business, llaves FIDO2. Estas no tienen una contraseña que robar para empezar. La lección 3 de esta tarjeta (AiTM) explicará por qué los métodos resistentes al phishing importan para *mucho más* que solo el credential stuffing.

## Lo que esto significa para el operador

Dos puntos prácticos.

**El credential stuffing es un ataque tipo «¿hiciste lo básico?».** Cuando tiene éxito contra un tenant, casi siempre revela uno de tres fallos: no se forzó MFA para el usuario; el usuario tenía una contraseña prohibida que la lista personalizada no bloqueó; o el tenant tiene Acceso Condicional configurado de forma lo bastante laxa como para que el atacante haya encontrado un camino alrededor del MFA. La revisión post-incidente de cualquier compromiso exitoso de credential stuffing debería preguntar las tres cosas.

**La alerta de MFA-deshabilitado es la alerta más valiosa en tu cola para esta clase de ataque.** Panoptica365 la saca a la superficie. Parece poca cosa al lado de las alertas más ruidosas sobre inicios de sesión desde IP extranjera o reglas de buzón sospechosas, pero el usuario sin MFA es la puerta abierta por la que pasan los demás. Trátala como prioritaria. Resuélvela (o bien habilitando MFA, o bien registrando una exención con justificación para una cuenta de servicio que legítimamente no pueda tener MFA).

## Lo que viene

- **Lección 2: Fatiga de MFA — la historia de Uber.** Cuando el atacante tiene la contraseña *y* la cuenta tiene MFA activado, el siguiente ataque es ingenierar socialmente el prompt de MFA mismo. Bombardear al usuario con notificaciones a las 2 de la madrugada hasta que toque «Sí».
- **Lección 3: Phishing AiTM — el rey de 2026.** El bypass técnico de MFA, donde el atacante no necesita ni la contraseña (bueno, sí, pero el usuario la escribe por él) ni la aprobación de MFA (la obtiene de un proxy en tiempo real).

Por ahora: el credential stuffing es el suelo. Es el ataque aburrido y escalable que el atacante prueba primero porque es barato. Las defensas son bien conocidas y licenciables. La razón por la que sigue funcionando en 2026 no es que el ataque sea inteligente — es que MFA todavía no es universal. Esa es la brecha que las dos próximas lecciones explotan.

---

*Fuentes de los datos en esta lección — Microsoft Identity Security Group sobre el bloqueo por MFA del 99,9 % de las compromisiones de cuenta automatizadas ([Weinert, agosto de 2019](https://techcommunity.microsoft.com/blog/microsoft-entra-blog/your-pa%24%24word-doesn%E2%80%99t-matter/731984)); referencia de Smart Lockout de Entra ID ([Microsoft Learn — Smart Lockout](https://learn.microsoft.com/en-us/entra/identity/authentication/howto-password-smart-lockout)); protección de contraseñas de Entra ID (contraseñas prohibidas) ([Microsoft Learn — Eliminate bad passwords](https://learn.microsoft.com/en-us/entra/identity/authentication/concept-password-ban-bad)); contexto sobre conjuntos de datos de fugas ([Have I Been Pwned](https://haveibeenpwned.com/)).*
