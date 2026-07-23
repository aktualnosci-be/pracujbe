-- =============================================================================
-- 0008_triggers.sql
-- Pracuj.be — funkcje i triggery.
--
--   * set_updated_at()   — ustawia updated_at = now() na UPDATE (wszystkie tabele z tą kolumną)
--   * handle_new_user()  — tworzy profiles (+ notification_preferences) po INSERT do auth.users
--
-- Triggery updated_at zakładane w pętli po liście tabel (idempotentnie: drop-if-exists).
-- =============================================================================

-- --- set_updated_at() -------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- Załóż trigger set_updated_at na każdą tabelę posiadającą kolumnę updated_at.
do $$
declare
  t text;
  tables text[] := array[
    'profiles', 'candidate_profiles', 'companies', 'employer_profiles', 'company_members',
    'categories', 'occupations', 'skills', 'languages', 'certificates', 'locations',
    'jobs', 'job_translations',
    'applications', 'matches', 'offers',
    'conversations', 'messages', 'notifications', 'notification_preferences', 'email_deliveries',
    'files', 'consent_versions', 'reports', 'discount_codes',
    'subscriptions', 'invoices', 'payments'
  ];
begin
  foreach t in array tables loop
    execute format('drop trigger if exists trg_set_updated_at on public.%I;', t);
    execute format(
      'create trigger trg_set_updated_at before update on public.%I
         for each row execute function public.set_updated_at();',
      t
    );
  end loop;
end $$;

-- --- handle_new_user() ------------------------------------------------------
-- Uruchamiane po INSERT do auth.users. Tworzy powiązany wiersz w profiles,
-- czytając metadane rejestracji (role/first_name/last_name/locale) z raw_user_meta_data.
-- Rola z self-signup jest ograniczona do candidate/employer (admin/moderator tylko ręcznie).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  meta_role text := new.raw_user_meta_data->>'role';
  resolved_role user_role;
  meta_locale text := nullif(new.raw_user_meta_data->>'locale', '');
begin
  if meta_role in ('candidate', 'employer') then
    resolved_role := meta_role::user_role;
  else
    resolved_role := 'candidate'::user_role;
  end if;

  insert into public.profiles (
    id, email, role, first_name, last_name,
    account_locale, signup_locale
  )
  values (
    new.id,
    new.email,
    resolved_role,
    nullif(new.raw_user_meta_data->>'first_name', ''),
    nullif(new.raw_user_meta_data->>'last_name', ''),
    meta_locale,
    meta_locale
  )
  on conflict (id) do nothing;

  insert into public.notification_preferences (profile_id)
  values (new.id)
  on conflict (profile_id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
