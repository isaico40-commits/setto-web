-- 071 · Costos: el lugar de compra es obligatorio y sale de una lista.
--
--   costo_lugares   lista de lugares donde se compra (mismos nombres que la app de compras,
--                   así después se pueden cruzar). Se agrega uno nuevo al cargar un precio.
--   costo_precios   + detalle (marca o presentación, opcional). El lugar pasa a ser obligatorio
--                   para los precios nuevos.
--
-- Se puede correr más de una vez.

create table if not exists public.costo_lugares (
  id         uuid primary key default gen_random_uuid(),
  nombre     text not null check (length(trim(nombre)) between 1 and 60),
  activo     boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index if not exists costo_lugares_nombre_key on public.costo_lugares (lower(trim(nombre)));

alter table public.costo_precios add column if not exists detalle text;

-- Lugares que ya usa la app de compras para Setto (mismo nombre exacto).
insert into public.costo_lugares (nombre)
select v.n from (values ('Makro'), ('Multienvases'), ('Feria'), ('Roland (papelera)'), ('Rimoldi'), ('Rivadavia y champa')) v(n)
where not exists (select 1 from public.costo_lugares l where lower(l.nombre) = lower(v.n));

-- Ordenar los precios ya cargados: "Makro (Aro 1 L)" → lugar "Makro" + detalle "Aro 1 L".
update public.costo_precios
   set detalle = coalesce(detalle, nullif(trim(substring(lugar from '\(([^)]*)\)\s*$')), '')),
       lugar   = trim(regexp_replace(lugar, '\s*\([^)]*\)\s*$', ''))
 where lugar ~ '\([^)]*\)\s*$' and lugar !~* '^roland';
update public.costo_precios set lugar = 'Roland (papelera)' where lower(trim(lugar)) = 'roland';
update public.costo_precios set lugar = 'Rivadavia y champa' where lower(trim(lugar)) in ('rivadavia y champagnat', 'rivadavia y champa');
-- Lo que quede escrito a mano entra a la lista.
insert into public.costo_lugares (nombre)
select distinct on (lower(trim(p.lugar))) trim(p.lugar) from public.costo_precios p
where coalesce(trim(p.lugar), '') <> '' and not exists (select 1 from public.costo_lugares l where lower(l.nombre) = lower(trim(p.lugar)));
-- Y queda escrito igual que en la lista.
update public.costo_precios p set lugar = l.nombre from public.costo_lugares l
 where lower(trim(p.lugar)) = lower(l.nombre) and p.lugar <> l.nombre;

create or replace view public.costo_precio_actual with (security_invoker = true) as
  select distinct on (p.insumo_id) p.insumo_id, p.id as precio_id, p.precio, p.paquete,
         round(p.precio / p.paquete, 6) as por_unidad, p.fecha, p.origen, p.lugar, p.registro, p.created_at, p.detalle
  from public.costo_precios p
  order by p.insumo_id, p.fecha desc, p.created_at desc;

alter table public.costo_lugares enable row level security;
drop policy if exists "costo_lugares lee" on public.costo_lugares;
create policy "costo_lugares lee" on public.costo_lugares for select to authenticated using (public.is_staff());
revoke all on public.costo_lugares from anon;
revoke insert, update, delete, truncate on public.costo_lugares from authenticated;
grant select on public.costo_lugares to authenticated;
revoke all on public.costo_precio_actual from anon;
grant select on public.costo_precio_actual to authenticated;

-- Cargar precio: ahora pide el lugar. Si es nuevo, lo suma a la lista.
drop function if exists public.costo_precio_cargar(uuid, numeric, numeric, date, text, text, text);
create or replace function public.costo_precio_cargar(p_insumo uuid, p_precio numeric, p_paquete numeric, p_fecha date, p_lugar text, p_origen text, p_por text, p_detalle text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_lugar text := nullif(left(regexp_replace(trim(coalesce(p_lugar, '')), '\s+', ' ', 'g'), 60), ''); v_l text;
begin
  if not public.is_staff() then raise exception 'Sin permiso'; end if;
  if coalesce(trim(p_por), '') = '' then raise exception 'Falta quién carga'; end if;
  if p_precio is null or p_precio <= 0 or p_precio > 100000000 then raise exception 'Precio inválido'; end if;
  if p_paquete is null or p_paquete <= 0 then raise exception 'Poné cuánto trae el paquete'; end if;
  if v_lugar is null then raise exception 'Elegí dónde lo compraste'; end if;
  if not exists (select 1 from costo_insumos where id = p_insumo) then raise exception 'No encontré ese insumo'; end if;
  if p_fecha is not null and p_fecha > (now() at time zone 'America/Argentina/Buenos_Aires')::date then raise exception 'La fecha no puede ser futura'; end if;
  select nombre into v_l from costo_lugares where lower(nombre) = lower(v_lugar);
  if v_l is null then
    insert into costo_lugares (nombre) values (v_lugar) returning nombre into v_l;
    insert into caja_log (tabla, fila_id, accion, por, despues)
      select 'costo_lugar', id::text, 'creado', p_por, to_jsonb(l) from costo_lugares l where nombre = v_l;
  end if;
  insert into costo_precios (insumo_id, precio, paquete, fecha, origen, lugar, detalle, registro)
  values (p_insumo, round(p_precio, 2), p_paquete, coalesce(p_fecha, (now() at time zone 'America/Argentina/Buenos_Aires')::date),
          coalesce(nullif(p_origen, ''), 'manual'), v_l, nullif(left(trim(coalesce(p_detalle, '')), 60), ''), p_por)
  returning id into v_id;
  update costo_insumos set paquete = p_paquete, updated_at = now() where id = p_insumo;
  insert into caja_log (tabla, fila_id, accion, por, despues) select 'costo_precio', v_id::text, 'cargado', p_por, to_jsonb(p) from costo_precios p where id = v_id;
  return v_id;
end $$;
revoke execute on function public.costo_precio_cargar(uuid, numeric, numeric, date, text, text, text, text) from public, anon;
grant execute on function public.costo_precio_cargar(uuid, numeric, numeric, date, text, text, text, text) to authenticated;
