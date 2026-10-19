-- 036 · Avisos del pedido por WhatsApp (automáticos).
--   Cuando el pedido pasa a "en preparación" o "listo/en camino", se entrega, se cancela o el equipo pide un cambio,
--   el trigger orders_wa llama a la Edge Function whatsapp-pedido, que le escribe al cliente con los textos de
--   Panel → Ajustes → Mensajes. El "Recibido" lo manda el webhook apenas llega el mensaje con el pedido.
--   Es un aviso del pedido (no publicidad): no depende del permiso de novedades. Solo sale dentro de las 24 h desde
--   el último mensaje del cliente; si no, el panel sigue mostrando el botón para mandarlo a mano.
--   Para apagarlo: settings 'wa_avisos' = {"activo": false}. No borra nada.

create or replace function public.orders_wa() returns trigger
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
  if v_tipo is null then return new; end if;
  if coalesce(((select value from settings where key = 'wa_avisos')->>'activo')::boolean, true) = false then return new; end if;

  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'push_hook_url' limit 1;
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'push_hook_secret' limit 1;
  if v_url is null or v_key is null then return new; end if;
  perform net.http_post(
    url := regexp_replace(v_url, '/push-pedido$', '/whatsapp-pedido'),
    body := jsonb_build_object('order_id', new.id, 'tipo', v_tipo),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-setto-hook', v_key),
    timeout_milliseconds := 15000
  );
  return new;
exception when others then
  return new; -- un aviso que falla nunca frena el pedido
end $$;
revoke all on function public.orders_wa() from public, anon, authenticated;

-- (correr este create trigger solo, con lock_timeout: junto con otras sentencias se cuelga)
create trigger orders_wa after update of status, etapa, cambio on public.orders
  for each row execute function public.orders_wa();
