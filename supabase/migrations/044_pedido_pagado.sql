-- 044 · Pedido pagado
--   El equipo marca en el panel si un pedido ya está pagado (y lo puede desmarcar).
--   Es un dato interno: el cliente no lo ve (track_status no lo devuelve).
--   orders.pagado_at = cuándo se marcó; null = sin pagar. orders.pagado_por = quién lo marcó.
--   En producción, correr el alter table solo y con lock_timeout (orders tiene triggers y realtime).

set lock_timeout = '5s';
alter table public.orders add column if not exists pagado_at timestamptz;
alter table public.orders add column if not exists pagado_por uuid;
reset lock_timeout;

create or replace function public.marcar_pagado(p_id uuid, p_pagado boolean) returns timestamptz
language plpgsql security definer set search_path = public as $$
declare v_at timestamptz;
begin
  if not public.is_staff() then raise exception 'Solo el equipo puede hacer esto'; end if;
  update orders
     set pagado_at  = case when p_pagado then coalesce(pagado_at, now()) else null end,
         pagado_por = case when p_pagado then coalesce(pagado_por, auth.uid()) else null end
   where id = p_id
  returning pagado_at into v_at;
  if not found then raise exception 'No encontramos ese pedido'; end if;
  return v_at;
end $$;
revoke all on function public.marcar_pagado(uuid,boolean) from public, anon;
grant execute on function public.marcar_pagado(uuid,boolean) to authenticated;
