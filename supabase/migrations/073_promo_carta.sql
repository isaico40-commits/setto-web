-- Promo por producto en la carta (dirty y mochis).
--   precio / precio_12 / precio_16 siguen siendo lo que se cobra (pedidos, caja y local no cambian).
--   antes / antes_12 / antes_16: el precio de carta normal mientras hay promo. La web lo muestra tachado.
--   null = sin promo.
alter table public.products add column if not exists antes integer;
alter table public.products add column if not exists antes_12 integer;
alter table public.products add column if not exists antes_16 integer;
