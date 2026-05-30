---
title: "BitLocker Settings — postura de cifrado de disco"
subtitle: "Aplicar cifrado completo de disco en dispositivos Windows mediante Intune — qué configura la plantilla, gestión de claves de recuperación y dependencias de TPM."
icon: "hard-drive"
last_updated: 2026-05-29
---

# BitLocker Settings — postura de cifrado de disco

Si un portátil gestionado se roba de un coche aparcado a las 2 de la madrugada y el ladrón es un oportunista genérico, el ladrón se lleva un portátil que puede formatear y vender por unos cientos de euros. Si el disco del portátil está cifrado, los datos del cliente se van con el portátil. Si no lo está, los datos del cliente acaban en algún lugar de internet en una semana, dependiendo de a quién le vendió el ladrón el equipo y qué hicieron con la unidad original.

BitLocker es la diferencia entre esos dos desenlaces en dispositivos Windows. La plantilla BitLocker Settings de Panoptica365 es la configuración que lo aplica.

Esta lección cubre lo que la plantilla BitLocker Settings configura realmente, por qué algunas elecciones se hicieron como se hicieron, y cómo manejar las realidades operativas — claves de recuperación, dependencias de TPM, la distinción actualización-vs-instalación-limpia.

## Qué configura la plantilla

La plantilla BitLocker Settings de Panoptica365 usa el tipo de plantilla más antiguo **Device Configurations** (`windows10EndpointProtectionConfiguration`). Es la misma familia de plantillas que Microsoft usa para los ajustes heredados de protección de endpoint. Se despliega vía MDM a dispositivos Windows 10/11.

Las configuraciones BitLocker centrales:

**BitLocker habilitado y aplicado.**
- `bitLockerEncryptDevice: true` — los dispositivos deben estar cifrados.
- `bitLockerAllowStandardUserEncryption: true` — los usuarios estándar (no admin) pueden iniciar el cifrado.
- `bitLockerDisableWarningForOtherDiskEncryption: true` — suprime las advertencias cuando hay también cifrado de disco de terceros presente.

**Política de la unidad de sistema (la unidad del SO — típicamente C:):**
- Método de cifrado: **XTS-AES 256-bit**. Es el cifrado moderno y recomendado para Windows 10 1511 y posteriores. Más fuerte que las variantes AES-CBC más antiguas.
- Autenticación de arranque requerida (protegida por TPM por defecto).
- Permitido el uso de PIN de arranque por TPM.
- Bloquear la autenticación de arranque sin TPM (sin modo solo-PIN — se requiere TPM).
- Opciones de recuperación configuradas: la clave de recuperación de BitLocker puede guardarse en Microsoft Entra ID; agente de recuperación de datos permitido; uso de contraseña de recuperación permitido.

**Unidades fijas (unidades de datos que no son del SO — típicamente D:, E:, etc.):**
- Método de cifrado: **XTS-AES 256-bit** (igual que la unidad del sistema).
- Cifrado no requerido para acceso de escritura (`requireEncryptionForWriteAccess: false`) — los dispositivos todavía pueden escribir en unidades fijas no cifradas. Es la elección laxa; la versión estricta rechazaría el acceso de escritura.
- Opciones de recuperación similares a la unidad del sistema.

**Unidades extraíbles (memorias USB, discos duros externos):**
- Método de cifrado: **AES-CBC 128-bit**. Nota la diferencia con las unidades de sistema/fijas — las unidades extraíbles usan el cifrado AES-CBC más antiguo porque XTS-AES es incompatible con versiones más antiguas de Windows en las que el cliente o sus socios pueden estar leyendo todavía la unidad. AES-CBC 128 sigue siendo lo bastante moderno; la elección sacrifica algo de fuerza de cifrado por compatibilidad.
- Cifrado no requerido para acceso de escritura — mismo patrón laxo que las unidades fijas.
- Acceso de escritura entre organizaciones no bloqueado.

**Más allá de BitLocker — la plantilla también configura algunos ajustes de endurecimiento de endpoint:**

El tipo de plantilla Device Configurations agrupa BitLocker con otros ajustes de protección de endpoint en el mismo JSON. La plantilla de Panoptica365 solo configura BitLocker explícitamente; todo lo demás está puesto en `notConfigured` o `userDefined`, lo que significa «esta plantilla no toma una postura». Unos pocos ajustes no-BitLocker *sí* están explícitamente fijados:

