-- 025 · Notificaciones push al cliente (Web Push).
--   El cliente, desde su link de seguimiento, acepta avisos → se guarda la suscripción del navegador por pedido.
--   Cuando el pedido cambia de etapa, se entrega/cancela o el equipo marca que falta algo,
--   un trigger llama a la Edge Function "push-pedido" (pg_net), que manda la notificación.
--   Sin suscripciones para ese pedido, el trigger no hace nada. Nunca frena un cambio del pedido.
--   Todo lo secreto va en Vault: push_hook_url, push_hook_secret, vapid_public_key y vapid_private_key
--   (se cargan aparte con vault.create_secret, nunca en el repo).
-- No borra nada.

create extension if not exists pg_net with schema extensions;

create table if not exists public.push_subs (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  endpoint text not null,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now(),
  unique (order_id, endpoint)
);
alter table public.push_subs enable row level security; -- sin políticas: solo las funciones y la Edge Function la tocan
revoke all on public.push_subs from anon, authenticated;

-- PÚBLICO · avisame de este pedido (desde el link de seguimiento)
create or replace function public.push_suscribir(p_track text, p_endpoint text, p_p256dh text, p_auth text) returns void
language plpgsql security definer set search_path = public as $$
declare o orders%rowtype;
begin
  if coalesce(p_endpoint, '') !~ '^https://' or length(p_endpoint) > 1000 then raise exception 'Suscripción inválida'; end if;
  if coalesce(length(p_p256dh), 0) not between 20 and 200 or coalesce(length(p_auth), 0) not between 8 and 100 then raise exception 'Suscripción inválida'; end if;
  select * into o from orders where track = p_track;
  if not found then raise exception 'No encontramos ese pedido'; end if;
  if o.status <> 'pendiente' then raise exception 'Este pedido ya está cerrado'; end if;
  if (select count(*) from push_subs where order_id = o.id and endpoint <> p_endpoint) >= 5 then raise exception 'Ya hay muchos celulares avisados para este pedido'; end if;
  insert into push_subs (order_id, endpoint, p256dh, auth) values (o.id, p_endpoint, p_p256dh, p_auth)
  on conflict (order_id, endpoint) do update set p256dh = excluded.p256dh, auth = excluded.auth;
end $$;
revoke all on function public.push_suscribir(text, text, text, text) from public;
grant execute on function public.push_suscribir(text, text, text, text) to anon, authenticated;

-- PÚBLICO · dejar de avisar
create or replace function public.push_desuscribir(p_track text, p_endpoint text) returns void
language sql security definer set search_path = public as $$
  delete from push_subs where endpoint = p_endpoint and order_id = (select id from orders where track = p_track);
$$;
revoke all on function public.push_desuscribir(text, text) from public;
grant execute on function public.push_desuscribir(text, text) to anon, authenticated;

-- Solo la Edge Function (service_role) lee las claves de Vault
create or replace function public.push_config() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_object_agg(name, decrypted_secret), '{}'::jsonb) from vault.decrypted_secrets
   where name in ('push_hook_secret', 'vapid_public_key', 'vapid_private_key');
$$;
revoke all on function public.push_config() from public, anon, authenticated;
grant execute on function public.push_config() to service_role;

-- Qué cambió → qué aviso mandar
create or replace function public.push_aviso() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_tipo text; v_url text; v_key text;
begin
  if new.status is distinct from old.status then
    -- si lo canceló el mismo cliente desde el cambio de pedido, no le avisamos
    if new.status = 'cancelado' and new.cambio->>'resolucion' = 'cancelado' and old.cambio->>'estado' = 'esperando' then return new; end if;
    v_tipo := case new.status when 'entregado' then 'entregado' when 'cancelado' then 'cancelado' end;
  elsif new.status = 'pendiente' and new.etapa is distinct from old.etapa then
    v_tipo := case new.etapa when 'preparando' then 'preparando' when 'listo' then 'listo' end;
  elsif new.status = 'pendiente' and new.cambio->>'estado' = 'esperando'
        and (old.cambio is null or old.cambio->>'estado' <> 'esperando' or old.cambio->>'at' is distinct from new.cambio->>'at') then
    v_tipo := 'cambio';
  end if;
  if v_tipo is null or not exists (select 1 from push_subs where order_id = new.id) then return new; end if;

  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'push_hook_url' limit 1;
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'push_hook_secret' limit 1;
  if v_url is null or v_key is null then return new; end if;

  perform net.http_post(
    url := v_url,
    body := jsonb_build_object('order_id', new.id, 'tipo', v_tipo),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-setto-hook', v_key),
    timeout_milliseconds := 8000
  );
  return new;
exception when others then
  return new; -- un aviso que falla nunca frena el pedido
end $$;
revoke all on function public.push_aviso() from public, anon, authenticated;

drop trigger if exists orders_push on public.orders;
create trigger orders_push after update of status, etapa, cambio on public.orders
  for each row execute function public.push_aviso();
