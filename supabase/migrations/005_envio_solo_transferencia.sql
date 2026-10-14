-- Con envío a domicilio, el pago es solo por transferencia (lo cobra Setto, no el repartidor).
create or replace function public.create_order_v4(
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
  v_pers   jsonb := coalesce((select value from settings where key = 'personalizacion'), '{}'::jsonb);
  v_leche  text;
  v_lprec  integer;
  v_sin    jsonb;
  v_det    text;
  s        text;
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


revoke all on function public.create_order_v4(text,text,jsonb,text,text,text,text,text,text) from public;
grant execute on function public.create_order_v4(text,text,jsonb,text,text,text,text,text,text) to anon, authenticated;



update public.settings set value = value || '{"pago": "Transferencia / Mercado Pago"}'::jsonb where key = 'envio' and not (value ? 'pago');
