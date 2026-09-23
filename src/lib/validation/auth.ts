import { z } from 'zod/v3';
import { isLocale, routing } from '@/i18n/routing';

/**
 * Schematy walidacji autoryzacji (logowanie, rejestracja kandydata/pracodawcy, reset hasła).
 *
 * Komunikaty błędów to klucze i18n (np. 'auth.error.emailInvalid'), a nie gotowe teksty UI —
 * warstwa formularza mapuje je na tłumaczenia.
 */

export const localeSchema = z.enum(routing.locales);

export const emailSchema = z
  .string({ required_error: 'auth.error.emailRequired' })
  .trim()
  .min(1, 'auth.error.emailRequired')
  .email('auth.error.emailInvalid')
  .max(254, 'auth.error.emailTooLong');

export const passwordSchema = z
  .string({ required_error: 'auth.error.passwordRequired' })
  // Formularz wysyła '' (nie undefined), więc „wymagane” musi być osobnym, pierwszym sprawdzeniem.
  .min(1, 'auth.error.passwordRequired')
  .min(8, 'auth.error.passwordTooShort')
  .max(72, 'auth.error.passwordTooLong')
  .regex(/[A-Za-z]/, 'auth.error.passwordNeedsLetter')
  .regex(/[0-9]/, 'auth.error.passwordNeedsNumber');

const nameSchema = z
  .string({ required_error: 'auth.error.nameRequired' })
  .trim()
  .min(1, 'auth.error.nameRequired')
  .min(2, 'auth.error.nameTooShort')
  .max(80, 'auth.error.nameTooLong');

/**
 * Zgoda na regulamin: wymagane `true`. Celowo NIE `z.literal(true)` — niepoprawny literal jest
 * błędem krytycznym Zod, który wstrzymuje `.refine` całego obiektu, przez co niezgodność haseł
 * wychodziła dopiero po poprawieniu reszty formularza. Błąd niekrytyczny (`fatal: false`)
 * pozwala zgłosić wszystkie problemy w jednej rundzie.
 */
const agreeTermsSchema = z.custom<true>((value) => value === true, {
  message: 'auth.error.termsRequired',
  fatal: false,
});

/** Zgodność haseł; puste powtórzenie ma własny komunikat („Powtórz hasło”). */
function passwordsMatch(data: { password: string; passwordConfirm: string }): boolean {
  return data.passwordConfirm.length === 0 || data.password === data.passwordConfirm;
}

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'auth.error.passwordRequired'),
});

export const registerCandidateSchema = z
  .object({
    email: emailSchema,
    password: passwordSchema,
    passwordConfirm: z.string().min(1, 'auth.error.passwordConfirmRequired'),
    firstName: nameSchema,
    lastName: nameSchema,
    locale: localeSchema.optional(),
    agreeTerms: agreeTermsSchema,
  })
  .refine(passwordsMatch, {
    path: ['passwordConfirm'],
    message: 'auth.error.passwordMismatch',
  });

export const registerEmployerSchema = z
  .object({
    email: emailSchema,
    password: passwordSchema,
    passwordConfirm: z.string().min(1, 'auth.error.passwordConfirmRequired'),
    companyName: z
      .string({ required_error: 'auth.error.companyNameRequired' })
      .trim()
      .min(1, 'auth.error.companyNameRequired')
      .min(2, 'auth.error.companyNameTooShort')
      .max(120, 'auth.error.companyNameTooLong'),
    firstName: nameSchema,
    lastName: nameSchema,
    locale: localeSchema.optional(),
    agreeTerms: agreeTermsSchema,
  })
  .refine(passwordsMatch, {
    path: ['passwordConfirm'],
    message: 'auth.error.passwordMismatch',
  });

export const resetSchema = z.object({
  email: emailSchema,
});

export type LoginInput = z.infer<typeof loginSchema>;
export type RegisterCandidateInput = z.infer<typeof registerCandidateSchema>;
export type RegisterEmployerInput = z.infer<typeof registerEmployerSchema>;
export type ResetInput = z.infer<typeof resetSchema>;

/** Maksymalna długość parametru powrotu (`next`) — dłuższe wartości odrzucamy. */
const NEXT_PATH_MAX_LENGTH = 512;
/** Sztuczny origin do rozwiązania ścieżki; wynik musi pozostać w nim (brak open redirect). */
const NEXT_PATH_BASE = 'https://pracuj.invalid';

/**
 * Parametr powrotu po logowaniu/rejestracji (`?next=`). Przyjmuje WYŁĄCZNIE ścieżkę względną
 * w obrębie serwisu z prefiksem obsługiwanego języka (`/{locale}/...`). Odrzuca: `//host`,
 * schematy (`https:`, `javascript:`), backslash, znaki sterujące, ścieżki bez locale oraz
 * wszystko, co po rozwiązaniu URL wychodzi poza origin. Zwraca znormalizowaną ścieżkę
 * (pathname + query + hash) albo `null` — wtedy wołający używa domyślnego celu (panel).
 */
export function safeNextPath(value: unknown): string | null {
  if (typeof value !== 'string' || value.length === 0 || value.length > NEXT_PATH_MAX_LENGTH) {
    return null;
  }
  if (!value.startsWith('/') || value.startsWith('//')) {
    return null;
  }
  // Backslash (przeglądarki traktują go jak `/`) i znaki sterujące (np. \t, \n usuwane przez parser URL).
  if (/[\\\u0000-\u001f\u007f]/.test(value)) {
    return null;
  }
  let url: URL;
  try {
    url = new URL(value, NEXT_PATH_BASE);
  } catch {
    return null;
  }
  if (url.origin !== NEXT_PATH_BASE || url.pathname.startsWith('//')) {
    return null;
  }
  const firstSegment = url.pathname.split('/')[1] ?? '';
  if (!isLocale(firstSegment)) {
    return null;
  }
  const normalized = `${url.pathname}${url.search}${url.hash}`;
  // Parser URL koduje procentowo znaki spoza ASCII (np. `é` → `%C3%A9`), więc wynik może urosnąć.
  return normalized.length > NEXT_PATH_MAX_LENGTH ? null : normalized;
}

/**
 * Query string po zmianie języka strony: bezpieczny `next` dostaje prefiks nowego języka,
 * żeby po zalogowaniu użytkownik wrócił do tej samej strony w wybranym języku. Brak lub
 * niebezpieczny `next` → query bez zmian (logowanie i tak go zignoruje).
 */
export function relocalizeNextParam(search: string, locale: Locale): string {
  const params = new URLSearchParams(search);
  const next = safeNextPath(params.get('next'));
  if (!next) return search;
  params.set('next', next.replace(/^\/[^/?#]+/, `/${locale}`));
  return `?${params.toString()}`;
}

/** Ścieżka logowania (bez prefiksu języka — dokłada go `Link` z `@/i18n/navigation`). */
const LOGIN_PATH = '/logowanie';

/**
 * Link do logowania, po którym użytkownik wraca na `returnTo` (np. bieżącą ofertę).
 * `returnTo` musi być ścieżką z prefiksem języka; niebezpieczna wartość → zwykły link logowania.
 */
export function loginHref(
  returnTo: string | null | undefined,
): string | { pathname: string; query: { next: string } } {
  const next = safeNextPath(returnTo);
  return next ? { pathname: LOGIN_PATH, query: { next } } : LOGIN_PATH;
}
