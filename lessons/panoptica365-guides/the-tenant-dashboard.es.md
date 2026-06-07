---
title: "El panel del inquilino"
subtitle: "Seis pestañas, dos zonas: las tarjetas de métricas, los paneles de detalle y dónde vive cada flujo de trabajo."
icon: "gauge"
last_updated: 2026-06-07
---

# El panel del inquilino

Haga clic en un inquilino en la Consola principal y aterrizará en su panel. Es la página más rica de Panoptica365 — todo lo que se sabe de un inquilino, organizado en seis pestañas:

1. **Resumen** — la instantánea de configuración y actividad (esta guía).
2. **Alertas** — las alertas de este inquilino, con el mismo flujo de trabajo que la página global de Alertas.
3. **Directivas de CA** — las plantillas de Acceso Condicional asignadas a este inquilino (tiene guía propia).
4. **Directivas de Intune** — las plantillas de Intune desplegadas en este inquilino (guía propia).
5. **Aplicaciones** — el inventario de aplicaciones empresariales y el flujo de aprobación (guía propia).
6. **Registro de cambios** — el historial de cada cambio hecho en este inquilino, tanto los que hizo Panoptica365 (despliegues, aplicaciones de configuración) como los que los operadores registraron a mano. Las alertas de deriva enlazan a entradas de aquí cuando un cambio las explica.

## La pestaña Resumen: tarjetas de métricas

La zona superior es una cuadrícula de tarjetas de un vistazo. Lo que aparece depende de lo que tenga el inquilino, pero espere:

- **Puntuación de seguridad** — con la media comparativa de inquilinos de tamaño similar.
- **Identidad**: Usuarios totales, Con licencia, **Admins globales** (verde con 2 o menos, rojo por encima de 5 — la cantidad importa), porcentaje de **MFA registrada** (verde a partir del 90 %), Usuarios en riesgo, Inactivos (90 d).
- **Control de acceso**: Políticas AC (desglose habilitadas/deshabilitadas), Valores predeterminados de seguridad activados o no.
- **Dispositivos**: porcentaje de Dispositivos que cumplen con flecha de tendencia, Dispositivos inactivos (90 d), estado de sincronización de Entra Connect.
- **Colaboración**: Sitios SP, **Enlaces anónimos** (gravedad alta si existe alguno), cuentas de OneDrive, Teams (desglose públicos/privados).
- **Correo**: Buzones, actividad de Correo (7 d), **Reglas de bandeja** — con un indicador de reenvío externo, una de las señales de compromiso más comunes.
- **Aplicaciones y DNS**: Apps registradas, Apps empresariales, Dominios con el estado de validación de MX/SPF/DMARC/Autodiscover.

Trate las tarjetas como una superficie de triaje: cualquier cosa en rojo o amarillo es una pregunta que merece respuesta.

## La pestaña Resumen: paneles de detalle

Debajo de las tarjetas, paneles plegables contienen el detalle que hay detrás de cada tarjeta: el desglose de licencias, la lista real de administradores globales, los usuarios sin MFA, el detalle de cada política de CA, la tabla completa de dispositivos de Intune, los principales buzones por almacenamiento, los enlaces anónimos por sitio, todas las reglas de bandeja agrupadas por usuario, las listas de usuarios y dispositivos inactivos, las aplicaciones registradas y de terceros, y los registros DNS de cada dominio.

Usará estos paneles constantemente en evaluaciones y conversaciones con clientes — «tienen cuatro administradores globales y dos son cuentas sin licencia que nadie reclama» sale directamente de aquí.

## Frescura de los datos

Todo lo que ve en el Resumen refleja el **último sondeo** (el intervalo que configuró por inquilino, de 1 a 60 minutos, más ciclos más lentos para los datos pesados). Si acaba de incorporar el inquilino, dele unos minutos al primer sondeo; si una tarjeta parece desactualizada, compruebe **Último sondeo** en la página de Inquilinos.

## Adónde ir desde aquí

Una primera pasada sensata sobre un inquilino recién incorporado: ojee el Resumen en busca de algo alarmante, luego trabaje **Aplicaciones** (apruebe lo que sea de confianza), después **Directivas de CA** y **Directivas de Intune** (despliegue sus líneas base) y por último **Seguridad** (la superficie de configuración a nivel de inquilino, desde la barra lateral). Las cuatro guías siguientes recorren cada una.
