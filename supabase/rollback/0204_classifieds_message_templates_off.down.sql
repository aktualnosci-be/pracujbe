-- =============================================================================
-- Rollback 0204 — tryb ogłoszeniowy: szablony odpowiedzi firmy (#1211).
-- Uruchamiać ręcznie jako migrator, w jednej transakcji (psql -1 -f …), i dopiero wtedy
-- usunąć wpis z app_migrations.history. Plik celowo BEZ BEGIN/COMMIT.
-- Usuwa strażniki tabel i nakładki RPC; treść z 0170 wraca pod swoje nazwy (granty jak w 0170).
-- =============================================================================

drop trigger if exists trg_aa_recruitment_mode on public.company_message_templates;
drop trigger if exists trg_aa_recruitment_mode on public.company_message_template_variants;
drop function if exists public.enforce_recruitment_message_template();

drop function if exists public.save_company_message_template(uuid, uuid, text, jsonb, timestamptz);
alter function public.save_company_message_template_impl(uuid, uuid, text, jsonb, timestamptz)
  rename to save_company_message_template;
revoke all on function public.save_company_message_template(uuid, uuid, text, jsonb, timestamptz) from public, anon;
grant execute on function public.save_company_message_template(uuid, uuid, text, jsonb, timestamptz) to authenticated;

drop function if exists public.delete_company_message_template(uuid, uuid);
alter function public.delete_company_message_template_impl(uuid, uuid)
  rename to delete_company_message_template;
revoke all on function public.delete_company_message_template(uuid, uuid) from public, anon;
grant execute on function public.delete_company_message_template(uuid, uuid) to authenticated;
