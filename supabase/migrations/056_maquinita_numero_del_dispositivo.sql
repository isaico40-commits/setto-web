-- 056 · Luckyslot: las fichas y premios de un número solo se ven y se usan desde un dispositivo que demuestra ser de ese número.
--   Antes alcanzaba con mandar un celular: maq_estado_v2 / maq_tirar_v2 / maq_estado devolvían las fichas y los códigos
--   de premio de ese número y dejaban gastar sus fichas. Con un número conocido (o uno que quedó guardado en un celu
--   prestado) se podían usar fichas y premios ajenos.
--   Ahora:
--     · maq_dev_tel guarda qué números puede usar cada dispositivo.
--     · maq_vincular(dev, tracks) agrega el número de un pedido solo si el dispositivo tiene el link secreto de ese pedido
--       (el track: lo guarda la web al pedir y llega en el link de seguimiento por WhatsApp).
--     · maq_estado_v2 y maq_tirar_v2 ignoran un número no vinculado: se juega como sin celular (la gratis del día) y,
--       si sale premio, queda pendiente y se guarda con maq_reclamar (con su tope de 1 por semana).
--     · Los premios que se ven son los ganados en este dispositivo o los de un número vinculado.
--     · maq_estado(phone) deja de ser pública (devolvía los códigos de premio de cualquier número).
--   No se borra ni se cambia ninguna ficha ni premio existente.

create table if not exists public.maq_dev_tel (
  dev        text not null,
  phone      text not null,
  created_at timestamptz not null default now(),
  primary key (dev, phone)
);
alter table public.maq_dev_tel enable row level security;
create policy maq_dev_tel_staff on public.maq_dev_tel for all to authenticated using (public.is_staff()) with check (public.is_staff());

-- interno · el número vale para este dispositivo
create or replace function public.maq_tel_ok(p_dev text, p_phone text) returns text
language sql stable security definer set search_path = public as $$
  select v.phone from maq_dev_tel v where v.dev = public.maq_dev_ok(p_dev) and v.phone = public.norm_phone(p_phone)
$$;
revoke all on function public.maq_tel_ok(text,text) from public, anon, authenticated;

-- PÚBLICO · vincular los números de los pedidos hechos (o abiertos por link) en este dispositivo
create or replace function public.maq_vincular(p_dev text, p_tracks text[]) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_dev text := public.maq_dev_ok(p_dev);
begin
  if v_dev is null then raise exception 'Recargá la página y probá de nuevo'; end if;
  insert into maq_dev_tel (dev, phone)
    select distinct v_dev, o.phone from orders o
    where o.track = any(coalesce(p_tracks, '{}')[1:10]) and public.norm_phone(o.phone) is not null
  on conflict do nothing;
  return coalesce((select jsonb_agg(phone order by created_at desc) from maq_dev_tel where dev = v_dev), '[]'::jsonb);
end $$;
revoke all on function public.maq_vincular(text,text[]) from public;
grant execute on function public.maq_vincular(text,text[]) to anon, authenticated;

-- PÚBLICO · estado del dispositivo (igual que 040; el número solo cuenta si está vinculado)
create or replace function public.maq_estado_v2(p_dev text, p_phone text default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_dev text := public.maq_dev_ok(p_dev);
  v_phone text := public.maq_tel_ok(p_dev, p_phone);
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
    'vinculado', v_phone is not null,
    'gratis', greatest(0, v_dia - case when d.gratis_dia = hoy then d.gratis_usadas else 0 end),
    'fichas', coalesce((select fichas from maq_jugadores where v_phone is not null and phone = v_phone), 0),
    'premios', coalesce((select jsonb_agg(jsonb_build_object('code', code, 'titulo', titulo, 'tipo', tipo, 'valor', valor, 'saldo', saldo, 'vence_at', vence_at) order by created_at desc)
                         from maq_premios where estado = 'activo' and public.maq_vigente(vence_at)
                           and (dev = v_dev or (v_phone is not null and phone = v_phone))), '[]'::jsonb),
    'pendiente', pend);
end $$;
revoke all on function public.maq_estado_v2(text,text) from public;
grant execute on function public.maq_estado_v2(text,text) to anon, authenticated;

-- PÚBLICO · tirar (igual que 036; un número no vinculado se trata como sin celular)
create or replace function public.maq_tirar_v2(p_dev text, p_phone text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_dev text := public.maq_dev_ok(p_dev);
  v_phone text := public.maq_tel_ok(p_dev, p_phone);
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

  insert into maq_dispositivos (dev) values (v_dev) on conflict (dev) do nothing;
  select * into d from maq_dispositivos where dev = v_dev for update;
  if d.gratis_dia is distinct from hoy then d.gratis_dia := hoy; d.gratis_usadas := 0; end if;

  if d.gratis_usadas < v_dia and (v_ip is null or (select count(*) from maq_tiradas
        where ip = v_ip and gratis and created_at >= (hoy::timestamp at time zone 'America/Argentina/Buenos_Aires')) < v_ipdia) then
    v_gratis := true; d.gratis_usadas := d.gratis_usadas + 1;
    update maq_dispositivos set gratis_dia = d.gratis_dia, gratis_usadas = d.gratis_usadas, updated_at = now() where dev = v_dev;
    v_fichas := coalesce((select fichas from maq_jugadores where v_phone is not null and phone = v_phone), 0);
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
    insert into maq_premios (code, phone, dev, premio_id, titulo, tipo, valor, saldo, estado)
    values (v_code, v_phone, v_dev, v_res, v_titulo, v_tipo, v_valor, case when v_tipo = 'monto' then v_valor else 0 end,
            case when v_phone is null then 'pendiente' else 'activo' end)
    returning id into v_pid;
  end if;
  insert into maq_tiradas (phone, dev, ip, resultado, gratis, premio) values (v_phone, v_dev, v_ip, v_res, v_gratis, v_pid);

  return jsonb_build_object('resultado', v_res, 'titulo', v_titulo,
    'code', case when v_phone is null then null else v_code end, 'pendiente', v_phone is null and v_res <> 'nada',
    'gratis', greatest(0, v_dia - d.gratis_usadas), 'fichas', coalesce(v_fichas, 0));
end $$;
revoke all on function public.maq_tirar_v2(text,text) from public;
grant execute on function public.maq_tirar_v2(text,text) to anon, authenticated;

-- maq_estado(phone) devolvía los códigos de premio de cualquier número: el carrito ahora usa maq_estado_v2.
revoke execute on function public.maq_estado(text) from anon, authenticated;
