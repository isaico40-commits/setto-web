-- 052 · Automática "premio de la maquinita por vencer": avisa por WhatsApp a quien ganó y todavía no usó su premio.
--   - marketing_automations.disparador: 'compra' (lo de siempre, X días después de la última compra) o 'premio'.
--   - marketing_automations.horas: para 'premio', cuántas horas antes de que venza sale el aviso (ej. 24 = a mitad de las 48 hs).
--   - message_logs.maq_premio_id: qué premio se avisó (un solo aviso por premio).
--   - automatica_premio_destinatarios(): a quién le toca ahora. Solo premios guardados con celular (estado activo), sin usar,
--     sin vencer, con al menos 2 hs por delante, con permiso de WhatsApp vigente (puede_contactar) y sin otro mensaje de campaña
--     o automática en los últimos 7 días.
--   - automaticas_tick(p_disparador): la de compras sigue a las 11 h; la de premios corre cada hora de 10 a 20 h (Argentina).
--   No borra nada.

alter table public.marketing_automations add column if not exists disparador text not null default 'compra';
alter table public.marketing_automations drop constraint if exists marketing_automations_disparador_check;
alter table public.marketing_automations add constraint marketing_automations_disparador_check check (disparador in ('compra','premio'));
alter table public.marketing_automations add column if not exists horas integer;
alter table public.marketing_automations drop constraint if exists marketing_automations_horas_check;
alter table public.marketing_automations add constraint marketing_automations_horas_check check (horas is null or horas between 3 and 46);
alter table public.marketing_automations alter column dias drop not null; -- las de premio no usan días
alter table public.marketing_automations drop constraint if exists marketing_automations_regla_check;
alter table public.marketing_automations add constraint marketing_automations_regla_check
  check ((disparador = 'compra' and dias is not null) or (disparador = 'premio' and horas is not null));

alter table public.message_logs add column if not exists maq_premio_id uuid references public.maq_premios(id) on delete set null;
create index if not exists message_logs_maq_premio on public.message_logs(maq_premio_id) where maq_premio_id is not null;

-- a quién le toca ahora el aviso del premio (uno por celular, el que vence primero)
create or replace function public.automatica_premio_destinatarios(p_id uuid)
returns table (phone text, nombre text, premio uuid, code text, titulo text, vence_at timestamptz)
language sql stable security definer set search_path = public as $$
  select distinct on (p.phone) p.phone, c.nombre, p.id, p.code, p.titulo, p.vence_at
  from marketing_automations a
  join maq_premios p on true
  left join customers c on c.phone = p.phone
  where a.id = p_id and a.disparador = 'premio'
    and p.estado = 'activo' and p.phone is not null and p.vence_at is not null
    and p.vence_at <= now() + make_interval(hours => a.horas)
    and p.vence_at > now() + interval '2 hours' -- con menos de 2 hs ya no llega a usarlo: no molestamos
    and not exists (select 1 from maq_premio_usos u where u.premio_id = p.id and not u.devuelto)
    and public.puede_contactar(p.phone, 'whatsapp')
    -- un solo aviso por premio (de esta o de cualquier automática de premio)
    and not exists (select 1 from message_logs l where l.maq_premio_id = p.id and l.estado <> 'fallo' and coalesce(l.texto, '') <> '[prueba]')
    -- máximo un mensaje de campaña o automática cada 7 días (las pruebas del panel no cuentan)
    and not exists (select 1 from message_logs l where l.phone = p.phone and l.direccion = 'saliente' and l.estado <> 'fallo'
                    and (l.campaign_id is not null or l.automation_id is not null) and coalesce(l.texto, '') <> '[prueba]'
                    and l.created_at > now() - interval '7 days')
  order by p.phone, p.vence_at;
$$;
revoke all on function public.automatica_premio_destinatarios(uuid) from public, anon, authenticated;
grant execute on function public.automatica_premio_destinatarios(uuid) to service_role;

-- para el panel: igual que 051, con "hoy" según el tipo
create or replace function public.automaticas_resumen() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r jsonb := '{}'::jsonb; a record;
begin
  if not public.is_staff() then raise exception 'Solo el equipo puede hacer esto'; end if;
  for a in select id, disparador from marketing_automations loop
    r := r || jsonb_build_object(a.id::text, jsonb_build_object(
      'enviados', (select count(*) from message_logs l where l.automation_id = a.id and l.estado <> 'fallo' and coalesce(l.texto, '') <> '[prueba]'),
      'semana',   (select count(*) from message_logs l where l.automation_id = a.id and l.estado <> 'fallo' and coalesce(l.texto, '') <> '[prueba]' and l.created_at > now() - interval '7 days'),
      'gratis',   (select count(*) from message_logs l where l.automation_id = a.id and l.estado <> 'fallo' and l.texto like '[libre]%'),
      'fallidos', (select count(*) from message_logs l where l.automation_id = a.id and l.estado = 'fallo'),
      'hoy',      case when a.disparador = 'premio' then (select count(*) from public.automatica_premio_destinatarios(a.id))
                       else (select count(*) from public.automatica_destinatarios(a.id)) end));
  end loop;
  return r;
end $$;
revoke all on function public.automaticas_resumen() from public, anon;
grant execute on function public.automaticas_resumen() to authenticated;

-- el tick ahora dice qué tipo corre; sin parámetro sigue siendo el de compras (el cron de 051 no cambia)
drop function if exists public.automaticas_tick();
create or replace function public.automaticas_tick(p_disparador text default 'compra') returns void
language plpgsql security definer set search_path = public as $$
declare v_url text; v_key text;
begin
  if not exists (select 1 from marketing_automations where activa and disparador = p_disparador) then return; end if;
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'push_hook_url' limit 1;
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'push_hook_secret' limit 1;
  if v_url is null or v_key is null then return; end if;
  perform net.http_post(
    url := regexp_replace(v_url, '/push-pedido$', '/whatsapp-automaticas'),
    body := jsonb_build_object('disparador', p_disparador),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-setto-hook', v_key),
    timeout_milliseconds := 8000
  );
exception when others then
  return; -- un envío que falla nunca rompe el cron
end $$;
revoke all on function public.automaticas_tick(text) from public, anon, authenticated;

do $$ begin
  if exists (select 1 from cron.job where jobname = 'setto-automaticas') then perform cron.unschedule('setto-automaticas'); end if;
  perform cron.schedule('setto-automaticas', '0 14 * * *', $c$select public.automaticas_tick('compra')$c$); -- 11 h Argentina
  if exists (select 1 from cron.job where jobname = 'setto-automaticas-premio') then perform cron.unschedule('setto-automaticas-premio'); end if;
  perform cron.schedule('setto-automaticas-premio', '5 13-23 * * *', $c$select public.automaticas_tick('premio')$c$); -- cada hora de 10 a 20 h Argentina
end $$;
