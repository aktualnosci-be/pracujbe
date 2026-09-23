import { getTranslations } from 'next-intl/server';

import { routing } from '@/i18n/routing';
import type { LocationKey } from '@/lib/jobs';

/**
 * Aliasy sluga miasta → kanoniczny klucz (`brussels`).
 *
 * Użytkownik może wpisać nazwę miasta w swoim języku (`brussel`, `bruxelles`, `bruksela`)
 * albo z wielkiej litery (`Brussels`). Aliasy wyliczamy z istniejących tłumaczeń
 * `locations.*` we wszystkich językach routingu — bez osobnej listy do utrzymania.
 * Normalizacja: dekodowanie URL, małe litery, bez diakrytyków, spacje → myślniki.
 */

export function normalizeCitySlug(value: string): string {
  let decoded = value;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    // Niepoprawne kodowanie — porównujemy surową wartość.
  }
  return decoded
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-');
}

export async function resolveCityAlias(
  slug: string,
  keys: readonly LocationKey[],
): Promise<LocationKey | null> {
  const wanted = normalizeCitySlug(slug);
  if (!wanted) return null;

  for (const key of keys) {
    if (normalizeCitySlug(key) === wanted) return key;
  }

  for (const locale of routing.locales) {
    const tLoc = await getTranslations({ locale, namespace: 'locations' });
    for (const key of keys) {
      if (normalizeCitySlug(tLoc(key)) === wanted) return key;
    }
  }
  return null;
}
