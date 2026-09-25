import { execFileSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadProductionMigrations } from '../../scripts/db/production-migrations.mjs';
import { applyMigrations } from '../../scripts/db/migrate.mjs';

/**
 * Pionowy przepływ kont (#24) na izolowanym PostgreSQL 16: prawdziwe Server Actions
 * (`src/lib/actions/auth.ts`), Better Auth z plugin `nextCookies`, ograniczone loginy auth/domeny/
 * poczty, trwała kolejka wiadomości (0061) i worker renderujący szablony. Jedyne atrapy: nagłówki
 * i cookies żądania Next (słoik cookies = przeglądarka), przekierowania, limiter (osobny test
 * PostgreSQL: rate-limit.test.ts) i dostawca e-mail (przechwycony list, bez sieci).
 *
 * Link z e-maila jest wyciągany z WYRENDEROWANEGO listu — test przechodzi dokładnie tę drogę,
 * którą przejdzie człowiek: rejestracja → list → potwierdzenie → panel → wylogowanie → reset.
 */

const browser = vi.hoisted(() => ({
  jar: new Map<string, string>(),
  userAgent: 'vitest-real-auth',
  locale: 'pl',
}));

class Redirect extends Error {
  constructor(public readonly target: string) {
    super('NEXT_REDIRECT');
  }
}

const nextHeaders = vi.hoisted(() => () => {
  const headers = async () => {
    const cookie = [...browser.jar].map(([name, value]) => `${name}=${value}`).join('; ');
    return new Headers({ 'user-agent': browser.userAgent, ...(cookie ? { cookie } : {}) });
  };
  const cookies = async () => ({
    get: (name: string) => (browser.jar.has(name) ? { name, value: browser.jar.get(name)! } : undefined),
    getAll: () => [...browser.jar].map(([name, value]) => ({ name, value })),
    set: (name: string, value: string, options?: { maxAge?: number }) => {
      if (options?.maxAge === 0 || value === '') browser.jar.delete(name);
      else browser.jar.set(name, value);
    },
    delete: (name: string) => {
      browser.jar.delete(name);
    },
  });
  return { headers, cookies };
});
vi.mock('next/headers', nextHeaders);
// Plugin `nextCookies()` importuje `next/headers.js` — ta sama atrapa pod drugim specyfikatorem.
vi.mock('next/headers.js', nextHeaders);
vi.mock('next-intl/server', () => ({ getLocale: async () => browser.locale }));
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Redirect(url);
  },
}));
vi.mock('@/i18n/navigation', () => ({
  redirect: (args: { href: string; locale: string }) => {
    throw new Redirect(`/${args.locale}${args.href}`);
  },
}));
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: async () => true }));
// Konfiguracja integracyjna nie transformuje JSX szablonów; prawdziwy render tych samych danych
// sprawdza tests/unit/auth-email-worker.test.ts. Tu list niesie dokładnie przygotowany link.
vi.mock('@/emails/templates', () => ({
  renderEmail: async (_type: string, locale: string, data: { confirmationUrl?: string; resetUrl?: string }) => ({
    subject: locale, html: `<a href="${data.confirmationUrl ?? data.resetUrl}">link</a>`, text: 'link',
  }),
}));
vi.mock('@/lib/sentry', () => ({ captureError: vi.fn() }));

const container = 'pracujbe-auth-actions-test-' + randomUUID();
const clusterPassword = randomUUID();
const PASSWORD = 'RealAuthPassword1';
const NEW_PASSWORD = 'RealAuthPassword2';
const baseURL = 'https://pracuj.invalid';
let created = false;
let admin: Pool;
let mail: Pool;

type Actions = typeof import('../../src/lib/actions/auth');
let actions: Actions;
let processAuthEmailBatch: typeof import('../../src/lib/auth/email-worker').processAuthEmailBatch;
let getCurrentIdentity: typeof import('../../src/lib/auth/current').getCurrentIdentity;

function docker(...args: string[]): string {
  const windows = process.platform === 'win32';
  return execFileSync(windows ? 'wsl.exe' : 'docker',
    windows ? ['-d', 'Ubuntu', '--', 'docker', ...args] : args,
    { encoding: 'utf8', timeout: 60_000 }).trim();
}

async function login(name: string, role: string, target: URL): Promise<string> {
  const password = randomBytes(24).toString('hex');
  await admin.query(`CREATE ROLE ${name} LOGIN PASSWORD '${password}' NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS`);
  await admin.query(`GRANT ${role} TO ${name}`);
  const url = new URL(target.href);
  url.username = name;
  url.password = password;
  return url.href;
}

