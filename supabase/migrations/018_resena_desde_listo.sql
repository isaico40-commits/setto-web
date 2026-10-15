-- 018 · Reseña desde el QR del sticker: se puede reseñar un pedido ya entregado
--       o uno que está "listo" (el cliente ya lo tiene en la mano aunque no lo hayan marcado entregado).
--       No borra nada: reemplaza create_review_v2 con la misma firma.
create or replace function public.create_review_v2(p_code text, p_phone text, p_rating int, p_texto text, p_foto text, p_instagram text) returns void
language plpgsql security definer set search_path = public as $$
declare o orders%rowtype; v_ig text := nullif(regexp_replace(trim(coalesce(p_instagram, '')), '^@+|^https?://(www\.)?instagram\.com/|/$', '', 'g'), '');
begin
  if p_rating is null or p_rating < 1 or p_rating > 5 then raise exception 'Elegí de 1 a 5 estrellas'; end if;
  if length(coalesce(p_texto, '')) > 400 then raise exception 'La reseña puede tener hasta 400 caracteres'; end if;
  if v_ig is not null and v_ig !~ '^[A-Za-z0-9._]{1,30}$' then raise exception 'Revisá tu usuario de Instagram'; end if;
  if p_foto is not null and p_foto !~ '^https://[a-z0-9]+\.supabase\.co/storage/v1/object/public/resenas/r/[A-Za-z0-9._/-]+$' then raise exception 'La foto no es válida'; end if;
  select * into o from orders where code = p_code and phone = public.norm_phone(p_phone)
     and (status = 'entregado' or (status = 'pendiente' and etapa = 'listo'))
     and created_at > now() - interval '14 days' order by created_at desc limit 1;
  if not found then raise exception 'Vas a poder dejar tu reseña cuando tu pedido esté listo'; end if;
  if exists (select 1 from reviews where order_id = o.id) then raise exception 'Ya dejaste una reseña de este pedido. ¡Gracias!'; end if;
  insert into reviews (order_id, phone, nombre, rating, texto, foto, instagram)
  values (o.id, o.phone, o.nombre, p_rating, nullif(trim(coalesce(p_texto, '')), ''), p_foto, lower(v_ig));
end $$;
revoke all on function public.create_review_v2(text,text,int,text,text,text) from public;
grant execute on function public.create_review_v2(text,text,int,text,text,text) to anon, authenticated;
