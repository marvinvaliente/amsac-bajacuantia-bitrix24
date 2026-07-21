# Gastos de Baja Cuantía — App local para Bitrix24

App de una sola página (`index.source.html`), instalada como "Aplicación local" en
`amsac.bitrix24.es`, igual que `amsac-transporte-bitrix24`. La identidad, permisos y
listado de empleados/departamentos vienen del contexto de sesión de Bitrix24
(`BX24.js`); los datos de los gastos se guardan en el **mismo proyecto Supabase**
que ya usa la app de transporte, en tablas nuevas y separadas (`gastos_*`).

## Qué hace

- Cualquier usuario **autorizado** (o un administrador) puede registrar un gasto de
  baja cuantía: **fondo** (solo lista los fondos a los que pertenece quien
  registra; se autoselecciona si solo tiene uno), fecha, número de documento,
  proveedor, descripción, **nombre del proceso**, **justificación**, área
  solicitante, monto retenido y monto total. El mes se calcula automáticamente
  desde la fecha. Todo gasto nuevo se guarda con **estado `registrado`**.
  "Nombre del proceso" y "Justificación" son obligatorios solo en este
  formulario individual; la carga por Excel no los pide (quedan vacíos en los
  gastos importados por ese medio).
- El mismo formulario permite editar un gasto (solo quien lo creó, mientras esté
  en estado `registrado`, o un administrador en cualquier estado). **Eliminar es
  un borrado lógico**: el gasto no se borra de la base de datos, pasa a estado
  `eliminado` (guardando el estado anterior) y deja de ser visible para todos
  salvo un administrador. Un gasto `informado` solo puede editarse/eliminarse
  por un administrador.
- **Carga por Excel**: se elige primero el **fondo** al que pertenece todo el lote
  (mismo criterio que Registrar gasto), y luego se sube un `.xlsx`/`.xls`/`.csv`
  con las columnas `fecha`, `mes`, `numero_documento`, `proveedor`,
  `descripcion`, `area_solicitante`, `monto_retenido`, `monto_total`. La app
  valida cada fila antes de importar y muestra cuáles quedaron bien y cuáles
  tienen error, sin bloquear el resto.
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
   Crea `gastos_registros`, `gastos_historial`, `gastos_fondos` y
   `gastos_fondo_usuarios`; no toca ninguna tabla `transporte_*`. El script es
   seguro de volver a correr aunque las tablas ya existan (usa `if not exists` /
   migraciones idempotentes), por ejemplo para agregar la columna `estado`.

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
- Excel (carga e importación) usa SheetJS (`xlsx.full.min.js` por CDN) en el
  navegador; PDF usa `jsPDF` + `jspdf-autotable`, igual que en transporte.
- **`fondo_id`**: cada gasto guarda a qué fondo específico pertenece (columna
  `fondo_id` en `gastos_registros`, poblada desde el selector "Fondo" en
  Registrar gasto/Cargar Excel). Los gastos creados **antes** de que existiera
  esta columna quedan con `fondo_id` vacío; en ese caso el Dashboard y el
  "Fondo" mostrado en Historial/Informe/Reportes recurren como respaldo a los
  fondos del usuario que lo registró, y solo lo resuelven sin ambigüedad si ese
  usuario pertenece a un único fondo.
