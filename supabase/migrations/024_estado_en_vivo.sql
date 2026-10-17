-- 024 · Estado en vivo
--   1) El seguimiento del cliente se actualiza solo: cuando cambia el pedido, la base manda un aviso
--      por Realtime Broadcast al canal "pedido-<track>". El aviso no lleva datos: la web vuelve a pedir
--      el estado con track_status, así que nadie ve nada que no pueda ver ya con su link.
--   2) El panel recuerda qué aviso de WhatsApp ya se mandó en cada etapa (orders.avisos), para todo el equipo.

alter table public.orders add column if not exists avisos jsonb not null default '{}'::jsonb;

create or replace function public.marcar_aviso(p_id uuid, p_etapa text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_staff() then raise exception 'Solo el equipo puede hacer esto'; end if;
  if p_etapa not in ('recibido','preparando','listo') then raise exception 'Etapa inválida'; end if;
  update orders set avisos = coalesce(avisos, '{}'::jsonb) || jsonb_build_object(p_etapa, now()) where id = p_id;
end $$;
revoke all on function public.marcar_aviso(uuid,text) from public, anon;
grant execute on function public.marcar_aviso(uuid,text) to authenticated;

create or replace function public.orders_ping_cliente() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.track is not null and (new.etapa is distinct from old.etapa or new.status is distinct from old.status
      or new.cambio is distinct from old.cambio or new.total is distinct from old.total) then
    begin
      perform realtime.send('{}'::jsonb, 'cambio', 'pedido-' || new.track, false);
    exception when others then null; -- si Realtime falla, el pedido se guarda igual (la web tiene respaldo cada 20 s)
    end;
  end if;
  return new;
end $$;

drop trigger if exists orders_ping_cliente on public.orders;
create trigger orders_ping_cliente after update on public.orders
  for each row execute function public.orders_ping_cliente();
