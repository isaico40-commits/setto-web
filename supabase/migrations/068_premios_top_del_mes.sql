-- 068 · Premios del Top del mes por WhatsApp (pedido de Isa, 2026-11-13).
--   El 1 de cada mes, a los primeros puestos del mes que terminó (lo gastado en pedidos web entregados + comandas del
--   local cobradas con celular, igual que el Top del panel) les llega un WhatsApp con un código personal de 7 días.
--
--   Códigos de descuento (promos), dos opciones nuevas:
--   - promos.extra_pct: con tipo 'regalo', además del regalo descuenta ese % en el resto de los productos
--       (ej. top 2 y 3: un mochi de regalo + 10% off en lo demás).
--   - promos.minimo_aparte: el mínimo se cuenta SIN el regalo (ej. top 1: la bebida gratis exige comprar además
--       al menos el precio de un mochi; así suma una compra y el sello sale de esa compra, como cualquier pedido).
--   create_order_v7 se parchea por reemplazo de texto (como la 053 y la 054); promo_check devuelve los dos campos.
--
--   Automáticas:
--   - marketing_automations.disparador suma 'top' con top_desde / top_hasta (ej. 1..1 o 2..3).
--   - top_mes(desde, hasta): el ranking de un período (solo equipo / service_role).
--   - automatica_top_destinatarios(): el ranking del mes anterior (hora AR), puestos de la automática, con permiso de
--     WhatsApp. Una sola vez por persona, automática y mes. No aplica la regla de "1 mensaje cada 7 días": es un premio.
--   - automaticas_tick('top'): el día 1 de cada mes, cada hora de 10 a 20 h (si algo falla, reintenta; nunca repite).
--   Ojo: la Edge Function whatsapp-automaticas también se actualiza (disparador "top"). No borra nada. Se puede correr más de una vez.

-- ---------- códigos: regalo + % y mínimo sin el regalo ----------
alter table public.promos add column if not exists extra_pct integer not null default 0;
alter table public.promos drop constraint if exists promos_extra_pct_check;
alter table public.promos add constraint promos_extra_pct_check check (extra_pct between 0 and 100 and (extra_pct = 0 or tipo = 'regalo'));
alter table public.promos add column if not exists minimo_aparte boolean not null default false;

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
    'extra_pct', p.extra_pct, 'minimo_aparte', p.minimo_aparte,
    'personal', c.phone is not null, 'error', v_err);
end $$;
revoke all on function public.promo_check(text,text) from public;
grant execute on function public.promo_check(text,text) to anon, authenticated;

do $mig$
declare d text; n int; a text;
begin
  d := pg_get_functiondef('public.create_order_v7(text,text,jsonb,text,text,text,text,text,text,text,text,text)'::regprocedure);
  if position('pp.extra_pct' in d) > 0 then raise notice 'create_order_v7 ya tiene extra_pct'; return; end if;
  a := $q$'un mochi al pedido' end; end if;$q$;
  n := (length(d) - length(replace(d, a, ''))) / length(a);
  if n <> 1 then raise exception 'create_order_v7: esperaba 1 chequeo del regalo, hay %', n; end if;
  d := replace(d, a, a || $q$
      if pp.minimo_aparte and v_sub - v_cod < pp.minimo then
        raise exception 'Para usar este código sumá al pedido productos por $% además del regalo', replace(to_char(pp.minimo, 'FM999,999,999'), ',', '.');
      end if;
      if pp.extra_pct > 0 then v_cod := v_cod + (round((v_sub - v_cod) * pp.extra_pct / 100.0 / 10.0) * 10)::int; end if;$q$);
  execute d;
end $mig$;
revoke all on function public.create_order_v7(text,text,jsonb,text,text,text,text,text,text,text,text,text) from public;
grant execute on function public.create_order_v7(text,text,jsonb,text,text,text,text,text,text,text,text,text) to anon, authenticated;

-- ---------- automática "Top del mes" ----------
alter table public.marketing_automations add column if not exists top_desde integer;
alter table public.marketing_automations add column if not exists top_hasta integer;
alter table public.marketing_automations drop constraint if exists marketing_automations_disparador_check;
alter table public.marketing_automations add constraint marketing_automations_disparador_check check (disparador in ('compra','premio','producto','top'));
alter table public.marketing_automations drop constraint if exists marketing_automations_regla_check;
alter table public.marketing_automations add constraint marketing_automations_regla_check
  check ((disparador = 'compra' and dias is not null)
      or (disparador = 'premio' and horas is not null)
      or (disparador = 'producto' and audiencia is not null and (audiencia = 'favorito' or dias is not null))
      or (disparador = 'top' and top_desde between 1 and 10 and top_hasta between top_desde and 10));

