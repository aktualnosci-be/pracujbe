import type { Locale } from '@/i18n/routing';
import { routing } from '@/i18n/routing';

/**
 * Wybór języka odbiorcy powiadomień / e-maili.
 *
 * Kolejność fallbacku: preferred_locale -> account_locale -> signup_locale -> 'en'.
 * Akceptowane są wyłącznie wartości obsługiwanych języków (['pl','nl','fr','en']);
 * nieznane / puste wartości są pomijane.
 */
export function resolveRecipientLocale(r: {
  preferred_locale?: string | null;
  account_locale?: string | null;
  signup_locale?: string | null;
}): Locale {
  const supported = routing.locales as readonly string[];
  const candidates = [r.preferred_locale, r.account_locale, r.signup_locale];
  for (const candidate of candidates) {
    if (!candidate) continue;
    // Porównanie case-insensitive: np. "PL", "Nl", "FR" mają dać locale z listy.
    const normalized = candidate.toLowerCase();
    const match = supported.find((locale) => locale.toLowerCase() === normalized);
    if (match) {
      return match as Locale;
    }
  }
  return 'en';
}
