-- 058 · Local: comandas del mostrador (tickear, mandar a barra, cobrar).
--   - Tabla comandas: número del día (#1, #2…), productos con el mismo formato que los pedidos web, estado de barra y cobro.
--   - El equipo NO escribe la tabla directo: todo pasa por funciones que chequean is_staff() y recalculan los precios
--     desde products y settings.personalizacion (el navegador solo manda ids, tamaño, leche, "sin", cantidades).
--   - Cobrar = una entrada en caja_movimientos (categoría "Venta en el local", cuenta efectivo o mp) con los items,
--     así el trigger caja_venta_stock de la 048 descuenta los mochis del Café y el Dashboard la cuenta sola.
--   - Si alguien anula esa entrada desde la Caja, la comanda vuelve a figurar "sin cobrar".
--   Se puede correr más de una vez. No toca pedidos web ni movimientos existentes.

insert into public.caja_categorias (id, nombre, tipo, orden, activa)
values ('local', 'Venta en el local', 'entrada', 0, true)
on conflict (id) do nothing;

create table if not exists public.comandas (
  id            uuid primary key default gen_random_uuid(),
  dia           date not null default (now() at time zone 'America/Argentina/Buenos_Aires')::date,
  numero        integer not null,
  nombre        text,
  nota          text,
  items         jsonb not null,
  subtotal      integer not null,
  descuento     integer not null default 0,
  total         integer not null,
  estado        text not null default 'barra',
  pago          text,
  cuenta_id     text references public.caja_cuentas(id),
  pagado        boolean not null default false,
  paga_con      integer,
  caja_mov_id   uuid references public.caja_movimientos(id),
  registro      text not null,
  created_at    timestamptz not null default now(),
  lista_at      timestamptz,
  entregada_at  timestamptz,
  cobrada_at    timestamptz,
  anulada_at    timestamptz,
  anulada_por   text,
  anulada_motivo text,
  constraint comandas_estado_chk check (estado in ('barra', 'lista', 'entregada', 'anulada')),
  constraint comandas_items_chk check (jsonb_typeof(items) = 'array'),
  constraint comandas_montos_chk check (subtotal >= 0 and descuento >= 0 and descuento <= subtotal and total = subtotal - descuento),
  constraint comandas_dia_numero_key unique (dia, numero)
);
create index if not exists comandas_dia_idx on public.comandas (dia desc, estado);

alter table public.comandas enable row level security;
drop policy if exists "comandas lee" on public.comandas;
create policy "comandas lee" on public.comandas for select to authenticated using (public.is_staff());
-- sin políticas de insert/update/delete: solo las funciones de abajo (security definer) escriben
revoke insert, update, delete, truncate on public.comandas from anon, authenticated;
revoke all on public.comandas from anon;
grant select on public.comandas to authenticated;

do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'comandas') then
    alter publication supabase_realtime add table public.comandas;
  end if;
exception when undefined_object then null; -- sin realtime (base local de prueba)
end $$;

-- ---------- helpers ----------
create or replace function public.local_quien(p_quien text) returns text
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select nombre from caja_socios where activo and nombre = trim(coalesce(p_quien, '')) limit 1),
    (select nullif(trim(nombre), '') from staff where user_id = auth.uid()),
    'Local');
$$;
revoke all on function public.local_quien(text) from public, anon, authenticated;

-- forma de pago del local → texto y cuenta de la caja
create or replace function public.local_medio(p_pago text, out etiqueta text, out cuenta text)
language plpgsql immutable as $$
begin
  case coalesce(p_pago, '')
    when 'efectivo' then etiqueta := 'Efectivo'; cuenta := 'efectivo';
    when 'qr' then etiqueta := 'QR Mercado Pago'; cuenta := 'mp';
    when 'transferencia' then etiqueta := 'Transferencia'; cuenta := 'mp';
    when 'tarjeta' then etiqueta := 'Tarjeta'; cuenta := 'mp';
    else raise exception 'Elegí cómo paga';
  end case;
end $$;
revoke all on function public.local_medio(text) from public, anon, authenticated;

-- precios y detalle de cada línea, calculados acá (mismas reglas que create_order_v6, sin envío ni premios).
-- Diferencia con la web: los productos del Especial se pueden vender en el local aunque el drop web no esté abierto (si están activos y no agotados).
create or replace function public.local_lineas(p_items jsonb) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_pers   jsonb := coalesce((select value from settings where key = 'personalizacion'), '{}'::jsonb);
  v_lines  jsonb := '[]'::jsonb;
  it jsonb; pr products%rowtype; bp products%rowtype;
  v_qty int; v_size text; v_price int; v_name text; v_leche text; v_lprec int; v_sin jsonb; v_det text; s text;
  v_beb text; v_mochis jsonb; v_cant int; v_nota text; v_bebida boolean;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'La comanda está vacía'; end if;
  if jsonb_array_length(p_items) > 40 then raise exception 'Demasiadas líneas en una comanda'; end if;
  for it in select * from jsonb_array_elements(p_items) loop
    if jsonb_typeof(it) <> 'object' then raise exception 'Línea inválida'; end if;
    v_qty := coalesce((it->>'qty')::int, 1);
    if v_qty < 1 or v_qty > 50 then raise exception 'Cantidad inválida'; end if;
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

