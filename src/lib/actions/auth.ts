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
import { headers } from 'next/headers';
import { z } from 'zod/v3';
import type { User } from '@supabase/supabase-js';

import { redirect as redirectPath } from 'next/navigation';

import { redirect } from '@/i18n/navigation';
import { routing, type Locale } from '@/i18n/routing';
import { mapAuthError } from '@/lib/auth/map-auth-error';
import { roleFromProfileRead } from '@/lib/auth/profile-role';
import { env } from '@/lib/env';
import { AppError, isAppError, type ErrorCode } from '@/lib/errors';
import { checkRateLimit } from '@/lib/rate-limit';
import { captureError } from '@/lib/sentry';
import { createServerClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
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
import { safeNextPath } from '@/lib/auth/next-path';

/**
 * Schemat ustawienia nowego hasła (po sesji recovery). Reużywa `passwordSchema`
 * (min 8, litera + cyfra) i wymaga zgodnego powtórzenia. Komunikaty to klucze i18n.
 * Definiowany lokalnie (plik `'use server'` może eksportować tylko akcje async).
 */
const updatePasswordSchema = z
  .object({
    password: passwordSchema,
    passwordConfirm: z.string().min(1, 'auth.error.passwordConfirmRequired'),
  })
  .refine((data) => data.password === data.passwordConfirm, {
    path: ['passwordConfirm'],
    message: 'auth.error.passwordMismatch',
  });

/** Wejście akcji `updatePassword` (walidowane po stronie serwera i klienta). */
export type UpdatePasswordInput = z.infer<typeof updatePasswordSchema>;

/** Wynik akcji przekazywany do formularza (serializowalny). Na sukcesie z przekierowaniem akcja nie wraca. */
export type AuthActionResult = { ok: true } | { ok: false; error: ErrorCode };

/** Role rozpoznawane przy przekierowaniu do panelu (self-signup: candidate/employer). */
type SignupRole = 'candidate' | 'employer';
type Role = SignupRole | 'admin';

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

/**
 * Odczytuje rolę zalogowanego użytkownika z profiles (RLS: właściciel czyta swój wiersz).
 * Błąd, brak profilu lub nieznana rola → AppError('INTERNAL'), nigdy domyślny kandydat.
 */
async function resolveRole(
  supabase: Awaited<ReturnType<typeof createServerClient>>,
  userId: string,
): Promise<Role> {
  const result = await supabase.from('profiles').select('role').eq('id', userId).maybeSingle();
  return roleFromProfileRead(result);
}

interface SignUpArgs {
  email: string;
  password: string;
  role: SignupRole;
  firstName: string;
  lastName: string;
  companyName?: string;
  locale: Locale;
  /** Zgoda na regulamin i politykę prywatności z walidowanego wejścia akcji. */
  agreeTerms: boolean;
  /** Zwalidowany cel po potwierdzeniu e-maila (np. oferta); brak → panel wg roli. */
  next?: string | null;
}

/**
 * Tworzy konto Auth (signUp) z metadanymi dla triggera i linkiem potwierdzenia do
 * `/auth/callback`. Wymaga zgody na regulamin; receipt akceptacji jest obowiązkowy (jego
 * brak cofa niepotwierdzone konto). `preferred_locale` dopisuje best-effort (service-role).
 */
async function signUpUser(args: SignUpArgs): Promise<void> {
  // Zgoda sprawdzana na serwerze niezależnie od formularza: bez niej nie tworzymy konta.
  if (args.agreeTerms !== true) {
    throw new AppError('VALIDATION_FAILED', { context: { reason: 'terms_not_accepted' } });
  }
  const supabase = await createServerClient();

  const next = args.next ?? `/${args.locale}${panelPath(args.role)}`;
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

  // Brak tożsamości = adres już zarejestrowany (odpowiedź neutralna dostawcy): nie ma nowego
  // konta ani receiptu do zapisania, a błąd ujawniałby istnienie konta.
  const user = data.user;
  if (!user?.identities?.length) return;

  // Receipt akceptacji regulaminu i polityki prywatności jest WARUNKIEM konta: bez niego
  // rejestracja się nie kończy. Kluczujemy po userId — auth.uid() jest jeszcze null (konto
  // czeka na potwierdzenie e-mail), więc zapis idzie service-rolem.
  let admin: ReturnType<typeof createAdminClient>;
  try {
    admin = createAdminClient();
    const store = await headers();
    const ip =
      store.get('x-real-ip')?.trim() ||
      store.get('x-forwarded-for')?.split(',').map((p) => p.trim()).filter(Boolean).pop() ||
      null;
    const { error: rcErr } = await admin.rpc('record_document_acceptance', {
      p_profile_id: user.id,
      p_documents: ['terms', 'privacy'],
      p_locale: args.locale,
      p_ip: ip,
      p_user_agent: store.get('user-agent'),
    });
    if (rcErr) throw rcErr;
  } catch (e) {
    captureError(e, { area: 'auth.recordDocumentAcceptance' });
    await discardUnconfirmedSignup(user);
    throw new AppError('INTERNAL', { context: { reason: 'signup_receipt_failed' } });
  }

  // preferred_locale nie jest ustawiany przez trigger — dopisujemy go osobno. Best-effort:
  // e-mail i tak trafi do właściwego języka dzięki account_locale/signup_locale.
  try {
    const { error: localeErr } = await admin
      .from('profiles')
      .update({ preferred_locale: args.locale })
      .eq('id', user.id);
    if (localeErr) captureError(localeErr, { area: 'auth.signUpUser.preferredLocale' });
  } catch (e) {
    captureError(e, { area: 'auth.signUpUser.preferredLocale' });
  }
}

/**
 * Cofa świeżo utworzone, NIEpotwierdzone konto, gdy nie udało się zapisać receiptu.
 * Konto już potwierdzone zostaje nietknięte.
 */
async function discardUnconfirmedSignup(user: User): Promise<void> {
  if (user.email_confirmed_at) return;
  try {
    const { error } = await createAdminClient().auth.admin.deleteUser(user.id);
    if (error) captureError(error, { area: 'auth.signUpUser.discard' });
  } catch (e) {
    captureError(e, { area: 'auth.signUpUser.discard' });
  }
}

/**
 * Logowanie e-mail + hasło. Sukces → bezpieczny `next` (np. oferta, z której kandydat przyszedł)
 * albo panel wg roli. `next` jest walidowany ponownie po stronie serwera (`safeNextPath`) —
 * wartość spoza serwisu jest ignorowana (brak open redirect).
 */
export async function signIn(input: LoginInput, next?: string | null): Promise<AuthActionResult> {
  // Rate limit per IP (10 prób / 5 min) — ochrona przed brute-force. Bez ujawniania detali.
  if (!(await checkRateLimit('signin', { max: 10, windowSeconds: 300 }))) {
    return { ok: false, error: 'RATE_LIMITED' };
  }

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
    try {
      role = await resolveRole(supabase, userId);
    } catch (e) {
      // Bez znanej roli nie zostawiamy półotwartej sesji: wylogowanie (best-effort)
      // i kontrolowany błąd zamiast przekierowania do panelu innej roli.
      captureError(e, { area: 'auth.signIn.resolveRole' });
      await supabase.auth.signOut().catch(() => undefined);
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

/**
 * Rejestracja kandydata. Sukces → strona potwierdzenia e-maila. Bezpieczny `next` trafia do
 * linku potwierdzającego (`/auth/callback?next=`), więc po potwierdzeniu kandydat wraca np. do oferty.
 */
export async function registerCandidate(
  input: RegisterCandidateInput,
  next?: string | null,
): Promise<AuthActionResult> {
  // Rate limit per IP (5 rejestracji / godz) — ochrona przed masowym zakładaniem kont.
  if (!(await checkRateLimit('register', { max: 5, windowSeconds: 3600 }))) {
    return { ok: false, error: 'RATE_LIMITED' };
  }

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
      agreeTerms: parsed.data.agreeTerms,
      next: safeNextPath(next),
    });
  } catch (e) {
    return { ok: false, error: isAppError(e) ? e.code : 'INTERNAL' };
  }

  return redirect({ href: '/potwierdzenie', locale });
}

