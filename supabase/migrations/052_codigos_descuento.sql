-- 052 · Códigos de descuento: se arman en Panel → Campañas, se usan en el carrito y se pueden mandar en campañas de WhatsApp.
--   - promos: el incentivo (qué da, desde cuánto, hasta cuándo, cuántas veces y si se suma a otros premios).
--       tipo 'porcentaje' → valor% off en los productos (con tope opcional)
--       tipo 'monto'      → $valor de descuento
--       tipo 'regalo'     → el mochi o la bebida más barata del pedido sale gratis (regalo = 'mochi' | 'bebida')
--       tipo 'envio'      → el envío sale gratis
--   - promo_codigos: los códigos de cada promo.
--       · general (phone vacío): lo escribís vos (ej. LEMON10) y lo usa cualquiera.
--       · personal (con phone): se genera solo (ej. SETTO-7KQ2) y sirve únicamente con ese celular.
--         Lo genera el panel a mano o la campaña/automática de WhatsApp para cada destinatario ({codigo} en la plantilla).
--   - promo_usos: cada pedido que usó un código. Si el pedido se cancela, el uso se devuelve solo.
--   - create_order_v7 = v6 + p_codigo (se arma a partir de la v6 que está en la base, como la 034).
--   - promos_resumen(): cuántos se generaron, cuántos se usaron, cuánto se descontó y cuánto vendieron (por promo, campaña y automática).
--   No borra nada.

