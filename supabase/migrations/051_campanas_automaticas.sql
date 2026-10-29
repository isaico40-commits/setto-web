-- 051 · Campañas automáticas de WhatsApp: una plantilla aprobada que sale sola X días después de la última compra.
--   - marketing_automations: la regla (plantilla, variables, días, segmento) y si está prendida.
--   - message_logs.automation_id: cada mensaje que mandó una automática (para no repetirle a la misma persona).
--   - automatica_destinatarios(): a quién le toca hoy. Mismas reglas de permiso que las campañas (puede_contactar) y además:
--       · una sola vez por compra (si vuelve a comprar, el reloj arranca de nuevo),
--       · nadie recibe dos mensajes de campaña o automática en 7 días,
--       · al prenderla no les escribe a los de compras viejas: solo a quienes cumplen los días desde que se prendió.
--   - automaticas_tick(): la corre pg_cron todos los días a las 11 (Argentina) y llama a la Edge Function whatsapp-automaticas.
--   No borra nada.

create table if not exists public.marketing_automations (
  id           uuid primary key default gen_random_uuid(),
  nombre       text not null,
  segmento     text not null default 'todos' check (segmento in ('nuevos','recurrentes','fans_mochis','bebidas','inactivos','todos')),
  plantilla    text not null,
  idioma       text not null default 'es_AR',
  variables    jsonb not null default '[]'::jsonb, -- igual que en marketing_campaigns: "{nombre}" = nombre del cliente
  dias         integer not null check (dias between 1 and 365), -- días desde la última compra entregada
  activa       boolean not null default false,
  activa_desde timestamptz,                         -- se pone sola al prenderla
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

alter table public.message_logs add column if not exists automation_id uuid references public.marketing_automations(id) on delete set null;
create index if not exists message_logs_automation on public.message_logs(automation_id, phone);

-- al prenderla arranca el reloj: así no le escribe de golpe a todos los que compraron hace tiempo
create or replace function public.marketing_automations_touch() returns trigger
language plpgsql set search_path = public as $$
begin
  new.updated_at := now();
  if new.activa and (tg_op = 'INSERT' or not old.activa) then new.activa_desde := now(); end if;
  return new;
end $$;
drop trigger if exists marketing_automations_touch on public.marketing_automations;
create trigger marketing_automations_touch before insert or update on public.marketing_automations
  for each row execute function public.marketing_automations_touch();

-- el equipo las arma, prende, pausa y borra desde el panel; el envío lo hace la Edge Function
alter table public.marketing_automations enable row level security;
drop policy if exists marketing_automations_staff on public.marketing_automations;
create policy marketing_automations_staff on public.marketing_automations for all to authenticated
  using (public.is_staff()) with check (public.is_staff());
revoke all on public.marketing_automations from anon;
grant select, insert, update, delete on public.marketing_automations to authenticated;

-- a quién le toca hoy una automática (solo con permiso de WhatsApp vigente)
create or replace function public.automatica_destinatarios(p_id uuid)
returns table (phone text, nombre text)
language sql stable security definer set search_path = public as $$
  select c.phone, c.nombre
  from marketing_automations a
  join public.segmento_clientes(a.segmento, 'whatsapp') c on true
  join crm_clientes k on k.phone = c.phone
  where a.id = p_id
    and k.ultima_compra + make_interval(days => a.dias) <= now()
    -- solo los que cumplen desde que se prendió (con 3 días de margen por si el cron no corrió algún día)
    and k.ultima_compra + make_interval(days => a.dias) > greatest(coalesce(a.activa_desde, now()) - interval '1 day', now() - interval '3 days')
    -- una vez por compra
    and not exists (select 1 from message_logs l where l.automation_id = a.id and l.phone = c.phone and l.estado <> 'fallo' and coalesce(l.texto, '') <> '[prueba]'
                    and l.created_at > k.ultima_compra)
    -- máximo un mensaje de campaña o automática cada 7 días (las pruebas del panel no cuentan)
    and not exists (select 1 from message_logs l where l.phone = c.phone and l.direccion = 'saliente' and l.estado <> 'fallo'
                    and (l.campaign_id is not null or l.automation_id is not null) and coalesce(l.texto, '') <> '[prueba]'
                    and l.created_at > now() - interval '7 days');
$$;
revoke all on function public.automatica_destinatarios(uuid) from public, anon, authenticated;
grant execute on function public.automatica_destinatarios(uuid) to service_role;

-- para el panel: cuántos mandó cada una y a cuántos les tocaría si saliera ahora
create or replace function public.automaticas_resumen() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r jsonb := '{}'::jsonb; a record;
begin
  if not public.is_staff() then raise exception 'Solo el equipo puede hacer esto'; end if;
  for a in select id from marketing_automations loop
    r := r || jsonb_build_object(a.id::text, jsonb_build_object(
      'enviados', (select count(*) from message_logs l where l.automation_id = a.id and l.estado <> 'fallo' and coalesce(l.texto, '') <> '[prueba]'),
      'semana',   (select count(*) from message_logs l where l.automation_id = a.id and l.estado <> 'fallo' and coalesce(l.texto, '') <> '[prueba]' and l.created_at > now() - interval '7 days'),
      'fallidos', (select count(*) from message_logs l where l.automation_id = a.id and l.estado = 'fallo'),
      'hoy',      (select count(*) from public.automatica_destinatarios(a.id))));
  end loop;
  return r;
end $$;
revoke all on function public.automaticas_resumen() from public, anon;
grant execute on function public.automaticas_resumen() to authenticated;

-- todos los días: si hay alguna prendida, avisa a la Edge Function (misma URL base y clave que push-pedido, en Vault)
create or replace function public.automaticas_tick() returns void
language plpgsql security definer set search_path = public as $$
declare v_url text; v_key text;
begin
  if not exists (select 1 from marketing_automations where activa) then return; end if;
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'push_hook_url' limit 1;
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'push_hook_secret' limit 1;
  if v_url is null or v_key is null then return; end if;
  perform net.http_post(
    url := regexp_replace(v_url, '/push-pedido$', '/whatsapp-automaticas'),
    body := '{}'::jsonb,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-setto-hook', v_key),
    timeout_milliseconds := 8000
  );
exception when others then
  return; -- un envío que falla nunca rompe el cron
end $$;
revoke all on function public.automaticas_tick() from public, anon, authenticated;

create extension if not exists pg_cron;
do $$ begin
  if exists (select 1 from cron.job where jobname = 'setto-automaticas') then perform cron.unschedule('setto-automaticas'); end if;
  perform cron.schedule('setto-automaticas', '0 14 * * *', 'select public.automaticas_tick()'); -- 14 UTC = 11 h en Argentina
end $$;
