-- =============================================================================
-- 0001_extensions_and_enums.sql
-- Pracuj.be — rozszerzenia Postgres + typy wyliczeniowe (enumy).
--
-- Wykonywane jako pierwsze (prefiks 0001). Wszystkie kolejne migracje zakładają,
-- że rozszerzenia i enumy już istnieją.
--
-- Konwencje:
--   * gen_random_uuid() pochodzi z pgcrypto -> UUID PK we wszystkich tabelach.
--   * pg_trgm -> indeksy trigramowe pod wyszukiwanie ofert po słowie kluczowym.
--   * citext -> adresy e-mail bez rozróżniania wielkości liter.
-- Enumy są idempotentne (guard: pg_type) — bezpieczne przy ponownym uruchomieniu.
-- =============================================================================

create extension if not exists pgcrypto;
create extension if not exists pg_trgm;
create extension if not exists citext;

-- --- Role użytkownika (profiles.role) ---------------------------------------
-- Role na poziomie firmy (owner/admin/recruiter/member) trzyma company_members.
do $$ begin
  create type user_role as enum ('candidate', 'employer', 'admin', 'moderator');
exception when duplicate_object then null; end $$;

-- --- Rola członka firmy (company_members.role) ------------------------------
do $$ begin
  create type company_member_role as enum ('owner', 'admin', 'recruiter', 'member');
exception when duplicate_object then null; end $$;

-- --- Status weryfikacji firmy ----------------------------------------------
do $$ begin
  create type company_status as enum ('unverified', 'pending', 'verified', 'rejected', 'suspended');
exception when duplicate_object then null; end $$;

-- --- Status oferty pracy ----------------------------------------------------
do $$ begin
  create type job_status as enum ('draft', 'active', 'paused', 'closed', 'expired');
exception when duplicate_object then null; end $$;

-- --- Kategoria oferty (odpowiada CategoryKey z @/lib/jobs) ------------------
do $$ begin
  create type job_category as enum (
    'construction', 'transport', 'warehouse', 'production', 'technical',
    'cleaning', 'hospitality', 'care', 'logistics', 'seasonal'
  );
exception when duplicate_object then null; end $$;

-- --- Typ umowy (odpowiada ContractType z @/lib/jobs) -----------------------
do $$ begin
  create type contract_type as enum (
    'permanent', 'temporary', 'interim', 'freelance', 'internship', 'seasonal'
  );
exception when duplicate_object then null; end $$;

-- --- Okres wynagrodzenia (validation/job.ts: SALARY_PERIODS) ---------------
do $$ begin
  create type salary_period as enum ('hour', 'month', 'year');
exception when duplicate_object then null; end $$;

-- --- Dostępność kandydata (validation/candidate.ts: AVAILABILITY_VALUES) ----
do $$ begin
  create type availability_status as enum (
    'immediate', 'within_month', 'within_three_months', 'flexible'
  );
exception when duplicate_object then null; end $$;

-- --- Poziom języka (validation/candidate.ts: LANGUAGE_LEVELS) --------------
do $$ begin
  create type language_level as enum ('basic', 'intermediate', 'fluent', 'native');
exception when duplicate_object then null; end $$;

-- --- Rodzaj wymagania oferty (obowiązkowe / dodatkowe) ---------------------
do $$ begin
  create type requirement_kind as enum ('mandatory', 'optional');
exception when duplicate_object then null; end $$;

-- --- Status aplikacji kandydata --------------------------------------------
do $$ begin
  create type application_status as enum (
    'draft', 'submitted', 'viewed', 'shortlisted', 'interview',
    'offer_sent', 'offer_accepted', 'offer_declined', 'rejected', 'withdrawn', 'hired'
  );
exception when duplicate_object then null; end $$;

-- --- Status propozycji pracodawcy do kandydata -----------------------------
do $$ begin
  create type offer_status as enum (
    'draft', 'sent', 'viewed', 'accepted', 'declined', 'expired', 'cancelled'
  );
exception when duplicate_object then null; end $$;

-- --- Status dostarczenia e-maila (Resend / webhooki) -----------------------
do $$ begin
  create type email_status as enum (
    'queued', 'sent', 'delivered', 'opened', 'clicked', 'bounced', 'complained', 'failed'
  );
exception when duplicate_object then null; end $$;

-- --- Kategoria zgody (cookies: necessary/preferences/analytics/marketing) --
do $$ begin
  create type consent_category as enum ('necessary', 'preferences', 'analytics', 'marketing');
exception when duplicate_object then null; end $$;

-- --- Typ powiadomienia ------------------------------------------------------
do $$ begin
  create type notification_type as enum (
    'application_received', 'application_status_changed',
    'offer_received', 'offer_status_changed',
    'message_received', 'job_match', 'company_verified', 'system'
  );
exception when duplicate_object then null; end $$;

-- --- Typ konwersacji --------------------------------------------------------
do $$ begin
  create type conversation_type as enum ('direct', 'application', 'offer');
exception when duplicate_object then null; end $$;

-- --- Zgłoszenia (reports) ---------------------------------------------------
do $$ begin
  create type report_target_type as enum ('job', 'company', 'user', 'message');
exception when duplicate_object then null; end $$;

do $$ begin
  create type report_status as enum ('open', 'reviewing', 'resolved', 'dismissed');
exception when duplicate_object then null; end $$;

-- --- Widoczność pliku (prywatne = signed URL) ------------------------------
do $$ begin
  create type file_visibility as enum ('private', 'public');
exception when duplicate_object then null; end $$;

-- --- Płatności / subskrypcje -----------------------------------------------
do $$ begin
  create type subscription_status as enum (
    'trialing', 'active', 'past_due', 'canceled', 'incomplete', 'expired'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type payment_status as enum ('pending', 'succeeded', 'failed', 'refunded');
exception when duplicate_object then null; end $$;

do $$ begin
  create type invoice_status as enum ('draft', 'open', 'paid', 'void', 'uncollectible');
exception when duplicate_object then null; end $$;
