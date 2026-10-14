-- 016 · Arreglo: subir fotos/logos desde el panel daba "new row violates row-level security policy".
-- Subir con reemplazo (upsert) necesita que el equipo pueda leer los archivos del depósito.
create policy "fotos staff lee" on storage.objects for select to authenticated
  using (bucket_id in ('productos','resenas') and public.is_staff());
