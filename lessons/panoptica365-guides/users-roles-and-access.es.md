---
title: "Usuarios, roles y acceso"
subtitle: "Tres niveles controlados por grupos de Entra: quién puede hacer qué, cómo configurarlo y cómo se aplica."
icon: "users"
last_updated: 2026-06-07
---

# Usuarios, roles y acceso

Panoptica365 no mantiene su propia base de datos de contraseñas. Los operadores inician sesión con sus cuentas de Microsoft, y lo que pueden hacer lo decide la **pertenencia a grupos de Entra ID** en su inquilino de MSP. Tres grupos, tres niveles.

## Los tres roles

**Administrador** — control total. Gestiona los inquilinos (añadir, editar, eliminar), toda la Configuración, la edición de directivas de alerta y el registro de auditoría. El único rol que puede incorporar o eliminar un inquilino.

**Operador** — el nivel de trabajo. Despliega plantillas de CA e Intune, aplica configuración de seguridad, acepta derivas y crea exenciones, resuelve y gestiona alertas, vuelve a ejecutar análisis de IA. No puede tocar la Configuración ni el ciclo de vida de los inquilinos.

**Observador** — solo lectura. Ve paneles, alertas, informes, el mapa de calor, Aprender — todo visible, nada modificable. Adecuado para técnicos en formación, auditores o una pantalla de cara al cliente.

El propio inicio de sesión está controlado por los mismos grupos: una cuenta que no esté en ninguno de los tres grupos no puede entrar en absoluto.

## Cómo configurarlo

1. En el Entra ID de **su propio inquilino de MSP**, cree tres grupos de seguridad (p. ej. *Panoptica Admins*, *Panoptica Operators*, *Panoptica Viewers*) y añada a su gente.
2. En **Configuración → Control de acceso**, pegue el Object ID de cada grupo en el campo correspondiente: **Administradores**, **Operadores**, **Observadores**.
3. Haga clic en el botón de verificación junto a cada uno — resuelve el nombre para mostrar del grupo a través de Graph, confirmando que pegó el GUID correcto.
4. Guarde. A partir de entonces, los cambios de pertenencia en Entra surten efecto en el siguiente inicio de sesión — gestionar quién puede hacer qué en Panoptica365 es simplemente gestionar pertenencia a grupos, algo que su equipo ya sabe hacer.

Si un usuario está en varios grupos, recibe el nivel más alto al que tenga derecho.

## Cómo funciona la aplicación

Dos capas, y conviene conocer ambas:

- **La interfaz se adapta.** Su insignia de rol aparece en la barra lateral; la sección Sistema (Configuración, Registro de auditoría) se oculta a quienes no son administradores; los botones solo para administradores (Añadir inquilino, Eliminar inquilino, edición de directivas) desaparecen o se deshabilitan; algunos campos se muestran visibles pero de solo lectura para los niveles inferiores.
- **El servidor aplica las reglas.** Cada endpoint de API que muta algo comprueba el rol del lado del servidor. El botón oculto no es la frontera de seguridad — el 403 lo es. Y cada intento denegado se escribe en el registro de auditoría MSP.

Así que si alguien de su equipo reporta un botón ausente, compruebe su pertenencia a grupos antes de abrir un bug.

## Rendición de cuentas

Cada acción significativa de un operador — despliegues de plantillas, cambios de configuración, aceptaciones de deriva, resoluciones de alertas, ciclo de vida de inquilinos y esos 403 — queda registrada en el **Registro de auditoría** con actor, marca de tiempo y resultado (vea *Administración del sistema*). El modelo de roles decide quién *puede* actuar; el registro de auditoría documenta quién *actuó*.

## Consejos prácticos

- **Sea tacaño con Administrador.** La mayor parte del trabajo diario — desplegar, aceptar, resolver — es de nivel Operador por diseño. Dos administradores bastan para la mayoría de los equipos.
- **Use Observador con intención.** Es una forma segura de dar visibilidad a juniors, auditores o una pantalla de NOC sin darle a nadie un gatillo.
- **Revise la pertenencia cuando la gente cambie de puesto** — es un grupo de Entra como cualquier otro, y merece la misma disciplina de altas, cambios y bajas que usted aplica a los inquilinos de sus clientes.
