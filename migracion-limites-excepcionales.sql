-- Compras que superan el límite ordinario del fondo (Reglamento Art. 6, 7 y 8).
-- Ya aplicada en Supabase.
alter table public.gastos_solicitudes add column if not exists excepcional boolean not null default false;
alter table public.gastos_solicitudes add column if not exists acuerdo_administrativo_url text;
alter table public.gastos_solicitudes add column if not exists acuerdo_administrativo_nombre text;
alter table public.gastos_solicitudes add column if not exists retencion_comprobante text;
alter table public.gastos_solicitudes add column if not exists retencion_tramitada_at timestamptz;
alter table public.gastos_solicitudes add column if not exists retencion_tramitada_por_id text;
alter table public.gastos_solicitudes add column if not exists retencion_tramitada_por_nombre text;
