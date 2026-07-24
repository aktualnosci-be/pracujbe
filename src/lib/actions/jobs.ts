'use server';

import { randomUUID } from 'node:crypto';

import type { SupabaseClient } from '@supabase/supabase-js';

import { createServerClient } from '@/lib/supabase/server';
import { isSupabaseConfigured } from '@/lib/env';
import type { ErrorCode } from '@/lib/errors';
import { checkRateLimit } from '@/lib/rate-limit';
import { routing } from '@/i18n/routing';
import {
  step1Schema,
  step2Schema,
  step3Schema,
  step4Schema,
  step5Schema,
  step6Schema,
  step7Schema,
  step8Schema,
  step9Schema,
  type JobStep1,
  type JobStep2,
  type JobStep3,
  type JobStep4,
  type JobStep5,
  type JobStep6,
  type JobStep7,
  type JobStep8,
  type JobStep9,
} from '@/lib/validation/job';

/**
 * Server Actions kreatora oferty pracy — Pracuj.be (Etap 5).
 *
 * Cały zapis idzie pod SESJĄ zalogowanego użytkownika (RLS, NIGDY service-role):
 *   - `createJobDraft`  — tworzy szkic oferty (`jobs.status = 'draft'`) dla aktywnej firmy
 *                          zalogowanego (created_by = auth.uid(), company_id z company_members).
 *   - `updateJobDraft`  — waliduje pojedynczy krok (schemat z `@/lib/validation/job`) i zapisuje
 *                          odpowiednie kolumny `jobs` + `job_translations` (locale = default oferty)
 *                          + `job_requirements` / `job_skills`. RLS pilnuje własności.
 *   - `publishJob`      — ustawia `status = 'active'`, `published_at = now()`. Publikacja wymaga
 *                          firmy `verified` (RLS/with-check); niezweryfikowaną firmę mapujemy
 *                          proaktywnie na `COMPANY_NOT_VERIFIED` (backstop: RLS).
 *
 * Rate limiting (F-05): tworzenie i publikacja przechodzą przez RPC `rate_limit_hit` (klucz
 * per-użytkownik). Przekroczenie limitu → `RATE_LIMITED`. Błąd samego limitera nie blokuje
 * przepływu (fail-open, log do Sentry).
 *
 * TRYB DEMO (Invariant: panele działają bez env): gdy Supabase nie jest skonfigurowane,
 * walidujemy dane, ale NIE zapisujemy — zwracamy `{ ok: true, demo: true }` (i syntetyczny
 * `id` przy tworzeniu szkicu). Dzięki temu build oraz UX działają bez backendu.
 *
 * Bez technikaliów dla użytkownika (Invariant #8) — błędy mapujemy na stabilny kod użytkowy.
 *
 * Języki oferty i wymagane certyfikaty (krok 7) są REALNIE zapisywane w relacjach
 * job_languages / job_certificates (0030, FUN-03); publiczny detal zwraca języki, a matching
 * uwzględnia wymagania językowe/certyfikatowe (RPC get_job_match_profile).
 */

export type CreateDraftResult =
  | { ok: true; id: string; demo?: boolean }
  | { ok: false; error: ErrorCode };
export type SaveDraftResult = { ok: true; demo?: boolean } | { ok: false; error: ErrorCode };
export type PublishResult = { ok: true; demo?: boolean } | { ok: false; error: ErrorCode };

/** Syntetyczny identyfikator szkicu w trybie DEMO (brak env) — przepływ działa bez DB. */
const DEMO_DRAFT_ID = 'demo-draft';

/** Placeholdery kolumn NOT NULL bez wartości domyślnej — nadpisywane przez kroki 1–3. */
const PLACEHOLDER_CATEGORY = 'logistics';
const PLACEHOLDER_CONTRACT = 'permanent';

/** Limity (okno 1 h) — chronią przed masowym tworzeniem/publikacją ofert. */
const DRAFT_RATE_MAX = 30;
const PUBLISH_RATE_MAX = 20;
const RATE_WINDOW_SECONDS = 3600;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/* ---------------------------------------------------------------------------
 * Pomocnicze
 * ------------------------------------------------------------------------- */

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

