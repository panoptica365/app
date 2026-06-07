---
title: "Inquilinos gestionados vs. solo auditoría"
subtitle: "La única decisión que se toma antes de consentir: supervisión completa para siempre, o una instantánea de solo lectura que caduca."
icon: "scale"
last_updated: 2026-06-07
---

# Inquilinos gestionados vs. solo auditoría

Al añadir un inquilino, la primera decisión — antes de conceder cualquier consentimiento — es su modo. Acierte desde el principio, porque la conversión solo funciona en un sentido.

## Gestionado

**Gestionado** es el modo normal para un cliente de pago. Le da el conjunto completo de funciones de Panoptica365:

- Sondeo programado en el intervalo que usted elija.
- Alertas, detección de deriva y análisis de IA.
- La capacidad de **enviar** directivas de CA, directivas de Intune y configuración de seguridad al inquilino.
- Inclusión en las vistas de parque (Mapa de calor, Actividad diaria) y en el resumen diario.

Un inquilino gestionado persiste indefinidamente — hasta que un Administrador lo elimine.

## Solo auditoría

**Solo auditoría** está pensado para evaluaciones de vulnerabilidades y descubrimiento de prospectos. Piense en él como una fotografía con fecha de caducidad de un inquilino que (todavía) no gestiona:

- **Recopilación de instantáneas de solo lectura para exportación.** Panoptica365 lee la configuración del inquilino para que usted pueda revisarla y generar informes.
- **Sin alertas, sin detección de deriva y sin escrituras** en el inquilino del cliente. No se envía nada, nada se dispara a las 2 de la madrugada.
- **Caducidad automática.** El inquilino queda programado para caducar **14 días después de su creación**, y la eliminación definitiva se ejecuta **7 días después**. La tabla de Inquilinos muestra una insignia con cuenta atrás (p. ej. *AUDITORÍA · quedan 9 d*), y el modal de edición muestra la fecha exacta de caducidad.

Esta caducidad es deliberada: usted no debería conservar indefinidamente los datos de configuración de un prospecto sin un contrato de por medio.

## Convertir entre modos

- **Solo auditoría → Gestionado: permitido.** La historia típica — hizo una evaluación, el prospecto firmó y ahora lo gestiona. Un Administrador abre el modal de edición del inquilino y cambia **Modo** a Gestionado. La caducidad desaparece y comienza la supervisión completa.
- **Gestionado → Solo auditoría: no permitido.** Es una puerta de un solo sentido. Un inquilino gestionado tiene historial de alertas, plantillas desplegadas, líneas base e historial de cambios que no tienen sentido en un contenedor de solo lectura que caduca.

## Guía práctica

- ¿Un prospecto pidió una evaluación de seguridad? **Solo auditoría.** Hágala, genere un informe de Evaluación rápida o de Documentación de configuración, y deje que los datos caduquen (o convierta el inquilino si firma).
- ¿Cliente nuevo con contrato? **Gestionado**, desde el primer día.
- ¿No está seguro? **Solo auditoría** — siempre puede subir de modo. Lo contrario exige eliminar el inquilino y volver a incorporarlo.

Una nota más: eliminar un inquilino (de cualquier modo) borra permanentemente **todos** sus datos — alertas, instantáneas, configuración de seguridad, asignaciones de CA, auditorías e historial de cambios. El modal de confirmación lo dice en serio.
