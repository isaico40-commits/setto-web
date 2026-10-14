-- =====================================================================
-- 006 · Caja del equipo (reemplaza la app de Apps Script + planilla)
--
-- Principio: UNA sola fuente de verdad. Solo se guardan movimientos.
-- Saldos, deudas con socios, stock y resúmenes se CALCULAN siempre desde
-- los movimientos activos (vistas). Nada se copia a otro lado, así que es
-- imposible que algo quede "descontado en un lado y no en el otro".
-- Los movimientos no se borran: se anulan (queda quién, cuándo y por qué)
-- y todo cambio queda en caja_log.
-- Se puede correr más de una vez sin romper nada.
-- =====================================================================

-- ---------- Socios y cuentas ----------
create table if not exists public.caja_socios (
  id text primary key,
  nombre text not null unique,
  activo boolean not null default true,
  orden integer not null default 0
);
insert into public.caja_socios (id, nombre, orden) values
  ('isa','Isa',1),('alan','Alan',2),('lucas','Lucas',3)
on conflict (id) do nothing;

create table if not exists public.caja_cuentas (
  id text primary key,
  nombre text not null,
  saldo_inicial numeric(14,2) not null default 0,
  inicio date not null default current_date,
  activa boolean not null default true,
  orden integer not null default 0
);
insert into public.caja_cuentas (id, nombre, saldo_inicial, inicio, orden) values
  ('mp','Mercado Pago',49402,'2026-09-26',1),
  ('efectivo','Efectivo',0,'2026-09-26',2)
on conflict (id) do nothing;

create table if not exists public.caja_categorias (
  id text primary key,
  nombre text not null,
  tipo text not null check (tipo in ('entrada','gasto')),
  orden integer not null default 0,
  activa boolean not null default true
);
insert into public.caja_categorias (id, nombre, tipo, orden) values
  ('venta_directa','Venta directa','entrada',1),
  ('pedidosya','PedidosYa','entrada',2),
  ('rappi','Rappi','entrada',3),
  ('ubereats','Uber Eats','entrada',4),
  ('cafeterias','Cafeterías / mayorista','entrada',5),
  ('otra_entrada','Otra entrada','entrada',9),
  ('insumos','Insumos','gasto',1),
  ('packaging','Packaging','gasto',2),
  ('publicidad','Publicidad','gasto',3),
  ('envios','Envíos y movilidad','gasto',4),
  ('equipamiento','Equipamiento','gasto',5),
  ('servicios','Servicios y apps','gasto',6),
  ('otros_gastos','Otros gastos','gasto',9)
on conflict (id) do nothing;

-- ---------- Movimientos ----------
-- tipo:
--   entrada        plata que entra a una cuenta (ventas, liquidaciones de apps)
--   gasto          sale de una cuenta, o lo pagó un socio de su bolsillo (Setto le queda debiendo)
--   aporte         un socio pone plata en una cuenta (Setto le queda debiendo)
--   devolucion     Setto le devuelve a un socio lo que puso (baja la deuda)
--   retiro         un socio retira ganancias (no es deuda, es reparto)
--   transferencia  pasar plata entre cuentas (ej. efectivo → Mercado Pago)
--   ajuste         diferencia al contar la caja (monto con signo)
create table if not exists public.caja_movimientos (
  id uuid primary key default gen_random_uuid(),
  fecha date not null default ((now() at time zone 'America/Argentina/Buenos_Aires')::date),
  tipo text not null check (tipo in ('entrada','gasto','aporte','devolucion','retiro','transferencia','ajuste')),
  detalle text not null default '',
  monto numeric(14,2) not null,
  cuenta_id text references public.caja_cuentas(id),
  cuenta_destino_id text references public.caja_cuentas(id),
  socio_id text references public.caja_socios(id),
  categoria_id text references public.caja_categorias(id),
  registro text not null,
  editado_por text,
  estado text not null default 'activo' check (estado in ('activo','anulado')),
  anulado_motivo text,
  anulado_por text,
  anulado_at timestamptz,
  legacy_id text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint caja_mov_monto check ((tipo = 'ajuste' and monto <> 0) or (tipo <> 'ajuste' and monto > 0)),
  constraint caja_mov_forma check (
    case tipo
      when 'entrada'       then cuenta_id is not null and socio_id is null and cuenta_destino_id is null
      when 'gasto'         then cuenta_destino_id is null and ((cuenta_id is not null) <> (socio_id is not null))
      when 'aporte'        then cuenta_id is not null and socio_id is not null and cuenta_destino_id is null
      when 'devolucion'    then cuenta_id is not null and socio_id is not null and cuenta_destino_id is null
      when 'retiro'        then cuenta_id is not null and socio_id is not null and cuenta_destino_id is null
      when 'transferencia' then cuenta_id is not null and cuenta_destino_id is not null and cuenta_id <> cuenta_destino_id and socio_id is null
      when 'ajuste'        then cuenta_id is not null and socio_id is null and cuenta_destino_id is null
    end
  )
);
create index if not exists caja_mov_fecha_idx on public.caja_movimientos (fecha desc, created_at desc);

