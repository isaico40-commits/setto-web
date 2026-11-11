-- 059 · Sección destacada: promos del día (además de los drops).
--   - products.oferta_de: un producto de la sección que es "promo de" un producto de la carta. La web muestra el
--     precio de la carta tachado y, si es un mochi, descuenta del stock de ese mochi.
--   - especial_abierto(): si el panel apagó la sección (settings.especial.visible = false) no se puede pedir nada de ahí.
--   - caja_mochis_de_items(): un mochi en promo cuenta como el mochi de la carta (stock web, caja y local).
--   Se puede correr más de una vez. No toca pedidos ni productos existentes.

alter table public.products add column if not exists oferta_de text references public.products(id) on delete set null;

create or replace function public.especial_abierto() returns boolean
language plpgsql stable security definer set search_path = public as $$
declare v jsonb := (select value from settings where key = 'especial');
begin
  if v is null then return false; end if;
  if coalesce((v->>'visible')::boolean, true) = false then return false; end if;
  if coalesce(v->>'modo', 'manual') <> 'programado' then return coalesce(v->>'estado', '') = 'disponible'; end if;
  if nullif(v->>'lanzamiento', '') is null or now() < (v->>'lanzamiento')::timestamptz then return false; end if;
  if nullif(v->>'fin', '') is not null and now() >= (v->>'fin')::timestamptz then return false; end if;
  return true;
exception when others then
  return false; -- una fecha mal cargada nunca abre la venta
end $$;
grant execute on function public.especial_abierto() to anon, authenticated;

create or replace function public.caja_mochis_de_items(p_items jsonb)
returns table(product_id text, qty integer)
language sql stable security definer set search_path = public as $$
  select m.mochi, sum(m.q)::int from (
    select case
             when x->>'id' = 'premio' then
               (select set_mochi from products where categoria = 'set'
                  and nombre = substring(x->>'nombre' from '^Premio Setto Club: (.*) \([0-9]+ oz\) de regalo$') limit 1)
             else
               (select case when categoria = 'set' or (categoria = 'especial' and coalesce(formato,'mochi') = 'set') then set_mochi
                            when categoria = 'mochi' then id
                            when categoria = 'especial' and coalesce(formato,'mochi') = 'mochi' then coalesce(oferta_de, id) end
                  from products where id = x->>'id')
           end as mochi,
           greatest(coalesce((x->>'qty')::int, 1), 1) as q
      from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) x
    union all
    select mm.id, greatest(coalesce((x->>'qty')::int, 1), 1)
      from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) x
      cross join lateral jsonb_array_elements_text(case when jsonb_typeof(x->'mochis') = 'array' then x->'mochis' else '[]'::jsonb end) as mm(id)
  ) m
  where m.mochi is not null
  group by m.mochi
$$;
