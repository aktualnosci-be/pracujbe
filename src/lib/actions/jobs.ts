'use server';

import { randomUUID } from 'node:crypto';

import { revalidatePath } from 'next/cache';

import { getActiveCompanyId } from '@/lib/company-context';
import { databaseErrorMessage, isDatabaseError } from '@/lib/db/errors';
import { getPortalIdentity, isPortalDataConfigured, withPortalTransaction } from '@/lib/db/portal';
import type { PortalIdentity } from '@/lib/auth/session';
import { execute, jsonArg, queryOne, queryRows, rpc } from '@/lib/db/sql';
import type { ErrorCode } from '@/lib/errors';
import { checkRateLimit } from '@/lib/rate-limit';
import { buildDraftStepContent } from '@/lib/job-draft-content';
import {
  buildScreeningReviewNotices,
  type ScreeningReviewNotice,
} from '@/lib/screening/review';
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
  step9DraftSchema,
  type JobStep1,
  type JobStep2,
  type JobStep3,
  type JobStep4,
  type JobStep5,
  type JobStep6,
  type JobStep7,
  type JobStep8,
  type JobStep9Draft,
} from '@/lib/validation/job';

/**
 * Server Actions kreatora oferty pracy — Pracuj.be (Etap 5).
 *
 * Cały zapis idzie pod SESJĄ zalogowanego użytkownika (`withPortalTransaction` — RLS jako
 * użytkownik sesji, NIGDY service-role); każda akcja = jedna transakcja:
 *   - `createJobDraft`  — tworzy szkic oferty (`jobs.status = 'draft'`) dla aktywnej firmy
 *                          zalogowanego (created_by = auth.uid(), company_id z company_members).
 *   - `updateJobDraft`  — waliduje pojedynczy krok (schemat z `@/lib/validation/job`) i zapisuje
 *                          go JEDNYM transakcyjnym RPC `save_job_draft` (0083, #192): kolumny
 *                          `jobs` + `job_translations` (locale = default oferty) + relacje
 *                          replace-all. Błąd w dowolnej części = brak częściowego zapisu kroku.
 *   - `updatePublishedJob` — poprawka AKTYWNEJ/WSTRZYMANEJ oferty (#325): wszystkie kroki naraz,
 *                          jedno transakcyjne RPC `update_published_job` (kompletność jak przy
 *                          publikacji, firma verified, CAS po `updated_at`); status i zgłoszenia
 *                          bez zmian.
 *   - `publishJob`      — ustawia `status = 'active'`, `published_at = now()`. Publikacja wymaga
 *                          firmy `verified` (RLS/with-check); niezweryfikowaną firmę mapujemy
 *                          proaktywnie na `COMPANY_NOT_VERIFIED` (backstop: RLS).
 *
 * Rate limiting (F-05): tworzenie i publikacja przechodzą przez RPC `rate_limit_hit` (klucz
 * per-użytkownik). Przekroczenie limitu → `RATE_LIMITED`. Błąd samego limitera nie blokuje
 * przepływu (fail-open, log do Sentry).
 *
 * TRYB DEMO (Invariant: panele działają bez env): gdy backend nie jest skonfigurowany
 * (`isPortalDataConfigured()`),
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
export type PublishResult =
  | { ok: true; demo?: boolean }
  | { ok: false; error: ErrorCode; screening?: ScreeningReviewNotice[] };
export type UpdatePublishedResult =
  | { ok: true; demo?: boolean; slug?: string; updatedAt?: string }
  | { ok: false; error: ErrorCode };

/** Syntetyczny identyfikator szkicu w trybie DEMO (brak env) — przepływ działa bez DB. */
const DEMO_DRAFT_ID = 'demo-draft';

/** Placeholdery kolumn NOT NULL bez wartości domyślnej — nadpisywane przez kroki 1–3. */
const PLACEHOLDER_CATEGORY = 'logistics';
const PLACEHOLDER_CONTRACT = 'permanent';

/** Limity (okno 1 h) — chronią przed masowym tworzeniem/publikacją ofert. */
const DRAFT_RATE_MAX = 30;
const EDIT_RATE_MAX = 60;
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

