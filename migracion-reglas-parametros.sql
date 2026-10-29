-- Parámetros de las reglas de uso de los fondos (editables desde "Reglas de fondos").
-- Ya aplicada en Supabase; los valores iniciales son los del reglamento vigente.
create table if not exists public.gastos_reglas (
  tipo              text primary key check (tipo in ('global','circulante','caja_chica')),
  valor             jsonb not null default '{}'::jsonb,
  updated_at        timestamptz not null default now(),
  updated_by_id     text,
  updated_by_nombre text
);
create table if not exists public.gastos_reglas_historial (
  id                bigserial primary key,
  tipo              text not null,
  valor_anterior    jsonb,
  valor_nuevo       jsonb,
  cambiado_por_id   text,
  cambiado_por_nombre text,
  created_at        timestamptz not null default now()
);
alter table public.gastos_reglas enable row level security;
alter table public.gastos_reglas_historial enable row level security;
-- (los valores iniciales están en api/gestiones.js: DEFAULTS)
