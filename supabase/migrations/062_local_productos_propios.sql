-- 062 · Local: productos que no están en la web (facturas, medialunas, agua…).
--   - Tabla local_productos: nombre y precio, solo para el mostrador. El equipo los crea, edita y oculta desde la pestaña Local
--     (función local_producto_guardar; nadie escribe la tabla directo).
--   - local_lineas acepta dos líneas nuevas:
--       {"tipo":"lp","lp":"<uuid>","qty":2}                 → precio desde local_productos (la base lo recalcula)
--       {"tipo":"libre","nombre":"Agua","precio":1500,"qty":1} → suelto, nombre y precio a mano (solo equipo, igual que el descuento)
--   - No tocan stock de mochis (no son productos de la carta). En la Caja figuran por nombre.
--   Se puede correr más de una vez. Requiere la 058.

create table if not exists public.local_productos (
  id         uuid primary key default gen_random_uuid(),
  nombre     text not null,
  precio     integer not null,
  activo     boolean not null default true,
  orden      integer not null default 0,
  created_at timestamptz not null default now(),
  constraint local_productos_nombre_chk check (length(trim(nombre)) between 1 and 40),
  constraint local_productos_precio_chk check (precio between 1 and 10000000)
);
create unique index if not exists local_productos_nombre_key on public.local_productos (lower(trim(nombre))) where activo;

alter table public.local_productos enable row level security;
drop policy if exists "local_productos lee" on public.local_productos;
create policy "local_productos lee" on public.local_productos for select to authenticated using (public.is_staff());
-- el equipo no escribe la tabla directo: crea, edita y oculta con local_producto_guardar (no se borran, se ocultan)
revoke all on public.local_productos from anon;
revoke insert, update, delete, truncate on public.local_productos from authenticated;
grant select on public.local_productos to authenticated;

create or replace function public.local_producto_guardar(p_id uuid, p_nombre text, p_precio int, p_activo boolean default true)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_nom text := nullif(left(regexp_replace(trim(coalesce(p_nombre, '')), '\s+', ' ', 'g'), 40), ''); r local_productos%rowtype;
begin
  if not public.is_staff() then raise exception 'Sin permiso'; end if;
  if v_nom is null then raise exception 'Poné el nombre del producto'; end if;
  if p_precio is null or p_precio < 1 or p_precio > 10000000 then raise exception 'Precio inválido'; end if;
  if p_id is null then
    -- si ya hay uno activo con ese nombre, se actualiza el precio en vez de duplicarlo
    select * into r from local_productos where activo and lower(trim(nombre)) = lower(v_nom) limit 1;
    if found then
      update local_productos set precio = p_precio where id = r.id returning * into r;
    else
      insert into local_productos (nombre, precio, orden)
      values (v_nom, p_precio, coalesce((select max(orden) + 1 from local_productos), 0)) returning * into r;
    end if;
  else
    if coalesce(p_activo, true) and exists (select 1 from local_productos where activo and id <> p_id and lower(trim(nombre)) = lower(v_nom)) then
      raise exception 'Ya hay otro producto que se llama %', v_nom;
    end if;
    update local_productos set nombre = v_nom, precio = p_precio, activo = coalesce(p_activo, true) where id = p_id returning * into r;
    if not found then raise exception 'No encontré ese producto'; end if;
  end if;
  return to_jsonb(r);
end $$;
revoke all on function public.local_producto_guardar(uuid, text, int, boolean) from public, anon;
grant execute on function public.local_producto_guardar(uuid, text, int, boolean) to authenticated;

