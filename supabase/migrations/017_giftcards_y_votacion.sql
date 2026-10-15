-- 017 · Gift cards (con diseños, pago por WhatsApp, saldo) y votación del próximo sabor. No borra nada.

-- ---------- Gift cards ----------
create table if not exists public.giftcards (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique,
  token       text not null unique default replace(gen_random_uuid()::text, '-', ''),
  diseno      text not null,
  monto       integer not null check (monto > 0),
  saldo       integer not null default 0 check (saldo >= 0),
  de          text,
  para        text,
  mensaje     text check (mensaje is null or length(mensaje) <= 160),
  phone       text not null,
  estado      text not null default 'pendiente' check (estado in ('pendiente','activa','usada','anulada')),
  pago        text,
  caja_mov_id uuid,
  created_at  timestamptz not null default now(),
  activada_at timestamptz
);
create table if not exists public.giftcard_usos (
  id          uuid primary key default gen_random_uuid(),
  giftcard_id uuid not null references public.giftcards(id) on delete cascade,
  order_id    uuid not null references public.orders(id) on delete cascade,
  monto       integer not null,
  devuelto    boolean not null default false,
  created_at  timestamptz not null default now()
);
alter table public.giftcards enable row level security;
alter table public.giftcard_usos enable row level security;
create policy giftcards_staff on public.giftcards for all to authenticated using (public.is_staff()) with check (public.is_staff());
create policy giftcard_usos_staff on public.giftcard_usos for all to authenticated using (public.is_staff()) with check (public.is_staff());

