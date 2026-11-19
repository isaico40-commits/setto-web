-- =====================================================================
-- 070 · Caja: costos de producción (materia prima + packaging)
--
--   costo_insumos        lo que se compra: leche, azúcar, matcha, vasos…
--                        unidad base g / ml (= cc) / u, y cuánto trae el paquete.
--   costo_precios        historial de precios por insumo. El costo usa SIEMPRE
--                        el último (por fecha y, si empatan, el último cargado).
--                        Cada precio guarda cuánto traía ese paquete.
--   costo_recetas        preparaciones base (masa, siropes, foams, pulpa,
--                        espresso…) y recetas de productos de la carta
--                        (por tamaño en dirtys). Rinde, unidad del rinde y
--                        merma % (estimada) editables.
--   costo_receta_lineas  ingredientes de cada receta: un insumo o una
--                        preparación base, con su cantidad.
--
-- No entran producción, mano de obra ni alquiler (por ahora). Los Sets no
-- tienen receta: la Caja suma bebida + mochi de la carta (set_bebida, set_mochi).
-- El cálculo lo hace la Caja en el navegador (se recalcula al editar).
--
-- Nadie escribe las tablas directo: se guarda con las funciones costo_*,
-- que revisan que sea del equipo y dejan todo en caja_log.
--
-- Carga inicial: insumos (sin precios) y las recetas de Obsidian. Solo se
-- cargan si no existen; no pisa lo que ya editaron.
-- Se puede correr más de una vez.
-- =====================================================================

-- ---------- Tablas ----------
create table if not exists public.costo_insumos (
  id         uuid primary key default gen_random_uuid(),
  nombre     text not null,
  tipo       text not null default 'materia' check (tipo in ('materia','packaging')),
  unidad     text not null check (unidad in ('g','ml','u')),
  paquete    numeric check (paquete is null or paquete > 0),   -- cuánto trae el paquete que se suele comprar (sugerencia)
  activo     boolean not null default true,
  orden      integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint costo_insumos_nombre_chk check (length(trim(nombre)) between 1 and 60)
);
create unique index if not exists costo_insumos_nombre_key on public.costo_insumos (lower(trim(nombre))) where activo;

create table if not exists public.costo_precios (
  id         uuid primary key default gen_random_uuid(),
  insumo_id  uuid not null references public.costo_insumos(id),
  precio     numeric(12,2) not null check (precio > 0),     -- lo que se pagó por el paquete
  paquete    numeric not null check (paquete > 0),          -- cuánto traía ese paquete (en la unidad del insumo)
  fecha      date not null default ((now() at time zone 'America/Argentina/Buenos_Aires')::date),
  origen     text not null default 'manual' check (origen in ('manual','compras','app')),
  lugar      text,
  registro   text not null,
  created_at timestamptz not null default now()
);
create index if not exists costo_precios_insumo_idx on public.costo_precios (insumo_id, fecha desc, created_at desc);

create table if not exists public.costo_recetas (
  id           uuid primary key default gen_random_uuid(),
  nombre       text not null,
  tipo         text not null check (tipo in ('base','producto')),
  product_id   text references public.products(id) on delete set null,
  tamano       text check (tamano in ('12 oz','16 oz')),
  rinde        numeric not null default 1 check (rinde > 0),
  rinde_unidad text not null default 'u' check (rinde_unidad in ('g','ml','u')),
  merma        numeric not null default 0 check (merma >= 0 and merma < 90),
  nota         text,
  activo       boolean not null default true,
  orden        integer not null default 0,
  seed_key     text unique,                                 -- solo para la carga inicial
  updated_por  text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint costo_recetas_nombre_chk check (length(trim(nombre)) between 1 and 60),
  constraint costo_recetas_forma check (tipo = 'base' or product_id is not null)
);
create unique index if not exists costo_recetas_producto_key on public.costo_recetas (product_id, coalesce(tamano, '')) where activo and tipo = 'producto';
create unique index if not exists costo_recetas_base_key on public.costo_recetas (lower(trim(nombre))) where activo and tipo = 'base';