- `lanManagerAuthenticationLevel: lmAndNltm` — acepta autenticación tanto LM como NTLM (relativamente permisivo — más estricto sería `ntlmV2Only`).
- `localSecurityOptionsMinimumSessionSecurityForNtlmSspBasedClients: none` — sin seguridad mínima de sesión NTLM (muy permisivo).
- `localSecurityOptionsMinimumSessionSecurityForNtlmSspBasedServers: none` — igual.
- `localSecurityOptionsSmartCardRemovalBehavior: noAction` — no pasa nada cuando se retira una tarjeta inteligente.
- `xboxServicesAccessoryManagementServiceStartupMode: manual` (y otros tres servicios Xbox puestos en manual) — estos servicios relacionados con Xbox no arrancan automáticamente al iniciar, eliminando algo de superficie de ataque en dispositivos que no son PCs gaming.

Las elecciones de los servicios Xbox son *interesantes*. La mayoría de los dispositivos Windows del parque gestionado no son PCs gaming, pero los servicios Xbox están presentes en instalaciones estándar de Windows y arrancan automáticamente por defecto. Ponerlos en manual elimina servicios en segundo plano que nada en un entorno corporativo usa. Endurecimiento de baja palanca, pero gratis.

Las elecciones de LM Manager / seguridad de sesión NTLM son *permisivas* y vale la pena conocerlas — no están aplicando endurecimiento NTLM moderno. Si un cliente necesita NTLM estricto (industrias reguladas, requisitos de baseline endurecida), esos ajustes deberían endurecerse vía la Security Baseline (lección 3) o vía personalización.

## Dependencia de TPM

La plantilla BitLocker de Panoptica365 requiere que la autenticación de arranque use el TPM (Trusted Platform Module). Específicamente:

- `startupAuthenticationRequired: true` (debe haber autenticación de arranque)
- `startupAuthenticationBlockWithoutTpmChip: true` (TPM requerido — sin alternativa solo-PIN)

Casi todos los dispositivos Windows fabricados en la última década tienen un chip TPM 2.0. Windows 11 *requiere* TPM 2.0 para la instalación, así que cualquier dispositivo Windows 11 por definición tiene uno. Los dispositivos Windows 10 pueden o no, dependiendo de edad y configuración.

Para dispositivos sin TPM (o con TPM deshabilitado en la BIOS — a veces el caso en hardware barato donde los valores por defecto de la BIOS lo dejaron apagado):

- El cifrado BitLocker con esta plantilla *fallará al arrancar* — la política exige TPM, el dispositivo no tiene uno o está deshabilitado, y el cifrado no puede iniciarse.
- El arreglo es o bien habilitar TPM en la BIOS (a menudo posible en dispositivos donde estaba deshabilitado por defecto) o reemplazar el dispositivo.

En la práctica esto raramente importa para tenants de pequeña empresa porque el hardware con TPM ha sido estándar desde principios de los 2010. Pero ocasionalmente aparece en el inventario un dispositivo más antiguo — normalmente un sobremesa que alguien compró barato hace años — y ese dispositivo falla el despliegue de BitLocker. Manéjalo caso a caso.

## Gestión de claves de recuperación — la parte que más importa

BitLocker solo es útil si puedes recuperar los datos cifrados cuando algo va mal. Escenarios de recuperación:

- El usuario olvida su PIN (si la autenticación por PIN está configurada).
- Cambios de hardware disparan el prompt de recuperación de BitLocker (reemplazo de placa base, a veces actualización de RAM, ocasionalmente una actualización de BIOS).
- La configuración de arranque del dispositivo se vuelve inconsistente (actualización de característica de Windows, a veces un intento de arranque dual con Linux).
- El dispositivo se reinicia y la clave de recuperación es la única forma de desbloquear los datos de la instalación anterior.

La plantilla BitLocker de Panoptica365 almacena las claves de recuperación en **Microsoft Entra ID** (la ubicación moderna basada en la nube). Cuando un dispositivo Windows se une a Entra y BitLocker se inicializa, la clave de recuperación se sube a Entra automáticamente. Los operadores pueden recuperarla desde el portal de administración de Entra, en las propiedades del dispositivo.

Tres realidades operativas que entender:

**Las claves de recuperación *tienen* que aterrizar en Entra, no solo en el dispositivo.** Los dispositivos pre-gestionados por Intune que inicializaron BitLocker antes de la inscripción pueden tener las claves de recuperación almacenadas localmente en el dispositivo o en una ubicación de recuperación de AD híbrido. La plantilla de Panoptica365 no rellena retroactivamente esas claves. Tras el despliegue, ejecuta una auditoría de claves de recuperación por cliente — confirma que cada dispositivo cifrado tiene su clave subida a Entra. Los dispositivos sin claves de recuperación en Entra son dispositivos que será imposible recuperar si el usuario recibe un prompt de recuperación.

**Las claves de recuperación son por-instalación-de-SO, no por-dispositivo.** Si un dispositivo se formatea y reinstala, la nueva instalación genera una nueva clave de recuperación. La clave antigua sigue en Entra pero no sirve para la nueva instalación. La limpieza de claves de recuperación obsoletas es una tarea de mantenimiento separada; por ahora, trata la existencia de múltiples claves por número de serie del dispositivo como una pista de que el dispositivo ha sido reinstalado.

