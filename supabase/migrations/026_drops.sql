-- 026 · Drops: la edición especial se abre sola en la fecha programada + avisos push de lanzamiento.
--   settings.especial suma: modo ('manual' | 'programado'), lanzamiento y fin (fecha ISO), avisar_auto, push_titulo, push_texto.
--   especial_abierto() decide si hoy se puede pedir la edición especial (misma regla que dropEstado() en js/api.js).
--   Las funciones de pedido dejan de mirar solo "estado" y pasan a usar especial_abierto().
--   drop_subs: navegadores que tocaron "Avisame de los drops". Les llega cada lanzamiento.
--   drop_avisar() lo usa el equipo desde el panel; drop_tick() lo corre pg_cron cada minuto y avisa solo al lanzar.
--   El envío reusa la Edge Function push-pedido (tipo "drop") y las claves de Vault de la migración 025.
-- No borra nada.

-- 1 · ¿Está abierta la edición especial?
create or replace function public.especial_abierto() returns boolean
language plpgsql stable security definer set search_path = public as $$
declare v jsonb := (select value from settings where key = 'especial');
begin
  if v is null then return false; end if;
  if coalesce(v->>'modo', 'manual') <> 'programado' then return coalesce(v->>'estado', '') = 'disponible'; end if;
  if nullif(v->>'lanzamiento', '') is null or now() < (v->>'lanzamiento')::timestamptz then return false; end if;
  if nullif(v->>'fin', '') is not null and now() >= (v->>'fin')::timestamptz then return false; end if;
  return true;
exception when others then
  return false; -- una fecha mal cargada nunca abre la venta
end $$;
grant execute on function public.especial_abierto() to anon, authenticated;

-- 2 · Las funciones de pedido usan esa regla (se reescribe solo esa condición, el resto queda igual)
do $$
declare r record; v_old text := 'coalesce(v_esp->>''estado'','''') <> ''disponible'''; v_def text;
begin
  for r in select p.oid from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
            where ns.nspname = 'public' and p.prokind = 'f' and position(v_old in p.prosrc) > 0
  loop
    v_def := replace(pg_get_functiondef(r.oid), v_old, 'not public.especial_abierto()');
    execute v_def;
  end loop;
end $$;

-- 3 · Quién quiere enterarse de los drops
create table if not exists public.drop_subs (
  endpoint text primary key,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);
alter table public.drop_subs enable row level security; -- sin políticas: solo las funciones y la Edge Function
revoke all on public.drop_subs from anon, authenticated;

-- lanzamientos ya avisados (para no mandar dos veces el mismo)
create table if not exists public.drop_avisos (
  lanzamiento timestamptz primary key,
  enviado_at timestamptz not null default now(),
  manual boolean not null default false
);
alter table public.drop_avisos enable row level security;
revoke all on public.drop_avisos from anon, authenticated;

