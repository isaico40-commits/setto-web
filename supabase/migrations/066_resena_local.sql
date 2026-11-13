-- 066 · Reseña desde el ticket del Local, con el sello de regalo de la primera compra (como en la web).
--   - Cada comanda tiene un código corto (comandas.resena_code). El ticket del cliente lo imprime como QR:
--     setto.com.ar/listo?local=<código> → /listo muestra la compra y el formulario de reseña.
--   - Se puede reseñar una comanda COBRADA y no anulada, hasta 14 días después. Una reseña por comanda.
--   - Se pide el celular. Si la comanda ya tenía celular (Club en el mostrador, 065), tiene que ser el mismo.
--     Si no tenía, queda anotado en la comanda y suma el sello de esa compra (trigger comandas_club de la 065).
--   - Sello de regalo por la reseña: mismas reglas que la 045 (Club activo, club.sello_resena, comentario de 10+ letras
--     o foto, reseña no oculta, una sola vez por celular en sellos_resena). "Primera compra" = ese celular no tiene
--     pedidos web ni comandas cobradas anteriores.
--   - reviews.order_id pasa a ser opcional y se suma reviews.comanda_id. Las funciones públicas de reseñas
--     (portada, "Ver todas", ficha y estrellas por producto) leen los productos del pedido web o de la comanda.
--   Requiere la 065. Se puede correr más de una vez. No borra nada.

-- ---------- código corto por comanda ----------
create or replace function public.local_codigo_resena() returns text
language plpgsql volatile set search_path = public as $$
declare a text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; c text; i int;
begin
  loop
    c := '';
    for i in 1..8 loop c := c || substr(a, 1 + floor(random() * length(a))::int, 1); end loop;
    exit when not exists (select 1 from comandas where resena_code = c);
  end loop;
  return c;
end $$;
revoke all on function public.local_codigo_resena() from public, anon, authenticated;

alter table public.comandas add column if not exists resena_code text;
update public.comandas set resena_code = public.local_codigo_resena() where resena_code is null;
alter table public.comandas alter column resena_code set default public.local_codigo_resena();
create unique index if not exists comandas_resena_code_key on public.comandas (resena_code);

-- ---------- reseñas y sellos de regalo pueden venir de una comanda ----------
alter table public.reviews alter column order_id drop not null;
alter table public.reviews add column if not exists comanda_id uuid unique references public.comandas(id) on delete cascade;
do $$ begin
  alter table public.reviews add constraint reviews_origen_chk check (order_id is not null or comanda_id is not null);
exception when duplicate_object then null; end $$;

alter table public.sellos_resena alter column order_id drop not null;
alter table public.sellos_resena add column if not exists comanda_id uuid unique references public.comandas(id) on delete cascade;