-- ---------- Historial de cambios (automático) ----------
create table if not exists public.caja_log (
  id bigserial primary key,
  tabla text not null,
  fila_id text not null,
  accion text not null,
  por text,
  antes jsonb,
  despues jsonb,
  at timestamptz not null default now()
);
create index if not exists caja_log_fila_idx on public.caja_log (tabla, fila_id, at desc);

create or replace function public.caja_mov_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  if tg_op = 'UPDATE' then
    if old.estado = 'anulado' then
      raise exception 'Este movimiento está anulado y ya no se puede cambiar';
    end if;
    new.id := old.id; new.created_at := old.created_at; new.legacy_id := old.legacy_id; new.registro := old.registro;
    new.updated_at := now();
    if new.estado = 'anulado' then
      new.anulado_at := now();
      if coalesce(trim(new.anulado_por),'') = '' then raise exception 'Falta quién anula'; end if;
      if coalesce(trim(new.anulado_motivo),'') = '' then raise exception 'Contá en pocas palabras por qué se anula'; end if;
    else
      if coalesce(trim(new.editado_por),'') = '' then raise exception 'Falta quién edita'; end if;
    end if;
    insert into public.caja_log (tabla, fila_id, accion, por, antes, despues)
    values ('movimientos', old.id::text, case when new.estado = 'anulado' then 'anulado' else 'editado' end,
            case when new.estado = 'anulado' then new.anulado_por else new.editado_por end,
            to_jsonb(old), to_jsonb(new));
  elsif tg_op = 'INSERT' then
    if coalesce(trim(new.registro),'') = '' then raise exception 'Elegí quién está cargando'; end if;
    new.detalle := trim(new.detalle);
  end if;
  return new;
end $$;
drop trigger if exists caja_mov_guard on public.caja_movimientos;
create trigger caja_mov_guard before insert or update on public.caja_movimientos
  for each row execute function public.caja_mov_guard();

-- ---------- Efecto de cada movimiento (la única regla de cálculo) ----------
create or replace view public.caja_efectos with (security_invoker = true) as
  -- sobre las cuentas
  select m.id, m.fecha, m.cuenta_id as cuenta_id, null::text as socio_id,
    case m.tipo
      when 'entrada' then m.monto
      when 'aporte' then m.monto
      when 'ajuste' then m.monto
      when 'gasto' then -m.monto
      when 'devolucion' then -m.monto
      when 'retiro' then -m.monto
      when 'transferencia' then -m.monto
    end as delta_cuenta, 0::numeric as delta_deuda
  from public.caja_movimientos m where m.estado = 'activo' and m.cuenta_id is not null
  union all
  select m.id, m.fecha, m.cuenta_destino_id, null, m.monto, 0
  from public.caja_movimientos m where m.estado = 'activo' and m.tipo = 'transferencia'
  union all
  -- lo que Setto le debe a cada socio
  select m.id, m.fecha, null, m.socio_id, 0,
    case m.tipo when 'gasto' then m.monto when 'aporte' then m.monto when 'devolucion' then -m.monto end
  from public.caja_movimientos m where m.estado = 'activo' and m.tipo in ('gasto','aporte','devolucion') and m.socio_id is not null;

