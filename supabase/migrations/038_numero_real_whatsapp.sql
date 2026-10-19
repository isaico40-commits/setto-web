-- 038 · Número real de WhatsApp del pedido.
--   Si el cliente tipea mal su celular en la web, igual nos manda el pedido desde su WhatsApp. El mensaje trae el link
--   de seguimiento (?seguir=<track>, secreto), así que el webhook encuentra el pedido aunque el número no coincida y guarda
--   el número desde el que escribió en orders.wa_phone. Los avisos del pedido salen a ese número.
--   En el panel aparece el aviso con un botón para usar ese número también para los sellos (usar_numero_wa).
-- No borra nada.

alter table public.orders add column if not exists wa_phone text;

-- EQUIPO · pasar el pedido al número desde el que escribió (los sellos van a ese número al entregar)
create or replace function public.usar_numero_wa(p_id uuid) returns text
language plpgsql security definer set search_path = public as $$
declare v text;
begin
  if not public.is_staff() then raise exception 'Solo el equipo puede hacer esto'; end if;
  update orders set phone = wa_phone, wa_phone = null
   where id = p_id and status = 'pendiente' and wa_phone is not null
  returning phone into v;
  if v is null then raise exception 'El pedido ya no está pendiente o no tiene otro número'; end if;
  return v;
end $$;
revoke all on function public.usar_numero_wa(uuid) from public, anon;
grant execute on function public.usar_numero_wa(uuid) to authenticated;
