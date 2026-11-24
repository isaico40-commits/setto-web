-- 072 · Costos fijos (alquiler, luz, gas, internet, sueldos…).
--
--   costo_fijos   un renglón por cada costo fijo, con lo que sale en promedio por mes.
--                 Lo ven y lo cargan solo los del staff (no va en settings porque settings es de lectura pública).
--
-- Cómo se usa (en la Caja → Costos → Fijos y en el Dashboard):
--   % de fijos = total de fijos por mes / facturación estimada del mes (promedio de los últimos 28 días con ventas).
--   A cada venta se le suma ese % de su precio como costo fijo.
--
-- Se puede correr más de una vez.

create table if not exists public.costo_fijos (
  id         uuid primary key default gen_random_uuid(),
  nombre     text not null check (length(trim(nombre)) between 1 and 60),
  monto      numeric(14,2) not null check (monto >= 0),
  orden      int not null default 0,
  activo     boolean not null default true,
  registro   text,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

alter table public.costo_fijos enable row level security;
drop policy if exists "costo_fijos lee" on public.costo_fijos;
create policy "costo_fijos lee" on public.costo_fijos for select to authenticated using (public.is_staff());
drop policy if exists "costo_fijos escribe" on public.costo_fijos;
create policy "costo_fijos escribe" on public.costo_fijos for all to authenticated using (public.is_staff()) with check (public.is_staff());
revoke all on public.costo_fijos from anon;
grant select, insert, update, delete on public.costo_fijos to authenticated;