create or replace view public.caja_saldos with (security_invoker = true) as
  select c.id, c.nombre, c.orden, c.saldo_inicial,
         c.saldo_inicial + coalesce((select sum(e.delta_cuenta) from public.caja_efectos e where e.cuenta_id = c.id), 0) as saldo,
         (select max(m.created_at) from public.caja_movimientos m where m.tipo = 'ajuste' and m.cuenta_id = c.id and m.estado = 'activo') as ultimo_conteo
  from public.caja_cuentas c where c.activa;

create or replace view public.caja_deudas with (security_invoker = true) as
  select s.id, s.nombre, s.orden,
         coalesce((select sum(e.delta_deuda) from public.caja_efectos e where e.socio_id = s.id), 0) as le_debemos,
         coalesce((select sum(m.monto) from public.caja_movimientos m where m.socio_id = s.id and m.tipo = 'retiro' and m.estado = 'activo'), 0) as retirado
  from public.caja_socios s where s.activo;

-- Resumen por mes: ventas, gastos (incluye lo pagado por socios), resultado y retiros.
create or replace view public.caja_resumen_mensual with (security_invoker = true) as
  select to_char(date_trunc('month', fecha), 'YYYY-MM') as mes,
    sum(monto) filter (where tipo = 'entrada') as entradas,
    sum(monto) filter (where tipo = 'gasto') as gastos,
    coalesce(sum(monto) filter (where tipo = 'entrada'),0) - coalesce(sum(monto) filter (where tipo = 'gasto'),0) as resultado,
    sum(monto) filter (where tipo = 'retiro') as retiros,
    sum(monto) filter (where tipo = 'ajuste') as ajustes,
    count(*) as movimientos
  from public.caja_movimientos where estado = 'activo'
  group by 1;

-- Contar la caja: el servidor calcula la diferencia contra el saldo real del momento.
create or replace function public.caja_contar(p_cuenta text, p_contado numeric, p_registro text, p_nota text default null)
returns jsonb language plpgsql security invoker set search_path = public as $$
declare v_saldo numeric; v_delta numeric; v_id uuid;
begin
  if not public.is_staff() then raise exception 'Solo el equipo puede hacer esto'; end if;
  if p_contado is null or p_contado < 0 then raise exception 'El monto contado no es válido'; end if;
  select saldo into v_saldo from public.caja_saldos where id = p_cuenta;
  if v_saldo is null then raise exception 'Cuenta desconocida'; end if;
  v_delta := round(p_contado - v_saldo, 2);
  if v_delta = 0 then return jsonb_build_object('delta', 0, 'saldo', v_saldo); end if;
  insert into public.caja_movimientos (tipo, detalle, monto, cuenta_id, registro)
  values ('ajuste', 'Conteo: había ' || to_char(p_contado, 'FM999G999G990D00') || coalesce(' · ' || nullif(trim(p_nota),''), ''), v_delta, p_cuenta, p_registro)
  returning id into v_id;
  return jsonb_build_object('delta', v_delta, 'saldo', p_contado, 'id', v_id);
end $$;

-- ---------- Stock ----------
create table if not exists public.caja_stock_items (
  id uuid primary key default gen_random_uuid(),
  nombre text not null unique,
  unidad text not null default 'unidades',
  minimo integer not null default 0,
  activo boolean not null default true,
  orden integer not null default 0,
  legacy_id text unique,
  created_at timestamptz not null default now()
);
create table if not exists public.caja_stock_mov (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.caja_stock_items(id),
  lugar text not null check (lugar in ('cafe','produ')),
  delta integer not null check (delta <> 0),
  motivo text not null default 'otro' check (motivo in ('produccion','venta','merma','traslado','conteo','otro')),
  nota text,
  registro text not null,
  estado text not null default 'activo' check (estado in ('activo','anulado')),
  anulado_por text,
  anulado_at timestamptz,
  lote uuid,
  legacy_id text unique,
  created_at timestamptz not null default now()
);
create index if not exists caja_stock_mov_item_idx on public.caja_stock_mov (item_id, created_at desc);

