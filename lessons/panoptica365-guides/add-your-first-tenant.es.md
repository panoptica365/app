---
title: "Añada su primer inquilino"
subtitle: "El flujo de consentimiento de administrador de principio a fin: qué cuenta usar, qué se concede y qué ocurre después."
icon: "building-2"
last_updated: 2026-06-07
---

# Añada su primer inquilino

Todo en Panoptica365 empieza por incorporar un inquilino. El flujo lleva unos dos minutos de clics más unos minutos de recopilación de datos en segundo plano.

## Antes de empezar

Necesita dos cosas:

- El rol de **Administrador** en Panoptica365 (el botón **Añadir inquilino** es solo para administradores).
- Credenciales capaces de conceder el consentimiento de administrador **en el inquilino del cliente** — ya sea una cuenta de **Administrador global de ese inquilino**, o una cuenta con una **relación GDAP** que incluya derechos suficientes para consentir en su nombre. El punto clave: cuando Microsoft le pida iniciar sesión, use las credenciales que tienen acceso al inquilino de *destino* — no las de su propio inquilino de MSP, salvo que sea precisamente ese el que está incorporando.

## Paso a paso

1. Vaya a **Inquilinos** en la barra lateral.
2. Haga clic en **Añadir inquilino** (arriba a la derecha).
3. Se abre el modal **Añadir inquilino** y le pide elegir un modo: **Gestionado** o **Solo auditoría**. En resumen: Gestionado es el conjunto completo de funciones — sondeo programado, alertas, detección de deriva, capacidad de enviar CA / Intune / configuración de seguridad al inquilino — y persiste indefinidamente. Solo auditoría es una instantánea de solo lectura para evaluaciones y prospectos, y se elimina automáticamente a los 14 días más un periodo de gracia de 7 días. Decida **antes** de consentir: un inquilino solo auditoría puede convertirse después en gestionado, pero un inquilino gestionado nunca puede convertirse a solo auditoría. La siguiente guía trata esta decisión en detalle.
4. Haga clic en **Continuar al consentimiento de administrador**. Se le redirige a la página de consentimiento de administrador de Microsoft.
5. Inicie sesión con la cuenta de Administrador global o con GDAP del inquilino de destino y acepte los permisos solicitados. Esto concede al principal de servicio de Panoptica365 acceso de lectura a la configuración del inquilino (y los permisos de escritura que usa el despliegue de plantillas).
6. Vuelve a la página de Inquilinos con un aviso: *«Consentimiento de administrador concedido correctamente.»*

Entre bastidores, Panoptica365 también asigna los roles de **Administrador de Exchange** y **Administrador de cumplimiento** a su principal de servicio en el nuevo inquilino — los lectores de Exchange y de cumplimiento los necesitan. Esto es automático y de mejor esfuerzo; si no se completa, vea la sección de resolución de problemas más abajo.

## Qué ocurre después

El inquilino aparece en la lista de inmediato con un nombre generado (lo corregirá en un momento) y la columna **Último sondeo** vacía. La primera recopilación de datos arranca en segundo plano. **Dele unos minutos** — no hay barra de progreso; cuando termina el primer sondeo, Último sondeo se rellena y el panel del inquilino empieza a mostrar datos reales.

Mientras espera, haga clic en la acción de edición (lápiz) del inquilino y configure:

- **Nombre para mostrar** — el nombre del cliente que quiere ver en todas partes.
- **Nombre PSA** — el nombre de la empresa tal como aparece en su PSA, usado para la atribución de tickets (puede dejarlo para cuando configure la integración con el PSA).
- **Idioma** — el idioma del análisis de IA y de los informes de este inquilino.
- **Intervalo de sondeo (min)** — cada cuánto se sondea el inquilino (de 1 a 60 minutos).

Luego haga clic en **Guardar**, vaya a la **Consola principal** y haga clic en su nuevo inquilino para abrir su panel.

## Resolución de problemas

**El consentimiento falla con AADSTS650051.** Es lo bastante común en un *primer* intento de consentimiento como para que Panoptica365 lo gestione por usted: aparece un modal titulado *«El consentimiento no se completó: vuelva a intentarlo»*. Casi siempre es un tropiezo temporal del lado de Microsoft — haga clic en **Volver a intentar** y el segundo intento suele completarse. Si sigue fallando, despliegue *«Mostrar pasos de limpieza»* en ese modal para obtener un script de limpieza listo para copiar y pegar.

**Asignación de roles incompleta.** Si ve un aviso indicando que el principal de servicio puede estar aún propagándose, espere un minuto, abra el modal de edición del inquilino y haga clic en **Reasignar roles de Exchange**.

**Cuenta equivocada.** Si consintió por accidente con credenciales del inquilino equivocado, ha incorporado el inquilino equivocado. Elimínelo (modal de edición → **Eliminar inquilino**) y empiece de nuevo con las credenciales correctas.
