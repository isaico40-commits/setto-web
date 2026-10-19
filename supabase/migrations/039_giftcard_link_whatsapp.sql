-- 039 · Link de la gift card por WhatsApp (automático).
--   Cuando el equipo toca "Pago recibido" (la gift card pasa de pendiente a activa), el trigger giftcards_wa llama a la
--   Edge Function whatsapp-pedido, que le manda al comprador el link para compartirle el regalo, con el texto de
--   Panel → Ajustes → Mensajes ("Gift card activada"). Es un mensaje de la compra (no publicidad): no depende del permiso
--   de novedades. Solo sale dentro de las 24 h desde el último mensaje del comprador (nos escribe al reservarla desde la
--   web); si no, el panel sigue mostrando el botón para mandarlo a mano. Marca giftcards.link_wa_at.
--   Se apaga junto con los avisos del pedido: settings 'wa_avisos' = {"activo": false}. No borra nada.

alter table public.giftcards add column if not exists link_wa_at timestamptz;

create or replace function public.giftcards_wa() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_url text; v_key text;
begin
  if not (old.estado = 'pendiente' and new.estado = 'activa') or new.link_wa_at is not null then return new; end if;
  if coalesce(((select value from settings where key = 'wa_avisos')->>'activo')::boolean, true) = false then return new; end if;
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'push_hook_url' limit 1;
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'push_hook_secret' limit 1;
  if v_url is null or v_key is null then return new; end if;
  perform net.http_post(
    url := regexp_replace(v_url, '/push-pedido$', '/whatsapp-pedido'),
    body := jsonb_build_object('giftcard_id', new.id),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-setto-hook', v_key),
    timeout_milliseconds := 15000
  );
  return new;
exception when others then
  return new; -- un aviso que falla nunca frena la activación
end $$;
revoke all on function public.giftcards_wa() from public, anon, authenticated;

-- (correr este create trigger solo, con lock_timeout: junto con otras sentencias se cuelga)
create trigger giftcards_wa after update of estado on public.giftcards
  for each row execute function public.giftcards_wa();
