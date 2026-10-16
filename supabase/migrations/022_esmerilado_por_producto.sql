-- 022 · Esmerilado por producto (tapa la foto con un vidrio esmerilado). Se activa en Panel → Carta.
alter table public.products add column if not exists esmerilado boolean not null default false;
update public.products set esmerilado = true where categoria = 'especial' and coalesce(img, '') = '';
