-- 061 · Auditoría de seguridad (2026-11-10): cerrar funciones públicas que la web ya no usa.
-- La web llama create_order_v6 (sin código) y create_order_v7 (con código), y create_review_v2 / create_review_track.
-- Las versiones viejas quedaban abiertas a cualquiera con la clave anon. No se borran: solo se les quita el permiso.
-- Para deshacer: grant execute on function ... to anon, authenticated;

revoke execute on function public.create_order(text, text, jsonb, text, text, text) from public, anon, authenticated;
revoke execute on function public.create_order_v2(text, text, jsonb, text, text, text, text, text) from public, anon, authenticated;
revoke execute on function public.create_order_v3(text, text, jsonb, text, text, text, text, text, text) from public, anon, authenticated;
revoke execute on function public.create_order_v4(text, text, jsonb, text, text, text, text, text, text) from public, anon, authenticated;
revoke execute on function public.create_order_v5(text, text, jsonb, text, text, text, text, text, text, text) from public, anon, authenticated;
revoke execute on function public.create_review(text, text, integer, text) from public, anon, authenticated;
