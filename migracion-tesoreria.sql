create table if not exists gastos_tesoreria (
  id          bigserial primary key,
  tipo        text not null check (tipo in ('usuario','departamento')),
  valor       text not null,
  created_at  timestamptz not null default now(),
  unique (tipo, valor)
);

create table if not exists gastos_gestiones (
  id                    bigserial primary key,
  fondo_id              bigint references gastos_fondos(id) on delete set null,
  administrador_id      text not null,
  administrador_nombre  text not null default '',
  tipo                  text not null check (tipo in ('reintegro','liquidacion')),
  mes                   smallint not null check (mes between 1 and 12),
  anio                  smallint not null,
  monto_total           numeric(12,2) not null default 0,
  estado                text not null default 'pendiente' check (estado in ('pendiente','revisado','cerrado')),
  pdf_url               text,
  pdf_nombre            text,
  revisado_at           timestamptz,
  revisado_por_id       text,
  revisado_por_nombre   text,
  cerrado_at            timestamptz,
  cerrado_por_id        text,
  cerrado_por_nombre    text,
  created_by_id         text not null,
  created_by_nombre     text not null default '',
  created_at            timestamptz not null default now()
);
create index if not exists gastos_gestiones_fondo_idx  on gastos_gestiones (fondo_id);
create index if not exists gastos_gestiones_estado_idx on gastos_gestiones (estado);

alter table gastos_registros add column if not exists gestion_id bigint;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'gastos_registros_gestion_id_fkey') then
    alter table gastos_registros add constraint gastos_registros_gestion_id_fkey
      foreign key (gestion_id) references gastos_gestiones(id) on delete set null;
  end if;
end $$;
create index if not exists gastos_registros_gestion_idx on gastos_registros (gestion_id);
