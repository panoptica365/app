---
title: "Conecte su PSA"
subtitle: "Integración nativa con Autotask: credenciales, valores predeterminados del ticket, asignación inquilino-empresa y resolución bidireccional."
icon: "ticket"
last_updated: 2026-06-07
---

# Conecte su PSA

Si su negocio gira en torno a un PSA, las alertas deberían ser tickets — creados en la empresa correcta, con la prioridad correcta y cerrables desde cualquiera de los dos lados. Panoptica365 se integra de forma nativa con **Autotask** (Configuración → Integración con PSA, rol de Administrador).

## 1. Credenciales

Introduzca su **Nombre de usuario de API** de Autotask, su **Identificador de seguimiento** y su **Secreto de API**, y haga clic en **Probar conexión**. Si funciona, la integración descubre y guarda su zona de Autotask: *«Conectado: zona …»*. El secreto es de solo escritura tras guardarse — el campo muestra *«Guardado: deje en blanco para conservar el actual»*.

## 2. Valores predeterminados del ticket

Defina cómo es un ticket de Panoptica365 en su mundo:

- **Cola**, **Origen**, **Estado de ticket nuevo** y **Visibilidad de la nota** para los tickets creados.
- **Estado al cerrar desde Panoptica365** — el estado que se aplica cuando Panoptica365 cierra un ticket.
- **Estados considerados «cerrados»** — el conjunto de estados de Autotask que cuentan como «hecho». Cuando su equipo mueve un ticket a cualquiera de ellos, la alerta vinculada se resuelve automáticamente. El estado de cierre debe estar él mismo en este conjunto — el formulario lo exige.
- **Prioridad por gravedad** — una fila por gravedad de alerta (severo, alto, medio, bajo, información) hacia sus prioridades de Autotask.
- **Desfase de vencimiento (horas)** — horas hasta la fecha de vencimiento del ticket (24 por defecto).
- **Idioma del ticket** — en/fr/es para el cuerpo de los tickets.
- **Empresa predeterminada (alertas a nivel de MSP)** — donde aterrizan las alertas de todo el parque (sin inquilino).

## 3. Asignación inquilino → empresa

La tabla de asignación empareja cada inquilino de Panoptica365 con una empresa de Autotask. Use **Sugerir coincidencias** para emparejar por nombre automáticamente (considera tanto el nombre para mostrar como el campo Nombre PSA del inquilino), corrija lo que haya fallado con el selector de empresas con búsqueda, y pulse **Guardar asignación** — todas las filas en un solo lote. El pie cuenta los inquilinos sin asignar: esos caen al respaldo por **correo** (su Dirección de correo PSA) en lugar de tickets por API, así que complete la asignación.

## Cómo se comporta en el día a día

- **Un ticket por problema.** Las alertas se deduplican por (inquilino, directiva de alerta): si el mismo problema vuelve a dispararse mientras su ticket está abierto, la nueva ocurrencia se **añade como nota** al ticket existente, no se crea un duplicado. Su tablero sigue siendo legible durante un incidente ruidoso.
- **Resolución bidireccional.** Cierre (o complete) el ticket en Autotask → la alerta se resuelve en Panoptica365 en la siguiente sincronización. Resuelva la alerta en Panoptica365 → un modal pregunta *«¿Cerrar el ticket de Autotask vinculado?»* — en operaciones masivas pregunta una sola vez para todo el lote.
- **Las alertas resueltas por exención nunca se convierten en tickets.** El ruido suprimido se queda completamente fuera del tablero.
- **El enrutamiento sigue aplicando.** Solo las alertas cuya directiva enruta a **PSA** o **Ambos** crean tickets (vea *Ajuste las directivas de alerta*).

## Estado

La página de configuración muestra el **Estado** de la integración: última consulta, tickets vinculados abiertos, errores de sincronización y estado de la autenticación. Si la autenticación de Autotask empieza a fallar, verá *«La autenticación de Autotask falla desde …»*, se dispara una alerta de sistema y las alertas destinadas a tickets caen automáticamente al respaldo por la dirección de correo del PSA hasta que la autenticación se recupere — la entrega se degrada, nunca desaparece. Que es también la razón por la que la Dirección de correo PSA debe seguir configurada incluso con la integración nativa en marcha.

¿Trabaja con otro PSA? Use la vía del correo: la mayoría de los PSA ingieren correo-a-ticket, y la Cadena de atribución con `${PSA_NAME}` (vea *Configure las notificaciones*) permite a su PSA enrutar esos correos a la empresa correcta automáticamente.
