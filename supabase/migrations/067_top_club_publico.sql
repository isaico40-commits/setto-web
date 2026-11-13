-- 067 · Top del mes del Setto Club, visible en la web.
--   - top_club_publico(): lo puede llamar cualquiera (anon). Devuelve nombre corto ("Lucía M."), compras y sellos.
--     Al podio (puestos 1 a 3) le suma lo gastado en el mes REDONDEADO a miles (gastado_aprox), decisión de Isa 2026-11-13.
--     Nunca celular, apellido entero ni montos exactos.
--   - Cuenta pedidos web entregados + comandas del local cobradas con celular (necesita la 065), desde el 1 del mes (hora AR).
--   - Se prende/apaga con settings.top_club {"activo": bool, "cuantos": 3..10}. Apagado por defecto.
--   - customers.top_oculto: el equipo puede sacar a alguien del Top público (si lo pide o no quiere aparecer).
--     Clientes sin nombre no aparecen.
--   - 061, 063 y 064 están tomadas por otras ramas; 065/066 son del PR #102. Se puede correr más de una vez.

alter table public.customers add column if not exists top_oculto boolean not null default false;

create or replace function public.top_club_nombre(p text) returns text
language sql immutable set search_path = public as $$
  select case when coalesce(trim(p), '') = '' then null
    else initcap(lower(split_part(regexp_replace(trim(p), '\s+', ' ', 'g'), ' ', 1)))
      || coalesce(' ' || nullif(upper(left(split_part(regexp_replace(trim(p), '\s+', ' ', 'g'), ' ', 2), 1)), '') || '.', '')
  end
$$;

create or replace function public.top_club_publico() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_cfg   jsonb := coalesce((select value from settings where key = 'top_club'), '{}'::jsonb);
  v_n     int := greatest(3, least(10, coalesce((v_cfg->>'cuantos')::int, 5)));
  v_meta  int := coalesce((select (value->>'meta')::int from settings where key = 'club'), 8);
  v_desde timestamptz := date_trunc('month', now() at time zone 'America/Argentina/Buenos_Aires') at time zone 'America/Argentina/Buenos_Aires';
  v_top   jsonb;
begin
  if not coalesce((v_cfg->>'activo')::boolean, false) then
    return jsonb_build_object('activo', false, 'top', '[]'::jsonb);
  end if;
  with ventas as (
    select phone, total from orders where status = 'entregado' and phone is not null and created_at >= v_desde
    union all
    select phone, total from comandas where phone is not null and pagado and estado <> 'anulada' and created_at >= v_desde
  ), suma as (
    select phone, sum(total) as gastado, count(*) as compras from ventas group by phone
  ), rank as (
    select public.top_club_nombre(c.nombre) as nombre, s.compras, c.sellos, s.gastado,
           row_number() over (order by s.gastado desc, s.compras desc, c.created_at) as pos
    from suma s join customers c on c.phone = s.phone
    where not c.top_oculto and public.top_club_nombre(c.nombre) is not null
  )
  select coalesce(jsonb_agg(jsonb_build_object('pos', pos, 'nombre', nombre, 'compras', compras, 'sellos', sellos,
             'gastado_aprox', case when pos <= 3 then round(gastado / 1000.0)::int * 1000 end) order by pos), '[]'::jsonb)
    into v_top from rank where pos <= v_n;
  return jsonb_build_object('activo', true, 'meta', v_meta, 'top', v_top);
end $$;
revoke all on function public.top_club_publico() from public;
grant execute on function public.top_club_publico() to anon, authenticated;

-- ---------- el equipo saca o vuelve a sumar a alguien del Top público ----------
create or replace function public.top_club_ocultar(p_phone text, p_oculto boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_phone text := public.norm_phone(p_phone);
begin
  if not public.is_staff() then raise exception 'Solo el equipo puede hacer esto'; end if;
  update customers set top_oculto = coalesce(p_oculto, false), updated_at = now() where phone = v_phone;
  if not found then raise exception 'No encontré ese cliente'; end if;
  return jsonb_build_object('phone', v_phone, 'top_oculto', coalesce(p_oculto, false));
end $$;
revoke all on function public.top_club_ocultar(text, boolean) from public, anon;
grant execute on function public.top_club_ocultar(text, boolean) to authenticated;