create or replace function public.caja_stock_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  if old.estado = 'anulado' then raise exception 'Ya estaba anulado'; end if;
  if new.estado <> 'anulado' or new.delta <> old.delta or new.item_id <> old.item_id or new.lugar <> old.lugar then
    raise exception 'Un movimiento de stock solo se puede anular';
  end if;
  if coalesce(trim(new.anulado_por),'') = '' then raise exception 'Falta quién anula'; end if;
  new.anulado_at := now();
  insert into public.caja_log (tabla, fila_id, accion, por, antes, despues)
  values ('stock', old.id::text, 'anulado', new.anulado_por, to_jsonb(old), to_jsonb(new));
  return new;
end $$;
drop trigger if exists caja_stock_guard on public.caja_stock_mov;
create trigger caja_stock_guard before update on public.caja_stock_mov
  for each row execute function public.caja_stock_guard();

create or replace view public.caja_stock_actual with (security_invoker = true) as
  select i.id, i.nombre, i.unidad, i.minimo, i.orden, i.activo,
    coalesce(sum(m.delta) filter (where m.lugar = 'cafe'), 0)::int as cafe,
    coalesce(sum(m.delta) filter (where m.lugar = 'produ'), 0)::int as produ,
    max(m.created_at) as actualizado
  from public.caja_stock_items i
  left join public.caja_stock_mov m on m.item_id = i.id and m.estado = 'activo'
  group by i.id;

-- Traslado (dos movimientos en uno) y conteo (el servidor calcula la diferencia)
create or replace function public.caja_stock_traslado(p_item uuid, p_desde text, p_hacia text, p_cant integer, p_registro text)
returns void language plpgsql security invoker set search_path = public as $$
declare v_lote uuid := gen_random_uuid();
begin
  if not public.is_staff() then raise exception 'Solo el equipo puede hacer esto'; end if;
  if p_cant is null or p_cant <= 0 then raise exception 'Cantidad inválida'; end if;
  if p_desde = p_hacia then raise exception 'Elegí lugares distintos'; end if;
  insert into public.caja_stock_mov (item_id, lugar, delta, motivo, registro, lote) values
    (p_item, p_desde, -p_cant, 'traslado', p_registro, v_lote),
    (p_item, p_hacia,  p_cant, 'traslado', p_registro, v_lote);
end $$;

create or replace function public.caja_stock_contar(p_item uuid, p_lugar text, p_cant integer, p_registro text)
returns integer language plpgsql security invoker set search_path = public as $$
declare v_actual int; v_delta int;
begin
  if not public.is_staff() then raise exception 'Solo el equipo puede hacer esto'; end if;
  if p_cant is null or p_cant < 0 then raise exception 'Cantidad inválida'; end if;
  select case when p_lugar = 'cafe' then cafe else produ end into v_actual from public.caja_stock_actual where id = p_item;
  v_delta := p_cant - coalesce(v_actual, 0);
  if v_delta <> 0 then
    insert into public.caja_stock_mov (item_id, lugar, delta, motivo, registro) values (p_item, p_lugar, v_delta, 'conteo', p_registro);
  end if;
  return v_delta;
end $$;

