-- 015 · Link de seguimiento: cada pedido tiene un código secreto (track) para volver a la web
--       desde WhatsApp, en cualquier celular, sin escribir el teléfono.
alter table public.orders add column if not exists track text;
update public.orders set track = replace(gen_random_uuid()::text, '-', '') where track is null;
alter table public.orders alter column track set default replace(gen_random_uuid()::text, '-', '');
alter table public.orders alter column track set not null;
create unique index if not exists orders_track_key on public.orders(track);

-- Estado por código + celular (ahora también devuelve el track)
create or replace function public.get_order_status(p_codes text[], p_phone text) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('code', code, 'status', status, 'etapa', etapa, 'modo', modo, 'retiro', retiro,
           'total', total, 'created_at', created_at, 'sellos', sellos, 'track', track,
           'resena', exists (select 1 from reviews r where r.order_id = o.id)) order by created_at desc), '[]'::jsonb)
  from (select * from orders where phone = public.norm_phone(p_phone) and code = any(p_codes[1:5])
          and created_at > now() - interval '3 days' order by created_at desc limit 5) o;
$$;

-- Estado por link (hasta 10 links, pedidos de los últimos 14 días)
create or replace function public.track_status(p_tracks text[]) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('code', code, 'status', status, 'etapa', etapa, 'modo', modo, 'retiro', retiro,
           'total', total, 'created_at', created_at, 'sellos', sellos, 'track', track, 'phone', phone,
           'resena', exists (select 1 from reviews r where r.order_id = o.id)) order by created_at desc), '[]'::jsonb)
  from (select * from orders where track = any(p_tracks[1:10]) and created_at > now() - interval '14 days') o;
$$;
revoke all on function public.track_status(text[]) from public;
grant execute on function public.track_status(text[]) to anon, authenticated;

-- Reseña desde el link (sin escribir el teléfono)
create or replace function public.create_review_track(p_track text, p_rating int, p_texto text, p_foto text, p_instagram text) returns void
language plpgsql security definer set search_path = public as $$
declare o orders%rowtype;
begin
  select * into o from orders where track = p_track;
  if not found then raise exception 'No encontramos ese pedido'; end if;
  perform public.create_review_v2(o.code, o.phone, p_rating, p_texto, p_foto, p_instagram);
end $$;
revoke all on function public.create_review_track(text,int,text,text,text) from public;
grant execute on function public.create_review_track(text,int,text,text,text) to anon, authenticated;