**La clave de recuperación es una preocupación de clasificación de datos del cliente.** Una clave de recuperación en las manos equivocadas desbloquea un dispositivo cifrado. Los admin del cliente con permisos de lectura en Entra pueden ver claves de recuperación para cualquier dispositivo. Esto a veces es un problema de privacidad (dispositivos gestionados por RR.HH. cifrados con personalización de PIN personal, dispositivos en industrias reguladas con requisitos de cadena de custodia). Documenta quién tiene acceso a las claves de recuperación por tenant del cliente. Audita el acceso vía el log de auditoría de Entra.

## Qué puede romperse

El despliegue de BitLocker es mayormente seguro pero no del todo. Vigila:

**Cifrado inicial lento en dispositivos más antiguos.** Cuando BitLocker se inicializa en un dispositivo que lleva años en uso, la primera pasada de cifrado puede tardar 4–8 horas y degradar significativamente el rendimiento durante ese tiempo. Programa el primer cifrado para horas fuera de oficina donde sea posible.

**Conflictos con cifrado de terceros.** Un cliente que ya tiene Symantec Endpoint Encryption, McAfee Drive Encryption u otro producto de cifrado de disco completo instalado producirá conflictos. El `bitLockerDisableWarningForOtherDiskEncryption: true` de la plantilla de Panoptica365 suprime la *advertencia*, pero el conflicto puede manifestarse como cifrado fallido o problemas de arranque. Antes de desplegar, confirma que no hay otro FDE en juego.

**Las actualizaciones de BIOS / firmware pueden disparar prompts de recuperación.** Cuando una Windows Update o una utilidad del fabricante actualiza la BIOS o el firmware del TPM, BitLocker puede detectar el cambio y exigir la clave de recuperación en el siguiente arranque. El usuario ve una pantalla azul intimidante pidiendo una clave numérica de 48 dígitos. Si la clave de recuperación está en Entra, el helpdesk puede recuperarla y guiar al usuario. Si la clave de recuperación falta en Entra, el usuario queda bloqueado. Por eso la auditoría de claves de recuperación en Entra (arriba) importa tanto.

**BitLocker en unidades extraíbles es molesto para compartir entre organizaciones.** Un usuario cifra una memoria USB con BitLocker, la lleva a una organización socia, y la máquina del socio no puede leerla (BitLocker-to-Go requiere la contraseña en cada acceso). Para clientes de pequeña empresa, el cifrado de unidades extraíbles a veces lo rechazan los usuarios — quieren que sus pendrives funcionen en todas partes. La plantilla no *exige* cifrado para acceso de escritura a unidades extraíbles (`requireEncryptionForWriteAccess: false`), así que esto es una aplicación blanda; los usuarios todavía pueden usar pendrives sin cifrar. La intención de la plantilla es «si cifras, usa este cifrado» — no «debes cifrar».

## Despliegue

Despliegue estándar por grupo piloto de la lección 1:

1. **Día 0** — despliega en 3–5 dispositivos Windows piloto. Elige dispositivos que *no* estén en uso productivo activo durante la noche (la primera pasada de cifrado es lenta).
2. **Días 1–2** — verifica que los dispositivos piloto completaron el cifrado (el portal de Intune muestra el cumplimiento de BitLocker). Confirma que las claves de recuperación aparecen en Entra para cada dispositivo piloto.
3. **Día 3–7** — observa los dispositivos piloto en uso normal. ¿Algo raro? ¿Prompts de recuperación disparados? ¿Quejas de rendimiento?
4. **Día 7** — despliegue más amplio si el piloto está limpio. Programa el despliegue del parque del cliente para que aterrice un viernes por la tarde, así la pasada de cifrado se completa durante el fin de semana.

Caso especial: un parque de cliente que nunca ha tenido BitLocker aplicado verá un impacto de rendimiento notable durante las primeras 48 horas mientras todos los dispositivos cifran en paralelo. Comunícalo al cliente con antelación. Tras la pasada inicial de cifrado, la sobrecarga continua de BitLocker es esencialmente cero.

## Qué monitorizar tras la aplicación

**Cumplimiento de BitLocker por dispositivo.** Debería estar cerca del 100% en dispositivos Windows tras la ventana inicial de cifrado. Los dispositivos que muestran no conformidad necesitan investigación por-dispositivo — normalmente TPM deshabilitado, hardware demasiado antiguo, o ajustes de BIOS que impiden el cifrado.

**Claves de recuperación en Entra.** Cada dispositivo cifrado con BitLocker debería tener una clave de recuperación en Entra. Ejecuta una auditoría trimestral: lista de dispositivos con BitLocker habilitado vs. lista de claves de recuperación en Entra. Las discrepancias son dispositivos que serán irrecuperables.