-- ---------- cobrar (interno: lo usan crear y cobrar) ----------
create or replace function public.local_cobrar_int(p_id uuid, p_pago text, p_paga_con int, p_quien text) returns void
language plpgsql security definer set search_path = public as $$
declare c comandas%rowtype; m record; v_mov uuid; v_det text;
begin
  select * into c from comandas where id = p_id for update;
  if not found then raise exception 'No encontré esa comanda'; end if;
  if c.estado = 'anulada' then raise exception 'La comanda #% está anulada', c.numero; end if;
  if c.pagado then raise exception 'La comanda #% ya está cobrada', c.numero; end if;
  select * into m from local_medio(p_pago);
  if not exists (select 1 from caja_cuentas where id = m.cuenta and activa) then raise exception 'La cuenta % no está activa en la caja', m.cuenta; end if;
  if p_paga_con is not null and (p_paga_con < c.total or p_paga_con > 10000000) then raise exception 'Con eso no alcanza para pagar'; end if;
  if c.total > 0 then
    v_det := left('Local #' || c.numero || coalesce(' · ' || nullif(trim(c.nombre), ''), ''), 80);
    insert into caja_movimientos (fecha, tipo, detalle, monto, cuenta_id, categoria_id, registro, legacy_id, items)
    values ((now() at time zone 'America/Argentina/Buenos_Aires')::date, 'entrada', v_det, c.total, m.cuenta, 'local', p_quien,
            'comanda:' || c.id || ':' || md5(clock_timestamp()::text), c.items)
    returning id into v_mov;
  end if;
  update comandas set pagado = true, pago = m.etiqueta, cuenta_id = m.cuenta, caja_mov_id = v_mov, cobrada_at = now(),
         paga_con = case when p_pago = 'efectivo' then p_paga_con end
   where id = c.id;
end $$;
revoke all on function public.local_cobrar_int(uuid, text, int, text) from public, anon, authenticated;

