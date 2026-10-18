-- 027 · Avisos push al equipo (lado del dueño).
--   Desde el panel, quien toca "Activar avisos" guarda la suscripción de ese navegador (solo usuarios del equipo).
--   Llega una notificación cuando: entra un pedido nuevo, piden una gift card, el cliente resuelve un cambio
--   (eligió reemplazo o canceló) o dejan una reseña para aprobar. Los cambios de estado que hace el equipo no avisan.
--   Reusa la Edge Function push-pedido (tipo "equipo") y las claves de Vault de la migración 025.
--   Sin nadie suscripto, los triggers no hacen nada. Nunca frenan un pedido, una gift card ni una reseña.
-- No borra nada.

create table if not exists public.staff_push_subs (
  endpoint text primary key,
  user_id uuid not null references public.staff(user_id) on delete cascade,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);
alter table public.staff_push_subs enable row level security; -- sin políticas: solo las funciones y la Edge Function
revoke all on public.staff_push_subs from anon, authenticated;

-- EQUIPO · activar avisos en este navegador
create or replace function public.staff_push_suscribir(p_endpoint text, p_p256dh text, p_auth text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_staff() then raise exception 'Solo el equipo'; end if;
  if coalesce(p_endpoint, '') !~ '^https://' or length(p_endpoint) > 1000 then raise exception 'Suscripción inválida'; end if;
  if coalesce(length(p_p256dh), 0) not between 20 and 200 or coalesce(length(p_auth), 0) not between 8 and 100 then raise exception 'Suscripción inválida'; end if;
  if (select count(*) from staff_push_subs where user_id = auth.uid() and endpoint <> p_endpoint) >= 10 then raise exception 'Ya tenés muchos dispositivos con avisos'; end if;
  insert into staff_push_subs (endpoint, user_id, p256dh, auth) values (p_endpoint, auth.uid(), p_p256dh, p_auth)
  on conflict (endpoint) do update set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth;
end $$;
revoke all on function public.staff_push_suscribir(text, text, text) from public, anon;
grant execute on function public.staff_push_suscribir(text, text, text) to authenticated;

-- EQUIPO · apagar avisos en este navegador
create or replace function public.staff_push_desuscribir(p_endpoint text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_staff() then raise exception 'Solo el equipo'; end if;
  delete from staff_push_subs where endpoint = p_endpoint;
end $$;
revoke all on function public.staff_push_desuscribir(text) from public, anon;
grant execute on function public.staff_push_desuscribir(text) to authenticated;

-- EQUIPO · ¿este navegador está activado?
create or replace function public.staff_push_activo(p_endpoint text) returns boolean
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_staff() then raise exception 'Solo el equipo'; end if;
  return exists (select 1 from staff_push_subs where endpoint = p_endpoint);
end $$;
revoke all on function public.staff_push_activo(text) from public, anon;
grant execute on function public.staff_push_activo(text) to authenticated;

-- interno · llama a la Edge Function con qué pasó
create or replace function public.equipo_avisar(p_evento text, p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_url text; v_key text;
begin
  if not exists (select 1 from staff_push_subs) then return; end if;
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'push_hook_url' limit 1;
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'push_hook_secret' limit 1;
  if v_url is null or v_key is null then return; end if;
  perform net.http_post(
    url := v_url,
    body := jsonb_build_object('tipo', 'equipo', 'evento', p_evento, 'id', p_id),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-setto-hook', v_key),
    timeout_milliseconds := 8000
  );
exception when others then
  return;
end $$;
revoke all on function public.equipo_avisar(text, uuid) from public, anon, authenticated;

-- Qué pasó → qué aviso mandar
create or replace function public.equipo_aviso() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_table_name = 'orders' then
    if tg_op = 'INSERT' then perform public.equipo_avisar('pedido', new.id);
    elsif new.cambio->>'estado' = 'resuelto' and coalesce(old.cambio->>'estado', '') = 'esperando' then
      perform public.equipo_avisar('cambio', new.id);
    end if;
  elsif tg_table_name = 'giftcards' then perform public.equipo_avisar('gift', new.id);
  elsif tg_table_name = 'reviews' then perform public.equipo_avisar('resena', new.id);
  end if;
  return new;
exception when others then
  return new; -- un aviso que falla nunca frena nada
end $$;
revoke all on function public.equipo_aviso() from public, anon, authenticated;

-- Triggers (en producción: crear cada uno solo, con lock_timeout; ver README)
drop trigger if exists orders_equipo_nuevo on public.orders;
create trigger orders_equipo_nuevo after insert on public.orders
  for each row execute function public.equipo_aviso();

drop trigger if exists orders_equipo_cambio on public.orders;
create trigger orders_equipo_cambio after update of cambio on public.orders
  for each row execute function public.equipo_aviso();

drop trigger if exists giftcards_equipo on public.giftcards;
create trigger giftcards_equipo after insert on public.giftcards
  for each row execute function public.equipo_aviso();

drop trigger if exists reviews_equipo on public.reviews;
create trigger reviews_equipo after insert on public.reviews
  for each row execute function public.equipo_aviso();
