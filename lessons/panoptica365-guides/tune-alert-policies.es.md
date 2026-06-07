---
title: "Ajuste las directivas de alerta"
subtitle: "Gravedad, enrutamiento, activado/desactivado y límites de notificación — haga que el flujo de alertas encaje con cómo trabaja realmente su equipo."
icon: "list-checks"
last_updated: 2026-06-07
---

# Ajuste las directivas de alerta

De fábrica, Panoptica365 trae docenas de directivas de alerta con valores predeterminados sensatos. **Directivas de alerta** (barra lateral) es donde las adapta a su negocio — y la diferencia entre un flujo de alertas en el que su equipo confía y uno que ignora son veinte minutos en esta página.

## La disposición

Las directivas están agrupadas en categorías plegables:

- **Inicios de sesión de riesgo** — viaje imposible, ubicaciones desconocidas, detecciones de riesgo.
- **Gestión de amenazas** — incidentes de Defender, malware, señales de phishing.
- **Permisos** — cambios de rol, concesiones de consentimiento, crecimiento de permisos de aplicaciones.
- **Cambios de configuración** — deriva y cambios de configuración, incluidos los elementos del Centro de mensajes.
- **Uso compartido externo** — enlaces anónimos, eventos de acceso externo.
- **Gobierno de la información** — DLP y eventos cercanos al cumplimiento.

Una barra de búsqueda filtra por nombres y descripciones; las secciones con coincidencias se expanden solas. Cada fila de directiva lleva el **icono del birrete** — el mismo explicador de cinco secciones que tiene una alerta en vivo, para que pueda entender una directiva antes de decidir qué hacer con ella.

## Qué puede cambiar por directiva

- **Gravedad** — información / bajo / medio / alto / severo. La gravedad gobierna la ordenación, el umbral del resumen diario y el mapeo de prioridad de los tickets del PSA. Si su equipo trata un tipo de alerta como «se deja todo y se atiende», califíquela así.
- **Enrutamiento** — Ninguno / Correo / PSA / Ambos. *Correo* va a sus destinatarios de notificación (correo electrónico); *PSA* va a su PSA (ticket, o el correo del PSA como respaldo); *Ambos* hace las dos cosas. Enrute al PSA el trabajo accionable para el cliente, y al correo lo que solo necesita conocimiento del operador.
- **Conmutador Activado / Desactivado** — las directivas deshabilitadas no se evalúan en absoluto. Apagar una directiva es honesto cuando esa señal de verdad no le interesa; resolver sus alertas eternamente con la directiva encendida no lo es.
- **Límite de notificaciones (por día)** (modal de edición, Administrador) — un tope diario de notificaciones por directiva, su freno contra una alerta desbocada que inunde buzones o el tablero del PSA.

Los cambios hechos aquí son globales — aplican a todos los inquilinos. Las excepciones por inquilino van en las **exenciones** (siguiente guía), no en los conmutadores de directivas.

## Un método de ajuste que funciona

1. **Corra con los valores predeterminados dos semanas.** No ajuste de antemano contra un ruido imaginado.
2. **Mire lo que realmente resolvió como falso positivo.** Cada falso positivo recurrente es o un candidato a exención (un usuario, un patrón, un inquilino) o un desajuste de gravedad/enrutamiento (la señal es real pero no merece un ticket).
3. **Suba lo que le quemó.** Si algo se convirtió en incidente y su alerta estaba calificada como baja, súbala.
4. **Vigile el umbral del resumen.** El resumen diario tiene su propio ajuste de gravedad mínima (Configuración → Resumen diario). La gravedad aquí y el umbral allí deciden juntos qué contiene su correo de las 6 de la mañana.

Todas las ediciones de esta página quedan registradas en el registro de auditoría MSP — cambios de gravedad, conmutadores, cambios de enrutamiento. El ajuste es trabajo con rendición de cuentas, y así debe ser.