-- ---------- Tareas ----------
create table if not exists public.caja_tareas (
  id uuid primary key default gen_random_uuid(),
  titulo text not null check (length(trim(titulo)) > 0),
  asignada text not null default 'Cualquiera',
  prioridad text not null default 'media' check (prioridad in ('alta','media','baja')),
  estado text not null default 'pendiente' check (estado in ('pendiente','hecha','archivada')),
  vence date,
  creada_por text not null,
  hecha_por text,
  hecha_at timestamptz,
  legacy_id text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------- Lista de compras ----------
create table if not exists public.caja_compras (
  id uuid primary key default gen_random_uuid(),
  item text not null check (length(trim(item)) > 0),
  cantidad text,
  donde text,
  urgente boolean not null default false,
  nota text,
  estado text not null default 'pendiente' check (estado in ('pendiente','comprado','quitada')),
  creada_por text not null,
  comprada_por text,
  comprada_at timestamptz,
  movimiento_id uuid references public.caja_movimientos(id),
  legacy_id text unique,
  created_at timestamptz not null default now()
);

-- ---------- Seguridad: solo el equipo ----------
alter table public.caja_socios      enable row level security;
alter table public.caja_cuentas     enable row level security;
alter table public.caja_categorias  enable row level security;
alter table public.caja_movimientos enable row level security;
alter table public.caja_log         enable row level security;
alter table public.caja_stock_items enable row level security;
alter table public.caja_stock_mov   enable row level security;
alter table public.caja_tareas      enable row level security;
alter table public.caja_compras     enable row level security;

do $$
declare t text;
begin
  -- config: el equipo lee y edita
  foreach t in array array['caja_socios','caja_cuentas','caja_categorias','caja_stock_items','caja_tareas','caja_compras'] loop
    execute format('drop policy if exists "%1$s staff" on public.%1$I', t);
    execute format('create policy "%1$s staff" on public.%1$I for all to authenticated using (public.is_staff()) with check (public.is_staff())', t);
  end loop;
  -- plata y stock: se lee, se agrega y se anula. Nunca se borra.
  foreach t in array array['caja_movimientos','caja_stock_mov'] loop
    execute format('drop policy if exists "%1$s staff" on public.%1$I', t);
    execute format('drop policy if exists "%1$s lee" on public.%1$I', t);
    execute format('drop policy if exists "%1$s agrega" on public.%1$I', t);
    execute format('drop policy if exists "%1$s cambia" on public.%1$I', t);
    execute format('create policy "%1$s lee" on public.%1$I for select to authenticated using (public.is_staff())', t);
    execute format('create policy "%1$s agrega" on public.%1$I for insert to authenticated with check (public.is_staff())', t);
    execute format('create policy "%1$s cambia" on public.%1$I for update to authenticated using (public.is_staff()) with check (public.is_staff())', t);
  end loop;
  drop policy if exists "caja_log lee" on public.caja_log;
  create policy "caja_log lee" on public.caja_log for select to authenticated using (public.is_staff());
end $$;

revoke delete on public.caja_movimientos, public.caja_stock_mov, public.caja_log from anon, authenticated;
revoke all on public.caja_socios, public.caja_cuentas, public.caja_categorias, public.caja_movimientos, public.caja_log,
  public.caja_stock_items, public.caja_stock_mov, public.caja_tareas, public.caja_compras,
  public.caja_efectos, public.caja_saldos, public.caja_deudas, public.caja_resumen_mensual, public.caja_stock_actual from anon;
revoke execute on function public.caja_contar(text, numeric, text, text) from public, anon;
revoke execute on function public.caja_stock_traslado(uuid, text, text, integer, text) from public, anon;
revoke execute on function public.caja_stock_contar(uuid, text, integer, text) from public, anon;
grant execute on function public.caja_contar(text, numeric, text, text) to authenticated;
grant execute on function public.caja_stock_traslado(uuid, text, text, integer, text) to authenticated;
grant execute on function public.caja_stock_contar(uuid, text, integer, text) to authenticated;

-- Avisos en vivo entre los tres celulares
do $$ begin
  begin execute 'alter publication supabase_realtime add table public.caja_movimientos'; exception when others then null; end;
  begin execute 'alter publication supabase_realtime add table public.caja_stock_mov'; exception when others then null; end;
  begin execute 'alter publication supabase_realtime add table public.caja_tareas'; exception when others then null; end;
  begin execute 'alter publication supabase_realtime add table public.caja_compras'; exception when others then null; end;
end $$;
