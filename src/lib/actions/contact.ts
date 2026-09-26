'use server';

import { getPortalIdentity, isServiceDatabaseConfigured, withServiceRole } from '@/lib/db/portal';
import { databaseErrorMessage, isDatabaseError } from '@/lib/db/errors';
import { rpcRows } from '@/lib/db/sql';
import type { ErrorCode } from '@/lib/errors';
import { checkRateLimit } from '@/lib/rate-limit';
import { captureError } from '@/lib/error-report';
import { enforceTurnstile } from '@/lib/turnstile/verify';
import { CONTACT_REFERENCE_RE, contactSchema, type ContactInput } from '@/lib/validation/contact';

/**
 * Formularz kontaktu (#61) — cienka warstwa nad RPC `submit_contact_message` (0125).
 * Kolejność jak w zgłoszeniu treści (#41): limiter (IP, fail-safe) → Turnstile (polityka
 * `contact`: fail-closed) → walidacja Zod → tożsamość z sesji (gość = null) → RPC
 * service_role. Idempotencja, limit per adres, potwierdzenie do nadawcy (język formularza)
 * i powiadomienie adminów (język każdego admina, Invariant #1) są w bazie, w jednej transakcji.
 *
 * RPC ma EXECUTE tylko dla service_role: bezpośrednie wywołanie przez anon omijałoby
 * Turnstile i limiter. `senderId` podaje serwer z sesji — nigdy klient.
 */

export type SubmitContactResult =
  | { ok: true; reference: string; created: boolean }
  | { ok: false; error: ErrorCode; field?: 'message' | 'senderName' };

/** Numer w trybie fixture E2E (serwer dev bez bazy). */
const CONTACT_FIXTURE_REFERENCE = 'KON-0000-0E2E';

function isContactFixtureMode(): boolean {
  return process.env.NODE_ENV === 'development' && process.env.PLAYWRIGHT_APPLICATIONS_FIXTURE === 'full';
}

/** Komunikat błędu Postgresa → kod użytkowy (Invariant #8). */
function mapPgError(message: string | undefined): ErrorCode {
  const m = message ?? '';
  if (m.includes('RATE_LIMITED')) return 'RATE_LIMITED';
  if (m.includes('VALIDATION_FAILED')) return 'VALIDATION_FAILED';
  return 'INTERNAL';
}

/** Id zalogowanego użytkownika albo null (gość). Błąd odczytu sesji = wiadomość jako gość. */
async function sessionUserId(): Promise<string | null> {
  try {
    return (await getPortalIdentity())?.id ?? null;
  } catch (error) {
    captureError(error, { area: 'contact.session' });
    return null;
  }
}

export async function submitContactMessage(
  input: ContactInput,
  botCheckToken?: string | null,
): Promise<SubmitContactResult> {
  if (!(await checkRateLimit('contact', { max: 5, windowSeconds: 3600 }))) {
    return { ok: false, error: 'RATE_LIMITED' };
  }

  const botCheck = await enforceTurnstile('contact', botCheckToken);
  if (botCheck) return { ok: false, error: botCheck };

  const parsed = contactSchema.safeParse(input);
  if (!parsed.success) {
    const sensitive = parsed.error.issues.find((i) => i.message === 'contact.error.sensitiveId');
    const field = sensitive?.path[0];
    return field === 'message' || field === 'senderName'
      ? { ok: false, error: 'VALIDATION_FAILED', field }
      : { ok: false, error: 'VALIDATION_FAILED' };
  }
  const v = parsed.data;

  if (!isServiceDatabaseConfigured()) {
    // Serwer fixture E2E: formularz działa bez bazy (nigdy w buildzie produkcyjnym).
    if (isContactFixtureMode()) return { ok: true, reference: CONTACT_FIXTURE_REFERENCE, created: true };
    return { ok: false, error: 'DEMO_UNAVAILABLE' };
  }

  try {
    const senderId = await sessionUserId();
    const [row] = await withServiceRole((tx) =>
      rpcRows<{ reference?: unknown; created?: unknown }>(tx, 'submit_contact_message', {
        p_sender_id: senderId,
        p_idempotency_key: v.idempotencyKey,
        p_topic: v.topic,
        p_message: v.message,
        p_sender_name: v.senderName || null,
        p_sender_email: v.senderEmail,
        p_locale: v.locale,
      }),
    );
    if (!row || typeof row.reference !== 'string' || !CONTACT_REFERENCE_RE.test(row.reference)) {
      captureError(new Error('submit_contact_message: pusta odpowiedź'), { area: 'contact.submit' });
      return { ok: false, error: 'INTERNAL' };
    }
    return { ok: true, reference: row.reference, created: row.created === true };
  } catch (error) {
    const code = isDatabaseError(error) ? mapPgError(databaseErrorMessage(error)) : 'INTERNAL';
    if (code === 'INTERNAL') captureError(error, { area: 'contact.submit' });
    return { ok: false, error: code };
  }
}
