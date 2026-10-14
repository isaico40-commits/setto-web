-- 013 · Anular en la caja el ingreso de un pedido web devuelve sus mochis al stock.
--       Y la pestaña Stock muestra lo reservado en pedidos pendientes y el disponible en la web.

-- 1. Ingreso de un pedido anulado → se anulan sus salidas de stock
create or replace function public.caja_anula_stock_pedido() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_oid uuid;
begin
  if new.estado = 'anulado' and old.estado is distinct from 'anulado' then
    select id into v_oid from orders where caja_mov_id = new.id limit 1;
    if v_oid is null and coalesce(new.legacy_id, '') like 'pedido:%' then
      v_oid := nullif(split_part(new.legacy_id, ':', 2), '')::uuid;
    end if;
    if v_oid is not null then
      update caja_stock_mov set estado = 'anulado',
             anulado_por = coalesce(nullif(trim(new.anulado_por), ''), 'Caja')
       where legacy_id like 'pedido:' || v_oid || ':%' and estado = 'activo';
    end if;
  end if;
  return null;
end $$;
revoke execute on function public.caja_anula_stock_pedido() from public, anon, authenticated;

drop trigger if exists caja_anula_stock_pedido on public.caja_movimientos;
create trigger caja_anula_stock_pedido after update of estado on public.caja_movimientos
  for each row execute function public.caja_anula_stock_pedido();

-- 2. Reservas para la pestaña Stock (solo equipo)
create or replace function public.caja_stock_reservas()
returns table (item_id uuid, reservado int, disponible int)
language sql stable security definer set search_path = public as $$
  select i.id,
         coalesce((select sum(r.qty) from orders o cross join lateral caja_mochis_de_items(o.items) r
                    where o.status = 'pendiente' and r.product_id = i.product_id), 0)::int,
         d.disponible
    from caja_stock_items i
    join stock_disponible() d on d.product_id = i.product_id
   where i.activo and public.is_staff()
$$;
revoke execute on function public.caja_stock_reservas() from public, anon;
grant execute on function public.caja_stock_reservas() to authenticated;
