-- =====================================================================
-- 063 · Ventas por apps (PedidosYa) que cuadran en la caja
--
-- Problema: el precio que figura en la app no es lo que entra. La app
-- descuenta comisión y promos y liquida después.
--
-- Solución: PedidosYa es una cuenta más de la caja, pero "a cobrar".
--   · La venta se carga con el precio de la app (bruto) en esa cuenta.
--     Stock y "qué se vendió" quedan bien, y no infla Mercado Pago ni Efectivo.
--   · Cuando llega la liquidación, caja_liquidar pasa lo cobrado a la cuenta
--     real y anota la diferencia como gasto "Comisiones y promos de apps".
--   · comision_pct es solo una estimación para mostrar el neto mientras
--     no liquida; se actualiza sola con el % real de cada liquidación.
-- No toca movimientos viejos. Se puede correr más de una vez.
-- =====================================================================

alter table public.caja_cuentas add column if not exists por_cobrar boolean not null default false;
alter table public.caja_cuentas add column if not exists comision_pct numeric(5,2)
  check (comision_pct is null or (comision_pct >= 0 and comision_pct < 100));

-- el id de la cuenta es el mismo que el de la categoría de entrada: así la caja las une sola
insert into public.caja_cuentas (id, nombre, saldo_inicial, inicio, orden, por_cobrar)
values ('pedidosya', 'PedidosYa', 0, current_date, 10, true)
on conflict (id) do update set por_cobrar = true;

insert into public.caja_categorias (id, nombre, tipo, orden)
values ('comision_apps', 'Comisiones y promos de apps', 'gasto', 7)
on conflict (id) do nothing;

-- saldos: mismas columnas de antes + si es "a cobrar" y su % estimado (al final, para no romper la vista)
create or replace view public.caja_saldos with (security_invoker = true) as
  select c.id, c.nombre, c.orden, c.saldo_inicial,
         c.saldo_inicial + coalesce((select sum(e.delta_cuenta) from public.caja_efectos e where e.cuenta_id = c.id), 0) as saldo,
         (select max(m.created_at) from public.caja_movimientos m where m.tipo = 'ajuste' and m.cuenta_id = c.id and m.estado = 'activo') as ultimo_conteo,
         c.por_cobrar, c.comision_pct,
         (select max(m.fecha) from public.caja_movimientos m where m.cuenta_id = c.id and m.tipo = 'transferencia' and m.estado = 'activo' and c.por_cobrar) as ultima_liquidacion
  from public.caja_cuentas c where c.activa;
revoke all on public.caja_saldos from anon;

-- Liquidar: lo vendido hasta p_hasta que sigue a cobrar, contra lo que depositaron de verdad.
--   transferencia app → cuenta real por lo cobrado
--   gasto "comisiones y promos" por la diferencia (o entrada si pagaron de más)
-- Los dos movimientos van con fecha p_hasta, así la comisión cae en el mes de las ventas
-- y la próxima liquidación no vuelve a contar lo ya liquidado.
create or replace function public.caja_liquidar(p_cuenta text, p_destino text, p_cobrado numeric, p_hasta date,
                                                p_registro text, p_nota text default null)
returns jsonb language plpgsql security invoker set search_path = public as $$
declare
  c record; v_bruto numeric; v_dif numeric; v_pct numeric; v_tr uuid; v_dm uuid;
  v_hasta date := coalesce(p_hasta, (now() at time zone 'America/Argentina/Buenos_Aires')::date);
  v_txt text;
begin
  if not public.is_staff() then raise exception 'Solo el equipo puede hacer esto'; end if;
  select * into c from public.caja_cuentas where id = p_cuenta and activa;
  if c.id is null or not c.por_cobrar then raise exception 'Esa cuenta no es de una app'; end if;
  if not exists (select 1 from public.caja_cuentas where id = p_destino and activa and not por_cobrar) then
    raise exception 'Elegí a qué cuenta entró la plata';
  end if;
  if p_cobrado is null or p_cobrado < 0 then raise exception 'Poné cuánto te depositaron'; end if;
  if coalesce(trim(p_registro), '') = '' then raise exception 'Elegí quién está cargando'; end if;

  v_bruto := round(c.saldo_inicial + coalesce((select sum(e.delta_cuenta) from public.caja_efectos e
                                               where e.cuenta_id = c.id and e.fecha <= v_hasta), 0), 2);
  if v_bruto <= 0 then raise exception 'No hay ventas de % a cobrar hasta esa fecha', c.nombre; end if;
  v_dif := round(v_bruto - p_cobrado, 2);
  v_pct := round(v_dif / v_bruto * 100, 2);
  v_txt := 'Liquidación ' || c.nombre || ' hasta el ' || to_char(v_hasta, 'DD/MM') || coalesce(' · ' || nullif(trim(p_nota), ''), '');

  if p_cobrado > 0 then
    insert into public.caja_movimientos (fecha, tipo, detalle, monto, cuenta_id, cuenta_destino_id, registro)
    values (v_hasta, 'transferencia', v_txt, p_cobrado, c.id, p_destino, p_registro) returning id into v_tr;
  end if;
  if v_dif > 0 then
    insert into public.caja_movimientos (fecha, tipo, detalle, monto, cuenta_id, categoria_id, registro)
    values (v_hasta, 'gasto', 'Comisión y promos ' || c.nombre || ' (' || regexp_replace(replace(to_char(v_pct, 'FM990.0'), '.', ','), ',0$', '')
            || '% de $' || replace(to_char(round(v_bruto), 'FM999,999,990'), ',', '.') || ') hasta el ' || to_char(v_hasta, 'DD/MM'),
            v_dif, c.id, 'comision_apps', p_registro) returning id into v_dm;
  elsif v_dif < 0 then
    -- depositaron más de lo cargado (ventas sin cargar, propinas): entra la diferencia para que cuadre
    insert into public.caja_movimientos (fecha, tipo, detalle, monto, cuenta_id, categoria_id, registro)
    values (v_hasta, 'entrada', c.nombre || ': liquidaron más de lo cargado hasta el ' || to_char(v_hasta, 'DD/MM'),
            -v_dif, c.id, case when exists (select 1 from public.caja_categorias where id = c.id) then c.id end, p_registro)
    returning id into v_dm;
  end if;

  -- el % real pasa a ser la estimación para lo que todavía no liquidó
  if v_pct >= 0 and v_pct < 100 then update public.caja_cuentas set comision_pct = v_pct where id = c.id; end if;

  return jsonb_build_object('bruto', v_bruto, 'cobrado', p_cobrado, 'comision', v_dif, 'pct', v_pct,
                            'transferencia', v_tr, 'diferencia', v_dm);
end $$;
revoke execute on function public.caja_liquidar(text, text, numeric, date, text, text) from public, anon;
grant execute on function public.caja_liquidar(text, text, numeric, date, text, text) to authenticated;