beforeAll(async () => {
  docker('run', '--detach', '--rm', '--name', container,
    '--publish', '127.0.0.1::5432', '--tmpfs', '/var/lib/postgresql/data',
    '--env', 'POSTGRES_PASSWORD=' + clusterPassword,
    '--env', 'POSTGRES_DB=auth_actions_test', 'postgres:16');
  created = true;
  const port = Number(docker('port', container, '5432/tcp').split(':').at(-1));
  if (!Number.isInteger(port) || port < 1) throw new Error('Brak portu izolowanej bazy.');
  const target = new URL(`postgresql://postgres:${clusterPassword}@127.0.0.1:${port}/auth_actions_test`);
  admin = new Pool({ connectionString: target.href, max: 2, connectionTimeoutMillis: 2_000 });
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    try { await admin.query('SELECT 1'); ready = true; break; }
    catch { await new Promise(resolve => setTimeout(resolve, 250)); }
  }
  if (!ready) throw new Error('Izolowany PostgreSQL nie uruchomił się.');
  // Kolejność jak w produkcji (bootstrap, potem domena i auth w globalnej numeracji):
  // migracje domeny po 0059 mogą zmieniać obiekty auth (np. 0108, #493).
  await applyMigrations(admin, await loadProductionMigrations());
  for (const locale of ['pl', 'nl', 'fr', 'en']) {
    for (const document of ['terms', 'privacy']) {
      await admin.query('INSERT INTO public.consent_versions(document, version, locale, is_current, published_at) VALUES ($1,$2,$3,true,now())',
        [document, `${document}-${locale}-v1`, locale]);
    }
  }

  // Konfiguracja jak w Railway: osobne ograniczone loginy (pule odrzucają migratora).
  vi.stubEnv('DATABASE_AUTH_URL', await login('actions_auth_login', 'pracujbe_auth', target));
  vi.stubEnv('DATABASE_APP_URL', await login('actions_web_login', 'pracujbe_app', target));
  const mailUrl = await login('actions_mail_login', 'pracujbe_auth_mail', target);
  vi.stubEnv('BETTER_AUTH_URL', baseURL);
  vi.stubEnv('BETTER_AUTH_SECRET', randomBytes(32).toString('hex'));
  vi.stubEnv('APP_MODE', '');
  vi.stubEnv('NEXT_PUBLIC_TURNSTILE_SITE_KEY', '');
  vi.stubEnv('TURNSTILE_SECRET_KEY', '');

  const { createRuntimePool } = await import('../../src/lib/db/pool');
  mail = await createRuntimePool(mailUrl, 'auth_mail');
  actions = await import('../../src/lib/actions/auth');
  ({ processAuthEmailBatch } = await import('../../src/lib/auth/email-worker'));
  ({ getCurrentIdentity } = await import('../../src/lib/auth/current'));
});

afterAll(async () => {
  vi.unstubAllEnvs();
  try {
    await mail?.end();
    await admin?.end();
  } finally {
    if (created) docker('rm', '--force', container);
  }
});

beforeEach(() => {
  browser.jar.clear();
  browser.locale = 'pl';
});

async function outcome(run: () => Promise<unknown>): Promise<unknown> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof Redirect) return { redirect: error.target };
    throw error;
  }
}

/** Worker wysyła kolejkę; zwraca linki z wyrenderowanych listów do danego adresu. */
async function deliver(to: string): Promise<URL[]> {
  const sent: { to: string; html: string }[] = [];
  const result = await processAuthEmailBatch(mail, {
    send: async (message) => {
      sent.push(message);
      return { id: `provider-${randomUUID()}` };
    },
  }, { baseURL, from: 'Pracuj.be <no-reply@pracuj.invalid>' });
  expect(result.ok).toBe(true);
  return sent.filter((m) => m.to === to).flatMap((m) =>
    [...m.html.matchAll(/href="(https:\/\/pracuj\.invalid\/[^"]+)"/g)].map((match) => new URL(match[1]!.replaceAll('&amp;', '&'))),
  ).filter((url) => url.hash.startsWith('#token='));
}

const tokenOf = (url: URL) => new URLSearchParams(url.hash.slice(1)).get('token')!;
const form = (email: string, locale: 'pl' | 'nl' | 'fr' | 'en') => ({
  email, password: PASSWORD, passwordConfirm: PASSWORD, firstName: 'Anna', lastName: 'Nowak',
  agreeTerms: true as const, privacyNoticeAck: true as const, locale,
});

