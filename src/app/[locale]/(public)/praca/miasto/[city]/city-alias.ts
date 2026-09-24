import type { LocationKey } from '@/lib/jobs';
import { normalizeCitySlug, resolveCitySlugAlias } from '@/lib/locations/city-aliases';

/**
 * Aliasy sluga miasta → kanoniczny klucz (`brussels`).
 *
 * Użytkownik może wpisać nazwę miasta w swoim języku (`brussel`, `bruxelles`, `bruksela`)
 * albo z wielkiej litery (`Brussels`). Aliasy wyliczamy z istniejących tłumaczeń
 * `locations.*` we wszystkich językach routingu — bez osobnej listy do utrzymania.
 * Przekierowanie wykonuje middleware (#298: przekierowanie renderowane w ISR dublowało
 * nagłówek `Location`); strona zachowuje tę samą regułę jako zabezpieczenie.
 */

export { normalizeCitySlug };

export async function resolveCityAlias(
  slug: string,
  keys: readonly LocationKey[],
): Promise<LocationKey | null> {
  const key = resolveCitySlugAlias(slug);
  return key && keys.includes(key) ? key : null;
}
