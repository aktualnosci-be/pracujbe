import type { EmailType } from '@/emails/copy';
import type { Locale } from '@/i18n/routing';
import { resolveRecipientLocale } from '@/lib/i18n/recipient-locale';

/**
 * Pomocnicze funkcje Supabase Auth „Send Email Hook" (czyste, bez I/O — testowalne).
 */

/** Kolumny języka z `profiles` (odczyt service-role po `user.id`). */
export interface AuthRecipientProfile {
  preferred_locale?: string | null;
  account_locale?: string | null;
  signup_locale?: string | null;
}

/**
 * #291 / INVARIANT #1: język e-maila Auth = język ODBIORCY, ta sama kolejność co w kolejce
 * e-mail: `preferred_locale → account_locale → signup_locale → 'en'`.
 *
 * `user_metadata.locale` (język formularza rejestracji) zastępuje `signup_locale`, gdy profil
 * jeszcze go nie ma — np. przy potwierdzeniu konta, wysyłanym zanim wiersz profilu jest widoczny.
 * Brak danych → 'en' (nigdy domyślny język serwera).
 */
export function authEmailLocale(
  profile: AuthRecipientProfile | null | undefined,
  metadata: Record<string, unknown> | null | undefined,
): Locale {
  const metaLocale = typeof metadata?.['locale'] === 'string' ? (metadata['locale'] as string) : null;
  return resolveRecipientLocale({
    preferred_locale: profile?.preferred_locale ?? null,
    account_locale: profile?.account_locale ?? null,
    signup_locale: profile?.signup_locale ?? metaLocale,
  });
}

/** Mapuje typ akcji GoTrue na typ e-maila + dane szablonu; treść odpowiada akcji (#291). */
export function buildAuthEmail(
  actionType: string,
  url: string,
  firstName: string | undefined,
): { type: EmailType; data: Record<string, unknown> } {
  switch (actionType) {
    case 'recovery':
      return { type: 'passwordReset', data: { firstName, resetUrl: url } };
    case 'magiclink':
      return { type: 'magicLink', data: { firstName, loginUrl: url } };
    case 'email_change':
    case 'email_change_new':
    case 'email_change_current':
      return { type: 'emailChange', data: { firstName, confirmationUrl: url } };
    case 'invite':
      return { type: 'invite', data: { firstName, inviteUrl: url } };
    default:
      // signup / email → potwierdzenie adresu i aktywacja konta.
      return { type: 'accountConfirmation', data: { firstName, confirmationUrl: url } };
  }
}
