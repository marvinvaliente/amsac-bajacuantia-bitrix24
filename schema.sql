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
