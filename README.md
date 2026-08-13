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
- **Administrador de fondo** — acceso a **Desembolso de fondos**, pero
  **solo para las solicitudes del/los fondo(s) que administra**: es un
  subconjunto de los usuarios asignados a un fondo (no todos los que
  pueden usarlo para crear solicitudes son también administradores de
  ese fondo). Se elige al **crear el fondo** (y se puede cambiar después
  al **editarlo**); si alguien deja de ser administrador sigue siendo
  usuario normal del fondo (no pierde el acceso a crear solicitudes
  contra él, solo el de desembolsar). El servidor valida esto también al
  momento de desembolsar, no solo la pantalla.
- **Gerencia responsable de una solicitud** — acceso a **Autorización de
  gerencia**, pero solo para autorizar o denegar las solicitudes donde esa
  persona específica fue elegida como "Gerencia responsable" al crearlas.
  A diferencia de los otros tres grupos, **no se asigna desde Configurar
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
     lista los fondos a los que pertenece quien la crea), área solicitante,
     **nombre del proceso**, descripción, justificación, **gerencia
     responsable** (se busca y elige un usuario de Bitrix24), **clasificación
     del gasto** (Gasto Emergente / Imprevisto / Recurrente) y **forma de
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
     "Modelo de permisos"): tabla con las solicitudes donde esa persona es
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
     de permisos"): muestra **todas las solicitudes en una
     tabla** (fecha, fondo, área, descripción, total y **estado**, con
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
- **Informe de Gastos**: cada usuario filtra sus propios gastos con estado
  `registrado` por mes, puede editarlos/eliminarlos, y con el botón **"Informar
  gastos"** los marca todos como `informado` en un solo paso.
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
  Ya no se usa `app.option` para nada de esto — todo se deriva de
  `gastos_fondo_usuarios` (con su columna `es_administrador`) y
  `gastos_certificadores`, guardadas en Supabase.

## Base de datos (Supabase)

1. Entra al proyecto Supabase que ya usa `amsac-transporte-bitrix24`.
2. SQL Editor → New query → pega y ejecuta el contenido de [`schema.sql`](schema.sql).
   Crea `gastos_registros`, `gastos_historial`, `gastos_fondos`,
   `gastos_fondo_usuarios` y `gastos_solicitudes`; no toca ninguna tabla
   `transporte_*`. El script es seguro de volver a correr aunque las tablas ya
   existan (usa `if not exists` / migraciones idempotentes), por ejemplo para
   agregar la columna `estado`, `solicitud_id` o `numero_comprobante_retencion`.
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

## Notas técnicas

- No hay servidor de sesiones propio: la identidad (`actor_id`, `actor_is_admin`)
  llega desde el navegador en cada llamada a `/api/gastos`, igual modelo de
  confianza que `transporte_*` (herramienta interna, no expuesta al público).
- "Cargo" y "Unidad" en Reportes salen de `WORK_POSITION` y `UF_DEPARTMENT` de
  `user.get`/`department.get` de Bitrix24, no se guardan en la tabla de gastos.
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
