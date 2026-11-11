-- 057 · Automática "promo de un producto": cuando un código de descuento está vigente, avisa por WhatsApp a quienes
--   pidieron ese producto últimamente y/o lo tienen de favorito.
--   - marketing_automations.disparador suma 'producto'.
--   - marketing_automations.producto: el producto de la carta en promo (si el código tiene "solo con la compra de", es ese).
--   - marketing_automations.audiencia: 'ultimos' (lo pidieron en los últimos `dias` días), 'favorito' (es lo que más pidieron) o 'ambos'.
--   - message_logs.promo_id: con qué promo se mandó cada mensaje, para no repetirle a la misma persona la misma promo
--     (aunque haya dos automáticas con la misma promo).
--   - automatica_producto_destinatarios(): a quién le toca ahora. Solo mientras el código está activo, ya empezó ("vale desde")
--     y le quedan al menos 2 hs; el producto tiene que estar en la carta y sin agotar. Mismas reglas de siempre: permiso de
--     WhatsApp vigente (puede_contactar) y nadie recibe dos mensajes de campaña o automática en 7 días. Además no le escribe a
--     quien ya volvió a pedir ese producto desde que arrancó la promo.
--   - automaticas_tick('producto'): corre cada hora de 10 a 20 h (Argentina), así sale poco después de que arranca la promo.
--   No borra nada.

alter table public.marketing_automations drop constraint if exists marketing_automations_disparador_check;
alter table public.marketing_automations add constraint marketing_automations_disparador_check check (disparador in ('compra','premio','producto'));
alter table public.marketing_automations add column if not exists producto text references public.products(id) on delete set null;
alter table public.marketing_automations add column if not exists audiencia text;
alter table public.marketing_automations drop constraint if exists marketing_automations_audiencia_check;
alter table public.marketing_automations add constraint marketing_automations_audiencia_check check (audiencia is null or audiencia in ('ultimos','favorito','ambos'));
-- la de producto necesita producto, código y a quién; "dias" = qué tan reciente cuenta como "últimamente".
-- producto y promo_id se pueden quedar en null si se borran (on delete set null): entonces no sale nada.
alter table public.marketing_automations drop constraint if exists marketing_automations_regla_check;
alter table public.marketing_automations add constraint marketing_automations_regla_check
  check ((disparador = 'compra' and dias is not null)
      or (disparador = 'premio' and horas is not null)
      or (disparador = 'producto' and audiencia is not null and (audiencia = 'favorito' or dias is not null)));

alter table public.message_logs add column if not exists promo_id uuid references public.promos(id) on delete set null;
create index if not exists message_logs_promo on public.message_logs(promo_id, phone) where promo_id is not null;

-- lo que más pidió cada celular (mismo criterio que {favorito} en _shared/cliente.ts: pedidos no cancelados,
-- solo productos que hoy están en la carta, por unidades; si empatan, el pedido más reciente)
create or replace function public.favorito_de_clientes()
returns table (phone text, producto text)
language sql stable security definer set search_path = public as $$
  select distinct on (x.phone) x.phone, x.pid
  from (
    select o.phone, it->>'id' as pid, sum(coalesce((it->>'qty')::int, 1)) as qty, max(o.created_at) as ult
    from orders o cross join lateral jsonb_array_elements(case when jsonb_typeof(o.items) = 'array' then o.items else '[]'::jsonb end) it
    join products p on p.id = it->>'id' and p.activo
    where o.status <> 'cancelado' and o.phone is not null
    group by o.phone, it->>'id'
  ) x
  order by x.phone, x.qty desc, x.ult desc;
$$;
revoke all on function public.favorito_de_clientes() from public, anon, authenticated;
grant execute on function public.favorito_de_clientes() to service_role;

