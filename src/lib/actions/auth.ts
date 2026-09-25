'use server';

/**
 * Server Actions uwierzytelniania — Better Auth + PostgreSQL Railway (#24), realne, nie mock.
 *
 * Kontrakt zwrotu: akcje zwracają serializowalny `AuthActionResult` z ustabilizowanym
 * kodem błędu (`ErrorCode`) — NIGDY technikaliów (stack trace / SQL / komunikatu SDK).
 * Błędy Better Auth mapujemy na `AppError` z kodem (Invariant #8); formularz tłumaczy kod
 * na komunikat (`errors.<code>`).
 *
 * Kolejność każdej akcji: limiter PostgreSQL (fail-safe) → Turnstile → Zod → SDK przez
 * `auth.api` (bez publicznych endpointów, `/api/auth/[...all]` ich nie wystawia). Cookie sesji
 * zapisuje plugin `nextCookies()`. Rola i stan konta pochodzą WYŁĄCZNIE z `public.profiles`
 * (pula domeny pod RLS), nigdy z formularza, URL ani metadanych rejestracji.
 *
 * Sukces logowania/rejestracji/potwierdzenia kończy się `redirect(...)` (rzuca NEXT_REDIRECT
 * poza blokiem try). Reset hasła zwraca neutralny sukces — nie ujawnia, czy konto istnieje.
 * Bez konfiguracji kont (`isPortalAuthConfigured()`) akcje zwracają `INTERNAL` (tryb demo).
 */

import { getLocale } from 'next-intl/server';
import { cookies, headers } from 'next/headers';
import { redirect as redirectPath } from 'next/navigation';
import { parseSetCookieHeader, toCookieOptions } from 'better-auth/cookies';
import { z } from 'zod/v3';

import { redirect } from '@/i18n/navigation';
import { routing, type Locale } from '@/i18n/routing';
import { bootstrapCompany } from '@/lib/auth/bootstrap-company';
import { mapAuthError } from '@/lib/auth/map-auth-error';
import { safeNextPath } from '@/lib/auth/next-path';
import { companyNameFromMetadata } from '@/lib/auth/signup-company-name';
import { isAgeAttestationError } from '@/lib/age-policy/constants';
import { roleFromProfileRead, type ProfileRole } from '@/lib/auth/profile-role';
import { getAuthRuntime } from '@/lib/auth/runtime';
import { withCandidateSignup, withEmployerSignup, withInvitedEmployerSignup } from '@/lib/auth/signup-context';
import { getDomainPool } from '@/lib/db/runtime';
import { withUserTransaction } from '@/lib/db/transaction';
import { env, isPortalAuthConfigured } from '@/lib/env';
import { AppError, isAppError, type ErrorCode } from '@/lib/errors';
import { checkRateLimit } from '@/lib/rate-limit';
import { captureError } from '@/lib/error-report';
import { enforceTurnstile } from '@/lib/turnstile/verify';
import {
  loginSchema,
  passwordSchema,
  registerCandidateSchema,
  registerEmployerSchema,
  resetSchema,
  type LoginInput,
  type RegisterCandidateInput,
  type RegisterEmployerInput,
  type ResetInput,
} from '@/lib/validation/auth';
import {
  registerInvitedEmployerSchema,
  type RegisterInvitedEmployerInput,
} from '@/lib/validation/team-invite-signup';
import { consumeTeamInvitationSignup, readTeamInvitationSignup } from '@/lib/team/invite-signup';

/** Token resetu Better Auth: losowy identyfikator URL-safe (bez kropek i ukośników). */
const resetTokenSchema = z.string().min(16).max(256).regex(/^[A-Za-z0-9_-]+$/);
/** Token weryfikacji adresu: JWT HS256 podpisany sekretem Better Auth. */
const verifyTokenSchema = z
  .string()
  .max(4096)
  .regex(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);

/**
 * Schemat ustawienia nowego hasła (z linku resetu). Reużywa `passwordSchema` (min 8, litera +
 * cyfra) i wymaga zgodnego powtórzenia. Token pochodzi z linku (fragment `#token=`), nie z sesji:
 * zalogowanie na inne konto nie daje prawa do resetu. Definiowany lokalnie (plik `'use server'`
 * może eksportować tylko akcje async).
 */
