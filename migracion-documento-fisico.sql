-- Regla: el solicitante entrega el documento físico (factura o equivalente) al
-- administrador de fondo; el administrador lo marca como recibido y solo esos
-- gastos pueden incluirse en un reintegro. (Ya aplicada en Supabase.)
alter table public.gastos_registros add column if not exists documento_fisico_recibido boolean not null default false;
alter table public.gastos_registros add column if not exists documento_fisico_at timestamptz;
alter table public.gastos_registros add column if not exists documento_fisico_por_id text;
alter table public.gastos_registros add column if not exists documento_fisico_por_nombre text;
