-- Bootstrap pustej, wydzielonej bazy PostgreSQL (issue #23), przed migracjami domeny.
-- Wykonuje go wyłącznie migrator postgres. Dotychczasowe SECURITY DEFINER oraz
-- strażniki w 0029/0031/0032/0056 zakładają właściciela postgres; nie zmieniamy
-- tego kontraktu po cichu. Hasło migratora NIE trafia do aplikacji WWW.
-- Role są NOLOGIN: osobne loginy i sekrety provisionuje operator poza repo.
-- Login WWW: NOINHERIT, bez własności, SUPERUSER/BYPASSRLS/CREATEROLE/CREATEDB,
-- członkostwo tylko pracujbe_app. W transakcji jawnie SET LOCAL ROLE anon albo
-- authenticated; po weryfikacji sesji SET LOCAL app.current_uid. Nigdy SET sesyjne.
-- Login zadań uprzywilejowanych jest osobny; tylko on może SET ROLE service_role.
-- Sam GUC nie uwierzytelnia: hasła/sesje i zaufany adapter to osobne issues #24/#25.

do $$
begin
  if current_user <> 'postgres' then
    raise exception 'Bootstrap i migracje wymagają wydzielonego migratora postgres.';
  end if;
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin nosuperuser nocreatedb nocreaterole noinherit nobypassrls;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin nosuperuser nocreatedb nocreaterole noinherit nobypassrls;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin nosuperuser nocreatedb nocreaterole noinherit bypassrls;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'pracujbe_app') then
    create role pracujbe_app nologin nosuperuser nocreatedb nocreaterole noinherit nobypassrls;
  end if;
  if exists (
    select 1 from pg_roles where rolname in ('anon', 'authenticated', 'pracujbe_app', 'service_role')
      and (rolcanlogin or rolsuper or rolcreatedb or rolcreaterole or rolinherit
           or rolbypassrls <> (rolname = 'service_role'))
  ) then
    raise exception 'Istniejące role mają niezgodne uprawnienia. Wymagana kontrola operatora.';
  end if;
  if exists (
    select 1 from pg_auth_members m
      join pg_roles member_role on member_role.oid = m.member
      join pg_roles parent_role on parent_role.oid = m.roleid
    where member_role.rolname in ('anon', 'authenticated', 'pracujbe_app', 'service_role')
      and not (member_role.rolname = 'pracujbe_app' and parent_role.rolname in ('anon', 'authenticated') and not m.admin_option)
  ) then
    raise exception 'Istniejące członkostwa ról wymagają kontroli operatora.';
  end if;
end $$;

grant anon, authenticated to pracujbe_app;
revoke create on schema public from public;
grant usage on schema public to anon, authenticated, service_role;

create extension if not exists pgcrypto;
create extension if not exists citext;
create schema if not exists auth authorization postgres;
revoke all on schema auth from public;
grant usage on schema auth to anon, authenticated, service_role;

-- To jedynie kontrakt FK i triggera handle_new_user, nie magazyn haseł ani sesji.
create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text,
  raw_user_meta_data jsonb not null default '{}'::jsonb
);
revoke all on auth.users from public, anon, authenticated, pracujbe_app;
grant select, insert, update, delete on auth.users to service_role;

create or replace function auth.uid() returns uuid language sql stable
set search_path = pg_catalog as $$
  select nullif(current_setting('app.current_uid', true), '')::uuid
$$;
create or replace function auth.role() returns text language sql stable
set search_path = pg_catalog as $$ select current_user::text $$;
revoke all on function auth.uid(), auth.role() from public;
grant execute on function auth.uid(), auth.role() to anon, authenticated, service_role;

-- Granty stosują się do obiektów tworzonych przez TEGO właściciela migracji.
-- Późniejsze migracje zawężają je REVOKE i RLS; nie nadawaj ponownie ALL po migracji.
alter default privileges for role postgres in schema public
  grant select, insert, update, delete on tables to authenticated;
alter default privileges for role postgres in schema public grant select on tables to anon;
alter default privileges for role postgres in schema public grant all on tables to service_role;

-- Celowo bez schematu storage: migracja 0018 jest wtedy no-op.
-- Prywatne CV, signed URLs i ich autoryzacja wymagają nowego storage w issue #26.
