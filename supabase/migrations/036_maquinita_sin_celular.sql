-- 036 · Maquinita sin celular para jugar.
--   Antes la tirada gratis del día iba por número, así que inventando números se tiraba sin límite.
--   Ahora:
--     · La tirada gratis va por dispositivo (un token al azar que guarda el navegador) y con tope por red
--       (settings.maquinita.ip_dia, 5 por defecto): borrar el navegador no alcanza para tirar de más.
--     · Las fichas de compra siguen en el número: solo existen si hubo un pedido entregado, así que un
--       número inventado no tiene nada. La web usa el celular de los pedidos de ese dispositivo.
--     · Si gana sin celular, el premio queda 'pendiente' en ese dispositivo y se reclama con el celular
--       (maq_reclamar). Recién ahí queda activo y atado al número.
--     · maq_tirar(phone) deja de ser pública.

create table if not exists public.maq_dispositivos (
  dev           text primary key,
  gratis_dia    date,
  gratis_usadas integer not null default 0,
  updated_at    timestamptz not null default now()
);
alter table public.maq_dispositivos enable row level security;
create policy maq_dispositivos_staff on public.maq_dispositivos for all to authenticated using (public.is_staff()) with check (public.is_staff());

alter table public.maq_premios alter column phone drop not null;
alter table public.maq_premios add column if not exists dev text;
alter table public.maq_premios drop constraint if exists maq_premios_estado_check;
alter table public.maq_premios add constraint maq_premios_estado_check check (estado in ('pendiente','activo','usado','anulado'));
create index if not exists maq_premios_dev on public.maq_premios (dev) where estado = 'pendiente';

alter table public.maq_tiradas alter column phone drop not null;
alter table public.maq_tiradas add column if not exists dev text;
alter table public.maq_tiradas add column if not exists ip text;
create index if not exists maq_tiradas_ip on public.maq_tiradas (ip, created_at desc) where gratis;

-- IP de quien llama (la pasa la API de Supabase en los headers del pedido)
create or replace function public.maq_ip() returns text
language sql stable as $$
  select nullif(trim(coalesce(h->>'cf-connecting-ip', split_part(coalesce(h->>'x-forwarded-for', ''), ',', 1), h->>'x-real-ip', '')), '')
  from (select coalesce(nullif(current_setting('request.headers', true), ''), '{}')::json as h) x
$$;
revoke all on function public.maq_ip() from public, anon, authenticated;

create or replace function public.maq_dev_ok(p_dev text) returns text
language sql immutable as $$ select case when p_dev ~ '^[A-Za-z0-9-]{16,64}$' then p_dev end $$;

