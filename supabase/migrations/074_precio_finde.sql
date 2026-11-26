-- 074 · Setto Weekend con precio de finde
-- settings.finde = {visible, desde, hasta, sets:[id], precios:{id:{p12,p16}}}
-- Mientras la sección está abierta (visible, now() entre desde y hasta), los sets tildados se cobran
-- a su precio de finde. Fuera de esas fechas (o sin precio cargado) se cobra el precio normal del set.
-- Misma regla que findeEstado() en js/api.js y findePrecio() en js/site.js / js/local.js.

create or replace function public.finde_precio(p_id text, p_size text)
returns integer
language sql
stable
security definer
set search_path to 'public'
as $$
  select case when v > 0 then v end
  from (
    select round(nullif(case p_size when '12 oz' then f->'precios'->p_id->>'p12'
                                    when '16 oz' then f->'precios'->p_id->>'p16' end, '')::numeric)::int as v
    from (select value as f from settings where key = 'finde') s
    where coalesce(f->>'visible', 'true') <> 'false'
      and jsonb_typeof(f->'sets') = 'array' and (f->'sets') ? p_id
      and (nullif(f->>'desde', '') is null or now() >= (f->>'desde')::timestamptz)
      and (nullif(f->>'hasta', '') is null or now() <  (f->>'hasta')::timestamptz)
      and exists (select 1 from products where id = p_id and categoria = 'set')
  ) x
$$;

revoke all on function public.finde_precio(text, text) from public;
grant execute on function public.finde_precio(text, text) to anon, authenticated;

-- Las tres funciones que ponen precio (web sin código, web con código, mostrador) toman el precio de finde
-- si corresponde. Se parchea la definición que está en la base para no pisar nada más.
do $$
declare
  f   regprocedure;
  d   text;
  n   text;
begin
  foreach f in array array[
    'public.create_order_v6(text,text,jsonb,text,text,text,text,text,text,text,text)'::regprocedure,
    'public.create_order_v7(text,text,jsonb,text,text,text,text,text,text,text,text,text)'::regprocedure,
    'public.local_lineas(jsonb)'::regprocedure
  ] loop
    d := pg_get_functiondef(f);
    if position('finde_precio' in d) > 0 then continue; end if; -- ya parcheada
    n := replace(replace(d,
      'v_price := pr.precio_12;', 'v_price := coalesce(public.finde_precio(pr.id, ''12 oz''), pr.precio_12);'),
      'v_price := pr.precio_16;', 'v_price := coalesce(public.finde_precio(pr.id, ''16 oz''), pr.precio_16);');
    if n = d or position('finde_precio(pr.id, ''12 oz'')' in n) = 0 or position('finde_precio(pr.id, ''16 oz'')' in n) = 0 then
      raise exception 'No encontré dónde poner el precio de finde en %', f;
    end if;
    execute n;
  end loop;
end $$;
