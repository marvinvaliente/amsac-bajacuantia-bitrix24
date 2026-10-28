# Gastos de Baja Cuantía — App local para Bitrix24

App de una sola página (`index.source.html`), instalada como "Aplicación local" en
`amsac.bitrix24.es`, igual que `amsac-transporte-bitrix24`. La identidad, permisos y
listado de empleados/departamentos vienen del contexto de sesión de Bitrix24
(`BX24.js`); los datos de los gastos se guardan en el **mismo proyecto Supabase**
que ya usa la app de transporte, en tablas nuevas y separadas (`gastos_*`).

## Diseño responsive

Toda la app tiene dos modos, según el ancho de pantalla (punto de corte:
**900px**, el mismo donde el menú lateral pasa de fijo a hamburguesa):

- **Escritorio (≥900px)**: el contenido aprovecha hasta 1180px de ancho
  (antes 900px fijo, se veía como una columna angosta flotando en medio de
  la pantalla). Los formularios largos (Crear Solicitud, Certificación
  presupuestaria, edición rápida de un gasto) agrupan sus campos en pares
  de dos columnas (`Fondo`/`Área solicitante`, `Descripción`/
  `Justificación`, etc.) para no obligar a hacer scroll vertical
  innecesario.
- **Tablet / celular (<900px)**: menú lateral colapsado a hamburguesa con
  overlay, todos los campos de formulario apilados en una sola columna
  (más fáciles de tocar), y las tablas con muchas columnas (ítems de una
  solicitud, Historial, Reportes, etc.) se desplazan horizontalmente
  dentro de su propio contenedor en vez de romper el diseño de la página.
  Por debajo de 480px se reduce además el padding general y crecen los
  checkboxes de las listas de usuarios para facilitar el toque.

Este comportamiento es puramente CSS (clase `.row` y el ancho de `.wrap`
según media query) — no depende de detectar el dispositivo, así que
también se adapta si alguien cambia el tamaño de la ventana en escritorio.

## Modelo de permisos

Un administrador del portal ve y puede hacer todo. Para el resto de
usuarios, el acceso a cada pantalla depende de a cuál de estos grupos
pertenezcan:

- **Solicitante** — estar asignado a un fondo (lo mismo que hoy habilita
  "usar" ese fondo, se asigna desde **Configurar usuarios**) da acceso a
  **Crear Solicitud, Registrar factura o documento equivalente, Historial
  e Informe de Gastos**. Es la misma persona quien crea la solicitud,
  registra su factura, revisa su historial y genera su informe.
- **Certificador** — acceso a **Certificación presupuestaria**. Se asigna
  desde **Configurar usuarios**, por usuario individual y/o por
  departamento completo de Bitrix24 (si el departamento del usuario está
  en la lista, tiene acceso aunque no esté asignado individualmente). No
  depende de pertenecer a ningún fondo.
- **Administrador de fondo** — acceso a **Desembolso de fondos** e
  **Informe de Gastos**, pero **solo para el/los fondo(s) que administra**:
  es un subconjunto de los usuarios asignados a un fondo (no todos los que
  pueden usarlo para crear solicitudes son también administradores de
  ese fondo). Se elige al **crear el fondo** (y se puede cambiar después
  al **editarlo**); si alguien deja de ser administrador sigue siendo
  usuario normal del fondo (no pierde el acceso a crear solicitudes
  contra él, solo el de desembolsar/informar). El servidor valida esto
  también al momento de desembolsar y de gestionar un reembolso o
  liquidación, no solo la pantalla. **Informe de Gastos ya no es de
  autoservicio para cualquier solicitante** — desde que existe la
  gestión de reintegro/liquidación, solo administradores de fondo (y del
  portal) entran ahí, y cada uno solo ve la información de sus propios
  fondos (un administrador del portal puede elegir cuál administrador
  de fondo mirar, desde un selector).
- **Certificador** también obtiene, además de "Certificar gastos", acceso
  a la pantalla hermana **"Reintegro o liquidación de fondos"** (mismo
  grupo de permiso, ver más abajo en "Qué hace").
- **Tesorería** — nuevo grupo de permiso, **independiente de
  Certificador**, con el mismo mecanismo de asignación (usuario individual
  y/o departamento completo de Bitrix24, desde **Configurar usuarios**).
  Da acceso al menú **"Tesorería"** (Reintegro de fondos / Liquidación de
  Fondos).
- **Gerencia responsable de una solicitud** — acceso a **Autorización de
  gerencia**, pero solo para autorizar o denegar las solicitudes donde esa
  persona específica fue elegida como "Gerencia responsable" al crearlas.
  A diferencia de los otros grupos, **no se asigna desde Configurar
  usuarios** — es automático: en cuanto alguien crea una solicitud
  eligiendo a un usuario de Bitrix24 en ese campo, esa persona ve la
  pestaña y puede decidir sobre ella, sin necesidad de que un
  administrador la habilite primero.

Estos grupos son independientes entre sí: un usuario puede pertenecer a
ninguno, a uno o a varios a la vez (además de ser o no administrador del
portal, que da acceso a todo sin excepción).

## Qué hace

