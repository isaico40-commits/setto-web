-- 014 · Reseñas con foto e Instagram (opcionales), compra verificada y estrellas por producto.

alter table public.reviews add column if not exists foto text;
alter table public.reviews add column if not exists instagram text;

-- Fotos de reseñas: cualquiera puede SUBIR (no cambiar ni borrar) imágenes chicas a resenas/r/...
-- Solo se muestran en la web cuando el equipo publica la reseña.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('resenas', 'resenas', true, 3145728, array['image/webp','image/jpeg','image/png'])
on conflict (id) do update set public = true, file_size_limit = 3145728, allowed_mime_types = array['image/webp','image/jpeg','image/png'];
create policy "resenas sube foto" on storage.objects for insert to anon, authenticated
  with check (bucket_id = 'resenas' and name like 'r/%' and lower(name) ~ '\.(webp|jpe?g|png)$');
create policy "resenas staff borra" on storage.objects for delete to authenticated
  using (bucket_id = 'resenas' and public.is_staff());

-- Dejar reseña (v2): + foto + instagram
create or replace function public.create_review_v2(p_code text, p_phone text, p_rating int, p_texto text, p_foto text, p_instagram text) returns void
language plpgsql security definer set search_path = public as $$
declare o orders%rowtype; v_ig text := nullif(regexp_replace(trim(coalesce(p_instagram, '')), '^@+|^https?://(www\.)?instagram\.com/|/$', '', 'g'), '');
begin
  if p_rating is null or p_rating < 1 or p_rating > 5 then raise exception 'Elegí de 1 a 5 estrellas'; end if;
  if length(coalesce(p_texto, '')) > 400 then raise exception 'La reseña puede tener hasta 400 caracteres'; end if;
  if v_ig is not null and v_ig !~ '^[A-Za-z0-9._]{1,30}$' then raise exception 'Revisá tu usuario de Instagram'; end if;
  if p_foto is not null and p_foto !~ '^https://[a-z0-9]+\.supabase\.co/storage/v1/object/public/resenas/r/[A-Za-z0-9._/-]+$' then raise exception 'La foto no es válida'; end if;
  select * into o from orders where code = p_code and phone = public.norm_phone(p_phone) and status = 'entregado'
     and created_at > now() - interval '14 days' order by created_at desc limit 1;
  if not found then raise exception 'Solo podés dejar reseña de un pedido que ya recibiste'; end if;
  if exists (select 1 from reviews where order_id = o.id) then raise exception 'Ya dejaste una reseña de este pedido. ¡Gracias!'; end if;
  insert into reviews (order_id, phone, nombre, rating, texto, foto, instagram)
  values (o.id, o.phone, o.nombre, p_rating, nullif(trim(coalesce(p_texto, '')), ''), p_foto, lower(v_ig));
end $$;
revoke all on function public.create_review_v2(text,text,int,text,text,text) from public;
grant execute on function public.create_review_v2(text,text,int,text,text,text) to anon, authenticated;

-- Reseñas públicas: + foto, instagram, fecha y qué pidió (compra verificada)
create or replace function public.public_reviews() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'promedio', (select round(avg(rating)::numeric, 1) from reviews where estado = 'aprobada'),
    'cantidad', (select count(*) from reviews where estado = 'aprobada'),
    'items', coalesce((select jsonb_agg(x order by x->>'fecha' desc) from (
        select jsonb_build_object(
                 'nombre', split_part(initcap(trim(r.nombre)), ' ', 1)
                   || case when split_part(trim(r.nombre), ' ', 2) <> '' then ' ' || upper(left(split_part(trim(r.nombre), ' ', 2), 1)) || '.' else '' end,
                 'rating', r.rating, 'texto', r.texto, 'foto', r.foto, 'instagram', r.instagram, 'fecha', r.created_at,
                 'pedido', (select jsonb_agg(distinct i->>'nombre') from jsonb_array_elements(o.items) i where i->>'id' not in ('envio','premio'))) x
          from reviews r join orders o on o.id = r.order_id
         where r.estado = 'aprobada' and (r.texto is not null or r.foto is not null)
         order by r.created_at desc limit 12) t), '[]'::jsonb))
$$;

-- Estrellas por producto (reseñas publicadas de pedidos que lo incluían)
create or replace function public.product_ratings() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_object_agg(pid, jsonb_build_object('promedio', prom, 'cantidad', n)), '{}'::jsonb) from (
    select i->>'id' as pid, round(avg(r.rating)::numeric, 1) as prom, count(distinct r.id) as n
      from reviews r join orders o on o.id = r.order_id
      cross join lateral jsonb_array_elements(o.items) i
     where r.estado = 'aprobada' and i->>'id' not in ('envio','premio')
     group by i->>'id') t
$$;
revoke all on function public.product_ratings() from public;
grant execute on function public.product_ratings() to anon, authenticated;
