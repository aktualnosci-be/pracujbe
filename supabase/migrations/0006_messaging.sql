-- =============================================================================
-- 0006_messaging.sql
-- Pracuj.be — komunikacja: konwersacje, wiadomości, powiadomienia, e-maile.
--
-- Tabele: conversations, conversation_members, messages,
--         notifications, notification_preferences, email_deliveries.
--
-- Reguła języka e-maila = język odbiorcy (resolveRecipientLocale) — email_deliveries.locale.
-- =============================================================================

-- --- conversations ----------------------------------------------------------
create table if not exists conversations (
  id              uuid primary key default gen_random_uuid(),
  type            conversation_type not null default 'direct',
  subject         text,
  company_id      uuid references companies(id) on delete set null,
  job_id          uuid references jobs(id) on delete set null,
  application_id  uuid references applications(id) on delete set null,
  offer_id        uuid references offers(id) on delete set null,
  last_message_at timestamptz,
  created_by      uuid references profiles(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz
);

create index if not exists idx_conversations_company on conversations(company_id);
create index if not exists idx_conversations_job on conversations(job_id);
create index if not exists idx_conversations_application on conversations(application_id);
create index if not exists idx_conversations_offer on conversations(offer_id);
create index if not exists idx_conversations_last_message
  on conversations(last_message_at desc) where deleted_at is null;

-- --- conversation_members ---------------------------------------------------
create table if not exists conversation_members (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations(id) on delete cascade,
  profile_id      uuid not null references profiles(id) on delete cascade,
  last_read_at    timestamptz,
  is_muted        boolean not null default false,
  created_at      timestamptz not null default now(),
  unique (conversation_id, profile_id)
);

create index if not exists idx_conversation_members_conversation
  on conversation_members(conversation_id);
create index if not exists idx_conversation_members_profile
  on conversation_members(profile_id);

-- --- messages ---------------------------------------------------------------
create table if not exists messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations(id) on delete cascade,
  sender_id       uuid references profiles(id) on delete set null,
  body            text not null,
  is_system       boolean not null default false,
  read_at         timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz
);

create index if not exists idx_messages_conversation on messages(conversation_id, created_at);
create index if not exists idx_messages_sender on messages(sender_id);

-- --- notifications ----------------------------------------------------------
create table if not exists notifications (
  id          uuid primary key default gen_random_uuid(),
  profile_id  uuid not null references profiles(id) on delete cascade,
  type        notification_type not null,
  title       text,
  body        text,
  -- ustrukturyzowany kontekst do renderowania / linkowania (i18n w aplikacji)
  data        jsonb not null default '{}'::jsonb,
  entity_type text,
  entity_id   uuid,
  read_at     timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists idx_notifications_profile on notifications(profile_id, created_at desc);
create index if not exists idx_notifications_unread
  on notifications(profile_id) where read_at is null;

-- --- notification_preferences (1:1 z profilem) -----------------------------
create table if not exists notification_preferences (
  id                        uuid primary key default gen_random_uuid(),
  profile_id                uuid not null unique references profiles(id) on delete cascade,
  email_applications        boolean not null default true,
  email_offers              boolean not null default true,
  email_messages            boolean not null default true,
  email_job_matches         boolean not null default true,
  email_marketing           boolean not null default false,
  push_enabled              boolean not null default false,
  in_app_enabled            boolean not null default true,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);

-- --- email_deliveries: log wysyłek (Resend) --------------------------------
create table if not exists email_deliveries (
  id                  uuid primary key default gen_random_uuid(),
  profile_id          uuid references profiles(id) on delete set null,
  to_email            citext not null,
  template            text not null,
  -- język e-maila = język odbiorcy (resolveRecipientLocale)
  locale              text not null default 'en' check (locale in ('pl', 'nl', 'fr', 'en')),
  subject             text,
  status              email_status not null default 'queued',
  provider            text not null default 'resend',
  provider_message_id text,
  error_message       text,
  -- powiązania z encjami wywołującymi wysyłkę
  entity_type         text,
  entity_id           uuid,
  -- klucz idempotencji wysyłki (np. dla propozycji ofertowych)
  idempotency_key     text,
  queued_at           timestamptz not null default now(),
  sent_at             timestamptz,
  delivered_at        timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create unique index if not exists uq_email_deliveries_idempotency_key
  on email_deliveries(idempotency_key) where idempotency_key is not null;
create unique index if not exists uq_email_deliveries_provider_message_id
  on email_deliveries(provider_message_id) where provider_message_id is not null;
create index if not exists idx_email_deliveries_profile on email_deliveries(profile_id);
create index if not exists idx_email_deliveries_status on email_deliveries(status);
create index if not exists idx_email_deliveries_to on email_deliveries(to_email);
