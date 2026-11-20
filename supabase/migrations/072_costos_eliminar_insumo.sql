-- 072 · Costos: eliminar un insumo (si te equivocaste al crearlo).
--
--   costo_insumo_eliminar(p_id, p_por)   lo borra junto con sus precios.
--     · No deja si está en una receta activa: primero hay que sacarlo de ahí.
--     · Si estaba en recetas ocultas, lo saca de esas recetas.
--     · Queda registrado en caja_log (el insumo y sus precios), por si hay que recuperarlo.
--   Además borra los insumos que ya estaban ocultos y sin uso (Café en grano, Limón).
--
-- Se puede correr más de una vez.

create or replace function public.costo_insumo_eliminar(p_id uuid, p_por text)
returns void language plpgsql security definer set search_path = public as $$
declare v_ins costo_insumos; v_recs text; v_pre jsonb;
begin
  if not public.is_staff() then raise exception 'Sin permiso'; end if;
  if coalesce(trim(p_por), '') = '' then raise exception 'Falta quién borra'; end if;
  select * into v_ins from costo_insumos where id = p_id;
  if v_ins.id is null then raise exception 'No encontré ese insumo'; end if;
  select string_agg(distinct r.nombre || coalesce(' ' || r.tamano, ''), ', ') into v_recs
    from costo_receta_lineas l join costo_recetas r on r.id = l.receta_id
   where l.insumo_id = p_id and r.activo;
  if v_recs is not null then raise exception 'Está en: %. Sacalo de esas recetas antes de eliminarlo', v_recs; end if;
  select coalesce(jsonb_agg(to_jsonb(p) order by p.fecha), '[]'::jsonb) into v_pre from costo_precios p where p.insumo_id = p_id;
  delete from costo_receta_lineas where insumo_id = p_id;
  delete from costo_precios where insumo_id = p_id;
  delete from costo_insumos where id = p_id;
  insert into caja_log (tabla, fila_id, accion, por, antes)
  values ('costo_insumo', p_id::text, 'eliminado', p_por, to_jsonb(v_ins) || jsonb_build_object('precios', v_pre));
end $$;
revoke execute on function public.costo_insumo_eliminar(uuid, text) from public, anon;
grant execute on function public.costo_insumo_eliminar(uuid, text) to authenticated;

-- Limpieza: insumos ocultos que nadie usa.
do $$
declare r record;
begin
  for r in select i.* from costo_insumos i
            where not i.activo
              and not exists (select 1 from costo_receta_lineas l where l.insumo_id = i.id)
              and not exists (select 1 from costo_precios p where p.insumo_id = i.id)
  loop
    delete from costo_insumos where id = r.id;
    insert into caja_log (tabla, fila_id, accion, por, antes) values ('costo_insumo', r.id::text, 'eliminado', 'sistema', to_jsonb(r));
  end loop;
end $$;
