---
title: "Gestione las exenciones"
subtitle: "Excepciones documentadas y con fecha de caducidad: cómo se crean desde CA, Intune y las alertas, y cómo mantenerlas honestas."
icon: "shield-off"
last_updated: 2026-06-07
---

# Gestione las exenciones

Todo parque tiene excepciones legítimas: la cuenta de servicio que todavía no puede usar MFA, el despliegue que difiere intencionadamente en un cliente, el usuario cuyo patrón de inicio de sesión raro-pero-real no deja de disparar un evaluador. Las exenciones son la forma en que Panoptica365 registra esas excepciones **de manera explícita** — con un ámbito, un motivo, un responsable y una caducidad — en lugar de dejarlas vivir como alertas resueltas por reflejo.

## De dónde salen las exenciones

Las exenciones no se crean en la página de Exenciones. Se crean en contexto, en el momento en que usted acepta una excepción:

- **Aceptación de desviación de CA** — aceptar una desviación de directiva de CA *con vencimiento* eleva los principales excluidos (usuarios o grupos) a exenciones. Ámbito: por principal.
- **Aceptación de desviación de Intune** — mismo flujo; el ámbito es **toda la directiva** para ese despliegue.
- **Exenciones de alerta** — desde el panel lateral de una alerta, eximiendo un patrón recurrente: un usuario, opcionalmente acotado por país y/o rango de IP. Ámbito: el patrón.

La caducidad predeterminada es de **180 días**. Aceptar requiere rol de Operador o superior, y el motivo es siempre obligatorio.

## Qué hace realmente una exención

Mientras está activa, las evaluaciones de alerta coincidentes se suprimen — y, lo importante, se suprimen *con rendición de cuentas*. Las alertas resueltas por una regla de exención quedan marcadas como tales, nunca llegan a su PSA y se excluyen del resumen diario. En las exenciones de CA, la columna de **recuento de supresiones** muestra cuántas alertas ha absorbido cada exención — expanda la fila para ver exactamente qué eventos se suprimieron, cuándo y para quién.

Ese recuento es su retroalimentación de ajuste: una exención que suprimió 47 alertas este mes está cargando un peso real; una que suprimió cero puede que ya no haga falta.

## La página de Exenciones

**Exenciones** (barra lateral → Sistema) es el registro. Filtre por inquilino, por origen (CA / Intune / reglas de alerta) y, si quiere, incluya las entradas revocadas y caducadas. Cada fila muestra la insignia de origen, el inquilino, la plantilla, el ámbito (principal, toda la directiva o patrón de usuario), el **Motivo**, quién la aceptó, cuándo, y la caducidad con una cuenta atrás de días restantes — rojo en negrita por debajo de 7 días, naranja por debajo de 30.

**Revocar** (Operador o superior) termina una exención de inmediato. La confirmación deja clara la consecuencia: en el siguiente ciclo de deriva el principal o el despliegue volverá a marcarse, o las futuras alertas coincidentes se dispararán con normalidad.

## Mantener el registro honesto

- **Los motivos son para la siguiente persona.** «Según ticket #4321 — excepción de viaje del CFO, revisada con el cliente» vale más que «ok según el cliente». Los leerá un año después, en una auditoría.
- **Deje que las caducidades caduquen.** Los 180 días predeterminados son un disparador de re-revisión, no una molestia. Cuando una exención vence y la alerta vuelve a dispararse, es el sistema preguntando *«¿sigue siendo verdad esto?»* — respóndalo, no vuelva a aceptar en piloto automático.
- **Prefiera ámbitos estrechos.** Un usuario con restricción de país vale más que toda la directiva; toda la directiva vale más que apagar una directiva. Use la herramienta más estrecha que detenga el ruido.
- **Haga una barrida trimestral.** Filtre por activas, repase todo lo que no tenga supresiones recientes o cuyo responsable se haya ido — revoque lo que esté rancio.

Las exenciones son la diferencia entre *«esa alerta la ignoramos»* (indefendible) y *«aceptamos ese riesgo, lo documentamos y caduca en marzo»* (profesional). Úselas con generosidad y manténgalas limpias.
