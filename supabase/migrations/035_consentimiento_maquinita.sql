-- 035: permiso de WhatsApp desde la maquinita.
-- La maquinita pide el celular para guardar fichas y premios. Ahí se suma una casilla opcional
-- "Avisame por WhatsApp de novedades". Si la marca, queda un consentimiento igual al del checkout
-- (canal whatsapp, finalidad novedades) con origen 'maquinita'. No se manda nada: las campañas
-- siguen preguntando a puede_contactar() antes de usar un número.

alter table public.customer_consents drop constraint customer_consents_origen_check;
alter table public.customer_consents add constraint customer_consents_origen_check
  check (origen in ('checkout_web','preferencias_web','panel','whatsapp','maquinita'));

create or replace function public.consentimiento_maquinita(p_phone text, p_version text) returns void
language plpgsql security definer set search_path = public as $$
declare ph text := public.norm_phone(p_phone);
begin
  if ph is null then raise exception 'Revisá tu celular'; end if;
  if not public.puede_contactar(ph, 'whatsapp') then
    insert into customer_consents(phone, canal, finalidad, estado, origen, aviso_version)
    values (ph, 'whatsapp', 'novedades', 'otorgado', 'maquinita', left(p_version, 20));
  end if;
end $$;
revoke all on function public.consentimiento_maquinita(text,text) from public;
grant execute on function public.consentimiento_maquinita(text,text) to anon, authenticated;
