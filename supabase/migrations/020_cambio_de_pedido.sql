-- 020 · Cambio de pedido cuando falta algo.
--   El equipo marca qué falta (pedir_cambio) → el cliente, desde su link de seguimiento,
--   elige reemplazo, sacarlo o cancelar (cambio_opciones / resolver_cambio).
--   El total se recalcula; la gift card devuelve saldo si el total baja; el stock se valida.
-- No borra nada.

alter table public.orders add column if not exists cambio jsonb;

-- precio de una línea según producto, tamaño y leche
create or replace function public.precio_linea(p products, p_size text, p_leche text) returns int
language sql stable security definer set search_path = public as $$
  select (case when p.categoria in ('set','dirty') then case when p_size = '16 oz' then p.precio_16 else p.precio_12 end else p.precio end)
       + case when p.categoria in ('set','dirty') and nullif(p_leche, '') is not null then
           coalesce((select greatest(0, (l->>'precio')::int) from settings s, jsonb_array_elements(coalesce(s.value->'leches', '[]'::jsonb)) l
                      where s.key = 'personalizacion' and l->>'nombre' = p_leche limit 1), 0)
         else 0 end
$$;
revoke execute on function public.precio_linea(products, text, text) from public, anon, authenticated;

-- EQUIPO · marcar qué falta. p_faltan = [{"idx": 0, "qty": 2}, ...] (idx = posición de la línea en items)
create or replace function public.pedir_cambio(p_id uuid, p_faltan jsonb, p_nota text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare o orders%rowtype; f jsonb; it jsonb; v_out jsonb := '[]'::jsonb; v_q int;
begin
  if not public.is_staff() then raise exception 'Solo el equipo puede hacer esto'; end if;
  select * into o from orders where id = p_id for update;
  if not found or o.status <> 'pendiente' then raise exception 'El pedido no está pendiente'; end if;
  if p_faltan is null or jsonb_typeof(p_faltan) <> 'array' or jsonb_array_length(p_faltan) = 0 then raise exception 'Marcá qué falta'; end if;
  for f in select * from jsonb_array_elements(p_faltan) loop
    it := o.items -> ((f->>'idx')::int);
    if it is null or it->>'id' in ('envio','premio','gift') then raise exception 'Línea inválida'; end if;
    v_q := least(greatest(coalesce((f->>'qty')::int, (it->>'qty')::int), 1), (it->>'qty')::int);
    v_out := v_out || jsonb_build_object('idx', (f->>'idx')::int, 'id', it->>'id', 'nombre', it->>'nombre', 'size', it->>'size', 'qty', v_q, 'de', (it->>'qty')::int);
  end loop;
  update orders set cambio = jsonb_build_object('estado', 'esperando', 'faltan', v_out, 'nota', nullif(trim(coalesce(p_nota, '')), ''), 'at', now())
   where id = p_id;
  return (select cambio from orders where id = p_id);
end $$;
revoke all on function public.pedir_cambio(uuid, jsonb, text) from public, anon;
grant execute on function public.pedir_cambio(uuid, jsonb, text) to authenticated;

-- EQUIPO · sacar el aviso (si lo arreglaron por chat)
create or replace function public.quitar_cambio(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_staff() then raise exception 'Solo el equipo puede hacer esto'; end if;
  update orders set cambio = null where id = p_id;
end $$;
revoke all on function public.quitar_cambio(uuid) from public, anon;
grant execute on function public.quitar_cambio(uuid) to authenticated;

-- PÚBLICO · qué falta y con qué se puede reemplazar (desde el link de seguimiento)
create or replace function public.cambio_opciones(p_track text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare o orders%rowtype; f jsonb; it jsonb; pr products%rowtype; v_res jsonb := '[]'::jsonb; v_alts jsonb; v_disp jsonb;
begin
  select * into o from orders where track = p_track;
  if not found then raise exception 'No encontramos ese pedido'; end if;
  if o.cambio is null or o.cambio->>'estado' <> 'esperando' or o.status <> 'pendiente' then
    return jsonb_build_object('estado', coalesce(o.cambio->>'estado', 'sin_cambio'), 'code', o.code, 'status', o.status);
  end if;
  -- disponible por mochi, sumando lo que este mismo pedido ya tiene reservado
  v_disp := coalesce((select jsonb_object_agg(d.product_id, d.disponible + coalesce((select m.qty from caja_mochis_de_items(o.items) m where m.product_id = d.product_id), 0))
                        from stock_disponible() d), '{}'::jsonb);
  for f in select * from jsonb_array_elements(o.cambio->'faltan') loop
    it := o.items -> ((f->>'idx')::int);
    select * into pr from products where id = it->>'id';
    select coalesce(jsonb_agg(jsonb_build_object(
             'id', a.id, 'nombre', case when a.categoria in ('mochi','especial') then 'Mochi ' || a.nombre else a.nombre end,
             'img', a.img, 'precio', public.precio_linea(a, it->>'size', it->>'leche'),
             'stock', case when a.categoria = 'set' then v_disp->>a.set_mochi when a.categoria in ('mochi','especial') then v_disp->>a.id end
           ) order by a.orden nulls last, a.nombre), '[]'::jsonb)
      into v_alts
      from products a
     where a.activo and not a.agotado and a.id <> pr.id
       and (a.categoria = pr.categoria or (pr.categoria in ('mochi','especial') and a.categoria = 'mochi'))
       and coalesce(public.precio_linea(a, it->>'size', it->>'leche'), 0) > 0
       and coalesce(((case when a.categoria = 'set' then v_disp->>a.set_mochi when a.categoria in ('mochi','especial') then v_disp->>a.id end))::int, 999) >= (f->>'qty')::int;
    v_res := v_res || jsonb_build_object('idx', (f->>'idx')::int, 'nombre', it->>'nombre', 'size', it->>'size', 'detalle', it->>'detalle',
                                         'qty', (f->>'qty')::int, 'de', (it->>'qty')::int, 'precio', (it->>'precio')::int, 'alternativas', v_alts);
  end loop;
  return jsonb_build_object('estado', 'esperando', 'code', o.code, 'status', o.status, 'nota', o.cambio->>'nota',
                            'total', o.total, 'faltan', v_res, 'items', o.items);
end $$;
revoke all on function public.cambio_opciones(text) from public;
grant execute on function public.cambio_opciones(text) to anon, authenticated;

-- PÚBLICO · el cliente resuelve. p_elecciones = [{"idx":0,"accion":"cambiar","id":"mochi-oreo"} | {"idx":1,"accion":"quitar"}]
--           p_cancelar = true → cancela el pedido entero
create or replace function public.resolver_cambio(p_track text, p_elecciones jsonb, p_cancelar boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  o orders%rowtype; f jsonb; e jsonb; it jsonb; pr products%rowtype; np products%rowtype;
  v_items jsonb; v_new jsonb := '[]'::jsonb; v_add jsonb := '[]'::jsonb; v_res jsonb := '[]'::jsonb;
  i int; v_qmiss int; v_sub int := 0; v_gift_old int := 0; v_gift int := 0; v_total int; v_precio int; v_name text;
  u record; r record;
begin
  perform pg_advisory_xact_lock(hashtext('setto-stock'));
  select * into o from orders where track = p_track for update;
  if not found then raise exception 'No encontramos ese pedido'; end if;
  if o.status <> 'pendiente' then raise exception 'Este pedido ya no se puede cambiar'; end if;
  if o.cambio is null or o.cambio->>'estado' <> 'esperando' then raise exception 'Este pedido no tiene cambios pendientes'; end if;

  if p_cancelar then
    update orders set status = 'cancelado', closed_at = now(),
           cambio = cambio || jsonb_build_object('estado', 'resuelto', 'resolucion', 'cancelado', 'resuelto_at', now())
     where id = o.id;
    for u in select * from giftcard_usos where order_id = o.id and not devuelto loop
      update giftcards set saldo = saldo + u.monto, estado = 'activa' where id = u.giftcard_id and estado in ('activa','usada');
      update giftcard_usos set devuelto = true where id = u.id;
    end loop;
    return jsonb_build_object('estado', 'cancelado', 'code', o.code);
  end if;

  v_items := o.items;
  -- cada faltante necesita una elección
  for f in select * from jsonb_array_elements(o.cambio->'faltan') loop
    e := null;
    select x.value into e from jsonb_array_elements(coalesce(p_elecciones, '[]'::jsonb)) as x(value) where (x.value->>'idx')::int = (f->>'idx')::int limit 1;
    if e is null then raise exception 'Elegí qué hacer con %', f->>'nombre'; end if;
    it := v_items -> ((f->>'idx')::int);
    v_qmiss := (f->>'qty')::int;
    -- baja la cantidad faltante de la línea original (si queda 0, se marca para sacar)
    v_items := jsonb_set(v_items, array[(f->>'idx')], it || jsonb_build_object('qty', (it->>'qty')::int - v_qmiss));
    if e->>'accion' = 'cambiar' then
      select * into pr from products where id = it->>'id';
      select * into np from products where id = e->>'id' and activo and not agotado;
      if not found then raise exception 'Ese reemplazo ya no está disponible, elegí otro'; end if;
      if not (np.categoria = pr.categoria or (pr.categoria in ('mochi','especial') and np.categoria = 'mochi')) then raise exception 'Ese reemplazo no corresponde'; end if;
      v_precio := public.precio_linea(np, it->>'size', it->>'leche');
      if coalesce(v_precio, 0) <= 0 then raise exception '% todavía no tiene precio', np.nombre; end if;
      v_name := case when np.categoria in ('mochi','especial') then 'Mochi ' || np.nombre else np.nombre end;
      v_add := v_add || (it || jsonb_build_object('id', np.id, 'nombre', v_name, 'qty', v_qmiss, 'precio', v_precio, 'subtotal', v_precio * v_qmiss));
      v_res := v_res || jsonb_build_object('de', f->>'nombre', 'qty', v_qmiss, 'a', v_name);
    elsif e->>'accion' = 'quitar' then
      v_res := v_res || jsonb_build_object('de', f->>'nombre', 'qty', v_qmiss, 'a', null);
    else
      raise exception 'Elegí qué hacer con %', f->>'nombre';
    end if;
  end loop;

  -- arma la lista final: productos (qty > 0) + reemplazos, recalcula subtotales; envío y premio se mantienen; gift al final
  for i in 0 .. jsonb_array_length(v_items) - 1 loop
    it := v_items -> i;
    if it->>'id' = 'gift' then v_gift_old := -(it->>'subtotal')::int; continue; end if;
    if it->>'id' in ('envio','premio') then v_new := v_new || it; v_sub := v_sub + (it->>'subtotal')::int; continue; end if;
    if (it->>'qty')::int <= 0 then continue; end if;
    it := it || jsonb_build_object('subtotal', (it->>'precio')::int * (it->>'qty')::int);
    v_new := v_new || it; v_sub := v_sub + (it->>'subtotal')::int;
  end loop;
  for it in select * from jsonb_array_elements(v_add) loop v_new := v_new || it; v_sub := v_sub + (it->>'subtotal')::int; end loop;

  if not exists (select 1 from jsonb_array_elements(v_new) x where x->>'id' not in ('envio','premio')) then
    raise exception 'El pedido quedaría vacío. Elegí un reemplazo o cancelalo.';
  end if;

  v_sub := greatest(v_sub, 0);
  v_gift := least(v_gift_old, v_sub);
  if v_gift > 0 then
    v_new := v_new || jsonb_build_array((select x.value from jsonb_array_elements(o.items) as x(value) where x.value->>'id' = 'gift' limit 1)
                                        || jsonb_build_object('precio', -v_gift, 'subtotal', -v_gift));
  end if;
  if v_gift_old > v_gift then
    for u in select * from giftcard_usos where order_id = o.id and not devuelto order by created_at desc limit 1 loop
      update giftcards set saldo = saldo + (v_gift_old - v_gift), estado = 'activa' where id = u.giftcard_id and estado in ('activa','usada');
      update giftcard_usos set monto = monto - (v_gift_old - v_gift) where id = u.id;
    end loop;
  end if;
  v_total := v_sub - v_gift;

  -- stock: lo nuevo no puede pasar lo disponible (contando lo que este pedido ya tenía reservado)
  if coalesce((select (value->>'activo')::boolean from settings where key = 'stock_web'), false) then
    for r in
      select m.product_id, m.qty, d.disponible + coalesce((select x.qty from caja_mochis_de_items(o.items) x where x.product_id = m.product_id), 0) as libre, p.nombre
        from caja_mochis_de_items(v_new) m
        join stock_disponible() d on d.product_id = m.product_id
        join products p on p.id = m.product_id
    loop
      if r.qty > r.libre then raise exception 'Nos quedamos sin mochi % para ese cambio. Elegí otro.', r.nombre; end if;
    end loop;
  end if;

  update orders set items = v_new, total = v_total,
         cambio = cambio || jsonb_build_object('estado', 'resuelto', 'resolucion', 'cambiado', 'cambios', v_res,
                                               'total_antes', o.total, 'resuelto_at', now())
   where id = o.id;
  return jsonb_build_object('estado', 'resuelto', 'code', o.code, 'total', v_total, 'total_antes', o.total, 'items', v_new, 'cambios', v_res);
end $$;
revoke all on function public.resolver_cambio(text, jsonb, boolean) from public;
grant execute on function public.resolver_cambio(text, jsonb, boolean) to anon, authenticated;

-- Seguimiento: + cambio (estado y qué falta) para avisarle al cliente
create or replace function public.get_order_status(p_codes text[], p_phone text) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('code', code, 'status', status, 'etapa', etapa, 'modo', modo, 'retiro', retiro,
           'total', total, 'created_at', created_at, 'sellos', sellos, 'track', track,
           'cambio', case when cambio is not null then jsonb_build_object('estado', cambio->>'estado', 'resolucion', cambio->>'resolucion') end,
           'resena', exists (select 1 from reviews r where r.order_id = o.id)) order by created_at desc), '[]'::jsonb)
  from (select * from orders where phone = public.norm_phone(p_phone) and code = any(p_codes[1:5])
          and created_at > now() - interval '3 days' order by created_at desc limit 5) o;
$$;

create or replace function public.track_status(p_tracks text[]) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('code', code, 'status', status, 'etapa', etapa, 'modo', modo, 'retiro', retiro,
           'total', total, 'created_at', created_at, 'sellos', sellos, 'track', track, 'phone', phone,
           'cambio', case when cambio is not null then jsonb_build_object('estado', cambio->>'estado', 'resolucion', cambio->>'resolucion') end,
           'resena', exists (select 1 from reviews r where r.order_id = o.id)) order by created_at desc), '[]'::jsonb)
  from (select * from orders where track = any(p_tracks[1:10]) and created_at > now() - interval '14 days') o;
$$;
