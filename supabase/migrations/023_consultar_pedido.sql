-- 023 · Consultar pedido desde el carrito con el celular O con el código (sin el otro dato).
--       Con un solo dato devuelve lo mínimo de los pedidos en curso: etapa, retiro o envío y la hora del pedido.
--       Nunca nombre, teléfono, productos, total ni link. Por celular el código va tapado (STT-••21).
--       Con código + celular se sigue usando get_order_status (seguimiento completo).
create or replace function public.buscar_pedido(p_phone text, p_code text) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'code', case when p_code is null then 'STT-••' || right(code, 2) else code end,
           'etapa', etapa, 'modo', modo, 'created_at', created_at) order by created_at desc), '[]'::jsonb)
  from (select * from orders
         where status = 'pendiente' and created_at > now() - interval '2 days'
           and ((p_code is not null and code = upper(trim(p_code)))
             or (p_code is null and public.norm_phone(p_phone) is not null and phone = public.norm_phone(p_phone)))
         order by created_at desc limit 3) o;
$$;
revoke all on function public.buscar_pedido(text,text) from public;
grant execute on function public.buscar_pedido(text,text) to anon, authenticated;