create table if not exists public.promos (
  id          uuid primary key default gen_random_uuid(),
  nombre      text not null check (length(trim(nombre)) between 1 and 60),        -- para el equipo
  titulo      text not null check (length(trim(titulo)) between 1 and 40),        -- lo que ve el cliente: "10% off", "Mochi de regalo"
  tipo        text not null check (tipo in ('porcentaje','monto','regalo','envio')),
  valor       integer not null default 0 check (valor >= 0),
  regalo      text check (regalo in ('mochi','bebida')),
  tope        integer not null default 0 check (tope >= 0),                       -- porcentaje: máximo a descontar (0 = sin tope)
  minimo      integer not null default 0 check (minimo >= 0),                     -- compra mínima en productos
  acumula     boolean not null default false,                                     -- se suma con el premio del Club y la maquinita
  vence_at    timestamptz,                                                        -- fecha fija para todos (vacío = sin fecha)
  dias        integer check (dias between 1 and 365),                             -- códigos personales: duran N días desde que se generan
  usos_max    integer check (usos_max > 0),                                       -- pedidos en total (vacío = sin límite)
  por_cliente integer not null default 1 check (por_cliente between 1 and 50),    -- pedidos por celular
  prefijo     text not null default 'SETTO' check (prefijo ~ '^[A-Z0-9]{2,10}$' and prefijo not in ('GIFT','MAQ','STT')),
  activa      boolean not null default true,
  created_by  uuid default auth.uid(),
  created_at  timestamptz not null default now(),
  check ((tipo = 'porcentaje' and valor between 1 and 100) or (tipo = 'monto' and valor > 0) or (tipo = 'regalo' and regalo is not null) or tipo = 'envio')
);
create table if not exists public.promo_codigos (
  code          text primary key check (code ~ '^[A-Z0-9][A-Z0-9-]{2,19}$' and code !~ '^(GIFT|MAQ|STT)-'),
  promo_id      uuid not null references public.promos(id) on delete cascade,
  phone         text,                                                           -- vacío = código general
  campaign_id   uuid references public.marketing_campaigns(id) on delete set null,
  automation_id uuid references public.marketing_automations(id) on delete set null,
  vence_at      timestamptz,
  usos          integer not null default 0 check (usos >= 0),
  created_at    timestamptz not null default now()
);
create index if not exists promo_codigos_promo on public.promo_codigos (promo_id);
create index if not exists promo_codigos_phone on public.promo_codigos (phone, promo_id);
create index if not exists promo_codigos_campaign on public.promo_codigos (campaign_id) where campaign_id is not null;
create index if not exists promo_codigos_automation on public.promo_codigos (automation_id) where automation_id is not null;
create table if not exists public.promo_usos (
  id         uuid primary key default gen_random_uuid(),
  promo_id   uuid not null references public.promos(id) on delete restrict,       -- una promo que ya se usó no se borra: se pausa
  code       text not null references public.promo_codigos(code) on delete restrict,
  order_id   uuid not null unique references public.orders(id) on delete cascade,
  phone      text not null,
  monto      integer not null default 0,
  devuelto   boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists promo_usos_promo on public.promo_usos (promo_id, phone) where not devuelto;

alter table public.marketing_campaigns   add column if not exists promo_id uuid references public.promos(id) on delete set null;
alter table public.marketing_automations add column if not exists promo_id uuid references public.promos(id) on delete set null;

-- el equipo las arma desde el panel; el cliente solo las ve a través de promo_check y create_order_v7
alter table public.promos enable row level security;
alter table public.promo_codigos enable row level security;
alter table public.promo_usos enable row level security;
drop policy if exists promos_staff on public.promos;
drop policy if exists promo_codigos_staff on public.promo_codigos;
drop policy if exists promo_usos_staff on public.promo_usos;
create policy promos_staff on public.promos for all to authenticated using (public.is_staff()) with check (public.is_staff());
create policy promo_codigos_staff on public.promo_codigos for all to authenticated using (public.is_staff()) with check (public.is_staff());
create policy promo_usos_staff on public.promo_usos for select to authenticated using (public.is_staff());
revoke all on public.promos, public.promo_codigos, public.promo_usos from anon;
grant select, insert, update, delete on public.promos, public.promo_codigos to authenticated;
grant select on public.promo_usos to authenticated;

-- por qué un código no se puede usar (null = se puede). Sin celular revisa todo menos lo que depende del número.
create or replace function public.promo_problema(p_code text, p_phone text) returns text
language plpgsql stable security definer set search_path = public as $$
declare
  c promo_codigos%rowtype; p promos%rowtype;
  v_phone text := public.norm_phone(p_phone);
  v_vence timestamptz;
begin
  select * into c from promo_codigos where code = upper(trim(coalesce(p_code, '')));
  if not found then return 'No encontramos ese código. Revisá que esté bien escrito.'; end if;
  select * into p from promos where id = c.promo_id;
  if not p.activa then return 'Este código ya no está activo.'; end if;
  v_vence := least(c.vence_at, p.vence_at);
  if v_vence is not null and v_vence <= now() then
    return 'Este código venció el ' || to_char(v_vence at time zone 'America/Argentina/Buenos_Aires', 'DD/MM') || '.';
  end if;
  if p.usos_max is not null and (select count(*) from promo_usos where promo_id = p.id and not devuelto) >= p.usos_max then
    return 'Este código ya se usó todas las veces posibles.';
  end if;
  if v_phone is null then return null; end if;
  if c.phone is not null and c.phone <> v_phone then return 'Este código es personal: usalo con el celular al que te lo mandamos.'; end if;
  if (select count(*) from promo_usos where promo_id = p.id and phone = v_phone and not devuelto) >= p.por_cliente then
    return 'Ya usaste este código' || case when p.por_cliente > 1 then ' las ' || p.por_cliente || ' veces' else '' end || '.';
  end if;
  return null;
end $$;
revoke all on function public.promo_problema(text,text) from public, anon, authenticated;

-- PÚBLICO · revisar un código antes de pedir. Devuelve lo necesario para mostrar el descuento en el carrito.
create or replace function public.promo_check(p_code text, p_phone text default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare c promo_codigos%rowtype; p promos%rowtype; v_err text;
begin
  v_err := public.promo_problema(p_code, p_phone);
  select * into c from promo_codigos where code = upper(trim(coalesce(p_code, '')));
  if not found then return jsonb_build_object('error', v_err); end if;
  select * into p from promos where id = c.promo_id;
  return jsonb_build_object('code', c.code, 'titulo', p.titulo, 'tipo', p.tipo, 'valor', p.valor, 'regalo', p.regalo,
    'tope', p.tope, 'minimo', p.minimo, 'acumula', p.acumula, 'vence_at', least(c.vence_at, p.vence_at),
    'personal', c.phone is not null, 'error', v_err);
end $$;
revoke all on function public.promo_check(text,text) from public;
grant execute on function public.promo_check(text,text) to anon, authenticated;

-- EQUIPO o EDGE FUNCTION · código personal para un celular. Si ya tiene uno sin usar y vigente de la misma promo (y campaña), lo reusa.
create or replace function public.promo_codigo_nuevo(p_promo uuid, p_phone text, p_campaign uuid default null, p_automation uuid default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  p promos%rowtype; c promo_codigos%rowtype;
  v_phone text := public.norm_phone(p_phone);
  v_code text; v_vence timestamptz; v_tries int := 0;
  abc text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; -- sin 0/O ni 1/I/L para que se lea bien
begin
  if not (public.is_staff() or coalesce(auth.role(), '') = 'service_role') then raise exception 'Solo el equipo puede hacer esto'; end if;
  if v_phone is null then raise exception 'Revisá el celular'; end if;
  select * into p from promos where id = p_promo;
  if not found then raise exception 'No encontramos esa promo'; end if;
  if not p.activa then raise exception 'La promo "%" está pausada', p.nombre; end if;
  if p.vence_at is not null and p.vence_at <= now() then raise exception 'La promo "%" ya venció', p.nombre; end if;
  select * into c from promo_codigos
   where promo_id = p.id and phone = v_phone and usos = 0 and (vence_at is null or vence_at > now() + interval '1 day')
     and campaign_id is not distinct from p_campaign and automation_id is not distinct from p_automation
   order by created_at desc limit 1;
  if found then return jsonb_build_object('code', c.code, 'vence_at', least(c.vence_at, p.vence_at), 'nuevo', false); end if;
  v_vence := case when p.dias is not null then least(now() + make_interval(days => p.dias), p.vence_at) else p.vence_at end;
  loop
    v_code := p.prefijo || '-' || (select string_agg(substr(abc, 1 + floor(random() * length(abc))::int, 1), '') from generate_series(1, 4));
    exit when not exists (select 1 from promo_codigos where code = v_code);
    v_tries := v_tries + 1; if v_tries > 30 then raise exception 'Probá de nuevo'; end if;
  end loop;
  insert into promo_codigos (code, promo_id, phone, campaign_id, automation_id, vence_at) values (v_code, p.id, v_phone, p_campaign, p_automation, v_vence);
  return jsonb_build_object('code', v_code, 'vence_at', v_vence, 'nuevo', true);
end $$;
revoke all on function public.promo_codigo_nuevo(uuid,text,uuid,uuid) from public, anon;
grant execute on function public.promo_codigo_nuevo(uuid,text,uuid,uuid) to authenticated, service_role;

-- PANEL · números de cada promo, campaña y automática (solo pedidos no cancelados; "vendido" = total de los entregados)
create or replace function public.promos_resumen() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r jsonb := '{}'::jsonb; k text;
begin
  if not public.is_staff() then raise exception 'Solo el equipo puede hacer esto'; end if;
  foreach k in array array['promo','campana','automatica'] loop
    r := r || jsonb_build_object(k, coalesce((
      select jsonb_object_agg(id, jsonb_build_object('codigos', codigos, 'usados', usados, 'descontado', descontado, 'entregados', entregados, 'vendido', vendido))
      from (
        select x.id::text as id,
               (select count(*) from promo_codigos c where case k when 'promo' then c.promo_id when 'campana' then c.campaign_id else c.automation_id end = x.id) as codigos,
               count(u.id) as usados, coalesce(sum(u.monto), 0) as descontado,
               count(u.id) filter (where o.status = 'entregado') as entregados,
               coalesce(sum(o.total) filter (where o.status = 'entregado'), 0) as vendido
        from (select distinct case k when 'promo' then c.promo_id when 'campana' then c.campaign_id else c.automation_id end as id from promo_codigos c) x
        left join promo_codigos c on case k when 'promo' then c.promo_id when 'campana' then c.campaign_id else c.automation_id end = x.id
        left join promo_usos u on u.code = c.code and not u.devuelto
        left join orders o on o.id = u.order_id
        where x.id is not null
        group by x.id) t), '{}'::jsonb));
  end loop;
  return r;
end $$;
revoke all on function public.promos_resumen() from public, anon;
grant execute on function public.promos_resumen() to authenticated;

-- Pedido v7 = v6 + código de descuento (p_codigo). Va después del premio del Club y antes de la maquinita y la gift card.
do $mig$
declare d text; n int;
begin
  d := pg_get_functiondef('public.create_order_v6(text,text,jsonb,text,text,text,text,text,text,text,text)'::regprocedure);
  d := replace(d, 'public.create_order_v6(', 'public.create_order_v7(');
  if position($q$p_maq text DEFAULT NULL::text)$q$ in d) = 0 then raise exception 'create_order_v7: no encontré los parámetros'; end if;
  d := replace(d, $q$p_maq text DEFAULT NULL::text)$q$, $q$p_maq text DEFAULT NULL::text, p_codigo text DEFAULT NULL::text)$q$);

  n := (length(d) - length(replace(d, '  mp       maq_premios%rowtype;', ''))) / length('  mp       maq_premios%rowtype;');
  if n <> 1 then raise exception 'create_order_v7: esperaba 1 declaración de mp, hay %', n; end if;
  d := replace(d, '  mp       maq_premios%rowtype;', '  mp       maq_premios%rowtype;
  pc       promo_codigos%rowtype;
  pp       promos%rowtype;
  v_cod    integer := 0;
  v_cerr   text;');

  n := (length(d) - length(replace(d, $q$  if nullif(trim(coalesce(p_maq, '')), '') is not null then$q$, ''))) / length($q$  if nullif(trim(coalesce(p_maq, '')), '') is not null then$q$);
  if n <> 1 then raise exception 'create_order_v7: esperaba 1 bloque de maquinita, hay %', n; end if;
  d := replace(d, $q$  if nullif(trim(coalesce(p_maq, '')), '') is not null then$q$, $q$  if nullif(trim(coalesce(p_codigo, '')), '') is not null then
    select * into pc from promo_codigos where code = upper(trim(p_codigo)) for update;
    v_cerr := public.promo_problema(p_codigo, v_phone);
    if v_cerr is not null then raise exception '%', v_cerr; end if;
    select * into pp from promos where id = pc.promo_id for update;
    if not pp.acumula and (v_premio or nullif(trim(coalesce(p_maq, '')), '') is not null) then
      raise exception 'Este código no se suma con %. Guardalo para tu próximo pedido.', case when v_premio then 'el premio del Setto Club' else 'el premio de la maquinita' end;
    end if;
    if v_sub < pp.minimo then raise exception 'Este código es para compras desde $%', replace(to_char(pp.minimo, 'FM999,999,999'), ',', '.'); end if;
    if pp.tipo = 'porcentaje' then
      v_cod := (round(v_sub * pp.valor / 100.0 / 10.0) * 10)::int;
      if pp.tope > 0 then v_cod := least(v_cod, pp.tope); end if;
    elsif pp.tipo = 'monto' then
      v_cod := pp.valor;
    elsif pp.tipo = 'regalo' then
      select min((l->>'precio')::int) into v_cod from jsonb_array_elements(v_lines) l join products pr2 on pr2.id = l->>'id'
       where case when pp.regalo = 'bebida' then pr2.categoria = 'dirty' or (pr2.categoria = 'especial' and pr2.formato = 'dirty')
                  else pr2.categoria = 'mochi' or (pr2.categoria = 'especial' and coalesce(pr2.formato, 'mochi') = 'mochi') end;
      if v_cod is null then raise exception 'Para usar este código agregá %', case when pp.regalo = 'bebida' then 'una bebida (dirty) al pedido' else 'un mochi al pedido' end; end if;
    else
      if v_modo <> 'envio' then raise exception 'Este código es de envío gratis: elegí envío a domicilio'; end if;
      v_cod := v_costo;
    end if;
    v_cod := greatest(0, least(v_cod, greatest(v_total, 0)));
    v_lines := v_lines || jsonb_build_object('id', 'codigo', 'nombre', 'Código ' || pc.code || ': ' || pp.titulo, 'size', null, 'qty', 1, 'precio', -v_cod, 'subtotal', -v_cod);
    v_total := v_total - v_cod;
    update promo_codigos set usos = usos + 1 where code = pc.code;
  end if;

  if nullif(trim(coalesce(p_maq, '')), '') is not null then$q$);

  n := (length(d) - length(replace(d, 'if mp.id is not null then insert into maq_premio_usos', ''))) / length('if mp.id is not null then insert into maq_premio_usos');
  if n <> 1 then raise exception 'create_order_v7: esperaba 1 alta de maq_premio_usos, hay %', n; end if;
  d := replace(d, 'if mp.id is not null then insert into maq_premio_usos',
    'if pc.code is not null then insert into promo_usos (promo_id, code, order_id, phone, monto) values (pp.id, pc.code, v_id, v_phone, v_cod); end if;
  if mp.id is not null then insert into maq_premio_usos');

  if position($q$'maquinita', v_maq,$q$ in d) = 0 then raise exception 'create_order_v7: no encontré el return'; end if;
  d := replace(d, $q$'maquinita', v_maq,$q$, $q$'maquinita', v_maq, 'codigo', v_cod,$q$);
  execute d;
end $mig$;
revoke all on function public.create_order_v7(text,text,jsonb,text,text,text,text,text,text,text,text,text) from public;
grant execute on function public.create_order_v7(text,text,jsonb,text,text,text,text,text,text,text,text,text) to anon, authenticated;

-- Las líneas de descuento (código, maquinita, gift card) no son productos: no aparecen en reseñas ni cuentan como pedido "no vacío" al resolver un cambio.
do $mig$
declare f text; d text;
begin
  foreach f in array array['public.public_reviews()', 'public.public_reviews_all(integer)', 'public.product_reviews(text)', 'public.product_ratings()', 'public.resolver_cambio(text,jsonb,boolean)'] loop
    d := pg_get_functiondef(f::regprocedure);
    if position($q$not in ('envio','premio')$q$ in d) = 0 then raise notice '%: sin cambios', f; continue; end if;
    execute replace(d, $q$not in ('envio','premio')$q$, $q$not in ('envio','premio','maquinita','gift','codigo')$q$);
  end loop;
end $mig$;

-- Al cancelar un pedido: el código vuelve a quedar disponible (una sola vez por pedido).
create or replace function public.orders_promo() returns trigger
language plpgsql security definer set search_path = public as $$
declare u record;
begin
  begin
  if new.status = 'cancelado' and old.status is distinct from 'cancelado' then
    for u in select * from promo_usos where order_id = new.id and not devuelto loop
      update promo_usos set devuelto = true where id = u.id;
      update promo_codigos set usos = greatest(usos - 1, 0) where code = u.code;
    end loop;
  end if;
  exception when others then raise warning 'orders_promo %: %', new.code, sqlerrm; -- nunca frena el cambio de estado
  end;
  return null;
end $$;
revoke all on function public.orders_promo() from public, anon, authenticated;

-- (correr este create trigger solo, con lock_timeout: junto con otras sentencias se cuelga)
create trigger orders_promo after update of status on public.orders
  for each row execute function public.orders_promo();
