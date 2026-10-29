-- 049: 1 premio de la maquinita por celular cada 7 días.
-- Abrir pestañas de incógnito da tiradas nuevas (hasta el tope por red), pero el premio solo sirve si se guarda con el celular.
-- Si ese celular ya guardó un premio en los últimos 7 días (usado o no), no puede guardar otro. Los premios ya guardados no cambian.

create or replace function public.maq_reclamar(p_dev text, p_phone text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_dev text := public.maq_dev_ok(p_dev);
  v_phone text := public.norm_phone(p_phone);
  mp maq_premios%rowtype;
begin
  if v_dev is null then raise exception 'Recargá la página y probá de nuevo'; end if;
  if v_phone is null then raise exception 'Revisá tu celular'; end if;
  select * into mp from maq_premios where dev = v_dev and estado = 'pendiente' and public.maq_vigente(vence_at) order by created_at desc limit 1 for update;
  if not found then raise exception 'No encontramos un premio para guardar (duran 48 hs)'; end if;
  if exists (select 1 from maq_premios where phone = v_phone and estado in ('activo','usado') and created_at > now() - interval '7 days') then
    raise exception 'Ese celular ya tiene un premio de la maquinita esta semana. Podés guardar otro a los 7 días.';
  end if;
  update maq_tiradas set phone = v_phone where premio in (select id from maq_premios where dev = v_dev and estado = 'pendiente' and public.maq_vigente(vence_at));
  update maq_premios set phone = v_phone, estado = 'activo' where dev = v_dev and estado = 'pendiente' and public.maq_vigente(vence_at);
  return jsonb_build_object('code', mp.code, 'titulo', mp.titulo, 'tipo', mp.tipo, 'valor', mp.valor, 'saldo', mp.saldo, 'vence_at', mp.vence_at);
end $$;
