-- 047 · Alta demanda por turno: un pedido deja de ocupar su turno cuando está listo, entregado o cancelado.
--   Reemplaza turnos_ocupados() (misma firma que la 046): ahora cuenta solo pedidos pendientes que no están "listo".
--   Así, al marcar un pedido como Listo o Entregado en el panel, el turno libera un lugar y la web vuelve a ofrecerlo.
--   Devuelve solo fecha, hora y cantidad: ningún dato del cliente. No borra ni cambia datos.
create or replace function public.turnos_ocupados()
returns jsonb language sql stable security definer set search_path = public as $$
  with o as (
    select (created_at at time zone 'America/Argentina/Buenos_Aires')::date as base,
           lpad(substring(retiro from '(\d{1,2}:\d{2}) hs$'), 5, '0') as h,
           split_part(retiro, ' · ', 1) as dia
    from orders
    where status = 'pendiente' and coalesce(etapa, 'recibido') <> 'listo'
      and created_at > now() - interval '4 days' and retiro ~ ' · \d{1,2}:\d{2} hs$'
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
