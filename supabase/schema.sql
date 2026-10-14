-- =====================================================================
--  SETTO · Base de datos (Supabase / Postgres)
--  Pegar TODO este archivo en Supabase → SQL Editor → Run.
--  Se puede volver a correr: no borra datos cargados.
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- Equipo (quién puede entrar al panel)
-- ---------------------------------------------------------------------
create table if not exists public.staff (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  nombre     text,
  created_at timestamptz not null default now()
);

create or replace function public.is_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.staff where user_id = auth.uid());
$$;

-- ---------------------------------------------------------------------
-- Ajustes generales (WhatsApp, horarios, edición especial, club...)
-- ---------------------------------------------------------------------
create table if not exists public.settings (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Carta
-- ---------------------------------------------------------------------
create table if not exists public.products (
  id          text primary key,
  categoria   text not null check (categoria in ('especial','set','dirty','mochi')),
  nombre      text not null,
  descripcion text not null default '',
  img         text not null default '',
  precio      integer not null default 0,      -- mochis y especiales
  precio_12   integer,                          -- dirty y sets
  precio_16   integer,
  codigo      text,                             -- sets: "Set 01"
  tema        text,                             -- sets: "Matcha & cereza"
  set_bebida  text,                             -- sets: id de la bebida
  set_mochi   text,                             -- sets: id del mochi
  rotativo    boolean not null default false,
  agotado     boolean not null default false,
  activo      boolean not null default true,
  orden       integer not null default 0,
  updated_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Clientes del Setto Club (la clave es el celular normalizado 549XXXXXXXXXX)
-- ---------------------------------------------------------------------
create table if not exists public.customers (
  phone      text primary key,
  nombre     text,
  sellos     integer not null default 0,
  canjes     integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Pedidos de take away
-- ---------------------------------------------------------------------
create table if not exists public.orders (
  id         uuid primary key default gen_random_uuid(),
  code       text not null,
  nombre     text not null,
  phone      text not null,
  items      jsonb not null,
  total      integer not null,
  retiro     text,
  pago       text,
  nota       text,
  status     text not null default 'pendiente' check (status in ('pendiente','entregado','cancelado')),
  sellos     integer not null default 0,
  created_at timestamptz not null default now(),
  closed_at  timestamptz,
  closed_by  uuid
);
create unique index if not exists orders_code_pendiente on public.orders(code) where status = 'pendiente';
create index if not exists orders_created on public.orders(created_at desc);
-- Envío a domicilio y premio en el último sello (v2)
alter table public.orders add column if not exists modo text not null default 'retiro';
alter table public.orders add column if not exists direccion text;
alter table public.orders add column if not exists premio boolean not null default false;
alter table public.orders add column if not exists premio_txt text;
do $$ begin
  alter table public.orders add constraint orders_modo_check check (modo in ('retiro','envio'));
exception when duplicate_object then null; end $$;


-- Historial de sellos (sumas, restas y canjes)
create table if not exists public.stamp_events (
  id         bigserial primary key,
  phone      text not null,
  delta      integer not null,
  motivo     text,
  order_id   uuid,
  created_by uuid,
  created_at timestamptz not null default now()
);
create index if not exists stamp_events_phone on public.stamp_events(phone, created_at desc);

-- ---------------------------------------------------------------------
-- Seguridad (RLS)
--   · Cualquiera puede LEER la carta y los ajustes.
--   · Solo el equipo puede escribir carta/ajustes y ver pedidos/clientes.
--   · Los clientes crean pedidos y consultan su tarjeta SOLO por funciones.
-- ---------------------------------------------------------------------
alter table public.staff        enable row level security;
alter table public.settings     enable row level security;
alter table public.products     enable row level security;
alter table public.customers    enable row level security;
alter table public.orders       enable row level security;
alter table public.stamp_events enable row level security;

drop policy if exists "staff se ve a si mismo" on public.staff;
create policy "staff se ve a si mismo" on public.staff for select to authenticated using (user_id = auth.uid());

drop policy if exists "settings lectura publica" on public.settings;
create policy "settings lectura publica" on public.settings for select to anon, authenticated using (true);
drop policy if exists "settings escribe staff" on public.settings;
create policy "settings escribe staff" on public.settings for all to authenticated using (public.is_staff()) with check (public.is_staff());

drop policy if exists "products lectura publica" on public.products;
create policy "products lectura publica" on public.products for select to anon, authenticated using (true);
drop policy if exists "products escribe staff" on public.products;
create policy "products escribe staff" on public.products for all to authenticated using (public.is_staff()) with check (public.is_staff());

drop policy if exists "customers staff" on public.customers;
create policy "customers staff" on public.customers for all to authenticated using (public.is_staff()) with check (public.is_staff());

drop policy if exists "orders staff" on public.orders;
create policy "orders staff" on public.orders for all to authenticated using (public.is_staff()) with check (public.is_staff());

drop policy if exists "stamp_events staff" on public.stamp_events;
create policy "stamp_events staff" on public.stamp_events for select to authenticated using (public.is_staff());

-- ---------------------------------------------------------------------
-- Normalizar celulares argentinos a 549 + 10 dígitos
--   "223 347-1277", "0223 15 347-1277", "+54 9 223 347 1277" → 5492233471277
-- ---------------------------------------------------------------------
create or replace function public.norm_phone(p text) returns text
language plpgsql immutable set search_path = '' as $$
declare d text := regexp_replace(coalesce(p,''), '\D', '', 'g');
begin
  if d like '00%' then d := substr(d, 3); end if;
  if d like '549%' and length(d) = 13 then return d; end if;
  if d like '54%' and length(d) >= 12 then d := substr(d, 3); end if;
  if d like '9%' and length(d) = 11 then d := substr(d, 2); end if;
  if d like '0%' then d := substr(d, 2); end if;
  if length(d) = 12 then
    if    substr(d, 4, 2) = '15' then d := substr(d, 1, 3) || substr(d, 6);  -- 223 15 ...
    elsif substr(d, 3, 2) = '15' then d := substr(d, 1, 2) || substr(d, 5);  -- 11 15 ...
    elsif substr(d, 5, 2) = '15' then d := substr(d, 1, 4) || substr(d, 7);  -- 2266 15 ...
    end if;
  end if;
  if length(d) = 9 and d like '15%' then d := '223' || substr(d, 3); end if; -- 15 + número local de MdP
  if length(d) = 7 then d := '223' || d; end if;                            -- número local de MdP
  if length(d) <> 10 then return null; end if;
  return '549' || d;
end $$;

-- ---------------------------------------------------------------------
-- PÚBLICO · Consultar tarjeta del Club (solo devuelve sellos, no datos personales)
-- ---------------------------------------------------------------------
create or replace function public.get_card(p_phone text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_phone text := public.norm_phone(p_phone);
  v_club  jsonb := coalesce((select value from settings where key = 'club'), '{}'::jsonb);
  c       customers%rowtype;
begin
  if v_phone is null then raise exception 'El celular no parece válido'; end if;
  select * into c from customers where phone = v_phone;
  return jsonb_build_object(
    'existe', found,
    'sellos', coalesce(c.sellos, 0),
    'canjes', coalesce(c.canjes, 0),
    'meta',   coalesce((v_club->>'meta')::int, 8),
    'premio', coalesce(v_club->>'premio', '')
  );
end $$;

create or replace function public.cancel_order(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_staff() then raise exception 'Solo el equipo puede hacer esto'; end if;
  update orders set status = 'cancelado', closed_at = now(), closed_by = auth.uid() where id = p_id and status = 'pendiente';
  if not found then raise exception 'El pedido no está pendiente'; end if;
end $$;

-- ---------------------------------------------------------------------
-- EQUIPO · Sumar o restar sellos a mano (pedidos por apps, WhatsApp directo, correcciones)
-- ---------------------------------------------------------------------
create or replace function public.add_stamps(p_phone text, p_nombre text, p_delta integer, p_motivo text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_phone text := public.norm_phone(p_phone);
  v_total integer;
begin
  if not public.is_staff() then raise exception 'Solo el equipo puede hacer esto'; end if;
  if v_phone is null then raise exception 'Número de celular inválido'; end if;
  if coalesce(p_delta, 0) = 0 or abs(p_delta) > 20 then raise exception 'Cantidad de sellos inválida'; end if;

  insert into customers (phone, nombre, sellos) values (v_phone, nullif(trim(coalesce(p_nombre,'')), ''), greatest(0, p_delta))
  on conflict (phone) do update set sellos = greatest(0, customers.sellos + p_delta),
    nombre = coalesce(nullif(trim(coalesce(p_nombre,'')), ''), customers.nombre), updated_at = now()
  returning sellos into v_total;

  insert into stamp_events (phone, delta, motivo, created_by) values (v_phone, p_delta, coalesce(nullif(trim(p_motivo),''), 'Manual'), auth.uid());
  return jsonb_build_object('phone', v_phone, 'sellos', v_total);
end $$;

-- EQUIPO · Canjear premio (resta la meta de sellos)
create or replace function public.redeem_reward(p_phone text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_phone text := public.norm_phone(p_phone);
  v_meta  integer := coalesce(((select value from settings where key = 'club')->>'meta')::int, 8);
  c       customers%rowtype;
begin
  if not public.is_staff() then raise exception 'Solo el equipo puede hacer esto'; end if;
  select * into c from customers where phone = v_phone for update;
  if not found or c.sellos < v_meta then raise exception 'Todavía no completó la tarjeta'; end if;
  update customers set sellos = sellos - v_meta, canjes = canjes + 1, updated_at = now() where phone = v_phone;
  insert into stamp_events (phone, delta, motivo, created_by) values (v_phone, -v_meta, 'Canje de premio', auth.uid());
  return jsonb_build_object('phone', v_phone, 'sellos', c.sellos - v_meta, 'canjes', c.canjes + 1);
end $$;

revoke all on function public.get_card(text) from public;
grant execute on function public.get_card(text) to anon, authenticated;
grant execute on function public.norm_phone(text) to anon, authenticated;
revoke execute on function public.is_staff() from public, anon;
grant execute on function public.is_staff() to authenticated;
revoke all on function public.cancel_order(uuid) from public, anon;
revoke all on function public.add_stamps(text,text,integer,text) from public, anon;
revoke all on function public.redeem_reward(text) from public, anon;
grant execute on function public.cancel_order(uuid) to authenticated;
grant execute on function public.add_stamps(text,text,integer,text) to authenticated;
grant execute on function public.redeem_reward(text) to authenticated;

-- ---------------------------------------------------------------------
-- PÚBLICO · Crear pedido (precios calculados acá, no en el navegador)
--   p_items: [{"id":"set-sakura","size":"12 oz","qty":1}, ...]
--   p_modo: 'retiro' | 'envio'   ·   p_direccion: obligatoria si es envío
-- ---------------------------------------------------------------------
create or replace function public.create_order_v3(
  p_nombre text, p_phone text, p_items jsonb, p_retiro text, p_pago text, p_nota text,
  p_modo text default 'retiro', p_direccion text default null, p_premio text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_phone  text := public.norm_phone(p_phone);
  v_esp    jsonb := (select value from settings where key = 'especial');
  v_envio  jsonb := coalesce((select value from settings where key = 'envio'), '{}'::jsonb);
  v_club   jsonb := coalesce((select value from settings where key = 'club'), '{}'::jsonb);
  v_modo   text := coalesce(nullif(p_modo, ''), 'retiro');
  v_dir    text := nullif(trim(coalesce(p_direccion, '')), '');
  v_lines  jsonb := '[]'::jsonb;
  v_sub    integer := 0;
  v_total  integer;
  v_costo  integer := 0;
  v_code   text;
  v_id     uuid;
  it       jsonb;
  pr       products%rowtype;
  v_qty    integer;
  v_size   text;
  v_price  integer;
  v_name   text;
  v_tries  integer := 0;
  v_sellos integer := 0;
  v_meta   integer := coalesce((v_club->>'meta')::int, 8);
  v_spp    integer := coalesce((v_club->>'sellos_por_pedido')::int, 1);
  v_min    integer := coalesce((v_club->>'minimo')::int, 0);
  v_premio boolean := false;
  v_desc   integer := coalesce((v_club->>'premio_descuento')::int, 35);
  v_tope   integer := coalesce((v_club->>'premio_tope')::int, 0);
  v_pset   boolean := coalesce((v_club->>'premio_set')::boolean, true);
  v_off    integer := 0;
  v_ptxt   text;
  ps       products%rowtype;
begin
  if coalesce(trim(p_nombre), '') = '' or length(p_nombre) > 60 then raise exception 'Falta tu nombre'; end if;
  if v_phone is null then raise exception 'El celular no parece válido'; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'El pedido está vacío'; end if;
  if jsonb_array_length(p_items) > 30 then raise exception 'Demasiados productos en un pedido'; end if;
  if length(coalesce(p_nota,'')) > 300 or length(coalesce(p_retiro,'')) > 80 or length(coalesce(p_pago,'')) > 60 then raise exception 'Texto demasiado largo'; end if;
  if v_modo not in ('retiro', 'envio') then raise exception 'Forma de entrega inválida'; end if;
  if v_modo = 'envio' then
    if coalesce((v_envio->>'activo')::boolean, false) = false then raise exception 'Por ahora no hacemos envíos desde la web'; end if;
    if v_dir is null or length(v_dir) < 5 then raise exception 'Falta la dirección de entrega'; end if;
    if length(v_dir) > 200 then raise exception 'La dirección es demasiado larga'; end if;
    v_costo := greatest(0, coalesce((v_envio->>'costo')::int, 0));
  else
    v_dir := null;
  end if;
  if (select count(*) from orders where phone = v_phone and created_at > now() - interval '1 hour') >= 6 then
    raise exception 'Hiciste muchos pedidos seguidos. Escribinos por WhatsApp.';
  end if;

  for it in select * from jsonb_array_elements(p_items) loop
    v_qty  := greatest(1, least(20, coalesce((it->>'qty')::int, 1)));
    v_size := it->>'size';
    select * into pr from products where id = it->>'id' and activo;
    if not found then raise exception 'Un producto del pedido ya no está disponible'; end if;

    if pr.categoria in ('set','dirty') then
      if v_size = '12 oz' then v_price := pr.precio_12;
      elsif v_size = '16 oz' then v_price := pr.precio_16;
      else raise exception 'Falta elegir el tamaño de %', pr.nombre; end if;
      v_name := pr.nombre;
    else
      v_size := null; v_price := pr.precio; v_name := 'Mochi ' || pr.nombre;
      if pr.categoria = 'especial' and (coalesce(v_esp->>'estado','') <> 'disponible' or pr.agotado) then
        raise exception '% no está disponible ahora', pr.nombre;
      end if;
    end if;
    if pr.agotado then raise exception '% está agotado', pr.nombre; end if;
    if coalesce(v_price, 0) <= 0 then raise exception '% todavía no tiene precio', pr.nombre; end if;

    v_sub := v_sub + v_price * v_qty;
    v_lines := v_lines || jsonb_build_object('id', pr.id, 'nombre', v_name, 'size', v_size, 'qty', v_qty, 'precio', v_price, 'subtotal', v_price * v_qty);
  end loop;

  if v_costo > 0 then
    v_lines := v_lines || jsonb_build_object('id', 'envio', 'nombre', 'Envío', 'size', null, 'qty', 1, 'precio', v_costo, 'subtotal', v_costo);
  end if;
  v_total := v_sub + v_costo;

  -- ¿Este pedido completa la tarjeta del Club? (el premio va en este mismo pedido)
  select coalesce(sellos, 0) into v_sellos from customers where phone = v_phone;
  v_sellos := coalesce(v_sellos, 0);
  v_premio := coalesce((v_club->>'activo')::boolean, true) and v_spp > 0 and v_sub >= v_min and v_sellos + v_spp >= v_meta;

  -- Premio elegido por el cliente: un set de regalo o un % de descuento en este pedido
  if v_premio then
    if p_premio = 'descuento' and v_desc > 0 then
      v_off := (round(v_sub * v_desc / 100.0 / 10.0) * 10)::int;
      if v_tope > 0 then v_off := least(v_off, v_tope); end if;
      v_ptxt := v_desc || '% off en este pedido';
      v_lines := v_lines || jsonb_build_object('id', 'premio', 'nombre', 'Premio Setto Club: ' || v_ptxt, 'size', null, 'qty', 1, 'precio', -v_off, 'subtotal', -v_off);
      v_total := v_total - v_off;
    elsif p_premio like 'set:%' and v_pset then
      select * into ps from products where id = substr(p_premio, 5) and categoria = 'set' and activo and not agotado;
      if not found then raise exception 'Ese set no está disponible, elegí otro premio'; end if;
      v_ptxt := ps.nombre || ' (12 oz) de regalo';
      v_lines := v_lines || jsonb_build_object('id', 'premio', 'nombre', 'Premio Setto Club: ' || v_ptxt, 'size', '12 oz', 'qty', 1, 'precio', 0, 'subtotal', 0);
    else
      raise exception 'Elegí tu premio del Setto Club';
    end if;
  end if;

  loop
    v_code := 'STT-' || lpad((floor(random() * 10000))::int::text, 4, '0');
    exit when not exists (select 1 from orders where code = v_code and status = 'pendiente');
    v_tries := v_tries + 1;
    if v_tries > 50 then raise exception 'No se pudo generar el código, probá de nuevo'; end if;
  end loop;

  insert into orders (code, nombre, phone, items, total, retiro, pago, nota, modo, direccion, premio, premio_txt)
  values (v_code, trim(p_nombre), v_phone, v_lines, v_total, p_retiro, p_pago, nullif(trim(coalesce(p_nota,'')), ''),
          v_modo, v_dir, v_premio, v_ptxt)
  returning id into v_id;

  return jsonb_build_object('id', v_id, 'code', v_code, 'total', v_total, 'items', v_lines, 'phone', v_phone,
    'modo', v_modo, 'direccion', v_dir, 'costo_envio', v_costo,
    'premio', v_premio, 'premio_txt', v_ptxt, 'descuento', v_off,
    'sellos_antes', v_sellos, 'meta', v_meta);
end $$;

-- ---------------------------------------------------------------------
-- EQUIPO · Confirmar pedido entregado y sumar sellos.
--   Si con estos sellos completa la tarjeta, el premio se entrega en ESTE pedido:
--   se descuenta la meta y se suma un canje automáticamente.
-- ---------------------------------------------------------------------
create or replace function public.confirm_order(p_id uuid, p_phone text, p_sellos integer) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  o       orders%rowtype;
  v_phone text := public.norm_phone(p_phone);
  v_n     integer := greatest(0, least(10, coalesce(p_sellos, 0)));
  v_club  jsonb := coalesce((select value from settings where key = 'club'), '{}'::jsonb);
  v_meta  integer := coalesce(((select value from settings where key = 'club')->>'meta')::int, 8);
  v_total integer;
  v_canje boolean := false;
begin
  if not public.is_staff() then raise exception 'Solo el equipo puede hacer esto'; end if;
  if v_phone is null then raise exception 'Número de celular inválido'; end if;
  select * into o from orders where id = p_id for update;
  if not found then raise exception 'Pedido no encontrado'; end if;
  if o.status <> 'pendiente' then raise exception 'Ese pedido ya estaba %', o.status; end if;

  insert into customers (phone, nombre, sellos) values (v_phone, o.nombre, v_n)
  on conflict (phone) do update set sellos = customers.sellos + v_n, nombre = coalesce(customers.nombre, excluded.nombre), updated_at = now()
  returning sellos into v_total;
  if v_n > 0 then
    insert into stamp_events (phone, delta, motivo, order_id, created_by) values (v_phone, v_n, 'Pedido ' || o.code, o.id, auth.uid());
  end if;

  if v_n > 0 and coalesce((v_club->>'activo')::boolean, true) and v_total >= v_meta then
    update customers set sellos = sellos - v_meta, canjes = canjes + 1, updated_at = now() where phone = v_phone returning sellos into v_total;
    insert into stamp_events (phone, delta, motivo, order_id, created_by) values (v_phone, -v_meta, 'Premio entregado en ' || o.code, o.id, auth.uid());
    v_canje := true;
  end if;

  update orders set status = 'entregado', phone = v_phone, sellos = v_n, premio = v_canje,
    closed_at = now(), closed_by = auth.uid() where id = p_id;
  return jsonb_build_object('phone', v_phone, 'sellos', v_total, 'canje', v_canje, 'premio', v_club->>'premio');
end $$;

revoke all on function public.create_order_v3(text,text,jsonb,text,text,text,text,text,text) from public;
grant execute on function public.create_order_v3(text,text,jsonb,text,text,text,text,text,text) to anon, authenticated;
revoke all on function public.confirm_order(uuid,text,integer) from public, anon;
grant execute on function public.confirm_order(uuid,text,integer) to authenticated;

-- ---------------------------------------------------------------------
-- Avisos en vivo de pedidos nuevos en el panel (Realtime)
-- ---------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'orders') then
    execute 'alter publication supabase_realtime add table public.orders';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- Fotos de productos (Storage, carpeta pública "productos")
-- ---------------------------------------------------------------------
do $$
begin
  if exists (select 1 from information_schema.schemata where schema_name = 'storage') then
    insert into storage.buckets (id, name, public) values ('productos', 'productos', true) on conflict (id) do nothing;
    execute 'drop policy if exists "fotos staff sube" on storage.objects';
    execute 'create policy "fotos staff sube" on storage.objects for insert to authenticated with check (bucket_id = ''productos'' and public.is_staff())';
    execute 'drop policy if exists "fotos staff cambia" on storage.objects';
    execute 'create policy "fotos staff cambia" on storage.objects for update to authenticated using (bucket_id = ''productos'' and public.is_staff())';
    execute 'drop policy if exists "fotos staff borra" on storage.objects';
    execute 'create policy "fotos staff borra" on storage.objects for delete to authenticated using (bucket_id = ''productos'' and public.is_staff())';
  end if;
end $$;

-- =====================================================================
--  CARGA INICIAL (carta de octubre 2026). No pisa lo que ya editaste.
-- =====================================================================
insert into public.settings (key, value) values ('whatsapp', '"5492233471277"'::jsonb) on conflict (key) do nothing;
insert into public.settings (key, value) values ('whatsapp_visible', '"+54 9 223 347-1277"'::jsonb) on conflict (key) do nothing;
insert into public.settings (key, value) values ('instagram', '"setto.project"'::jsonb) on conflict (key) do nothing;
insert into public.settings (key, value) values ('links', '"https://setto-project.carrd.co/"'::jsonb) on conflict (key) do nothing;
insert into public.settings (key, value) values ('apps', '[{"nombre": "PedidosYa", "url": "https://www.pedidosya.com.ar/restaurantes/mar-del-plata/setto-1cd26341-e766-46b7-a4e5-1d19e284a9f2-menu"}, {"nombre": "Rappi", "url": "https://www.rappi.com.ar/restaurantes/delivery/110807-setto"}, {"nombre": "Uber Eats", "url": "https://www.ubereats.com/store/setto/6nnRIYyuW8-VwdbWxClQ3A"}]'::jsonb) on conflict (key) do nothing;
insert into public.settings (key, value) values ('pagos', '["Transferencia / Mercado Pago", "Efectivo al retirar"]'::jsonb) on conflict (key) do nothing;
insert into public.settings (key, value) values ('retiro', '{"dias": [0, 1, 2, 3, 4, 5, 6], "rangos": [["10:00", "13:00"], ["14:30", "21:00"]], "cadaMin": 30, "anticipacionMin": 40}'::jsonb) on conflict (key) do nothing;
insert into public.settings (key, value) values ('especial', '{"estado": "proximamente", "chip": "Próxima edición · fecha a confirmar", "intro": "Mochis inspirados en tortas. Salen una vez al mes y la fecha la anunciamos en Instagram."}'::jsonb) on conflict (key) do nothing;
insert into public.settings (key, value) values ('club', '{"meta": 8, "premio": "Un set de regalo o 35% off en ese pedido", "sellos_por_pedido": 1, "activo": true, "minimo": 0, "premio_set": true, "premio_descuento": 35, "premio_tope": 0}'::jsonb) on conflict (key) do nothing;
insert into public.settings (key, value) values ('envio', '{"activo": true, "costo": 0, "aviso": "Envíos en Mar del Plata. El costo del envío se coordina por WhatsApp según la zona."}'::jsonb) on conflict (key) do nothing;
insert into public.products (id, categoria, nombre, descripcion, img, precio, precio_12, precio_16, codigo, tema, set_bebida, set_mochi, rotativo, agotado, activo, orden) values ('esp-lemon', 'especial', 'Lemon Pie', 'Mochi inspirado en el lemon pie.', '', 0, null, null, null, null, null, null, false, false, true, 1) on conflict (id) do nothing;
insert into public.products (id, categoria, nombre, descripcion, img, precio, precio_12, precio_16, codigo, tema, set_bebida, set_mochi, rotativo, agotado, activo, orden) values ('esp-cheesecake', 'especial', 'Cheesecake de frutos rojos', 'Mochi inspirado en el cheesecake de frutos rojos.', '', 0, null, null, null, null, null, null, false, false, true, 2) on conflict (id) do nothing;
insert into public.products (id, categoria, nombre, descripcion, img, precio, precio_12, precio_16, codigo, tema, set_bebida, set_mochi, rotativo, agotado, activo, orden) values ('esp-bariloche', 'especial', 'Chocolate Bariloche y frutos rojos', 'Mochi inspirado en la torta de chocolate Bariloche con frutos rojos.', '', 0, null, null, null, null, null, null, false, false, true, 3) on conflict (id) do nothing;
insert into public.products (id, categoria, nombre, descripcion, img, precio, precio_12, precio_16, codigo, tema, set_bebida, set_mochi, rotativo, agotado, activo, orden) values ('esp-chocotorta', 'especial', 'Chocotorta', 'Mochi inspirado en la chocotorta.', '', 0, null, null, null, null, null, null, false, false, true, 4) on conflict (id) do nothing;
insert into public.products (id, categoria, nombre, descripcion, img, precio, precio_12, precio_16, codigo, tema, set_bebida, set_mochi, rotativo, agotado, activo, orden) values ('set-sakura', 'set', 'Sakura Set', '', 'img/set-sakura.webp', 0, 9900, 10900, 'Set 01', 'Matcha & cereza', 'dirty-strawberry', 'mochi-sakura', false, false, true, 1) on conflict (id) do nothing;
insert into public.products (id, categoria, nombre, descripcion, img, precio, precio_12, precio_16, codigo, tema, set_bebida, set_mochi, rotativo, agotado, activo, orden) values ('set-yoru', 'set', 'Yoru Set', '', 'img/set-yoru.webp', 0, 8000, 9000, 'Set 02', 'Espresso & chocolate', 'dirty-classic', 'mochi-chocolate', false, false, true, 2) on conflict (id) do nothing;
insert into public.products (id, categoria, nombre, descripcion, img, precio, precio_12, precio_16, codigo, tema, set_bebida, set_mochi, rotativo, agotado, activo, orden) values ('set-murasaki', 'set', 'Murasaki Set', '', 'img/set-murasaki.webp', 0, 9900, 10900, 'Set 03', 'Lavender & frutilla', 'dirty-lavender', 'mochi-frutilla', false, false, true, 3) on conflict (id) do nothing;
insert into public.products (id, categoria, nombre, descripcion, img, precio, precio_12, precio_16, codigo, tema, set_bebida, set_mochi, rotativo, agotado, activo, orden) values ('dirty-classic', 'dirty', 'Dirty Classic', 'Simple syrup, leche, espresso, cold foam.', 'img/dirty-classic.webp', 0, 4000, 5000, null, null, null, null, false, false, true, 1) on conflict (id) do nothing;
insert into public.products (id, categoria, nombre, descripcion, img, precio, precio_12, precio_16, codigo, tema, set_bebida, set_mochi, rotativo, agotado, activo, orden) values ('dirty-strawberry', 'dirty', 'Strawberry Matcha Dirty', 'Simple syrup, pulpa de frutilla, leche, matcha, cold foam.', 'img/dirty-strawberry.webp', 0, 6000, 7000, null, null, null, null, false, false, true, 2) on conflict (id) do nothing;
insert into public.products (id, categoria, nombre, descripcion, img, precio, precio_12, precio_16, codigo, tema, set_bebida, set_mochi, rotativo, agotado, activo, orden) values ('dirty-lavender', 'dirty', 'Lavender Matcha Dirty', 'Lavender syrup, matcha, leche, cold foam.', 'img/dirty-lavender.webp', 0, 6000, 7000, null, null, null, null, false, false, true, 3) on conflict (id) do nothing;
insert into public.products (id, categoria, nombre, descripcion, img, precio, precio_12, precio_16, codigo, tema, set_bebida, set_mochi, rotativo, agotado, activo, orden) values ('dirty-coconut', 'dirty', 'Coconut Dirty', 'Coconut syrup, espresso, leche, coconut foam.', 'img/dirty-coconut.webp', 0, 6000, 7000, null, null, null, null, false, false, true, 4) on conflict (id) do nothing;
insert into public.products (id, categoria, nombre, descripcion, img, precio, precio_12, precio_16, codigo, tema, set_bebida, set_mochi, rotativo, agotado, activo, orden) values ('dirty-caramel', 'dirty', 'Caramel Vanilla Dirty', 'Vanilla syrup, caramel syrup, leche, espresso, vanilla foam.', 'img/dirty-caramel.webp', 0, 6000, 7000, null, null, null, null, false, false, true, 5) on conflict (id) do nothing;
insert into public.products (id, categoria, nombre, descripcion, img, precio, precio_12, precio_16, codigo, tema, set_bebida, set_mochi, rotativo, agotado, activo, orden) values ('mochi-frutilla', 'mochi', 'Frutilla', 'Masa mochi rellena de crema y corazón de frutilla.', 'img/mochi-frutilla.webp', 5000, null, null, null, null, null, null, false, false, true, 1) on conflict (id) do nothing;
insert into public.products (id, categoria, nombre, descripcion, img, precio, precio_12, precio_16, codigo, tema, set_bebida, set_mochi, rotativo, agotado, activo, orden) values ('mochi-chocolate', 'mochi', 'Chocolate', 'Masa mochi rellena de crema y corazón de chocolate.', 'img/mochi-chocolate.webp', 5000, null, null, null, null, null, null, false, false, true, 2) on conflict (id) do nothing;
insert into public.products (id, categoria, nombre, descripcion, img, precio, precio_12, precio_16, codigo, tema, set_bebida, set_mochi, rotativo, agotado, activo, orden) values ('mochi-oreo', 'mochi', 'Oreo', 'Masa mochi rellena de crema y oreos.', 'img/mochi-oreo.webp', 5000, null, null, null, null, null, null, false, false, true, 3) on conflict (id) do nothing;
insert into public.products (id, categoria, nombre, descripcion, img, precio, precio_12, precio_16, codigo, tema, set_bebida, set_mochi, rotativo, agotado, activo, orden) values ('mochi-sakura', 'mochi', 'Sakura', 'Masa mochi rellena de matcha y corazón de cerezas.', 'img/mochi-sakura.webp', 5000, null, null, null, null, null, null, false, false, true, 4) on conflict (id) do nothing;
insert into public.products (id, categoria, nombre, descripcion, img, precio, precio_12, precio_16, codigo, tema, set_bebida, set_mochi, rotativo, agotado, activo, orden) values ('mochi-banana', 'mochi', 'Banana Split', 'Masa mochi rellena de crema con banana caramelizada y dulce de leche repostero.', 'img/mochi-banana.webp', 5000, null, null, null, null, null, null, true, false, true, 5) on conflict (id) do nothing;
insert into public.products (id, categoria, nombre, descripcion, img, precio, precio_12, precio_16, codigo, tema, set_bebida, set_mochi, rotativo, agotado, activo, orden) values ('mochi-tiramisu', 'mochi', 'Tiramisú', 'Masa mochi rellena de tiramisú.', 'img/mochi-tiramisu.webp', 5000, null, null, null, null, null, null, true, false, true, 6) on conflict (id) do nothing;