/** Rejestracja pracodawcy. Sukces → strona potwierdzenia e-maila. */
export async function registerEmployer(input: RegisterEmployerInput): Promise<AuthActionResult> {
  // Rate limit per IP (5 rejestracji / godz) — ochrona przed masowym zakładaniem kont.
  if (!(await checkRateLimit('register', { max: 5, windowSeconds: 3600 }))) {
    return { ok: false, error: 'RATE_LIMITED' };
  }

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
      agreeTerms: parsed.data.agreeTerms,
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
  // Rate limit per IP (5 prób / godz) — nie ujawnia istnienia konta (RATE_LIMITED jest neutralny).
  if (!(await checkRateLimit('password-reset', { max: 5, windowSeconds: 3600 }))) {
    return { ok: false, error: 'RATE_LIMITED' };
  }

  const parsed = resetSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: 'VALIDATION_FAILED' };
  }

  const locale = await currentLocale();

  try {
    const supabase = await createServerClient();
    // Callback wymienia kod recovery na sesję i przekierowuje na stronę ustawienia hasła
    // (dokładnie tam, w języku odbiorcy). `next` jest allowlistowany w handlerze callbacku.
    const next = `/${locale}/ustaw-nowe-haslo`;
    const redirectTo =
      `${env.siteUrl}/auth/callback` +
      `?next=${encodeURIComponent(next)}&locale=${encodeURIComponent(locale)}`;
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

/**
 * Ustawia nowe hasło po sesji recovery (użytkownik trafił tu z linku resetu przez
 * `/auth/callback`, który wymienił kod na sesję). Waliduje wejście (min 8, litera+cyfra,
 * zgodne powtórzenie) i wywołuje `supabase.auth.updateUser({ password })`.
 *
 * Zwraca serializowalny wynik — bez technikaliów (Invariant #8). Brak aktywnej sesji
 * (np. link wygasł) → `AUTH_INVALID_CREDENTIALS`.
 */
export async function updatePassword(input: UpdatePasswordInput): Promise<AuthActionResult> {
  const parsed = updatePasswordSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: 'VALIDATION_FAILED' };
  }

  try {
    const supabase = await createServerClient();

    // Wymagana aktywna sesja (recovery). getUser() weryfikuje token po stronie Auth.
    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData.user) {
      return { ok: false, error: 'AUTH_INVALID_CREDENTIALS' };
    }

    const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
    if (error) {
      throw mapAuthError(error);
    }
  } catch (e) {
    return { ok: false, error: isAppError(e) ? e.code : 'INTERNAL' };
  }

  return { ok: true };
}

