-- =============================================================================
-- 0003_jobs.sql
-- Pracuj.be — oferty pracy.
--
-- Tabele: jobs (dane filtrowalne + kanoniczne), job_translations (treść per język),
-- job_requirements (linie wymagań: mandatory/optional), job_skills (link do skills).
--
-- Indeksy pod filtry z GetJobsParams: category, city/region, contract_type, status,
-- published_at, company_id, slug oraz trigram na tytule (keyword).
-- =============================================================================

create table if not exists jobs (
  id                       uuid primary key default gen_random_uuid(),
  company_id               uuid not null references companies(id) on delete cascade,
  created_by               uuid references profiles(id) on delete set null,
  slug                     text not null unique,
  default_locale           text not null default 'pl' check (default_locale in ('pl', 'nl', 'fr', 'en')),
  -- kanoniczny tytuł (fallback, gdy brak tłumaczenia w danym języku)
  title                    text not null,
  status                   job_status not null default 'draft',
  category                 job_category not null,
  occupation               text,
  contract_type            contract_type not null,
  -- lokalizacja
  city                     text not null,
  region                   text not null,
  address                  text,
  remote                   boolean not null default false,
  -- wynagrodzenie
  salary_min               integer check (salary_min >= 0),
  salary_max               integer check (salary_max >= 0),
  currency                 text not null default 'EUR' check (currency ~ '^[A-Z]{3}$'),
  salary_period            salary_period not null default 'month',
  -- grafik i start
  working_hours            text,
  shifts                   text,
  start_immediately        boolean not null default false,
  start_date               date,
  -- wymagania wymiarowe (dla scoreMatch)
  min_experience_years     integer check (min_experience_years >= 0 and min_experience_years <= 60),
  requires_driving_license boolean not null default false,
  -- flagi filtrów listy
  accommodation            boolean not null default false,
  transport                boolean not null default false,
  immediate                boolean not null default false,
  no_language_required      boolean not null default false,
  -- publikacja / metryki
  contact_email            text,
  views_count              integer not null default 0,
  applications_count       integer not null default 0,
  published_at             timestamptz,
  expires_at               timestamptz,
  is_demo                  boolean not null default false,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  deleted_at               timestamptz,
  constraint jobs_salary_range_chk
    check (salary_min is null or salary_max is null or salary_max >= salary_min)
);

-- Indeksy pod filtry ofert (GetJobsParams). Częściowe: tylko aktywne, nieusunięte.
create index if not exists idx_jobs_company on jobs(company_id);
create index if not exists idx_jobs_status on jobs(status) where deleted_at is null;
create index if not exists idx_jobs_category on jobs(category) where deleted_at is null;
create index if not exists idx_jobs_contract_type on jobs(contract_type) where deleted_at is null;
create index if not exists idx_jobs_city on jobs(city) where deleted_at is null;
create index if not exists idx_jobs_region on jobs(region) where deleted_at is null;
create index if not exists idx_jobs_published_at on jobs(published_at desc) where deleted_at is null;
-- najczęstszy wzorzec listy: aktywne oferty danej kategorii, najnowsze pierwsze
create index if not exists idx_jobs_active_feed
  on jobs(status, category, published_at desc) where deleted_at is null;
create index if not exists idx_jobs_slug on jobs(slug);
create index if not exists idx_jobs_title_trgm on jobs using gin(title gin_trgm_ops);

-- --- job_translations: treść lokalizowana per język ------------------------
create table if not exists job_translations (
  id                  uuid primary key default gen_random_uuid(),
  job_id              uuid not null references jobs(id) on delete cascade,
  locale              text not null check (locale in ('pl', 'nl', 'fr', 'en')),
  title               text not null,
  description         text,
  responsibilities    text[] not null default '{}',
  conditions          text[] not null default '{}',
  benefits            text[] not null default '{}',
  highlights          text[] not null default '{}',
  working_hours       text,
  shifts              text,
  company_description text,
  meta_title          text,
  meta_description    text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (job_id, locale)
);

create index if not exists idx_job_translations_job on job_translations(job_id);
create index if not exists idx_job_translations_title_trgm
  on job_translations using gin(title gin_trgm_ops);

-- --- job_requirements: linie wymagań (obowiązkowe / dodatkowe) --------------
create table if not exists job_requirements (
  id         uuid primary key default gen_random_uuid(),
  job_id     uuid not null references jobs(id) on delete cascade,
  locale     text not null default 'pl' check (locale in ('pl', 'nl', 'fr', 'en')),
  kind       requirement_kind not null,
  position   integer not null default 0,
  content    text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_job_requirements_job on job_requirements(job_id);
create index if not exists idx_job_requirements_job_kind on job_requirements(job_id, kind);

-- --- job_skills: umiejętności wymagane przez ofertę -------------------------
-- skill_id (słownik) opcjonalne; skill_label zawsze wypełnione (wartość surowa).
create table if not exists job_skills (
  id           uuid primary key default gen_random_uuid(),
  job_id       uuid not null references jobs(id) on delete cascade,
  skill_id     uuid references skills(id) on delete set null,
  skill_label  text not null,
  is_mandatory boolean not null default false,
  created_at   timestamptz not null default now(),
  unique (job_id, skill_label)
);

create index if not exists idx_job_skills_job on job_skills(job_id);
create index if not exists idx_job_skills_skill on job_skills(skill_id);
