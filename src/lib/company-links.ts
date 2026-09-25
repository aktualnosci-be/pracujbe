/**
 * Adres publiczny firmy (strona WWW / logo) — lustro reguły SQL `public.public_https_url`
 * (migracja `0114_public_job_company_links.sql`, twardy CHECK w `0162_company_links_edit.sql`).
 *
 * Reguła: bezwzględny `https://`, nazwa hosta z co najmniej jedną kropką, bez spacji/cudzysłowów/
 * nawiasów kątowych, najwyżej 2048 znaków po przycięciu białych znaków. Pusty tekst = brak
 * adresu (czyszczenie pola), nie błąd walidacji — o tym decyduje osobno `required`.
 *
 * Ten sam wzorzec w Zod (`src/lib/validation/company.ts`) i w bazie — jedno źródło reguły,
 * żeby formularz i baza zgadzały się co do tego, co jest poprawnym adresem (test
 * `company-links.test.ts` porównuje oba 1:1).
 */

const HTTPS_URL_RE =
  /^https:\/\/[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?)+(:[0-9]{1,5})?([/?#][A-Za-z0-9._~!$&'()*+,;=:@%/?#-]*)?$/;

export const COMPANY_URL_MAX_LENGTH = 2048;
const COMPANY_URL_MIN_LENGTH = 12;

/** `true`, gdy `value` (po przycięciu) jest bezwzględnym adresem https jak w bazie. */
export function isPublicHttpsUrl(value: string): boolean {
  const v = value.trim();
  return (
    v.length >= COMPANY_URL_MIN_LENGTH &&
    v.length <= COMPANY_URL_MAX_LENGTH &&
    HTTPS_URL_RE.test(v)
  );
}

/**
 * `true`, gdy `url` wskazuje na TEN SAM host co `ownHost` (np. `NEXT_PUBLIC_SITE_URL`) —
 * jedyny przypadek, w którym `next/image` może wyrenderować podgląd bez rozszerzania CSP/
 * `remotePatterns` na dowolne hosty (`img-src 'self'`, `images.remotePatterns: []`). W praktyce
 * adres logo firmy prawie zawsze wskazuje na inny host, więc formularz pokazuje wtedy sam adres.
 */
export function sameOriginHost(url: string, ownHost: string): boolean {
  if (!ownHost) return false;
  try {
    return new URL(url).host.toLowerCase() === ownHost.toLowerCase();
  } catch {
    return false;
  }
}
