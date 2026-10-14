-- =====================================================================
-- 009 · El stock frena los pedidos
--
-- Disponible = stock del Café − lo que ya está pedido y pendiente de entregar.
-- - La web muestra el disponible (no el stock bruto).
-- - Un pedido nuevo que pide más de lo disponible se rechaza en la base,
--   aunque alguien saltee la web.
-- - Se apaga con settings.stock_web.bloquear = false (Panel → Ajustes).
-- Se puede correr más de una vez.
-- =====================================================================

-- Qué mochis lleva un pedido (mochis sueltos, especiales, el mochi de cada set y el del set de regalo)
create or replace function public.caja_mochis_de_items(p_items jsonb)
returns table (product_id text, qty int)
language sql stable security definer set search_path = public as $$
  select m.mochi, sum(m.q)::int from (
    select case
             when x->>'id' = 'premio' then
               (select set_mochi from products where categoria = 'set'
                  and nombre = substring(x->>'nombre' from '^Premio Setto Club: (.*) \([0-9]+ oz\) de regalo$') limit 1)
             else
               (select case when categoria = 'set' then set_mochi when categoria in ('mochi','especial') then id end
                  from products where id = x->>'id')
           end as mochi,
           greatest(coalesce((x->>'qty')::int, 1), 1) as q
      from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) x
  ) m
  where m.mochi is not null
  group by m.mochi
$$;

create or replace function public.stock_disponible()
returns table (product_id text, disponible int)
language sql stable security definer set search_path = public as $$
  select i.product_id,
         (a.cafe - coalesce((select sum(r.qty) from orders o
                              cross join lateral caja_mochis_de_items(o.items) r
                             where o.status = 'pendiente' and r.product_id = i.product_id), 0))::int
    from caja_stock_items i
    join caja_stock_actual a on a.id = i.id
   where i.product_id is not null and i.activo
$$;

-- La web ve el disponible
create or replace function public.stock_publico() returns jsonb
language sql stable security definer set search_path = public as $$
  select case when coalesce((select (value->>'activo')::boolean from settings where key = 'stock_web'), false) then
    coalesce((select jsonb_object_agg(d.product_id, greatest(d.disponible, 0)) from stock_disponible() d), '{}'::jsonb)
  end
$$;

-- Freno en la base
create or replace function public.pedido_controla_stock() returns trigger
language plpgsql security definer set search_path = public as $$
declare r record;
begin
  if not coalesce((select (value->>'activo')::boolean from settings where key = 'stock_web'), false)
     or not coalesce((select (value->>'bloquear')::boolean from settings where key = 'stock_web'), true) then
    return new;
  end if;
  perform pg_advisory_xact_lock(hashtext('setto-stock'));  -- dos pedidos a la vez no se llevan el mismo último mochi
  for r in
    select m.qty, d.disponible, p.nombre
      from caja_mochis_de_items(new.items) m
      join stock_disponible() d on d.product_id = m.product_id
      join products p on p.id = m.product_id
  loop
    if r.qty > r.disponible then
      if r.disponible <= 0 then
        raise exception 'Nos quedamos sin mochi % por hoy. Sacalo del pedido o elegí otro sabor.', r.nombre;
      else
        raise exception 'De mochi % nos quedan %. Bajá la cantidad para poder enviar el pedido.', r.nombre, r.disponible;
      end if;
    end if;
  end loop;
  return new;
end $$;
revoke execute on function public.pedido_controla_stock() from public, anon, authenticated;
revoke execute on function public.caja_mochis_de_items(jsonb) from public, anon;
revoke execute on function public.stock_disponible() from public, anon;
grant execute on function public.stock_disponible() to authenticated;

drop trigger if exists pedido_controla_stock on public.orders;
create trigger pedido_controla_stock before insert on public.orders
  for each row execute function public.pedido_controla_stock();

update public.settings set value = value || '{"bloquear": true}'::jsonb
 where key = 'stock_web' and not (value ? 'bloquear');
