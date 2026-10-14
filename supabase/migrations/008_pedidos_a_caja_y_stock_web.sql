-- =====================================================================
-- 008 · Pedidos web → caja y stock, y stock visible en la web
--
-- 1. Cada producto de la carta que es un mochi (fijo o edición especial)
--    tiene su producto de stock (los que faltaban se crean en 0).
-- 2. Al marcar un pedido como Entregado en el panel:
--    - se carga una Entrada en la caja (total de productos; el envío lo
--      paga el cliente aparte a Uber, así que no entra)
--      · "Efectivo..." va a Efectivo; cualquier otra forma, a Mercado Pago
--    - se descuenta del stock del Café cada mochi (y el mochi de cada set,
--      incluido el set de regalo del Club).
--    Si un pedido deja de estar entregado, la entrada y el stock se anulan solos.
-- 3. stock_publico(): la web lee cuántos mochis quedan en el Café.
-- Se puede correr más de una vez sin duplicar nada.
-- =====================================================================

-- ---------- 1. Vincular stock con la carta ----------
alter table public.caja_stock_items add column if not exists product_id text unique references public.products(id) on delete set null;

update public.caja_stock_items i set product_id = m.pid
from (values ('Mochi frutilla','mochi-frutilla'),('Mochi oreo','mochi-oreo'),('Mochi chocolate','mochi-chocolate'),
             ('Mochi Banana','mochi-banana'),('Mochi Sakura','mochi-sakura')) as m(nombre, pid)
where i.nombre = m.nombre and i.product_id is null
  and exists (select 1 from public.products p where p.id = m.pid)
  and not exists (select 1 from public.caja_stock_items x where x.product_id = m.pid);

insert into public.caja_stock_items (nombre, product_id, orden)
select 'Mochi ' || p.nombre, p.id,
       100 + row_number() over (order by case p.categoria when 'mochi' then 0 else 1 end, p.orden)
from public.products p
where p.categoria in ('mochi','especial')
  and not exists (select 1 from public.caja_stock_items i where i.product_id = p.id)
  and not exists (select 1 from public.caja_stock_items i where lower(i.nombre) = lower('Mochi ' || p.nombre))
on conflict do nothing;

-- ---------- 2. Pedido entregado → caja y stock ----------
alter table public.orders add column if not exists caja_mov_id uuid references public.caja_movimientos(id);

create or replace function public.pedido_a_caja() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_total numeric; v_cuenta text; v_mov uuid; it jsonb; n int := 0;
  v_pid text; v_qty int; v_mochi text; v_item uuid; v_set text; v_fecha date;
  v_quien constant text := 'Pedidos web';
begin
  if new.status = 'entregado' and old.status is distinct from 'entregado' then
    v_fecha := (coalesce(new.closed_at, now()) at time zone 'America/Argentina/Buenos_Aires')::date;
    -- plata: total sin la línea de envío
    select coalesce(sum((x->>'subtotal')::numeric), 0) into v_total
      from jsonb_array_elements(coalesce(new.items, '[]'::jsonb)) x where x->>'id' = 'envio';
    v_total := coalesce(new.total, 0) - v_total;
    v_cuenta := case when coalesce(new.pago, '') ilike '%efectivo%' then 'efectivo' else 'mp' end;
    if v_total > 0 then
      insert into caja_movimientos (fecha, tipo, detalle, monto, cuenta_id, categoria_id, registro, legacy_id)
      values (v_fecha, 'entrada', 'Pedido web ' || new.code || ' · ' || coalesce(new.nombre, ''), v_total, v_cuenta, 'venta_directa', v_quien, 'pedido:' || new.id)
      on conflict (legacy_id) do nothing
      returning id into v_mov;
      if v_mov is null then select id into v_mov from caja_movimientos where legacy_id = 'pedido:' || new.id; end if;
      -- si se había anulado (el pedido volvió a pendiente y otra vez a entregado), se carga uno nuevo
      if exists (select 1 from caja_movimientos where id = v_mov and estado = 'anulado') then
        insert into caja_movimientos (fecha, tipo, detalle, monto, cuenta_id, categoria_id, registro)
        values (v_fecha, 'entrada', 'Pedido web ' || new.code || ' · ' || coalesce(new.nombre, ''), v_total, v_cuenta, 'venta_directa', v_quien)
        returning id into v_mov;
      end if;
      new.caja_mov_id := v_mov;
    end if;
    -- stock: cada mochi sale del Café
    for it in select * from jsonb_array_elements(coalesce(new.items, '[]'::jsonb)) loop
      n := n + 1;
      v_pid := it->>'id'; v_qty := greatest(coalesce((it->>'qty')::int, 1), 1); v_mochi := null;
      if v_pid = 'premio' then
        if coalesce(it->>'size', '') <> '' then -- set de regalo del Club
          v_set := substring(it->>'nombre' from '^Premio Setto Club: (.*) \([0-9]+ oz\) de regalo$');
          select set_mochi into v_mochi from products where categoria = 'set' and nombre = v_set limit 1;
        end if;
      else
        select case when categoria = 'set' then set_mochi when categoria in ('mochi','especial') then id end
          into v_mochi from products where id = v_pid;
      end if;
      continue when v_mochi is null;
      select id into v_item from caja_stock_items where product_id = v_mochi and activo;
      continue when v_item is null;
      insert into caja_stock_mov (item_id, lugar, delta, motivo, nota, registro, legacy_id)
      values (v_item, 'cafe', -v_qty, 'venta', 'Pedido web ' || new.code, v_quien, 'pedido:' || new.id || ':' || n || ':' || md5(clock_timestamp()::text))
      on conflict do nothing;
    end loop;

  elsif old.status = 'entregado' and new.status is distinct from 'entregado' then
    update caja_movimientos set estado = 'anulado', anulado_por = v_quien,
           anulado_motivo = 'El pedido ' || new.code || ' dejó de figurar como entregado'
     where id = old.caja_mov_id and estado = 'activo';
    update caja_stock_mov set estado = 'anulado', anulado_por = v_quien
     where legacy_id like 'pedido:' || new.id || ':%' and estado = 'activo';
    new.caja_mov_id := null;
  end if;
  return new;
end $$;
revoke execute on function public.pedido_a_caja() from public, anon, authenticated;

drop trigger if exists pedido_a_caja on public.orders;
create trigger pedido_a_caja before update of status on public.orders
  for each row execute function public.pedido_a_caja();

-- ---------- 3. Stock visible en la web ----------
insert into public.settings (key, value) values ('stock_web', '{"activo": true, "umbral": 3}'::jsonb)
on conflict (key) do nothing;

-- Devuelve {producto: unidades en el Café} o null si está apagado en Ajustes.
create or replace function public.stock_publico() returns jsonb
language sql stable security definer set search_path = public as $$
  select case when coalesce((select (value->>'activo')::boolean from settings where key = 'stock_web'), false) then
    coalesce((select jsonb_object_agg(i.product_id, greatest(a.cafe, 0))
                from caja_stock_items i join caja_stock_actual a on a.id = i.id
               where i.product_id is not null and i.activo), '{}'::jsonb)
  end
$$;
revoke execute on function public.stock_publico() from public;
grant execute on function public.stock_publico() to anon, authenticated;
