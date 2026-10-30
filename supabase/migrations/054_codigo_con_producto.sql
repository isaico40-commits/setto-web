-- 054 · Códigos de descuento: "solo con la compra de" un producto y "vale desde" una fecha y hora.
--   - promos.requiere: id de un producto de la carta (ej. el Spooky Set). El código solo entra si el pedido lo lleva.
--       Con tipo 'regalo', esa unidad no cuenta como el regalo (si pedís un solo mochi y es el requerido, no sale gratis).
--   - promos.desde_at: antes de esa hora el código no se puede usar (ej. una campaña que arranca a las 15 hs).
--   - promo_problema y promo_check se reemplazan enteras; create_order_v7 se parchea por reemplazo de texto (como la 053).
--   No borra nada.

alter table public.promos add column if not exists requiere text references public.products(id) on delete set null;
alter table public.promos add column if not exists desde_at timestamptz;

create or replace function public.promo_problema(p_code text, p_phone text) returns text
language plpgsql stable security definer set search_path = public as $$
declare
  c promo_codigos%rowtype; p promos%rowtype;
  v_phone text := public.norm_phone(p_phone);
  v_vence timestamptz;
begin
  select * into c from promo_codigos where code = upper(trim(coalesce(p_code, '')));
  if not found then return 'No encontramos ese código. Revisá que esté bien escrito.'; end if;
  select * into p from promos where id = c.promo_id;
  if not p.activa then return 'Este código ya no está activo.'; end if;
  if p.desde_at is not null and p.desde_at > now() then
    return 'Este código vale desde el ' || to_char(p.desde_at at time zone 'America/Argentina/Buenos_Aires', 'DD/MM "a las" HH24:MI') || ' hs.';
  end if;
  v_vence := least(c.vence_at, p.vence_at);
  if v_vence is not null and v_vence <= now() then
    return 'Este código venció el ' || to_char(v_vence at time zone 'America/Argentina/Buenos_Aires', 'DD/MM') || '.';
  end if;
  if p.usos_max is not null and (select count(*) from promo_usos where promo_id = p.id and not devuelto) >= p.usos_max then
    return 'Este código ya se usó todas las veces posibles.';
  end if;
  if v_phone is null then return null; end if;
  if c.phone is not null and c.phone <> v_phone then return 'Este código es personal: usalo con el celular al que te lo mandamos.'; end if;
  if (select count(*) from promo_usos where promo_id = p.id and phone = v_phone and not devuelto) >= p.por_cliente then
    return 'Ya usaste este código' || case when p.por_cliente > 1 then ' las ' || p.por_cliente || ' veces' else '' end || '.';
  end if;
  return null;
end $$;
revoke all on function public.promo_problema(text,text) from public, anon, authenticated;

create or replace function public.promo_check(p_code text, p_phone text default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare c promo_codigos%rowtype; p promos%rowtype; v_err text;
begin
  v_err := public.promo_problema(p_code, p_phone);
  select * into c from promo_codigos where code = upper(trim(coalesce(p_code, '')));
  if not found then return jsonb_build_object('error', v_err); end if;
  select * into p from promos where id = c.promo_id;
  return jsonb_build_object('code', c.code, 'titulo', p.titulo, 'tipo', p.tipo, 'valor', p.valor, 'regalo', p.regalo,
    'tope', p.tope, 'minimo', p.minimo, 'acumula', p.acumula, 'vence_at', least(c.vence_at, p.vence_at),
    'requiere', p.requiere, 'requiere_nombre', (select trim(nombre) from products where id = p.requiere), 'desde_at', p.desde_at,
    'personal', c.phone is not null, 'error', v_err);
end $$;
revoke all on function public.promo_check(text,text) from public;
grant execute on function public.promo_check(text,text) to anon, authenticated;

do $mig$
declare d text; n int; a text; b text;
begin
  d := pg_get_functiondef('public.create_order_v7(text,text,jsonb,text,text,text,text,text,text,text,text,text)'::regprocedure);
  if position('pp.requiere' in d) > 0 then raise notice 'create_order_v7 ya tiene requiere'; return; end if;

  a := 'if v_sub < pp.minimo then';
  n := (length(d) - length(replace(d, a, ''))) / length(a);
  if n <> 1 then raise exception 'create_order_v7: esperaba 1 chequeo de mínimo, hay %', n; end if;
  d := replace(d, a, $q$if pp.requiere is not null and not exists (select 1 from jsonb_array_elements(v_lines) l where l->>'id' = pp.requiere) then
      raise exception 'Este código es para pedidos con %. Sumalo al carrito.', coalesce((select trim(nombre) from products where id = pp.requiere), 'un producto de la carta');
    end if;
    $q$ || a);

  a := $q$coalesce(pr2.formato, 'mochi') = 'mochi') end;$q$;
  n := (length(d) - length(replace(d, a, ''))) / length(a);
  if n <> 1 then raise exception 'create_order_v7: esperaba 1 cálculo de regalo, hay %', n; end if;
  d := replace(d, a, $q$coalesce(pr2.formato, 'mochi') = 'mochi') end
         and (pp.requiere is null or l->>'id' <> pp.requiere or (l->>'qty')::int > 1);$q$);
  execute d;
end $mig$;
revoke all on function public.create_order_v7(text,text,jsonb,text,text,text,text,text,text,text,text,text) from public;
grant execute on function public.create_order_v7(text,text,jsonb,text,text,text,text,text,text,text,text,text) to anon, authenticated;
