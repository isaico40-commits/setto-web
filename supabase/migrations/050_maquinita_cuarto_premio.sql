-- Maquinita: un cuarto premio ("extra", sale con 3 iguales) que arranca vacío y apagado, y una casilla Activo por premio.
-- Un premio solo se puede ganar si está activo, tiene nombre, probabilidad > 0 y valor (salvo el mochi gratis).
-- Los 3 premios de antes siguen igual: si no tienen "activo" guardado, cuentan como activos.
create or replace function public.maq_premios_cfg() returns table (id text, titulo text, chance numeric, tipo text, valor int)
language sql stable set search_path = public as $$
  with cfg as (select coalesce((select value->'premios' from settings where key = 'maquinita'), 'null'::jsonb) p),
  def(id, titulo, chance, tipo, valor, ord) as (values
    ('gift', 'Gift card $10.000', 0.1::numeric, 'monto', 10000, 1),
    ('mochi', 'Mochi gratis', 0.5::numeric, 'mochi', 0, 2),
    ('off', '10% off', 2::numeric, 'porcentaje', 10, 3),
    ('extra', null, 0::numeric, 'porcentaje', 0, 4)),
  r as (
    select d.id, d.ord,
           coalesce(nullif(trim(c->>'titulo'), ''), case when c is null then d.titulo end) titulo,
           case when c is null then d.chance
                when coalesce(c->>'activo', 'true') = 'false' then 0
                else greatest(0, coalesce((c->>'chance')::numeric, 0)) end chance,
           coalesce(nullif(c->>'tipo', ''), d.tipo) tipo,
           case when c ? 'valor' then greatest(0, coalesce((c->>'valor')::int, 0)) else d.valor end valor
    from def d
    left join lateral (select e c from cfg, jsonb_array_elements(case when jsonb_typeof(cfg.p) = 'array' then cfg.p else '[]'::jsonb end) e where e->>'id' = d.id limit 1) x on true)
  select id, titulo, case when tipo <> 'mochi' and valor <= 0 then 0 else chance end, tipo, valor
  from r order by ord
$$;
revoke all on function public.maq_premios_cfg() from public, anon, authenticated;
