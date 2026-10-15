-- 019 · Reseñas de un producto (para verlas desde la ficha del producto). No borra nada.
create or replace function public.product_reviews(p_id text) returns jsonb
language sql stable security definer set search_path = public as $$
  with rv as (
    select distinct on (r.id) r.*, o.items
      from reviews r join orders o on o.id = r.order_id
      cross join lateral jsonb_array_elements(o.items) i
     where r.estado = 'aprobada' and i->>'id' = p_id
  )
  select jsonb_build_object(
    'promedio', (select round(avg(rating)::numeric, 1) from rv),
    'cantidad', (select count(*) from rv),
    'por_estrella', (select coalesce(jsonb_object_agg(rating, n), '{}'::jsonb) from (select rating, count(*) n from rv group by rating) d),
    'items', coalesce((select jsonb_agg(x order by x->>'fecha' desc) from (
        select jsonb_build_object(
                 'nombre', split_part(initcap(trim(rv.nombre)), ' ', 1)
                   || case when split_part(trim(rv.nombre), ' ', 2) <> '' then ' ' || upper(left(split_part(trim(rv.nombre), ' ', 2), 1)) || '.' else '' end,
                 'rating', rv.rating, 'texto', rv.texto, 'foto', rv.foto, 'instagram', rv.instagram, 'fecha', rv.created_at,
                 'pedido', (select jsonb_agg(distinct i->>'nombre') from jsonb_array_elements(rv.items) i where i->>'id' not in ('envio','premio'))) x
          from rv order by rv.created_at desc limit 30) t), '[]'::jsonb));
$$;
revoke all on function public.product_reviews(text) from public;
grant execute on function public.product_reviews(text) to anon, authenticated;
