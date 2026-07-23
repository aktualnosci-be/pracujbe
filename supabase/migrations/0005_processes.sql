-- =============================================================================
-- 0005_processes.sql
-- Pracuj.be — procesy: aplikacje, dopasowania, propozycje + historie statusów.
--
-- Tabele:
--   applications           UNIQUE(candidate_id, job_id)  — kandydat aplikuje raz na ofertę
--   application_status_history
--   matches                UNIQUE(candidate_id, job_id)  — wynik scoreMatch (cache)
--   offers                 idempotency_key text UNIQUE NOT NULL  — wysyłka idempotentna
--   offer_status_history
--
-- candidate_id = profiles(id); company_id = companies(id); job_id = jobs(id).
-- =============================================================================

-- --- applications -----------------------------------------------------------
create table if not exists applications (
  id              uuid primary key default gen_random_uuid(),
  job_id          uuid not null references jobs(id) on delete cascade,
  candidate_id    uuid not null references profiles(id) on delete cascade,
  company_id      uuid references companies(id) on delete set null,
  status          application_status not null default 'submitted',
  message         text,
  phone           text,
  availability    availability_status,
  locale          text check (locale in ('pl', 'nl', 'fr', 'en')),
  -- ochrona przed podwójnym wysłaniem (APPLICATION_ALREADY_EXISTS)
  idempotency_key text,
  match_score     integer check (match_score >= 0 and match_score <= 100),
  viewed_at       timestamptz,
  submitted_at    timestamptz not null default now(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz,
  unique (candidate_id, job_id)
);

-- idempotency_key unikatowy tylko gdy podany (partial unique index).
create unique index if not exists uq_applications_idempotency_key
  on applications(idempotency_key) where idempotency_key is not null;

create index if not exists idx_applications_job on applications(job_id);
create index if not exists idx_applications_candidate on applications(candidate_id);
create index if not exists idx_applications_company on applications(company_id);
create index if not exists idx_applications_status on applications(status);
create index if not exists idx_applications_job_status on applications(job_id, status);

-- --- application_status_history ---------------------------------------------
create table if not exists application_status_history (
  id             uuid primary key default gen_random_uuid(),
  application_id uuid not null references applications(id) on delete cascade,
  from_status    application_status,
  to_status      application_status not null,
  changed_by     uuid references profiles(id) on delete set null,
  note           text,
  created_at     timestamptz not null default now()
);

create index if not exists idx_application_status_history_application
  on application_status_history(application_id);

-- --- matches: cache wyniku scoreMatch (kandydat x oferta) -------------------
create table if not exists matches (
  id              uuid primary key default gen_random_uuid(),
  candidate_id    uuid not null references profiles(id) on delete cascade,
  job_id          uuid not null references jobs(id) on delete cascade,
  score           integer not null default 0 check (score >= 0 and score <= 100),
  matched         text[] not null default '{}',
  missing         text[] not null default '{}',
  strengths       text[] not null default '{}',
  mandatory_met   integer not null default 0 check (mandatory_met >= 0),
  mandatory_total integer not null default 0 check (mandatory_total >= 0),
  summary_key     text not null default 'low' check (summary_key in ('good', 'partial', 'low')),
  computed_at     timestamptz not null default now(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (candidate_id, job_id)
);

create index if not exists idx_matches_candidate on matches(candidate_id);
create index if not exists idx_matches_job on matches(job_id);
create index if not exists idx_matches_score on matches(score desc);

-- --- offers: proaktywna propozycja pracodawcy do kandydata -----------------
-- idempotency_key: text UNIQUE NOT NULL (wymóg zadania) — ten sam klucz => brak duplikatu.
create table if not exists offers (
  id              uuid primary key default gen_random_uuid(),
  job_id          uuid not null references jobs(id) on delete cascade,
  candidate_id    uuid not null references profiles(id) on delete cascade,
  company_id      uuid references companies(id) on delete set null,
  sender_id       uuid references profiles(id) on delete set null,
  status          offer_status not null default 'draft',
  message         text not null,
  locale          text check (locale in ('pl', 'nl', 'fr', 'en')),
  idempotency_key text not null unique,
  sent_at         timestamptz,
  viewed_at       timestamptz,
  responded_at    timestamptz,
  expires_at      timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz
);

create index if not exists idx_offers_job on offers(job_id);
create index if not exists idx_offers_candidate on offers(candidate_id);
create index if not exists idx_offers_company on offers(company_id);
create index if not exists idx_offers_status on offers(status);

-- --- offer_status_history ---------------------------------------------------
create table if not exists offer_status_history (
  id          uuid primary key default gen_random_uuid(),
  offer_id    uuid not null references offers(id) on delete cascade,
  from_status offer_status,
  to_status   offer_status not null,
  changed_by  uuid references profiles(id) on delete set null,
  note        text,
  created_at  timestamptz not null default now()
);

create index if not exists idx_offer_status_history_offer on offer_status_history(offer_id);
