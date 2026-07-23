-- =============================================================================
-- 0007_misc.sql
-- Pracuj.be — pliki, zgody, zgłoszenia, płatności, audyt.
--
-- Grupy:
--   Pliki/zgody/zgłoszenia: files, consents, consent_versions, reports
--   Płatności: subscriptions, payments, invoices, discount_codes
--   Audyt: audit_logs, system_events
--
-- Pliki wrażliwe = signed URL (visibility='private'). RLS/polityki dostępu w osobnej migracji.
-- =============================================================================

-- --- files: metadane obiektów w Storage ------------------------------------
create table if not exists files (
  id           uuid primary key default gen_random_uuid(),
  owner_id     uuid references profiles(id) on delete set null,
  bucket       text not null,
  path         text not null,
  file_name    text,
  mime_type    text,
  size_bytes   bigint check (size_bytes >= 0),
  visibility   file_visibility not null default 'private',
  entity_type  text,
  entity_id    uuid,
  is_demo      boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz,
  unique (bucket, path)
);

create index if not exists idx_files_owner on files(owner_id);
create index if not exists idx_files_entity on files(entity_type, entity_id);

-- --- consent_versions: wersje dokumentów prawnych (terms/privacy/cookies) ---
create table if not exists consent_versions (
  id           uuid primary key default gen_random_uuid(),
  document     text not null,                 -- 'terms' | 'privacy' | 'cookies' | ...
  version      text not null,
  locale       text check (locale in ('pl', 'nl', 'fr', 'en')),
  content_url  text,
  is_current   boolean not null default false,
  published_at timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (document, version, locale)
);

create index if not exists idx_consent_versions_document on consent_versions(document);
create index if not exists idx_consent_versions_current
  on consent_versions(document) where is_current = true;

-- --- consents: zgody użytkownika / sesji (cookies + regulaminy) -------------
-- profile_id opcjonalne (zgoda anonimowej sesji przed logowaniem); wtedy liczy się visitor_id.
create table if not exists consents (
  id                 uuid primary key default gen_random_uuid(),
  profile_id         uuid references profiles(id) on delete cascade,
  visitor_id         text,
  category           consent_category not null,
  granted            boolean not null,
  consent_version_id uuid references consent_versions(id) on delete set null,
  source             text,
  ip_address         inet,
  user_agent         text,
  created_at         timestamptz not null default now()
);

create index if not exists idx_consents_profile on consents(profile_id);
create index if not exists idx_consents_visitor on consents(visitor_id);
create index if not exists idx_consents_category on consents(category);

-- --- reports: zgłoszenia treści/kont --------------------------------------
create table if not exists reports (
  id           uuid primary key default gen_random_uuid(),
  reporter_id  uuid references profiles(id) on delete set null,
  target_type  report_target_type not null,
  target_id    uuid not null,
  reason       text not null,
  details      text,
  status       report_status not null default 'open',
  resolved_by  uuid references profiles(id) on delete set null,
  resolved_at  timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists idx_reports_status on reports(status);
create index if not exists idx_reports_target on reports(target_type, target_id);
create index if not exists idx_reports_reporter on reports(reporter_id);

-- --- discount_codes ---------------------------------------------------------
create table if not exists discount_codes (
  id               uuid primary key default gen_random_uuid(),
  code             text not null unique,
  description      text,
  percent_off      integer check (percent_off >= 0 and percent_off <= 100),
  amount_off_cents integer check (amount_off_cents >= 0),
  currency         text default 'EUR' check (currency is null or currency ~ '^[A-Z]{3}$'),
  max_redemptions  integer check (max_redemptions is null or max_redemptions >= 0),
  times_redeemed   integer not null default 0 check (times_redeemed >= 0),
  valid_from       timestamptz,
  valid_until      timestamptz,
  is_active        boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists idx_discount_codes_active on discount_codes(code) where is_active = true;

-- --- subscriptions: plany firm ---------------------------------------------
create table if not exists subscriptions (
  id                     uuid primary key default gen_random_uuid(),
  company_id             uuid not null references companies(id) on delete cascade,
  plan                   text not null,
  status                 subscription_status not null default 'trialing',
  discount_code_id       uuid references discount_codes(id) on delete set null,
  provider               text,
  provider_customer_id   text,
  provider_subscription_id text,
  quantity               integer not null default 1 check (quantity >= 0),
  trial_ends_at          timestamptz,
  current_period_start   timestamptz,
  current_period_end     timestamptz,
  cancel_at              timestamptz,
  canceled_at            timestamptz,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  deleted_at             timestamptz
);

create index if not exists idx_subscriptions_company on subscriptions(company_id);
create index if not exists idx_subscriptions_status on subscriptions(status);
create unique index if not exists uq_subscriptions_provider_id
  on subscriptions(provider_subscription_id) where provider_subscription_id is not null;

-- --- invoices ---------------------------------------------------------------
create table if not exists invoices (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references companies(id) on delete cascade,
  subscription_id uuid references subscriptions(id) on delete set null,
  number        text unique,
  status        invoice_status not null default 'draft',
  amount_cents  integer not null default 0 check (amount_cents >= 0),
  tax_cents     integer not null default 0 check (tax_cents >= 0),
  currency      text not null default 'EUR' check (currency ~ '^[A-Z]{3}$'),
  pdf_file_id   uuid references files(id) on delete set null,
  issued_at     timestamptz,
  due_at        timestamptz,
  paid_at       timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists idx_invoices_company on invoices(company_id);
create index if not exists idx_invoices_subscription on invoices(subscription_id);
create index if not exists idx_invoices_status on invoices(status);

-- --- payments ---------------------------------------------------------------
create table if not exists payments (
  id                 uuid primary key default gen_random_uuid(),
  company_id         uuid not null references companies(id) on delete cascade,
  subscription_id    uuid references subscriptions(id) on delete set null,
  invoice_id         uuid references invoices(id) on delete set null,
  status             payment_status not null default 'pending',
  amount_cents       integer not null default 0 check (amount_cents >= 0),
  currency           text not null default 'EUR' check (currency ~ '^[A-Z]{3}$'),
  provider           text,
  provider_payment_id text,
  paid_at            timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index if not exists idx_payments_company on payments(company_id);
create index if not exists idx_payments_invoice on payments(invoice_id);
create index if not exists idx_payments_status on payments(status);
create unique index if not exists uq_payments_provider_id
  on payments(provider_payment_id) where provider_payment_id is not null;

-- --- audit_logs: ślad wrażliwych operacji ----------------------------------
create table if not exists audit_logs (
  id          uuid primary key default gen_random_uuid(),
  actor_id    uuid references profiles(id) on delete set null,
  action      text not null,
  entity_type text,
  entity_id   uuid,
  before_data jsonb,
  after_data  jsonb,
  ip_address  inet,
  user_agent  text,
  created_at  timestamptz not null default now()
);

create index if not exists idx_audit_logs_actor on audit_logs(actor_id);
create index if not exists idx_audit_logs_entity on audit_logs(entity_type, entity_id);
create index if not exists idx_audit_logs_created on audit_logs(created_at desc);

-- --- system_events: zdarzenia techniczne / diagnostyka ---------------------
create table if not exists system_events (
  id         uuid primary key default gen_random_uuid(),
  type       text not null,
  level      text not null default 'info' check (level in ('debug', 'info', 'warning', 'error', 'critical')),
  message    text,
  context    jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_system_events_type on system_events(type);
create index if not exists idx_system_events_level on system_events(level);
create index if not exists idx_system_events_created on system_events(created_at desc);
