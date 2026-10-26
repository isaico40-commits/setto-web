-- 045 · Sello de regalo por la reseña de la PRIMERA compra en la web.
--   Reglas (anti-abuso):
--   · Solo el primer pedido web de cada celular (los cancelados no cuentan como "anterior").
--   · Una sola vez por celular: tabla sellos_resena con el celular como clave.
--   · Solo cuando el pedido figura ENTREGADO y la reseña tiene comentario (10+ letras) o foto.
--     Si la reseña se deja con el pedido "listo", el sello se suma al marcarlo entregado.
--   · Si la reseña está oculta por el equipo, no suma.
--   · Se apaga con settings.club.sello_resena = false (o apagando el Club).
--   No borra nada. Suma columnas, una tabla, una función y dos triggers; reemplaza get_order_status
--   y track_status con la misma firma (agregan 'primera' y 'sello_resena').

-- 1) ¿Es la primera compra web de ese celular? Se guarda al crear el pedido.
alter table public.orders add column if not exists primera_compra boolean not null default false;

create table if not exists public.sellos_resena (
  phone      text primary key,
  order_id   uuid not null unique references public.orders(id) on delete cascade,
  review_id  uuid references public.reviews(id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.sellos_resena enable row level security;
drop policy if exists sellos_resena_staff_lee on public.sellos_resena;
create policy sellos_resena_staff_lee on public.sellos_resena for select to authenticated using (public.is_staff());

-- pedidos que ya existen: primera = no hay otro pedido no cancelado anterior del mismo celular
update public.orders o set primera_compra = not exists (
  select 1 from public.orders p where p.phone = o.phone and p.id <> o.id and p.status <> 'cancelado' and p.created_at < o.created_at)
where o.phone is not null;

create or replace function public.orders_primera() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.primera_compra := new.phone is not null
    and not exists (select 1 from orders p where p.phone = new.phone and p.status <> 'cancelado')
    and not exists (select 1 from sellos_resena s where s.phone = new.phone);
  return new;
end $$;

-- 2) Dar el sello (si corresponde). Devuelve true solo si lo sumó ahora.
create or replace function public.dar_sello_resena(p_order uuid) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  o      orders%rowtype;
  r      reviews%rowtype;
  v_club jsonb := coalesce((select value from settings where key = 'club'), '{}'::jsonb);
begin
  if not coalesce((v_club->>'activo')::boolean, true) or not coalesce((v_club->>'sello_resena')::boolean, true) then return false; end if;
  select * into o from orders where id = p_order;
  if not found or o.status <> 'entregado' or not o.primera_compra or o.phone is null then return false; end if;
  select * into r from reviews where order_id = o.id;
  if not found or r.estado = 'oculta' then return false; end if;
  if length(trim(coalesce(r.texto, ''))) < 10 and r.foto is null then return false; end if;
  -- por si el equipo corrigió el celular al entregar: tiene que seguir siendo su primer pedido
  if exists (select 1 from orders p where p.phone = o.phone and p.id <> o.id and p.status <> 'cancelado' and p.created_at < o.created_at) then return false; end if;

  insert into sellos_resena (phone, order_id, review_id) values (o.phone, o.id, r.id) on conflict do nothing;
  if not found then return false; end if; -- ese celular (o ese pedido) ya tuvo su sello

  insert into customers (phone, nombre, sellos) values (o.phone, o.nombre, 1)
  on conflict (phone) do update set sellos = customers.sellos + 1, nombre = coalesce(customers.nombre, excluded.nombre), updated_at = now();
  insert into stamp_events (phone, delta, motivo, order_id) values (o.phone, 1, 'Reseña de ' || o.code || ' (primera compra)', o.id);
  return true;
end $$;
revoke all on function public.dar_sello_resena(uuid) from public, anon, authenticated;

-- 3) Se intenta al dejar la reseña y al marcar el pedido entregado. Si algo falla, no frena ni la reseña ni la entrega.
create or replace function public.reviews_sello() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  begin perform public.dar_sello_resena(new.order_id);
  exception when others then raise warning 'sello por reseña: %', sqlerrm; end;
  return null;
end $$;

create or replace function public.orders_sello_resena() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'entregado' and old.status is distinct from 'entregado' then
    begin perform public.dar_sello_resena(new.id);
    exception when others then raise warning 'sello por reseña: %', sqlerrm; end;
  end if;
  return null;
end $$;

-- 4) Seguimiento: + primera (mostrar el aviso) y sello_resena (ya se lo dimos)
create or replace function public.get_order_status(p_codes text[], p_phone text) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('code', code, 'status', status, 'etapa', etapa, 'modo', modo, 'retiro', retiro,
           'total', total, 'created_at', created_at, 'sellos', sellos, 'track', track,
           'cambio', case when cambio is not null then jsonb_build_object('estado', cambio->>'estado', 'resolucion', cambio->>'resolucion') end,
           'resena', exists (select 1 from reviews r where r.order_id = o.id),
           'primera', o.primera_compra and not exists (select 1 from sellos_resena s where s.phone = o.phone and s.order_id <> o.id),
           'sello_resena', exists (select 1 from sellos_resena s where s.order_id = o.id)) order by created_at desc), '[]'::jsonb)
  from (select * from orders where phone = public.norm_phone(p_phone) and code = any(p_codes[1:5])
          and created_at > now() - interval '3 days' order by created_at desc limit 5) o;
$$;

create or replace function public.track_status(p_tracks text[]) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('code', code, 'status', status, 'etapa', etapa, 'modo', modo, 'retiro', retiro,
           'total', total, 'created_at', created_at, 'sellos', sellos, 'track', track, 'phone', phone,
           'cambio', case when cambio is not null then jsonb_build_object('estado', cambio->>'estado', 'resolucion', cambio->>'resolucion') end,
           'resena', exists (select 1 from reviews r where r.order_id = o.id),
           'primera', o.primera_compra and not exists (select 1 from sellos_resena s where s.phone = o.phone and s.order_id <> o.id),
           'sello_resena', exists (select 1 from sellos_resena s where s.order_id = o.id)) order by created_at desc), '[]'::jsonb)
  from (select * from orders where track = any(p_tracks[1:10]) and created_at > now() - interval '14 days') o;
$$;

-- 5) Triggers: cada create trigger se aplica SOLO (junto con otras sentencias se cuelga).
drop trigger if exists orders_primera on public.orders;
create trigger orders_primera before insert on public.orders for each row execute function public.orders_primera();

drop trigger if exists reviews_sello on public.reviews;
create trigger reviews_sello after insert on public.reviews for each row execute function public.reviews_sello();

drop trigger if exists orders_sello_resena on public.orders;
create trigger orders_sello_resena after update of status on public.orders for each row execute function public.orders_sello_resena();