const updatePasswordSchema = z
  .object({
    password: passwordSchema,
    passwordConfirm: z.string().min(1, 'auth.error.passwordConfirmRequired'),
    token: resetTokenSchema,
  })
  .refine((data) => data.password === data.passwordConfirm, {
    path: ['passwordConfirm'],
    message: 'auth.error.passwordMismatch',
  });

/** Wejście akcji `updatePassword` (walidowane po stronie serwera i klienta). */
export type UpdatePasswordInput = z.infer<typeof updatePasswordSchema>;

/** Wynik akcji przekazywany do formularza (serializowalny). Na sukcesie z przekierowaniem akcja nie wraca. */
export type AuthActionResult = { ok: true } | { ok: false; error: ErrorCode };

/**
 * Cel po potwierdzeniu adresu (np. oferta, z której kandydat przyszedł). Cookie tej samej
 * przeglądarki, HttpOnly; link w e-mailu go nie zawiera. Wartość ponownie walidowana przy odczycie.
 */
const VERIFY_NEXT_COOKIE = 'pb_verify_next';
const VERIFY_NEXT_MAX_AGE = 60 * 60 * 24;

/** Ścieżka panelu wg roli (bez prefiksu locale — dokłada go `redirect`). */
function panelPath(role: ProfileRole): string {
  switch (role) {
    case 'employer':
      return '/employer';
    case 'admin':
      return '/admin';
    default:
      return '/candidate';
  }
}

/** Bieżące locale żądania, zawężone do wspieranych; fallback do domyślnego. */
async function currentLocale(): Promise<Locale> {
  const value = await getLocale();
  const supported: readonly string[] = routing.locales;
  return supported.includes(value) ? (value as Locale) : routing.defaultLocale;
}

/** Runtime Better Auth; brak konfiguracji kont → kontrolowany `INTERNAL`. */
async function portalAuth() {
  if (!isPortalAuthConfigured()) {
    throw new AppError('INTERNAL', { context: { reason: 'portal_auth_unconfigured' } });
  }
  return getAuthRuntime();
}

type AuthRuntime = Awaited<ReturnType<typeof getAuthRuntime>>;

/**
 * Rola z aktywnego profilu (pod RLS, UUID z serwerowego wyniku SDK). Profil nieaktywny,
 * usunięty, brak profilu, błąd odczytu lub nieznana rola → `AppError('INTERNAL')`, nigdy
 * domyślny kandydat (#277).
 */
async function readProfileRole(userId: string): Promise<ProfileRole> {
  let result: { data: unknown; error?: unknown };
  try {
    const row = await withUserTransaction(await getDomainPool(), userId, async (tx) => {
      const read = (await tx.query(
        'SELECT role FROM public.profiles WHERE id = $1 AND is_active = true AND deleted_at IS NULL',
        [userId],
      )) as { rows: { role: string }[] };
      return read.rows[0] ?? null;
    });
    result = { data: row };
  } catch (error) {
    result = { data: null, error };
  }
  return roleFromProfileRead(result);
}

/**
 * Przenosi `Set-Cookie` z wyniku `auth.api` na odpowiedź akcji. Plugin `nextCookies()` robi to
 * samo w runtime Next; jawne przeniesienie nie zależy od sposobu ładowania `next/headers`
 * w bibliotece i jest idempotentne (te same wartości).
 */
async function applyAuthCookies(responseHeaders: Headers | null | undefined): Promise<void> {
  const setCookie = responseHeaders?.get('set-cookie');
  if (!setCookie) return;
  const store = await cookies();
  parseSetCookieHeader(setCookie).forEach((attributes, name) => {
    if (name) store.set(name, attributes.value, toCookieOptions(attributes));
  });
}

/** Nazwy cookies sesji SDK (z prefiksem `__Secure-`). */
async function sessionCookieNames(auth: AuthRuntime): Promise<string[]> {
  const context = await auth.$context;
  return [
    context.authCookies.sessionToken.name,
    context.authCookies.sessionData.name,
    context.authCookies.dontRememberToken.name,
  ];
}

/**
 * Cofa świeżo wydaną sesję (np. brak znanej roli po logowaniu): usuwa ją z bazy i kasuje cookie
 * z odpowiedzi. Best-effort — błąd trafia do kanału błędów, a użytkownik i tak dostaje błąd, nie panel.
 */
