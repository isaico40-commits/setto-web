-- 056 · PedidosYa Envíos (Courier API v3): pedir un repartidor desde el panel para los pedidos con envío.
--   orders.pya: cotización, número de envío, estado y link de seguimiento. Lo escriben solo las Edge Functions
--   pedidosya-envio y pedidosya-webhook (con service_role); el equipo lo lee con el resto del pedido.
--   pedidosya_config: datos del punto de retiro. Va en su propia tabla y NO en settings, porque settings
--   se lee desde la web pública y la dirección de retiro no se publica.
--   El token de PedidosYa no va en la base: es el secreto PEDIDOSYA_TOKEN de las Edge Functions.

alter table public.orders add column if not exists pya jsonb;
create index if not exists orders_pya_shipping_idx on public.orders ((pya->>'shipping_id')) where pya is not null;

create table if not exists public.pedidosya_config (
  id smallint primary key default 1 check (id = 1),
  activo boolean not null default false,
  simulado boolean not null default true,   -- prendido: no llama a PedidosYa, inventa las respuestas (para probar el panel)
  prueba boolean not null default true,     -- manda isTest=true (envíos de prueba en el sandbox)
  nombre text not null default 'Setto',
  telefono text,
  direccion text,                           -- calle y número de donde retira el repartidor
  referencia text,                          -- piso, timbre, entre calles
  ciudad text not null default 'Mar del Plata',
  lat double precision,
  lng double precision,
  instrucciones text,
  peso_kg numeric not null default 1.5 check (peso_kg > 0 and peso_kg <= 8),
  volumen_cm3 numeric not null default 6000 check (volumen_cm3 > 0),
  updated_at timestamptz not null default now()
);
insert into public.pedidosya_config (id) values (1) on conflict (id) do nothing;

alter table public.pedidosya_config enable row level security;
drop policy if exists pedidosya_config_staff on public.pedidosya_config;
create policy pedidosya_config_staff on public.pedidosya_config for all to authenticated
  using (public.is_staff()) with check (public.is_staff());
revoke all on public.pedidosya_config from anon;
grant select, update on public.pedidosya_config to authenticated;