-- PÚBLICO · avisame de los drops
create or replace function public.drop_suscribir(p_endpoint text, p_p256dh text, p_auth text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(p_endpoint, '') !~ '^https://' or length(p_endpoint) > 1000 then raise exception 'Suscripción inválida'; end if;
  if coalesce(length(p_p256dh), 0) not between 20 and 200 or coalesce(length(p_auth), 0) not between 8 and 100 then raise exception 'Suscripción inválida'; end if;
  if (select count(*) from drop_subs) >= 50000 then raise exception 'No pudimos anotarte, probá más tarde'; end if;
  insert into drop_subs (endpoint, p256dh, auth) values (p_endpoint, p_p256dh, p_auth)
  on conflict (endpoint) do update set p256dh = excluded.p256dh, auth = excluded.auth;
end $$;
revoke all on function public.drop_suscribir(text, text, text) from public;
grant execute on function public.drop_suscribir(text, text, text) to anon, authenticated;

-- PÚBLICO · dejar de avisar
create or replace function public.drop_desuscribir(p_endpoint text) returns void
language sql security definer set search_path = public as $$
  delete from drop_subs where endpoint = p_endpoint;
$$;
revoke all on function public.drop_desuscribir(text) from public;
grant execute on function public.drop_desuscribir(text) to anon, authenticated;

-- interno · llama a la Edge Function
create or replace function public.drop_enviar() returns void
language plpgsql security definer set search_path = public as $$
declare v_url text; v_key text;
begin
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'push_hook_url' limit 1;
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'push_hook_secret' limit 1;
  if v_url is null or v_key is null then raise exception 'Faltan las claves de notificaciones en Vault'; end if;
  perform net.http_post(
    url := v_url,
    body := jsonb_build_object('tipo', 'drop'),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-setto-hook', v_key),
    timeout_milliseconds := 30000
  );
end $$;
revoke all on function public.drop_enviar() from public, anon, authenticated;

-- EQUIPO · cuántos están anotados y si ya se avisó este lanzamiento
create or replace function public.drop_avisos_info() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v jsonb := (select value from settings where key = 'especial'); v_lan timestamptz;
begin
  if not public.is_staff() then raise exception 'Solo el equipo'; end if;
  begin v_lan := nullif(v->>'lanzamiento', '')::timestamptz; exception when others then v_lan := null; end;
  return jsonb_build_object(
    'suscriptos', (select count(*) from drop_subs),
    'avisado', (select enviado_at from drop_avisos where lanzamiento = v_lan));
end $$;
revoke all on function public.drop_avisos_info() from public, anon;
grant execute on function public.drop_avisos_info() to authenticated;

-- EQUIPO · mandar el aviso ahora (botón del panel)
create or replace function public.drop_avisar() returns int
language plpgsql security definer set search_path = public as $$
declare v jsonb := (select value from settings where key = 'especial'); v_lan timestamptz; n int := (select count(*) from drop_subs);
begin
  if not public.is_staff() then raise exception 'Solo el equipo'; end if;
  if n = 0 then raise exception 'Todavía no hay nadie anotado para los avisos'; end if;
  begin v_lan := nullif(v->>'lanzamiento', '')::timestamptz; exception when others then v_lan := null; end;
  perform public.drop_enviar();
  insert into drop_avisos (lanzamiento, manual) values (coalesce(v_lan, now()), true)
  on conflict (lanzamiento) do update set enviado_at = now(), manual = true;
  return n;
end $$;
revoke all on function public.drop_avisar() from public, anon;
grant execute on function public.drop_avisar() to authenticated;

-- CRON · al llegar la hora del lanzamiento, avisa una sola vez (si el aviso automático está prendido)
create or replace function public.drop_tick() returns void
language plpgsql security definer set search_path = public as $$
declare v jsonb := (select value from settings where key = 'especial'); v_lan timestamptz;
begin
  if v is null or coalesce(v->>'modo', '') <> 'programado' or coalesce((v->>'avisar_auto')::boolean, true) = false then return; end if;
  v_lan := nullif(v->>'lanzamiento', '')::timestamptz;
  if v_lan is null or v_lan > now() or v_lan < now() - interval '2 hours' then return; end if; -- solo cerca del lanzamiento
  if exists (select 1 from drop_avisos where lanzamiento = v_lan) or not exists (select 1 from drop_subs) then return; end if;
  insert into drop_avisos (lanzamiento) values (v_lan);
  perform public.drop_enviar();
exception when others then
  return; -- un aviso que falla nunca rompe el cron
end $$;
revoke all on function public.drop_tick() from public, anon, authenticated;

create extension if not exists pg_cron;
do $$ begin
  if exists (select 1 from cron.job where jobname = 'setto-drop-tick') then perform cron.unschedule('setto-drop-tick'); end if;
  perform cron.schedule('setto-drop-tick', '* * * * *', 'select public.drop_tick()');
end $$;