/** Prosty, deterministyczny rdzeń sluga z losowym sufiksem (slug `companies` jest UNIQUE). */
function companySlug(name: string): string {
  const base = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');
  const suffix = Math.random().toString(36).slice(2, 8);
  return base ? `${base}-${suffix}` : `firma-${suffix}`;
}

/**
 * Bootstrap firmy pracodawcy (idempotentny). Jeśli zalogowany użytkownik NIE jest jeszcze
 * członkiem żadnej firmy, tworzy firmę + właściciela atomowo przez RPC
 * `create_company_with_owner` (nazwa z metadanych rejestracji `company_name`).
 * Jeśli członkostwo już istnieje — nic nie robi.
 *
 * Może przyjąć gotowego klienta (np. z callbacku Auth, który po wymianie kodu ma sesję
 * w pamięci); bez argumentu tworzy własnego klienta z sesji cookie.
 */
export async function bootstrapCompany(
  client?: Awaited<ReturnType<typeof createServerClient>>,
): Promise<AuthActionResult> {
  try {
    const supabase = client ?? (await createServerClient());

    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData.user) {
      return { ok: false, error: 'PERMISSION_DENIED' };
    }
    const user = userData.user;

    // Idempotencja: jeśli użytkownik jest już członkiem firmy, kończymy sukcesem.
    const { data: membership } = await supabase
      .from('company_members')
      .select('company_id')
      .eq('profile_id', user.id)
      .limit(1)
      .maybeSingle();
    if (membership) {
      return { ok: true };
    }

    const metadata = user.user_metadata as Record<string, unknown> | undefined;
    const rawName = metadata?.['company_name'];
    const companyName = typeof rawName === 'string' ? rawName.trim() : '';
    if (!companyName) {
      return { ok: false, error: 'VALIDATION_FAILED' };
    }

    const { error } = await supabase.rpc('create_company_with_owner', {
      p_name: companyName,
      p_slug: companySlug(companyName),
    });
    if (error) {
      throw new AppError('INTERNAL', { cause: error, context: { rpc: 'create_company_with_owner' } });
    }
  } catch (e) {
    return { ok: false, error: isAppError(e) ? e.code : 'INTERNAL' };
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