create table if not exists public.costo_receta_lineas (
  id        uuid primary key default gen_random_uuid(),
  receta_id uuid not null references public.costo_recetas(id) on delete cascade,
  insumo_id uuid references public.costo_insumos(id),
  sub_id    uuid references public.costo_recetas(id),
  cantidad  numeric not null check (cantidad > 0),
  parte     text,                                            -- para agrupar en la ficha: Masa, Relleno, Bebida, Foam, Packaging…
  orden     integer not null default 0,
  constraint costo_linea_una_cosa check ((insumo_id is not null) <> (sub_id is not null)),
  constraint costo_linea_no_si_misma check (sub_id is null or sub_id <> receta_id)
);
create index if not exists costo_receta_lineas_receta_idx on public.costo_receta_lineas (receta_id, orden);

-- último precio de cada insumo (precio por unidad base = precio / paquete)
create or replace view public.costo_precio_actual with (security_invoker = true) as
  select distinct on (p.insumo_id) p.insumo_id, p.id as precio_id, p.precio, p.paquete,
         round(p.precio / p.paquete, 6) as por_unidad, p.fecha, p.origen, p.lugar, p.registro, p.created_at
  from public.costo_precios p
  order by p.insumo_id, p.fecha desc, p.created_at desc;

-- ---------- Seguridad: el equipo lee; se escribe solo con las funciones ----------
alter table public.costo_insumos       enable row level security;
alter table public.costo_precios       enable row level security;
alter table public.costo_recetas       enable row level security;
alter table public.costo_receta_lineas enable row level security;
do $$
declare t text;
begin
  foreach t in array array['costo_insumos','costo_precios','costo_recetas','costo_receta_lineas'] loop
    execute format('drop policy if exists "%1$s lee" on public.%1$I', t);
    execute format('create policy "%1$s lee" on public.%1$I for select to authenticated using (public.is_staff())', t);
    execute format('revoke all on public.%1$I from anon', t);
    execute format('revoke insert, update, delete, truncate on public.%1$I from authenticated', t);
    execute format('grant select on public.%1$I to authenticated', t);
  end loop;
end $$;
revoke all on public.costo_precio_actual from anon;
grant select on public.costo_precio_actual to authenticated;

