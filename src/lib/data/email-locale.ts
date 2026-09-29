/**
 * Język e-maili i powiadomień zalogowanego użytkownika (#1049, Invariant #1) — odczyt POD SESJĄ
 * (własny wiersz `profiles` pod RLS w `withPortalTransaction`; nigdy service-role).
 *
 * Wyświetlamy język, który baza faktycznie zastosuje przy kolejkowaniu e-maili
 * (`resolve_recipient_locale`, lustro `resolveRecipientLocale`): preferowany → język konta →
 * język rejestracji → `en`. Błąd odczytu = jawny `error` (bez udawania wartości domyślnej).
 *
 * Tryb demo (bez env): język bieżącej strony (`demoLocale`).
 */

import type { Locale } from '@/i18n/routing';
import { getPortalIdentity, isPortalDataConfigured, withPortalTransaction } from '@/lib/db/portal';
import { queryOne } from '@/lib/db/sql';
import { captureError } from '@/lib/error-report';
import { resolveRecipientLocale } from '@/lib/i18n/recipient-locale';

export type EmailLocaleLoad =
  | { status: 'ready'; locale: Locale; demo: boolean }
  | { status: 'error' };

export async function loadEmailLocale(demoLocale: Locale): Promise<EmailLocaleLoad> {
  if (!isPortalDataConfigured()) return { status: 'ready', locale: demoLocale, demo: true };

  try {
    const me = await getPortalIdentity();
    if (!me) return { status: 'error' };
    const row = await withPortalTransaction(me, (tx) =>
      queryOne(
        tx,
        'email-locale.own',
        `SELECT preferred_locale, account_locale, signup_locale
           FROM public.profiles
          WHERE id = $1`,
        [me.id],
      ),
    );
    if (!row) return { status: 'error' };
    const text = (value: unknown): string | null => (typeof value === 'string' ? value : null);
    return {
      status: 'ready',
      demo: false,
      locale: resolveRecipientLocale({
        preferred_locale: text(row['preferred_locale']),
        account_locale: text(row['account_locale']),
        signup_locale: text(row['signup_locale']),
      }),
    };
  } catch (error) {
    captureError(error, { area: 'email-locale.load' });
    return { status: 'error' };
  }
}
