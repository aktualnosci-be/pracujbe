import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { createAuthServer, type AuthServerDependencies } from '../../../src/lib/auth/server';
import { readPortalIdentity, type PortalIdentity } from '../../../src/lib/auth/session';
import { withCandidateSignup, withEmployerSignup } from '../../../src/lib/auth/signup-context';
import { createRuntimePool } from '../../../src/lib/db/pool';
import { withUserTransaction, type TransactionQuery } from '../../../src/lib/db/transaction';

/**
 * Stos serwerowy docelowej ścieżki Railway (#24/#25) na izolowanej bazie:
 * - Better Auth (createAuthServer) na OGRANICZONYM loginie auth — rejestracja, weryfikacja
 *   e-mail, logowanie i cookie sesji jak w przeglądarce (origin/CSRF włączone);
 * - pula domeny na OGRANICZONYM loginie aplikacji (createRuntimePool odrzuca migratora);
 * - tożsamość wyłącznie z cookie żądania (readPortalIdentity), potem withUserTransaction
 *   (SET LOCAL ROLE authenticated + app.current_uid) → RLS i RPC jak w produkcji.
 * Test nigdy nie podaje identyfikatora użytkownika do zapytań domeny.
 */

type Verification = Parameters<NonNullable<AuthServerDependencies['sendVerificationEmail']>>[0];

const AUTH_ORIGIN = 'https://auth.e2e-real.invalid';
const AUTH_SECRET = 'e2e-real-flow-secret-not-for-production-0123456789abcdef';
const PASSWORD = 'RealFlowPassword123';

export type Locale = 'pl' | 'nl' | 'fr' | 'en';

export interface Actor {
  readonly email: string;
  /** Cookie sesji wydane przez Better Auth — jedyny nośnik tożsamości. */
  readonly cookie: string;
  /** Tożsamość odczytana z cookie przez serwer (do asercji, nigdy jako wejście zapytań). */
  identity(): Promise<PortalIdentity | null>;
  /** Jedno „żądanie” serwera: tożsamość z cookie → transakcja pod RLS. */
  request<T>(action: (tx: TransactionQuery) => Promise<T>): Promise<T>;
}

export interface Stack {
  readonly admin: Pool;
  signUpCandidate(email: string, locale: Locale, name: [string, string]): Promise<Actor>;
  signUpEmployer(email: string, locale: Locale, name: [string, string], company: string): Promise<Actor>;
  /** Sesja z cookie podanego wprost (np. sfałszowanego) — kontrola ujemna. */
  actorFromCookie(email: string, cookie: string): Actor;
  close(): Promise<void>;
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Brak ${name}: uruchom przez \`npm run test:e2e:real\`.`);
  return value;
}

export async function createStack(): Promise<Stack> {
  const admin = new Pool({ connectionString: required('E2E_REAL_ADMIN_URL'), max: 2 });
  const domain = await createRuntimePool(required('E2E_REAL_APP_URL'), 'domain');
  const authPool = await createRuntimePool(required('E2E_REAL_AUTH_URL'), 'auth');
  const verifications: Verification[] = [];
  const auth = createAuthServer({
    pool: authPool,
    baseURL: AUTH_ORIGIN,
    secret: AUTH_SECRET,
    sendVerificationEmail: async (message) => { verifications.push(message); },
    sendResetPassword: async () => undefined,
  });

  const post = (path: string, body: object) => auth.handler(new Request(`${AUTH_ORIGIN}/api/auth/${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: AUTH_ORIGIN },
    body: JSON.stringify(body),
  }));
  const cookieFrom = (response: Response) =>
    response.headers.getSetCookie().map((value) => value.split(';')[0]).join('; ');

  const actorFromCookie = (email: string, cookie: string): Actor => {
    const identity = () => readPortalIdentity(auth, domain, new Headers({ cookie }));
    return {
      email,
      cookie,
      identity,
      async request(action) {
        const who = await identity();
        if (!who) throw new Error('UNAUTHENTICATED');
        return withUserTransaction(domain, who.id, action);
      },
    };
  };

  async function verifyAndSignIn(email: string): Promise<Actor> {
    const message = verifications.find((m) => m.user.email === email);
    if (!message) throw new Error(`Brak e-maila weryfikacyjnego dla ${email}.`);
    const verified = await auth.handler(new Request(message.url));
    if (verified.status !== 302) throw new Error(`Weryfikacja e-mail: HTTP ${verified.status}.`);
    const signedIn = await post('sign-in/email', { email, password: PASSWORD });
    if (signedIn.status !== 200) throw new Error(`Logowanie: HTTP ${signedIn.status}.`);
    return actorFromCookie(email, cookieFrom(signedIn));
  }

  const form = (email: string, locale: Locale, [firstName, lastName]: [string, string]) => ({
    email, locale, password: PASSWORD, passwordConfirm: PASSWORD, firstName, lastName, agreeTerms: true,
    // #492: deklaracja progu wieku (bez daty urodzenia) — rejestracja kandydata jej wymaga.
    ageConfirmed: true, minAge: 18,
  });

  return {
    admin,
    actorFromCookie,
    async signUpCandidate(email, locale, name) {
      await withCandidateSignup(form(email, locale, name), 'en', (body) => auth.api.signUpEmail({ body }));
      return verifyAndSignIn(email);
    },
    async signUpEmployer(email, locale, name, company) {
      await withEmployerSignup({ ...form(email, locale, name), companyName: company }, 'en',
        (body) => auth.api.signUpEmail({ body }));
      return verifyAndSignIn(email);
    },
    async close() {
      await Promise.allSettled([domain.end(), authPool.end(), admin.end()]);
    },
  };
}

function rpcCall(name: string, args: Record<string, unknown>): string {
  if (!/^[a-z_0-9]+$/.test(name)) throw new Error('Nieprawidłowa nazwa RPC.');
  const keys = Object.keys(args);
  for (const key of keys) if (!/^p_[a-z_]+$/.test(key)) throw new Error('Nieprawidłowy parametr RPC.');
  return `public.${name}(${keys.map((key, i) => `${key} => $${i + 1}`).join(', ')})`;
}

/** RPC skalarne z nazwanymi argumentami (jak supabase.rpc) — wartości zawsze przez $n. */
export async function rpc<T = unknown>(
  tx: TransactionQuery,
  name: string,
  args: Record<string, unknown> = {},
): Promise<T> {
  const result = await tx.query(`SELECT ${rpcCall(name, args)} AS value`, Object.values(args));
  return rows<{ value: T }>(result)[0]!.value;
}

/** RPC zwracające tabelę. */
export async function rpcRows<T = Record<string, unknown>>(
  tx: TransactionQuery,
  name: string,
  args: Record<string, unknown> = {},
): Promise<T[]> {
  return rows<T>(await tx.query(`SELECT * FROM ${rpcCall(name, args)}`, Object.values(args)));
}

/** Oczekiwany błąd domenowy (prefiks komunikatu RAISE, np. APPLICATION_ALREADY_EXISTS). */
export async function expectDomainError(promise: Promise<unknown>, code: string | RegExp): Promise<void> {
  try {
    await promise;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const ok = typeof code === 'string' ? message.includes(code) : code.test(message);
    if (!ok) throw new Error(`Oczekiwano błędu ${String(code)}, otrzymano: ${message}`);
    return;
  }
  throw new Error(`Oczekiwano błędu ${String(code)}, operacja zakończyła się sukcesem.`);
}

export const rows = <T>(result: unknown) => (result as { rows: T[] }).rows;
export const uuid = () => randomUUID();
