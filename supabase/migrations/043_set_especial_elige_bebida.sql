-- Sets del Especial sin bebida fija (ej: Spooky Set): el cliente elige una de las dirty del drop.
-- El pedido guarda la bebida elegida ('bebida' en la línea) y la muestra en el detalle: "Bebida: Dirty Marshmallow".
-- Si llega sin bebida (web vieja en caché), el pedido entra igual con "Bebida: a confirmar".
-- Se parchea la create_order_v6 que está en la base.
do $mig$
declare d text; n int;
  a1 text := $q$  mp       maq_premios%rowtype;$q$;
  a2 text := $q$    v_sub := v_sub + v_price * v_qty;$q$;
  a3 text := $q$'detalle', v_det);$q$;
begin
  d := pg_get_functiondef('public.create_order_v6(text,text,jsonb,text,text,text,text,text,text,text,text)'::regprocedure);
  if position('v_beb' in d) > 0 then return; end if;
  n := (length(d) - length(replace(d, a1, ''))) / length(a1);
  if n <> 1 then raise exception 'create_order_v6: esperaba 1 declaración de mp, hay %', n; end if;
  n := (length(d) - length(replace(d, a2, ''))) / length(a2);
  if n <> 1 then raise exception 'create_order_v6: esperaba 1 suma del subtotal, hay %', n; end if;
  n := (length(d) - length(replace(d, a3, ''))) / length(a3);
  if n <> 1 then raise exception 'create_order_v6: esperaba 1 línea con detalle, hay %', n; end if;
  d := replace(d, a1, a1 || $q$
  v_beb    text;
  bp       products%rowtype;$q$);
  d := replace(d, a2, $q$    v_beb := null;
    if pr.categoria = 'especial' and coalesce(pr.formato,'mochi') = 'set' and pr.set_bebida is null then
      if nullif(trim(coalesce(it->>'bebida', '')), '') is not null then
        select * into bp from products where id = it->>'bebida' and categoria = 'especial' and coalesce(formato,'mochi') = 'dirty' and activo and not agotado;
        if not found then raise exception 'Esa bebida del % ya no está disponible, elegí otra', pr.nombre; end if;
        v_beb := bp.id;
        v_det := concat_ws(' · ', 'Bebida: ' || trim(bp.nombre), v_det);
      else
        v_det := concat_ws(' · ', 'Bebida: a confirmar', v_det);
      end if;
    end if;
$q$ || a2);
  d := replace(d, a3, $q$'detalle', v_det, 'bebida', v_beb);$q$);
  execute d;
end $mig$;
