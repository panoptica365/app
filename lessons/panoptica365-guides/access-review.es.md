---
title: "Revisión de acceso — quién es administrador, quién está inactivo y su vía de regreso de emergencia"
subtitle: "Revise a cada titular de un rol con privilegios, deshabilite o elimine cuentas inactivas, y configure cuentas de emergencia que eluden el Acceso condicional y avisan en cuanto se usan."
icon: "key-round"
last_updated: 2026-06-13
---

# Revisión de acceso — quién es administrador, quién está inactivo y su vía de regreso de emergencia

La pestaña **Revisión de acceso** del panel del inquilino responde a tres preguntas que debería poder resolver sobre cualquier cliente: *quién tiene roles administrativos, qué cuentas son peso muerto y qué pasa si una directiva de Acceso condicional bloquea a todos.* Se encuentra entre **Seguridad** y **Aplicaciones**, y son dos tablas más un flujo de cuentas de emergencia.

Todo lo que escribe en el inquilino aquí lo inicia el operador, se confirma y se audita — Panoptica365 nunca deshabilita ni elimina una cuenta por su cuenta.

## Tabla 1 — Cuentas con roles administrativos

Es una lista de **solo lectura** de cada cuenta que tiene un rol con privilegios supervisado, agrupada por nivel (los roles de cúspide como Administrador global primero, luego alto, luego medio). Para cada cuenta verá su nombre (enlazado a su ficha de usuario en Entra), su UPN, los roles que tiene, si está habilitada, si la **MFA** está registrada y su última actividad.

Dos cosas que conviene leer con atención:

- **MFA registrado** muestra *Sí*, *No* o un guion. Un guion significa *no pudimos leer un registro para esa cuenta* — **no** es lo mismo que «sin MFA». No actúe sobre un guion; actúe sobre un *No* claro.
- El **nivel de cúspide** es donde merece estar su atención. Un Administrador global sin MFA, o tres Administradores globales más de los que recuerda haber creado, es justo lo que esta tabla existe para revelar.

No hay botones de acción en esta tabla — es una postura que usted lee y sobre la que luego actúa en otro sitio (en Entra, o mediante la Tabla 2 para cuentas sin privilegios).

## Tabla 2 — Todas las cuentas de usuario

Cada cuenta del inquilino, con filtros: **Todas**, **Miembros**, **Invitados**, **Inactivas**. Las columnas son cuenta + UPN, tipo, habilitada, última actividad y acciones.

La **inactividad** se calcula a partir de los informes de uso de Microsoft 365, no de los registros de inicio de sesión del directorio — lo que significa que **funciona en Business Standard**, donde los registros de inicio de sesión no están disponibles por licencia. La columna de última actividad muestra la fecha más reciente en que la cuenta hizo algo en Exchange, SharePoint, OneDrive o Teams; si es más antigua que el umbral (90 días por defecto), la fecha se pone roja y la fila se marca **Inactiva**. Un invitado que fue convidado pero nunca aceptó se etiqueta **Nunca aceptada** — el candidato a eliminación más claro que hay.

Si el inquilino tiene activada la opción *Mostrar nombres ocultos de usuarios, grupos y sitios*, el informe de uso vuelve anonimizado y no podemos asociar la actividad a las cuentas. En lugar de mostrarle datos sin sentido, aparece una nota sobre la tabla con un enlace para desactivar el ajuste.

## Deshabilitar y eliminar cuentas

**Deshabilitar**, **Habilitar** y **Eliminar** son acciones del operador en la Tabla 2. Cada una abre un cuadro de confirmación que nombra la cuenta, indica lo que va a pasar y recuerda que la acción queda registrada en el registro de auditoría. Eliminar también le indica que la cuenta es **recuperable en Entra durante 30 días** antes de que la eliminación sea permanente.

Las salvaguardas se aplican en el servidor, no solo se ocultan en la interfaz:

- **La eliminación se rechaza para cualquier cuenta que tenga un rol administrativo.** Quite primero sus roles en Entra — esta herramienta no le dejará borrar a un administrador por accidente.
- **Deshabilitar al último Administrador global habilitado está bloqueado.** Ese es el único clic que deja a un inquilino bloqueado fuera de sí mismo.
- Una **cuenta de emergencia** exige una confirmación adicional antes de poder deshabilitarse o eliminarse.

Cada deshabilitación, habilitación y eliminación se escribe en el registro de auditoría del MSP **y** en el registro de cambios del inquilino, con el operador, el UPN de destino, la acción y el resultado — de modo que una acción descuidada u hostil siempre sea atribuible a posteriori.

## Cuentas de emergencia — acceso de emergencia bien hecho

Una cuenta de emergencia («break-glass») es la credencial a la que recurre cuando algo ha salido mal: una directiva de Acceso condicional mal configurada ha bloqueado a todos los administradores normales, o su proveedor de MFA está caído. Su única función es **eludir las directivas de Acceso condicional** para que un humano siempre pueda volver a entrar y arreglar las cosas.

