-- 032 · WhatsApp Cloud API, Conversions API y audiencias de Meta (P1 del CRM).
--   - marketing_campaigns: campañas de WhatsApp (segmento + plantilla aprobada por Meta).
--   - message_logs: cada mensaje enviado o recibido, con su estado (enviado, entregado, leído, falló) y respuesta.
--   - marketing_sync_logs: cada envío a Meta (Conversions API y audiencias), con resultado.
--   - audience_members: qué números (cifrados) están hoy en cada público de Meta, para poder sacarlos si se dan de baja.
--   - segmento_clientes(): los segmentos del CRM, siempre filtrados por permiso del canal (puede_contactar).
--   - Trigger orders_capi: al entregar un pedido, avisa a la Edge Function meta-capi para mandar Purchase desde el servidor.
--   Las credenciales de Meta y WhatsApp van en los secretos de las Edge Functions, nunca acá ni en js/config.js.
--   No borra nada.

alter table public.orders add column if not exists capi_at timestamptz; -- Purchase ya mandado por Conversions API

create table if not exists public.marketing_campaigns (
  id          uuid primary key default gen_random_uuid(),
  nombre      text not null,
  canal       text not null default 'whatsapp' check (canal in ('whatsapp')),
  segmento    text not null check (segmento in ('nuevos','recurrentes','fans_mochis','bebidas','inactivos','todos')),
  plantilla   text not null,             -- nombre de la plantilla aprobada en WhatsApp Manager
  idioma      text not null default 'es_AR',
  variables   jsonb not null default '[]'::jsonb, -- valores del cuerpo en orden; "{nombre}" se reemplaza por el nombre del cliente
  estado      text not null default 'borrador' check (estado in ('borrador','enviando','enviada','error')),
  total       integer not null default 0,
  enviados    integer not null default 0,
  fallidos    integer not null default 0,
  created_by  uuid,
  created_at  timestamptz not null default now(),
  enviada_at  timestamptz
);

create table if not exists public.message_logs (
  id          bigserial primary key,
  campaign_id uuid references public.marketing_campaigns(id) on delete set null,
  phone       text not null,
  direccion   text not null default 'saliente' check (direccion in ('saliente','entrante')),
  wamid       text,                      -- ID del mensaje en WhatsApp
  estado      text not null,             -- enviado | entregado | leido | fallo | recibido | baja
  texto       text,                      -- mensajes entrantes (respuesta del cliente)
  error       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists message_logs_wamid on public.message_logs(wamid);
create index if not exists message_logs_phone on public.message_logs(phone, created_at desc);
create index if not exists message_logs_campaign on public.message_logs(campaign_id);

create table if not exists public.marketing_sync_logs (
  id          bigserial primary key,
  tipo        text not null check (tipo in ('capi','audiencia')),
  ref         text,                      -- código de pedido o nombre del público
  estado      text not null check (estado in ('ok','error','omitido')),
  registros   integer not null default 0,
  detalle     text,
  created_at  timestamptz not null default now()
);
create index if not exists marketing_sync_logs_at on public.marketing_sync_logs(created_at desc);

create table if not exists public.audience_members (
  audiencia   text not null,             -- segmento (nombre del público en Meta: "Setto · <segmento>")
  phone_hash  text not null,             -- SHA-256 del celular normalizado; el número no sale de Supabase
  added_at    timestamptz not null default now(),
  primary key (audiencia, phone_hash)
);

-- lectura para el equipo; nadie escribe desde el navegador (lo hacen las Edge Functions con service_role)
do $$ declare t text; begin
  foreach t in array array['marketing_campaigns','message_logs','marketing_sync_logs','audience_members'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_staff_read', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.is_staff())', t || '_staff_read', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('revoke insert, update, delete, truncate on public.%I from authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end $$;
-- el equipo crea campañas en borrador desde el panel; el envío lo hace la Edge Function
drop policy if exists marketing_campaigns_staff_insert on public.marketing_campaigns;
create policy marketing_campaigns_staff_insert on public.marketing_campaigns for insert to authenticated
  with check (public.is_staff() and estado = 'borrador');
grant insert on public.marketing_campaigns to authenticated;

-- Segmentos del CRM. p_canal: 'whatsapp' o 'meta_ads'; solo devuelve clientes con ese permiso vigente.
--   nuevos: 1 compra entregada · recurrentes: 3 o más · fans_mochis: 3+ mochis y más mochis que bebidas
--   bebidas: compró dirtys o matcha · inactivos: última compra hace más de 45 días · todos: cualquiera con permiso
create or replace function public.segmento_clientes(p_segmento text, p_canal text)
returns table (phone text, nombre text)
language sql stable security definer set search_path = public as $$
  select c.phone, c.nombre from crm_clientes c
  where public.puede_contactar(c.phone, p_canal)
    and case p_segmento
      when 'nuevos'      then c.compras = 1
      when 'recurrentes' then c.compras >= 3
      when 'fans_mochis' then c.mochis >= 3 and c.mochis > c.bebidas
      when 'bebidas'     then c.bebidas > 0
      when 'inactivos'   then c.ultima_compra < now() - interval '45 days'
      when 'todos'       then true
      else false end;
$$;
revoke all on function public.segmento_clientes(text,text) from public, anon, authenticated;
grant execute on function public.segmento_clientes(text,text) to service_role;

-- cantidades para el panel: cuántos hay en cada segmento y cuántos aceptaron cada canal
create or replace function public.segmentos_resumen() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r jsonb := '{}'::jsonb; s text;
begin
  if not public.is_staff() then raise exception 'Solo el equipo puede hacer esto'; end if;
  foreach s in array array['nuevos','recurrentes','fans_mochis','bebidas','inactivos','todos'] loop
    r := r || jsonb_build_object(s, jsonb_build_object(
      'whatsapp', (select count(*) from public.segmento_clientes(s, 'whatsapp')),
      'meta_ads', (select count(*) from public.segmento_clientes(s, 'meta_ads'))));
  end loop;
  return r || jsonb_build_object('clientes', (select count(*) from customers));
end $$;
revoke all on function public.segmentos_resumen() from public, anon;
grant execute on function public.segmentos_resumen() to authenticated;

-- al entregar: Purchase por Conversions API (Edge Function meta-capi). Usa la misma URL base y clave que push-pedido.
create or replace function public.orders_capi() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_url text; v_key text;
begin
  if new.status = 'entregado' and old.status is distinct from 'entregado' and new.capi_at is null then
    select decrypted_secret into v_url from vault.decrypted_secrets where name = 'push_hook_url' limit 1;
    select decrypted_secret into v_key from vault.decrypted_secrets where name = 'push_hook_secret' limit 1;
    if v_url is null or v_key is null then return new; end if;
    perform net.http_post(
      url := regexp_replace(v_url, '/push-pedido$', '/meta-capi'),
      body := jsonb_build_object('order_id', new.id),
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-setto-hook', v_key),
      timeout_milliseconds := 8000
    );
  end if;
  return new;
exception when others then
  return new; -- medir nunca frena una entrega
end $$;
revoke all on function public.orders_capi() from public, anon, authenticated;

-- (correr este create trigger solo, con lock_timeout: junto con otras sentencias se cuelga)
create trigger orders_capi after update of status on public.orders
  for each row execute function public.orders_capi();
