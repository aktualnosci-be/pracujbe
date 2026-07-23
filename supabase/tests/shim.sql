-- =============================================================================
-- supabase/tests/shim.sql
-- Minimalne shimy Supabase do URUCHAMIANIA MIGRACJI I TESTÓW RLS na czystym
-- PostgreSQL (lokalnie oraz w CI — job „rls" w .github/workflows/ci.yml).
--
-- Odtwarza tylko to, czego wymagają migracje/RPC:
--   * role: anon, authenticated (klient), service_role (BYPASSRLS = zaufany serwer),
--   * schemat auth + auth.users (FK z profiles / handle_new_user),
--   * auth.uid()/auth.role() czytające GUC (app.current_uid / app.current_role) —
--     testy „logują" użytkownika przez SET app.current_uid = '<uuid>',
--   * rozszerzenia pgcrypto (gen_random_uuid) i citext (typy e-mail).
--
-- To NIE jest odwzorowanie całego Supabase (brak GoTrue itd.) — wyłącznie kontrakt
-- potrzebny do adwersaryjnej weryfikacji polityk RLS i triggerów integralności.
-- =============================================================================

do $$ begin
  if not exists (select from pg_roles where rolname='anon') then create role anon nologin; end if;
  if not exists (select from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
  if not exists (select from pg_roles where rolname='service_role') then create role service_role nologin bypassrls; end if;
end $$;

create schema if not exists auth;

create table if not exists auth.users(
  id                 uuid primary key default gen_random_uuid(),
  email              text,
  raw_user_meta_data jsonb default '{}'::jsonb
);

-- auth.uid()/auth.role() z GUC — testy ustawiają SET app.current_uid = '<uuid>'.
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('app.current_uid', true), '')::uuid
$$;
create or replace function auth.role() returns text language sql stable as $$
  select coalesce(nullif(current_setting('app.current_role', true), ''), 'anon')
$$;

create extension if not exists pgcrypto;
create extension if not exists citext;

-- Role klienta muszą widzieć schemat/typy publiczne (w Supabase nadane domyślnie).
grant usage on schema public to anon, authenticated, service_role;

-- WIERNE odwzorowanie domyślnych uprawnień Supabase: role anon/authenticated dostają
-- uprawnienia tabelaryczne na public, a właściwy dostęp GATUJE RLS (nie brak grantu).
-- Dzięki temu jawne `revoke ... from anon` w migracjach (np. 0014 dla companies/jobs)
-- ma realny efekt, a bezpośrednie odczyty pod sesją (data loadery) działają jak na proda.
-- ALTER DEFAULT PRIVILEGES działa na tabele TWORZONE PÓŹNIEJ (przez tego samego właściciela),
-- czyli przez kolejne migracje — dlatego shim musi poprzedzać migracje.
alter default privileges in schema public
  grant select, insert, update, delete on tables to authenticated;
alter default privileges in schema public
  grant select on tables to anon;
alter default privileges in schema public
  grant all on tables to service_role;

