-- =====================================================================
-- 069 · Caja: inversión aparte de gastos y retiros
--
-- Nuevo tipo de movimiento 'inversion' (heladeras, máquinas, obra, muebles…):
--   - Si la paga la caja: baja el saldo de esa cuenta, pero NO cuenta como
--     gasto del mes ni como retiro. Nadie queda debiendo nada.
--   - Si la paga un socio de su bolsillo: Setto le queda debiendo ese monto
--     (igual que un aporte).
-- Los aportes de socios y las devoluciones siguen siendo 'aporte' y 'devolucion'.
-- La deuda con los socios se reparte en partes iguales entre los socios activos:
-- eso lo calcula la pestaña Inversión de la caja a partir de caja_deudas.
--
-- También pasa a inversión la seña de la heladera ($250.000, 16/11/2026),
-- que estaba cargada como gasto de Equipamiento.
-- Se puede correr más de una vez sin romper nada.
-- =====================================================================

-- ---------- Categorías de inversión ----------
alter table public.caja_categorias drop constraint if exists caja_categorias_tipo_check;
alter table public.caja_categorias add constraint caja_categorias_tipo_check
  check (tipo in ('entrada','gasto','inversion'));

insert into public.caja_categorias (id, nombre, tipo, orden) values
  ('inv_equipamiento','Equipamiento (heladeras, máquinas)','inversion',1),
  ('inv_obra','Obra y arreglos','inversion',2),
  ('inv_mobiliario','Muebles y decoración','inversion',3),
  ('inv_tramites','Depósito, habilitación y trámites','inversion',4),
  ('inv_otra','Otra inversión','inversion',9)
on conflict (id) do nothing;

-- ---------- Tipo de movimiento ----------
alter table public.caja_movimientos drop constraint if exists caja_movimientos_tipo_check;
alter table public.caja_movimientos add constraint caja_movimientos_tipo_check
  check (tipo in ('entrada','gasto','inversion','aporte','devolucion','retiro','transferencia','ajuste'));

alter table public.caja_movimientos drop constraint if exists caja_mov_forma;
alter table public.caja_movimientos add constraint caja_mov_forma check (
  case tipo
    when 'entrada'       then cuenta_id is not null and socio_id is null and cuenta_destino_id is null
    when 'gasto'         then cuenta_destino_id is null and ((cuenta_id is not null) <> (socio_id is not null))
    when 'inversion'     then cuenta_destino_id is null and ((cuenta_id is not null) <> (socio_id is not null))
    when 'aporte'        then cuenta_id is not null and socio_id is not null and cuenta_destino_id is null
    when 'devolucion'    then cuenta_id is not null and socio_id is not null and cuenta_destino_id is null
    when 'retiro'        then cuenta_id is not null and socio_id is not null and cuenta_destino_id is null
    when 'transferencia' then cuenta_id is not null and cuenta_destino_id is not null and cuenta_id <> cuenta_destino_id and socio_id is null
    when 'ajuste'        then cuenta_id is not null and socio_id is null and cuenta_destino_id is null
  end
);

-- ---------- Efecto de cada movimiento (la única regla de cálculo) ----------
create or replace view public.caja_efectos with (security_invoker = true) as
  -- sobre las cuentas
  select m.id, m.fecha, m.cuenta_id as cuenta_id, null::text as socio_id,
    case m.tipo
      when 'entrada' then m.monto
      when 'aporte' then m.monto
      when 'ajuste' then m.monto
      when 'gasto' then -m.monto
      when 'inversion' then -m.monto
      when 'devolucion' then -m.monto
      when 'retiro' then -m.monto
      when 'transferencia' then -m.monto
    end as delta_cuenta, 0::numeric as delta_deuda
  from public.caja_movimientos m where m.estado = 'activo' and m.cuenta_id is not null
  union all
  select m.id, m.fecha, m.cuenta_destino_id, null, m.monto, 0
  from public.caja_movimientos m where m.estado = 'activo' and m.tipo = 'transferencia'
  union all
  -- lo que Setto le debe a cada socio
  select m.id, m.fecha, null, m.socio_id, 0,
    case m.tipo when 'gasto' then m.monto when 'inversion' then m.monto when 'aporte' then m.monto when 'devolucion' then -m.monto end
  from public.caja_movimientos m where m.estado = 'activo' and m.tipo in ('gasto','inversion','aporte','devolucion') and m.socio_id is not null;

-- Resumen por mes: la inversión va en su propia columna (no entra en gastos ni en resultado).
create or replace view public.caja_resumen_mensual with (security_invoker = true) as
  select to_char(date_trunc('month', fecha), 'YYYY-MM') as mes,
    sum(monto) filter (where tipo = 'entrada') as entradas,
    sum(monto) filter (where tipo = 'gasto') as gastos,
    coalesce(sum(monto) filter (where tipo = 'entrada'),0) - coalesce(sum(monto) filter (where tipo = 'gasto'),0) as resultado,
    sum(monto) filter (where tipo = 'retiro') as retiros,
    sum(monto) filter (where tipo = 'ajuste') as ajustes,
    count(*) as movimientos,
    sum(monto) filter (where tipo = 'inversion') as inversiones
  from public.caja_movimientos where estado = 'activo'
  group by 1;

revoke all on public.caja_efectos, public.caja_resumen_mensual from anon;

-- ---------- La seña de la heladera pasa a inversión ----------
-- (queda en el historial del movimiento como editado por Isa)
update public.caja_movimientos
   set tipo = 'inversion', categoria_id = 'inv_equipamiento', detalle = 'Seña heladera', editado_por = 'Isa'
 where id = '16c66811-f2f5-4401-8a9b-10c4714a0d5b' and tipo = 'gasto' and estado = 'activo';
