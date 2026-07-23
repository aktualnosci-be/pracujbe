-- =============================================================================
-- 0004_candidate_relations.sql
-- Pracuj.be — relacje profilu kandydata + zapisane oferty.
--
-- Tabele: candidate_skills, candidate_languages, candidate_certificates, saved_jobs.
-- Wszystkie wiszą na candidate_profiles(id) i kaskadowo znikają z profilem.
-- skill/certificate mają zarówno opcjonalny FK do słownika, jak i wartość surową (label).
-- =============================================================================

-- --- candidate_skills -------------------------------------------------------
create table if not exists candidate_skills (
  id                   uuid primary key default gen_random_uuid(),
  candidate_profile_id uuid not null references candidate_profiles(id) on delete cascade,
  skill_id             uuid references skills(id) on delete set null,
  skill_label          text not null,
  years                integer check (years >= 0 and years <= 60),
  created_at           timestamptz not null default now(),
  unique (candidate_profile_id, skill_label)
);

create index if not exists idx_candidate_skills_profile on candidate_skills(candidate_profile_id);
create index if not exists idx_candidate_skills_skill on candidate_skills(skill_id);

-- --- candidate_languages ----------------------------------------------------
create table if not exists candidate_languages (
  id                   uuid primary key default gen_random_uuid(),
  candidate_profile_id uuid not null references candidate_profiles(id) on delete cascade,
  language_id          uuid references languages(id) on delete set null,
  language_label       text not null,
  level                language_level not null,
  created_at           timestamptz not null default now(),
  unique (candidate_profile_id, language_label)
);

create index if not exists idx_candidate_languages_profile on candidate_languages(candidate_profile_id);
create index if not exists idx_candidate_languages_language on candidate_languages(language_id);

-- --- candidate_certificates -------------------------------------------------
create table if not exists candidate_certificates (
  id                   uuid primary key default gen_random_uuid(),
  candidate_profile_id uuid not null references candidate_profiles(id) on delete cascade,
  certificate_id       uuid references certificates(id) on delete set null,
  certificate_label    text not null,
  issued_at            date,
  expires_at           date,
  created_at           timestamptz not null default now(),
  unique (candidate_profile_id, certificate_label)
);

create index if not exists idx_candidate_certificates_profile
  on candidate_certificates(candidate_profile_id);
create index if not exists idx_candidate_certificates_certificate
  on candidate_certificates(certificate_id);

-- --- saved_jobs: oferty zapisane przez kandydata ---------------------------
-- candidate_id = profiles(id) (spójnie z applications/matches).
create table if not exists saved_jobs (
  id           uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references profiles(id) on delete cascade,
  job_id       uuid not null references jobs(id) on delete cascade,
  created_at   timestamptz not null default now(),
  unique (candidate_id, job_id)
);

create index if not exists idx_saved_jobs_candidate on saved_jobs(candidate_id);
create index if not exists idx_saved_jobs_job on saved_jobs(job_id);
