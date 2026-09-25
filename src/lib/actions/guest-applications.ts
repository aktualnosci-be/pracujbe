'use server';

import { createHash } from 'node:crypto';
import { headers } from 'next/headers';
import { z } from 'zod/v3';

import { databaseErrorMessage, isDatabaseError } from '@/lib/db/errors';
import {
  getPortalIdentity,
  isPortalDataConfigured,
  isServiceDatabaseConfigured,
  withPortalTransaction,
  withServiceRole,
} from '@/lib/db/portal';
import { jsonArg, rpc, rpcRows } from '@/lib/db/sql';
import type { ErrorCode } from '@/lib/errors';
import { trustedClientIp } from '@/lib/http/trusted-ip';
import { checkRateLimit } from '@/lib/rate-limit';
import { captureError } from '@/lib/error-report';
import { enforceTurnstile } from '@/lib/turnstile/verify';
import {
  hashGuestToken,
  isGuestTokenConfigured,
  isGuestTokenFormat,
  issueGuestToken,
} from '@/lib/guest-apply/token';
import { clearGuestLinkToken, readGuestLinkToken } from '@/lib/guest-apply/link-cookie';
import { applicationPhoneSchema, findPersonalIdentifierField } from '@/lib/validation/application';
import {
  guestApplicationSchema,
  type GuestApplicationInput,
} from '@/lib/validation/guest-application';

/**
 * Jednorazowa aplikacja bez konta (#98) — cienka warstwa nad RPC z migracji 0095.
 *
 * 1. `submitGuestApplication` — rate limit (IP i adres), Turnstile, walidacja, zapis
 *    zgłoszenia i e-mail z linkiem potwierdzenia. Odpowiedź zawsze neutralna („sprawdź
 *    skrzynkę”): nie ujawnia, czy adres już aplikował albo ma konto. Firma nic nie widzi.
 * 2. `confirmGuestApplication` — kliknięcie w e-mailu → strona z przyciskiem (POST, więc
 *    skanery linków w poczcie nie potwierdzają za użytkownika) → aplikacja trafia do firmy.
 * 3. `claimGuestApplication` — zalogowany kandydat ze zweryfikowanym adresem przejmuje
 *    aplikację tokenem z drugiego e-maila.
 *
 * Tokeny: w bazie tylko hash (`@/lib/guest-apply/token`). RPC 1–2 są service_role-only
 * (gość nie ma sesji → `withServiceRole`); 3 działa w transakcji sesji kandydata
 * (`withPortalTransaction`: auth.uid() + zweryfikowany e-mail).
 */

export type GuestApplyField = 'fullName' | 'email' | 'phone' | 'message' | 'consent';
export type GuestApplyResult =
  | { ok: true }
  | {
      ok: false;
      error: ErrorCode;
      field?: GuestApplyField;
      /** #101: pytanie wymagane bez odpowiedzi (walidacja w bazie) — komunikat przy pytaniu. */
      questionId?: string;
      /** #495: pole/pytanie zawiera NISS/BIS albo numer dokumentu — komunikat przy polu. */
      reason?: 'sensitiveId';
    };

