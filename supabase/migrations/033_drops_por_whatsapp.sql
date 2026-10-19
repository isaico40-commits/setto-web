-- 033 · Avisos de drops por WhatsApp en vez de notificación push.
--   drop_wa: números que tocaron "Avisame por WhatsApp" en la edición especial. Les llega cada lanzamiento con la
--   plantilla aviso_drop (Edge Function whatsapp-drop). Anotarse acá es permiso solo para ese aviso: no suma a las
--   campañas de novedades (eso sigue saliendo de customer_consents).
--   drop_enviar() ahora avisa por WhatsApp y además por push a quienes ya se habían anotado con el sistema viejo.
--   Quien toca "No quiero más avisos" (o escribe BAJA) sale de la lista desde el webhook.
-- No borra nada.

create table if not exists public.drop_wa (
  phone      text primary key,
  nombre     text not null,
  created_at timestamptz not null default now()
);
alter table public.drop_wa enable row level security; -- sin políticas: solo las funciones y las Edge Functions
revoke all on public.drop_wa from anon, authenticated;

-- PÚBLICO · avisame por WhatsApp
create or replace function public.drop_anotar_wa(p_phone text, p_nombre text) returns void
language plpgsql security definer set search_path = public as $$
declare ph text := public.norm_phone(p_phone); n text := left(btrim(coalesce(p_nombre, '')), 40);
begin
  if ph is null then raise exception 'Revisá el número: código de área + número, por ejemplo 223 347-1277.'; end if;
  if n = '' then raise exception 'Poné tu nombre para el mensaje'; end if;
  if (select count(*) from drop_wa) >= 50000 then raise exception 'No pudimos anotarte, probá más tarde'; end if;
  insert into drop_wa (phone, nombre) values (ph, n)
  on conflict (phone) do update set nombre = excluded.nombre;
end $$;
revoke all on function public.drop_anotar_wa(text, text) from public;
grant execute on function public.drop_anotar_wa(text, text) to anon, authenticated;

-- PÚBLICO · dejar de avisar (no dice si el número estaba anotado)
create or replace function public.drop_desanotar_wa(p_phone text) returns void
language sql security definer set search_path = public as $$
  delete from drop_wa where phone = public.norm_phone(p_phone);
$$;
revoke all on function public.drop_desanotar_wa(text) from public;
grant execute on function public.drop_desanotar_wa(text) to anon, authenticated;

-- interno · avisa por WhatsApp (whatsapp-drop) y por push a los anotados viejos (push-pedido)
create or replace function public.drop_enviar() returns void
language plpgsql security definer set search_path = public as $$
declare v_url text; v_key text;
begin
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'push_hook_url' limit 1;
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'push_hook_secret' limit 1;
  if v_url is null or v_key is null then raise exception 'Faltan las claves de notificaciones en Vault'; end if;
  if exists (select 1 from drop_wa) then
    perform net.http_post(
      url := regexp_replace(v_url, '/push-pedido$', '/whatsapp-drop'),
      body := '{}'::jsonb,
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-setto-hook', v_key),
      timeout_milliseconds := 120000
    );
  end if;
  if exists (select 1 from drop_subs) then
    perform net.http_post(
      url := v_url,
      body := jsonb_build_object('tipo', 'drop'),
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-setto-hook', v_key),
      timeout_milliseconds := 30000
    );
  end if;
end $$;
revoke all on function public.drop_enviar() from public, anon, authenticated;

-- EQUIPO · cuántos están anotados (WhatsApp y push) y si ya se avisó este lanzamiento
create or replace function public.drop_avisos_info() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v jsonb := (select value from settings where key = 'especial'); v_lan timestamptz;
begin
  if not public.is_staff() then raise exception 'Solo el equipo'; end if;
  begin v_lan := nullif(v->>'lanzamiento', '')::timestamptz; exception when others then v_lan := null; end;
  return jsonb_build_object(
    'suscriptos', (select count(*) from drop_wa) + (select count(*) from drop_subs),
    'whatsapp', (select count(*) from drop_wa),
    'push', (select count(*) from drop_subs),
    'avisado', (select enviado_at from drop_avisos where lanzamiento = v_lan));
end $$;
revoke all on function public.drop_avisos_info() from public, anon;
grant execute on function public.drop_avisos_info() to authenticated;

-- EQUIPO · mandar el aviso ahora (botón del panel)
create or replace function public.drop_avisar() returns int
language plpgsql security definer set search_path = public as $$
declare v jsonb := (select value from settings where key = 'especial'); v_lan timestamptz;
        n int := (select count(*) from drop_wa) + (select count(*) from drop_subs);
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

-- CRON · igual que en 026, pero cuenta también a los anotados por WhatsApp
create or replace function public.drop_tick() returns void
language plpgsql security definer set search_path = public as $$
declare v jsonb := (select value from settings where key = 'especial'); v_lan timestamptz;
begin
  if v is null or coalesce(v->>'modo', '') <> 'programado' or coalesce((v->>'avisar_auto')::boolean, true) = false then return; end if;
  v_lan := nullif(v->>'lanzamiento', '')::timestamptz;
  if v_lan is null or v_lan > now() or v_lan < now() - interval '2 hours' then return; end if; -- solo cerca del lanzamiento
  if exists (select 1 from drop_avisos where lanzamiento = v_lan) or not (exists (select 1 from drop_subs) or exists (select 1 from drop_wa)) then return; end if;
  insert into drop_avisos (lanzamiento) values (v_lan);
  perform public.drop_enviar();
exception when others then
  return; -- un aviso que falla nunca rompe el cron
end $$;
revoke all on function public.drop_tick() from public, anon, authenticated;

-- la baja desde la web (privacidad) también saca de los avisos de drops por WhatsApp. Igual que en 030 + esa línea.
create or replace function public.baja_marketing(p_phone text, p_canal text default null) returns void
language plpgsql security definer set search_path = public as $$
declare ph text := public.norm_phone(p_phone); c text;
begin
  if ph is null then raise exception 'Revisá el número: código de área + número, por ejemplo 223 347-1277.'; end if;
  if p_canal is null or p_canal = 'whatsapp' then delete from drop_wa where phone = ph; end if;
  foreach c in array array['whatsapp','meta_ads'] loop
    if (p_canal is null or p_canal = c) and public.puede_contactar(ph, c) then
      insert into customer_consents(phone, canal, finalidad, estado, origen, created_by)
      values (ph, c, case c when 'whatsapp' then 'novedades' else 'publicidad' end, 'revocado',
              case when public.is_staff() then 'panel' else 'preferencias_web' end, auth.uid());
    end if;
  end loop;
end $$;
revoke all on function public.baja_marketing(text,text) from public;
grant execute on function public.baja_marketing(text,text) to anon, authenticated;
