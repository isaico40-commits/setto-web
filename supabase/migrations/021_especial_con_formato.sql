-- 021 · Un sabor de la edición especial puede ser mochi, dirty o set (products.formato).
--   dirty / set: precio por tamaño (12/16 oz), leche y opciones "sin" igual que la carta.
--   set: descuenta del stock el mochi que incluye (set_mochi). dirty: no descuenta mochis.
-- No borra nada: parchea las funciones existentes y avisa si no encuentra qué cambiar.

alter table public.products add column if not exists formato text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'products_formato_chk') then
    alter table public.products add constraint products_formato_chk check (formato is null or formato in ('mochi','dirty','set'));
  end if;
end $$;

-- precio de una línea (cambio de pedido)
create or replace function public.precio_linea(p products, p_size text, p_leche text) returns int
language sql stable security definer set search_path = public as $$
  select (case when p.categoria in ('set','dirty') or (p.categoria = 'especial' and coalesce(p.formato,'mochi') in ('set','dirty'))
               then case when p_size = '16 oz' then p.precio_16 else p.precio_12 end else p.precio end)
       + case when (p.categoria in ('set','dirty') or (p.categoria = 'especial' and coalesce(p.formato,'mochi') in ('set','dirty'))) and nullif(p_leche, '') is not null then
           coalesce((select greatest(0, (l->>'precio')::int) from settings s, jsonb_array_elements(coalesce(s.value->'leches', '[]'::jsonb)) l
                      where s.key = 'personalizacion' and l->>'nombre' = p_leche limit 1), 0)
         else 0 end
$$;
revoke execute on function public.precio_linea(products, text, text) from public, anon, authenticated;

do $$
declare d text; n int;
  v_old_map text := $q$case when categoria = 'set' then set_mochi when categoria in ('mochi','especial') then id end$q$;
  v_new_map text := $q$case when categoria = 'set' or (categoria = 'especial' and coalesce(formato,'mochi') = 'set') then set_mochi when categoria = 'mochi' or (categoria = 'especial' and coalesce(formato,'mochi') = 'mochi') then id end$q$;
begin
  -- qué mochis lleva un pedido (reservas de stock)
  d := pg_get_functiondef('public.caja_mochis_de_items(jsonb)'::regprocedure);
  if position(v_old_map in d) = 0 then raise exception 'caja_mochis_de_items: no encontré el mapeo'; end if;
  execute replace(d, v_old_map, v_new_map);

  -- pedido entregado → stock
  d := pg_get_functiondef('public.pedido_a_caja()'::regprocedure);
  if position(v_old_map in d) = 0 then raise exception 'pedido_a_caja: no encontré el mapeo'; end if;
  execute replace(d, v_old_map, v_new_map);

  -- pedido web: especial con formato dirty/set usa tamaño y personalización
  d := pg_get_functiondef('public.create_order_v5(text,text,jsonb,text,text,text,text,text,text,text)'::regprocedure);
  n := (length(d) - length(replace(d, $q$if pr.categoria in ('set','dirty') then$q$, ''))) / length($q$if pr.categoria in ('set','dirty') then$q$);
  if n <> 1 then raise exception 'create_order_v5: esperaba 1 rama de tamaño, hay %', n; end if;
  d := replace(d, $q$if pr.categoria in ('set','dirty') then$q$,
                  $q$if pr.categoria in ('set','dirty') or (pr.categoria = 'especial' and coalesce(pr.formato,'mochi') in ('set','dirty')) then$q$);
  if position($q$v_name := pr.nombre;$q$ in d) = 0 then raise exception 'create_order_v5: no encontré el nombre'; end if;
  d := replace(d, $q$v_name := pr.nombre;$q$,
                  $q$v_name := pr.nombre;
      if pr.categoria = 'especial' and coalesce(v_esp->>'estado','') <> 'disponible' then
        raise exception '% no está disponible ahora', pr.nombre;
      end if;$q$);
  if position($q$if pr.categoria in ('set','dirty') and coalesce((v_pers$q$ in d) = 0 then raise exception 'create_order_v5: no encontré la personalización'; end if;
  d := replace(d, $q$if pr.categoria in ('set','dirty') and coalesce((v_pers$q$,
                  $q$if (pr.categoria in ('set','dirty') or (pr.categoria = 'especial' and coalesce(pr.formato,'mochi') in ('set','dirty'))) and coalesce((v_pers$q$);
  execute d;
end $$;