/** Wyciąga `message` z nieznanego błędu Postgresa/PostgREST (bez rzucania). */
function errorMessage(error: unknown): string | undefined {
  if (error && typeof error === 'object' && 'message' in error) {
    const m = (error as { message?: unknown }).message;
    return typeof m === 'string' ? m : undefined;
  }
  return undefined;
}

/** Mapuje komunikat błędu z Postgresa/RLS na kod użytkowy (Invariant #8). */
function mapPgError(message: string | undefined): ErrorCode {
  const m = message ?? '';
  if (m.includes('COMPANY_NOT_VERIFIED')) return 'COMPANY_NOT_VERIFIED';
  if (m.includes('NOT_FOUND')) return 'NOT_FOUND';
  if (m.includes('VALIDATION_FAILED')) return 'VALIDATION_FAILED';
  if (
    m.includes('PERMISSION_DENIED') ||
    m.includes('UNAUTHENTICATED') ||
    m.includes('JWT') ||
    m.includes('row-level security')
  ) {
    return 'PERMISSION_DENIED';
  }
  return 'INTERNAL';
}

/** Zawęża dowolny string do obsługiwanego locale oferty (fallback: język domyślny). */
function normalizeLocale(locale: string | undefined): string {
  const l = locale ?? '';
  return (routing.locales as readonly string[]).includes(l) ? l : routing.defaultLocale;
}

/** Puste/whitespace → null (kolumny nullable), w innym wypadku wartość surowa. */
function nullIfEmpty(value: string | undefined | null): string | null {
  const v = value?.trim();
  return v ? v : null;
}

