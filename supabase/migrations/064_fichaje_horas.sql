-- 064 · Fichaje de horas del equipo (Local → pestaña "Horas").
--   - fichajes: un turno por fila (entrada y salida). Un toque abre el turno, otro toque lo cierra.
--   - Si alguien se olvidó de fichar, se corrige la hora o se carga el turno entero a mano.
--     Nada se borra: un turno equivocado se anula con motivo, y cada cambio queda en fichajes_log
--     (quién, cuándo, valores de antes y de después, motivo).
--   - El equipo NO escribe las tablas directo: todo pasa por las funciones de abajo (chequean is_staff()).
--   - Las personas salen de caja_socios (Isa, Alan, Lucas). No guarda porcentajes ni montos.
--   Se puede correr más de una vez. No toca nada existente.

create table if not exists public.fichajes (
  id             uuid primary key default gen_random_uuid(),
  socio_id       text not null references public.caja_socios(id),
  entrada        timestamptz not null,
  salida         timestamptz,
  origen         text not null default 'boton',   -- 'boton' (fichó en el momento) | 'manual' (cargado después)
  editado        boolean not null default false,  -- true si alguna vez se tocó a mano
  anulado        boolean not null default false,
  anulado_motivo text,
  created_at     timestamptz not null default now(),
  constraint fichajes_origen_chk check (origen in ('boton', 'manual')),
  constraint fichajes_orden_chk check (salida is null or salida > entrada),
  constraint fichajes_largo_chk check (salida is null or salida - entrada <= interval '24 hours')
);
create unique index if not exists fichajes_uno_abierto on public.fichajes (socio_id) where salida is null and not anulado;
create index if not exists fichajes_entrada_idx on public.fichajes (entrada desc);

create table if not exists public.fichajes_log (
  id          bigint generated always as identity primary key,
  fichaje_id  uuid not null references public.fichajes(id),
  socio_id    text not null,
  accion      text not null,
  quien       text not null,
  antes       jsonb,
  despues     jsonb,
  motivo      text,
  created_at  timestamptz not null default now(),
  constraint fichajes_log_accion_chk check (accion in ('entrada', 'salida', 'editar', 'agregar', 'anular'))
);
create index if not exists fichajes_log_fichaje_idx on public.fichajes_log (fichaje_id, created_at);

alter table public.fichajes enable row level security;
alter table public.fichajes_log enable row level security;
drop policy if exists "fichajes lee" on public.fichajes;
create policy "fichajes lee" on public.fichajes for select to authenticated using (public.is_staff());
drop policy if exists "fichajes_log lee" on public.fichajes_log;
create policy "fichajes_log lee" on public.fichajes_log for select to authenticated using (public.is_staff());
-- sin políticas de escritura: solo las funciones (security definer) escriben
revoke all on public.fichajes, public.fichajes_log from anon;
revoke insert, update, delete, truncate on public.fichajes, public.fichajes_log from authenticated;
grant select on public.fichajes, public.fichajes_log to authenticated;

do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'fichajes') then
    alter publication supabase_realtime add table public.fichajes;
  end if;
exception when undefined_object then null; -- sin realtime (base local de prueba)
end $$;

-- ---------- helpers (no se llaman desde afuera) ----------
-- quién toca el botón: tiene que ser alguien del equipo
create or replace function public.fichaje_quien(p_quien text) returns text
language plpgsql stable security definer set search_path = public as $$
declare v text;
begin
  select nombre into v from caja_socios where activo and nombre = trim(coalesce(p_quien, '')) limit 1;
  if v is null then raise exception 'Elegí quién sos'; end if;
  return v;
end $$;

create or replace function public.fichaje_snap(f public.fichajes) returns jsonb
language sql immutable as $$
  select jsonb_build_object('entrada', f.entrada, 'salida', f.salida, 'anulado', f.anulado);
$$;

-- ¿se pisa con otro turno de la misma persona? (un turno abierto cuenta hasta ahora)
create or replace function public.fichaje_pisa(p_socio text, p_id uuid, p_ent timestamptz, p_sal timestamptz) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from fichajes f
    where f.socio_id = p_socio and not f.anulado and f.id is distinct from p_id
      and tstzrange(f.entrada, coalesce(f.salida, greatest(now(), f.entrada + interval '1 second')), '[)')
       && tstzrange(p_ent, coalesce(p_sal, greatest(now(), p_ent + interval '1 second')), '[)'));
$$;

revoke all on function public.fichaje_quien(text) from public, anon, authenticated;
revoke all on function public.fichaje_snap(public.fichajes) from public, anon, authenticated;
revoke all on function public.fichaje_pisa(text, uuid, timestamptz, timestamptz) from public, anon, authenticated;

-- ---------- fichar: un toque entra, otro toque sale ----------
create or replace function public.fichaje_marcar(p_socio text, p_quien text) returns public.fichajes
language plpgsql security definer set search_path = public as $$
declare v_quien text; v_nom text; f fichajes%rowtype; v_antes jsonb;
begin
  if not is_staff() then raise exception 'Sin permiso'; end if;
  v_quien := fichaje_quien(p_quien);
  select nombre into v_nom from caja_socios where id = p_socio and activo;
  if v_nom is null then raise exception 'Esa persona no está en el equipo'; end if;
  perform pg_advisory_xact_lock(hashtext('fichaje:' || p_socio));

  select * into f from fichajes where socio_id = p_socio and salida is null and not anulado for update;
  if found then
    if now() - f.entrada > interval '16 hours' then
      raise exception '% tiene un turno abierto desde el %. Corregí la hora de salida de ese turno.', v_nom,
        to_char(f.entrada at time zone 'America/Argentina/Buenos_Aires', 'DD/MM HH24:MI');
    end if;
    v_antes := fichaje_snap(f);
    update fichajes set salida = greatest(now(), entrada + interval '1 second') where id = f.id returning * into f;
    insert into fichajes_log (fichaje_id, socio_id, accion, quien, antes, despues) values (f.id, f.socio_id, 'salida', v_quien, v_antes, fichaje_snap(f));
  else
    if fichaje_pisa(p_socio, null, now(), null) then raise exception '% ya tiene un turno cargado que incluye este horario', v_nom; end if;
    insert into fichajes (socio_id, entrada, origen) values (p_socio, now(), 'boton') returning * into f;
    insert into fichajes_log (fichaje_id, socio_id, accion, quien, despues) values (f.id, f.socio_id, 'entrada', v_quien, fichaje_snap(f));
  end if;
  return f;
