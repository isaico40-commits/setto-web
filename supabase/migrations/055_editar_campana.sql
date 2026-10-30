-- 055 · Editar y borrar campañas de WhatsApp mientras están en borrador.
--   El equipo puede cambiar nombre, segmento, plantilla, variables y código de una campaña que todavía no se mandó.
--   Solo esas columnas: el estado y los números los sigue escribiendo la Edge Function whatsapp-campana.
--   Una campaña ya mandada (o mandándose) no se puede tocar ni borrar.

grant update (nombre, segmento, plantilla, idioma, variables, promo_id) on public.marketing_campaigns to authenticated;
grant delete on public.marketing_campaigns to authenticated;

drop policy if exists marketing_campaigns_staff_update on public.marketing_campaigns;
create policy marketing_campaigns_staff_update on public.marketing_campaigns for update to authenticated
  using (public.is_staff() and estado = 'borrador') with check (public.is_staff() and estado = 'borrador');

drop policy if exists marketing_campaigns_staff_delete on public.marketing_campaigns;
create policy marketing_campaigns_staff_delete on public.marketing_campaigns for delete to authenticated
  using (public.is_staff() and estado = 'borrador');
