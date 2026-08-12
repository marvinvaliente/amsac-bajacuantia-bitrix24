-- Esquema para la app "Gastos de Baja Cuantía" (Bitrix24).
-- Se ejecuta en el MISMO proyecto Supabase que ya usa amsac-transporte-bitrix24
-- (SQL Editor → New query → pegar y ejecutar).

create table if not exists gastos_registros (
  id                  bigserial primary key,
  fecha               date not null,
  mes                 smallint not null check (mes between 1 and 12),
  numero_documento    text not null default '',
  proveedor           text not null default '',
  descripcion         text not null default '',
  nombre_proceso      text not null default '',
  justificacion       text not null default '',
  area_solicitante    text not null default '',
  monto_retenido      numeric(12,2) not null default 0,
  monto_total         numeric(12,2) not null default 0,
  estado              text not null default 'registrado' check (estado in ('registrado','informado','eliminado')),
  estado_anterior     text,
  fondo_id            bigint,
  created_by_id       text not null,
  created_by_nombre   text not null default '',
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- Migración: si la tabla gastos_registros ya existía (creada antes de esta
-- versión), agrega las columnas estado / estado_anterior sin afectar los
-- registros existentes, y amplía el check para incluir 'eliminado' (borrado
-- lógico: el gasto no se borra de verdad, solo cambia de estado, y el estado
-- previo queda guardado en estado_anterior para poder restablecerlo).
alter table gastos_registros add column if not exists estado text not null default 'registrado';
alter table gastos_registros add column if not exists estado_anterior text;
alter table gastos_registros drop constraint if exists gastos_registros_estado_check;
alter table gastos_registros add constraint gastos_registros_estado_check check (estado in ('registrado','informado','eliminado'));

create index if not exists gastos_registros_fecha_idx      on gastos_registros (fecha);
create index if not exists gastos_registros_created_by_idx on gastos_registros (created_by_id);
create index if not exists gastos_registros_estado_idx     on gastos_registros (estado);

-- Historial de auditoría simple (igual patrón que transporte_historial).
create table if not exists gastos_historial (
  id           bigserial primary key,
  gasto_id     bigint references gastos_registros(id) on delete cascade,
  accion       text not null,
  actor_id     text,
  actor_nombre text,
  detalle      jsonb,
  created_at   timestamptz not null default now()
);

-- Fondos (caja chica / circulante). Quien esté asociado a un fondo mediante
-- gastos_fondo_usuarios queda habilitado para registrar/cargar gastos.
create table if not exists gastos_fondos (
  id           bigserial primary key,
  tipo         text not null check (tipo in ('caja_chica','circulante')),
  monto_total  numeric(12,2) not null check (monto_total >= 0),
  anio         smallint not null,
  created_at   timestamptz not null default now()
);

create table if not exists gastos_fondo_usuarios (
  id          bigserial primary key,
  fondo_id    bigint not null references gastos_fondos(id) on delete cascade,
  usuario_id  text not null,
  created_at  timestamptz not null default now(),
  unique (fondo_id, usuario_id)
);

create index if not exists gastos_fondo_usuarios_usuario_idx on gastos_fondo_usuarios (usuario_id);

-- fondo_id: a qué fondo específico se carga cada gasto (para que el Dashboard
-- calcule montos exactos por fondo, en vez de estimarlos por usuario). Va
-- después de gastos_fondos porque depende de esa tabla para la llave foránea.
alter table gastos_registros add column if not exists fondo_id bigint;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'gastos_registros_fondo_id_fkey') then
    alter table gastos_registros add constraint gastos_registros_fondo_id_fkey
      foreign key (fondo_id) references gastos_fondos(id) on delete set null;
  end if;
end $$;
create index if not exists gastos_registros_fondo_idx on gastos_registros (fondo_id);

-- Nombre del proceso / Justificación: campos adicionales de Registrar gasto.
alter table gastos_registros add column if not exists nombre_proceso text not null default '';
alter table gastos_registros add column if not exists justificacion text not null default '';