**Prompts de recuperación disparados.** Un pico de prompts de recuperación (el usuario llama al helpdesk pidiendo la clave de 48 dígitos) suele correlacionarse con una oleada de actualizaciones de Windows, actualizaciones de BIOS o cambios de hardware. Rastrea la fuente.

**Deriva del método de cifrado.** Si un dispositivo muestra BitLocker habilitado pero con un cifrado más antiguo (p. ej., AES-CBC 128 en una unidad de sistema que debería ser XTS-AES 256), probablemente el dispositivo se cifró *antes* de que la plantilla aplicara el estándar actual. El arreglo es descifrar y volver a cifrar con el método correcto, lo que es molesto y lento. Pilla esto durante el despliegue, no después.

## Qué ve Panoptica365

La respuesta honesta: no mucho, específicamente sobre BitLocker. Panoptica365 actualmente no expone el estado de BitLocker por dispositivo, el método-de-cifrado-por-dispositivo, ni el inventario de claves de recuperación en ningún sitio del panel — ninguna de esas cosas vive en el producto hoy, y nada por-dispositivo forma parte del modelo de lectura de la plataforma en absoluto.

Lo que Panoptica365 *sí* expone que es relevante para BitLocker:

- **Detección de deriva en la plantilla BitLocker Settings.** Si la plantilla desplegada en un tenant de cliente diverge de la referencia de Panoptica365 — alguien abre la consola de Intune y cambia un ajuste — el detector de deriva dispara una alerta. El operador puede revertir a la plantilla, reaplicar o aceptar la deriva, mismo flujo que la deriva de AC.
- **El contador general de cumplimiento de dispositivos.** BitLocker no es un control de cumplimiento duro en la política de cumplimiento de Windows de Panoptica365 (ver lección 2 — `bitLockerEnabled: false`), así que un dispositivo con BitLocker apagado no caerá del contador de conformes por sí solo. Pero si la política de cumplimiento ajustada por el MSP *sí* exige BitLocker, esos fallos aparecen en la ratio conforme/no-conforme.

Para visibilidad de BitLocker por dispositivo — qué dispositivo está cifrado con qué cifrado, dónde vive la clave de recuperación — los operadores profundizan en el portal de Intune o en la hoja de dispositivo de Entra. Ese es el flujo hoy.

## Lo que esto significa para el operador

Tres puntos para llevarte.

**BitLocker es fundamental — pero la historia de la recuperación es lo que más importa.** El cifrado protege contra el robo. La gestión de claves de recuperación protege contra dejar fuera a tus propios clientes. Un despliegue de BitLocker sin una historia de auditoría de claves de recuperación está a una actualización de BIOS de una crisis del helpdesk.

**La dependencia del TPM es real pero normalmente invisible.** La mayoría del hardware Windows moderno tiene TPM 2.0. Los fallos de despliegue de BitLocker son casi siempre hardware-demasiado-antiguo o TPM-deshabilitado-en-BIOS. Documenta las excepciones por-dispositivo; no las ignores.

**La política de unidades extraíbles es permisiva a propósito.** La plantilla especifica el cifrado para las unidades extraíbles pero no exige cifrado. Los usuarios mantienen sus pendrives funcionando. Si un cliente necesita más estricto (requisitos de clasificación de datos, sanidad, finanzas), personaliza esa plantilla vía la lección 10.

## Lo que viene

- **Lección 5: Defender for Endpoint (Win + Mac).** La configuración antivirus / EDR — lo que hace que Defender proteja lo que BitLocker ahora mantiene cifrado.
- **Lección 6: Firewall Settings (Windows).** Configuración del firewall de host.

Por ahora: BitLocker primero porque nada más importa si el portátil de un cliente sale por la puerta sin cifrar. Despliégalo, audita las claves de recuperación y sigue adelante.

---

*Fuentes de los datos en esta lección — Microsoft Learn sobre la gestión de BitLocker vía Intune ([Microsoft Learn — Manage BitLocker with Intune](https://learn.microsoft.com/en-us/mem/intune/protect/encrypt-devices)); referencia de métodos de cifrado de BitLocker ([Microsoft Learn — BitLocker encryption methods](https://learn.microsoft.com/en-us/windows/security/operating-system-security/data-protection/bitlocker/bitlocker-overview)); almacenamiento de claves de recuperación en Entra ID ([Microsoft Learn — BitLocker recovery in Entra ID](https://learn.microsoft.com/en-us/entra/identity/devices/device-management-azure-portal#view-bitlocker-keys)); requisitos de TPM ([Microsoft Learn — TPM and BitLocker](https://learn.microsoft.com/en-us/windows/security/hardware-security/tpm/tpm-fundamentals)).*
