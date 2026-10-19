-- 037 · Reseñas sin filtro previo: se publican apenas la deja el cliente y el equipo las revisa después.
--   Así la web no muestra solo las buenas. El equipo puede marcarlas como revisadas u ocultarlas
--   (por ejemplo, si la foto no corresponde) desde Panel → Reseñas.
--   Las que estaban esperando aprobación se publican ahora y quedan "sin revisar". No borra nada.

alter table public.reviews add column if not exists revisada boolean not null default false;
alter table public.reviews alter column estado set default 'aprobada';

-- lo que el equipo ya había aprobado u ocultado cuenta como revisado
update public.reviews set revisada = true where estado in ('aprobada', 'oculta') and not revisada;
update public.reviews set estado = 'aprobada' where estado = 'pendiente';
