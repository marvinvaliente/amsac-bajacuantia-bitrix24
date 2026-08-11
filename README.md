# Gastos de Baja Cuantía — App local para Bitrix24

App de una sola página (`index.source.html`), instalada como "Aplicación local" en
`amsac.bitrix24.es`, igual que `amsac-transporte-bitrix24`. La identidad, permisos y
listado de empleados/departamentos vienen del contexto de sesión de Bitrix24
(`BX24.js`); los datos de los gastos se guardan en el **mismo proyecto Supabase**
que ya usa la app de transporte, en tablas nuevas y separadas (`gastos_*`).

## Qué hace

- El menú **"Solicitud"** agrupa cuatro pantallas (se puede colapsar/expandir
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
  2. **Certificación presupuestaria**: muestra **todas las solicitudes en una
     tabla** (fecha, fondo, área, descripción, total y **estado**, con
     colores: naranja = Pendiente, verde = Certificado, azul = Desembolsado,
     rojo = Eliminada) con botones **Editar** y **Eliminar** por fila (una
     solicitud ya desembolsada no muestra estos botones — queda fija, igual
     que una eliminada). "Editar" abre el formulario (de cualquier fondo, no
     solo los propios) con todos los campos **bloqueados** (solo lectura) —
     **doble clic** en cualquiera lo habilita para corregirlo puntualmente.
     La tabla de ítems suma dos columnas que sí quedan activas de entrada:
     **Específico Presupuestario** (5 dígitos) y **CEP** (2 dígitos),
     **obligatorios en cada ítem** para poder guardar — guardar cambios aquí
     es lo que **certifica** la solicitud (pasa de Pendiente a Certificado).
     "Eliminar" es un borrado lógico: la solicitud queda en estado
     Eliminada, ya no se puede editar ni desembolsar, pero sigue visible en
     la tabla para trazabilidad.
  3. **Desembolso de fondos**: tabla con las solicitudes **Certificado** y
     **Desembolsado** (fecha, fondo, área, descripción, monto solicitado,
     estado). "Ver detalle" muestra **toda la información de la solicitud**
     (fondo, área, gerencia responsable, nombre del proceso, descripción,
     justificación, clasificación, forma de pago, la tabla completa de
     ítems con Específico Presupuestario/CEP) con el **monto solicitado**
     destacado en grande. El botón **"Desembolsar"** (solo visible si la
     solicitud está Certificado) cambia su estado a **Desembolsado**,
     guarda quién y cuándo la desembolsó, y **genera y descarga
     automáticamente un PDF** con toda esa información más la fecha y hora
     de desembolso y de impresión. Una solicitud desembolsada ya no se
     puede editar ni eliminar desde Certificación, y es la que habilita
     "Registrar factura".
  4. **Registrar factura o documento equivalente**: muestra en una tabla
     (estilo Certificación) solo las solicitudes en estado **Desembolsado**,
     con una columna **Facturación** ("N/M ítems") que indica cuántos de sus
     ítems ya tienen factura registrada. El botón **"Ver ítems"** abre la
     tabla de ítems de esa solicitud: los datos base (Tipo, Descripción,
     Precio unitario, Específico Presupuestario, CEP) se muestran de solo
     lectura como referencia, y cada ítem tiene sus propios campos
     **Fecha, N° de documento, Proveedor, Monto retenido y Monto total** —
     **la factura se registra por ítem, no una sola para toda la
     solicitud**, así que ítems de una misma solicitud pueden facturarse por
     separado (documentos parciales). Un ítem ya facturado queda bloqueado
     con la etiqueta "Facturado"; "Registrar facturas" guarda de una vez
     todas las filas que se hayan llenado por completo. El mes se calcula
     automáticamente desde la fecha; cada factura se guarda como un gasto con
     **estado `registrado`**.
- Un gasto ya registrado se edita desde **Historial** o **Informe de
  Gastos** (solo quien lo creó, mientras esté en estado `registrado`, o un
  administrador en cualquier estado); el formulario de edición muestra de
  solo lectura a qué solicitud e ítem pertenece (eso no cambia, solo se
  corrige fecha/documento/proveedor/montos). **Eliminar es un borrado
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
- **Configurar usuarios** (solo administradores): se crean **fondos** (Fondo de
  caja chica / Fondo circulante, con monto total y año) y se asocia a cada fondo
  los usuarios de Bitrix24 que pueden usarlo. Un usuario queda habilitado para
  registrar/cargar gastos únicamente si está asociado a al menos un fondo (o si
  es administrador del portal). Ya no se usa `app.option` para esto — la lista de
  autorizados se deriva de las asociaciones fondo↔usuario guardadas en Supabase.

## Base de datos (Supabase)

1. Entra al proyecto Supabase que ya usa `amsac-transporte-bitrix24`.
2. SQL Editor → New query → pega y ejecuta el contenido de [`schema.sql`](schema.sql).
   Crea `gastos_registros`, `gastos_historial`, `gastos_fondos`,
   `gastos_fondo_usuarios` y `gastos_solicitudes`; no toca ninguna tabla
   `transporte_*`. El script es seguro de volver a correr aunque las tablas ya
   existan (usa `if not exists` / migraciones idempotentes), por ejemplo para
   agregar la columna `estado` o `solicitud_id`.

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
  transporte.
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
  exista en la solicitud y que la solicitud esté en estado `desembolsado`
  antes de aceptar la factura. Los gastos creados antes de este cambio (o
  antes de que existiera "Registrar factura") quedan con `item_numero`
  vacío.
- **Flujo de estados de una solicitud**: `pendiente` (recién creada) →
  `certificado` (al guardar cambios en Certificación presupuestaria, con
  Específico Presupuestario/CEP completos) → `desembolsado` (al presionar
  "Desembolsar" en Desembolso de fondos, lo único que habilita "Registrar
  factura" para esa solicitud). `eliminada` es un borrado lógico posible
  desde `pendiente` o `certificado`; una solicitud `desembolsada` ya no se
  puede editar ni eliminar. `desembolsado_at`, `desembolsado_por_id` y
  `desembolsado_por_nombre` quedan guardados para trazabilidad y se usan en
  el PDF del comprobante.