-- PÚBLICO · pedir una gift card (queda pendiente hasta que el equipo confirma el pago)
create or replace function public.create_giftcard(p_diseno text, p_monto int, p_de text, p_para text, p_mensaje text, p_phone text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  cfg jsonb := coalesce((select value from settings where key = 'giftcards'), '{}'::jsonb);
  v_phone text := public.norm_phone(p_phone);
  v_min int := coalesce((cfg->>'minimo')::int, 5000);
  v_max int := coalesce((cfg->>'maximo')::int, 100000);
  v_code text; v_tok text; v_tries int := 0;
begin
  if coalesce((cfg->>'activo')::boolean, true) = false then raise exception 'Por ahora no estamos vendiendo gift cards'; end if;
  if v_phone is null then raise exception 'Revisá tu celular'; end if;
  if p_monto is null or p_monto < v_min or p_monto > v_max then raise exception 'El monto tiene que ser entre $% y $%', v_min, v_max; end if;
  if coalesce(trim(p_diseno), '') = '' or length(p_diseno) > 30 then raise exception 'Elegí un diseño'; end if;
  if coalesce(trim(p_para), '') = '' then raise exception 'Falta para quién es'; end if;
  if length(coalesce(p_de,'')) > 40 or length(p_para) > 40 then raise exception 'Nombre demasiado largo'; end if;
  if length(coalesce(p_mensaje,'')) > 160 then raise exception 'El mensaje puede tener hasta 160 caracteres'; end if;
  if (select count(*) from giftcards where phone = v_phone and created_at > now() - interval '1 hour') >= 5 then raise exception 'Pediste muchas seguidas. Escribinos por WhatsApp.'; end if;
  loop
    v_code := 'GIFT-' || upper(substr(md5(random()::text), 1, 4)) || '-' || upper(substr(md5(random()::text), 1, 4));
    exit when not exists (select 1 from giftcards where code = v_code);
    v_tries := v_tries + 1; if v_tries > 20 then raise exception 'Probá de nuevo'; end if;
  end loop;
  insert into giftcards (code, diseno, monto, de, para, mensaje, phone)
  values (v_code, trim(p_diseno), p_monto, nullif(trim(coalesce(p_de,'')), ''), trim(p_para), nullif(trim(coalesce(p_mensaje,'')), ''), v_phone)
  returning token into v_tok;
  return jsonb_build_object('code', v_code, 'token', v_tok, 'monto', p_monto);
end $$;
revoke all on function public.create_giftcard(text,int,text,text,text,text) from public;
grant execute on function public.create_giftcard(text,int,text,text,text,text) to anon, authenticated;

-- PÚBLICO · ver la tarjeta desde su link (el código se muestra solo si está activa)
create or replace function public.giftcard_by_token(p_token text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('diseno', diseno, 'monto', monto, 'saldo', saldo, 'de', de, 'para', para, 'mensaje', mensaje, 'estado', estado,
           'code', case when estado in ('activa','usada') then code end)
  from giftcards where token = p_token
$$;
revoke all on function public.giftcard_by_token(text) from public;
grant execute on function public.giftcard_by_token(text) to anon, authenticated;

-- PÚBLICO · consultar saldo por código (checkout)
create or replace function public.giftcard_check(p_code text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('code', code, 'saldo', saldo, 'estado', estado, 'diseno', diseno)
  from giftcards where code = upper(trim(p_code)) and estado in ('activa','usada','pendiente')
$$;
revoke all on function public.giftcard_check(text) from public;
grant execute on function public.giftcard_check(text) to anon, authenticated;

-- EQUIPO · pago recibido → activa y carga la entrada en la caja
create or replace function public.activate_giftcard(p_id uuid, p_cuenta text default 'mp') returns jsonb
language plpgsql security definer set search_path = public as $$
declare g giftcards%rowtype; v_mov uuid;
begin
  if not public.is_staff() then raise exception 'Solo el equipo puede hacer esto'; end if;
  select * into g from giftcards where id = p_id for update;
  if not found or g.estado <> 'pendiente' then raise exception 'La gift card no está pendiente'; end if;
  begin
    insert into caja_movimientos (tipo, detalle, monto, cuenta_id, categoria_id, registro, legacy_id)
    values ('entrada', 'Gift card ' || g.code || ' · para ' || g.para, g.monto, case when p_cuenta = 'efectivo' then 'efectivo' else 'mp' end, 'venta_directa', 'Gift cards', 'gift:' || g.id)
    returning id into v_mov;
  exception when undefined_table then v_mov := null; end;
  update giftcards set estado = 'activa', saldo = monto, activada_at = now(), pago = p_cuenta, caja_mov_id = v_mov where id = p_id;
  return jsonb_build_object('token', g.token, 'code', g.code);
end $$;
revoke all on function public.activate_giftcard(uuid,text) from public, anon;
grant execute on function public.activate_giftcard(uuid,text) to authenticated;

-- EQUIPO · anular (solo si no se usó)
create or replace function public.annul_giftcard(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare g giftcards%rowtype;
begin
  if not public.is_staff() then raise exception 'Solo el equipo puede hacer esto'; end if;
  select * into g from giftcards where id = p_id for update;
  if not found then raise exception 'No existe'; end if;
  if g.estado = 'anulada' then return; end if;
  if g.estado = 'activa' and g.saldo < g.monto then raise exception 'Ya se usó en un pedido: no se puede anular'; end if;
  if g.estado = 'usada' then raise exception 'Ya se usó: no se puede anular'; end if;
  update giftcards set estado = 'anulada', saldo = 0 where id = p_id;
  if g.caja_mov_id is not null then
    begin
      update caja_movimientos set estado = 'anulado', anulado_por = 'Gift cards', anulado_motivo = 'Gift card ' || g.code || ' anulada' where id = g.caja_mov_id and estado = 'activo';
    exception when undefined_table then null; end;
  end if;
end $$;
revoke all on function public.annul_giftcard(uuid) from public, anon;
grant execute on function public.annul_giftcard(uuid) to authenticated;

-- Pedido v5 = v4 + gift card
create or replace function public.create_order_v5(
  p_nombre text, p_phone text, p_items jsonb, p_retiro text, p_pago text, p_nota text,
  p_modo text default 'retiro', p_direccion text default null, p_premio text default null, p_gift text default null
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
  v_pers   jsonb := coalesce((select value from settings where key = 'personalizacion'), '{}'::jsonb);
  v_leche  text;
  v_lprec  integer;
  v_sin    jsonb;
  v_det    text;
  s        text;
  g        giftcards%rowtype;
  v_gift   integer := 0;
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
    if coalesce(p_pago, '') <> coalesce(nullif(v_envio->>'pago', ''), 'Transferencia / Mercado Pago') then
      raise exception 'Con envío a domicilio el pago es solo por transferencia';
    end if;
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

    -- Personalización de la bebida (dirty y sets): leche con recargo y opciones "sin"
    v_det := null; v_leche := null; v_sin := '[]'::jsonb;
    if pr.categoria in ('set','dirty') and coalesce((v_pers->>'activo')::boolean, true) then
      v_leche := nullif(trim(coalesce(it->>'leche', '')), '');
      if v_leche is not null then
        select (l->>'precio')::int into v_lprec from jsonb_array_elements(coalesce(v_pers->'leches', '[]'::jsonb)) l where l->>'nombre' = v_leche limit 1;
        if not found then raise exception 'Esa leche ya no está disponible, elegí otra'; end if;
        v_price := v_price + greatest(0, coalesce(v_lprec, 0));
        if coalesce(v_lprec, 0) > 0 or v_leche <> coalesce((v_pers->'leches'->0->>'nombre'), '') then v_det := v_leche; end if;
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

    v_sub := v_sub + v_price * v_qty;
    v_lines := v_lines || jsonb_build_object('id', pr.id, 'nombre', v_name, 'size', v_size, 'qty', v_qty, 'precio', v_price, 'subtotal', v_price * v_qty, 'leche', v_leche, 'sin', v_sin, 'detalle', v_det);
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

  -- Gift card: descuenta del total (incluye envío) y baja el saldo
  if nullif(trim(coalesce(p_gift, '')), '') is not null then
    select * into g from giftcards where code = upper(trim(p_gift)) for update;
    if not found then raise exception 'No encontramos esa gift card. Revisá el código.'; end if;
    if g.estado = 'pendiente' then raise exception 'Esa gift card todavía no está activa'; end if;
    if g.estado <> 'activa' or g.saldo <= 0 then raise exception 'Esa gift card ya no tiene saldo'; end if;
    v_gift := least(g.saldo, greatest(v_total, 0));
    if v_gift > 0 then
      v_lines := v_lines || jsonb_build_object('id', 'gift', 'nombre', 'Gift card ' || g.code, 'size', null, 'qty', 1, 'precio', -v_gift, 'subtotal', -v_gift);
      v_total := v_total - v_gift;
      update giftcards set saldo = saldo - v_gift, estado = case when saldo - v_gift <= 0 then 'usada' else 'activa' end where id = g.id;
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
  if v_gift > 0 then insert into giftcard_usos (giftcard_id, order_id, monto) values (g.id, v_id, v_gift); end if;

  return jsonb_build_object('id', v_id, 'code', v_code, 'total', v_total, 'items', v_lines, 'phone', v_phone,
    'modo', v_modo, 'direccion', v_dir, 'costo_envio', v_costo,
    'premio', v_premio, 'premio_txt', v_ptxt, 'descuento', v_off, 'gift', v_gift,
    'sellos_antes', v_sellos, 'meta', v_meta);
end $$;


revoke all on function public.create_order_v5(text,text,jsonb,text,text,text,text,text,text,text) from public;
grant execute on function public.create_order_v5(text,text,jsonb,text,text,text,text,text,text,text) to anon, authenticated;





-- Cancelar un pedido devuelve el saldo de la gift card
create or replace function public.cancel_order(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare u record;
begin
  if not public.is_staff() then raise exception 'Solo el equipo puede hacer esto'; end if;
  update orders set status = 'cancelado', closed_at = now(), closed_by = auth.uid() where id = p_id and status = 'pendiente';
  if not found then raise exception 'El pedido no está pendiente'; end if;
  for u in select * from giftcard_usos where order_id = p_id and not devuelto loop
    update giftcards set saldo = saldo + u.monto, estado = 'activa' where id = u.giftcard_id and estado in ('activa','usada');
    update giftcard_usos set devuelto = true where id = u.id;
  end loop;
end $$;

-- ---------- Votación ----------
create table if not exists public.votes (
  id         uuid primary key default gen_random_uuid(),
  poll       text not null,
  opcion     text not null,
  phone      text not null,
  created_at timestamptz not null default now(),
  unique (poll, phone)
);
alter table public.votes enable row level security;
create policy votes_staff on public.votes for all to authenticated using (public.is_staff()) with check (public.is_staff());

create or replace function public.poll_results(p_poll text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('total', (select count(*) from votes where poll = p_poll),
    'conteo', coalesce((select jsonb_object_agg(opcion, n) from (select opcion, count(*) n from votes where poll = p_poll group by opcion) t), '{}'::jsonb))
$$;
revoke all on function public.poll_results(text) from public;
grant execute on function public.poll_results(text) to anon, authenticated;

create or replace function public.cast_vote(p_poll text, p_opcion text, p_phone text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare cfg jsonb := coalesce((select value from settings where key = 'votacion'), '{}'::jsonb); v_phone text := public.norm_phone(p_phone);
begin
  if coalesce((cfg->>'activo')::boolean, false) = false or cfg->>'id' is distinct from p_poll then raise exception 'Esta votación ya cerró'; end if;
  if nullif(cfg->>'cierre', '') is not null and now() > (cfg->>'cierre')::timestamptz then raise exception 'Esta votación ya cerró'; end if;
  if not exists (select 1 from jsonb_array_elements(coalesce(cfg->'opciones', '[]'::jsonb)) o where o->>'id' = p_opcion) then raise exception 'Esa opción no existe'; end if;
  if v_phone is null then raise exception 'Revisá tu celular'; end if;
  if coalesce((cfg->>'solo_clientes')::boolean, false) and not exists (select 1 from orders where phone = v_phone and status = 'entregado') then
    raise exception 'Votan quienes ya hicieron un pedido por la web. ¡Te esperamos!';
  end if;
  insert into votes (poll, opcion, phone) values (p_poll, p_opcion, v_phone)
  on conflict (poll, phone) do update set opcion = excluded.opcion, created_at = now();
  return public.poll_results(p_poll);
end $$;
revoke all on function public.cast_vote(text,text,text) from public;
grant execute on function public.cast_vote(text,text,text) to anon, authenticated;

insert into public.settings (key, value) values ('giftcards', '{"activo": true, "montos": [10000, 15000, 20000, 30000], "minimo": 5000, "maximo": 100000, "disenos": ["cumple", "gracias", "tequiero", "felicitaciones", "porquesi", "halloween"]}'::jsonb) on conflict (key) do nothing;
insert into public.settings (key, value) values ('votacion', '{"activo": false, "id": "v1", "pregunta": "¿Qué sabor querés en la próxima edición?", "opciones": [], "solo_clientes": false, "cierre": ""}'::jsonb) on conflict (key) do nothing;
