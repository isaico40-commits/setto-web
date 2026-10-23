-- 041 · Reseñas con orden manual: el equipo elige cuáles se ven primero desde Panel → Reseñas.
--   reviews.orden: 1 = primera, 2 = segunda… Vacío = después de las numeradas, de la más nueva a la más vieja.
--   Mismo orden en la portada, en "Ver todas" y en la ficha de cada producto. No borra nada.

alter table public.reviews add column if not exists orden int check (orden is null or orden between 1 and 999);

-- PÚBLICO · portada (igual que antes, ordenadas por "orden" y después por fecha)
create or replace function public.public_reviews() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'promedio', (select round(avg(rating)::numeric, 1) from reviews where estado = 'aprobada'),
    'cantidad', (select count(*) from reviews where estado = 'aprobada'),
    'items', coalesce((select jsonb_agg(x order by rn) from (
        select jsonb_build_object(
                 'nombre', split_part(initcap(trim(r.nombre)), ' ', 1)
                   || case when split_part(trim(r.nombre), ' ', 2) <> '' then ' ' || upper(left(split_part(trim(r.nombre), ' ', 2), 1)) || '.' else '' end,
                 'rating', r.rating, 'texto', r.texto, 'foto', r.foto, 'instagram', r.instagram, 'fecha', r.created_at,
                 'pedido', (select jsonb_agg(distinct i->>'nombre') from jsonb_array_elements(o.items) i where i->>'id' not in ('envio','premio'))) x,
               row_number() over (order by r.orden nulls last, r.created_at desc) rn
          from reviews r join orders o on o.id = r.order_id
         where r.estado = 'aprobada' and (r.texto is not null or r.foto is not null)
         order by r.orden nulls last, r.created_at desc limit 12) t), '[]'::jsonb))
$$;

-- PÚBLICO · "Ver todas las reseñas"
create or replace function public.public_reviews_all(p_offset int default 0) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'promedio', (select round(avg(rating)::numeric, 1) from reviews where estado = 'aprobada'),
    'cantidad', (select count(*) from reviews where estado = 'aprobada'),
    'por_estrella', (select coalesce(jsonb_object_agg(rating, n), '{}'::jsonb) from (select rating, count(*) n from reviews where estado = 'aprobada' group by rating) d),
    'items', coalesce((select jsonb_agg(x order by rn) from (
        select jsonb_build_object(
                 'nombre', split_part(initcap(trim(r.nombre)), ' ', 1)
                   || case when split_part(trim(r.nombre), ' ', 2) <> '' then ' ' || upper(left(split_part(trim(r.nombre), ' ', 2), 1)) || '.' else '' end,
                 'rating', r.rating, 'texto', r.texto, 'foto', r.foto, 'instagram', r.instagram, 'fecha', r.created_at,
                 'pedido', (select jsonb_agg(distinct i->>'nombre') from jsonb_array_elements(o.items) i where i->>'id' not in ('envio','premio'))) x,
               row_number() over (order by r.orden nulls last, r.created_at desc) rn
          from reviews r join orders o on o.id = r.order_id
         where r.estado = 'aprobada'
         order by r.orden nulls last, r.created_at desc offset greatest(coalesce(p_offset, 0), 0) limit 50) t), '[]'::jsonb))
$$;

-- PÚBLICO · reseñas de un producto
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
    'items', coalesce((select jsonb_agg(x order by rn) from (
        select jsonb_build_object(
                 'nombre', split_part(initcap(trim(rv.nombre)), ' ', 1)
                   || case when split_part(trim(rv.nombre), ' ', 2) <> '' then ' ' || upper(left(split_part(trim(rv.nombre), ' ', 2), 1)) || '.' else '' end,
                 'rating', rv.rating, 'texto', rv.texto, 'foto', rv.foto, 'instagram', rv.instagram, 'fecha', rv.created_at,
                 'pedido', (select jsonb_agg(distinct i->>'nombre') from jsonb_array_elements(rv.items) i where i->>'id' not in ('envio','premio'))) x,
               row_number() over (order by rv.orden nulls last, rv.created_at desc) rn
          from rv order by rv.orden nulls last, rv.created_at desc limit 30) t), '[]'::jsonb));
$$;
