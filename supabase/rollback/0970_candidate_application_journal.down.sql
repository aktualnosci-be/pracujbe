-- Rollback 0970 (prywatny dziennik aplikacji kandydata, #904). Kolejność: eksport, RPC, tabela.
-- Dane dziennika są tracone (tabela usuwana) — wykonać eksport użytkownikom, jeśli potrzebny.
do $mig$
begin
  if to_regprocedure('public.export_my_data_pre0970()') is not null then
    drop function if exists public.export_my_data();
    alter function public.export_my_data_pre0970() rename to export_my_data;
    revoke all on function public.export_my_data() from public, anon;
    grant execute on function public.export_my_data() to authenticated;
  end if;
end
$mig$;

drop function if exists public.save_application_journal_entry(uuid, uuid, text, text, text, text, date, text, text, date);
drop function if exists public.delete_application_journal_entry(uuid);
drop table if exists public.candidate_application_journal;