-- ---------- PÚBLICO · qué compra es (sin datos personales) ----------
create or replace function public.local_resena_ver(p_code text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare c comandas%rowtype; v_club jsonb := coalesce((select value from settings where key = 'club'), '{}'::jsonb);
begin
  select * into c from comandas where resena_code = upper(trim(coalesce(p_code, '')));
  if not found then raise exception 'No encontramos esa compra. Revisá el QR del ticket.'; end if;
  return jsonb_build_object(
    'numero', c.numero, 'dia', c.dia,
    'productos', (select coalesce(jsonb_agg(i->>'nombre'), '[]'::jsonb) from jsonb_array_elements(c.items) i),
    'puede', c.pagado and c.estado <> 'anulada' and c.created_at > now() - interval '14 days',
    'vencida', c.created_at <= now() - interval '14 days',
    'resena', exists (select 1 from reviews where comanda_id = c.id),
    'sello_resena', exists (select 1 from sellos_resena where comanda_id = c.id),
    'con_celular', c.phone is not null,
    'regalo', coalesce((v_club->>'activo')::boolean, true) and coalesce((v_club->>'sello_resena')::boolean, true));
end $$;
revoke all on function public.local_resena_ver(text) from public;
grant execute on function public.local_resena_ver(text) to anon, authenticated;

-- ---------- sello de regalo (interno) ----------
create or replace function public.dar_sello_resena_local(p_comanda uuid) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  c comandas%rowtype; r reviews%rowtype;
  v_club jsonb := coalesce((select value from settings where key = 'club'), '{}'::jsonb);
begin
  if not coalesce((v_club->>'activo')::boolean, true) or not coalesce((v_club->>'sello_resena')::boolean, true) then return false; end if;
  select * into c from comandas where id = p_comanda;
  if not found or not c.pagado or c.estado = 'anulada' then return false; end if;
  select * into r from reviews where comanda_id = c.id;
  if not found or r.estado = 'oculta' then return false; end if;
  if length(trim(coalesce(r.texto, ''))) < 10 and r.foto is null then return false; end if;
  -- primera compra de ese celular: ni pedidos web ni comandas cobradas antes
  if exists (select 1 from orders o where o.phone = r.phone and o.status <> 'cancelado' and o.created_at < c.created_at)
     or exists (select 1 from comandas x where x.phone = r.phone and x.id <> c.id and x.pagado and x.estado <> 'anulada' and x.created_at < c.created_at)
  then return false; end if;

  insert into sellos_resena (phone, comanda_id, review_id) values (r.phone, c.id, r.id) on conflict do nothing;
  if not found then return false; end if; -- ese celular (o esa comanda) ya tuvo su sello

  insert into customers (phone, nombre, sellos) values (r.phone, r.nombre, 1)
  on conflict (phone) do update set sellos = customers.sellos + 1, nombre = coalesce(customers.nombre, excluded.nombre), updated_at = now();
  insert into stamp_events (phone, delta, motivo) values (r.phone, 1, 'Reseña de Local #' || c.numero || ' (' || to_char(c.dia, 'DD/MM') || ', primera compra)');
  return true;
end $$;
revoke all on function public.dar_sello_resena_local(uuid) from public, anon, authenticated;

-- ---------- PÚBLICO · dejar la reseña ----------
create or replace function public.create_review_local(p_code text, p_phone text, p_rating int, p_texto text, p_foto text, p_instagram text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  c comandas%rowtype;
  v_phone text := public.norm_phone(p_phone);
  v_ig text := nullif(regexp_replace(trim(coalesce(p_instagram, '')), '^@+|^https?://(www\.)?instagram\.com/|/$', '', 'g'), '');
  v_nom text; v_sello boolean := false;
begin
  if p_rating is null or p_rating < 1 or p_rating > 5 then raise exception 'Elegí de 1 a 5 estrellas'; end if;
  if length(coalesce(p_texto, '')) > 400 then raise exception 'La reseña puede tener hasta 400 caracteres'; end if;
  if v_ig is not null and v_ig !~ '^[A-Za-z0-9._]{1,30}$' then raise exception 'Revisá tu usuario de Instagram'; end if;
  if p_foto is not null and p_foto !~ '^https://[a-z0-9]+\.supabase\.co/storage/v1/object/public/resenas/r/[A-Za-z0-9._/-]+$' then raise exception 'La foto no es válida'; end if;
  if v_phone is null then raise exception 'Revisá el celular: código de área + número'; end if;
  select * into c from comandas where resena_code = upper(trim(coalesce(p_code, ''))) for update;
  if not found then raise exception 'No encontramos esa compra. Revisá el QR del ticket.'; end if;
  if c.estado = 'anulada' or not c.pagado then raise exception 'Esta compra no está disponible para reseñar'; end if;
  if c.created_at <= now() - interval '14 days' then raise exception 'Las reseñas se pueden dejar hasta 14 días después de la compra'; end if;
  if c.phone is not null and c.phone <> v_phone then raise exception 'Ese celular no es el que dejaste en el local'; end if;
  if exists (select 1 from reviews where comanda_id = c.id) then raise exception 'Ya dejaste una reseña de esta compra. ¡Gracias!'; end if;

  -- sin celular en el local: queda anotado y suma el sello de la compra (trigger comandas_club, 065)
  if c.phone is null then update comandas set phone = v_phone where id = c.id; end if;

  v_nom := coalesce(nullif(trim(c.nombre), ''), (select nullif(trim(nombre), '') from customers where phone = v_phone), 'Cliente');
  insert into reviews (comanda_id, phone, nombre, rating, texto, foto, instagram)
  values (c.id, v_phone, v_nom, p_rating, nullif(trim(coalesce(p_texto, '')), ''), p_foto, lower(v_ig));
  begin v_sello := public.dar_sello_resena_local(c.id);
  exception when others then raise warning 'sello por reseña (local): %', sqlerrm; end;
  return jsonb_build_object('sello_resena', v_sello, 'sello_compra', c.phone is null and (select sellos from comandas where id = c.id) > 0);
end $$;
revoke all on function public.create_review_local(text, text, int, text, text, text) from public;
grant execute on function public.create_review_local(text, text, int, text, text, text) to anon, authenticated;

-- si el equipo vuelve a mostrar una reseña oculta, se reintenta el sello (igual que con las de la web)
create or replace function public.reviews_sello_local() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.comanda_id is not null then
    begin perform public.dar_sello_resena_local(new.comanda_id);
    exception when others then raise warning 'sello por reseña (local): %', sqlerrm; end;
  end if;
  return null;
end $$;
revoke all on function public.reviews_sello_local() from public, anon, authenticated;
drop trigger if exists reviews_sello_local on public.reviews;
create trigger reviews_sello_local after update of estado on public.reviews
  for each row when (new.comanda_id is not null) execute function public.reviews_sello_local();

-- ---------- reseñas públicas: productos del pedido web o de la comanda ----------
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
          from reviews r cross join lateral (select coalesce((select oo.items from orders oo where oo.id = r.order_id), (select cc.items from comandas cc where cc.id = r.comanda_id), '[]'::jsonb) as items) o
         where r.estado = 'aprobada' and (r.texto is not null or r.foto is not null)
         order by r.orden nulls last, r.created_at desc limit 12) t), '[]'::jsonb))
$$;

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
          from reviews r cross join lateral (select coalesce((select oo.items from orders oo where oo.id = r.order_id), (select cc.items from comandas cc where cc.id = r.comanda_id), '[]'::jsonb) as items) o
         where r.estado = 'aprobada'
         order by r.orden nulls last, r.created_at desc offset greatest(coalesce(p_offset, 0), 0) limit 50) t), '[]'::jsonb))
$$;

create or replace function public.product_reviews(p_id text) returns jsonb
language sql stable security definer set search_path = public as $$
  with rv as (
    select distinct on (r.id) r.*, o.items
      from reviews r cross join lateral (select coalesce((select oo.items from orders oo where oo.id = r.order_id), (select cc.items from comandas cc where cc.id = r.comanda_id), '[]'::jsonb) as items) o
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

create or replace function public.product_ratings() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_object_agg(pid, jsonb_build_object('promedio', prom, 'cantidad', n)), '{}'::jsonb) from (
    select i->>'id' as pid, round(avg(r.rating)::numeric, 1) as prom, count(distinct r.id) as n
      from reviews r cross join lateral (select coalesce((select oo.items from orders oo where oo.id = r.order_id), (select cc.items from comandas cc where cc.id = r.comanda_id), '[]'::jsonb) as items) o
      cross join lateral jsonb_array_elements(o.items) i
     where r.estado = 'aprobada' and i->>'id' not in ('envio','premio','libre') and i->>'id' not like 'lp:%'
     group by i->>'id') t
$$;