-- ranking de un período: lo gastado en pedidos web entregados + comandas del local cobradas con celular (necesita la 065)
create or replace function public.top_mes(p_desde timestamptz, p_hasta timestamptz)
returns table (pos integer, phone text, nombre text, gastado bigint, compras bigint)
language sql stable security definer set search_path = public as $$
  with ventas as (
    select o.phone, o.total from orders o where o.status = 'entregado' and o.phone is not null and o.created_at >= p_desde and o.created_at < p_hasta
    union all
    select k.phone, k.total from comandas k where k.phone is not null and k.pagado and k.estado <> 'anulada' and k.created_at >= p_desde and k.created_at < p_hasta
  ), suma as (select v.phone, sum(v.total)::bigint as gastado, count(*)::bigint as compras from ventas v group by v.phone)
  select (row_number() over (order by s.gastado desc, s.compras desc, c.created_at))::int, s.phone, c.nombre, s.gastado, s.compras
  from suma s left join customers c on c.phone = s.phone
  where s.gastado > 0;
$$;
revoke all on function public.top_mes(timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.top_mes(timestamptz, timestamptz) to service_role;

-- a quién le toca ahora: puestos de la automática en el mes anterior (hora AR)
create or replace function public.automatica_top_destinatarios(p_id uuid)
returns table (phone text, nombre text, puesto integer, mes text)
language plpgsql stable security definer set search_path = public as $$
declare
  a marketing_automations%rowtype;
  v_hoy  timestamp := now() at time zone 'America/Argentina/Buenos_Aires';
  v_ini  timestamptz := (date_trunc('month', v_hoy) - interval '1 month') at time zone 'America/Argentina/Buenos_Aires';
  v_fin  timestamptz := date_trunc('month', v_hoy) at time zone 'America/Argentina/Buenos_Aires';
  v_mes  text := (array['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'])[extract(month from v_ini at time zone 'America/Argentina/Buenos_Aires')::int];
begin
  select * into a from marketing_automations where id = p_id and disparador = 'top';
  if not found then return; end if;
  return query
  select t.phone, t.nombre, t.pos, v_mes
  from public.top_mes(v_ini, v_fin) t
  where t.pos between a.top_desde and a.top_hasta
    and public.puede_contactar(t.phone, 'whatsapp')
    -- una sola vez por automática y mes (se cuenta desde el día 1)
    and not exists (select 1 from message_logs l where l.automation_id = a.id and l.phone = t.phone and l.estado <> 'fallo'
                    and coalesce(l.texto, '') <> '[prueba]' and l.created_at >= v_fin)
    and (select count(*) from message_logs l where l.automation_id = a.id and l.phone = t.phone and l.estado = 'fallo' and l.created_at >= v_fin) < 3;
end $$;
revoke all on function public.automatica_top_destinatarios(uuid) from public, anon, authenticated;
grant execute on function public.automatica_top_destinatarios(uuid) to service_role;

-- para el panel: igual que la 057, más las de top ("hoy" = a quiénes les tocaría si hoy fuera día 1)
create or replace function public.automaticas_resumen() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r jsonb := '{}'::jsonb; a record; v_ult int; v_fav int;
begin
  if not public.is_staff() then raise exception 'Solo el equipo puede hacer esto'; end if;
  for a in select id, disparador from marketing_automations loop
    v_ult := null; v_fav := null;
    if a.disparador = 'producto' then
      select count(*) filter (where motivo = 'ultimos'), count(*) filter (where motivo = 'favorito') into v_ult, v_fav
      from public.automatica_producto_destinatarios(a.id);
    end if;
    r := r || jsonb_build_object(a.id::text, jsonb_build_object(
      'enviados', (select count(*) from message_logs l where l.automation_id = a.id and l.estado <> 'fallo' and coalesce(l.texto, '') <> '[prueba]'),
      'semana',   (select count(*) from message_logs l where l.automation_id = a.id and l.estado <> 'fallo' and coalesce(l.texto, '') <> '[prueba]' and l.created_at > now() - interval '7 days'),
      'gratis',   (select count(*) from message_logs l where l.automation_id = a.id and l.estado <> 'fallo' and l.texto like '[libre]%'),
      'fallidos', (select count(*) from message_logs l where l.automation_id = a.id and l.estado = 'fallo'),
      'ultimos',  v_ult,
      'favorito', v_fav,
      'hoy',      case a.disparador
                    when 'premio' then (select count(*) from public.automatica_premio_destinatarios(a.id))
                    when 'producto' then v_ult + v_fav
                    when 'top' then (select count(*) from public.automatica_top_destinatarios(a.id))
                    else (select count(*) from public.automatica_destinatarios(a.id)) end));
  end loop;
  return r;
end $$;
revoke all on function public.automaticas_resumen() from public, anon;
grant execute on function public.automaticas_resumen() to authenticated;

do $$ begin
  if exists (select 1 from cron.job where jobname = 'setto-automaticas-top') then perform cron.unschedule('setto-automaticas-top'); end if;
  perform cron.schedule('setto-automaticas-top', '20 13-23 1 * *', $c$select public.automaticas_tick('top')$c$); -- día 1, cada hora de 10 a 20 h Argentina
end $$;