-- PÚBLICO · estado: tiradas gratis de este dispositivo, fichas y premios del número (si lo hay) y premio sin reclamar
create or replace function public.maq_estado_v2(p_dev text, p_phone text default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_dev text := public.maq_dev_ok(p_dev);
  v_phone text := public.norm_phone(p_phone);
  cfg jsonb := coalesce((select value from settings where key = 'maquinita'), '{}'::jsonb);
  v_dia int := greatest(1, least(5, coalesce((cfg->>'fichas_dia')::int, 1)));
  hoy date := (now() at time zone 'America/Argentina/Buenos_Aires')::date;
  d maq_dispositivos%rowtype;
  pend jsonb;
begin
  if v_dev is null then raise exception 'Recargá la página y probá de nuevo'; end if;
  select * into d from maq_dispositivos where dev = v_dev;
  select jsonb_build_object('code', code, 'titulo', titulo) into pend
    from maq_premios where dev = v_dev and estado = 'pendiente' order by created_at desc limit 1;
  return jsonb_build_object(
    'gratis', greatest(0, v_dia - case when d.gratis_dia = hoy then d.gratis_usadas else 0 end),
    'fichas', coalesce((select fichas from maq_jugadores where phone = v_phone), 0),
    'premios', coalesce((select jsonb_agg(jsonb_build_object('code', code, 'titulo', titulo, 'tipo', tipo, 'valor', valor, 'saldo', saldo) order by created_at desc)
                         from maq_premios where v_phone is not null and phone = v_phone and estado = 'activo'), '[]'::jsonb),
    'pendiente', pend);
end $$;
revoke all on function public.maq_estado_v2(text,text) from public;
grant execute on function public.maq_estado_v2(text,text) to anon, authenticated;

-- PÚBLICO · tirar: primero la gratis del dispositivo (con tope por red), después las fichas de compra del número
create or replace function public.maq_tirar_v2(p_dev text, p_phone text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_dev text := public.maq_dev_ok(p_dev);
  v_phone text := public.norm_phone(p_phone);
  cfg jsonb := coalesce((select value from settings where key = 'maquinita'), '{}'::jsonb);
  v_dia int := greatest(1, least(5, coalesce((cfg->>'fichas_dia')::int, 1)));
  v_ipdia int := greatest(1, coalesce((cfg->>'ip_dia')::int, 5));
  hoy date := (now() at time zone 'America/Argentina/Buenos_Aires')::date;
  v_ip text := public.maq_ip();
  d maq_dispositivos%rowtype;
  v_fichas int := 0;
  v_gratis boolean := false;
  x numeric := random() * 100;
  p record;
  v_res text := 'nada';
  v_titulo text; v_tipo text; v_valor int;
  v_code text; v_pid uuid; v_tries int := 0;
begin
  if coalesce((cfg->>'activo')::boolean, true) = false then raise exception 'La maquinita está apagada por ahora'; end if;
  if v_dev is null then raise exception 'Recargá la página y probá de nuevo'; end if;
  if p_phone is not null and trim(p_phone) <> '' and v_phone is null then raise exception 'Revisá tu celular'; end if;

  insert into maq_dispositivos (dev) values (v_dev) on conflict (dev) do nothing;
  select * into d from maq_dispositivos where dev = v_dev for update;
  if d.gratis_dia is distinct from hoy then d.gratis_dia := hoy; d.gratis_usadas := 0; end if;

  if d.gratis_usadas < v_dia and (v_ip is null or (select count(*) from maq_tiradas
        where ip = v_ip and gratis and created_at >= (hoy::timestamp at time zone 'America/Argentina/Buenos_Aires')) < v_ipdia) then
    v_gratis := true; d.gratis_usadas := d.gratis_usadas + 1;
    update maq_dispositivos set gratis_dia = d.gratis_dia, gratis_usadas = d.gratis_usadas, updated_at = now() where dev = v_dev;
    v_fichas := coalesce((select fichas from maq_jugadores where phone = v_phone), 0);
  else
    if v_phone is not null then select fichas into v_fichas from maq_jugadores where phone = v_phone for update; end if;
    if coalesce(v_fichas, 0) > 0 then
      v_fichas := v_fichas - 1;
      update maq_jugadores set fichas = v_fichas, updated_at = now() where phone = v_phone;
      insert into maq_movimientos (phone, delta, motivo) values (v_phone, -1, 'Tirada');
    elsif d.gratis_usadas < v_dia then
      raise exception 'Hoy ya se usaron las tiradas gratis desde esta red. Volvé mañana.';
    else
      raise exception 'No te quedan fichas. Volvé mañana o sumá con tu próxima compra.';
    end if;
  end if;

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
    -- sin celular queda pendiente en el dispositivo hasta que lo reclame
    insert into maq_premios (code, phone, dev, premio_id, titulo, tipo, valor, saldo, estado)
    values (v_code, v_phone, v_dev, v_res, v_titulo, v_tipo, v_valor, case when v_tipo = 'monto' then v_valor else 0 end,
            case when v_phone is null then 'pendiente' else 'activo' end)
    returning id into v_pid;
  end if;
  insert into maq_tiradas (phone, dev, ip, resultado, gratis, premio) values (v_phone, v_dev, v_ip, v_res, v_gratis, v_pid);

  return jsonb_build_object('resultado', v_res, 'titulo', v_titulo,
    'code', case when v_phone is null then null else v_code end, 'pendiente', v_phone is null and v_res <> 'nada',
    'gratis', greatest(0, v_dia - d.gratis_usadas), 'fichas', v_fichas);
end $$;
revoke all on function public.maq_tirar_v2(text,text) from public;
grant execute on function public.maq_tirar_v2(text,text) to anon, authenticated;

-- PÚBLICO · reclamar los premios que ganó este dispositivo sin celular: queda activo y atado al número
create or replace function public.maq_reclamar(p_dev text, p_phone text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_dev text := public.maq_dev_ok(p_dev);
  v_phone text := public.norm_phone(p_phone);
  mp maq_premios%rowtype;
begin
  if v_dev is null then raise exception 'Recargá la página y probá de nuevo'; end if;
  if v_phone is null then raise exception 'Revisá tu celular'; end if;
  select * into mp from maq_premios where dev = v_dev and estado = 'pendiente' order by created_at desc limit 1 for update;
  if not found then raise exception 'No encontramos un premio para guardar'; end if;
  -- si ganó más de una vez sin celular, se guardan todos
  update maq_tiradas set phone = v_phone where premio in (select id from maq_premios where dev = v_dev and estado = 'pendiente');
  update maq_premios set phone = v_phone, estado = 'activo' where dev = v_dev and estado = 'pendiente';
  return jsonb_build_object('code', mp.code, 'titulo', mp.titulo, 'tipo', mp.tipo, 'valor', mp.valor, 'saldo', mp.saldo);
end $$;
revoke all on function public.maq_reclamar(text,text) from public;
grant execute on function public.maq_reclamar(text,text) to anon, authenticated;

-- la tirada vieja (gratis por número) deja de ser pública
revoke execute on function public.maq_tirar(text) from anon, authenticated;
