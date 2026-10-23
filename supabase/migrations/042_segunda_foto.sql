-- 042 · Segunda foto por producto (opcional). Si está cargada, la tarjeta de la web muestra una flecha para pasar a la otra.
--   Se carga desde Panel → Carta, debajo de la foto principal. No borra nada.

alter table public.products add column if not exists img2 text;