function slugify(input: string): string {
  return input
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

/** Uruchamia zapis Supabase i mapuje ewentualny błąd na kod użytkowy (null = sukces). */
async function write(op: PromiseLike<{ error: unknown }>): Promise<ErrorCode | null> {
  const { error } = await op;
  return error ? mapPgError(errorMessage(error)) : null;
}

/** Waliduje dane kroku właściwym `stepNSchema`; zwraca sparsowaną wartość albo null. */
function validateJobStep(step: number, data: unknown): unknown | null {
  const schema = {
    1: step1Schema,
    2: step2Schema,
    3: step3Schema,
    4: step4Schema,
    5: step5Schema,
    6: step6Schema,
    7: step7Schema,
    8: step8Schema,
    9: step9Schema,
  }[step];
  if (!schema) return null;
  const result = schema.safeParse(data);
  return result.success ? result.data : null;
}

/* ---------------------------------------------------------------------------
 * createJobDraft
 * ------------------------------------------------------------------------- */

/**
 * Tworzy szkic oferty dla aktywnej firmy zalogowanego użytkownika i zwraca jego `id`.
 * @param locale locale, w którym pracodawca tworzy ofertę (default_locale oferty).
 */
export async function createJobDraft(locale?: string): Promise<CreateDraftResult> {
  const loc = normalizeLocale(locale);

  if (!isSupabaseConfigured()) {
    return { ok: true, id: DEMO_DRAFT_ID, demo: true };
  }

  try {
    const supabase = await createServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return { ok: false, error: 'PERMISSION_DENIED' };

    const allowed = await checkRateLimit('job-draft', {
      identifier: user.id,
      max: DRAFT_RATE_MAX,
      windowSeconds: RATE_WINDOW_SECONDS,
    });
    if (!allowed) return { ok: false, error: 'RATE_LIMITED' };

    // AKTYWNA firma z kontekstu (cookie-aware, zwalidowana — FUN-07), nie „pierwsze członkostwo".
    const { getActiveCompanyId } = await import('@/lib/company-context');
    const companyId = await getActiveCompanyId(supabase, user.id);
    if (!companyId) return { ok: false, error: 'PERMISSION_DENIED' };

    const { data: inserted, error: insErr } = await supabase
      .from('jobs')
      .insert({
        company_id: companyId,
        created_by: user.id,
        slug: `draft-${randomUUID()}`,
        default_locale: loc,
        title: '',
        status: 'draft',
        category: PLACEHOLDER_CATEGORY,
        contract_type: PLACEHOLDER_CONTRACT,
        city: '',
        region: '',
      })
      .select('id')
      .single();
    if (insErr) return { ok: false, error: mapPgError(insErr.message) };

    const id = asString(asRecord(inserted)['id']);
    if (!id) return { ok: false, error: 'INTERNAL' };
    return { ok: true, id };
  } catch {
    return { ok: false, error: 'INTERNAL' };
  }
}

/* ---------------------------------------------------------------------------
 * updateJobDraft
 * ------------------------------------------------------------------------- */

/**
 * Zapisuje pojedynczy krok szkicu. Waliduje danymi z `@/lib/validation/job` i utrwala
 * właściwe kolumny/relacje. RLS pilnuje, że użytkownik edytuje ofertę własnej firmy.
 */
export async function updateJobDraft(
  jobId: string,
  step: number,
  data: unknown,
): Promise<SaveDraftResult> {
  if (typeof jobId !== 'string' || (!UUID_RE.test(jobId) && jobId !== DEMO_DRAFT_ID)) {
    return { ok: false, error: 'VALIDATION_FAILED' };
  }
  if (!Number.isInteger(step) || step < 1 || step > 9) {
    return { ok: false, error: 'VALIDATION_FAILED' };
  }

  const parsed = validateJobStep(step, data);
  if (parsed === null) return { ok: false, error: 'VALIDATION_FAILED' };

  if (!isSupabaseConfigured()) return { ok: true, demo: true };

  try {
    const supabase = await createServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return { ok: false, error: 'PERMISSION_DENIED' };

    // Odczyt oferty (RLS jobs_select_member) — potwierdza własność i daje default_locale/tytuł.
    const { data: jobData, error: jobErr } = await supabase
      .from('jobs')
      .select('id, default_locale, title, status')
      .eq('id', jobId)
      .is('deleted_at', null)
      .maybeSingle();
    if (jobErr) return { ok: false, error: mapPgError(jobErr.message) };

    const job = asRecord(jobData);
    if (!asString(job['id'])) return { ok: false, error: 'NOT_FOUND' };

    // P1-10: kreator edytuje WYŁĄCZNIE szkic. Aktywnej/wstrzymanej/zamkniętej oferty nie wolno
    // modyfikować krok po kroku (publiczna oferta zawierałaby mieszankę starych i nowych danych,
    // a nieudany replace-all mógłby ją opróżnić). Rewizję aktywnej oferty publikuje się atomowo.
    if (asString(job['status']) !== 'draft') return { ok: false, error: 'JOB_NOT_DRAFT' };

    const locale = normalizeLocale(asString(job['default_locale'], routing.defaultLocale));
    const anchorTitle = asString(job['title']);

    const error = await applyStep(supabase, jobId, step, parsed, locale, anchorTitle);
    if (error) return { ok: false, error };
    return { ok: true };
  } catch {
    return { ok: false, error: 'INTERNAL' };
  }
}

/** Upsert wiersza tłumaczenia (locale oferty). Zawsze niesie `title` (kolumna NOT NULL). */
async function upsertTranslation(
  supabase: SupabaseClient,
  jobId: string,
  locale: string,
  title: string,
  patch: Record<string, unknown>,
): Promise<ErrorCode | null> {
  return write(
    supabase
      .from('job_translations')
      .upsert({ job_id: jobId, locale, title: title || '', ...patch }, { onConflict: 'job_id,locale' }),
  );
}

/** Zastępuje linie wymagań danego rodzaju (mandatory/optional) w locale oferty. */
// P1-09: zamiana relacji oferty przez ATOMOWE RPC replace-all (DELETE+INSERT w jednym ciele
// funkcji = transakcja). Wcześniej kliencki DELETE, a potem INSERT jako dwa żądania — awaria
// drugiego OPRÓŻNIAŁA relację (utrata danych). RPC gejtowane recruiter+ (is_job_manager).

async function replaceRequirements(
  supabase: SupabaseClient,
  jobId: string,
  locale: string,
  kind: 'mandatory' | 'optional',
  lines: string[],
): Promise<ErrorCode | null> {
  return write(
    supabase.rpc('set_job_requirements', {
      p_job_id: jobId,
      p_locale: locale,
      p_kind: kind,
      p_lines: lines,
    }),
  );
}

/** Zastępuje umiejętności danego zakresu (obowiązkowe / dodatkowe) — atomowo (RPC). */
async function replaceSkills(
  supabase: SupabaseClient,
  jobId: string,
  mandatory: boolean,
  labels: string[],
): Promise<ErrorCode | null> {
  return write(
    supabase.rpc('set_job_skills', { p_job_id: jobId, p_mandatory: mandatory, p_labels: labels }),
  );
}

/** Replace-all języków wymaganych oferty (job_languages) — atomowo (RPC). */
async function replaceLanguages(
  supabase: SupabaseClient,
  jobId: string,
  langs: ReadonlyArray<{ language: string; level: string }>,
): Promise<ErrorCode | null> {
  return write(
    supabase.rpc('set_job_languages', {
      p_job_id: jobId,
      p_languages: langs.map((l) => ({ language: l.language, level: l.level })),
    }),
  );
}

/** Replace-all certyfikatów wymaganych oferty (job_certificates) — atomowo (RPC). */
async function replaceCertificates(
  supabase: SupabaseClient,
  jobId: string,
  labels: string[],
): Promise<ErrorCode | null> {
  return write(supabase.rpc('set_job_certificates', { p_job_id: jobId, p_labels: labels }));
}

/** Utrwala pojedynczy krok kreatora. Zwraca kod błędu albo null (sukces). */
async function applyStep(
  supabase: SupabaseClient,
  jobId: string,
  step: number,
  parsed: unknown,
  locale: string,
  anchorTitle: string,
): Promise<ErrorCode | null> {
  switch (step) {
    case 1: {
      const v = parsed as JobStep1;
      const e = await write(
        supabase
          .from('jobs')
          .update({ title: v.title, category: v.category, occupation: v.occupation })
          .eq('id', jobId),
      );
      if (e) return e;
      return upsertTranslation(supabase, jobId, locale, v.title, { title: v.title });
    }

    case 2: {
      const v = parsed as JobStep2;
      const e = await write(
        supabase
          .from('jobs')
          .update({
            contract_type: v.contractType,
            working_hours: v.workingHours,
            shifts: nullIfEmpty(v.shifts),
            start_immediately: v.startImmediately,
            immediate: v.startImmediately,
            start_date: v.startDate ?? null,
          })
          .eq('id', jobId),
      );
      if (e) return e;
      return upsertTranslation(supabase, jobId, locale, anchorTitle, {
        working_hours: v.workingHours,
        shifts: nullIfEmpty(v.shifts),
      });
    }

    case 3: {
      const v = parsed as JobStep3;
      return write(
        supabase
          .from('jobs')
          .update({ city: v.city, region: v.region, address: nullIfEmpty(v.address), remote: v.remote })
          .eq('id', jobId),
      );
    }

    case 4: {
      const v = parsed as JobStep4;
      return write(
        supabase
          .from('jobs')
          .update({
            salary_min: v.salaryMin ?? null,
            salary_max: v.salaryMax ?? null,
            currency: v.currency,
            salary_period: v.salaryPeriod,
          })
          .eq('id', jobId),
      );
    }

    case 5: {
      const v = parsed as JobStep5;
      return upsertTranslation(supabase, jobId, locale, anchorTitle, {
        description: v.description,
        responsibilities: v.responsibilities,
      });
    }

    case 6: {
      const v = parsed as JobStep6;
      const e = await write(
        supabase
          .from('jobs')
          .update({ min_experience_years: v.minExperienceYears ?? null })
          .eq('id', jobId),
      );
      if (e) return e;
      const reqErr = await replaceRequirements(
        supabase,
        jobId,
        locale,
        'mandatory',
        v.requirementsMandatory,
      );
      if (reqErr) return reqErr;
      return replaceSkills(supabase, jobId, true, v.mandatorySkills);
    }

    case 7: {
      const v = parsed as JobStep7;
      const e = await write(
        supabase
          .from('jobs')
          .update({
            requires_driving_license: v.requiresDrivingLicense,
            no_language_required: v.noLanguageRequired,
          })
          .eq('id', jobId),
      );
      if (e) return e;
      const reqErr = await replaceRequirements(
        supabase,
        jobId,
        locale,
        'optional',
        v.requirementsOptional,
      );
      if (reqErr) return reqErr;
      const skErr = await replaceSkills(supabase, jobId, false, v.skills);
      if (skErr) return skErr;
      // Języki i certyfikaty oferty są teraz REALNIE zapisywane (FUN-03, relacje 0030).
      const langErr = await replaceLanguages(supabase, jobId, v.languages);
      if (langErr) return langErr;
      return replaceCertificates(supabase, jobId, v.requiredCertificates);
    }

    case 8: {
      const v = parsed as JobStep8;
      const e = await write(
        supabase
          .from('jobs')
          .update({ accommodation: v.accommodation, transport: v.transport })
          .eq('id', jobId),
      );
      if (e) return e;
      return upsertTranslation(supabase, jobId, locale, anchorTitle, {
        conditions: v.conditions,
        benefits: v.benefits,
        highlights: v.benefits.slice(0, 4),
      });
    }

    case 9: {
      const v = parsed as JobStep9;
      const e = await write(
        supabase.from('jobs').update({ contact_email: nullIfEmpty(v.contactEmail) }).eq('id', jobId),
      );
      if (e) return e;
      return upsertTranslation(supabase, jobId, locale, anchorTitle, {
        company_description: v.companyDescription,
      });
    }

    default:
      return 'VALIDATION_FAILED';
  }
}

/* ---------------------------------------------------------------------------
 * publishJob
 * ------------------------------------------------------------------------- */

/** Publikuje ofertę (status='active', published_at=now()). Wymaga firmy `verified`. */
export async function publishJob(jobId: string): Promise<PublishResult> {
  if (typeof jobId !== 'string' || (!UUID_RE.test(jobId) && jobId !== DEMO_DRAFT_ID)) {
    return { ok: false, error: 'VALIDATION_FAILED' };
  }

  if (!isSupabaseConfigured()) return { ok: true, demo: true };

  try {
    const supabase = await createServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return { ok: false, error: 'PERMISSION_DENIED' };

    const allowed = await checkRateLimit('job-publish', {
      identifier: user.id,
      max: PUBLISH_RATE_MAX,
      windowSeconds: RATE_WINDOW_SECONDS,
    });
    if (!allowed) return { ok: false, error: 'RATE_LIMITED' };

    // Odczyt tytułu (do zbudowania slug-a); pełna walidacja/kompletność/aktywacja atomowo w RPC.
    const { data: jobData, error: jobErr } = await supabase
      .from('jobs')
      .select('id, title')
      .eq('id', jobId)
      .is('deleted_at', null)
      .maybeSingle();
    if (jobErr) return { ok: false, error: mapPgError(jobErr.message) };
    const job = asRecord(jobData);
    if (!asString(job['id'])) return { ok: false, error: 'NOT_FOUND' };

    // Kandydat na slug (RPC użyje go tylko, gdy bieżący slug jest techniczny: draft-…).
    const slug = `${slugify(asString(job['title'])) || 'oferta'}-${randomUUID().slice(0, 8)}`;

    // Transakcyjna publikacja: autoryzacja + firma verified + status=draft + KOMPLETNOŚĆ (FUN-01).
    // Aktywacja poza tym RPC jest zablokowana triggerem (guard_job_publish).
    const { error: pubErr } = await supabase.rpc('publish_job', { p_job_id: jobId, p_slug: slug });
    if (pubErr) return { ok: false, error: mapPgError(pubErr.message) };

    return { ok: true };
  } catch {
    return { ok: false, error: 'INTERNAL' };
  }
}
