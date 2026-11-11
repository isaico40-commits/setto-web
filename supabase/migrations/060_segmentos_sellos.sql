-- 060 · Campañas y automáticas según los sellos del Setto Club.
--   Dos segmentos nuevos (siempre solo con permiso del canal, como los demás):
--     · cerca_premio: le faltan 1 o 2 sellos para completar la tarjeta.
--     · premio_listo: ya completó la tarjeta y todavía no canjeó el premio.
--   La meta sale de Ajustes → Club (settings.club.meta, 8 si no está).
--   En los textos: {sellos} (cuántos tiene), {faltan} (cuántos le faltan) y {meta} (de cuántos es la tarjeta) — _shared/cliente.ts.
--   No borra nada.

create or replace function public.club_meta() returns integer
language sql stable security definer set search_path = public as $$
  select greatest(1, coalesce((select (value->>'meta')::int from settings where key = 'club'), 8));
$$;
revoke all on function public.club_meta() from public, anon;
grant execute on function public.club_meta() to authenticated, service_role;

alter table public.marketing_campaigns drop constraint if exists marketing_campaigns_segmento_check;
alter table public.marketing_campaigns add constraint marketing_campaigns_segmento_check
  check (segmento in ('nuevos','recurrentes','fans_mochis','bebidas','inactivos','todos','cerca_premio','premio_listo'));
alter table public.marketing_automations drop constraint if exists marketing_automations_segmento_check;
alter table public.marketing_automations add constraint marketing_automations_segmento_check
  check (segmento in ('nuevos','recurrentes','fans_mochis','bebidas','inactivos','todos','cerca_premio','premio_listo'));

create or replace function public.segmento_clientes(p_segmento text, p_canal text)
returns table (phone text, nombre text)
language sql stable security definer set search_path = public as $$
  select c.phone, c.nombre from crm_clientes c
  where public.puede_contactar(c.phone, p_canal)
    and case p_segmento
      when 'nuevos'       then c.compras = 1
      when 'recurrentes'  then c.compras >= 3
      when 'fans_mochis'  then c.mochis >= 3 and c.mochis > c.bebidas
      when 'bebidas'      then c.bebidas > 0
      when 'inactivos'    then c.ultima_compra < now() - interval '45 days'
      when 'cerca_premio' then coalesce(c.sellos, 0) between public.club_meta() - 2 and public.club_meta() - 1 and coalesce(c.sellos, 0) > 0
      when 'premio_listo' then coalesce(c.sellos, 0) >= public.club_meta()
      when 'todos'        then true
      else false end;
$$;
revoke all on function public.segmento_clientes(text,text) from public, anon, authenticated;
grant execute on function public.segmento_clientes(text,text) to service_role;

create or replace function public.segmentos_resumen() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r jsonb := '{}'::jsonb; s text;
begin
  if not public.is_staff() then raise exception 'Solo el equipo puede hacer esto'; end if;
  foreach s in array array['nuevos','recurrentes','fans_mochis','bebidas','inactivos','cerca_premio','premio_listo','todos'] loop
    r := r || jsonb_build_object(s, jsonb_build_object(
      'whatsapp', (select count(*) from public.segmento_clientes(s, 'whatsapp')),
      'meta_ads', (select count(*) from public.segmento_clientes(s, 'meta_ads'))));
  end loop;
  return r || jsonb_build_object('clientes', (select count(*) from customers));
end $$;
revoke all on function public.segmentos_resumen() from public, anon;
grant execute on function public.segmentos_resumen() to authenticated;
