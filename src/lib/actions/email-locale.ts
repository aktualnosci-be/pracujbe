'use server';

import { z } from 'zod/v3';

import { routing, type Locale } from '@/i18n/routing';
import { databaseErrorMessage, isDatabaseError } from '@/lib/db/errors';
import { getPortalIdentity, isPortalDataConfigured, withPortalTransaction } from '@/lib/db/portal';
import { rpc } from '@/lib/db/sql';
import type { ErrorCode } from '@/lib/errors';
import { captureError } from '@/lib/error-report';

/**
 * Server Action zmiany języka e-maili i powiadomień (#1049, Invariant #1).
 *
 * Zapis wyłącznie przez RPC `set_my_email_locale` (0962) pod sesją użytkownika: właściciela nie
 * przyjmujemy od klienta, język walidowany w bazie względem `supported_locales`, audyt tylko przy
 * realnej zmianie. Zmiana dotyczy kolejnych wiadomości — te już zakolejkowane zachowują język
 * z chwili kolejkowania. Ekran ustawień istnieje dla kandydata i pracodawcy; admin go nie ma.
 * Błędy → kod użytkowy (Invariant #8). Bez env (demo) nic nie zapisujemy.
 */

export type SetEmailLocaleResult =
  | { ok: true; locale: Locale; demo?: boolean }
  | { ok: false; error: ErrorCode };

const localeSchema = z.enum(routing.locales);

function mapPgError(message: string | undefined): ErrorCode {
  const m = message ?? '';
  if (m.includes('VALIDATION_FAILED')) return 'VALIDATION_FAILED';
  if (m.includes('PERMISSION_DENIED') || m.includes('UNAUTHENTICATED')) return 'PERMISSION_DENIED';
  return 'INTERNAL';
}

export async function setEmailLocaleAction(input: unknown): Promise<SetEmailLocaleResult> {
  const parsed = localeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'VALIDATION_FAILED' };
  const locale = parsed.data;

  if (!isPortalDataConfigured()) return { ok: true, locale, demo: true };

  try {
    const me = await getPortalIdentity();
    if (!me) return { ok: false, error: 'PERMISSION_DENIED' };
    if (me.role !== 'candidate' && me.role !== 'employer') return { ok: false, error: 'PERMISSION_DENIED' };
    await withPortalTransaction(me, async (tx) => {
      await rpc(tx, 'set_my_email_locale', { p_locale: locale });
    });
    return { ok: true, locale };
  } catch (error) {
    if (isDatabaseError(error)) return { ok: false, error: mapPgError(databaseErrorMessage(error)) };
    captureError(error, { area: 'email-locale.setAction' });
    return { ok: false, error: 'INTERNAL' };
  }
}
