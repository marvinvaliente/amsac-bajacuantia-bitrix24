alter table gastos_gestiones add column if not exists fecha_desde date;
alter table gastos_gestiones add column if not exists fecha_hasta date;
alter table gastos_gestiones add column if not exists cuenta_bancaria text;
alter table gastos_gestiones add column if not exists acuerdo_url text;
alter table gastos_gestiones add column if not exists acuerdo_nombre text;
alter table gastos_gestiones add column if not exists comprobante_url text;
alter table gastos_gestiones add column if not exists comprobante_nombre text;
alter table gastos_gestiones add column if not exists tesoreria_at timestamptz;
alter table gastos_gestiones add column if not exists tesoreria_por_id text;
alter table gastos_gestiones add column if not exists tesoreria_por_nombre text;
alter table gastos_gestiones drop constraint if exists gastos_gestiones_estado_check;
alter table gastos_gestiones add constraint gastos_gestiones_estado_check
  check (estado in ('pendiente','revisado','entregado','cerrado'));