-- ---------- Funciones ----------
-- Insumo: crear o editar (p_id null = nuevo). Ocultar = p_activo false.
create or replace function public.costo_insumo_guardar(p_id uuid, p_nombre text, p_tipo text, p_unidad text, p_paquete numeric, p_activo boolean, p_por text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_nom text := nullif(left(regexp_replace(trim(coalesce(p_nombre, '')), '\s+', ' ', 'g'), 60), ''); v_id uuid; v_antes jsonb;
begin
  if not public.is_staff() then raise exception 'Sin permiso'; end if;
  if coalesce(trim(p_por), '') = '' then raise exception 'Falta quién carga'; end if;
  if v_nom is null then raise exception 'Poné el nombre del insumo'; end if;
  if p_unidad not in ('g','ml','u') then raise exception 'Unidad inválida'; end if;
  if coalesce(p_tipo, 'materia') not in ('materia','packaging') then raise exception 'Tipo inválido'; end if;
  if p_paquete is not null and p_paquete <= 0 then raise exception 'El paquete tiene que traer algo'; end if;
  if coalesce(p_activo, true) and exists (select 1 from costo_insumos where activo and lower(trim(nombre)) = lower(v_nom) and id is distinct from p_id) then
    raise exception 'Ya hay un insumo que se llama %', v_nom;
  end if;
  if p_id is null then
    insert into costo_insumos (nombre, tipo, unidad, paquete, orden)
    values (v_nom, coalesce(p_tipo, 'materia'), p_unidad, p_paquete, coalesce((select max(orden) from costo_insumos), 0) + 1)
    returning id into v_id;
    insert into caja_log (tabla, fila_id, accion, por, despues) select 'costo_insumo', v_id::text, 'creado', p_por, to_jsonb(i) from costo_insumos i where id = v_id;
  else
    select to_jsonb(i) into v_antes from costo_insumos i where id = p_id;
    if v_antes is null then raise exception 'No encontré ese insumo'; end if;
    if (v_antes->>'unidad') <> p_unidad and exists (select 1 from costo_precios where insumo_id = p_id) then
      raise exception 'No se puede cambiar la unidad de un insumo con precios cargados. Creá otro.';
    end if;
    update costo_insumos set nombre = v_nom, tipo = coalesce(p_tipo, tipo), unidad = p_unidad, paquete = p_paquete,
           activo = coalesce(p_activo, activo), updated_at = now()
     where id = p_id returning id into v_id;
    insert into caja_log (tabla, fila_id, accion, por, antes, despues) select 'costo_insumo', v_id::text, case when coalesce(p_activo, true) then 'editado' else 'ocultado' end, p_por, v_antes, to_jsonb(i) from costo_insumos i where id = v_id;
  end if;
  return v_id;
end $$;

-- Precio nuevo de un insumo (lo que se pagó por el paquete y cuánto traía).
create or replace function public.costo_precio_cargar(p_insumo uuid, p_precio numeric, p_paquete numeric, p_fecha date, p_lugar text, p_origen text, p_por text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not public.is_staff() then raise exception 'Sin permiso'; end if;
  if coalesce(trim(p_por), '') = '' then raise exception 'Falta quién carga'; end if;
  if p_precio is null or p_precio <= 0 or p_precio > 100000000 then raise exception 'Precio inválido'; end if;
  if p_paquete is null or p_paquete <= 0 then raise exception 'Poné cuánto trae el paquete'; end if;
  if not exists (select 1 from costo_insumos where id = p_insumo) then raise exception 'No encontré ese insumo'; end if;
  if p_fecha is not null and p_fecha > (now() at time zone 'America/Argentina/Buenos_Aires')::date then raise exception 'La fecha no puede ser futura'; end if;
  insert into costo_precios (insumo_id, precio, paquete, fecha, origen, lugar, registro)
  values (p_insumo, round(p_precio, 2), p_paquete, coalesce(p_fecha, (now() at time zone 'America/Argentina/Buenos_Aires')::date),
          coalesce(nullif(p_origen, ''), 'manual'), nullif(left(trim(coalesce(p_lugar, '')), 60), ''), p_por)
  returning id into v_id;
  update costo_insumos set paquete = p_paquete, updated_at = now() where id = p_insumo;
  insert into caja_log (tabla, fila_id, accion, por, despues) select 'costo_precio', v_id::text, 'cargado', p_por, to_jsonb(p) from costo_precios p where id = v_id;
  return v_id;
end $$;

-- Receta: crear o editar todo junto (datos + ingredientes).
--   p_datos  = {"nombre","tipo","product_id","tamano","rinde","rinde_unidad","merma","nota","activo"}
--   p_lineas = [{"insumo_id"| "sub_id", "cantidad", "parte"}, …]  (reemplaza las anteriores)
create or replace function public.costo_receta_guardar(p_id uuid, p_datos jsonb, p_lineas jsonb, p_por text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id uuid; v_antes jsonb; v_nom text; v_tipo text; v_prod text; v_tam text; l jsonb; i int := 0; v_ciclo boolean;
begin
  if not public.is_staff() then raise exception 'Sin permiso'; end if;
  if coalesce(trim(p_por), '') = '' then raise exception 'Falta quién carga'; end if;
  v_nom  := nullif(left(regexp_replace(trim(coalesce(p_datos->>'nombre', '')), '\s+', ' ', 'g'), 60), '');
  v_tipo := coalesce(p_datos->>'tipo', 'base');
  v_prod := nullif(p_datos->>'product_id', '');
  v_tam  := nullif(p_datos->>'tamano', '');
  if v_nom is null then raise exception 'Poné el nombre de la receta'; end if;
  if v_tipo not in ('base','producto') then raise exception 'Tipo inválido'; end if;
  if v_tipo = 'producto' and v_prod is null then raise exception 'Elegí el producto de la carta'; end if;
  if v_tipo = 'producto' and not exists (select 1 from products where id = v_prod) then raise exception 'Ese producto no está en la carta'; end if;
  if coalesce((p_datos->>'rinde')::numeric, 0) <= 0 then raise exception 'El rinde tiene que ser mayor a 0'; end if;
  if coalesce((p_datos->>'merma')::numeric, 0) < 0 or coalesce((p_datos->>'merma')::numeric, 0) >= 90 then raise exception 'La merma va de 0 a 89 %%'; end if;
  if coalesce((p_datos->>'activo')::boolean, true) then
    if v_tipo = 'producto' and exists (select 1 from costo_recetas where activo and tipo = 'producto' and product_id = v_prod and coalesce(tamano, '') = coalesce(v_tam, '') and id is distinct from p_id) then
      raise exception 'Ese producto ya tiene receta%', coalesce(' en ' || v_tam, '');
    end if;
    if v_tipo = 'base' and exists (select 1 from costo_recetas where activo and tipo = 'base' and lower(trim(nombre)) = lower(v_nom) and id is distinct from p_id) then
      raise exception 'Ya hay una preparación que se llama %', v_nom;
    end if;
  end if;

  if p_id is null then
    insert into costo_recetas (nombre, tipo, product_id, tamano, rinde, rinde_unidad, merma, nota, orden, updated_por)
    values (v_nom, v_tipo, case when v_tipo = 'producto' then v_prod end, case when v_tipo = 'producto' then v_tam end,
            (p_datos->>'rinde')::numeric, coalesce(p_datos->>'rinde_unidad', 'u'), coalesce((p_datos->>'merma')::numeric, 0),
            nullif(trim(coalesce(p_datos->>'nota', '')), ''), coalesce((select max(orden) from costo_recetas), 0) + 1, p_por)
    returning id into v_id;
  else
    select to_jsonb(r) || jsonb_build_object('lineas', coalesce((select jsonb_agg(to_jsonb(x) - 'receta_id' - 'id' order by x.orden) from costo_receta_lineas x where x.receta_id = r.id), '[]'::jsonb))
      into v_antes from costo_recetas r where id = p_id;
    if v_antes is null then raise exception 'No encontré esa receta'; end if;
    update costo_recetas set nombre = v_nom, tipo = v_tipo,
           product_id = case when v_tipo = 'producto' then v_prod end, tamano = case when v_tipo = 'producto' then v_tam end,
           rinde = (p_datos->>'rinde')::numeric, rinde_unidad = coalesce(p_datos->>'rinde_unidad', rinde_unidad),
           merma = coalesce((p_datos->>'merma')::numeric, 0), nota = nullif(trim(coalesce(p_datos->>'nota', '')), ''),
           activo = coalesce((p_datos->>'activo')::boolean, activo), updated_por = p_por, updated_at = now()
     where id = p_id returning id into v_id;
  end if;

  if v_antes is not null and exists (select 1 from costo_receta_lineas x join costo_recetas o on o.id = x.receta_id where x.sub_id = v_id and o.activo)
     and (select rinde_unidad from costo_recetas where id = v_id) is distinct from (v_antes->>'rinde_unidad') then
    raise exception 'Esta preparación se usa en otras recetas: no le cambies la unidad del rinde';
  end if;

  if p_lineas is not null then
    delete from costo_receta_lineas where receta_id = v_id;
    for l in select * from jsonb_array_elements(p_lineas) loop
      i := i + 1;
      if coalesce((l->>'cantidad')::numeric, 0) <= 0 then raise exception 'Hay un ingrediente sin cantidad'; end if;
      insert into costo_receta_lineas (receta_id, insumo_id, sub_id, cantidad, parte, orden)
      values (v_id, nullif(l->>'insumo_id', '')::uuid, nullif(l->>'sub_id', '')::uuid, (l->>'cantidad')::numeric,
              nullif(left(trim(coalesce(l->>'parte', '')), 30), ''), i);
    end loop;
    -- que ninguna preparación termine usándose a sí misma (A usa B y B usa A)
    with recursive baja(id, camino) as (
      select sub_id, array[v_id] from costo_receta_lineas where receta_id = v_id and sub_id is not null
      union all
      select x.sub_id, b.camino || b.id from baja b join costo_receta_lineas x on x.receta_id = b.id
      where x.sub_id is not null and not (b.id = any(b.camino))
    ) select exists (select 1 from baja where id = v_id) into v_ciclo;
    if v_ciclo then raise exception 'Esa preparación termina usándose a sí misma'; end if;
  end if;

  insert into caja_log (tabla, fila_id, accion, por, antes, despues)
  select 'costo_receta', v_id::text,
         case when p_id is null then 'creada' when not r.activo then 'ocultada' else 'editada' end, p_por, v_antes,
         to_jsonb(r) || jsonb_build_object('lineas', coalesce((select jsonb_agg(to_jsonb(x) - 'receta_id' - 'id' order by x.orden) from costo_receta_lineas x where x.receta_id = r.id), '[]'::jsonb))
  from costo_recetas r where id = v_id;
  return v_id;
end $$;

revoke execute on function public.costo_insumo_guardar(uuid, text, text, text, numeric, boolean, text) from public, anon;
revoke execute on function public.costo_precio_cargar(uuid, numeric, numeric, date, text, text, text) from public, anon;
revoke execute on function public.costo_receta_guardar(uuid, jsonb, jsonb, text) from public, anon;
grant execute on function public.costo_insumo_guardar(uuid, text, text, text, numeric, boolean, text) to authenticated;
grant execute on function public.costo_precio_cargar(uuid, numeric, numeric, date, text, text, text) to authenticated;
grant execute on function public.costo_receta_guardar(uuid, jsonb, jsonb, text) to authenticated;

-- ---------- Carga inicial (de Obsidian, sin precios) ----------
-- Insumos: solo nombre, tipo y unidad. Cuánto trae el paquete y el precio se cargan desde la Caja.
insert into public.costo_insumos (nombre, tipo, unidad, orden)
select v.nombre, v.tipo, v.unidad, v.orden
from (values
  ('Leche entera', 'materia', 'ml', 1),
  ('Azúcar', 'materia', 'g', 2),
  ('Maicena', 'materia', 'g', 3),
  ('Harina de arroz glutinoso', 'materia', 'g', 4),
  ('Manteca', 'materia', 'g', 5),
  ('Crema de leche', 'materia', 'ml', 6),
  ('Crema Ledevit chantilly', 'materia', 'ml', 7),
  ('Chocolate Alpino', 'materia', 'g', 8),
  ('Frutillas', 'materia', 'g', 9),
  ('Limón', 'materia', 'u', 10),
  ('Matcha', 'materia', 'g', 11),
  ('Café en grano', 'materia', 'g', 12),
  ('Esencia de vainilla', 'materia', 'ml', 13),
  ('Coco rallado', 'materia', 'g', 14),
  ('Lavanda', 'materia', 'g', 15),
  ('Vaso Darnel 12 oz', 'packaging', 'u', 50),
  ('Vaso Darnel 16 oz', 'packaging', 'u', 51)
) v(nombre, tipo, unidad, orden)
where not exists (select 1 from public.costo_insumos i where lower(trim(i.nombre)) = lower(v.nombre));

do $$
declare
  ins jsonb; sub jsonb := '{}'::jsonb; v_id uuid;
  -- receta: (seed_key, nombre, tipo, product_id, tamano, rinde, unidad, nota, lineas[[tipo, nombre, cantidad, parte]])
  r record;
begin
  select jsonb_object_agg(lower(nombre), id) into ins from public.costo_insumos where activo;

  for r in select * from (values
    -- preparaciones base
    ('masa-mochi', 'Masa de mochi', 'base', null, null, 6::numeric, 'u', 'Receta del script de Obsidian (la que rinde 6, con manteca).',
      '[["i","Leche entera",180],["i","Azúcar",40],["i","Maicena",35],["i","Harina de arroz glutinoso",100],["i","Manteca",25]]'),
    ('simple-syrup', 'Simple Syrup', 'base', null, null, 1500, 'ml', 'Lleva 1000 ml de agua (no suma costo).',
      '[["i","Azúcar",1000]]'),
    ('vainilla-syrup', 'Vainilla Syrup', 'base', null, null, 1500, 'ml', 'Lleva 1000 ml de agua (no suma costo).',
      '[["i","Azúcar",1000],["i","Esencia de vainilla",10]]'),
    ('coconut-syrup', 'Coconut Syrup', 'base', null, null, 1000, 'ml', 'Revisar: el script usa 700 g de azúcar y la tabla de Obsidian dice 1000 g. Lleva 1000 ml de agua.',
      '[["i","Azúcar",700],["i","Coco rallado",160]]'),
    ('lavender-syrup', 'Lavender Syrup', 'base', null, null, 1500, 'ml', 'Lleva 1000 ml de agua (no suma costo).',
      '[["i","Azúcar",1000],["i","Lavanda",10]]'),
    ('caramel-syrup', 'Caramel Syrup', 'base', null, null, 400, 'ml', 'Lleva 10 ml de agua (no suma costo).',
      '[["i","Azúcar",200],["i","Crema de leche",200]]'),
    ('espresso', 'Espresso', 'base', null, null, 30, 'ml', '18 g de café por shot. Cambiá los gramos o el rinde si varía.',
      '[["i","Café en grano",18]]'),
    ('cold-brew', 'Cold Brew', 'base', null, null, 800, 'ml', 'Lleva 1000 ml de agua (no suma costo).',
      '[["i","Café en grano",100]]'),
    ('pulpa-frutilla', 'Pulpa de frutilla', 'base', null, null, 1000, 'g', 'Falta el rinde real: pesá cuánto sale y corregilo (está puesto 1000 g).',
      '[["i","Frutillas",1000],["i","Azúcar",250],["i","Limón",1]]'),
    ('cold-foam', 'Cold Foam', 'base', null, null, 90, 'g', null,
      '[["i","Crema de leche",45],["i","Leche entera",30],["s","Simple Syrup",15]]'),
    ('vanilla-foam', 'Vanilla Foam', 'base', null, null, 90, 'g', null,
      '[["i","Crema de leche",45],["i","Leche entera",30],["s","Vainilla Syrup",15]]'),
    ('coconut-foam', 'Coconut Foam', 'base', null, null, 45, 'g', null,
      '[["i","Crema de leche",20],["i","Leche entera",10],["s","Coconut Syrup",15]]'),
    ('ganache-choco', 'Relleno de chocolate', 'base', null, null, 3, 'u', 'Alcanza para 3 mochis (según Obsidian).',
      '[["i","Chocolate Alpino",50],["i","Crema de leche",50]]'),
    -- productos de la carta (los mochis se calculan por tanda de 6)
    ('mochi-frutilla', 'Mochi Frutilla', 'producto', 'mochi-frutilla', null, 6, 'u', 'Revisar: en Obsidian la crema dice 210 cc pero el script calculaba con 200.',
      '[["s","Masa de mochi",6,"Masa"],["s","Pulpa de frutilla",200,"Relleno"],["i","Crema Ledevit chantilly",210,"Relleno"]]'),
    ('mochi-chocolate', 'Mochi Chocolate', 'producto', 'mochi-chocolate', null, 6, 'u', null,
      '[["s","Masa de mochi",6,"Masa"],["s","Relleno de chocolate",6,"Relleno"],["i","Crema Ledevit chantilly",200,"Relleno"]]'),
    ('strawberry-12', 'Strawberry Matcha', 'producto', 'dirty-strawberry', '12 oz', 1, 'u', 'Lleva 50 ml de agua.',
      '[["s","Pulpa de frutilla",30,"Bebida"],["i","Leche entera",100,"Bebida"],["i","Matcha",3,"Bebida"],["s","Simple Syrup",20,"Bebida"],["s","Cold Foam",40,"Foam"],["i","Vaso Darnel 12 oz",1,"Packaging"]]'),
    ('strawberry-16', 'Strawberry Matcha', 'producto', 'dirty-strawberry', '16 oz', 1, 'u', 'Lleva 90 ml de agua.',
      '[["s","Pulpa de frutilla",60,"Bebida"],["i","Leche entera",120,"Bebida"],["i","Matcha",5,"Bebida"],["s","Simple Syrup",30,"Bebida"],["s","Cold Foam",60,"Foam"],["i","Vaso Darnel 16 oz",1,"Packaging"]]'),
    ('lavender-12', 'Lavender Matcha', 'producto', 'dirty-lavender', '12 oz', 1, 'u', 'Lleva 60 ml de agua.',
      '[["s","Lavender Syrup",20,"Bebida"],["i","Leche entera",90,"Bebida"],["i","Matcha",3,"Bebida"],["s","Cold Foam",40,"Foam"],["i","Vaso Darnel 12 oz",1,"Packaging"]]'),
    ('lavender-16', 'Lavender Matcha', 'producto', 'dirty-lavender', '16 oz', 1, 'u', 'Revisar: en Obsidian figura Coconut Syrup y pulpa de frutilla (¿copiado del Strawberry?). Lleva 90 ml de agua.',
      '[["s","Coconut Syrup",30,"Bebida"],["s","Pulpa de frutilla",60,"Bebida"],["i","Leche entera",120,"Bebida"],["i","Matcha",5,"Bebida"],["s","Cold Foam",40,"Foam"],["i","Vaso Darnel 16 oz",1,"Packaging"]]'),
    ('coconut-12', 'Coconut Dirty', 'producto', 'dirty-coconut', '12 oz', 1, 'u', null,
      '[["s","Coconut Syrup",20,"Bebida"],["i","Leche entera",120,"Bebida"],["s","Espresso",30,"Bebida"],["s","Coconut Foam",40,"Foam"],["i","Vaso Darnel 12 oz",1,"Packaging"]]'),
    ('coconut-16', 'Coconut Dirty', 'producto', 'dirty-coconut', '16 oz', 1, 'u', null,
      '[["s","Coconut Syrup",30,"Bebida"],["i","Leche entera",170,"Bebida"],["s","Espresso",60,"Bebida"],["s","Coconut Foam",60,"Foam"],["i","Vaso Darnel 16 oz",1,"Packaging"]]'),
    ('caramel-12', 'Caramel Vanilla Dirty', 'producto', 'dirty-caramel', '12 oz', 1, 'u', null,
      '[["s","Vainilla Syrup",30,"Bebida"],["s","Caramel Syrup",15,"Bebida"],["i","Leche entera",120,"Bebida"],["s","Espresso",30,"Bebida"],["s","Vanilla Foam",40,"Foam"],["i","Vaso Darnel 12 oz",1,"Packaging"]]'),
    ('caramel-16', 'Caramel Vanilla Dirty', 'producto', 'dirty-caramel', '16 oz', 1, 'u', 'Revisar: 40 ml de caramelo acá y 15 ml en el de 12 oz.',
      '[["s","Vainilla Syrup",30,"Bebida"],["s","Caramel Syrup",40,"Bebida"],["i","Leche entera",160,"Bebida"],["s","Espresso",60,"Bebida"],["s","Vanilla Foam",60,"Foam"],["i","Vaso Darnel 16 oz",1,"Packaging"]]')
  ) t(seed_key, nombre, tipo, product_id, tamano, rinde, unidad, nota, lineas)
  loop
    continue when exists (select 1 from public.costo_recetas where seed_key = r.seed_key);
    continue when r.product_id is not null and not exists (select 1 from public.products where id = r.product_id);
    insert into public.costo_recetas (nombre, tipo, product_id, tamano, rinde, rinde_unidad, nota, orden, seed_key, updated_por)
    values (r.nombre, r.tipo, r.product_id, r.tamano, r.rinde, r.unidad, r.nota,
            coalesce((select max(orden) from public.costo_recetas), 0) + 1, r.seed_key, 'Carga inicial')
    returning id into v_id;
    if r.tipo = 'base' then sub := sub || jsonb_build_object(lower(r.nombre), v_id); end if;
    insert into public.costo_receta_lineas (receta_id, insumo_id, sub_id, cantidad, parte, orden)
    select v_id,
           case when e.x->>0 = 'i' then (ins->>lower(e.x->>1))::uuid end,
           case when e.x->>0 = 's' then coalesce((sub->>lower(e.x->>1))::uuid, (select id from public.costo_recetas b where b.activo and b.tipo = 'base' and lower(b.nombre) = lower(e.x->>1) limit 1)) end,
           (e.x->>2)::numeric, e.x->>3, e.n
    from jsonb_array_elements(r.lineas::jsonb) with ordinality e(x, n)
    where (e.x->>0 = 'i' and ins ? lower(e.x->>1))
       or (e.x->>0 = 's' and (sub ? lower(e.x->>1) or exists (select 1 from public.costo_recetas b where b.activo and b.tipo = 'base' and lower(b.nombre) = lower(e.x->>1))));
  end loop;
end $$;
