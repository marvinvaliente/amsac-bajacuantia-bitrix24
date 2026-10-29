-- Control del plazo para registrar la factura o documento equivalente (Reglamento Art. 19).
-- Una fila por solicitud desembolsada; alimenta el score de cumplimiento y el historial de incumplimientos.
-- Ya aplicada en Supabase.
create table if not exists public.gastos_plazos (
  id                    bigserial primary key,
  solicitud_id          bigint not null unique references public.gastos_solicitudes(id) on delete cascade,
  fondo_id              bigint,
  solicitante_id        text not null,
  solicitante_nombre    text not null default '',
  administrador_id      text,
  administrador_nombre  text not null default '',
  desembolsado_at       timestamptz not null,
  dias_plazo            smallint not null default 3,
  fecha_limite          date not null,
  estado                text not null default 'pendiente' check (estado in ('pendiente','cumplio','incumplio')),
  cumplido_at           timestamptz,
  dias_habiles          smallint,
  dias_atraso           smallint,
  recordatorios         integer not null default 0,
  ultimo_recordatorio   date,
  primera_alerta_at     timestamptz,
  created_at            timestamptz not null default now()
);
create index if not exists gastos_plazos_solicitante_idx on public.gastos_plazos (solicitante_id);
create index if not exists gastos_plazos_estado_idx on public.gastos_plazos (estado, fecha_limite);
alter table public.gastos_plazos enable row level security;