async function discardSession(
  auth: AuthRuntime,
  issued: { token?: string | null; userId?: string } = {},
): Promise<void> {
  try {
    const { internalAdapter } = await auth.$context;
    if (issued.token) await internalAdapter.deleteSession(issued.token);
    else if (issued.userId) await internalAdapter.deleteUserSessions(issued.userId);
  } catch (error) {
    captureError(error, { area: 'auth.discardSession' });
  }
  try {
    const store = await cookies();
    for (const name of await sessionCookieNames(auth)) store.delete(name);
  } catch (error) {
    captureError(error, { area: 'auth.discardSession.cookies' });
  }
}

/**
 * Logowanie e-mail + hasło. Sukces → bezpieczny `next` (np. oferta, z której kandydat przyszedł)
 * albo panel wg roli. `next` jest walidowany ponownie po stronie serwera (`safeNextPath`) —
 * wartość spoza serwisu jest ignorowana (brak open redirect).
 */
export async function signIn(
  input: LoginInput,
  next?: string | null,
  botCheckToken?: string | null,
): Promise<AuthActionResult> {
  // Rate limit per IP (10 prób / 5 min) — ochrona przed brute-force. Bez ujawniania detali.
  if (!(await checkRateLimit('signin', { max: 10, windowSeconds: 300 }))) {
    return { ok: false, error: 'RATE_LIMITED' };
  }
  // Turnstile (#46): osobna warstwa obok limitu; awaria dostawcy przy logowaniu = fail-open.
  const botCheck = await enforceTurnstile('login', botCheckToken);
  if (botCheck) return { ok: false, error: botCheck };

  const parsed = loginSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: 'VALIDATION_FAILED' };
  }

  const locale = await currentLocale();
  let role: ProfileRole;

  try {
    const auth = await portalAuth();
    let result: { token?: string | null; user: { id: string } };
    try {
      const signedIn = await auth.api.signInEmail({
        body: { email: parsed.data.email, password: parsed.data.password },
        headers: await headers(),
        returnHeaders: true,
      });
      result = signedIn.response;
      await applyAuthCookies(signedIn.headers);
    } catch (error) {
      throw mapAuthError(error);
    }
    try {
      role = await readProfileRole(result.user.id);
    } catch (e) {
      // Bez znanej roli nie zostawiamy półotwartej sesji: unieważnienie i kontrolowany błąd
      // zamiast przekierowania do panelu innej roli.
      captureError(e, { area: 'auth.signIn.resolveRole' });
      await discardSession(auth, { token: result.token });
      throw e;
    }
  } catch (e) {
    return { ok: false, error: isAppError(e) ? e.code : 'INTERNAL' };
  }

  // `redirect` rzuca NEXT_REDIRECT (typ zwrotny `never`); `return` spełnia sygnaturę.
  const target = safeNextPath(next);
  if (target) {
    // Ścieżka ma już prefiks języka (`/{locale}/...`) — bez ponownego dokładania locale.
    return redirectPath(target);
  }
  return redirect({ href: panelPath(role), locale });
}

/** Zapamiętuje bezpieczny cel po potwierdzeniu adresu (ta sama przeglądarka). */
async function rememberVerifyNext(next: string | null): Promise<void> {
  const store = await cookies();
  if (!next) {
    store.delete(VERIFY_NEXT_COOKIE);
    return;
  }
  store.set(VERIFY_NEXT_COOKIE, next, {
    httpOnly: true,
    sameSite: 'lax',
    secure: env.siteUrl.startsWith('https:'),
    path: '/',
    maxAge: VERIFY_NEXT_MAX_AGE,
  });
}

/** Komunikat błędu bazy (także opakowany przez SDK w `cause`) o braku ważnej deklaracji wieku. */
function isAgeAttestationMessage(error: unknown): boolean {
  for (let e: unknown = error, depth = 0; e && depth < 4; depth += 1) {
    const message = (e as { message?: unknown }).message;
    if (typeof message === 'string' && isAgeAttestationError(message)) return true;
    e = (e as { cause?: unknown }).cause;
  }
  return false;
}

/**
 * Wspólna ścieżka rejestracji. Profil, preferowany język i receipty akceptacji regulaminu
 * i polityki prywatności zapisują triggery 0008/0059 w TEJ SAMEJ transakcji co konto; zlecenie
 * e-maila potwierdzającego (0061) także — awaria dowolnej części cofa rejestrację. Istniejący
 * adres daje ten sam wynik co nowy (SDK zwraca neutralny sukces, bez zmiany istniejącego konta).
 */
