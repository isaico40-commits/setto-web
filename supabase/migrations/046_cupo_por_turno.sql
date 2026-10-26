-- 046 · Cupo por turno: cuántos pedidos hay para cada horario de retiro o entrega.
--   La web lo usa para marcar un turno como "alta demanda" cuando llega al tope (settings.retiro.cupoTurno,
--   3 por defecto; 0 = sin límite) y recomendar el turno libre más cercano.
--   Devuelve solo fecha, hora y cantidad: ningún dato del cliente. No borra ni cambia nada existente.
--   orders.retiro es el texto que eligió el cliente ("Hoy · 16:00 hs", "Mañana · 10:30 hs", "miércoles 28 · 12:00 hs"),
--   relativo al día en que se hizo el pedido; acá se pasa a fecha real (hora de Argentina).
create or replace function public.turnos_ocupados()
returns jsonb language sql stable security definer set search_path = public as $$
  with o as (
    select (created_at at time zone 'America/Argentina/Buenos_Aires')::date as base,
           lpad(substring(retiro from '(\d{1,2}:\d{2}) hs$'), 5, '0') as h,
           split_part(retiro, ' · ', 1) as dia
    from orders
    where status <> 'cancelado' and created_at > now() - interval '4 days' and retiro ~ ' · \d{1,2}:\d{2} hs$'
  ), d as (
    select h, case when dia = 'Hoy' then base when dia = 'Mañana' then base + 1
      else (select g::date from generate_series(base, base + 6, interval '1 day') g
            where extract(day from g) = nullif(substring(dia from '(\d+)$'), '')::int order by g limit 1) end as f
    from o
  )
  select coalesce(jsonb_agg(jsonb_build_object('f', f, 'h', h, 'n', n) order by f, h), '[]'::jsonb)
  from (select f, h, count(*)::int as n from d
        where f >= (now() at time zone 'America/Argentina/Buenos_Aires')::date group by f, h) x;
$$;
revoke all on function public.turnos_ocupados() from public;
grant execute on function public.turnos_ocupados() to anon, authenticated;