/** Tożsamość, jaką zobaczy serwer przy kolejnym żądaniu z bieżącymi cookies. */
async function identity() {
  // `cache()` Reacta poza renderem nie zapamiętuje — każde wywołanie to nowe „żądanie”.
  return getCurrentIdentity();
}

describe('konta portalu na PostgreSQL — Server Actions', () => {
  it('pracodawca: rejestracja → list w języku odbiorcy → potwierdzenie kliknięciem → firma i panel', async () => {
    const email = 'employer-nl@example.invalid';
    browser.locale = 'nl';
    expect(await outcome(() => actions.registerEmployer({ ...form(email, 'nl'), companyName: 'Bouw NV' })))
      .toEqual({ redirect: '/nl/potwierdzenie' });
    // Przed potwierdzeniem: brak sesji i logowanie odmawia z komunikatem „potwierdź e-mail”.
    expect(browser.jar.size).toBe(0);
    expect(await actions.signIn({ email, password: PASSWORD })).toEqual({ ok: false, error: 'AUTH_EMAIL_NOT_CONFIRMED' });

    const links = await deliver(email);
    // List z rejestracji (+ ewentualnie ponowny po próbie logowania, sendOnSignIn; w tej samej
    // sekundzie JWT jest identyczny, więc kolejka go deduplikuje). Zawsze w języku odbiorcy.
    expect(links.length).toBeGreaterThanOrEqual(1);
    for (const link of links) {
      expect(link.pathname).toBe('/nl/potwierdz-email');
      expect(link.search).toBe('');
    }

    // Otwarcie strony niczego nie zmienia — dopiero akcja przycisku.
    const verifiedBefore = (await admin.query('SELECT email_verified FROM auth.users WHERE email=$1', [email])).rows[0];
    expect(verifiedBefore.email_verified).toBe(false);

    // Dwa równoległe kliknięcia (dwie karty): jedna firma, jeden owner.
    const results = await Promise.all([
      outcome(() => actions.confirmEmail(tokenOf(links[0]!))),
      outcome(() => actions.confirmEmail(tokenOf(links.at(-1)!))),
    ]);
    expect(results).toContainEqual({ redirect: '/nl/employer' });
    const companies = (await admin.query(`SELECT c.name, m.role, m.is_active FROM public.company_members m
      JOIN public.companies c ON c.id=m.company_id JOIN auth.users u ON u.id=m.profile_id WHERE u.email=$1`, [email])).rows;
    expect(companies).toEqual([{ name: 'Bouw NV', role: 'owner', is_active: true }]);

    expect(await identity()).toMatchObject({ role: 'employer' });

    // Wylogowanie unieważnia sesję w bazie; stare cookie nie daje tożsamości.
    const cookieBefore = new Map(browser.jar);
    expect(await outcome(() => actions.signOut())).toEqual({ redirect: '/nl/logowanie' });
    expect(await identity()).toBeNull();
    for (const [name, value] of cookieBefore) browser.jar.set(name, value);
    expect(await identity()).toBeNull();
  });

  it('kandydat: potwierdzenie wraca do zapamiętanej oferty; logowanie prowadzi do panelu wg roli z profilu', async () => {
    const email = 'candidate-fr@example.invalid';
    browser.locale = 'fr';
    expect(await outcome(() => actions.registerCandidate(form(email, 'fr'), '/fr/oferty-pracy/soudeur-1')))
      .toEqual({ redirect: '/fr/potwierdzenie' });
    const [link] = await deliver(email);
    expect(link!.pathname).toBe('/fr/potwierdz-email');
    expect(await outcome(() => actions.confirmEmail(tokenOf(link!)))).toEqual({ redirect: '/fr/oferty-pracy/soudeur-1' });
    expect(await identity()).toMatchObject({ role: 'candidate' });

    // Ten sam link ponownie: konto już potwierdzone → bez nowej sesji, strona logowania.
    browser.jar.clear();
    expect(await outcome(() => actions.confirmEmail(tokenOf(link!)))).toEqual({ redirect: '/fr/logowanie' });
    expect(browser.jar.size).toBe(0);

    expect(await actions.signIn({ email, password: 'ZleHaslo123' })).toEqual({ ok: false, error: 'AUTH_INVALID_CREDENTIALS' });
    expect(await outcome(() => actions.signIn({ email, password: PASSWORD }))).toEqual({ redirect: '/fr/candidate' });

    // Zawieszenie konta działa od następnego żądania (rola i stan z profilu, bez cache).
    const activeSessions = async () => (await admin.query(`SELECT count(*)::int AS n FROM auth.sessions s
      JOIN auth.users u ON u.id=s.user_id WHERE u.email=$1 AND s.expires_at > now()`, [email])).rows[0].n as number;
    await admin.query('UPDATE public.profiles SET is_active=false WHERE id=(SELECT id FROM auth.users WHERE email=$1)', [email]);
    expect(await identity()).toBeNull();
    browser.jar.clear();
    const before = await activeSessions();
    expect(await actions.signIn({ email, password: PASSWORD })).toEqual({ ok: false, error: 'INTERNAL' });
    // Sesja wydana przez SDK dla nieaktywnego profilu została cofnięta w bazie i w cookies.
    expect(browser.jar.size).toBe(0);
    expect(await activeSessions()).toBe(before);
    await admin.query('UPDATE public.profiles SET is_active=true WHERE id=(SELECT id FROM auth.users WHERE email=$1)', [email]);
  });

  it('reset: neutralny wynik, list w języku ODBIORCY, token raz, sesje unieważnione, nowe hasło działa', async () => {
    const email = 'reset-en@example.invalid';
    browser.locale = 'en';
    await outcome(() => actions.registerCandidate(form(email, 'en'), null));
    const [confirm] = await deliver(email);
    await outcome(() => actions.confirmEmail(tokenOf(confirm!)));
    const sessionCookies = new Map(browser.jar);
    expect(await identity()).toMatchObject({ role: 'candidate' });
    await admin.query("UPDATE public.profiles SET preferred_locale='nl' WHERE id=(SELECT id FROM auth.users WHERE email=$1)", [email]);

    // Formularz otwarty po polsku; konto istniejące i nieistniejące — ten sam wynik.
    browser.locale = 'pl';
    browser.jar.clear();
    expect(await actions.requestPasswordReset({ email })).toEqual({ ok: true });
    expect(await actions.requestPasswordReset({ email: 'nobody@example.invalid' })).toEqual({ ok: true });
    const [reset] = await deliver(email);
    expect(reset!.pathname).toBe('/nl/ustaw-nowe-haslo');
    expect(await deliver('nobody@example.invalid')).toEqual([]);

    const token = tokenOf(reset!);
    // Sesja innego konta nie jest prawem do resetu; bez tokenu nic się nie zmienia.
    expect(await actions.updatePassword({ password: NEW_PASSWORD, passwordConfirm: NEW_PASSWORD, token: '' }))
      .toEqual({ ok: false, error: 'AUTH_LINK_INVALID' });
    expect(await actions.updatePassword({ password: NEW_PASSWORD, passwordConfirm: NEW_PASSWORD, token }))
      .toEqual({ ok: true });
    expect(await actions.updatePassword({ password: 'Trzecie1Haslo', passwordConfirm: 'Trzecie1Haslo', token }))
      .toEqual({ ok: false, error: 'AUTH_LINK_INVALID' });

    // Sesja sprzed resetu jest unieważniona.
    for (const [name, value] of sessionCookies) browser.jar.set(name, value);
    expect(await identity()).toBeNull();
    browser.jar.clear();
    expect(await actions.signIn({ email, password: PASSWORD })).toEqual({ ok: false, error: 'AUTH_INVALID_CREDENTIALS' });
    expect(await outcome(() => actions.signIn({ email, password: NEW_PASSWORD }))).toEqual({ redirect: '/pl/candidate' });
  });

  it('ponowna rejestracja istniejącego adresu: ten sam wynik, bez zmiany roli ani nowego konta', async () => {
    const email = 'candidate-fr@example.invalid';
    const before = (await admin.query(`SELECT u.id, p.role FROM auth.users u JOIN public.profiles p ON p.id=u.id WHERE u.email=$1`, [email])).rows;
    expect(await outcome(() => actions.registerEmployer({ ...form(email, 'pl'), companyName: 'Przejęcie' })))
      .toEqual({ redirect: '/pl/potwierdzenie' });
    const after = (await admin.query(`SELECT u.id, p.role FROM auth.users u JOIN public.profiles p ON p.id=u.id WHERE u.email=$1`, [email])).rows;
    expect(after).toEqual(before);
    expect((await admin.query("SELECT count(*)::int AS n FROM public.companies WHERE name='Przejęcie'")).rows[0].n).toBe(0);
  });

  it('sfałszowane cookie sesji nie daje tożsamości', async () => {
    browser.jar.set('__Secure-better-auth.session_token', 'forged.token');
    expect(await identity()).toBeNull();
  });
});
