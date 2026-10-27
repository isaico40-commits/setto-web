-- 048 · Caja: una entrada puede llevar los productos que se vendieron (items) y descuenta los mochis del stock.
--   - caja_movimientos.items: [{id, nombre, size, qty, precio, mochis?}] con el mismo formato que los pedidos web,
--     así el stock sale de caja_mochis_de_items (mochis sueltos, el mochi de cada set, especiales y los sabores de cada box).
--   - caja_movimientos.stock_lugar: de dónde salen los mochis ('cafe' o 'produ'). Si no se elige, Café.
--   - Al cargar la entrada se descuentan los mochis; al editar los productos se rehace; al anular la entrada, vuelven al stock.
--     Los movimientos de stock quedan con legacy_id 'venta:<id de la entrada>:…' y motivo 'venta' (el Dashboard ya los cuenta).
--   No toca las entradas ya cargadas (items queda vacío) ni los pedidos web (tienen su propio trigger y nunca llevan items).
--   Se puede correr más de una vez.

alter table public.caja_movimientos add column if not exists items jsonb;
alter table public.caja_movimientos add column if not exists stock_lugar text;
alter table public.caja_movimientos drop constraint if exists caja_mov_items_chk;
alter table public.caja_movimientos add constraint caja_mov_items_chk
  check ((items is null or (tipo = 'entrada' and jsonb_typeof(items) = 'array'))
         and (stock_lugar is null or stock_lugar in ('cafe','produ')));

create or replace function public.caja_venta_stock() returns trigger
language plpgsql security definer set search_path = public as $$
declare r record; v_item uuid; n int := 0; v_quien text; v_det text;
begin
  if coalesce(new.legacy_id, '') like 'pedido:%' then return null; end if;
  if tg_op = 'UPDATE' then
    if old.items is not distinct from new.items and old.estado is not distinct from new.estado
       and old.stock_lugar is not distinct from new.stock_lugar then
      return null;
    end if;
    v_quien := coalesce(nullif(trim(case when new.estado = 'anulado' then new.anulado_por else new.editado_por end), ''), new.registro);
    update caja_stock_mov set estado = 'anulado', anulado_por = v_quien
     where legacy_id like 'venta:' || new.id || ':%' and estado = 'activo';
  else
    v_quien := new.registro;
  end if;
  if new.estado <> 'activo' or new.tipo <> 'entrada' or new.items is null then return null; end if;
  v_det := left(coalesce(nullif(trim(new.detalle), ''), 'Venta'), 80);
  for r in select * from caja_mochis_de_items(new.items) loop
    n := n + 1;
    select id into v_item from caja_stock_items where product_id = r.product_id and activo;
    continue when v_item is null;
    insert into caja_stock_mov (item_id, lugar, delta, motivo, nota, registro, legacy_id)
    values (v_item, coalesce(new.stock_lugar, 'cafe'), -r.qty, 'venta', v_det, v_quien,
            'venta:' || new.id || ':' || n || ':' || md5(clock_timestamp()::text || n));
  end loop;
  return null;
end $$;
revoke execute on function public.caja_venta_stock() from public, anon, authenticated;

drop trigger if exists caja_venta_stock on public.caja_movimientos;
create trigger caja_venta_stock after insert or update on public.caja_movimientos
  for each row execute function public.caja_venta_stock();