const SCREENING_REQUIRED_RE =
  /SCREENING_ANSWER_REQUIRED: ([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;

export type GuestConfirmOutcome =
  | 'confirmed'
  | 'already_confirmed'
  | 'duplicate'
  | 'expired'
  | 'job_closed'
  | 'invalid';
export type GuestConfirmResult =
  | { ok: true; outcome: GuestConfirmOutcome; jobSlug?: string }
  | { ok: false; error: ErrorCode };

export type GuestClaimResult =
  | { ok: true; applicationId: string }
  | { ok: false; error: ErrorCode | 'UNAUTHENTICATED' };

const OUTCOMES: ReadonlySet<string> = new Set([
  'confirmed',
  'already_confirmed',
  'duplicate',
  'expired',
  'job_closed',
  'invalid',
]);

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,200}$/;

/** Serwer fixture E2E (tryb `full`): brak bazy, formularz gościa kończy się sukcesem. */
function isGuestApplyFixture(): boolean {
  return process.env.NODE_ENV === 'development' && process.env.PLAYWRIGHT_APPLICATIONS_FIXTURE === 'full';
}

async function requestMeta(): Promise<{ ip: string | null; userAgent: string | null }> {
  const store = await headers();
  return { ip: trustedClientIp(store), userAgent: store.get('user-agent') };
}

function fieldFromIssuePath(path: ReadonlyArray<string | number>): GuestApplyField | undefined {
  switch (path[0]) {
    case 'fullName':
      return 'fullName';
    case 'email':
      return 'email';
    case 'message':
      return 'message';
    case 'agreeTerms':
      return 'consent';
    default:
      return undefined;
  }
}

/** Gość wysyła aplikację (idempotentnie po `idempotencyKey`). */
export async function submitGuestApplication(
  input: GuestApplicationInput,
  botCheckToken?: string | null,
): Promise<GuestApplyResult> {
  // Rate limit per IP (fail-safe) — publiczny formularz bez konta wysyłający e-maile.
  if (!(await checkRateLimit('guest-apply', { max: 10, windowSeconds: 3600 }))) {
    return { ok: false, error: 'RATE_LIMITED' };
  }
  // Turnstile (#46): awaria dostawcy = fail-closed (polityka `guestApply`).
  const botCheck = await enforceTurnstile('guestApply', botCheckToken);
  if (botCheck) return { ok: false, error: botCheck };

  const phone = applicationPhoneSchema.safeParse({ phone: input.phone, phoneCountry: input.phoneCountry });
  if (!phone.success) return { ok: false, error: 'VALIDATION_FAILED', field: 'phone' };

  // #495: numer identyfikacyjny w wiadomości/odpowiedzi → błąd przy polu, bez zapisu.
  const sensitive = findPersonalIdentifierField(input);
  if (sensitive) return { ok: false, error: 'VALIDATION_FAILED', reason: 'sensitiveId', ...sensitive };

  // Fixture E2E ma syntetyczne identyfikatory ofert (nie UUID) — tylko tam luzujemy `jobId`.
  const schema = isGuestApplyFixture()
    ? guestApplicationSchema.extend({ jobId: z.string().min(1) })
    : guestApplicationSchema;
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: 'VALIDATION_FAILED', field: fieldFromIssuePath(parsed.error.issues[0]?.path ?? []) };
  }
  const v = parsed.data;

  // Limit per adres (hash — adres e-mail nie trafia do tabeli limitera): ochrona skrzynki
  // przed zalewaniem linkami potwierdzenia z wielu IP.
  const emailKey = createHash('sha256').update(v.email).digest('hex').slice(0, 32);
  if (!(await checkRateLimit('guest-apply-email', { max: 5, windowSeconds: 3600, identifier: emailKey }))) {
    return { ok: false, error: 'RATE_LIMITED' };
  }

  if (isGuestApplyFixture()) return { ok: true };
  // Tryb demo (bez bazy): oferty fikcyjne, nic nie zapisujemy.
  if (!isPortalDataConfigured()) return { ok: false, error: 'DEMO_UNAVAILABLE' };
  if (!isServiceDatabaseConfigured() || !isGuestTokenConfigured()) return { ok: false, error: 'GUEST_APPLY_UNAVAILABLE' };

  const confirm = issueGuestToken('confirm');
  if (!confirm) return { ok: false, error: 'GUEST_APPLY_UNAVAILABLE' };

  try {
    const meta = await requestMeta();
    await withServiceRole((tx) => rpc(tx, 'submit_guest_application', {
      p_job_id: v.jobId,
      p_email: v.email,
      p_full_name: v.fullName,
      p_phone: phone.data.phone ?? null,
      p_availability: v.availability ?? null,
      p_message: v.message ? v.message : null,
      p_locale: v.locale,
      p_idempotency_key: v.idempotencyKey,
      p_confirm_nonce: confirm.nonce,
      p_confirm_token_hash: confirm.hash,
      p_ip: meta.ip,
      p_user_agent: meta.userAgent,
      // #101: odpowiedzi walidowane w bazie tymi samymi regułami co apply_to_job.
      p_answers: v.answers && Object.keys(v.answers).length > 0 ? jsonArg(v.answers) : null,
    }));
    return { ok: true };
  } catch (e) {
    if (isDatabaseError(e)) {
      const message = databaseErrorMessage(e);
      if (message.includes('JOB_NOT_ACTIVE')) return { ok: false, error: 'JOB_NOT_ACTIVE' };
      const questionId = SCREENING_REQUIRED_RE.exec(message)?.[1];
      if (questionId) return { ok: false, error: 'SCREENING_ANSWER_REQUIRED', questionId };
      if (message.includes('VALIDATION_FAILED')) return { ok: false, error: 'VALIDATION_FAILED' };
    }
    captureError(e, { area: 'guestApply.submit' });
    return { ok: false, error: 'INTERNAL' };
  }
}

