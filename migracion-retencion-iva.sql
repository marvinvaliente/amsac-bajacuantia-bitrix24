-- Retención de anticipo de IVA (Código Tributario, Art. 162 y 112): la alcaldía es agente de retención.
-- Se guarda la base (valor sin IVA) y el monto retenido junto con el N° de comprobante de retención.
-- Ya aplicada en Supabase.
alter table public.gastos_solicitudes add column if not exists retencion_base numeric(12,2);
alter table public.gastos_solicitudes add column if not exists retencion_monto numeric(12,2);
