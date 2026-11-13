-- 065 · Local: Setto Club en el mostrador.
--   - La comanda puede llevar el celular del cliente (comandas.phone). Con eso, al quedar cobrada, suma los sellos sola
--     con las mismas reglas que un pedido web: settings.club.activo, sellos_por_pedido (1) y el mínimo (sobre el total).
--   - Funciona en los dos órdenes: celular antes del cobro (se suma al cobrar) o cobro antes del celular (se suma al cargarlo).
--   - Si la comanda se anula, o anulan su entrada desde la Caja (vuelve a "sin cobrar"), los sellos se descuentan.
--     Si después se vuelve a cobrar, se suman de nuevo. Todo queda en stamp_events con motivo "Local #N (día)".
--   - El premio NO se canjea solo: el Local muestra "completó la tarjeta" y el equipo toca Canjear (redeem_reward, el de siempre).
--   - Permiso de WhatsApp: solo si el cliente lo dice y el equipo lo tilda (consentimiento_panel de la 050, sin pre-tildar).
--   - 061, 063 y 064 están tomadas por otras ramas. Se puede correr más de una vez. No toca comandas ni sellos existentes.

alter table public.comandas add column if not exists phone text;
alter table public.comandas add column if not exists sellos integer not null default 0;
create index if not exists comandas_phone_idx on public.comandas (phone) where phone is not null;

-- ---------- sellos automáticos (BEFORE UPDATE: ajusta new.sellos y escribe customers/stamp_events) ----------
create or replace function public.comandas_club() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_club jsonb := coalesce((select value from settings where key = 'club'), '{}'::jsonb);
  v_spp  int := greatest(0, least(10, coalesce((v_club->>'sellos_por_pedido')::int, 1)));
  v_min  int := coalesce((v_club->>'minimo')::int, 0);
  v_mot  text := 'Local #' || new.numero || ' (' || to_char(new.dia, 'DD/MM') || ')';
  v_dar  boolean;
begin
  -- 1) se pierde el derecho: anulada, vuelve a sin cobrar o le cambiaron el celular → devolver lo sumado
  if old.sellos > 0 and old.phone is not null
     and (new.estado = 'anulada' or not new.pagado or new.phone is distinct from old.phone) then
    update customers set sellos = greatest(0, sellos - old.sellos), updated_at = now() where phone = old.phone;
    insert into stamp_events (phone, delta, motivo) values (old.phone, -old.sellos,
      v_mot || case when new.estado = 'anulada' then ' anulada' else ' sin cobrar' end);
    new.sellos := 0;
  end if;
  -- 2) corresponde sumar: cobrada, no anulada, con celular y todavía sin sellos
  v_dar := new.phone is not null and new.pagado and new.estado <> 'anulada' and new.sellos = 0
           and coalesce((v_club->>'activo')::boolean, true) and v_spp > 0 and new.total >= v_min;
  if v_dar then
    insert into customers (phone, nombre, sellos) values (new.phone, nullif(trim(coalesce(new.nombre, '')), ''), v_spp)
    on conflict (phone) do update set sellos = customers.sellos + v_spp,
      nombre = coalesce(customers.nombre, excluded.nombre), updated_at = now();
    insert into stamp_events (phone, delta, motivo) values (new.phone, v_spp, v_mot);
    new.sellos := v_spp;
  end if;
  return new;
end $$;
revoke all on function public.comandas_club() from public, anon, authenticated;
drop trigger if exists comandas_club on public.comandas;
create trigger comandas_club before update of phone, pagado, estado on public.comandas
  for each row execute function public.comandas_club();

-- ---------- tarjeta para el mostrador (nombre incluido: solo equipo) ----------
create or replace function public.local_club_ver(p_phone text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_phone text := public.norm_phone(p_phone);
  v_club  jsonb := coalesce((select value from settings where key = 'club'), '{}'::jsonb);
  c customers%rowtype;
begin
  if not public.is_staff() then raise exception 'Sin permiso'; end if;
  if v_phone is null then raise exception 'Revisá el celular: no parece válido'; end if;
  select * into c from customers where phone = v_phone;
  return jsonb_build_object(
    'phone', v_phone, 'existe', found, 'nombre', c.nombre,
    'sellos', coalesce(c.sellos, 0), 'canjes', coalesce(c.canjes, 0),
    'meta', coalesce((v_club->>'meta')::int, 8), 'premio', coalesce(v_club->>'premio', ''),
    'activo', coalesce((v_club->>'activo')::boolean, true), 'minimo', coalesce((v_club->>'minimo')::int, 0),
    'whatsapp', public.puede_contactar(v_phone, 'whatsapp'));
end $$;
revoke all on function public.local_club_ver(text) from public, anon;
grant execute on function public.local_club_ver(text) to authenticated;

-- ---------- anotar el celular en una comanda (antes o después de cobrar) ----------
create or replace function public.local_club(p_id uuid, p_phone text, p_whatsapp boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_phone text := public.norm_phone(p_phone);
  c comandas%rowtype; r jsonb;
begin
  if not public.is_staff() then raise exception 'Sin permiso'; end if;
  if v_phone is null then raise exception 'Revisá el celular: no parece válido'; end if;
  select * into c from comandas where id = p_id for update;
  if not found then raise exception 'No encontré esa comanda'; end if;
  if c.estado = 'anulada' then raise exception 'La comanda #% está anulada', c.numero; end if;
  if c.phone is not null and c.phone <> v_phone and c.sellos > 0 then
    raise exception 'La comanda #% ya sumó sellos a otro celular', c.numero;
  end if;
  update comandas set phone = v_phone where id = p_id; -- el trigger comandas_club suma si ya está cobrada
  if p_whatsapp then perform public.consentimiento_panel(v_phone, array['whatsapp']); end if;
  select to_jsonb(x) into r from comandas x where id = p_id;
  return jsonb_build_object('comanda', r, 'tarjeta', public.local_club_ver(v_phone));
end $$;
revoke all on function public.local_club(uuid, text, boolean) from public, anon;
grant execute on function public.local_club(uuid, text, boolean) to authenticated;
