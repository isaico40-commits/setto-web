-- 031 · Origen de cada pedido (UTM, fbclid, página de entrada) y vista CRM por cliente (P1 del CRM).
--   La web guarda de dónde llegó la persona (primer y último contacto) y lo manda con el pedido.
--   No atribuye ventas a anuncios: solo conserva el dato para analizarlo con un criterio parejo.
--   fbclid solo llega si la persona aceptó el Pixel de Meta en el aviso de privacidad.
--   No borra nada.

alter table public.orders add column if not exists first_touch_source   text;
alter table public.orders add column if not exists first_touch_campaign text;
alter table public.orders add column if not exists last_touch_source    text;
alter table public.orders add column if not exists last_touch_campaign  text;
alter table public.orders add column if not exists landing_page         text;
alter table public.orders add column if not exists fbclid               text;
alter table public.orders add column if not exists origen               jsonb; -- detalle completo (medium, content, term, referrer, fechas)
alter table public.customers add column if not exists email text;           -- opcional, nadie está obligado a dejarlo

-- la web manda el origen justo después de crear el pedido. Se valida con código + celular, una sola vez.
create or replace function public.registrar_origen(p_code text, p_phone text, p_origen jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare f jsonb := coalesce(p_origen->'first', '{}'::jsonb); l jsonb := coalesce(p_origen->'last', '{}'::jsonb);
begin
  if jsonb_typeof(p_origen) is distinct from 'object' or length(p_origen::text) > 4000 then return; end if;
  update orders set
    first_touch_source   = left(f->>'source', 80),   first_touch_campaign = left(f->>'campaign', 120),
    last_touch_source    = left(l->>'source', 80),   last_touch_campaign  = left(l->>'campaign', 120),
    landing_page         = left(coalesce(l->>'landing', f->>'landing'), 300),
    fbclid               = left(nullif(coalesce(l->>'fbclid', f->>'fbclid'), ''), 500),
    origen               = p_origen
  where code = p_code and phone = public.norm_phone(p_phone) and status = 'pendiente' and origen is null
    and created_at > now() - interval '1 day';
end $$;
revoke all on function public.registrar_origen(text,text,jsonb) from public;
grant execute on function public.registrar_origen(text,text,jsonb) to anon, authenticated;

-- CRM: una fila por cliente con su historial resumido. Solo pedidos entregados cuentan como compra.
-- security_invoker: respeta las políticas de orders/customers (solo el equipo la ve).
create or replace view public.crm_clientes with (security_invoker = true) as
with ent as (
  select * from orders where status = 'entregado'
), items as (
  select e.phone, it->>'id' as pid, max(it->>'nombre') as nombre, sum(coalesce((it->>'qty')::int, 1)) as qty
  from ent e cross join lateral jsonb_array_elements(e.items) it
  where coalesce(it->>'id', '') not in ('', 'gift', 'envio')
  group by e.phone, it->>'id'
), fav as (
  select i.phone, jsonb_agg(jsonb_build_object('id', i.pid, 'nombre', i.nombre, 'qty', i.qty) order by i.qty desc) filter (where i.rn <= 3) as favoritos,
         sum(i.qty) filter (where p.categoria = 'mochi' or i.pid like 'mochi%') as mochis,
         sum(i.qty) filter (where p.categoria = 'dirty') as bebidas,
         sum(i.qty) filter (where p.categoria in ('set','especial')) as sets
  from (select *, row_number() over (partition by phone order by qty desc) rn from items) i
  left join products p on p.id = i.pid
  group by i.phone
), agg as (
  select phone, count(*) as compras, sum(total) as total_gastado, min(created_at) as primera_compra, max(created_at) as ultima_compra
  from ent group by phone
), primero as ( -- origen del primer pedido que trajo dato de origen
  select distinct on (phone) phone, first_touch_source, first_touch_campaign from orders
  where first_touch_source is not null order by phone, created_at
), ultimo as (
  select distinct on (phone) phone, last_touch_source, last_touch_campaign from orders
  where last_touch_source is not null order by phone, created_at desc
), actividad as (
  select phone, max(created_at) as ultima_actividad from orders group by phone
)
select c.phone, c.nombre, c.email, c.sellos, c.canjes, c.created_at as cliente_desde,
       coalesce(a.compras, 0) as compras, coalesce(a.total_gastado, 0) as total_gastado,
       a.primera_compra, a.ultima_compra, act.ultima_actividad,
       f.favoritos, coalesce(f.mochis, 0) as mochis, coalesce(f.bebidas, 0) as bebidas, coalesce(f.sets, 0) as sets,
       pr.first_touch_source, pr.first_touch_campaign, u.last_touch_source, u.last_touch_campaign,
       public.puede_contactar(c.phone, 'whatsapp') as ok_whatsapp,
       public.puede_contactar(c.phone, 'meta_ads') as ok_anuncios
from customers c
left join agg a on a.phone = c.phone
left join fav f on f.phone = c.phone
left join primero pr on pr.phone = c.phone
left join ultimo u on u.phone = c.phone
left join actividad act on act.phone = c.phone;
revoke all on public.crm_clientes from anon, public;
grant select on public.crm_clientes to authenticated;
