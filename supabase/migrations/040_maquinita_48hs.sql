-- 040: el premio de la maquinita dura 48 hs y se canjea en la misma visita.
-- · maq_premios.vence_at: 48 hs desde que sale. Los premios que ya existían quedan sin vencimiento.
--   Vencido = no se puede guardar con el celular ni usar en un pedido.
-- · Al canjear, la maquinita ofrece las mismas dos casillas del checkout (WhatsApp y anuncios de Meta).
--   consentimiento_maquinita_v2 solo acepta un número que acaba de guardar un premio en ese dispositivo.

alter table public.maq_premios add column if not exists vence_at timestamptz;
alter table public.maq_premios alter column vence_at set default now() + interval '48 hours';

create or replace function public.maq_vigente(p_vence timestamptz) returns boolean
language sql stable as $$ select p_vence is null or p_vence > now() $$;

-- PÚBLICO · estado del dispositivo (igual que 036, sin vencidos y con vence_at)
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
  select jsonb_build_object('code', code, 'titulo', titulo, 'tipo', tipo, 'valor', valor, 'saldo', saldo, 'vence_at', vence_at) into pend
    from maq_premios where dev = v_dev and estado = 'pendiente' and public.maq_vigente(vence_at) order by created_at desc limit 1;
  return jsonb_build_object(
    'gratis', greatest(0, v_dia - case when d.gratis_dia = hoy then d.gratis_usadas else 0 end),
    'fichas', coalesce((select fichas from maq_jugadores where phone = v_phone), 0),
    'premios', coalesce((select jsonb_agg(jsonb_build_object('code', code, 'titulo', titulo, 'tipo', tipo, 'valor', valor, 'saldo', saldo, 'vence_at', vence_at) order by created_at desc)
                         from maq_premios where v_phone is not null and phone = v_phone and estado = 'activo' and public.maq_vigente(vence_at)), '[]'::jsonb),
    'pendiente', pend);
end $$;

-- PÚBLICO · premios del número (lo usa el checkout para ofrecer "Usar")
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
    'premios', coalesce((select jsonb_agg(jsonb_build_object('code', code, 'titulo', titulo, 'tipo', tipo, 'valor', valor, 'saldo', saldo, 'vence_at', vence_at) order by created_at desc)
                         from maq_premios where phone = v_phone and estado = 'activo' and public.maq_vigente(vence_at)), '[]'::jsonb));
end $$;

-- PÚBLICO · revisar un código antes de pedir
create or replace function public.maq_premio_check(p_code text, p_phone text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('code', code, 'titulo', titulo, 'tipo', tipo, 'valor', valor, 'saldo', saldo, 'vence_at', vence_at,
    'estado', case when estado = 'activo' and not public.maq_vigente(vence_at) then 'vencido' else estado end)
  from maq_premios where code = upper(trim(p_code)) and phone = public.norm_phone(p_phone)
$$;

-- PÚBLICO · guardar con el celular lo que ganó este dispositivo (solo si no venció)
create or replace function public.maq_reclamar(p_dev text, p_phone text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_dev text := public.maq_dev_ok(p_dev);
  v_phone text := public.norm_phone(p_phone);
  mp maq_premios%rowtype;
begin
  if v_dev is null then raise exception 'Recargá la página y probá de nuevo'; end if;
  if v_phone is null then raise exception 'Revisá tu celular'; end if;
  select * into mp from maq_premios where dev = v_dev and estado = 'pendiente' and public.maq_vigente(vence_at) order by created_at desc limit 1 for update;
  if not found then raise exception 'No encontramos un premio para guardar (duran 48 hs)'; end if;
  update maq_tiradas set phone = v_phone where premio in (select id from maq_premios where dev = v_dev and estado = 'pendiente' and public.maq_vigente(vence_at));
  update maq_premios set phone = v_phone, estado = 'activo' where dev = v_dev and estado = 'pendiente' and public.maq_vigente(vence_at);
  return jsonb_build_object('code', mp.code, 'titulo', mp.titulo, 'tipo', mp.tipo, 'valor', mp.valor, 'saldo', mp.saldo, 'vence_at', mp.vence_at);
end $$;

-- PÚBLICO · casillas del canje: WhatsApp y/o anuncios. Solo para el número que guardó un premio de este dispositivo.
create or replace function public.consentimiento_maquinita_v2(p_dev text, p_phone text, p_canales text[], p_version text) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_dev text := public.maq_dev_ok(p_dev);
  ph text := public.norm_phone(p_phone);
  c text;
begin
  if v_dev is null or ph is null then raise exception 'Revisá tu celular'; end if;
  if not exists (select 1 from maq_premios where dev = v_dev and phone = ph and created_at > now() - interval '48 hours') then return; end if;
  foreach c in array coalesce(p_canales, '{}') loop
    if c in ('whatsapp','meta_ads') and not public.puede_contactar(ph, c) then
      insert into customer_consents(phone, canal, finalidad, estado, origen, aviso_version)
      values (ph, c, case c when 'whatsapp' then 'novedades' else 'publicidad' end, 'otorgado', 'maquinita', left(p_version, 20));
    end if;
  end loop;
end $$;
revoke all on function public.consentimiento_maquinita_v2(text,text,text[],text) from public;
grant execute on function public.consentimiento_maquinita_v2(text,text,text[],text) to anon, authenticated;

-- Pedido: un premio vencido no se aplica (se parchea la create_order_v6 que está en la base)
do $mig$
declare d text; n int; a text := $q$if mp.estado <> 'activo' then raise exception 'Ese premio de la maquinita ya se usó'; end if;$q$;
begin
  d := pg_get_functiondef('public.create_order_v6(text,text,jsonb,text,text,text,text,text,text,text,text)'::regprocedure);
  if position('maq_vigente' in d) > 0 then return; end if;
  n := (length(d) - length(replace(d, a, ''))) / length(a);
  if n <> 1 then raise exception 'create_order_v6: esperaba 1 control de estado del premio, hay %', n; end if;
  d := replace(d, a, a || $q$
    if not public.maq_vigente(mp.vence_at) then raise exception 'Ese premio de la maquinita venció: duraba 48 hs'; end if;$q$);
  execute d;
end $mig$;
