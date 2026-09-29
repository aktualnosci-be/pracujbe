-- =============================================================================
-- Rollback 0966 — kontrakt soft-delete i limit CV na konto (#1111, #1101).
-- Uruchamiać ręcznie jako migrator, w jednej transakcji (psql -1 -f …), i dopiero wtedy
-- usunąć wpis z app_migrations.history. Plik celowo BEZ BEGIN/COMMIT.
-- Przywraca polityki odczytu z 0039 (applications, offers) i 0009 (conversations, messages).
-- =============================================================================
drop trigger if exists trg_cv_account_quota on public.files;
drop function if exists public.enforce_cv_account_quota();

drop trigger if exists trg_soft_delete_contract on public.applications;
drop trigger if exists trg_soft_delete_contract on public.offers;
drop trigger if exists trg_soft_delete_contract on public.messages;
drop function if exists public.enforce_soft_delete_contract();

drop policy if exists applications_select on public.applications;
create policy applications_select on public.applications
  for select to authenticated
  using (candidate_id = auth.uid() or public.is_job_manager(job_id));
drop policy if exists offers_select on public.offers;
create policy offers_select on public.offers
  for select to authenticated
  using (candidate_id = auth.uid() or public.is_job_manager(job_id));
drop policy if exists conversations_select_member on public.conversations;
create policy conversations_select_member on public.conversations
  for select to authenticated
  using (public.is_conversation_member(id));
drop policy if exists messages_select_member on public.messages;
create policy messages_select_member on public.messages
  for select to authenticated
  using (public.is_conversation_member(conversation_id));