/** Potwierdzenie adresu e-mail tokenem z linku — dopiero teraz aplikacja trafia do firmy. */
export async function confirmGuestApplication(locale: string): Promise<GuestConfirmResult> {
  if (!(await checkRateLimit('guest-apply-confirm', { max: 30, windowSeconds: 3600 }))) {
    return { ok: false, error: 'RATE_LIMITED' };
  }
  const token = await readGuestLinkToken('confirm');
  if (!isGuestTokenFormat(token)) return { ok: true, outcome: 'invalid' };
  if (!isPortalDataConfigured()) return { ok: false, error: 'DEMO_UNAVAILABLE' };
  if (!isServiceDatabaseConfigured() || !isGuestTokenConfigured()) return { ok: false, error: 'GUEST_APPLY_UNAVAILABLE' };

  const claim = issueGuestToken('claim');
  if (!claim) return { ok: false, error: 'GUEST_APPLY_UNAVAILABLE' };

  try {
    const rows = await withServiceRole((tx) => rpcRows<{ outcome?: unknown; job_slug?: unknown }>(
      tx, 'confirm_guest_application', {
        p_token_hash: hashGuestToken(token),
        p_claim_nonce: claim.nonce,
        p_claim_token_hash: claim.hash,
      }));
    const row = rows[0] ?? null;
    const outcome = typeof row?.outcome === 'string' && OUTCOMES.has(row.outcome) ? row.outcome : null;
    if (!outcome) {
      captureError(new Error('guest_confirm_unexpected_result'), { area: 'guestApply.confirm' });
      return { ok: false, error: 'INTERNAL' };
    }
    const slug = typeof row?.job_slug === 'string' && SLUG_RE.test(row.job_slug) ? row.job_slug : undefined;
    try {
      await clearGuestLinkToken(locale, 'confirm');
    } catch (e) {
      captureError(e, { area: 'guestApply.confirm.clearCookie' });
    }
    return { ok: true, outcome: outcome as GuestConfirmOutcome, ...(slug ? { jobSlug: slug } : {}) };
  } catch (e) {
    captureError(e, { area: 'guestApply.confirm' });
    return { ok: false, error: 'INTERNAL' };
  }
}

/** Zalogowany kandydat przejmuje aplikację gościa (ten sam, zweryfikowany adres e-mail). */
export async function claimGuestApplication(locale: string): Promise<GuestClaimResult> {
  if (!(await checkRateLimit('guest-apply-claim', { max: 20, windowSeconds: 3600 }))) {
    return { ok: false, error: 'RATE_LIMITED' };
  }
  const token = await readGuestLinkToken('claim');
  if (!isGuestTokenFormat(token)) return { ok: false, error: 'NOT_FOUND' };
  if (!isPortalDataConfigured()) return { ok: false, error: 'DEMO_UNAVAILABLE' };

  let data: unknown;
  try {
    const me = await getPortalIdentity();
    if (!me) return { ok: false, error: 'UNAUTHENTICATED' };
    data = await withPortalTransaction(me, (tx) => rpc(tx, 'claim_guest_application', {
      p_claim_token_hash: hashGuestToken(token),
    }));
  } catch (error) {
    if (isDatabaseError(error)) {
      const message = databaseErrorMessage(error);
      if (message.startsWith('UNAUTHENTICATED')) return { ok: false, error: 'UNAUTHENTICATED' };
      if (message.includes('EMAIL_NOT_VERIFIED')) return { ok: false, error: 'EMAIL_NOT_VERIFIED' };
      if (message.includes('CLAIM_EXPIRED')) return { ok: false, error: 'CLAIM_EXPIRED' };
      if (message.includes('APPLICATION_ALREADY_EXISTS')) return { ok: false, error: 'APPLICATION_ALREADY_EXISTS' };
      if (message.includes('PERMISSION_DENIED')) return { ok: false, error: 'PERMISSION_DENIED' };
      if (message.includes('NOT_FOUND')) return { ok: false, error: 'NOT_FOUND' };
    }
    captureError(error, { area: 'guestApply.claim' });
    return { ok: false, error: 'INTERNAL' };
  }
  try {
    await clearGuestLinkToken(locale, 'claim');
  } catch (e) {
    captureError(e, { area: 'guestApply.claim.clearCookie' });
  }
  return { ok: true, applicationId: String(data) };
}
