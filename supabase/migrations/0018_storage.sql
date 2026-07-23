-- =============================================================================
-- 0018_storage.sql
-- Prywatny bucket na pliki kandydata (CV/dokumenty) + polityki RLS na storage.objects.
-- Invariant #10: pliki wrażliwe TYLKO przez signed URLs, bez publicznych bucketów.
--
-- Uwaga: schemat `storage` istnieje w Supabase, ale NIE na czystym PostgreSQL (testy RLS
-- w CI używają shimu bez `storage`). Dlatego cała migracja jest OWINIĘTA w guard —
-- gdy schematu `storage` brak, staje się no-op (nie psuje suite RLS).
--
-- Ścieżka pliku: '<auth.uid()>/<nazwa>' — pierwszy segment folderu = właściciel; polityki
-- pozwalają operować wyłącznie na własnym folderze.
-- =============================================================================
do $$
begin
  if not exists (select 1 from information_schema.schemata where schema_name = 'storage') then
    raise notice '0018_storage: schemat storage nieobecny — pomijam (środowisko bez Supabase Storage)';
    return;
  end if;

  -- Prywatny bucket (idempotentnie).
  insert into storage.buckets (id, name, public)
    values ('candidate-files', 'candidate-files', false)
  on conflict (id) do nothing;

  -- Polityki: właściciel (auth.uid()) zarządza plikami w SWOIM folderze.
  execute $p$ drop policy if exists candidate_files_insert_own on storage.objects $p$;
  execute $p$
    create policy candidate_files_insert_own on storage.objects
      for insert to authenticated
      with check (
        bucket_id = 'candidate-files'
        and (storage.foldername(name))[1] = auth.uid()::text
      )
  $p$;

  execute $p$ drop policy if exists candidate_files_select_own on storage.objects $p$;
  execute $p$
    create policy candidate_files_select_own on storage.objects
      for select to authenticated
      using (
        bucket_id = 'candidate-files'
        and (storage.foldername(name))[1] = auth.uid()::text
      )
  $p$;

  execute $p$ drop policy if exists candidate_files_update_own on storage.objects $p$;
  execute $p$
    create policy candidate_files_update_own on storage.objects
      for update to authenticated
      using (
        bucket_id = 'candidate-files'
        and (storage.foldername(name))[1] = auth.uid()::text
      )
  $p$;

  execute $p$ drop policy if exists candidate_files_delete_own on storage.objects $p$;
  execute $p$
    create policy candidate_files_delete_own on storage.objects
      for delete to authenticated
      using (
        bucket_id = 'candidate-files'
        and (storage.foldername(name))[1] = auth.uid()::text
      )
  $p$;
end $$;
