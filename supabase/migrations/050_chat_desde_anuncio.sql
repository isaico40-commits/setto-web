-- 050 · De qué anuncio vino cada chat de WhatsApp.
--   Cuando alguien toca un anuncio de Meta que abre WhatsApp, el primer mensaje trae "referral" con el ID del anuncio.
--   El webhook (whatsapp-webhook) lo guarda acá. Así se puede cruzar: anuncio → chat → pedido entregado.
--   Vista chats_por_anuncio: por anuncio, cuántas personas escribieron y cuántas compraron después (pedido entregado).
--   No borra nada.

alter table public.message_logs add column if not exists anuncio_id     text; -- ID del anuncio (o post) de Meta
alter table public.message_logs add column if not exists anuncio_tipo   text; -- ad | post
alter table public.message_logs add column if not exists anuncio_titulo text; -- título del anuncio
alter table public.message_logs add column if not exists anuncio_url    text;
alter table public.message_logs add column if not exists ctwa_clid      text; -- ID del clic (para Conversions API más adelante)
create index if not exists message_logs_anuncio on public.message_logs(anuncio_id) where anuncio_id is not null;

-- security_invoker: respeta las políticas de message_logs y orders (solo el equipo la ve)
create or replace view public.chats_por_anuncio with (security_invoker = true) as
with chat as ( -- primer chat de cada persona desde cada anuncio
  select anuncio_id, max(anuncio_titulo) as titulo, phone, min(created_at) as primer_chat
  from message_logs where direccion = 'entrante' and anuncio_id is not null
  group by anuncio_id, phone
), compra as (
  select c.anuncio_id, c.phone, count(o.id) as pedidos, coalesce(sum(o.total), 0) as total
  from chat c join orders o on (o.phone = c.phone or o.wa_phone = c.phone) and o.status = 'entregado' and o.created_at >= c.primer_chat
  group by c.anuncio_id, c.phone
)
select c.anuncio_id, max(c.titulo) as titulo, count(*) as personas, min(c.primer_chat) as desde,
       count(k.phone) as compraron, coalesce(sum(k.pedidos), 0) as pedidos, coalesce(sum(k.total), 0) as total_vendido
from chat c left join compra k on k.anuncio_id = c.anuncio_id and k.phone = c.phone
group by c.anuncio_id;
revoke all on public.chats_por_anuncio from anon, public;
grant select on public.chats_por_anuncio to authenticated;
