-- 030 · Consentimientos de marketing (P0 del CRM).
--   Cada permiso queda registrado con canal, finalidad, origen, fecha y versión del aviso. Las bajas no borran
--   nada: suman una fila "revocado". Vale la última fila de cada celular y canal.
--   Nadie queda autorizado por haber comprado o por estar en el Setto Club: solo cuenta lo que el cliente marcó.
--   Toda automatización (WhatsApp, audiencias de Meta) tiene que preguntar a puede_contactar() antes de usar un número.
--   No borra nada.

create table if not exists public.customer_consents (
  id            bigserial primary key,
  phone         text not null,
  canal         text not null check (canal in ('whatsapp','meta_ads')),
  finalidad     text not null check (finalidad in ('novedades','publicidad')),
  estado        text not null check (estado in ('otorgado','revocado')),
  origen        text not null check (origen in ('checkout_web','preferencias_web','panel','whatsapp')),
  aviso_version text,
  order_id      uuid references public.orders(id) on delete set null,
  created_by    uuid,
  created_at    timestamptz not null default now()
);
create index if not exists customer_consents_phone on public.customer_consents(phone, canal, created_at desc);

alter table public.customer_consents enable row level security;
drop policy if exists customer_consents_staff_read on public.customer_consents;
create policy customer_consents_staff_read on public.customer_consents for select to authenticated using (public.is_staff());
-- sin políticas de insert/update/delete: solo se escribe por las funciones de abajo
revoke all on public.customer_consents from anon;
grant select on public.customer_consents to authenticated;

-- ¿se le puede escribir / usar para anuncios? Única fuente de verdad para las automatizaciones.
create or replace function public.puede_contactar(p_phone text, p_canal text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select estado = 'otorgado' from customer_consents
                   where phone = public.norm_phone(p_phone) and canal = p_canal
                   order by created_at desc, id desc limit 1), false);
$$;
revoke all on function public.puede_contactar(text,text) from public, anon;
grant execute on function public.puede_contactar(text,text) to authenticated, service_role;

-- el cliente marcó las casillas al hacer el pedido. Se valida con el código y el celular del pedido recién hecho.
create or replace function public.registrar_consentimiento(p_code text, p_phone text, p_canales text[], p_version text) returns void
language plpgsql security definer set search_path = public as $$
declare o record; c text;
begin
  select id, phone into o from orders
   where code = p_code and phone = public.norm_phone(p_phone) and status = 'pendiente' and created_at > now() - interval '1 day'
   order by created_at desc limit 1;
  if o.id is null then return; end if;
  foreach c in array coalesce(p_canales, '{}') loop
    if c in ('whatsapp','meta_ads') and not public.puede_contactar(o.phone, c) then
      insert into customer_consents(phone, canal, finalidad, estado, origen, aviso_version, order_id)
      values (o.phone, c, case c when 'whatsapp' then 'novedades' else 'publicidad' end, 'otorgado', 'checkout_web', left(p_version, 20), o.id);
    end if;
  end loop;
end $$;
revoke all on function public.registrar_consentimiento(text,text,text[],text) from public;
grant execute on function public.registrar_consentimiento(text,text,text[],text) to anon, authenticated;

-- baja desde la web: cualquiera puede dar de baja un número (darse de baja tiene que ser fácil).
-- No dice si el número existía, para no revelar quién es cliente.
create or replace function public.baja_marketing(p_phone text, p_canal text default null) returns void
language plpgsql security definer set search_path = public as $$
declare ph text := public.norm_phone(p_phone); c text;
begin
  if ph is null then raise exception 'Revisá el número: código de área + número, por ejemplo 223 347-1277.'; end if;
  foreach c in array array['whatsapp','meta_ads'] loop
    if (p_canal is null or p_canal = c) and public.puede_contactar(ph, c) then
      insert into customer_consents(phone, canal, finalidad, estado, origen, created_by)
      values (ph, c, case c when 'whatsapp' then 'novedades' else 'publicidad' end, 'revocado',
              case when public.is_staff() then 'panel' else 'preferencias_web' end, auth.uid());
    end if;
  end loop;
end $$;
revoke all on function public.baja_marketing(text,text) from public;
grant execute on function public.baja_marketing(text,text) to anon, authenticated;