-- ---------- API del panel ----------
create or replace function public.local_crear(p_items jsonb, p_nombre text default null, p_nota text default null,
  p_descuento int default 0, p_pago text default null, p_paga_con int default null, p_quien text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_dia date := (now() at time zone 'America/Argentina/Buenos_Aires')::date;
  v_lines jsonb; v_sub int; v_desc int := coalesce(p_descuento, 0); v_num int; v_id uuid; v_quien text; r jsonb;
begin
  if not public.is_staff() then raise exception 'Sin permiso'; end if;
  if length(coalesce(p_nombre, '')) > 40 then raise exception 'El nombre es muy largo'; end if;
  if length(coalesce(p_nota, '')) > 200 then raise exception 'La nota es muy larga'; end if;
  v_lines := local_lineas(p_items);
  select coalesce(sum((x->>'subtotal')::int), 0) into v_sub from jsonb_array_elements(v_lines) x;
  if v_desc < 0 or v_desc > v_sub then raise exception 'El descuento no puede superar el total'; end if;
  v_quien := local_quien(p_quien);
  perform pg_advisory_xact_lock(hashtext('comandas:' || v_dia));
  select coalesce(max(numero), 0) + 1 into v_num from comandas where dia = v_dia;
  insert into comandas (dia, numero, nombre, nota, items, subtotal, descuento, total, registro)
  values (v_dia, v_num, nullif(trim(coalesce(p_nombre, '')), ''), nullif(trim(coalesce(p_nota, '')), ''), v_lines, v_sub, v_desc, v_sub - v_desc, v_quien)
  returning id into v_id;
  if nullif(p_pago, '') is not null then perform local_cobrar_int(v_id, p_pago, p_paga_con, v_quien); end if;
  select to_jsonb(c) into r from comandas c where id = v_id;
  return r;
end $$;
revoke all on function public.local_crear(jsonb, text, text, int, text, int, text) from public, anon;
grant execute on function public.local_crear(jsonb, text, text, int, text, int, text) to authenticated;

create or replace function public.local_cobrar(p_id uuid, p_pago text, p_paga_con int default null, p_quien text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r jsonb;
begin
  if not public.is_staff() then raise exception 'Sin permiso'; end if;
  perform local_cobrar_int(p_id, p_pago, p_paga_con, local_quien(p_quien));
  select to_jsonb(c) into r from comandas c where id = p_id;
  return r;
end $$;
revoke all on function public.local_cobrar(uuid, text, int, text) from public, anon;
grant execute on function public.local_cobrar(uuid, text, int, text) to authenticated;

-- barra → lista → entregada (y volver un paso si se tocó sin querer)
create or replace function public.local_estado(p_id uuid, p_estado text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c comandas%rowtype; r jsonb;
begin
  if not public.is_staff() then raise exception 'Sin permiso'; end if;
  if p_estado not in ('barra', 'lista', 'entregada') then raise exception 'Estado inválido'; end if;
  select * into c from comandas where id = p_id for update;
  if not found then raise exception 'No encontré esa comanda'; end if;
  if c.estado = 'anulada' then raise exception 'La comanda #% está anulada', c.numero; end if;
  update comandas set estado = p_estado,
         lista_at = case when p_estado = 'barra' then null when p_estado = 'lista' then now() else coalesce(lista_at, now()) end,
         entregada_at = case when p_estado = 'entregada' then now() end
   where id = p_id;
  select to_jsonb(x) into r from comandas x where id = p_id;
  return r;
end $$;
revoke all on function public.local_estado(uuid, text) from public, anon;
grant execute on function public.local_estado(uuid, text) to authenticated;

-- cambiar la forma de pago de una comanda ya cobrada (mueve la entrada de cuenta en la caja)
create or replace function public.local_cambiar_pago(p_id uuid, p_pago text, p_quien text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c comandas%rowtype; m record; r jsonb;
begin
  if not public.is_staff() then raise exception 'Sin permiso'; end if;
  select * into c from comandas where id = p_id for update;
  if not found then raise exception 'No encontré esa comanda'; end if;
  if not c.pagado then raise exception 'La comanda #% todavía no está cobrada', c.numero; end if;
  select * into m from local_medio(p_pago);
  if c.caja_mov_id is not null and m.cuenta is distinct from c.cuenta_id then
    update caja_movimientos set cuenta_id = m.cuenta, editado_por = local_quien(p_quien) where id = c.caja_mov_id and estado = 'activo';
  end if;
  update comandas set pago = m.etiqueta, cuenta_id = m.cuenta, paga_con = null where id = p_id;
  select to_jsonb(x) into r from comandas x where id = p_id;
  return r;
end $$;
revoke all on function public.local_cambiar_pago(uuid, text, text) from public, anon;
grant execute on function public.local_cambiar_pago(uuid, text, text) to authenticated;

-- anular: si estaba cobrada, se anula la entrada de la caja (y el trigger de la 048 devuelve los mochis al stock)
create or replace function public.local_anular(p_id uuid, p_motivo text, p_quien text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c comandas%rowtype; v_quien text := local_quien(p_quien); r jsonb;
begin
  if not public.is_staff() then raise exception 'Sin permiso'; end if;
  if coalesce(trim(p_motivo), '') = '' then raise exception 'Contá en pocas palabras por qué se anula'; end if;
  select * into c from comandas where id = p_id for update;
  if not found then raise exception 'No encontré esa comanda'; end if;
  if c.estado = 'anulada' then raise exception 'Ya estaba anulada'; end if;
  update comandas set estado = 'anulada', anulada_at = now(), anulada_por = v_quien, anulada_motivo = left(trim(p_motivo), 140) where id = p_id;
  if c.caja_mov_id is not null then
    update caja_movimientos set estado = 'anulado', anulado_por = v_quien, anulado_motivo = left('Comanda #' || c.numero || ' anulada: ' || trim(p_motivo), 140)
     where id = c.caja_mov_id and estado = 'activo';
  end if;
  select to_jsonb(x) into r from comandas x where id = p_id;
  return r;
end $$;
revoke all on function public.local_anular(uuid, text, text) from public, anon;
grant execute on function public.local_anular(uuid, text, text) to authenticated;

-- si anulan la entrada desde la Caja, la comanda vuelve a "sin cobrar"
create or replace function public.comanda_mov_anulado() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.estado = 'anulado' and old.estado = 'activo' and coalesce(new.legacy_id, '') like 'comanda:%' then
    update comandas set pagado = false, pago = null, cuenta_id = null, caja_mov_id = null, cobrada_at = null, paga_con = null
     where caja_mov_id = new.id and estado <> 'anulada';
  end if;
  return null;
end $$;
revoke all on function public.comanda_mov_anulado() from public, anon, authenticated;
drop trigger if exists comanda_mov_anulado on public.caja_movimientos;
create trigger comanda_mov_anulado after update of estado on public.caja_movimientos
  for each row execute function public.comanda_mov_anulado();
