-- 050 · Tarea nueva en la caja: avisa a todos los que tienen la 🔔 activa, menos a quien la cargó.
--   Cada dispositivo guarda de quién es (Isa, Alan o Lucas: el mismo nombre que en la caja), porque la cuenta del panel es compartida.
--   Antes no avisaba ninguna tarea de Isa; ahora sí, y la Edge Function push-pedido salta el dispositivo de quien la creó.
--   Un dispositivo sin nombre recibe todo. No crea triggers nuevos (caja_tareas_equipo ya existe). No borra nada.

alter table public.staff_push_subs add column if not exists quien text;

-- EQUIPO · activar avisos en este navegador, diciendo de quién es (la versión de 3 datos de la 027 sigue andando)
create or replace function public.staff_push_suscribir(p_endpoint text, p_p256dh text, p_auth text, p_quien text) returns void
language plpgsql security definer set search_path = public as $$
declare v_quien text := nullif(trim(coalesce(p_quien, '')), '');
begin
  if not public.is_staff() then raise exception 'Solo el equipo'; end if;
  if coalesce(p_endpoint, '') !~ '^https://' or length(p_endpoint) > 1000 then raise exception 'Suscripción inválida'; end if;
  if coalesce(length(p_p256dh), 0) not between 20 and 200 or coalesce(length(p_auth), 0) not between 8 and 100 then raise exception 'Suscripción inválida'; end if;
  if v_quien is not null and not exists (select 1 from caja_socios where nombre = v_quien) then raise exception 'Elegí quién sos'; end if;
  if (select count(*) from staff_push_subs where user_id = auth.uid() and endpoint <> p_endpoint) >= 10 then raise exception 'Ya tenés muchos dispositivos con avisos'; end if;
  insert into staff_push_subs (endpoint, user_id, p256dh, auth, quien) values (p_endpoint, auth.uid(), p_p256dh, p_auth, v_quien)
  on conflict (endpoint) do update set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth, quien = excluded.quien;
end $$;
revoke all on function public.staff_push_suscribir(text, text, text, text) from public, anon;
grant execute on function public.staff_push_suscribir(text, text, text, text) to authenticated;

-- EQUIPO · ¿este navegador está activado y de quién es? null = apagado, '' = activado sin nombre
create or replace function public.staff_push_quien(p_endpoint text) returns text
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_staff() then raise exception 'Solo el equipo'; end if;
  return (select coalesce(quien, '') from staff_push_subs where endpoint = p_endpoint);
end $$;
revoke all on function public.staff_push_quien(text) from public, anon;
grant execute on function public.staff_push_quien(text) to authenticated;

-- Qué pasó → qué aviso mandar (igual que la 028, pero las tareas avisan sin importar quién las cargó)
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
  elsif tg_table_name = 'caja_tareas' then
    if new.legacy_id is null then perform public.equipo_avisar('tarea', new.id); end if;
  end if;
  return new;
exception when others then
  return new; -- un aviso que falla nunca frena nada
end $$;
revoke all on function public.equipo_aviso() from public, anon, authenticated;
