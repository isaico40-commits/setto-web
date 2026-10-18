-- 029 · Estado comercial del pedido, para medir bien en Meta (P0 del CRM).
--   Antes: Purchase se mandaba al crear el pedido, antes de que el cliente mandara el WhatsApp.
--   Ahora cada momento queda anotado en el pedido:
--     created_at    → se registró el pedido en la web           (evento propio order_created)
--     contacto_at   → el cliente abrió WhatsApp para mandarlo    (Contact)
--     confirmado_at → el equipo lo pasó a "En preparación"       (order_confirmed)
--     closed_at     → entregado y cobrado                        (Purchase)
--   No borra nada. Los pedidos viejos quedan con contacto_at y confirmado_at vacíos.

alter table public.orders add column if not exists contacto_at timestamptz;
alter table public.orders add column if not exists confirmado_at timestamptz;

-- el cliente avisa que abrió WhatsApp. Solo marca un pedido pendiente cuyo código y celular coinciden, y solo la primera vez.
create or replace function public.marcar_contacto(p_code text, p_phone text) returns void
language sql security definer set search_path = public as $$
  update orders set contacto_at = now()
  where code = p_code and phone = public.norm_phone(p_phone) and status = 'pendiente' and contacto_at is null
    and created_at > now() - interval '2 days';
$$;
revoke all on function public.marcar_contacto(text,text) from public;
grant execute on function public.marcar_contacto(text,text) to anon, authenticated;

-- venta confirmada: la primera vez que el pedido sale de "Recibido" (o se entrega directo)
create or replace function public.orders_confirmado() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.confirmado_at is null and (new.etapa in ('preparando','listo') or new.status = 'entregado') then
    new.confirmado_at := now();
  end if;
  return new;
end $$;
revoke all on function public.orders_confirmado() from public, anon, authenticated;

-- (correr este create trigger solo, con lock_timeout: junto con otras sentencias se cuelga)
create trigger orders_confirmado before update on public.orders
  for each row execute function public.orders_confirmado();
