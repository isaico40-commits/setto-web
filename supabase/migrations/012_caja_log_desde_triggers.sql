-- 012 · Arreglo: anular un movimiento (o un movimiento de stock) daba
-- "new row violates row-level security policy for table caja_log".
-- Los triggers escriben el historial con permisos propios; el historial sigue sin poder escribirse a mano.
alter function public.caja_mov_guard() security definer;
alter function public.caja_stock_guard() security definer;
revoke execute on function public.caja_mov_guard() from public, anon, authenticated;
revoke execute on function public.caja_stock_guard() from public, anon, authenticated;
