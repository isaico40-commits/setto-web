-- 011 · Reseñas: solo quien recibió un pedido puede dejar una (una por pedido). El equipo las aprueba antes de publicarlas.
create table if not exists public.reviews (
  id         uuid primary key default gen_random_uuid(),
  order_id   uuid not null unique references public.orders(id) on delete cascade,
  phone      text not null,
  nombre     text not null,
  rating     int  not null check (rating between 1 and 5),
  texto      text check (texto is null or length(texto) <= 400),
  estado     text not null default 'pendiente' check (estado in ('pendiente','aprobada','oculta')),
  created_at timestamptz not null default now()
);
alter table public.reviews enable row level security;
create policy reviews_staff_all on public.reviews for all to authenticated using (public.is_staff()) with check (public.is_staff());

-- PÚBLICO · dejar reseña: código + celular de un pedido entregado en los últimos 14 días
create or replace function public.create_review(p_code text, p_phone text, p_rating int, p_texto text) returns void
language plpgsql security definer set search_path = public as $$
declare o orders%rowtype;
begin
  if p_rating is null or p_rating < 1 or p_rating > 5 then raise exception 'Elegí de 1 a 5 estrellas'; end if;
  if length(coalesce(p_texto, '')) > 400 then raise exception 'La reseña puede tener hasta 400 caracteres'; end if;
  select * into o from orders where code = p_code and phone = public.norm_phone(p_phone) and status = 'entregado'
     and created_at > now() - interval '14 days' order by created_at desc limit 1;
  if not found then raise exception 'Solo podés dejar reseña de un pedido que ya recibiste'; end if;
  if exists (select 1 from reviews where order_id = o.id) then raise exception 'Ya dejaste una reseña de este pedido. ¡Gracias!'; end if;
  insert into reviews (order_id, phone, nombre, rating, texto) values (o.id, o.phone, o.nombre, p_rating, nullif(trim(coalesce(p_texto, '')), ''));
end $$;
revoke all on function public.create_review(text,text,int,text) from public;
grant execute on function public.create_review(text,text,int,text) to anon, authenticated;

-- PÚBLICO · reseñas aprobadas (nombre + inicial, sin teléfono)
create or replace function public.public_reviews() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'promedio', (select round(avg(rating)::numeric, 1) from reviews where estado = 'aprobada'),
    'cantidad', (select count(*) from reviews where estado = 'aprobada'),
    'items', coalesce((select jsonb_agg(x order by x->>'fecha' desc) from (
        select jsonb_build_object('nombre', split_part(initcap(trim(nombre)), ' ', 1)
                 || case when split_part(trim(nombre), ' ', 2) <> '' then ' ' || upper(left(split_part(trim(nombre), ' ', 2), 1)) || '.' else '' end,
               'rating', rating, 'texto', texto, 'fecha', created_at) x
          from reviews where estado = 'aprobada' and texto is not null order by created_at desc limit 12) t), '[]'::jsonb))
$$;
revoke all on function public.public_reviews() from public;
grant execute on function public.public_reviews() to anon, authenticated;

-- Seguimiento: avisa si el pedido ya tiene reseña
create or replace function public.get_order_status(p_codes text[], p_phone text) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('code', code, 'status', status, 'etapa', etapa, 'modo', modo, 'retiro', retiro,
           'total', total, 'created_at', created_at, 'sellos', sellos,
           'resena', exists (select 1 from reviews r where r.order_id = o.id)) order by created_at desc), '[]'::jsonb)
  from (select * from orders where phone = public.norm_phone(p_phone) and code = any(p_codes[1:5])
          and created_at > now() - interval '3 days' order by created_at desc limit 5) o;
$$;