-- a quién le toca ahora (motivo: 'ultimos' o 'favorito'; si es las dos cosas, 'ultimos')
create or replace function public.automatica_producto_destinatarios(p_id uuid)
returns table (phone text, nombre text, motivo text)
language sql stable security definer set search_path = public as $$
  with a as (
    select a.*, greatest(coalesce(a.activa_desde, now()), coalesce(pr.desde_at, '-infinity'::timestamptz)) as arranque
    from marketing_automations a
    join promos pr on pr.id = a.promo_id
    join products p on p.id = a.producto
    where a.id = p_id and a.disparador = 'producto'
      and pr.activa and (pr.desde_at is null or pr.desde_at <= now())
      and (pr.vence_at is null or pr.vence_at > now() + interval '2 hours') -- con menos de 2 hs ya no llega a usarlo
      and p.activo and not coalesce(p.agotado, false)
  ), pidieron as (
    select distinct o.phone, 'ultimos'::text as motivo
    from a join orders o on o.status <> 'cancelado' and o.phone is not null and a.audiencia in ('ultimos','ambos')
      and o.created_at > now() - make_interval(days => coalesce(a.dias, 60))
      and jsonb_typeof(o.items) = 'array' and o.items @> jsonb_build_array(jsonb_build_object('id', a.producto))
  ), fans as (
    select f.phone, 'favorito'::text as motivo
    from a join public.favorito_de_clientes() f on f.producto = a.producto and a.audiencia in ('favorito','ambos')
  ), todos as (
    select distinct on (t.phone) t.phone, t.motivo from (select * from pidieron union all select * from fans) t
    order by t.phone, t.motivo desc -- 'ultimos' antes que 'favorito'
  )
  select t.phone, c.nombre, t.motivo
  from todos t cross join a
  left join customers c on c.phone = t.phone
  where public.puede_contactar(t.phone, 'whatsapp')
    -- una sola vez por promo (de esta o de cualquier automática con el mismo código)
    and not exists (select 1 from message_logs l where l.promo_id = a.promo_id and l.phone = t.phone and l.automation_id is not null
                    and l.estado <> 'fallo' and coalesce(l.texto, '') <> '[prueba]')
    -- si falló 3 veces con esta promo (ej. ese número no tiene WhatsApp), no se insiste cada hora
    and (select count(*) from message_logs l where l.promo_id = a.promo_id and l.phone = t.phone and l.estado = 'fallo') < 3
    -- si ya lo volvió a pedir desde que arrancó la promo, no hace falta avisarle
    and not exists (select 1 from orders o where o.phone = t.phone and o.status <> 'cancelado' and o.created_at >= a.arranque
                    and jsonb_typeof(o.items) = 'array' and o.items @> jsonb_build_array(jsonb_build_object('id', a.producto)))
    -- máximo un mensaje de campaña o automática cada 7 días (las pruebas del panel no cuentan)
    and not exists (select 1 from message_logs l where l.phone = t.phone and l.direccion = 'saliente' and l.estado <> 'fallo'
                    and (l.campaign_id is not null or l.automation_id is not null) and coalesce(l.texto, '') <> '[prueba]'
                    and l.created_at > now() - interval '7 days');
$$;
revoke all on function public.automatica_producto_destinatarios(uuid) from public, anon, authenticated;
grant execute on function public.automatica_producto_destinatarios(uuid) to service_role;

-- para el panel: igual que 052, con "hoy" según el tipo y, en las de producto, cuántos por cada motivo
create or replace function public.automaticas_resumen() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r jsonb := '{}'::jsonb; a record; v_ult int; v_fav int;
begin
  if not public.is_staff() then raise exception 'Solo el equipo puede hacer esto'; end if;
  for a in select id, disparador from marketing_automations loop
    v_ult := null; v_fav := null;
    if a.disparador = 'producto' then
      select count(*) filter (where motivo = 'ultimos'), count(*) filter (where motivo = 'favorito') into v_ult, v_fav
      from public.automatica_producto_destinatarios(a.id);
    end if;
    r := r || jsonb_build_object(a.id::text, jsonb_build_object(
      'enviados', (select count(*) from message_logs l where l.automation_id = a.id and l.estado <> 'fallo' and coalesce(l.texto, '') <> '[prueba]'),
      'semana',   (select count(*) from message_logs l where l.automation_id = a.id and l.estado <> 'fallo' and coalesce(l.texto, '') <> '[prueba]' and l.created_at > now() - interval '7 days'),
      'gratis',   (select count(*) from message_logs l where l.automation_id = a.id and l.estado <> 'fallo' and l.texto like '[libre]%'),
      'fallidos', (select count(*) from message_logs l where l.automation_id = a.id and l.estado = 'fallo'),
      'ultimos',  v_ult,
      'favorito', v_fav,
      'hoy',      case a.disparador
                    when 'premio' then (select count(*) from public.automatica_premio_destinatarios(a.id))
                    when 'producto' then v_ult + v_fav
                    else (select count(*) from public.automatica_destinatarios(a.id)) end));
  end loop;
  return r;
end $$;
revoke all on function public.automaticas_resumen() from public, anon;
grant execute on function public.automaticas_resumen() to authenticated;

do $$ begin
  if exists (select 1 from cron.job where jobname = 'setto-automaticas-producto') then perform cron.unschedule('setto-automaticas-producto'); end if;
  perform cron.schedule('setto-automaticas-producto', '35 13-23 * * *', $c$select public.automaticas_tick('producto')$c$); -- cada hora de 10 a 20 h Argentina
end $$;