/** Mapuje komunikat błędu z Postgresa/RLS na kod użytkowy (Invariant #8). */
function mapPgError(message: string | undefined): ErrorCode {
  const m = message ?? '';
  if (m.includes('MODERATION_LOCKED')) return 'MODERATION_LOCKED';
  if (m.includes('JOB_EDIT_CONFLICT')) return 'JOB_EDIT_CONFLICT';
  if (m.includes('JOB_NOT_EDITABLE')) return 'JOB_NOT_EDITABLE';
  if (m.includes('JOB_EXPIRED')) return 'JOB_EXPIRED';
  if (m.includes('JOB_NOT_DRAFT')) return 'JOB_NOT_DRAFT';
  if (m.includes('SCREENING_QUESTION_REJECTED')) return 'SCREENING_QUESTION_REJECTED';
  if (m.includes('SCREENING_REVIEW_REQUIRED')) return 'SCREENING_REVIEW_REQUIRED';
  if (m.includes('COMPANY_NOT_VERIFIED')) return 'COMPANY_NOT_VERIFIED';
  if (m.includes('ENTITLEMENT_LIMIT')) return 'ENTITLEMENT_LIMIT';
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

/**
 * Wyjątek transakcji → kod użytkowy: błąd bazy (RLS, RAISE w RPC) wg komunikatu, każdy inny
 * wyjątek (sieć, konfiguracja) → INTERNAL. Tekst bazy nigdy nie trafia do użytkownika.
 */
function failureCode(error: unknown): ErrorCode {
  return isDatabaseError(error) ? mapPgError(databaseErrorMessage(error)) : 'INTERNAL';
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
    // Szkic kroku 9 nie wymaga zgody na publikację (#193) — zgoda nie jest utrwalana,
    // a publikacja idzie osobną akcją `publishJob` (transakcyjne RPC `publish_job`).
    9: step9DraftSchema,
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

  if (!isPortalDataConfigured()) {
    return { ok: true, id: DEMO_DRAFT_ID, demo: true };
  }

  try {
    const me = await getPortalIdentity();
    if (!me) return { ok: false, error: 'PERMISSION_DENIED' };

    const allowed = await checkRateLimit('job-draft', {
      identifier: me.id,
      max: DRAFT_RATE_MAX,
      windowSeconds: RATE_WINDOW_SECONDS,
    });
    if (!allowed) return { ok: false, error: 'RATE_LIMITED' };

    const id = await withPortalTransaction(me, async (tx) => {
      // AKTYWNA firma z kontekstu (cookie-aware, zwalidowana — FUN-07), nie „pierwsze członkostwo".
      const companyId = await getActiveCompanyId(tx, me.id);
      if (!companyId) return null;
      // jobs_insert (RLS, recruiter+ aktywnej firmy); created_by = użytkownik sesji.
      const { rows } = await execute(tx, 'jobs.create-draft',
        `INSERT INTO public.jobs
           (company_id, created_by, slug, default_locale, title, status, category, contract_type, city, region)
         VALUES ($1, $2, $3, $4, '', 'draft', $5, $6, '', '')
         RETURNING id`,
        [companyId, me.id, `draft-${randomUUID()}`, loc, PLACEHOLDER_CATEGORY, PLACEHOLDER_CONTRACT]);
      return asString(asRecord(rows[0])['id']);
    });
    if (id === null) return { ok: false, error: 'PERMISSION_DENIED' };
    if (!id) return { ok: false, error: 'INTERNAL' };
    return { ok: true, id };
  } catch (error) {
    return { ok: false, error: failureCode(error) };
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

  if (!isPortalDataConfigured()) return { ok: true, demo: true };

  try {
    const me = await getPortalIdentity();
    if (!me) return { ok: false, error: 'PERMISSION_DENIED' };

    const outcome = await withPortalTransaction(me, async (tx): Promise<ErrorCode | null> => {
      // Odczyt oferty (RLS jobs_select_member) — potwierdza własność i stan szkicu.
      const job = await queryOne<Record<string, unknown>>(tx, 'jobs.draft-state',
        'SELECT id, status FROM public.jobs WHERE id = $1 AND deleted_at IS NULL', [jobId]);
      if (!asString(job?.['id'])) return 'NOT_FOUND';

      // P1-10: kreator edytuje WYŁĄCZNIE szkic. Aktywnej/wstrzymanej/zamkniętej oferty nie wolno
      // modyfikować krok po kroku (publiczna oferta zawierałaby mieszankę starych i nowych danych,
      // a nieudany replace-all mógłby ją opróżnić). Rewizję aktywnej oferty publikuje się atomowo.
      if (asString(job?.['status']) !== 'draft') return 'JOB_NOT_DRAFT';

      // #192: cały krok (kolumny + tłumaczenie + relacje) w JEDNYM RPC — błąd w dowolnej
      // części cofa krok w całości, szkic nie zostaje w stanie mieszanym.
      const content = buildDraftStepContent(step, parsed);
      if (!content) return 'VALIDATION_FAILED';
      await rpc(tx, 'save_job_draft', { p_job_id: jobId, p_content: jsonArg(content) });
      return null;
    });
    if (outcome) return { ok: false, error: outcome };
    return { ok: true };
  } catch (error) {
    return { ok: false, error: failureCode(error) };
  }
}

/* ---------------------------------------------------------------------------
 * updatePublishedJob — poprawka opublikowanej oferty (#325)
 * ------------------------------------------------------------------------- */

/** Treść kroków 1–9 → kształt `p_content` RPC `update_published_job` (0077). */
function buildPublishedContent(steps: unknown[]): Record<string, unknown> {
  const s1 = steps[0] as JobStep1;
  const s2 = steps[1] as JobStep2;
  const s3 = steps[2] as JobStep3;
  const s4 = steps[3] as JobStep4;
  const s5 = steps[4] as JobStep5;
  const s6 = steps[5] as JobStep6;
  const s7 = steps[6] as JobStep7;
  const s8 = steps[7] as JobStep8;
  const s9 = steps[8] as JobStep9Draft;
  return {
    job: {
      title: s1.title,
      category: s1.category,
      occupation: s1.occupation,
      contract_type: s2.contractType,
      working_hours: s2.workingHours,
      shifts: nullIfEmpty(s2.shifts),
      start_immediately: s2.startImmediately,
      start_date: s2.startDate ?? null,
      city: s3.city,
      region: s3.region,
      address: nullIfEmpty(s3.address),
      remote: s3.remote,
      salary_min: s4.salaryMin ?? null,
      salary_max: s4.salaryMax ?? null,
      currency: s4.currency,
      salary_period: s4.salaryPeriod,
      min_experience_years: s6.minExperienceYears ?? null,
      requires_driving_license: s7.requiresDrivingLicense,
      no_language_required: s7.noLanguageRequired,
      accommodation: s8.accommodation,
      transport: s8.transport,
      contact_email: nullIfEmpty(s9.contactEmail),
    },
    translation: {
      description: s5.description,
      responsibilities: s5.responsibilities,
      conditions: s8.conditions,
      benefits: s8.benefits,
      company_description: s9.companyDescription,
    },
    requirements_mandatory: s6.requirementsMandatory,
    requirements_optional: s7.requirementsOptional,
    skills_mandatory: s6.mandatorySkills,
    skills_optional: s7.skills,
    languages: s7.languages.map((l) => ({ language: l.language, level: l.level })),
    certificates: s7.requiredCertificates,
  };
}

/**
 * Zapisuje poprawioną treść AKTYWNEJ lub WSTRZYMANEJ oferty. Kreator w trybie edycji wysyła
 * dane wszystkich 9 kroków naraz (`steps[0]` = krok 1); każdy krok przechodzi ten sam schemat
 * Zod co przy tworzeniu. Zapis to jedno transakcyjne RPC — publiczna oferta nigdy nie jest
 * mieszanką starej i nowej treści, a niekompletna treść (jak przy publikacji) jest odrzucana
 * w całości. `expectedUpdatedAt` (wersja wczytana do kreatora) chroni przed cichym
 * nadpisaniem cudzej, równoległej poprawki → `JOB_EDIT_CONFLICT`.
 */
export async function updatePublishedJob(
  jobId: string,
  steps: unknown[],
  expectedUpdatedAt: string | null,
): Promise<UpdatePublishedResult> {
  // Demo (brak env) edytuje oferty z listy demonstracyjnej o nie-UUID identyfikatorach.
  const demo = !isPortalDataConfigured();
  if (typeof jobId !== 'string' || (!UUID_RE.test(jobId) && !(demo && /^[\w-]{1,40}$/.test(jobId)))) {
    return { ok: false, error: 'VALIDATION_FAILED' };
  }
  if (!Array.isArray(steps) || steps.length !== 9) return { ok: false, error: 'VALIDATION_FAILED' };
  if (
    expectedUpdatedAt !== null &&
    (typeof expectedUpdatedAt !== 'string' || Number.isNaN(Date.parse(expectedUpdatedAt)))
  ) {
    return { ok: false, error: 'VALIDATION_FAILED' };
  }

  const parsed: unknown[] = [];
  for (let i = 0; i < 9; i += 1) {
    const value = validateJobStep(i + 1, steps[i]);
    if (value === null) return { ok: false, error: 'VALIDATION_FAILED' };
    parsed.push(value);
  }
  const content = buildPublishedContent(parsed);

  if (demo) return { ok: true, demo: true };

  try {
    const me = await getPortalIdentity();
    if (!me) return { ok: false, error: 'PERMISSION_DENIED' };

    const allowed = await checkRateLimit('job-edit', {
      identifier: me.id,
      max: EDIT_RATE_MAX,
      windowSeconds: RATE_WINDOW_SECONDS,
    });
    if (!allowed) return { ok: false, error: 'RATE_LIMITED' };

    const data = await withPortalTransaction(me, (tx) =>
      rpc(tx, 'update_published_job', {
        p_job_id: jobId,
        p_content: jsonArg(content),
        p_expected_updated_at: expectedUpdatedAt,
      }),
    );

    revalidatePath('/[locale]/employer/oferty', 'page');
    revalidatePath('/[locale]/oferty-pracy/[slug]', 'page');
    const saved = asRecord(data);
    return {
      ok: true,
      slug: asString(saved['slug']) || undefined,
      updatedAt: asString(saved['updated_at']) || undefined,
    };
  } catch (error) {
    return { ok: false, error: failureCode(error) };
  }
}

/* ---------------------------------------------------------------------------
 * publishJob
 * ------------------------------------------------------------------------- */

/**
 * Stan przeglądu pytań oznaczonych przez detektor (#497, migracja 0103), odczyt pod RLS
 * (członek firmy oferty) w osobnej transakcji — nieudana publikacja cofnęła swoją. Tylko
 * pytania bez akceptacji bieżącej treści. Błąd odczytu → pusta lista (kod błędu publikacji
 * i tak trafia do kreatora).
 */
async function loadScreeningReviewNotices(
  me: PortalIdentity,
  jobId: string,
): Promise<ScreeningReviewNotice[]> {
  try {
    return await withPortalTransaction(me, async (tx) => {
      const questions = await queryRows(tx, 'jobs.screening-questions-review',
        `SELECT position, content_fingerprint, risk_categories
           FROM public.job_screening_questions WHERE job_id = $1`, [jobId]);
      const reviews = await queryRows(tx, 'jobs.screening-reviews',
        `SELECT content_fingerprint, status, decision_reason
           FROM public.screening_question_reviews WHERE job_id = $1`, [jobId]);
      return buildScreeningReviewNotices(questions, reviews);
    });
  } catch {
    return [];
  }
}

/** Publikuje ofertę (status='active', published_at=now()). Wymaga firmy `verified`. */
export async function publishJob(jobId: string): Promise<PublishResult> {
  if (typeof jobId !== 'string' || (!UUID_RE.test(jobId) && jobId !== DEMO_DRAFT_ID)) {
    return { ok: false, error: 'VALIDATION_FAILED' };
  }

  if (!isPortalDataConfigured()) return { ok: true, demo: true };

  let me: PortalIdentity | null = null;
  try {
    me = await getPortalIdentity();
    if (!me) return { ok: false, error: 'PERMISSION_DENIED' };

    const allowed = await checkRateLimit('job-publish', {
      identifier: me.id,
      max: PUBLISH_RATE_MAX,
      windowSeconds: RATE_WINDOW_SECONDS,
    });
    if (!allowed) return { ok: false, error: 'RATE_LIMITED' };

    const outcome = await withPortalTransaction(me, async (tx): Promise<ErrorCode | null> => {
      // Odczyt tytułu (do zbudowania slug-a); pełna walidacja/kompletność/aktywacja atomowo w RPC.
      const job = await queryOne<Record<string, unknown>>(tx, 'jobs.publish-title',
        'SELECT id, title FROM public.jobs WHERE id = $1 AND deleted_at IS NULL', [jobId]);
      if (!asString(job?.['id'])) return 'NOT_FOUND';

      // Kandydat na slug (RPC użyje go tylko, gdy bieżący slug jest techniczny: draft-…).
      const slug = `${slugify(asString(job?.['title'])) || 'oferta'}-${randomUUID().slice(0, 8)}`;

      // Transakcyjna publikacja: autoryzacja + firma verified + status=draft + KOMPLETNOŚĆ (FUN-01).
      // Aktywacja poza tym RPC jest zablokowana triggerem (guard_job_publish).
      await rpc(tx, 'publish_job', { p_job_id: jobId, p_slug: slug });
      return null;
    });
    if (outcome) return { ok: false, error: outcome };
    return { ok: true };
  } catch (error) {
    const code = failureCode(error);
    // #497: pytanie screeningowe czeka na przegląd albo zostało odrzucone — kreator pokazuje,
    // których pytań to dotyczy (i uzasadnienie odrzucenia), żeby firma mogła je poprawić.
    if (me && (code === 'SCREENING_REVIEW_REQUIRED' || code === 'SCREENING_QUESTION_REJECTED')) {
      return { ok: false, error: code, screening: await loadScreeningReviewNotices(me, jobId) };
    }
    return { ok: false, error: code };
  }
}

/* ---------------------------------------------------------------------------
 * setJobStatus — cykl życia opublikowanej oferty (P1-04)
 * ------------------------------------------------------------------------- */

/** Dozwolone operacje cyklu życia oferty (macierz przejść egzekwowana w RPC 0056). */
export type JobLifecycleAction = 'pause' | 'resume' | 'close' | 'reopen';

const LIFECYCLE_ACTIONS: ReadonlySet<string> = new Set<JobLifecycleAction>([
  'pause',
  'resume',
  'close',
  'reopen',
]);

export type JobStatusResult =
  | { ok: true; demo?: boolean; status?: string }
  | { ok: false; error: ErrorCode };

/**
 * Zmienia status oferty w cyklu życia (P1-04): pauza / wznowienie / zamknięcie / ponowne otwarcie.
 * Cała logika (macierz przejść, capability recruiter+, firma verified, kompletność
 * przy reopenie, CAS) jest w transakcyjnym RPC `set_job_status`; klient nie zmienia statusu
 * bezpośrednio (guard trigger `guard_job_status`).
 */
export async function setJobStatus(
  jobId: string,
  action: JobLifecycleAction,
): Promise<JobStatusResult> {
  if (typeof jobId !== 'string' || !UUID_RE.test(jobId)) {
    return { ok: false, error: 'VALIDATION_FAILED' };
  }
  if (!LIFECYCLE_ACTIONS.has(action)) return { ok: false, error: 'VALIDATION_FAILED' };

  if (!isPortalDataConfigured()) return { ok: true, demo: true };

  try {
    const me = await getPortalIdentity();
    if (!me) return { ok: false, error: 'PERMISSION_DENIED' };

    const allowed = await checkRateLimit('job-status', {
      identifier: me.id,
      max: PUBLISH_RATE_MAX,
      windowSeconds: RATE_WINDOW_SECONDS,
    });
    if (!allowed) return { ok: false, error: 'RATE_LIMITED' };

    const data = await withPortalTransaction(me, (tx) =>
      rpc(tx, 'set_job_status', { p_job_id: jobId, p_action: action }),
    );

    // Lista ofert firmy i publiczne widoki muszą pokazać nowy stan.
    revalidatePath('/employer/oferty');
    revalidatePath('/employer');
    return { ok: true, status: typeof data === 'string' ? data : undefined };
  } catch (error) {
    return { ok: false, error: failureCode(error) };
  }
}
