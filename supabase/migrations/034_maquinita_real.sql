-- 034 · Maquinita real: el resultado lo decide la base, los premios se canjean en el pedido
--        y cada compra entregada suma fichas. No borra nada.
--
--   Fichas: cada número tiene N tiradas gratis por día (settings.maquinita.fichas_dia, 1 por defecto)
--           + las fichas que suma cada compra entregada (settings.maquinita.fichas_compra, 5 por defecto).
--   Premios: settings.maquinita.premios = [{id, titulo, chance, tipo, valor}]
--            tipo 'monto'      → $valor de descuento (si sobra, queda saldo para otro pedido)
--            tipo 'porcentaje' → valor% off en los productos del pedido
--            tipo 'mochi'      → el mochi más barato del pedido sale gratis
--           Cada premio queda atado al número que tiró y se usa con el código MAQ-XXXX-XXXX al pedir.

create table if not exists public.maq_jugadores (
  phone         text primary key,
  fichas        integer not null default 0 check (fichas >= 0),
  gratis_dia    date,
  gratis_usadas integer not null default 0,
  updated_at    timestamptz not null default now()
);
create table if not exists public.maq_movimientos (
  id         uuid primary key default gen_random_uuid(),
  phone      text not null,
  delta      integer not null,
  motivo     text not null,
  order_id   uuid unique references public.orders(id) on delete set null,
  created_at timestamptz not null default now()
);
create table if not exists public.maq_premios (
  id         uuid primary key default gen_random_uuid(),
  code       text not null unique,
  phone      text not null,
  premio_id  text not null,
  titulo     text not null,
  tipo       text not null check (tipo in ('monto','porcentaje','mochi')),
  valor      integer not null default 0,
  saldo      integer not null default 0,
  estado     text not null default 'activo' check (estado in ('activo','usado','anulado')),
  created_at timestamptz not null default now(),
  usado_at   timestamptz
);
create table if not exists public.maq_premio_usos (
  id         uuid primary key default gen_random_uuid(),
  premio_id  uuid not null references public.maq_premios(id) on delete cascade,
  order_id   uuid not null references public.orders(id) on delete cascade,
  monto      integer not null,
  devuelto   boolean not null default false,
  created_at timestamptz not null default now()
);
create table if not exists public.maq_tiradas (
  id         uuid primary key default gen_random_uuid(),
  phone      text not null,
  resultado  text not null,
  gratis     boolean not null,
  premio     uuid references public.maq_premios(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists maq_premios_phone on public.maq_premios (phone);
create index if not exists maq_tiradas_fecha on public.maq_tiradas (created_at desc);

alter table public.maq_jugadores   enable row level security;
alter table public.maq_movimientos enable row level security;
alter table public.maq_premios     enable row level security;
alter table public.maq_premio_usos enable row level security;
alter table public.maq_tiradas     enable row level security;
create policy maq_jugadores_staff   on public.maq_jugadores   for all to authenticated using (public.is_staff()) with check (public.is_staff());
create policy maq_movimientos_staff on public.maq_movimientos for all to authenticated using (public.is_staff()) with check (public.is_staff());
create policy maq_premios_staff     on public.maq_premios     for all to authenticated using (public.is_staff()) with check (public.is_staff());
create policy maq_premio_usos_staff on public.maq_premio_usos for all to authenticated using (public.is_staff()) with check (public.is_staff());
create policy maq_tiradas_staff     on public.maq_tiradas     for all to authenticated using (public.is_staff()) with check (public.is_staff());

-- premios configurados en el panel, con los valores de siempre si faltan
create or replace function public.maq_premios_cfg() returns table (id text, titulo text, chance numeric, tipo text, valor int)
language sql stable set search_path = public as $$
  with cfg as (select coalesce((select value->'premios' from settings where key = 'maquinita'), 'null'::jsonb) p),
  def(id, titulo, chance, tipo, valor, ord) as (values
    ('gift', 'Gift card $10.000', 0.1::numeric, 'monto', 10000, 1),
    ('mochi', 'Mochi gratis', 0.5::numeric, 'mochi', 0, 2),
    ('off', '10% off', 2::numeric, 'porcentaje', 10, 3))
  select d.id,
         coalesce(nullif(trim(c->>'titulo'), ''), case when c is null then d.titulo end),
         case when c is null then d.chance else greatest(0, coalesce((c->>'chance')::numeric, 0)) end,
         coalesce(nullif(c->>'tipo', ''), d.tipo),
         case when c ? 'valor' then greatest(0, coalesce((c->>'valor')::int, 0)) else d.valor end
  from def d
  left join lateral (select e c from cfg, jsonb_array_elements(case when jsonb_typeof(cfg.p) = 'array' then cfg.p else '[]'::jsonb end) e where e->>'id' = d.id limit 1) x on true
  order by d.ord
$$;
revoke all on function public.maq_premios_cfg() from public, anon, authenticated;

-- PÚBLICO · fichas y premios de un número
create or replace function public.maq_estado(p_phone text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_phone text := public.norm_phone(p_phone);
  cfg jsonb := coalesce((select value from settings where key = 'maquinita'), '{}'::jsonb);
  v_dia int := greatest(1, least(5, coalesce((cfg->>'fichas_dia')::int, 1)));
  hoy date := (now() at time zone 'America/Argentina/Buenos_Aires')::date;
  j maq_jugadores%rowtype;
begin
  if v_phone is null then raise exception 'Revisá tu celular'; end if;
  select * into j from maq_jugadores where phone = v_phone;
  return jsonb_build_object(
    'gratis', greatest(0, v_dia - case when j.gratis_dia = hoy then j.gratis_usadas else 0 end),
    'fichas', coalesce(j.fichas, 0),
    'premios', coalesce((select jsonb_agg(jsonb_build_object('code', code, 'titulo', titulo, 'tipo', tipo, 'valor', valor, 'saldo', saldo) order by created_at desc)
                         from maq_premios where phone = v_phone and estado = 'activo'), '[]'::jsonb));
end $$;
revoke all on function public.maq_estado(text) from public;
grant execute on function public.maq_estado(text) to anon, authenticated;

-- PÚBLICO · tirar: gasta una ficha (primero las gratis del día), sortea y, si sale premio, lo guarda a nombre del número
create or replace function public.maq_tirar(p_phone text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_phone text := public.norm_phone(p_phone);
  cfg jsonb := coalesce((select value from settings where key = 'maquinita'), '{}'::jsonb);
  v_dia int := greatest(1, least(5, coalesce((cfg->>'fichas_dia')::int, 1)));
  hoy date := (now() at time zone 'America/Argentina/Buenos_Aires')::date;
  j maq_jugadores%rowtype;
  v_gratis boolean;
  x numeric := random() * 100;
  p record;
  v_res text := 'nada';
  v_titulo text; v_tipo text; v_valor int;
  v_code text; v_pid uuid; v_tries int := 0;
begin
  if coalesce((cfg->>'activo')::boolean, true) = false then raise exception 'La maquinita está apagada por ahora'; end if;
  if v_phone is null then raise exception 'Revisá tu celular'; end if;
  insert into maq_jugadores (phone) values (v_phone) on conflict (phone) do nothing;
  select * into j from maq_jugadores where phone = v_phone for update;
  if j.gratis_dia is distinct from hoy then j.gratis_dia := hoy; j.gratis_usadas := 0; end if;
  if j.gratis_usadas < v_dia then
    v_gratis := true; j.gratis_usadas := j.gratis_usadas + 1;
  elsif j.fichas > 0 then
    v_gratis := false; j.fichas := j.fichas - 1;
    insert into maq_movimientos (phone, delta, motivo) values (v_phone, -1, 'Tirada');
  else
    raise exception 'No te quedan fichas. Volvé mañana o sumá con tu próxima compra.';
  end if;
  update maq_jugadores set fichas = j.fichas, gratis_dia = j.gratis_dia, gratis_usadas = j.gratis_usadas, updated_at = now() where phone = v_phone;

  for p in select * from public.maq_premios_cfg() loop
    if p.titulo is null or p.chance <= 0 then continue; end if;
    if x < p.chance then v_res := p.id; v_titulo := p.titulo; v_tipo := p.tipo; v_valor := p.valor; exit; end if;
    x := x - p.chance;
  end loop;

  if v_res <> 'nada' then
    loop
      v_code := 'MAQ-' || upper(substr(md5(random()::text), 1, 4)) || '-' || upper(substr(md5(random()::text), 1, 4));
      exit when not exists (select 1 from maq_premios where code = v_code);
      v_tries := v_tries + 1; if v_tries > 20 then raise exception 'Probá de nuevo'; end if;
    end loop;
    insert into maq_premios (code, phone, premio_id, titulo, tipo, valor, saldo)
    values (v_code, v_phone, v_res, v_titulo, v_tipo, v_valor, case when v_tipo = 'monto' then v_valor else 0 end)
    returning id into v_pid;
  end if;
  insert into maq_tiradas (phone, resultado, gratis, premio) values (v_phone, v_res, v_gratis, v_pid);

  return jsonb_build_object('resultado', v_res, 'titulo', v_titulo, 'code', v_code,
    'gratis', greatest(0, v_dia - j.gratis_usadas), 'fichas', j.fichas);
end $$;
revoke all on function public.maq_tirar(text) from public;
grant execute on function public.maq_tirar(text) to anon, authenticated;

-- PÚBLICO · revisar un premio antes de pedir (solo sirve con el número que lo ganó)
create or replace function public.maq_premio_check(p_code text, p_phone text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('code', code, 'titulo', titulo, 'tipo', tipo, 'valor', valor, 'saldo', saldo, 'estado', estado)
  from maq_premios where code = upper(trim(p_code)) and phone = public.norm_phone(p_phone)
$$;
revoke all on function public.maq_premio_check(text,text) from public;
grant execute on function public.maq_premio_check(text,text) to anon, authenticated;

-- Pedido v6 = v5 + premio de la maquinita (p_maq). Se arma a partir de la v5 que está en la base.
do $mig$
declare d text; n int;
begin
  d := pg_get_functiondef('public.create_order_v5(text,text,jsonb,text,text,text,text,text,text,text)'::regprocedure);
  d := replace(d, 'public.create_order_v5(', 'public.create_order_v6(');
  d := replace(d, $q$p_gift text DEFAULT NULL::text)$q$, $q$p_gift text DEFAULT NULL::text, p_maq text DEFAULT NULL::text)$q$);
  if position('p_maq text' in d) = 0 then raise exception 'create_order_v6: no encontré los parámetros'; end if;

  n := (length(d) - length(replace(d, 'v_gift   integer := 0;', ''))) / length('v_gift   integer := 0;');
  if n <> 1 then raise exception 'create_order_v6: esperaba 1 declaración de v_gift, hay %', n; end if;
  d := replace(d, 'v_gift   integer := 0;', 'v_gift   integer := 0;
  mp       maq_premios%rowtype;
  v_maq    integer := 0;');

  n := (length(d) - length(replace(d, $q$if nullif(trim(coalesce(p_gift, '')), '') is not null then$q$, ''))) / length($q$if nullif(trim(coalesce(p_gift, '')), '') is not null then$q$);
  if n <> 1 then raise exception 'create_order_v6: esperaba 1 bloque de gift card, hay %', n; end if;
  d := replace(d, $q$if nullif(trim(coalesce(p_gift, '')), '') is not null then$q$, $q$if nullif(trim(coalesce(p_maq, '')), '') is not null then
    select * into mp from maq_premios where code = upper(trim(p_maq)) for update;
    if not found then raise exception 'No encontramos ese premio de la maquinita. Revisá el código.'; end if;
    if mp.phone <> v_phone then raise exception 'Ese premio es de otro número: pedí con el celular que tiró en la maquinita'; end if;
    if mp.estado <> 'activo' then raise exception 'Ese premio de la maquinita ya se usó'; end if;
    if mp.tipo = 'monto' then
      v_maq := least(mp.saldo, greatest(v_total, 0));
    elsif mp.tipo = 'porcentaje' then
      v_maq := least((round(v_sub * mp.valor / 100.0 / 10.0) * 10)::int, greatest(v_total, 0));
    else
      select min((l->>'precio')::int) into v_maq from jsonb_array_elements(v_lines) l join products pm on pm.id = l->>'id' where pm.categoria in ('mochi','especial');
      if v_maq is null then raise exception 'Para usar el mochi gratis agregá un mochi al pedido'; end if;
      v_maq := least(v_maq, greatest(v_total, 0));
    end if;
    if v_maq > 0 then
      v_lines := v_lines || jsonb_build_object('id', 'maquinita', 'nombre', 'Premio maquinita: ' || mp.titulo, 'size', null, 'qty', 1, 'precio', -v_maq, 'subtotal', -v_maq);
      v_total := v_total - v_maq;
    end if;
    update maq_premios set saldo = case when tipo = 'monto' then saldo - v_maq else 0 end,
      estado = case when tipo <> 'monto' or saldo - v_maq <= 0 then 'usado' else 'activo' end, usado_at = now() where id = mp.id;
  end if;

  if nullif(trim(coalesce(p_gift, '')), '') is not null then$q$);

  n := (length(d) - length(replace(d, 'if v_gift > 0 then insert into giftcard_usos (giftcard_id, order_id, monto) values (g.id, v_id, v_gift); end if;', ''))) / length('if v_gift > 0 then insert into giftcard_usos (giftcard_id, order_id, monto) values (g.id, v_id, v_gift); end if;');
  if n <> 1 then raise exception 'create_order_v6: esperaba 1 alta de giftcard_usos, hay %', n; end if;
  d := replace(d, 'if v_gift > 0 then insert into giftcard_usos (giftcard_id, order_id, monto) values (g.id, v_id, v_gift); end if;',
    'if v_gift > 0 then insert into giftcard_usos (giftcard_id, order_id, monto) values (g.id, v_id, v_gift); end if;
  if mp.id is not null then insert into maq_premio_usos (premio_id, order_id, monto) values (mp.id, v_id, v_maq); end if;');

  if position($q$'gift', v_gift,$q$ in d) = 0 then raise exception 'create_order_v6: no encontré el return'; end if;
  d := replace(d, $q$'gift', v_gift,$q$, $q$'gift', v_gift, 'maquinita', v_maq,$q$);
  execute d;
end $mig$;
revoke all on function public.create_order_v6(text,text,jsonb,text,text,text,text,text,text,text,text) from public;
grant execute on function public.create_order_v6(text,text,jsonb,text,text,text,text,text,text,text,text) to anon, authenticated;

-- Al entregar un pedido con celular: suma las fichas de compra (una sola vez por pedido).
-- Al cancelarlo: devuelve el premio de la maquinita que se había usado.
create or replace function public.orders_maquinita() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  cfg jsonb := coalesce((select value from settings where key = 'maquinita'), '{}'::jsonb);
  v_n int := greatest(0, least(50, coalesce((cfg->>'fichas_compra')::int, 5)));
  v_phone text := public.norm_phone(new.phone);
  u record;
begin
  -- nunca frena el cambio de estado del pedido: si algo falla acá, solo queda un aviso en el log
  begin
  if new.status = 'entregado' and old.status is distinct from 'entregado' and v_phone is not null and v_n > 0
     and coalesce((cfg->>'activo')::boolean, true) then
    insert into maq_movimientos (phone, delta, motivo, order_id) values (v_phone, v_n, 'Compra ' || new.code, new.id)
    on conflict (order_id) do nothing;
    if found then
      insert into maq_jugadores (phone, fichas) values (v_phone, v_n)
      on conflict (phone) do update set fichas = maq_jugadores.fichas + v_n, updated_at = now();
    end if;
  end if;
  if new.status = 'cancelado' and old.status is distinct from 'cancelado' then
    for u in select * from maq_premio_usos where order_id = new.id and not devuelto loop
      update maq_premios set saldo = case when tipo = 'monto' then saldo + u.monto else 0 end, estado = 'activo', usado_at = null where id = u.premio_id and estado in ('activo','usado');
      update maq_premio_usos set devuelto = true where id = u.id;
    end loop;
  end if;
  exception when others then raise warning 'orders_maquinita %: %', new.code, sqlerrm;
  end;
  return null;
end $$;
revoke all on function public.orders_maquinita() from public, anon, authenticated;

-- (correr este create trigger solo, con lock_timeout: junto con otras sentencias se cuelga)
create trigger orders_maquinita after update of status on public.orders
  for each row execute function public.orders_maquinita();
