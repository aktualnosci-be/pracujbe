/**
 * Kanał aplikowania u ogłoszeniodawcy (#1129) — lustro reguł bazy z migracji
 * `0172_job_apply_channel.sql` (`job_apply_url_ok`, `job_apply_email_ok`, `job_apply_phone_ok`,
 * CHECK-i `jobs_apply_*_format`, wymóg co najmniej jednego kanału w `publish_job`
 * i `update_published_job` → `JOB_APPLY_CHANNEL_REQUIRED`).
 *
 * Decyzja produktowa: portal ogłoszeniowy — kandydat aplikuje bezpośrednio u autora ogłoszenia.
 * Oferta podaje stronę (https), e-mail lub telefon; do publikacji wystarczy jeden z nich.
 *
 * Zgodność z bazą pilnuje `tests/unit/job-apply-channel.test.ts` (te same przypadki graniczne
 * co sekcja AC172 w `supabase/tests/rls.sql`). Pusta wartość = brak kanału, nie błąd formatu.
 */

import { COMPANY_URL_MAX_LENGTH, isPublicHttpsUrl } from '@/lib/company-links';

/** Limity jak w bazie: URL 12–2048, e-mail ≤ 254 (część lokalna ≤ 64), telefon + i 8–15 cyfr. */
export const APPLY_URL_MAX_LENGTH = COMPANY_URL_MAX_LENGTH;
export const APPLY_EMAIL_MAX_LENGTH = 254;
const APPLY_EMAIL_LOCAL_MAX_LENGTH = 64;

// Ten sam wzorzec co `job_apply_email_ok`: bez `?`, `&`, `%`, spacji — parametry `mailto:`
// (temat, kopia) składa aplikacja, nigdy treść pola.
const APPLY_EMAIL_RE =
  /^[A-Za-z0-9_+-]+(\.[A-Za-z0-9_+-]+)*@([A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?\.)+[A-Za-z]{2,63}$/;
const APPLY_PHONE_RE = /^\+[1-9][0-9]{7,14}$/;

/**
 * Adres strony aplikowania: bezwzględny https, host z kropką, port 1–65535, 12–2048 znaków.
 * Reguła identyczna z adresem strony firmy (`isPublicHttpsUrl`, 0141); baza dodatkowo
 * wymaga wartości bez białych znaków na brzegach — zapis zawsze przycina.
 */
export function isApplyUrl(value: string): boolean {
  return isPublicHttpsUrl(value);
}

export function isApplyEmail(value: string): boolean {
  const v = value.trim();
  return (
    v.length <= APPLY_EMAIL_MAX_LENGTH &&
    (v.split('@')[0] ?? '').length <= APPLY_EMAIL_LOCAL_MAX_LENGTH &&
    APPLY_EMAIL_RE.test(v)
  );
}

/**
 * Telefon w zapisie bazy: `+` i cyfry. Usuwa spacje, kropki, myślniki, ukośniki i nawiasy,
 * prefiks `00` zamienia na `+`. Numeru bez prefiksu kraju nie zgadujemy (portal obsługuje
 * różne kraje) — taki numer nie przejdzie `isApplyPhone`.
 */
export function normalizeApplyPhone(value: string): string {
  const compact = value.trim().replace(/[\s.\-/()]/g, '');
  return compact.startsWith('00') ? `+${compact.slice(2)}` : compact;
}

/** `true`, gdy numer PO normalizacji ma format bazy (`+`, 8–15 cyfr, bez wiodącego zera). */
export function isApplyPhone(value: string): boolean {
  return APPLY_PHONE_RE.test(normalizeApplyPhone(value));
}

export interface ApplyChannels {
  applyUrl?: string | null;
  applyEmail?: string | null;
  applyPhone?: string | null;
}

/** Co najmniej jeden kanał podany (lustro `job_has_apply_channel`). */
export function hasApplyChannel(channels: ApplyChannels): boolean {
  return [channels.applyUrl, channels.applyEmail, channels.applyPhone].some(
    (v) => typeof v === 'string' && v.trim() !== '',
  );
}