end $$;

-- ---------- corregir un turno (p_id) o cargar uno olvidado (p_id null) ----------
create or replace function public.fichaje_guardar(p_id uuid, p_socio text, p_entrada timestamptz, p_salida timestamptz, p_motivo text, p_quien text)
returns public.fichajes
language plpgsql security definer set search_path = public as $$
declare v_quien text; f fichajes%rowtype; v_antes jsonb; v_mot text := nullif(left(trim(coalesce(p_motivo, '')), 200), '');
begin
  if not is_staff() then raise exception 'Sin permiso'; end if;
  v_quien := fichaje_quien(p_quien);
  if p_entrada is null then raise exception 'Falta la hora de entrada'; end if;
  if p_entrada > now() + interval '5 minutes' or p_salida > now() + interval '5 minutes' then raise exception 'No se pueden cargar horas que todavía no pasaron'; end if;
  if p_salida is not null and p_salida <= p_entrada then raise exception 'La salida tiene que ser después de la entrada'; end if;
  if p_salida is not null and p_salida - p_entrada > interval '24 hours' then raise exception 'Un turno no puede durar más de 24 horas'; end if;

  if p_id is null then
    if p_salida is null then raise exception 'Falta la hora de salida'; end if;
    if not exists (select 1 from caja_socios where id = p_socio and activo) then raise exception 'Esa persona no está en el equipo'; end if;
    perform pg_advisory_xact_lock(hashtext('fichaje:' || p_socio));
    if fichaje_pisa(p_socio, null, p_entrada, p_salida) then raise exception 'Se pisa con otro turno de la misma persona'; end if;
    insert into fichajes (socio_id, entrada, salida, origen, editado) values (p_socio, p_entrada, p_salida, 'manual', true) returning * into f;
    insert into fichajes_log (fichaje_id, socio_id, accion, quien, despues, motivo) values (f.id, f.socio_id, 'agregar', v_quien, fichaje_snap(f), v_mot);
    return f;
  end if;

  select * into f from fichajes where id = p_id for update;
  if not found then raise exception 'Ese turno ya no existe'; end if;
  if f.anulado then raise exception 'Ese turno está anulado'; end if;
  perform pg_advisory_xact_lock(hashtext('fichaje:' || f.socio_id));
  if f.salida is not null and p_salida is null then raise exception 'Falta la hora de salida'; end if;
  if p_salida is null and now() - p_entrada > interval '16 hours' then raise exception 'Cargá la hora de salida (el turno quedó abierto más de 16 horas)'; end if;
  if f.entrada = p_entrada and f.salida is not distinct from p_salida then return f; end if; -- nada cambió
  if fichaje_pisa(f.socio_id, f.id, p_entrada, p_salida) then raise exception 'Se pisa con otro turno de la misma persona'; end if;
  v_antes := fichaje_snap(f);
  update fichajes set entrada = p_entrada, salida = p_salida, editado = true where id = f.id returning * into f;
  insert into fichajes_log (fichaje_id, socio_id, accion, quien, antes, despues, motivo) values (f.id, f.socio_id, 'editar', v_quien, v_antes, fichaje_snap(f), v_mot);
  return f;
end $$;

-- ---------- anular un turno cargado por error (no se borra) ----------
create or replace function public.fichaje_anular(p_id uuid, p_motivo text, p_quien text) returns public.fichajes
language plpgsql security definer set search_path = public as $$
declare v_quien text; f fichajes%rowtype; v_antes jsonb; v_mot text := nullif(left(trim(coalesce(p_motivo, '')), 200), '');
begin
  if not is_staff() then raise exception 'Sin permiso'; end if;
  v_quien := fichaje_quien(p_quien);
  if v_mot is null then raise exception 'Contá por qué se anula'; end if;
  select * into f from fichajes where id = p_id for update;
  if not found then raise exception 'Ese turno ya no existe'; end if;
  if f.anulado then return f; end if;
  v_antes := fichaje_snap(f);
  update fichajes set anulado = true, anulado_motivo = v_mot, editado = true,
    salida = coalesce(salida, least(greatest(now(), entrada + interval '1 second'), entrada + interval '24 hours'))
  where id = f.id returning * into f;
  insert into fichajes_log (fichaje_id, socio_id, accion, quien, antes, despues, motivo) values (f.id, f.socio_id, 'anular', v_quien, v_antes, fichaje_snap(f), v_mot);
  return f;
end $$;

revoke all on function public.fichaje_marcar(text, text) from public, anon;
revoke all on function public.fichaje_guardar(uuid, text, timestamptz, timestamptz, text, text) from public, anon;
revoke all on function public.fichaje_anular(uuid, text, text) from public, anon;
grant execute on function public.fichaje_marcar(text, text) to authenticated;
grant execute on function public.fichaje_guardar(uuid, text, timestamptz, timestamptz, text, text) to authenticated;
grant execute on function public.fichaje_anular(uuid, text, text) to authenticated;
