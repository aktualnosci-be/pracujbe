-- Schemat core Better Auth 1.7.5, po bootstrapie i migracjach domenowych 0001–0056.
-- Źródło sprawdzone 21.09.2026: https://better-auth.com/docs/concepts/database
-- Konfiguracja adaptera (do wdrożenia osobno, ten plik NIE uruchamia logowania):
-- pg.Pool: search_path=auth; advanced.database.generateId='uuid'.
-- user.modelName='users'; fields: emailVerified:'email_verified',
--   createdAt:'created_at', updatedAt:'updated_at'. name/email/image/id bez zmiany.
-- session.modelName='sessions'; fields: userId:'user_id', expiresAt:'expires_at',
--   ipAddress:'ip_address', userAgent:'user_agent', createdAt:'created_at',
--   updatedAt:'updated_at'. token/id bez zmiany.
-- account.modelName='accounts'; fields: userId:'user_id', accountId:'account_id',
--   providerId:'provider_id', accessToken:'access_token', refreshToken:'refresh_token',
--   accessTokenExpiresAt:'access_token_expires_at',
--   refreshTokenExpiresAt:'refresh_token_expires_at', idToken:'id_token',
--   createdAt:'created_at', updatedAt:'updated_at'. password/scope/id bez zmiany.
-- verification.modelName='verifications'; fields: expiresAt:'expires_at',
--   createdAt:'created_at', updatedAt:'updated_at'. identifier/value/id bez zmiany.
-- raw_user_meta_data to zgodność istniejącego triggera, NIE publiczne dodatkowe pole API.
-- Hasła są w accounts.password. Nie odtwarzamy Supabase GoTrue ani jego JWT.
-- Rollback wdrożenia: zostawić te rozszerzenia. DROP usuwa sesje/hashe i nie jest
-- bezpiecznym rollbackiem po otwarciu rejestracji; wymaga odrębnej decyzji operatora.

do $$
begin
  if current_user <> 'postgres' then
    raise exception 'Migracja auth wymaga wydzielonego migratora postgres.';
  end if;
  if to_regclass('auth.users') is null or to_regclass('public.profiles') is null then
    raise exception 'Najpierw wykonaj bootstrap i migracje domenowe.';
  end if;
  if not exists (select 1 from pg_roles where rolname = 'pracujbe_auth') then
    create role pracujbe_auth nologin nosuperuser nocreatedb nocreaterole noinherit nobypassrls;
  end if;
  if exists (
    select 1 from pg_roles where rolname = 'pracujbe_auth'
      and (rolcanlogin or rolsuper or rolcreatedb or rolcreaterole or rolinherit or rolbypassrls)
  ) then
    raise exception 'Istniejąca rola auth ma niezgodne uprawnienia.';
  end if;
  if exists (
    select 1 from pg_auth_members m join pg_roles r on r.oid = m.member
    where m.member = 'pracujbe_auth'::regrole
      or (m.roleid = 'pracujbe_auth'::regrole
          and r.rolname in ('anon', 'authenticated', 'pracujbe_app', 'service_role'))
  ) then
    raise exception 'Istniejące członkostwa roli auth wymagają kontroli operatora.';
  end if;
end $$;

-- Zachowujemy tabelę, jej OID, UUID i FK profiles; żadnego DROP/CREATE users.
-- Pusty portal nie wymaga migracji haseł. Ewentualne konta testowe zachowują UUID.
alter table auth.users
  add column name text,
  add column email_verified boolean not null default false,
  add column image text,
  add column created_at timestamptz not null default now(),
  add column updated_at timestamptz not null default now();
update auth.users set name = coalesce(
  nullif(btrim(concat_ws(' ', raw_user_meta_data->>'first_name', raw_user_meta_data->>'last_name')), ''),
  email
);
alter table auth.users alter column name set not null;
-- Nie zgadujemy adresów dla niepoprawnych kont ani nie scalamy duplikatów.
-- NOT NULL/UNIQUE mają odmówić migracji, jeśli zastany stan łamie kontrakt.
alter table auth.users alter column email type public.citext;
alter table auth.users alter column email set not null;
alter table auth.users add constraint auth_users_email_key unique (email);

create table auth.sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  token text not null unique,
  expires_at timestamptz not null,
  ip_address text,
  user_agent text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index auth_sessions_user_id_idx on auth.sessions(user_id);
create index auth_sessions_expires_at_idx on auth.sessions(expires_at);

create table auth.accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  account_id text not null,
  provider_id text not null,
  access_token text,
  refresh_token text,
  access_token_expires_at timestamptz,
  refresh_token_expires_at timestamptz,
  scope text,
  id_token text,
  password text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider_id, account_id)
);
create index auth_accounts_user_id_idx on auth.accounts(user_id);

create table auth.verifications (
  id uuid primary key default gen_random_uuid(),
  identifier text not null,
  value text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index auth_verifications_identifier_idx on auth.verifications(identifier);
create index auth_verifications_expires_at_idx on auth.verifications(expires_at);

-- Login auth operator tworzy osobno: NOINHERIT + członkostwo wyłącznie pracujbe_auth.
-- Login WWW NIE może SET ROLE pracujbe_auth. Serwer auth nie dostaje service_role.
revoke all on schema auth from public, pracujbe_auth;
grant usage on schema auth to pracujbe_auth;
revoke all on auth.users, auth.sessions, auth.accounts, auth.verifications
  from public, anon, authenticated, pracujbe_app, service_role, pracujbe_auth;
grant select, insert, update, delete on auth.users, auth.sessions, auth.accounts, auth.verifications
  to pracujbe_auth;
alter default privileges for role postgres in schema auth
  revoke all on tables from public, anon, authenticated, pracujbe_app, service_role;

alter table auth.users enable row level security;
alter table auth.sessions enable row level security;
alter table auth.accounts enable row level security;
alter table auth.verifications enable row level security;
create policy auth_service_access on auth.users for all to pracujbe_auth
  using (true) with check (true);
create policy auth_service_access on auth.sessions for all to pracujbe_auth
  using (true) with check (true);
create policy auth_service_access on auth.accounts for all to pracujbe_auth
  using (true) with check (true);
create policy auth_service_access on auth.verifications for all to pracujbe_auth
  using (true) with check (true);

comment on table auth.sessions is 'Sesje Better Auth; dostęp tylko z wydzielonego serwera auth.';
comment on table auth.accounts is 'Poświadczenia Better Auth; hasło jest hashem w kolumnie password.';
comment on table auth.verifications is 'Poświadczenia weryfikacji Better Auth; nie logować value.';