- El menú **"Solicitud"** agrupa cinco pantallas (se puede colapsar/expandir
  haciendo clic en su encabezado):
  1. **Crear Solicitud**: encabezado de una solicitud de compra — fondo (solo
     lista los fondos a los que pertenece quien la crea), **área
     solicitante** (se busca/elige una unidad de Bitrix24), **Jefatura
     solicitante** (de solo lectura: se completa sola con el nombre de quien
     figura como jefatura de esa unidad en Bitrix24 — queda vacía si esa
     unidad no tiene jefatura asignada ahí), **Gerente responsable** (se
     busca y elige un usuario de Bitrix24), **Gerencia responsable** (de
     solo lectura: se completa sola con la unidad/departamento de Bitrix24
     a la que pertenece ese gerente), **nombre del proceso**, descripción,
     justificación, **clasificación del gasto** (Gasto Emergente / Imprevisto
     / Recurrente) y **forma de
     pago** (Efectivo / Transferencia Bancaria / Cheque). Incluye una tabla de
     **ítems** (se pueden agregar o quitar filas): tipo (Bien/Servicio),
     cantidad, descripción, precio unitario y total (se calcula solo,
     cantidad × precio unitario); el monto total de la solicitud es la suma
     de los ítems. El N° de ítem siempre queda correlativo (1, 2, 3...): si
     se quita una fila, las demás se renumeran para no dejar huecos.
     Al final del formulario, justo antes de "Crear solicitud", **"Adjuntar
     cotizaciones (PDF) \*" es obligatorio**: hay que subir al menos un
     archivo (se pueden subir varios, máx. 3 MB cada uno) para poder crear
     la solicitud. Quedan disponibles para revisión —de solo lectura— en
     Certificación presupuestaria y Desembolso de fondos, y se anexan como
     páginas adicionales al PDF que se descarga al
     desembolsar.
  2. **Autorización de gerencia** (acceso: automático para quien fue
     elegido como "Gerencia responsable" de al menos una solicitud, ver
     "Modelo de permisos"): al crear la solicitud, esa persona recibe
     automáticamente una **notificación de Bitrix24** (si
     `BITRIX24_WEBHOOK_URL` está configurada) con dos enlaces, "✅
     Autorizar" y "❌ Denegar", que la llevan directo a esta pantalla ya
     abierta en esa solicitud — y si entró justo desde uno de esos
     enlaces, el cuadro de confirmación de esa decisión ya aparece armado,
     solo falta confirmarlo. Además de por notificación, esta pantalla
     también se usa entrando normalmente por el menú: tabla con las
     solicitudes donde esa persona es
     la gerencia responsable (un administrador ve las de todos). "Ver
     detalle" muestra la misma información completa que Desembolso de
     fondos (área, descripción, justificación, ítems, cotización, monto
     solicitado). Mientras la solicitud está **Pendiente** aparecen los
     botones **"Autorizar"** y **"Denegar"**: autorizarla la deja lista
     para que un certificador la certifique; denegarla la archiva en
     estado **Denegado** (guarda quién y cuándo decidió) y ahí termina su
     proceso — no se puede editar, eliminar, certificar ni continuar de
     ninguna forma. Una solicitud ya autorizada, certificada, desembolsada,
     facturada, denegada o eliminada no muestra estos botones (ya se
     decidió o ya avanzó). El servidor exige que quien autorice o deniegue
     sea justo la gerencia responsable asignada a esa solicitud (o un
     administrador), no solo la pantalla.
  3. **Certificación presupuestaria** (acceso: certificadores, ver "Modelo
     de permisos") — desde que existe la gestión de reintegro/liquidación,
     este menú es un grupo desplegable con dos pantallas:
     - **Certificar gastos** (la pantalla de siempre) muestra **todas las
     solicitudes en una tabla** (fecha, fondo, área, descripción, total y **estado**, con
     colores: naranja = Pendiente, cian = Autorizada, verde = Certificado,
     azul = Desembolsado, morado = Facturado, terracota = Denegado, rojo =
     Eliminada) con botones **Editar** y **Eliminar** por fila. Una
     solicitud **Pendiente** (todavía sin autorizar) solo muestra
     "Eliminar" — "Editar" (certificar) no aparece hasta que su gerencia
     responsable la autorice desde "Autorización de gerencia". Una
     solicitud ya desembolsada, facturada, denegada o eliminada no muestra
     ningún botón — queda fija. "Editar" abre el formulario (de cualquier
     fondo, no
     solo los propios) con todos los campos **bloqueados** (solo lectura) —
     **doble clic** en cualquiera lo habilita para corregirlo puntualmente.
     La tabla de ítems suma dos columnas que sí quedan activas de entrada:
     **Específico Presupuestario** (5 dígitos) y **CEP** (2 dígitos),
     **obligatorios en cada ítem** para poder guardar — guardar cambios aquí
     es lo que **certifica** la solicitud (pasa de Autorizada a Certificado).
     "Eliminar" es un borrado lógico: la solicitud queda en estado
     Eliminada, ya no se puede editar ni desembolsar, pero sigue visible en
     la tabla para trazabilidad.
     - **Reintegro o liquidación de fondos** muestra las **gestiones**
     (`gastos_gestiones`) creadas desde "Informe de Gastos" que siguen
     `pendiente` de revisión, cada una con sus gastos agrupados (mismo
     fondo, mismo mes, mismo tipo — Reintegro o Liquidación). Cada gasto
     tiene un botón **"Editar"** (mismo formulario de "Registrar factura",
     por si hace falta corregir algo antes de cerrar la gestión) y cada
     gestión tiene un botón **"Confirmar revisado"**: genera un
     **comprobante en PDF** (con fecha y hora de generación, nombrado con
     el administrador del fondo, el mes y la fecha), lo sube a una carpeta
     de **Bitrix24 Disk** y le avisa por Messenger al administrador del
     fondo que ya puede imprimirlo y pedir el trámite en Tesorería (ver
     "Notas técnicas" para el detalle técnico de la subida a Disk).
  4. **Desembolso de fondos** (acceso: administradores de fondo, ver "Modelo
     de permisos" — cada uno solo ve/desembolsa las solicitudes de los
     fondos que administra, no las de otros fondos): tabla con las
     solicitudes **Certificado**, **Desembolsado** y **Facturado** (fecha,
     fondo, área, descripción, monto solicitado, estado — las dos últimas
     quedan ahí como registro, no hay nada más que hacer con ellas en esta
     pantalla). "Ver detalle" muestra **toda
     la información de la solicitud**
     (fondo, área, gerencia responsable, nombre del proceso, descripción,
     justificación, clasificación, forma de pago, la tabla completa de
     ítems con Específico Presupuestario/CEP) con el **monto solicitado**
     destacado en grande, más las cotizaciones adjuntas (si hay). El botón
     **"Desembolsar"** (solo visible si la solicitud está Certificado)
     cambia su estado a **Desembolsado**, guarda quién y cuándo la
     desembolsó, y **genera y descarga automáticamente un PDF** con toda
     esa información más la fecha y hora de desembolso y de impresión — si
     la solicitud tiene cotizaciones adjuntas, sus páginas se **anexan al
     final del mismo PDF** (fusión hecha en el navegador con pdf-lib). Una
     solicitud desembolsada ya no se puede editar ni eliminar desde
     Certificación, y es la que habilita "Registrar factura".
  5. **Registrar factura o documento equivalente**: muestra en una tabla
     (estilo Certificación) las solicitudes en estado **Desembolsado** o
     **Facturado**, con una columna **Facturación** ("N/M ítems") que
     indica cuántos de sus ítems ya tienen factura registrada (verde
     cuando están todos). Cuando el último ítem pendiente se factura, la
     solicitud pasa automáticamente de **Desembolsado** a **Facturado**; si
     luego se elimina esa factura (o cualquier otra de sus ítems) desde
     Historial, vuelve a **Desembolsado** — el estado siempre refleja si
     TODOS los ítems tienen ahora mismo una factura activa, no si alguna
     vez la tuvieron. El botón **"Ver ítems"** abre la
     tabla de ítems de esa solicitud: los datos base (Tipo, Descripción,
     Precio unitario, Específico Presupuestario, CEP) se muestran de solo
     lectura como referencia, y cada ítem tiene sus propios campos
     **Fecha, N° de documento, Proveedor, Monto retenido, N° de comprobante
     de retención, Monto total y Adjuntar factura o documento equivalente**
     — **la factura se registra por ítem, no una sola para toda la
     solicitud**, así que ítems de una misma solicitud pueden facturarse por
     separado (documentos parciales). El **N° de comprobante de retención**
     es un campo alfanumérico libre y opcional. **Adjuntar factura o
     documento equivalente** permite subir uno o más PDF (mismo mecanismo y
     límite de 3 MB por archivo que "Adjuntar cotizaciones"), también
     opcional. Un ítem ya facturado queda bloqueado con la etiqueta
     "Facturado", mostrando el comprobante guardado y el/los PDF adjuntos
     como enlaces de solo lectura; "Registrar facturas" guarda de una vez
     todas las filas que se hayan llenado por completo. El mes se calcula
     automáticamente desde la fecha; cada factura se guarda como un gasto con
     **estado `registrado`**.
- Un gasto ya registrado se edita desde **Historial** o **Informe de
  Gastos** (solo quien lo creó, mientras esté en estado `registrado`, o un
  administrador en cualquier estado); el formulario de edición muestra de
  solo lectura a qué solicitud e ítem pertenece (eso no cambia, solo se
  corrige fecha/documento/proveedor/montos). El N° de comprobante de
  retención y los PDF de factura adjuntos no tienen campo en este
  formulario reducido, así que se conservan tal cual quedaron al
  registrarse. **Eliminar es un borrado
  lógico**: el gasto no se borra de la base de datos, pasa a estado
  `eliminado` (guardando el estado anterior) y deja de ser visible para
  todos salvo un administrador. Un gasto `informado` solo puede
  editarse/eliminarse por un administrador.
- **Historial**: lista de gastos (los administradores ven todos, solo los
  propios, o los **eliminados**; el resto de usuarios autorizados solo ve los
  suyos, nunca los eliminados). Desde la vista "Eliminados" (solo admin) se
  puede **restablecer** un gasto a su estado anterior (`registrado` o
  `informado`).
- **Informe de Gastos** (acceso: administradores de fondo y del portal, ver
  "Modelo de permisos"): el administrador elige **Fondo** y un rango de
  fechas **Desde / Hasta**, y ve los gastos con factura o documento
  equivalente registrado en ese rango (estado `registrado`, de ese fondo,
  sin importar quién los registró). Todos vienen marcados: **marca o
  desmarca los que quiere reintegrar o liquidar** (hay "Seleccionar todos"
  y un resumen con la cantidad y el total). En el fondo circulante además
  indica la **cuenta bancaria** (banco y número) donde Tesorería hará la
  transferencia. **"Gestionar Reembolso o liquidación"** pregunta si es
  **Reintegro** o **Liquidación** (queda guardado) y crea la gestión con
  *solo los gastos marcados*, que pasan a `informado`. Un administrador
  del portal puede elegir de qué administrador de fondo ver la
  información. Arriba aparece un aviso si tiene un reintegro de caja chica
  por confirmar (ver "Reintegro de fondos").
- **Reportes** (disponible para todo usuario habilitado, no solo administradores):
  filtra todos los gastos por Nombre, Cargo y Unidad del usuario que los
  registró (tomados de Bitrix24: `user.get` / `department.get`), más rango de
  fechas, y descarga el resultado en **Excel** o **PDF** (el PDF incluye además
  el fondo asociado a quien registró cada gasto). El filtro por **Estado**
  (registrado/informado) solo lo ve un administrador.
- **Dashboard** (disponible para todo usuario habilitado, no solo administradores):
  por cada fondo, muestra a cada usuario asignado con su foto de perfil de
  Bitrix24 (o iniciales si no tiene foto o la foto falla al cargar), su monto
  **Registrado** (naranja) y su monto **Informado** (verde) del período
  filtrado, calculado a partir del fondo real (`fondo_id`) de cada gasto —no de
  una estimación por usuario—, así que un usuario con varios fondos ve su gasto
  repartido correctamente entre ellos. Filtros por Tipo de fondo, Año, Mes y
  Usuario. Si hay algún monto informado en el resultado filtrado, aparece el
  botón **"Descargar informe (PDF)"**. Los datos se recalculan cada vez que se
  abre la pestaña o se le da "Actualizar" (no hay un socket de tiempo real;
  refleja el estado más reciente guardado en Supabase al momento de
  cargar/actualizar).
- **Tesorería** (acceso: grupo de permiso Tesorería, ver "Modelo de
  permisos"): menú con **"Reintegro de fondos"** y **"Liquidación de
  Fondos"**. Solo aparece lo que Presupuesto ya autorizó.
  - **Reintegro, fondo circulante**: Tesorería ve la cuenta bancaria del
    administrador, hace la transferencia, y sube el **acuerdo municipal
    (PDF)** y el **comprobante de transferencia (imagen o PDF)**. Al
    registrar, la gestión se **cierra** y se notifica al administrador.
  - **Reintegro, caja chica**: Tesorería sube el **acuerdo municipal (PDF)**
    y el **voucher o cheque de desembolso (imagen o PDF)**; la gestión queda
    **entregada** y el administrador del fondo recibe un aviso. Él debe
    **confirmar que lo recibió** (desde el aviso en Informe de Gastos) y
    ahí se cierra. **Mientras no lo confirme no puede usar ese fondo**:
    crear solicitudes, desembolsar o registrar facturas contra la caja
    chica muestra una ventana emergente para confirmarlo en el momento y
    la acción continúa sola; el servidor también lo bloquea (error 409).
  - **Liquidación**: Tesorería solo la acepta (cierra), como antes.
  Imágenes de más de 1,5 MB se reducen en el navegador antes de subirlas
  (límite de 3 MB por archivo); se guardan en el bucket `comprobantes` de
  Supabase Storage (se crea solo, PDF + JPG/PNG/WEBP).
- **Configurar usuarios** (solo administradores): tiene tres partes.
  1. **Crear fondo**: además de tipo/monto/año, tiene un buscador con
     checklist **"Administrador(es) del fondo"** — quienes se marquen aquí
     podrán **desembolsar** las solicitudes de ese fondo. Si alguno todavía
     no es usuario del fondo, se agrega automáticamente al guardar (un
     administrador siempre es también usuario del fondo). Al **editar** un
     fondo, este mismo checklist aparece precargado con los administradores
     actuales y se puede modificar (agregar/quitar) igual que al crearlo.
  2. **Fondos creados**: cada fondo muestra sus usuarios asignados y sus
     administradores como **chips con una "×"** — clic ahí para
     desasociar a esa persona al toque, sin abrir ningún modal (quitar un
     chip de "usuarios asignados" lo saca por completo del fondo, incluido
     como administrador si lo era; quitar un chip de "administradores"
     solo le retira ese rol, sigue siendo usuario normal del fondo). El
     botón **"Asignar usuarios"** abre un modal para dar acceso al fondo
     (Crear Solicitud, Registrar factura, Historial e Informe) con tres
     formas de elegir, combinables entre sí: **"Seleccionar todos los
     usuarios"** (un solo checkbox), **"Asignar por departamento"**
     (checklist de departamentos de Bitrix24 — marcar uno agrega a todos
     sus miembros) y **"Asignar por usuario individual"** (buscador +
     checklist, como antes). Este modal ya no gestiona administradores —
     eso se hace desde "Crear fondo" / "Editar". Un usuario queda
     habilitado para usar la app únicamente si está asignado a al menos un
     fondo, es certificador, es administrador de algún fondo, o es
     administrador del portal.
  3. **Certificación presupuestaria**: dos listas de checkboxes —
     **usuarios certificadores** (buscador + lista de todos los usuarios de
     Bitrix24) y **departamentos certificadores** (lista de todos los
     departamentos). "Guardar certificadores" reemplaza la lista completa
     de una vez.
  4. **Tesorería**: mismo mecanismo que "Certificación presupuestaria"
     (usuarios individuales + departamentos completos), pero es un grupo
     de permiso **independiente** — alguien puede ser certificador,
     tesorería, ambos o ninguno. "Guardar tesorería" reemplaza la lista
     completa de una vez.
  Ya no se usa `app.option` para nada de esto — todo se deriva de
  `gastos_fondo_usuarios` (con su columna `es_administrador`),
  `gastos_certificadores` y `gastos_tesoreria`, guardadas en Supabase.

## Base de datos (Supabase)

1. Entra al proyecto Supabase que ya usa `amsac-transporte-bitrix24`.
2. SQL Editor → New query → pega y ejecuta el contenido de [`schema.sql`](schema.sql).
   Crea `gastos_registros`, `gastos_historial`, `gastos_fondos`,
   `gastos_fondo_usuarios`, `gastos_solicitudes`, `gastos_tesoreria` y
   `gastos_gestiones`; no toca ninguna tabla `transporte_*`. El script es
   seguro de volver a correr aunque las tablas ya existan (usa `if not
   exists` / migraciones idempotentes), por ejemplo para agregar la columna
   `estado`, `solicitud_id`, `numero_comprobante_retencion`,
   `jefatura_solicitante`, `gerencia_responsable_unidad` o `gestion_id`.
3. Las cotizaciones y facturas en PDF se guardan en **Supabase Storage**, en
   un bucket llamado `cotizaciones` (mismo bucket para ambas). No hace falta
   crearlo a mano: `api/upload.js` lo crea automáticamente (público, solo
   PDF, 3 MB máx. por archivo) la primera vez que alguien adjunta un
   archivo. Si prefieres crearlo tú antes, ve a **Storage → New bucket** en
   el panel de Supabase, nómbralo `cotizaciones` y márcalo como **público**.

## Variables de entorno (Vercel)

Mismas credenciales que ya usa el proyecto de transporte (mismo proyecto Supabase):

- `SUPABASE_URL`
- `SUPABASE_SECRET` (service role key — solo se usa en las funciones `api/*.js`, nunca en el navegador)
- `BITRIX24_WEBHOOK_URL`: webhook entrante de Bitrix24 con scopes **`im`** y
  **`disk`** (ver "Instalación en Bitrix24" para cómo crearlo). Con solo
  `im` (opcional) la app funciona igual salvo por el aviso a la gerencia
  responsable, que simplemente no se envía. **`disk` es obligatorio** desde
  que existe "Confirmar revisado" en Certificación presupuestaria →
  "Reintegro o liquidación de fondos": esa acción sube el comprobante PDF
  a Bitrix24 Disk como paso obligatorio (no best-effort, ver "Notas
  técnicas") — sin ese scope, "Confirmar revisado" falla con un error
  claro en vez de completarse a medias.
- `BITRIX24_APP_URL` (opcional): la URL con la que Bitrix24 abre esta app
  embebida dentro del portal — se ve en la barra de direcciones al abrir la
  app desde el menú de aplicaciones, tiene la forma
  `https://<tu-portal>.bitrix24.es/marketplace/app/<id>/`. Se usa para que
  los enlaces "Autorizar"/"Denegar" de la notificación reabran la app
  autenticada dentro de Bitrix24, en vez de como una pestaña suelta del
  navegador (donde `BX24.init()` no puede autenticar y la app se queda
  cargando para siempre). Si no se configura, esos enlaces usan la URL
  directa de la app (`https://<host>/index.html`) — funciona solo si ya hay
  una sesión de Bitrix24 activa en el mismo navegador al hacer clic.

## Desarrollo local

`index.source.html` es el archivo fuente editable. `api/handler.js` es un
**archivo generado**: sirve el HTML como string desde una función serverless. Tras
editar `index.source.html`, regenera `handler.js` con:

```bash
node build.js
```

No edites `api/handler.js` directamente; los cambios se perderían en el próximo build.

## Despliegue

Igual que transporte: conectar la carpeta a un proyecto Vercel (`vercel.json` ya
trae el rewrite `/index.html → /api/handler`) y configurar las variables de
entorno anteriores.

## Instalación en Bitrix24

1. Entra a **Aplicaciones → Recursos para desarrolladores → Otro → "Cree webhooks
   entrantes o salientes, o una aplicación local"**.
2. Elige **"Aplicación local"**, tipo **Estática** (Static), apuntando a la URL
   desplegada en Vercel (ej. `https://<tu-proyecto>.vercel.app/index.html`).
3. Nombre sugerido: `Gastos de Baja Cuantía`.
4. **Permisos (scopes)**: marca `user` (para `user.current`, `user.admin`,
   `user.get`, `department.get`) — no necesita `calendar` como transporte.
5. Guarda e instala la app en el portal.
6. Ábrela una vez como administrador y ve a **"Configurar usuarios"**: crea al
   menos un fondo (tipo, monto total, año) y asígnale los usuarios que podrán
   registrar gastos.
7. Comparte el acceso desde el menú de aplicaciones del portal con el resto de
   usuarios autorizados.
8. Entra a **Aplicaciones → Recursos para desarrolladores → Otro → "Cree
   webhooks entrantes o salientes..."**, elige **"Webhook entrante"**, y en
   el buscador de permisos agrega **dos** scopes:
   - `im` (busca "im" y elige la opción cuyo código sea exactamente
     **`(im)`**, por ejemplo "Chat y Notificaciones (im)" — no
     `messageservice`, `im.import` ni `imconnector`, que son otra cosa) —
     opcional, habilita el aviso a la gerencia responsable y al
     administrador de fondo.
   - `disk` (busca "disk" o "Bitrix24.Disk" y elige esa opción) —
     **obligatorio**, es donde se guardan los comprobantes PDF de
     "Confirmar revisado" (ver "Notas técnicas").
   Guarda. Copia la URL generada (tiene la forma
   `https://<tu-portal>.bitrix24.es/rest/<id>/<código>/`) y agrégala como
   `BITRIX24_WEBHOOK_URL` en las variables de entorno de Vercel (sección
   anterior). Las notificaciones y los archivos quedan como si los enviara/
   subiera el usuario dueño del webhook — por eso los comprobantes de
   todos los administradores de fondo terminan en subcarpetas dentro del
   Disk de esa misma cuenta (ver "Notas técnicas"), no en el Disk personal
   de cada uno.
9. (Opcional, para que los enlaces "Autorizar"/"Denegar" de esa notificación
   reabran la app embebida y autenticada dentro de Bitrix24 en vez de una
   pestaña suelta) Abre la app una vez desde el menú de aplicaciones del
   portal, copia la URL que queda en la barra de direcciones (tiene la forma
   `https://<tu-portal>.bitrix24.es/marketplace/app/<id>/`) y agrégala como
   `BITRIX24_APP_URL` en Vercel.
10. Después de agregar cualquiera de las dos variables anteriores, hace
    falta un **redeploy** en Vercel — agregar una variable de entorno no
    afecta a los deployments que ya existen.

## Notas técnicas

- No hay servidor de sesiones propio: la identidad (`actor_id`, `actor_is_admin`)
  llega desde el navegador en cada llamada a `/api/gastos`, igual modelo de
  confianza que `transporte_*` (herramienta interna, no expuesta al público).
- "Cargo" y "Unidad" en Reportes salen de `WORK_POSITION` y `UF_DEPARTMENT` de
  `user.get`/`department.get` de Bitrix24, no se guardan en la tabla de gastos.
- **`jefatura_solicitante` / `gerencia_responsable_unidad`**: se calculan en
  el navegador, no en el servidor, a partir de datos ya cargados de Bitrix24
  (`allUsers`/`allDepartments`) — `jefatura_solicitante` busca el
  departamento elegido en "Área solicitante" por nombre y toma su
  `UF_HEAD` (el usuario que Bitrix24 tiene registrado como jefatura de esa
  unidad); `gerencia_responsable_unidad` toma el primer `UF_DEPARTMENT` del
  usuario elegido como "Gerente responsable". El servidor los guarda tal
  cual se lo mandan, sin volver a resolverlos (mismo modelo de confianza
  que `gerencia_responsable_nombre`). Como "Área solicitante" se guarda
  como texto libre (no como id de departamento), al recargar una solicitud
  ya existente en Certificación su id se vuelve a inferir buscando un
  departamento cuyo nombre coincida exactamente — si no hay coincidencia
  (p. ej. el área se escribió a mano sin elegirla del listado), "Jefatura
  solicitante" simplemente queda vacía hasta que alguien la corrija con
  doble clic. Cambiar "Área solicitante" o "Gerente responsable" con doble
  clic en Certificación recalcula estos dos campos al vuelo con la nueva
  elección.
- La exportación a Excel (Reportes) usa SheetJS (`xlsx.full.min.js` por CDN)
  en el navegador; PDF usa `jsPDF` + `jspdf-autotable`, igual que en
  transporte. El PDF de Desembolso además usa `pdf-lib` (CDN) para anexarle
  las cotizaciones adjuntas como páginas extra.
- **Cotizaciones (PDF)**: `api/upload.js` las sube a Supabase Storage (bucket
  `cotizaciones`, público) usando la service role key; el navegador nunca
  ve esa key, solo manda el PDF en base64 a este endpoint. Al ser un bucket
  público, cualquiera con el enlace exacto (una URL larga con un sufijo
  aleatorio) puede abrir el archivo — igual de "protegido por oscuridad"
  que el resto de esta herramienta interna, no es un control de acceso
  real. Límite de 3 MB por archivo (margen para el límite de payload de
  las funciones de Vercel); se puede subir más de un PDF por solicitud.
  Es obligatorio al **crear** una solicitud (al menos un PDF); al
  **certificarla** (Certificación presupuestaria) no se vuelve a exigir,
  para no bloquear solicitudes creadas antes de que este campo existiera
  — ese formulario solo las conserva de solo lectura, no ofrece forma de
  agregarlas.
- **`fondo_id`**: cada gasto guarda a qué fondo específico pertenece (columna
  `fondo_id` en `gastos_registros`). Los gastos creados **antes** de que
  existiera esta columna quedan con `fondo_id` vacío; en ese caso el Dashboard y
  el "Fondo" mostrado en Historial/Informe/Reportes recurren como respaldo a
  los fondos del usuario que lo registró, y solo lo resuelven sin ambigüedad si
  ese usuario pertenece a un único fondo.
- **`solicitud_id`**: desde que existe "Crear Solicitud", cada gasto se crea
  eligiendo una solicitud (`gastos_solicitudes`) y el servidor copia de ahí
  `fondo_id`, `area_solicitante`, `nombre_proceso`, `descripcion` y
  `justificacion` hacia la fila del gasto — nunca se confía en esos valores si los manda el navegador. Por
  eso Historial, Informe, Reportes, Dashboard y las exportaciones no cambiaron:
  siguen leyendo esos campos directo del gasto. Editar un gasto (incluidos los
  creados antes de que existiera este flujo) exige elegir una solicitud, igual
  como ya exigía elegir un fondo antes de este cambio.
- **`item_numero`**: "Registrar factura o documento equivalente" guarda una
  factura por **ítem** de la solicitud (no una por toda la solicitud), así
  que cada gasto creado desde ahí queda enlazado al `numero` del ítem dentro
  de `gastos_solicitudes.items` (jsonb). El servidor exige que ese ítem
  exista en la solicitud y que la solicitud esté en estado `desembolsado` o
  `facturado` antes de aceptar la factura (`facturado` se acepta para poder
  corregir una factura ya registrada aun cuando la solicitud ya esté
  completa). Los gastos creados antes de este cambio (o antes de que
  existiera "Registrar factura") quedan con `item_numero` vacío.
- **Flujo de estados de una solicitud**: `pendiente` (recién creada, a la
  espera de que su gerencia responsable decida) → `autorizada` (la
  gerencia responsable la aprueba desde "Autorización de gerencia") o
  `denegado` (la rechaza; queda archivada ahí, fin del proceso) →
  `certificado` (solo una solicitud `autorizada` se puede certificar; al
  guardar cambios en Certificación presupuestaria, con Específico
  Presupuestario/CEP completos) → `desembolsado` (al presionar
  "Desembolsar" en Desembolso de fondos, lo único que habilita "Registrar
  factura" para esa solicitud) → `facturado` (automático: `api/gastos.js`
  recalcula tras cada alta/edición/borrado/restauración de un gasto con
  `item_numero` si TODOS los ítems de la solicitud tienen ya una factura
  activa; si se elimina la de algún ítem, vuelve solo a `desembolsado`,
  nunca hace falta tocarlo a mano). `eliminada` es un borrado lógico
  posible desde `pendiente`, `autorizada` o `certificado`; una solicitud
  `desembolsada`, `facturada` o `denegada` ya no se puede editar ni
  eliminar. `desembolsado_at`, `desembolsado_por_id` y
  `desembolsado_por_nombre` quedan guardados para trazabilidad y se usan
  en el PDF del comprobante; `gerencia_decision_at`,
  `gerencia_decision_por_id` y `gerencia_decision_por_nombre` guardan
  quién autorizó o denegó y cuándo.
- **Permisos por módulo** (`gastos_fondo_usuarios.es_administrador` y
  `gastos_certificadores`): ver "Modelo de permisos" más arriba. Las
  acciones `desembolsar`, `autorizar` y `denegar` en `api/solicitudes.js`
  validan en el servidor (no solo en la pantalla) que quien las invoca sea
  administrador del portal, administrador del fondo de esa solicitud
  específica (para desembolsar), o justo la gerencia responsable asignada
  a esa solicitud (para autorizar/denegar) — así que ni siquiera llamando
  directo a la API se puede saltar esas restricciones. `action=update`
  (certificar) también valida en el servidor que la solicitud esté
  `autorizada` o ya `certificado` antes de aceptar el cambio. Crear
  Solicitud no tiene ese refuerzo (mismo modelo de confianza que el resto
  de la app, ver el primer punto de esta sección); estas otras acciones sí
  lo tienen por mover fondos reales o decidir el rumbo del proceso.
- **`numero_comprobante_retencion` / `factura_urls`**: campos opcionales de
  "Registrar factura o documento equivalente", uno por ítem/gasto. El
  comprobante es texto libre; `factura_urls` es un array `{url, nombre}`
  igual que `cotizacion_urls`, subido con el mismo `api/upload.js` al mismo
  bucket `cotizaciones`. Al editar un gasto desde Historial (formulario
  reducido, sin estos campos) el servidor exige que el navegador reenvíe
  ambos valores sin cambios para no perderlos — el frontend los captura al
  cargar el formulario y los reenvía tal cual.
- **Notificación a la gerencia responsable**: al crear una solicitud (acción
  `create` en `api/solicitudes.js`), si `BITRIX24_WEBHOOK_URL` está
  configurada, el servidor llama a `im.notify.system.add` de Bitrix24 (best
  effort — si falla o no está configurada, no bloquea la creación) con un
  mensaje en BBCode que incluye `[URL=...]Autorizar[/URL]` y
  `[URL=...]Denegar[/URL]` apuntando a `BITRIX24_APP_URL` (o, si no está
  configurada, a la URL directa de esta app deducida de los headers de la
  petición) con `?solicitud=<id>&accion=autorizar|denegar` agregado.
  `im.notify`/`im.notify.system.add` **no admiten autorización por sesión**
  (`BX24.callMethod` desde el navegador) — devuelven `WRONG_AUTH_TYPE` — por
  eso este aviso solo puede enviarse desde el servidor con un webhook, y el
  webhook necesita el scope **`im`** específicamente (con otro scope,
  Bitrix24 responde `401 insufficient_scope`). Al abrir ese enlace, el
  frontend (`manejarDeepLinkAutorizacion` en `index.source.html`) lee
  `?solicitud=`/`?accion=`. Bitrix24 embebe la app en un `<iframe>` con su
  propio `src` fijo (la URL "Handler" configurada al instalar la app), **sin
  reenviarle el query string** del enlace de la notificación — ese
  `?solicitud=&accion=` se queda en la URL de la pestaña/página que
  contiene el iframe, no en la del iframe mismo, así que
  `window.location.search` llega vacío. Por eso primero se intenta ahí y,
  si viene vacío, se cae de vuelta a `document.referrer` (que sí conserva
  la URL completa de la página que embebió el iframe, confirmado con una
  prueba con un iframe real). Una vez leídos, limpia la barra de
  direcciones, abre "Autorización de gerencia" directo en esa solicitud y,
  si la acción es autorizar/denegar y sigue `pendiente`, deja el modal de
  confirmación ya abierto. **Esto solo funciona si el enlace abre la app embebida dentro de
  Bitrix24** (autenticada vía `BX24.js`) — de ahí `BITRIX24_APP_URL`
  apuntando a la URL tipo `marketplace/app/<id>/` con la que Bitrix24 abre
  la app desde su propio menú; sin esa variable, o si el enlace igual abre
  una pestaña suelta del navegador fuera de Bitrix24, `BX24.init()` nunca
  logra autenticar y la app se queda cargando — por eso hay además un
  timeout de 6 segundos que reemplaza el "Cargando..." por un mensaje
  explicando que hay que entrar desde el menú de aplicaciones de Bitrix24 y
  buscar "Autorización de gerencia" ahí.
- **Gestión de reintegro/liquidación** (`gastos_gestiones`, `api/gestiones.js`):
  agrupa los gastos `registrado` de **un fondo, un mes y un tipo**
  (Reintegro o Liquidación) en una sola fila, y pasa todos esos gastos a
  `informado` marcados con `gestion_id`. Flujo de estados: `pendiente`
  (recién creada desde Informe de Gastos) → `revisado` (un certificador
  confirma en "Reintegro o liquidación de fondos"; genera y sube el PDF) →
  `cerrado` (Tesorería confirma el reintegro emitido o acepta la
  liquidación). `action=crear` valida en el servidor que quien la crea sea
  administrador de ese fondo específico (`gastos_fondo_usuarios.es_administrador`)
  o un administrador del portal; en este último caso, si el administrador
  del portal gestionó **en nombre de** otro administrador de fondo (elegido
  en el selector de Informe de Gastos), `administrador_id`/
  `administrador_nombre` en la gestión quedan con esa persona, no con quien
  ejecutó la acción (`actor_id`) — así el comprobante y la notificación
  llegan a quien realmente administra el fondo. `action=revisar` exige ser
  certificador o administrador, y **subir el PDF a Bitrix24 Disk es un
  requisito duro, no best-effort**: si falla (por ejemplo, falta el scope
  `disk` en el webhook, o los métodos `disk.storage.addfolder`/
  `disk.folder.addsubfolder` no se comportan como se infirió de la
  documentación — su forma exacta de parámetros no está 100% confirmada,
  a diferencia de `disk.folder.uploadfile` que sí se verificó), la gestión
  se queda en `pendiente` y el certificador ve el error tal cual en
  pantalla, sin registrar nada a medias. `action=cerrar` exige ser
  Tesorería o administrador, y que la gestión ya esté `revisado`.
- **Carpeta de Bitrix24 Disk**: por decisión explícita, los comprobantes
  **no** se guardan en el Disk personal ("Mi unidad") de cada
  administrador de fondo — acceder al Disk personal de otro usuario desde
  un webhook no está garantizado por la API de Bitrix24. En su lugar,
  `subirPdfADisk()` en `api/gestiones.js` usa el primer almacenamiento que
  devuelve `disk.storage.getlist` (el del usuario dueño del webhook) y
  crea ahí, la primera vez, una carpeta raíz **"Gastos de Baja Cuantía"**
  con una subcarpeta por administrador de fondo (nombrada igual que la
  persona); los PDF posteriores de ese mismo administrador se acumulan en
  su subcarpeta ya existente. `disk.folder.uploadfile` (la única llamada
  cuya forma de parámetros está confirmada en la documentación) sube el
  archivo en base64 con `generateUniqueName: true`, así que dos
  comprobantes con el mismo nombre no se pisan.
- **PDF del comprobante**: se genera en el navegador con `jsPDF` +
  `jspdf-autotable` (mismo patrón que el comprobante de Desembolso),
  nombrado `<Administrador>_<Reintegro|Liquidación>_<Mes>_<Año>_<fecha>.pdf`
  e incluye fecha y hora de generación. El servidor nunca genera PDF —
  solo recibe el base64 ya armado y lo sube a Disk.

## Certificación presupuestaria ligada al presupuesto aprobado (Presupuesto 2027)

Desde esta versión, **certificar una solicitud depende de lo aprobado por el
Departamento de Presupuesto** para baja cuantía en el sistema *Presupuesto
2027* (`D:\Presupuesto inventario 2027\sistema`). Ambos sistemas usan el
**mismo proyecto Supabase**; esta app solo **lee** el esquema `presupuesto`
(`bc_presupuestos` / `bc_items`) a través de `api/presupuesto.js` — no copia
ni duplica montos, no necesita variables de entorno nuevas ni migraciones.
Todo aumento, disminución, específico agregado o quitado lo hace Presupuesto
desde su sistema y se refleja aquí al instante.

Reglas (las aplica el **servidor** en `action=update` de `api/solicitudes.js`,
no solo la pantalla):

- Solo cuenta lo que está **aprobado** y no quitado. Si el presupuesto de la
  unidad sigue en borrador/enviado, no se puede certificar.
- **Año**: el del fondo de la solicitud (`gastos_fondos.anio`). Para usar 2028
  basta crear el fondo 2028 aquí y que Presupuesto cargue/apruebe el 2028
  allá. Si Presupuesto **todavía no tiene ningún** presupuesto de baja
  cuantía de ese año (hoy el fondo 2026), no se aplica control.
- **Unidad**: departamento de Bitrix24 del "Área solicitante" (por id si hay,
  si no por nombre sin distinguir mayúsculas/tildes).
- **Fondo**: Caja chica → `caja_chica`; Fondo circulante → `fondo_circulante`
  más `fondo_flotas` si esa unidad lo tiene (Monitoreo y Mantenimiento de
  Flotas).
- Por **específico**: lo pedido en la solicitud no puede superar
  *aprobado − comprometido*. Comprometido = ítems de solicitudes ya
  certificadas, desembolsadas o facturadas (mismo tipo de fondo, año y
  unidad); denegar o eliminar una solicitud libera su monto. Un específico
  sin monto aprobado para esa unidad tampoco se puede certificar.
- Si no se puede consultar Presupuesto, **no se certifica a ciegas** (error).

En el formulario de Certificación aparece el panel **"Disponibilidad
presupuestaria"** (aprobado, ya comprometido, disponible y lo que pide esta
solicitud, resaltando en rojo lo que excede).

## Flujo de reintegro (v2)

1. **Administrador de fondo** (Informe de Gastos): elige fondo y rango de
   fechas, marca los gastos y los envía → gestión `pendiente`.
2. **Presupuesto** (certificadores; Certificación presupuestaria →
   "Reintegro o liquidación de fondos"): revisa, **modifica con "Editar" si
   es necesario** y pulsa **"Autorizar y enviar a Tesorería"** → se genera el
   PDF (fecha y hora), se guarda en Bitrix24 Disk, el total se **recalcula**
   con lo que quedó tras las ediciones y se notifica al administrador y a
   los usuarios de Tesorería asignados individualmente → `revisado`.
3. **Tesorería**: sube acuerdo municipal y comprobante → circulante
   `cerrado`; caja chica `entregado`.
4. **Caja chica**: el administrador confirma la recepción → `cerrado`.

Estados de `gastos_gestiones`: `pendiente` → `revisado` → (`entregado`) →
`cerrado`. Columnas nuevas (migración `migracion-reintegro-v2.sql`):
`fecha_desde`, `fecha_hasta`, `cuenta_bancaria`, `acuerdo_*`,
`comprobante_*`, `tesoreria_*`. Acciones de `api/gestiones.js`: `crear`,
`revisar`, `registrar_tesoreria`, `confirmar` y `cerrar` (esta última solo
para liquidaciones).