-- Solicitudes: encabezado de una solicitud de compra (fondo, área, gerencia
-- responsable, clasificación, forma de pago) con su detalle de ítems. Un
-- gasto (gastos_registros) ahora se registra ELIGIENDO una solicitud ya
-- creada, y hereda de ella el fondo, área solicitante, descripción y
-- justificación (ver solicitud_id más abajo).
create table if not exists gastos_solicitudes (
  id                            bigserial primary key,
  fondo_id                      bigint references gastos_fondos(id) on delete set null,
  area_solicitante              text not null default '',
  nombre_proceso                text not null default '',
  descripcion                   text not null default '',
  justificacion                 text not null default '',
  gerencia_responsable_id       text not null default '',
  gerencia_responsable_nombre   text not null default '',
  clasificacion                 text not null check (clasificacion in ('emergente','imprevisto','recurrente')),
  forma_pago                    text not null check (forma_pago in ('efectivo','transferencia','cheque')),
  items                         jsonb not null default '[]'::jsonb,
  monto_total                   numeric(12,2) not null default 0,
  created_by_id                 text not null,
  created_by_nombre             text not null default '',
  created_at                    timestamptz not null default now()
);
create index if not exists gastos_solicitudes_fondo_idx      on gastos_solicitudes (fondo_id);
create index if not exists gastos_solicitudes_created_by_idx on gastos_solicitudes (created_by_id);

-- Nombre del proceso: se movió de "Registrar gasto" a "Crear Solicitud".
alter table gastos_solicitudes add column if not exists nombre_proceso text not null default '';

-- Estado de la solicitud: 'pendiente' al crearla; pasa a 'certificado' al
-- guardar cambios desde Certificación presupuestaria (esa acción ya exige
-- Específico Presupuestario/CEP en todos los ítems, así que guardar ahí ES
-- certificarla); pasa a 'desembolsado' desde "Desembolso de fondos" (solo
-- entonces puede usarse en Registrar factura); 'eliminada' es borrado
-- lógico. Una solicitud desembolsada o eliminada ya no se puede editar.
alter table gastos_solicitudes add column if not exists estado text not null default 'pendiente';
alter table gastos_solicitudes drop constraint if exists gastos_solicitudes_estado_check;
alter table gastos_solicitudes add constraint gastos_solicitudes_estado_check check (estado in ('pendiente','certificado','desembolsado','eliminada'));
create index if not exists gastos_solicitudes_estado_idx on gastos_solicitudes (estado);

-- Auditoría del desembolso: quién lo hizo y cuándo (se usa también en el
-- comprobante en PDF que se descarga al desembolsar).
alter table gastos_solicitudes add column if not exists desembolsado_at timestamptz;
alter table gastos_solicitudes add column if not exists desembolsado_por_id text;
alter table gastos_solicitudes add column if not exists desembolsado_por_nombre text;

-- Cotización(es) en PDF adjuntadas al crear la solicitud (array de
-- {url, nombre}, subidas al bucket público "cotizaciones" en Supabase
-- Storage vía api/upload.js). Quedan disponibles para revisión en
-- Certificación y Desembolso, y se anexan como páginas extra al PDF de
-- Desembolso.
alter table gastos_solicitudes add column if not exists cotizacion_urls jsonb not null default '[]'::jsonb;

-- solicitud_id: de qué solicitud proviene cada gasto. Los gastos creados
-- antes de que existiera esta columna quedan con solicitud_id vacío (se
-- guardaron con área/descripción/justificación propias, sin cambios).
alter table gastos_registros add column if not exists solicitud_id bigint;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'gastos_registros_solicitud_id_fkey') then
    alter table gastos_registros add constraint gastos_registros_solicitud_id_fkey
      foreign key (solicitud_id) references gastos_solicitudes(id) on delete set null;
  end if;
end $$;
create index if not exists gastos_registros_solicitud_idx on gastos_registros (solicitud_id);

-- item_numero: a qué ítem específico de la solicitud corresponde el gasto
-- ("Registrar factura o documento equivalente" registra una factura por
-- ítem, no una sola por toda la solicitud). Los gastos creados antes de
-- este cambio quedan con item_numero vacío (se registraron a nivel de toda
-- la solicitud, sin desglose por ítem).
alter table gastos_registros add column if not exists item_numero smallint;
create index if not exists gastos_registros_solicitud_item_idx on gastos_registros (solicitud_id, item_numero);

-- Número de comprobante de retención y factura/documento adjunto (PDF, uno
-- o varios) de cada gasto registrado desde "Registrar factura o documento
-- equivalente". Ambos opcionales; se suben al mismo bucket "cotizaciones"
-- en Supabase Storage vía api/upload.js.
alter table gastos_registros add column if not exists numero_comprobante_retencion text not null default '';
alter table gastos_registros add column if not exists factura_urls jsonb not null default '[]'::jsonb;