create or replace function public.local_lineas(p_items jsonb) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_pers   jsonb := coalesce((select value from settings where key = 'personalizacion'), '{}'::jsonb);
  v_lines  jsonb := '[]'::jsonb;
  it jsonb; pr products%rowtype; bp products%rowtype;
  v_qty int; v_size text; v_price int; v_name text; v_leche text; v_lprec int; v_sin jsonb; v_det text; s text;
  v_beb text; v_mochis jsonb; v_cant int; v_nota text; v_bebida boolean; lp local_productos%rowtype;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'La comanda está vacía'; end if;
  if jsonb_array_length(p_items) > 40 then raise exception 'Demasiadas líneas en una comanda'; end if;
  for it in select * from jsonb_array_elements(p_items) loop
    if jsonb_typeof(it) <> 'object' then raise exception 'Línea inválida'; end if;
    v_qty := coalesce((it->>'qty')::int, 1);
    if v_qty < 1 or v_qty > 50 then raise exception 'Cantidad inválida'; end if;
    v_nota := nullif(left(regexp_replace(trim(coalesce(it->>'nota', '')), '\s+', ' ', 'g'), 80), '');

    -- productos propios del local (facturas, etc.): el precio sale de local_productos
    if it->>'tipo' = 'lp' then
      if coalesce(it->>'lp', '') !~ '^[0-9a-fA-F-]{36}$' then raise exception 'Producto del local inválido'; end if;
      select * into lp from local_productos where id = (it->>'lp')::uuid and activo;
      if not found then raise exception 'Un producto del local ya no está disponible'; end if;
      v_lines := v_lines || jsonb_strip_nulls(jsonb_build_object('id', 'lp:' || lp.id, 'nombre', lp.nombre, 'qty', v_qty,
        'precio', lp.precio, 'subtotal', lp.precio * v_qty, 'nota', v_nota));
      continue;
    end if;
    -- producto suelto cargado a mano en el mostrador (nombre y precio los pone el equipo)
    if it->>'tipo' = 'libre' then
      v_name := nullif(left(regexp_replace(trim(coalesce(it->>'nombre', '')), '\s+', ' ', 'g'), 40), '');
      if v_name is null then raise exception 'Poné el nombre del producto'; end if;
      if coalesce(it->>'precio', '') !~ '^[0-9]{1,8}$' or (it->>'precio')::int < 1 or (it->>'precio')::int > 10000000 then
        raise exception 'Precio inválido para %', v_name;
      end if;
      v_price := (it->>'precio')::int;
      v_lines := v_lines || jsonb_strip_nulls(jsonb_build_object('id', 'libre', 'nombre', v_name, 'qty', v_qty,
        'precio', v_price, 'subtotal', v_price * v_qty, 'nota', v_nota));
      continue;
    end if;

    v_size := it->>'size';
    select * into pr from products where id = it->>'id' and activo;
    if not found then raise exception 'Un producto ya no está en la carta'; end if;
    if pr.agotado then raise exception '% está agotado', trim(pr.nombre); end if;
    v_bebida := pr.categoria in ('set', 'dirty') or (pr.categoria = 'especial' and coalesce(pr.formato, 'mochi') in ('set', 'dirty'));
    if v_bebida then
      if v_size = '12 oz' then v_price := pr.precio_12;
      elsif v_size = '16 oz' then v_price := pr.precio_16;
      else raise exception 'Falta elegir el tamaño de %', trim(pr.nombre); end if;
      v_name := trim(pr.nombre);
    else
      v_size := null; v_price := pr.precio;
      v_name := case when pr.categoria = 'promo' then trim(pr.nombre) else 'Mochi ' || trim(pr.nombre) end;
    end if;
    if coalesce(v_price, 0) <= 0 then raise exception '% todavía no tiene precio', trim(pr.nombre); end if;

    v_det := null; v_leche := null; v_sin := '[]'::jsonb;
    if v_bebida and coalesce((v_pers->>'activo')::boolean, true) then
      v_leche := nullif(trim(coalesce(it->>'leche', '')), '');
      if v_leche is not null then
        v_lprec := null;
        select (l->>'precio')::int into v_lprec from jsonb_array_elements(coalesce(v_pers->'leches', '[]'::jsonb)) l where l->>'nombre' = v_leche limit 1;
        if not found then raise exception 'Esa leche ya no está disponible'; end if;
        v_price := v_price + greatest(0, coalesce(v_lprec, 0));
        if coalesce(v_lprec, 0) > 0 or v_leche <> coalesce(v_pers->'leches'->0->>'nombre', '') then v_det := v_leche; end if;
      end if;
      if jsonb_typeof(it->'sin') = 'array' then
        for s in select jsonb_array_elements_text(it->'sin') loop
          if not (coalesce(v_pers->'sin', '[]'::jsonb) ? s) then raise exception 'Opción no disponible: %', s; end if;
          if not (v_sin ? s) then v_sin := v_sin || to_jsonb(s); end if;
        end loop;
        if jsonb_array_length(v_sin) > 0 then
          v_det := concat_ws(' · ', v_det, (select string_agg(x, ' · ') from jsonb_array_elements_text(v_sin) x));
        end if;
      end if;
    end if;

    v_beb := null;
    if pr.categoria = 'especial' and coalesce(pr.formato, 'mochi') = 'set' and pr.set_bebida is null then
      select * into bp from products where id = it->>'bebida' and categoria = 'especial' and coalesce(formato, 'mochi') = 'dirty' and activo and not agotado;
      if not found then raise exception 'Elegí la bebida del %', trim(pr.nombre); end if;
      v_beb := bp.id;
      v_det := concat_ws(' · ', 'Bebida: ' || trim(bp.nombre), v_det);
    end if;

    v_mochis := null;
    if pr.categoria = 'promo' then
      v_cant := coalesce(pr.promo_cant, 5);
      if coalesce(jsonb_typeof(it->'mochis'), '') <> 'array' or jsonb_array_length(it->'mochis') <> v_cant then
        raise exception 'Elegí los % mochis de %', v_cant, trim(pr.nombre);
      end if;
      v_mochis := '[]'::jsonb;
      for s in select jsonb_array_elements_text(it->'mochis') loop
        select * into bp from products where id = s and categoria = 'mochi' and activo and not agotado;
        if not found then raise exception 'Un sabor de % ya no está disponible', trim(pr.nombre); end if;
        v_mochis := v_mochis || to_jsonb(bp.id);
      end loop;
      select string_agg(t.nom || case when t.c > 1 then ' ×' || t.c else '' end, ' · ' order by t.pos) into v_det
        from (select trim(p.nombre) as nom, count(*) as c, min(e.pos) as pos
                from jsonb_array_elements_text(v_mochis) with ordinality as e(id, pos) join products p on p.id = e.id
               group by p.id, p.nombre) t;
    end if;

    v_nota := nullif(left(regexp_replace(trim(coalesce(it->>'nota', '')), '\s+', ' ', 'g'), 80), '');
    v_lines := v_lines || jsonb_strip_nulls(jsonb_build_object('id', pr.id, 'nombre', v_name, 'size', v_size, 'qty', v_qty, 'precio', v_price,
      'subtotal', v_price * v_qty, 'leche', v_leche, 'sin', case when jsonb_array_length(v_sin) > 0 then v_sin end, 'detalle', v_det,
      'bebida', v_beb, 'mochis', v_mochis, 'nota', v_nota));
  end loop;
  return v_lines;
end $$;
revoke all on function public.local_lineas(jsonb) from public, anon, authenticated;
