import { vi } from 'vitest';

/**
 * Atrapa runtime Better Auth + puli domeny dla testów Server Actions auth (#24).
 *
 * Użycie w pliku testu (fabryki `vi.mock` importują ten sam egzemplarz modułu):
 *   vi.mock('@/lib/auth/runtime', async () => (await import('../helpers/auth-portal')).runtimeModule);
 *   vi.mock('@/lib/db/runtime', async () => (await import('../helpers/auth-portal')).dbRuntimeModule);
 *   vi.mock('@/lib/db/transaction', async () => (await import('../helpers/auth-portal')).transactionModule);
 *   vi.mock('next/headers', async () => (await import('../helpers/auth-portal')).headersModule);
 * oraz `stubPortalEnv()` w `beforeEach` (komplet zmiennych kont PostgreSQL).
 */

export const SESSION_COOKIE = '__Secure-better-auth.session_token';

export class RedirectSignal extends Error {
  constructor(public readonly target: unknown) {
    super('NEXT_REDIRECT');
  }
}

export const api = {
  signInEmail: vi.fn(),
  signUpEmail: vi.fn(),
  requestPasswordReset: vi.fn(),
  resetPassword: vi.fn(),
  verifyEmail: vi.fn(),
  signOut: vi.fn(),
};

export const internalAdapter = {
  deleteSession: vi.fn(),
  deleteUserSessions: vi.fn(),
  findUserByEmail: vi.fn(),
};

const context = {
  authCookies: {
    sessionToken: { name: SESSION_COOKIE },
    sessionData: { name: '__Secure-better-auth.session_data' },
    dontRememberToken: { name: '__Secure-better-auth.dont_remember' },
  },
  internalAdapter,
};

export const auth = { api, $context: Promise.resolve(context) };

/** Wiersz profilu zwracany przez zapytanie roli; `Error` = awaria odczytu. */
export const profile: { row: Record<string, unknown> | null | Error } = { row: { role: 'candidate' } };
/** UUID-y, z którymi otwierano transakcje domeny (dowód: tożsamość z wyniku SDK, nie z wejścia). */
export const transactionUsers: (string | null)[] = [];

/** Cookies odpowiedzi akcji (atrapa `cookies()` z next/headers). */
export const cookieJar = new Map<string, { value: string; options?: Record<string, unknown> }>();

export const runtimeModule = { getAuthRuntime: vi.fn(async () => auth) };
export const dbRuntimeModule = { getDomainPool: vi.fn(async () => ({})) };
export const transactionModule = {
  withUserTransaction: vi.fn(
    async (_pool: unknown, userId: string | null, action: (tx: { query: () => Promise<unknown> }) => Promise<unknown>) => {
      transactionUsers.push(userId);
      return action({
        query: async () => {
          if (profile.row instanceof Error) throw profile.row;
          return { rows: profile.row ? [profile.row] : [] };
        },
      });
    },
  ),
};
/** Dodatkowe nagłówki żądania (np. zaufany adres proxy) — zerowane w `resetPortal`. */
export const requestHeaderValues: Record<string, string> = {};

export const headersModule = {
  headers: async () => new Headers({ 'user-agent': 'vitest', ...requestHeaderValues }),
  cookies: async () => ({
    get: (name: string) => (cookieJar.has(name) ? { name, value: cookieJar.get(name)!.value } : undefined),
    set: (name: string, value: string, options?: Record<string, unknown>) => {
      if (options?.['maxAge'] === 0) cookieJar.delete(name);
      else cookieJar.set(name, { value, options });
    },
    delete: (name: string) => {
      cookieJar.delete(name);
    },
  }),
};

export const USER_ID = '00000000-0000-4000-8000-000000000001';

/** Komplet konfiguracji kont PostgreSQL (tryb demo, bez limitera — limiter mockowany osobno). */
export function stubPortalEnv(): void {
  vi.stubEnv('DATABASE_APP_URL', 'postgresql://web:pw@localhost:5432/app');
  vi.stubEnv('DATABASE_AUTH_URL', 'postgresql://auth:pw@localhost:5432/app');
  vi.stubEnv('BETTER_AUTH_URL', 'https://pracuj.be');
  vi.stubEnv('BETTER_AUTH_SECRET', 's'.repeat(40));
}

/** Stan początkowy atrap przed każdym testem. */
export function resetPortal(): void {
  for (const fn of [...Object.values(api), ...Object.values(internalAdapter)]) fn.mockReset();
  api.signInEmail.mockResolvedValue({
    headers: new Headers({ 'set-cookie': `${SESSION_COOKIE}=session-token.sig; Path=/; HttpOnly; Secure; SameSite=Lax` }),
    response: { token: 'session-token', user: { id: USER_ID } },
  });
  api.signUpEmail.mockResolvedValue({ token: null, user: { id: USER_ID } });
  api.requestPasswordReset.mockResolvedValue({ status: true });
  api.resetPassword.mockResolvedValue({ status: true });
  api.signOut.mockResolvedValue({
    headers: new Headers({ 'set-cookie': `${SESSION_COOKIE}=; Max-Age=0; Path=/` }),
    response: { success: true },
  });
  profile.row = { role: 'candidate' };
  for (const key of Object.keys(requestHeaderValues)) delete requestHeaderValues[key];
  transactionUsers.length = 0;
  cookieJar.clear();
}

/** Błąd w kształcie `APIError` Better Auth (statusCode + body.code). */
export function authApiError(statusCode: number, code: string): Error {
  return Object.assign(new Error(`${code} message from SDK`), { statusCode, body: { code, message: code } });
}

/** Cel przekierowania albo błąd, gdy akcja nie przekierowała. */
export async function redirectTarget(run: () => Promise<unknown>): Promise<unknown> {
  try {
    await run();
  } catch (e) {
    if (e instanceof RedirectSignal) return e.target;
    throw e;
  }
  throw new Error('akcja nie przekierowała');
}

/** Wynik akcji albo `{ redirect }`. */
export async function outcome(run: () => Promise<unknown>): Promise<unknown> {
  try {
    return await run();
  } catch (e) {
    if (e instanceof RedirectSignal) return { redirect: e.target };
    throw e;
  }
}

export const navigationModule = {
  redirect: (url: string) => {
    throw new RedirectSignal(url);
  },
};
export const intlNavigationModule = {
  redirect: (args: { href: string; locale: string }) => {
    throw new RedirectSignal(`/${args.locale}${args.href}`);
  },
};
