'use server';

/**
 * Server Actions uwierzytelniania (Supabase Auth — realne, nie mock).
 *
 * Kontrakt zwrotu: akcje zwracają serializowalny `AuthActionResult` z ustabilizowanym
 * kodem błędu (`ErrorCode`) — NIGDY technikaliów (stack trace / SQL / surowej odpowiedzi
 * dostawcy). Wewnętrznie mapujemy błędy Supabase na `AppError` z kodem (Invariant #8);
 * warstwa formularza tłumaczy kod na komunikat (`errors.<code>`).
 *
 * Sukces logowania/rejestracji kończy się `redirect(...)` (rzuca NEXT_REDIRECT poza
 * blokiem try, więc nie jest łapany). Reset hasła zwraca neutralny sukces — NIE ujawnia,
 * czy e-mail istnieje.
 *
 * Locale rejestracji: metadane (role/first_name/last_name/locale) czyta trigger
 * `handle_new_user()` i ustawia z nich `account_locale`/`signup_locale`. `preferred_locale`
 * dopisujemy tu (best-effort, klient service-role), bo trigger go nie ustawia.
 */

import { getLocale } from 'next-intl/server';

import { redirect } from '@/i18n/navigation';
import { routing, type Locale } from '@/i18n/routing';
import { env } from '@/lib/env';
import { AppError, isAppError, type ErrorCode } from '@/lib/errors';
import { createServerClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  loginSchema,
  registerCandidateSchema,
  registerEmployerSchema,
  resetSchema,
  type LoginInput,
  type RegisterCandidateInput,
  type RegisterEmployerInput,
  type ResetInput,
} from '@/lib/validation/auth';

/** Wynik akcji przekazywany do formularza (serializowalny). Na sukcesie z przekierowaniem akcja nie wraca. */
export type AuthActionResult = { ok: true } | { ok: false; error: ErrorCode };

/** Role rozpoznawane przy przekierowaniu do panelu (self-signup: candidate/employer). */
type SignupRole = 'candidate' | 'employer';
type Role = SignupRole | 'admin';

/** Minimalny, strukturalny kształt błędu Supabase Auth (bez zależności od eksportu typu). */
type SupabaseAuthErrorShape = { code?: string | null; status?: number; message?: string };

/** Ścieżka panelu wg roli (bez prefiksu locale — dokłada go `redirect`/callback). */
function panelPath(role: Role): string {
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

/** Mapuje błąd Supabase Auth na `AppError` ze stabilnym kodem (bez wycieku technikaliów). */
function mapAuthError(error: SupabaseAuthErrorShape): AppError {
  const code = error.code ?? '';
  const status = error.status ?? 0;

  if (status === 429 || code === 'over_email_send_rate_limit' || code === 'over_request_rate_limit') {
    return new AppError('RATE_LIMITED', { cause: error, context: { authCode: code, status } });
  }
  if (
    code === 'invalid_credentials' ||
    code === 'invalid_grant' ||
    code === 'email_not_confirmed' ||
    status === 400
  ) {
    return new AppError('AUTH_INVALID_CREDENTIALS', { cause: error, context: { authCode: code, status } });
  }
  return new AppError('INTERNAL', { cause: error, context: { authCode: code, status } });
}

/** Odczytuje rolę zalogowanego użytkownika z profiles (RLS: właściciel czyta swój wiersz). */
async function resolveRole(
  supabase: Awaited<ReturnType<typeof createServerClient>>,
  userId: string,
): Promise<Role> {
  const { data } = await supabase.from('profiles').select('role').eq('id', userId).maybeSingle();
  const role = (data as { role?: string } | null)?.role;
  if (role === 'employer' || role === 'admin') {
    return role;
  }
  return 'candidate';
}

interface SignUpArgs {
  email: string;
  password: string;
  role: SignupRole;
  firstName: string;
  lastName: string;
  companyName?: string;
  locale: Locale;
}

/**
 * Tworzy konto Auth (signUp) z metadanymi dla triggera i linkiem potwierdzenia do
 * `/auth/callback`. Po utworzeniu dopisuje `preferred_locale` (best-effort, service-role).
 */
async function signUpUser(args: SignUpArgs): Promise<void> {
  const supabase = await createServerClient();

  const next = `/${args.locale}${panelPath(args.role)}`;
  const emailRedirectTo =
    `${env.siteUrl}/auth/callback` +
    `?next=${encodeURIComponent(next)}&locale=${encodeURIComponent(args.locale)}`;

  const metadata: Record<string, string> = {
    role: args.role,
    first_name: args.firstName,
    last_name: args.lastName,
    locale: args.locale,
  };
  if (args.companyName) {
    metadata['company_name'] = args.companyName;
  }

  const { data, error } = await supabase.auth.signUp({
    email: args.email,
    password: args.password,
    options: { emailRedirectTo, data: metadata },
  });

  if (error) {
    throw mapAuthError(error);
  }

  // preferred_locale nie jest ustawiany przez trigger — dopisujemy go osobno.
  // Best-effort: brak klucza service-role nie może zablokować rejestracji (email i tak
  // trafi do właściwego języka dzięki account_locale/signup_locale).
  const userId = data.user?.id;
  if (userId) {
    try {
      const admin = createAdminClient();
      await admin.from('profiles').update({ preferred_locale: args.locale }).eq('id', userId);
    } catch {
      // celowo pominięte — konto zostało utworzone poprawnie
    }
  }
}

/** Logowanie e-mail + hasło. Sukces → panel wg roli. */
export async function signIn(input: LoginInput): Promise<AuthActionResult> {
  const parsed = loginSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: 'VALIDATION_FAILED' };
  }

  const locale = await currentLocale();
  let role: Role = 'candidate';

  try {
    const supabase = await createServerClient();
    const { data, error } = await supabase.auth.signInWithPassword({
      email: parsed.data.email,
      password: parsed.data.password,
    });
    if (error) {
      throw mapAuthError(error);
    }
    const userId = data.user?.id;
    if (!userId) {
      throw new AppError('INTERNAL', { context: { reason: 'no_user_after_signin' } });
    }
    role = await resolveRole(supabase, userId);
  } catch (e) {
    return { ok: false, error: isAppError(e) ? e.code : 'INTERNAL' };
  }

  // `redirect` rzuca NEXT_REDIRECT (typ zwrotny `never`); `return` spełnia sygnaturę.
  return redirect({ href: panelPath(role), locale });
}