async function signUp(
  run: (action: (body: { email: string; password: string; name: string }) => Promise<unknown>) => Promise<unknown>,
): Promise<void> {
  const auth = await portalAuth();
  const requestHeaders = await headers();
  try {
    await run((body) => auth.api.signUpEmail({ body, headers: requestHeaders }));
  } catch (error) {
    // #492: trigger 0059/0126 odrzuca deklarację wieku poniżej BIEŻĄCEGO progu (zmieniony po
    // wyświetleniu formularza) — własny kod zamiast INTERNAL.
    if (isAgeAttestationMessage(error)) {
      throw new AppError('AGE_ATTESTATION_REQUIRED', { cause: error, context: { reason: 'signup_age_policy' } });
    }
    throw mapAuthError(error);
  }
}

/**
 * Rejestracja kandydata. Sukces → strona potwierdzenia e-maila. Bezpieczny `next` wraca po
 * potwierdzeniu adresu w tej samej przeglądarce (cookie), np. do oferty.
 */
export async function registerCandidate(
  input: RegisterCandidateInput,
  next?: string | null,
  botCheckToken?: string | null,
): Promise<AuthActionResult> {
  // Rate limit per IP (5 rejestracji / godz) — ochrona przed masowym zakładaniem kont.
  if (!(await checkRateLimit('register', { max: 5, windowSeconds: 3600 }))) {
    return { ok: false, error: 'RATE_LIMITED' };
  }
  // Turnstile (#46): awaria dostawcy przy rejestracji = fail-closed.
  const botCheck = await enforceTurnstile('register', botCheckToken);
  if (botCheck) return { ok: false, error: botCheck };

  const parsed = registerCandidateSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: 'VALIDATION_FAILED' };
  }
  const locale = parsed.data.locale ?? (await currentLocale());

  try {
    await signUp((action) => withCandidateSignup(parsed.data, locale, action));
    await rememberVerifyNext(safeNextPath(next));
  } catch (e) {
    return { ok: false, error: isAppError(e) ? e.code : 'INTERNAL' };
  }

  return redirect({ href: '/potwierdzenie', locale });
}

/** Rejestracja pracodawcy. Sukces → strona potwierdzenia e-maila. */
export async function registerEmployer(
  input: RegisterEmployerInput,
  botCheckToken?: string | null,
): Promise<AuthActionResult> {
  // Rate limit per IP (5 rejestracji / godz) — ochrona przed masowym zakładaniem kont.
  if (!(await checkRateLimit('register', { max: 5, windowSeconds: 3600 }))) {
    return { ok: false, error: 'RATE_LIMITED' };
  }
  // Turnstile (#46): awaria dostawcy przy rejestracji = fail-closed.
  const botCheck = await enforceTurnstile('register', botCheckToken);
  if (botCheck) return { ok: false, error: botCheck };

  const parsed = registerEmployerSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: 'VALIDATION_FAILED' };
  }
  const locale = parsed.data.locale ?? (await currentLocale());

  try {
    await signUp((action) => withEmployerSignup(parsed.data, locale, action));
    await rememberVerifyNext(null);
  } catch (e) {
    return { ok: false, error: isAppError(e) ? e.code : 'INTERNAL' };
  }

  return redirect({ href: '/potwierdzenie', locale });
}

/**
 * Rejestracja pracodawcy z linku zaproszenia do zespołu (0121). Token z fragmentu `#token=`
 * musi wskazywać oczekujące, niezużyte zaproszenie dla TEGO adresu — inaczej `AUTH_LINK_INVALID`
 * (formularz nie zmienia adresu, więc inny adres = manipulacja). Konto powstaje bez firmy
 * (bez `company_name` w metadanych), a token zostaje zużyty. Zaproszenie przyjmuje się w panelu
 * po potwierdzeniu adresu (`get_my_company_invitations` wymaga zweryfikowanego e-maila).
 */
