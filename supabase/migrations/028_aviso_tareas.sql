-- 028 · Avisos push al equipo también cuando se carga una tarea en la caja.
--   Reusa equipo_avisar() y la Edge Function push-pedido (evento "tarea"). No avisa las tareas que carga Isa
--   (los avisos son para él y no hace falta avisarle lo que él mismo anotó). No borra nada.

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
    if new.legacy_id is null and new.creada_por <> 'Isa' then perform public.equipo_avisar('tarea', new.id); end if;
  end if;
  return new;
exception when others then
  return new; -- un aviso que falla nunca frena nada
end $$;
revoke all on function public.equipo_aviso() from public, anon, authenticated;

create trigger caja_tareas_equipo after insert on public.caja_tareas
  for each row execute function public.equipo_aviso();
