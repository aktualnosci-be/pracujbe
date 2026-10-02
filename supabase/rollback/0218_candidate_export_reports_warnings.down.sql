-- =============================================================================
-- Rollback 0218 — eksport danych kandydata bez zgłoszeń treści i ostrzeżeń retencji (#1091).
-- Uruchamiać ręcznie jako migrator, w jednej transakcji (psql -1 -f …), i dopiero wtedy
-- usunąć wpis z app_migrations.history. Plik celowo BEZ BEGIN/COMMIT
-- (supabase/tests/candidate-export-reports-rollback.sql wykonuje go w transakcji i cofa).
-- Przywraca funkcję sprzed 0218 (wewnętrzną część z 0196). Danych nie zmienia.
-- =============================================================================
do $mig$
begin
  if to_regprocedure('public.export_my_data_pre_reports()') is not null then
    drop function if exists public.export_my_data();
    alter function public.export_my_data_pre_reports() rename to export_my_data;
    revoke all on function public.export_my_data() from public, anon;
    grant execute on function public.export_my_data() to authenticated;
  end if;
end
$mig$;
