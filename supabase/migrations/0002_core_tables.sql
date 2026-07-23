-- =============================================================================
-- 0002_core_tables.sql
-- Pracuj.be — tożsamość, firmy i słowniki.
--
-- Grupy:
--   * Tożsamość/role: profiles (1:1 z auth.users), candidate_profiles, employer_profiles
--   * Firmy: companies, company_members
--   * Słowniki: categories, occupations, skills, languages, certificates, locations
--
-- Konwencje: UUID PK gen_random_uuid(), created_at/updated_at timestamptz default now(),
-- deleted_at (soft delete) tam gdzie sensowne, is_demo na danych treściowych.
-- Kolumny *_locale to text z CHECK na wspieranych językach (pl/nl/fr/en); NULL dozwolony
-- (resolveRecipientLocale i tak filtruje nieznane wartości i fallbackuje do 'en').
-- =============================================================================

-- --- profiles: 1:1 z auth.users --------------------------------------------
-- id = auth.users.id (bez własnego gen_random_uuid — profil jest rozszerzeniem konta Auth).
create table if not exists profiles (
  id               uuid primary key references auth.users(id) on delete cascade,
  role             user_role not null default 'candidate',
  email            citext,
  first_name       text,
  last_name        text,
  phone            text,
  avatar_url       text,
  -- preferowany język komunikacji (ustawiany świadomie przez użytkownika)
  preferred_locale text check (preferred_locale in ('pl', 'nl', 'fr', 'en')),
  -- język konta (UI) w chwili ostatniej zmiany ustawień
  account_locale   text check (account_locale in ('pl', 'nl', 'fr', 'en')),
  -- język w chwili rejestracji (niezmienny, do statystyk/fallbacku)
  signup_locale    text check (signup_locale in ('pl', 'nl', 'fr', 'en')),
  is_active        boolean not null default true,
  last_seen_at     timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  deleted_at       timestamptz
);

comment on table profiles is 'Rozszerzenie auth.users 1:1. Tworzone triggerem handle_new_user() po rejestracji.';

create index if not exists idx_profiles_role on profiles(role) where deleted_at is null;
create index if not exists idx_profiles_email on profiles(email);

-- --- candidate_profiles: dane kandydata (model = MatchCandidate) ------------
create table if not exists candidate_profiles (
  id                       uuid primary key default gen_random_uuid(),
  profile_id               uuid not null unique references profiles(id) on delete cascade,
  headline                 text,
  bio                      text,
  -- lokalizacja i mobilność
  city                     text,
  region                   text,
  radius_km                integer not null default 25 check (radius_km >= 0 and radius_km <= 300),
  has_driving_license      boolean not null default false,
  has_car                  boolean not null default false,
  -- doświadczenie i dostępność
  experience_years         integer check (experience_years >= 0 and experience_years <= 60),
  availability             availability_status,
  -- preferencje
  occupations              text[] not null default '{}',
  categories               job_category[] not null default '{}',
  preferred_contract_types contract_type[] not null default '{}',
  expected_salary_min      integer check (expected_salary_min >= 0),
  expected_salary_currency text not null default 'EUR' check (expected_salary_currency ~ '^[A-Z]{3}$'),
  -- widoczność profilu dla pracodawców (proaktywne oferty)
  is_searchable            boolean not null default true,
  profile_completed        boolean not null default false,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  deleted_at               timestamptz
);

create index if not exists idx_candidate_profiles_city on candidate_profiles(city);
create index if not exists idx_candidate_profiles_region on candidate_profiles(region);
create index if not exists idx_candidate_profiles_searchable
  on candidate_profiles(is_searchable) where deleted_at is null;
create index if not exists idx_candidate_profiles_categories on candidate_profiles using gin(categories);

-- --- companies: firmy pracodawców ------------------------------------------
create table if not exists companies (
  id                 uuid primary key default gen_random_uuid(),
  name               text not null,
  slug               text unique,
  status             company_status not null default 'unverified',
  -- dane rejestrowe (KBO/BCE w Belgii)
  vat_number         text,
  registration_number text,
  website            text,
  logo_url           text,
  description        text,
  email              citext,
  phone              text,
  city               text,
  region             text,
  address            text,
  postal_code        text,
  country            text not null default 'BE',
  size_label         text,
  industry           text,
  verified_at        timestamptz,
  verified_by        uuid references profiles(id) on delete set null,
  is_demo            boolean not null default false,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  deleted_at         timestamptz
);