Panoptica365 lo hace como recomienda Microsoft — con un **grupo** dedicado, no con ediciones cuenta por cuenta. Abra **Cuentas de emergencia** desde la pestaña Revisión de acceso. La primera vez, se le guiará.

### Antes de empezar

Cree primero la cuenta de emergencia en Entra:

- **Administrador global**, **sin licencia**, solo en la nube, en el dominio **.onmicrosoft.com**.
- Póngale un **nombre genérico** — nunca «break glass», «emergencia» ni «admin». Un nombre evidente es una señal para un atacante que consigue un punto de apoyo; elija algo anodino (un operador usa *facturación*). Nombre el grupo también de forma genérica y conserve en él solo sus cuentas de emergencia.
- Microsoft recomienda mantener **al menos dos** cuentas de emergencia.

### Indique el grupo a Panoptica365

Elija su grupo de seguridad dedicado en el selector — mostramos el nombre pero nos basamos en el identificador inmutable del grupo, de modo que renombrarlo más tarde no rompa nada. Aquí hay una barrera de seguridad estricta: si elige un grupo con más de unos pocos miembros, Panoptica365 lo detiene, porque excluir ese grupo del Acceso condicional eximiría a *todos sus miembros* — apuntar por error a «Todo el personal» eximiría a toda su empresa. También comprueba que sea un grupo de seguridad asignado, no dinámico (a un grupo dinámico no se le pueden añadir miembros).

Al confirmar, Panoptica365 **excluye el grupo de cada directiva de Acceso condicional** y le muestra el resultado directiva por directiva — excluido, ya excluido o con error. Si una escritura falla, se lo dice, en vez de fingir éxito — porque «excluido de 5 de 7 directivas» significa que la cuenta aún puede quedar bloqueada por las otras dos. A partir de entonces, designar una cuenta es simplemente **añadirla al grupo**, y el estado de cobertura muestra *«Excluido de N de N directivas.»*

Si el inquilino aún está en **Valores predeterminados de seguridad** (sin Acceso condicional), la exclusión es imposible — esos valores imponen la MFA a todos, sin exclusiones. Panoptica365 lo dice con claridad y sugiere pasar a Acceso condicional. Aun así puede designar y supervisar la cuenta; la alerta de inicio de sesión de abajo funciona de todos modos.

### La alerta de inicio de sesión

En cuanto una cuenta de emergencia **inicia sesión**, Panoptica365 genera una alerta **SEVERA** — correo y un ticket de PSA si tiene uno conectado. Un inicio de sesión de emergencia real casi siempre significa que algo se rompió o que alguien está donde no debería, así que está pensada para ser ruidosa. La detección se apoya en el registro de auditoría unificado: **funciona sin licencia Premium**, y coincide con la identidad estable de la cuenta — por lo que se dispara incluso si ha cambiado el dominio de la cuenta.

Un solo inicio de sesión produce una sola alerta (y no una por registro de auditoría); los inicios de sesión repetidos el mismo día incrementan su contador de recurrencia hasta que la resuelva.

### La cobertura sigue garantizada

Con el tiempo se crean nuevas directivas de Acceso condicional, y una exclusión puede quitarse. Panoptica365 sigue verificando que su grupo de emergencia permanezca excluido de **cada** directiva y genera una alerta si se abre una brecha — una directiva nueva sin la exclusión, o una exclusión que se eliminó. Y como la exclusión es algo que *usted* aplicó, Panoptica365 la considera esperada: no señalará su propia exclusión de emergencia como una desviación de Acceso condicional.

### Lo único que ha cambiado en las cuentas de emergencia

Microsoft ahora **exige MFA en los inicios de sesión de los portales de administración a nivel de plataforma — con independencia del Acceso condicional.** Excluir la cuenta de todas las directivas de AC ya no elimina el aviso de MFA, y el viejo modelo de «sin MFA, solo una contraseña en bóveda» ha desaparecido. Registre un método **resistente a la suplantación** en la cuenta — una **llave de seguridad FIDO2** — y guárdela en la bóveda con la contraseña. De hecho es *mejor* para una cuenta de emergencia: una llave de hardware no depende de la aplicación de autenticación ni de la señal del teléfono, así que sigue funcionando cuando lo que está caído es precisamente la vía de MFA normal.

## Cuándo usar esto

- **En la incorporación:** revise la lista de administradores, señale cualquier administrador sin MFA y configure dos cuentas de emergencia con un grupo dedicado.
- **Periódicamente:** repase la Tabla 2 en busca de cuentas inactivas e invitados nunca aceptados; deshabilite o elimine con el visto bueno del cliente.
- **Cada vez que se dispare una alerta de emergencia:** confirme que fue un uso planificado. Si no lo fue, acaba de detectar algo.
- **Después de crear nuevas directivas de AC:** revise el estado de cobertura de las cuentas de emergencia (o espere la alerta de brecha) y vuelva a aplicar si es necesario.
