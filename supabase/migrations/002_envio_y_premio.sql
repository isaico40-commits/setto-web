-- Envío a domicilio y premio en el último sello (v2)
alter table public.orders add column if not exists modo text not null default 'retiro';
alter table public.orders add column if not exists direccion text;
alter table public.orders add column if not exists premio boolean not null default false;
alter table public.orders add column if not exists premio_txt text;
do $$ begin
  alter table public.orders add constraint orders_modo_check check (modo in ('retiro','envio'));
exception when duplicate_object then null; end $$;
-- ---------------------------------------------------------------------
-- PÚBLICO · Crear pedido (precios calculados acá, no en el navegador)
--   p_items: [{"id":"set-sakura","size":"12 oz","qty":1}, ...]
--   p_modo: 'retiro' | 'envio'   ·   p_direccion: obligatoria si es envío
-- ---------------------------------------------------------------------
create or replace function public.create_order_v2(
  p_nombre text, p_phone text, p_items jsonb, p_retiro text, p_pago text, p_nota text,
  p_modo text default 'retiro', p_direccion text default null
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

  loop
    v_code := 'STT-' || lpad((floor(random() * 10000))::int::text, 4, '0');
    exit when not exists (select 1 from orders where code = v_code and status = 'pendiente');
    v_tries := v_tries + 1;
    if v_tries > 50 then raise exception 'No se pudo generar el código, probá de nuevo'; end if;
  end loop;

  insert into orders (code, nombre, phone, items, total, retiro, pago, nota, modo, direccion, premio, premio_txt)
  values (v_code, trim(p_nombre), v_phone, v_lines, v_total, p_retiro, p_pago, nullif(trim(coalesce(p_nota,'')), ''),
          v_modo, v_dir, v_premio, case when v_premio then coalesce(v_club->>'premio', 'Premio') end)
  returning id into v_id;

  return jsonb_build_object('id', v_id, 'code', v_code, 'total', v_total, 'items', v_lines, 'phone', v_phone,
    'modo', v_modo, 'direccion', v_dir, 'costo_envio', v_costo,
    'premio', v_premio, 'premio_txt', case when v_premio then v_club->>'premio' end,
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

revoke all on function public.create_order_v2(text,text,jsonb,text,text,text,text,text) from public;
grant execute on function public.create_order_v2(text,text,jsonb,text,text,text,text,text) to anon, authenticated;
revoke all on function public.confirm_order(uuid,text,integer) from public, anon;
grant execute on function public.confirm_order(uuid,text,integer) to authenticated;

-- Ajustes nuevos (no pisan lo existente)
insert into public.settings (key, value) values ('envio', '{"activo": true, "costo": 0, "aviso": "Envíos en Mar del Plata. El costo del envío se coordina por WhatsApp según la zona."}'::jsonb)
on conflict (key) do nothing;
update public.settings set value = value || '{"minimo": 0}'::jsonb where key = 'club' and not (value ? 'minimo');
