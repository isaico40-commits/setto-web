-- 050: permiso de marketing anotado por el equipo desde el panel (Club → Sumar sellos a mano, o la ficha del cliente).
-- Para clientes que piden por WhatsApp directo o por apps y le dicen al equipo que quieren recibir novedades.
-- Solo cuenta si alguien del equipo lo tilda: no se autoriza a nadie por estar en el Club.
-- Queda con origen 'panel', aviso_version 'panel-dicho' y quién lo cargó (created_by).
-- Si el cliente se había dado de baja de ese canal, el panel no lo vuelve a dar de alta: tiene que escribir ALTA al WhatsApp.
-- No borra nada.

create or replace function public.consentimiento_panel(p_phone text, p_canales text[]) returns jsonb
language plpgsql security definer set search_path = public as $$
declare ph text := public.norm_phone(p_phone); c text; ult text; ok text[] := '{}'; baja text[] := '{}';
begin
  if not public.is_staff() then raise exception 'Solo el equipo puede hacer esto'; end if;
  if ph is null then raise exception 'Número de celular inválido'; end if;
  foreach c in array coalesce(p_canales, '{}') loop
    if c not in ('whatsapp','meta_ads') then continue; end if;
    select estado into ult from customer_consents where phone = ph and canal = c order by created_at desc, id desc limit 1;
    if ult = 'otorgado' then continue; end if;
    if ult = 'revocado' then baja := baja || c; continue; end if;
    insert into customer_consents(phone, canal, finalidad, estado, origen, aviso_version, created_by)
    values (ph, c, case c when 'whatsapp' then 'novedades' else 'publicidad' end, 'otorgado', 'panel', 'panel-dicho', auth.uid());
    ok := ok || c;
  end loop;
  return jsonb_build_object('phone', ph, 'otorgados', ok, 'dados_de_baja', baja);
end $$;
revoke all on function public.consentimiento_panel(text,text[]) from public, anon;
grant execute on function public.consentimiento_panel(text,text[]) to authenticated;
