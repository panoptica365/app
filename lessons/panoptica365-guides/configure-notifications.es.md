---
title: "Configure las notificaciones"
subtitle: "SMTP, destinatarios, el resumen de las 6 de la mañana y los periodos de silencio — cómo las alertas llegan a personas, de forma fiable."
icon: "mail"
last_updated: 2026-06-07
---

# Configure las notificaciones

Una alerta que nadie recibe no ocurrió. Esta guía conecta el lado de la entrega — todo está en **Configuración** (requiere el rol de Administrador), y vale la pena hacerlo con cuidado una sola vez.

## SMTP — los cimientos

**Configuración → Configuración SMTP.** Host, puerto, nombre de usuario, contraseña y la dirección de origen. Guarde, y luego use **Enviar correo de prueba** — hágalo de verdad; la prueba atrapa el error de autenticación o el puerto bloqueado *ahora* y no durante su primer incidente real. Toda función de correo de la plataforma (notificaciones de alerta, resumen diario, correo asociado a informes) viaja sobre esta configuración.

## Destinatarios y enrutamiento

**Configuración → Configuración de notificaciones** contiene tres campos:

- **Direcciones de correo destinatarias** — la lista, separada por comas, de destinatarios *personales*: sus operadores. Las alertas cuya directiva enruta a **Correo** (o **Ambos**) llegan aquí.
- **Dirección de correo PSA** — adonde van las alertas enrutadas a **PSA** cuando viajan por correo: la entrada correo-a-ticket de su PSA. Una vez conectada la integración nativa con el PSA (siguiente guía), las alertas enrutadas al PSA se convierten en tickets reales por API y esta dirección pasa a ser el respaldo — manténgala configurada en cualquier caso.
- **Cadena de atribución** — la primera línea de los correos dirigidos al PSA, con soporte para el marcador `${PSA_NAME}`, de modo que su PSA pueda enrutar los tickets automáticamente al tablero de la empresa correcta.

Qué alertas van adónde se decide por directiva de alerta (enrutamiento: Ninguno / Correo / PSA / Ambos — vea *Ajuste las directivas de alerta*). El modelo mental: **Configuración dice adónde apuntan los canales; Directivas de alerta dice qué fluye por cada canal.**

Cada destinatario recibe el correo en **su propio idioma** — los destinatarios con perfil de usuario en Panoptica365 reciben los correos de alerta en el idioma definido en sus preferencias.

## El resumen diario

Cada mañana a las 6, Panoptica365 envía por correo un resumen escrito por Claude del último día en todo el parque. **Configuración → Resumen diario** define la gravedad mínima que entra: desde *Info — incluir todo (predeterminado)* hasta *Solo severas*. Las alertas resueltas por reglas de exención se excluyen automáticamente — el pie indica qué se filtró. Si su resumen suena a ruido, suba el umbral antes de dejar de leerlo; un resumen que usted ojea a diario con cualquier umbral vale más que uno completo que ignora.

## Periodos de silencio

¿Se va de vacaciones? Cualquier usuario puede silenciar las alertas **hacia su propio correo**: haga clic en su control de silencio, defina Desde / Hasta (hasta 60 días) y, si quiere, un motivo. El silencio caduca solo; puede cancelarlo antes.

Dos detalles honestos:

- Silenciar solo afecta a *su* entrega. Si su dirección no está en ninguna lista de destinatarios, la interfaz le avisa de que el silencio no tiene efecto.
- **El mecanismo de seguridad:** si todos los destinatarios configurados están silenciados a la vez, Panoptica365 anula los silencios y entrega de todos modos a un Administrador, con un banner de *Entrega de respaldo* en el correo. No existe configuración alguna en la que una alerta severa no llegue a nadie en silencio. Los administradores pueden revisar todos los silencios activos en Configuración.

## La lista de verificación

1. SMTP configurado y **correo de prueba recibido**.
2. Correos de los operadores en la lista de destinatarios; correo del PSA configurado.
3. Umbral del Resumen diario elegido.
4. Enrutamiento de las directivas de alerta revisado (*Ajuste las directivas de alerta*).
5. Una prueba real: dispare algo inofensivo y confirme que llega adonde espera.

Quince minutos, una sola vez — y entonces el modelo basado en alertas funciona de verdad, porque la entrega es digna de confianza.