export async function registerInvitedEmployer(
  input: RegisterInvitedEmployerInput,
  inviteToken: string,
  botCheckToken?: string | null,
): Promise<AuthActionResult> {
  if (!(await checkRateLimit('register', { max: 5, windowSeconds: 3600 }))) {
    return { ok: false, error: 'RATE_LIMITED' };
  }
  const botCheck = await enforceTurnstile('register', botCheckToken);
  if (botCheck) return { ok: false, error: botCheck };

  const parsed = registerInvitedEmployerSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: 'VALIDATION_FAILED' };
  }
  const locale = parsed.data.locale ?? (await currentLocale());
  const email = parsed.data.email.toLowerCase();

  try {
    const invitation = await readTeamInvitationSignup(inviteToken);
    if (invitation.status !== 'valid' || invitation.email.toLowerCase() !== email) {
      return { ok: false, error: 'AUTH_LINK_INVALID' };
    }
    await signUp((action) => withInvitedEmployerSignup(parsed.data, locale, action));
    await rememberVerifyNext(null);
    // Konto już powstało; nieudane zużycie (np. równoległe wysłanie) nie cofa rejestracji —
    // zaproszenie i tak przyjmuje tylko właściciel zweryfikowanego adresu.
    try {
      await consumeTeamInvitationSignup(inviteToken, email);
    } catch (e) {
      captureError(e, { area: 'auth.registerInvitedEmployer.consume' });
    }
  } catch (e) {
    return { ok: false, error: isAppError(e) ? e.code : 'INTERNAL' };
  }

  return redirect({ href: '/potwierdzenie', locale });
}

/**
 * Zamawia link resetu hasła. Odpowiedź jest ZAWSZE neutralna (nie ujawnia, czy konto istnieje):
 * także awaria zapisu zlecenia dla istniejącego konta daje ten sam wynik (błąd trafia do kanału błędów).
 * Wyjątki: limit prób, bot-check, walidacja i brak konfiguracji kont (INTERNAL).
 * Język wiadomości i docelowej strony wynika z profilu ODBIORCY (kolejka 0061), nie z formularza.
 */
export async function requestPasswordReset(
  input: ResetInput,
  botCheckToken?: string | null,
): Promise<AuthActionResult> {
  // Rate limit per IP (5 prób / godz) — nie ujawnia istnienia konta (RATE_LIMITED jest neutralny).
  if (!(await checkRateLimit('password-reset', { max: 5, windowSeconds: 3600 }))) {
    return { ok: false, error: 'RATE_LIMITED' };
  }
  // Turnstile (#46): przed wysyłką e-maila; awaria dostawcy = fail-closed. Wynik nie zależy
  // od istnienia konta, więc nie ujawnia go.
  const botCheck = await enforceTurnstile('passwordReset', botCheckToken);
  if (botCheck) return { ok: false, error: botCheck };

  const parsed = resetSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: 'VALIDATION_FAILED' };
  }

  let auth: AuthRuntime;
  try {
    auth = await portalAuth();
  } catch {
    return { ok: false, error: 'INTERNAL' };
  }
  try {
    await auth.api.requestPasswordReset({
      body: { email: parsed.data.email },
      headers: await headers(),
    });
  } catch (error) {
    captureError(mapAuthError(error), { area: 'auth.requestPasswordReset' });
  }

  return { ok: true };
}

/**
 * Ustawia nowe hasło tokenem z linku resetu (fragment `#token=` strony `ustaw-nowe-haslo`).
 * Token wskazuje konto niezależnie od sesji przeglądarki; działa raz, a sukces unieważnia
 * wszystkie sesje tego konta (`revokeSessionsOnPasswordReset`). Nie tworzy nowej sesji —
 * formularz kieruje do logowania. Wygasły/użyty/zły token → `AUTH_LINK_INVALID`.
 */
export async function updatePassword(input: UpdatePasswordInput): Promise<AuthActionResult> {
  if (!(await checkRateLimit('password-update', { max: 10, windowSeconds: 3600 }))) {
    return { ok: false, error: 'RATE_LIMITED' };
  }
  const parsed = updatePasswordSchema.safeParse(input);
  if (!parsed.success) {
    const tokenIssue = parsed.error.issues.some((issue) => issue.path[0] === 'token');
    return { ok: false, error: tokenIssue ? 'AUTH_LINK_INVALID' : 'VALIDATION_FAILED' };
  }

  try {
    const auth = await portalAuth();
    try {
      await auth.api.resetPassword({
        body: { newPassword: parsed.data.password, token: parsed.data.token },
        headers: await headers(),
      });
    } catch (error) {
      throw mapAuthError(error);
    }
  } catch (e) {
    return { ok: false, error: isAppError(e) ? e.code : 'INTERNAL' };
  }

  return { ok: true };
}

