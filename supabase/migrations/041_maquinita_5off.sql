-- 041: cuarto premio de la maquinita. 3 iguales = 5% off (porcentaje sobre productos, como el 10%).
-- Chance por defecto 5%; se edita desde Panel → Ajustes → Maquinita como los otros.
create or replace function public.maq_premios_cfg() returns table (id text, titulo text, chance numeric, tipo text, valor int)
language sql stable set search_path = public as $$
  with cfg as (select coalesce((select value->'premios' from settings where key = 'maquinita'), 'null'::jsonb) p),
  def(id, titulo, chance, tipo, valor, ord) as (values
    ('gift', 'Gift card $10.000', 0.1::numeric, 'monto', 10000, 1),
    ('mochi', 'Mochi gratis', 0.5::numeric, 'mochi', 0, 2),
    ('off', '10% off', 2::numeric, 'porcentaje', 10, 3),
    ('off5', '5% off', 5::numeric, 'porcentaje', 5, 4))
  select d.id,
         coalesce(nullif(trim(c->>'titulo'), ''), case when c is null then d.titulo end),
         case when c is null then d.chance else greatest(0, coalesce((c->>'chance')::numeric, 0)) end,
         coalesce(nullif(c->>'tipo', ''), d.tipo),
         case when c ? 'valor' then greatest(0, coalesce((c->>'valor')::int, 0)) else d.valor end
  from def d
  left join lateral (select e c from cfg, jsonb_array_elements(case when jsonb_typeof(cfg.p) = 'array' then cfg.p else '[]'::jsonb end) e where e->>'id' = d.id limit 1) x on true
  order by d.ord
$$;
revoke all on function public.maq_premios_cfg() from public, anon, authenticated;
