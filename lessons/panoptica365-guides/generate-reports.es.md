---
title: "Genere informes"
subtitle: "Cuatro tipos de informe y cuándo usar cada uno: postura para la revisión trimestral, documentación para el expediente, evaluación rápida para el prospecto."
icon: "file-text"
last_updated: 2026-06-07
---

# Genere informes

La supervisión se gana el sueldo en silencio; los informes son donde el cliente *ve* el trabajo. **Informes** (barra lateral) genera entregables PDF con su marca a partir de los datos que Panoptica365 ya tiene — sin capturas de pantalla ni copiar y pegar.

## Los cuatro tipos

**Informe de postura de seguridad (PDF).** El entregable estrella para el cliente: Puntuación de seguridad y tendencias, cobertura de Acceso Condicional, actividad de alertas en el periodo elegido, gráficos y un análisis de la postura del inquilino escrito por IA. Toma un **intervalo de tiempo** — últimos 7, 30 o 90 días. Es su documento para la revisión trimestral (QBR).

**Documentación de configuración (PDF).** Una instantánea puntual de la configuración del inquilino, organizada como el panel: identidad, directivas de acceso, dispositivos, correo, colaboración. Sin intervalo de tiempo — documenta el *ahora*. Es el documento de expediente: registros de incorporación, evidencia para auditorías y aseguradoras, traspasos de salida. Cuando existe una instantánea anterior, se carga para comparar.

**Evaluación rápida (PDF).** Pensada para el escenario de solo auditoría / prospecto: una evaluación concisa, centrada en los hallazgos, del estado actual de un inquilino. Antes de generar, un **cuadro de contexto** opcional le permite contarle a la IA qué tipo de organización es — *«p. ej. firma contable de 40 personas»* — lo que afina considerablemente las recomendaciones. Rellénelo; dos frases de contexto mejoran el resultado de forma notable. Encaja de forma natural con los inquilinos solo auditoría y su ventana de 14 días.

**Instantánea del inquilino (ZIP).** La exportación de datos en bruto — para archivo, para sus propias herramientas o para entregar los datos en sí.

## Generar

1. Elija el **inquilino**.
2. Elija el **tipo de informe**.
3. Elija el **intervalo de tiempo** (solo para el de postura de seguridad — los demás son puntuales y el selector se deshabilita solo).
4. Haga clic en **Generar informe**.

Un modal de progreso recorre las etapas — recopilar datos, obtener directivas de CA, renderizar gráficos, análisis de IA, ensamblar — normalmente un minuto o dos según el tipo. Los informes terminados aterrizan en la lista de **Informes recientes** de abajo, con un botón de descarga. El historial es por sesión: descargue lo que genere; regenerar es barato de todos modos.

## Marca e idioma

Los informes llevan su marca — nombre de empresa y logotipo en la portada y los pies de página — configurada una sola vez por un Administrador en **Configuración → Marca de los informes** (PNG transparente, máximo 2 MB). Hágalo antes de que salga el primer informe de cara al cliente.

Los informes se generan en el **idioma del inquilino** (el campo Idioma del inquilino), en los tres idiomas disponibles — ponga una vez el inquilino de un cliente francófono en *fr*, y todos sus entregables saldrán en francés.

## Cuál elegir, en la práctica

- Prospecto, preventa: **Evaluación rápida** (con el contexto rellenado).
- Cliente nuevo, fin de la incorporación: **Documentación de configuración** — la foto del «antes».
- Revisión trimestral: **Informe de postura de seguridad**, 90 días.
- Cuestionario de seguros o auditoría: **Documentación de configuración**, generada ese mismo día.
- Salida del cliente: **Documentación de configuración** + **Instantánea del inquilino**, y a archivar.

La victoria silenciosa: un entregable de configuración documentada por cliente y por trimestre solía costar horas de capturas de pantalla manuales. Aquí es un desplegable y un minuto de barra de progreso — así que hágalo de verdad cada trimestre.