/**
 * Potwierdza adres e-mail tokenem z linku (fragment `#token=` strony `potwierdz-email`) —
 * wywoływane kliknięciem przycisku, nie samym otwarciem linku (skaner poczty nie aktywuje konta).
 *
 * Pierwsze potwierdzenie tworzy sesję (cookie przez `nextCookies`), a pracodawca bez firmy
 * dostaje ją idempotentnie (`bootstrapCompany`: blokada profilu, jedna firma przy równoległych
 * kliknięciach; błąd nie blokuje logowania — panel pokaże formularz firmy). Konto już
 * potwierdzone → logowanie (token nie wydaje drugiej sesji). Zły/wygasły token → `AUTH_LINK_INVALID`.
 */
export async function confirmEmail(token: string): Promise<AuthActionResult> {
  if (!(await checkRateLimit('verify-email', { max: 20, windowSeconds: 3600 }))) {
    return { ok: false, error: 'RATE_LIMITED' };
  }
  const parsedToken = verifyTokenSchema.safeParse(token);
  if (!parsedToken.success) return { ok: false, error: 'AUTH_LINK_INVALID' };

  const locale = await currentLocale();
  let target: { path: string } | { panel: ProfileRole } | { login: true };

  try {
    const auth = await portalAuth();
    let sessionIssued = false;
    try {
      const verified = await auth.api.verifyEmail({
        query: { token: parsedToken.data },
        headers: await headers(),
        returnHeaders: true,
      });
      const context = await auth.$context;
      const sessionCookie = context.authCookies.sessionToken.name;
      sessionIssued = verified.headers.getSetCookie().some((c) => c.startsWith(`${sessionCookie}=`));
      await applyAuthCookies(verified.headers);
    } catch (error) {
      throw mapAuthError(error);
    }

    if (!sessionIssued) {
      target = { login: true };
    } else {
      // Token przeszedł weryfikację podpisu w SDK; e-mail z jego treści wskazuje konto.
      const { verifyJWT } = await import('better-auth/crypto');
      const payload = await verifyJWT<{ email?: unknown }>(parsedToken.data, env.authSecret ?? '');
      const email = typeof payload?.email === 'string' ? payload.email : null;
      const context = await auth.$context;
      const found = email ? await context.internalAdapter.findUserByEmail(email) : null;
      if (!found) throw new AppError('INTERNAL', { context: { reason: 'verified_user_missing' } });
      const user = found.user as unknown as Record<string, unknown> & { id: string };

      let role: ProfileRole;
      try {
        role = await readProfileRole(user.id);
      } catch (e) {
        captureError(e, { area: 'auth.confirmEmail.resolveRole' });
        await discardSession(auth, { userId: user.id });
        throw e;
      }

      if (role === 'employer') {
        const companyName = companyNameFromMetadata(user);
        if (companyName) {
          try {
            await bootstrapCompany(await getDomainPool(), user.id, companyName);
          } catch (e) {
            // Konto działa; panel pracodawcy bez firmy pokaże formularz jej założenia.
            captureError(e, { area: 'auth.confirmEmail.bootstrapCompany' });
          }
        }
      }

      const store = await cookies();
      const next = role === 'candidate' ? safeNextPath(store.get(VERIFY_NEXT_COOKIE)?.value) : null;
      store.delete(VERIFY_NEXT_COOKIE);
      target = next ? { path: next } : { panel: role };
    }
  } catch (e) {
    return { ok: false, error: isAppError(e) ? e.code : 'INTERNAL' };
  }

  if ('path' in target) return redirectPath(target.path);
  if ('panel' in target) return redirect({ href: panelPath(target.panel), locale });
  return redirect({ href: '/logowanie', locale });
}

/**
 * Wylogowanie: unieważnia sesję w bazie i usuwa cookie. Awaria bazy nie jest raportowana jako
 * globalne wylogowanie — cookie tej przeglądarki i tak znika, błąd trafia do kanału błędów.
 * Zawsze przekierowuje na stronę logowania.
 */
export async function signOut(): Promise<void> {
  const locale = await currentLocale();
  if (isPortalAuthConfigured()) {
    let auth: AuthRuntime | undefined;
    try {
      auth = await getAuthRuntime();
      const signedOut = await auth.api.signOut({ headers: await headers(), returnHeaders: true });
      await applyAuthCookies(signedOut.headers);
    } catch (error) {
      captureError(error, { area: 'auth.signOut' });
      if (auth) await discardSession(auth);
    }
  }
  redirect({ href: '/logowanie', locale });
}
