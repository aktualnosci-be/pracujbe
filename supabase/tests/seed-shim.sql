-- =============================================================================
-- supabase/tests/seed-shim.sql
-- Shim jak supabase/tests/shim.sql, ale z auth.users o kolumnach Supabase Auth
-- (instance_id, aud, role, encrypted_password, ...), których wymaga supabase/seed.sql.
-- Używany przez scripts/test-seed.sh do WERYFIKACJI, że dane demo ładują się bez błędów
-- (FK/enum/triggery) na czystym PostgreSQL — zapobiega regresji „seed się nie wgrywa".
-- =============================================================================
-- Rozszerzony shim do WERYFIKACJI seed.sql (auth.users z kolumnami Supabase Auth).
do $$ begin
  if not exists (select from pg_roles where rolname='anon') then create role anon nologin; end if;
  if not exists (select from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
  if not exists (select from pg_roles where rolname='service_role') then create role service_role nologin bypassrls; end if;
end $$;
create schema if not exists auth;
create table if not exists auth.users(
  instance_id uuid,
  id uuid primary key default gen_random_uuid(),
  aud text,
  role text,
  email text,
  encrypted_password text,
  email_confirmed_at timestamptz,
  raw_app_meta_data jsonb default '{}'::jsonb,
  raw_user_meta_data jsonb default '{}'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('app.current_uid', true),'')::uuid $$;
create or replace function auth.role() returns text language sql stable as $$ select coalesce(nullif(current_setting('app.current_role', true),''),'anon') $$;
create extension if not exists pgcrypto;
create extension if not exists citext;
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant select, insert, update, delete on tables to authenticated;
alter default privileges in schema public grant select on tables to anon;
alter default privileges in schema public grant all on tables to service_role;
