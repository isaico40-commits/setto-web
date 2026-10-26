-- 047 · Promos: Box de mochis 5x4 (y las que vengan).
--   Una promo es un producto de categoría 'promo': precio fijo (products.precio) por una box de N mochis
--   (products.promo_cant) que el cliente elige entre los mochis de la carta (categoría 'mochi', visibles y sin agotar).
--   El ahorro que muestra la web se calcula solo: N × precio del mochi suelto − precio de la promo.
--   - El pedido guarda los sabores en la línea ('mochis': ["mochi-oreo", "mochi-oreo", ...]) y el detalle
--     "Oreo ×2 · Frutilla · Sakura · Chocolate" (lo ven el panel, el WhatsApp y el seguimiento).
--   - Stock: cada mochi de la box cuenta para el control de stock, las reservas y la caja al entregar.
--   No borra nada. Suma una columna, amplía el check de categoría, parchea create_order_v6 (como la 043)
--   y reemplaza caja_mochis_de_items y pedido_a_caja (misma lógica de antes + los mochis de las promos).

alter table public.products add column if not exists promo_cant integer;
alter table public.products drop constraint if exists products_promo_cant_chk;
alter table public.products add constraint products_promo_cant_chk check (promo_cant is null or promo_cant between 2 and 20);
alter table public.products drop constraint if exists products_categoria_check;
alter table public.products add constraint products_categoria_check check (categoria in ('especial','set','dirty','mochi','promo'));

-- ---------- pedidos: la promo valida y guarda los sabores ----------
do $mig$
declare d text; n int;
  a1 text := $q$  bp       products%rowtype;$q$;
  a2 text := $q$    v_sub := v_sub + v_price * v_qty;$q$;
  a3 text := $q$'bebida', v_beb);$q$;
begin
  d := pg_get_functiondef('public.create_order_v6(text,text,jsonb,text,text,text,text,text,text,text,text)'::regprocedure);
  if position('v_mochis' in d) > 0 then return; end if;
  n := (length(d) - length(replace(d, a1, ''))) / length(a1);
  if n <> 1 then raise exception 'create_order_v6: esperaba 1 declaración de bp (¿falta la 043?), hay %', n; end if;
  n := (length(d) - length(replace(d, a2, ''))) / length(a2);
  if n <> 1 then raise exception 'create_order_v6: esperaba 1 suma del subtotal, hay %', n; end if;
  n := (length(d) - length(replace(d, a3, ''))) / length(a3);
  if n <> 1 then raise exception 'create_order_v6: esperaba 1 línea con bebida, hay %', n; end if;
  d := replace(d, a1, a1 || $q$
  v_mochis jsonb;
  v_cant   integer;$q$);
  d := replace(d, a2, $q$    v_mochis := null;
    if pr.categoria = 'promo' then
      v_name := trim(pr.nombre);
      v_cant := coalesce(pr.promo_cant, 5);
      if coalesce(jsonb_typeof(it->'mochis'), '') <> 'array' or jsonb_array_length(it->'mochis') <> v_cant then
        raise exception 'Elegí los % mochis de %', v_cant, trim(pr.nombre);
      end if;
      v_mochis := '[]'::jsonb;
      for s in select jsonb_array_elements_text(it->'mochis') loop
        select * into bp from products where id = s and categoria = 'mochi' and activo and not agotado;
        if not found then raise exception 'Un sabor de % ya no está disponible, elegí otro', trim(pr.nombre); end if;
        v_mochis := v_mochis || to_jsonb(bp.id);
      end loop;
      select string_agg(t.nom || case when t.c > 1 then ' ×' || t.c else '' end, ' · ' order by t.pos) into v_det
        from (select trim(p.nombre) as nom, count(*) as c, min(e.pos) as pos
                from jsonb_array_elements_text(v_mochis) with ordinality as e(id, pos) join products p on p.id = e.id
               group by p.id, p.nombre) t;
    end if;
$q$ || a2);
  d := replace(d, a3, $q$'bebida', v_beb, 'mochis', v_mochis);$q$);
  execute d;
end $mig$;

-- ---------- stock: qué mochis lleva cada pedido (control, reservas y cambios usan esta función) ----------
create or replace function public.caja_mochis_de_items(p_items jsonb)
returns table(product_id text, qty integer)
language sql stable security definer set search_path = public as $$
  select m.mochi, sum(m.q)::int from (
    select case
             when x->>'id' = 'premio' then
               (select set_mochi from products where categoria = 'set'
                  and nombre = substring(x->>'nombre' from '^Premio Setto Club: (.*) \([0-9]+ oz\) de regalo$') limit 1)
             else
               (select case when categoria = 'set' or (categoria = 'especial' and coalesce(formato,'mochi') = 'set') then set_mochi when categoria = 'mochi' or (categoria = 'especial' and coalesce(formato,'mochi') = 'mochi') then id end
                  from products where id = x->>'id')
           end as mochi,
           greatest(coalesce((x->>'qty')::int, 1), 1) as q
      from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) x
    union all
    -- promos (box): cada sabor elegido, por la cantidad de boxes
    select mm.id, greatest(coalesce((x->>'qty')::int, 1), 1)
      from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) x
      cross join lateral jsonb_array_elements_text(case when jsonb_typeof(x->'mochis') = 'array' then x->'mochis' else '[]'::jsonb end) as mm(id)
  ) m
  where m.mochi is not null
  group by m.mochi
$$;

-- ---------- pedido entregado → caja y stock (el stock sale de caja_mochis_de_items, así cuenta las box) ----------
create or replace function public.pedido_a_caja() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_total numeric; v_cuenta text; v_mov uuid; n int := 0;
  v_item uuid; v_fecha date; r record;
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
    -- stock: cada mochi sale del Café (sueltos, el de cada set, el set de regalo del Club y los de cada box)
    for r in select * from caja_mochis_de_items(new.items) loop
      n := n + 1;
      select id into v_item from caja_stock_items where product_id = r.product_id and activo;
      continue when v_item is null;
      insert into caja_stock_mov (item_id, lugar, delta, motivo, nota, registro, legacy_id)
      values (v_item, 'cafe', -r.qty, 'venta', 'Pedido web ' || new.code, v_quien, 'pedido:' || new.id || ':' || n || ':' || md5(clock_timestamp()::text))
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

-- ---------- la promo de arranque: Box 5x4 (visible; se edita en Panel → Carta → Promos) ----------
insert into public.products (id, categoria, nombre, descripcion, img, precio, promo_cant, rotativo, agotado, activo, orden)
values ('promo-box5x4', 'promo', 'Box de mochis 5x4', 'Llevás 5 mochis y pagás 4. Elegís los sabores y van en una box.', '', 22000, 5, false, false, true, 1)
on conflict (id) do nothing;