/** Rejestracja kandydata. Sukces → strona potwierdzenia e-maila. */
export async function registerCandidate(input: RegisterCandidateInput): Promise<AuthActionResult> {
  const parsed = registerCandidateSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: 'VALIDATION_FAILED' };
  }

  const locale = parsed.data.locale ?? (await currentLocale());

  try {
    await signUpUser({
      email: parsed.data.email,
      password: parsed.data.password,
      role: 'candidate',
      firstName: parsed.data.firstName,
      lastName: parsed.data.lastName,
      locale,
    });
  } catch (e) {
    return { ok: false, error: isAppError(e) ? e.code : 'INTERNAL' };
  }

  return redirect({ href: '/potwierdzenie', locale });
}

/** Rejestracja pracodawcy. Sukces → strona potwierdzenia e-maila. */
export async function registerEmployer(input: RegisterEmployerInput): Promise<AuthActionResult> {
  const parsed = registerEmployerSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: 'VALIDATION_FAILED' };
  }

  const locale = parsed.data.locale ?? (await currentLocale());

  try {
    await signUpUser({
      email: parsed.data.email,
      password: parsed.data.password,
      role: 'employer',
      firstName: parsed.data.firstName,
      lastName: parsed.data.lastName,
      companyName: parsed.data.companyName,
      locale,
    });
  } catch (e) {
    return { ok: false, error: isAppError(e) ? e.code : 'INTERNAL' };
  }

  return redirect({ href: '/potwierdzenie', locale });
}

/**
 * Wysyła link resetu hasła. Odpowiedź jest ZAWSZE neutralna (nie ujawnia, czy e-mail
 * istnieje). Wyjątki: błąd walidacji oraz brak konfiguracji (INTERNAL) są sygnalizowane.
 */
export async function requestPasswordReset(input: ResetInput): Promise<AuthActionResult> {
  const parsed = resetSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: 'VALIDATION_FAILED' };
  }

  const locale = await currentLocale();

  try {
    const supabase = await createServerClient();
    const redirectTo = `${env.siteUrl}/auth/callback?locale=${encodeURIComponent(locale)}`;
    const { error } = await supabase.auth.resetPasswordForEmail(parsed.data.email, { redirectTo });
    if (error) {
      const mapped = mapAuthError(error);
      // Rate-limit sygnalizujemy (nie ujawnia istnienia konta); resztę traktujemy neutralnie.
      if (mapped.code === 'RATE_LIMITED') {
        return { ok: false, error: 'RATE_LIMITED' };
      }
    }
  } catch (e) {
    if (isAppError(e) && e.code === 'INTERNAL') {
      return { ok: false, error: 'INTERNAL' };
    }
    // provider/nieznany błąd → pozostajemy neutralni
  }

  return { ok: true };
}

/** Wylogowanie. Zawsze przekierowuje na stronę logowania. */
export async function signOut(): Promise<void> {
  const locale = await currentLocale();
  try {
    const supabase = await createServerClient();
    await supabase.auth.signOut();
  } catch {
    // nawet przy błędzie przekierowujemy do logowania
  }
  redirect({ href: '/logowanie', locale });
}