create index if not exists idx_companies_status on companies(status) where deleted_at is null;
create index if not exists idx_companies_slug on companies(slug);
create index if not exists idx_companies_name_trgm on companies using gin(name gin_trgm_ops);

-- --- employer_profiles: dane pracodawcy (osoby) ----------------------------
-- Podstawowa firma pracodawcy; przynależności wielofirmowe idą przez company_members.
create table if not exists employer_profiles (
  id                 uuid primary key default gen_random_uuid(),
  profile_id         uuid not null unique references profiles(id) on delete cascade,
  primary_company_id uuid references companies(id) on delete set null,
  job_title          text,
  phone              text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  deleted_at         timestamptz
);

create index if not exists idx_employer_profiles_company on employer_profiles(primary_company_id);

-- --- company_members: przynależność osoby do firmy + rola -------------------
create table if not exists company_members (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references companies(id) on delete cascade,
  profile_id   uuid not null references profiles(id) on delete cascade,
  role         company_member_role not null default 'member',
  is_active    boolean not null default true,
  invited_by   uuid references profiles(id) on delete set null,
  invited_at   timestamptz,
  joined_at    timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (company_id, profile_id)
);

create index if not exists idx_company_members_company on company_members(company_id);
create index if not exists idx_company_members_profile on company_members(profile_id);
create index if not exists idx_company_members_active
  on company_members(company_id) where is_active = true;

-- =============================================================================
-- Słowniki (dictionaries). Etykiety UI tłumaczone w aplikacji (next-intl);
-- kolumna `key`/`slug` jest stabilnym identyfikatorem, `name` to etykieta domyślna.
-- =============================================================================

-- --- categories: klucz = job_category enum ---------------------------------
create table if not exists categories (
  id         uuid primary key default gen_random_uuid(),
  key        job_category not null unique,
  name       text not null,
  icon       text,
  sort_order integer not null default 0,
  is_active  boolean not null default true,
  is_demo    boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- --- occupations: zawody (opcjonalnie przypięte do kategorii) ---------------
create table if not exists occupations (
  id           uuid primary key default gen_random_uuid(),
  slug         text not null unique,
  name         text not null,
  category_key job_category references categories(key) on delete set null,
  sort_order   integer not null default 0,
  is_active    boolean not null default true,
  is_demo      boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists idx_occupations_category on occupations(category_key);
create index if not exists idx_occupations_name_trgm on occupations using gin(name gin_trgm_ops);

-- --- skills: umiejętności ---------------------------------------------------
create table if not exists skills (
  id           uuid primary key default gen_random_uuid(),
  slug         text not null unique,
  name         text not null,
  category_key job_category references categories(key) on delete set null,
  is_active    boolean not null default true,
  is_demo      boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists idx_skills_name_trgm on skills using gin(name gin_trgm_ops);

-- --- languages: języki (dla wymagań ofert / profili) -----------------------
create table if not exists languages (
  id         uuid primary key default gen_random_uuid(),
  code       text not null unique,
  name       text not null,
  sort_order integer not null default 0,
  is_active  boolean not null default true,
  is_demo    boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- --- certificates: certyfikaty / uprawnienia -------------------------------
create table if not exists certificates (
  id         uuid primary key default gen_random_uuid(),
  slug       text not null unique,
  name       text not null,
  is_active  boolean not null default true,
  is_demo    boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- --- locations: miasta/regiony (klucz = LocationKey dla wyróżnionych) -------
create table if not exists locations (
  id         uuid primary key default gen_random_uuid(),
  slug       text not null unique,
  name       text not null,
  region     text,
  province   text,
  country    text not null default 'BE',
  latitude   numeric(9,6),
  longitude  numeric(9,6),
  sort_order integer not null default 0,
  is_active  boolean not null default true,
  is_demo    boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_locations_name_trgm on locations using gin(name gin_trgm_ops);
