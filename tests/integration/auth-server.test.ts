import { execFileSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { hashPassword, verifyPassword } from 'better-auth/crypto';
import { createAuthServer, type AuthServerDependencies } from '../../src/lib/auth/server';
import { withCandidateSignup, withEmployerSignup } from '../../src/lib/auth/signup-context';
import { loadProductionMigrations } from '../../scripts/db/production-migrations.mjs';
import { applyMigrations } from '../../scripts/db/migrate.mjs';

const baseURL = 'https://auth.example.invalid';
const secret = 'auth-adapter-test-secret-not-for-production-0123456789';
const container = 'pracujbe-auth-sdk-test-' + randomUUID();
const clusterPassword = randomUUID();
const signupPassword = 'SignupPassword123';
const locales = ['pl', 'nl', 'fr', 'en'] as const;
const sentVerification: Parameters<NonNullable<AuthServerDependencies['sendVerificationEmail']>>[0][] = [];
const sentReset: Parameters<NonNullable<AuthServerDependencies['sendResetPassword']>>[0][] = [];
let created = false;
let admin: Pool;
let pool: Pool;
let auth: ReturnType<typeof createAuthServer>;

function docker(...args: string[]): string {
  const windows = process.platform === 'win32';
  return execFileSync(windows ? 'wsl.exe' : 'docker',
    windows ? ['-d', 'Ubuntu', '--', 'docker', ...args] : args,
    { encoding: 'utf8', timeout: 60_000 }).trim();
}

beforeAll(async () => {
  // Własny jednorazowy klaster; żadnego odczytu DATABASE_URL ani pomijania w CI.
  docker('run', '--detach', '--rm', '--name', container,
    '--publish', '127.0.0.1::5432', '--tmpfs', '/var/lib/postgresql/data',
    '--env', 'POSTGRES_PASSWORD=' + clusterPassword,
    '--env', 'POSTGRES_DB=auth_runtime_test', 'postgres:16');
  created = true;
  const port = Number(docker('port', container, '5432/tcp').split(':').at(-1));
  if (!Number.isInteger(port) || port < 1) throw new Error('Brak portu izolowanej bazy.');
  const target = new URL('postgresql://postgres:' + clusterPassword + '@127.0.0.1:' + port + '/auth_runtime_test');
  admin = new Pool({ connectionString: target.href, max: 1, connectionTimeoutMillis: 2_000 });
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    try { await admin.query('SELECT 1'); ready = true; break; }
    catch { await new Promise(resolve => setTimeout(resolve, 250)); }
  }
  if (!ready) throw new Error('Izolowany PostgreSQL nie uruchomił się.');
  const occupied = await admin.query("SELECT to_regclass('auth.users') AS users, to_regclass('app_migrations.history') AS history");
  expect(occupied.rows[0]).toEqual({ users: null, history: null });
  // Ta sama kolejność co produkcja: bootstrap, potem domena i auth w globalnej numeracji
  // (migracje domeny po 0059 mogą zmieniać obiekty auth, np. 0108 dla #493).
  await applyMigrations(admin, await loadProductionMigrations());
  const password = randomBytes(24).toString('hex');
  await admin.query(`CREATE ROLE auth_runtime_test_login LOGIN PASSWORD '${password}' NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS`);
  await admin.query('GRANT pracujbe_auth TO auth_runtime_test_login');
  target.username = 'auth_runtime_test_login';
  target.password = password;
  pool = new Pool({ connectionString: target.href, options: '-c role=pracujbe_auth -c search_path=auth', max: 4, connectionTimeoutMillis: 10_000 });
  auth = createAuthServer({
    pool, baseURL, secret,
    sendVerificationEmail: async message => { sentVerification.push(message); },
    sendResetPassword: async message => { sentReset.push(message); },
  });
  for (const locale of locales) {
    for (const document of ['terms', 'privacy']) {
      await admin.query('INSERT INTO public.consent_versions(document, version, locale, is_current, published_at) VALUES ($1,$2,$3,true,now())',
        [document, `${document}-${locale}-v1`, locale]);
    }
  }
});

afterAll(async () => {
  try { await pool?.end(); await admin?.end(); }
  finally { if (created) docker('rm', '--force', container); }
});

function post(path: string, body: object, cookie?: string, origin = baseURL) {
  return auth.handler(new Request(`${baseURL}/api/auth/${path}`, {
    method: 'POST', headers: { 'content-type': 'application/json', origin, ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body),
  }));
}
const cookieFrom = (response: Response) => response.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
const readSession = async (cookie: string) => (await auth.handler(new Request(`${baseURL}/api/auth/get-session`, { headers: { cookie } }))).json();
function form(email: string, locale: typeof locales[number] = 'pl') {
  return { email, locale, password: signupPassword, passwordConfirm: signupPassword, firstName: 'Anna', lastName: 'Nowak', agreeTerms: true, privacyNoticeAck: true, companyName: 'Firma ' + locale };
}
async function snapshot() {
  return (await admin.query(`SELECT (SELECT count(*)::int FROM auth.users) AS users,
    (SELECT count(*)::int FROM auth.accounts) AS accounts,
    (SELECT count(*)::int FROM public.profiles) AS profiles,
    (SELECT count(*)::int FROM public.document_acceptances) AS receipts`)).rows[0];
}

describe('SDK Better Auth na izolowanym PostgreSQL', () => {
  it.each(['candidate', 'employer'] as const)('rejestruje %s w czterech językach wraz z profilem i receiptami', async role => {
    for (const locale of locales) {
      const email = `${role}-${locale}@example.invalid`;
      const wrapper = role === 'candidate' ? withCandidateSignup : withEmployerSignup;
      const result = await wrapper({ ...form(email, locale), role: 'admin', is_active: false }, 'en',
        body => auth.api.signUpEmail({ body }));
      expect(result.token).toBeNull();
      expect(result.user).not.toHaveProperty('raw_user_meta_data');
      expect(result.user.id).toMatch(/^[a-f0-9-]{36}$/);
      const persisted = (await admin.query(`SELECT u.email_verified, u.raw_user_meta_data AS metadata,
        p.role, p.first_name, p.last_name, p.preferred_locale, p.account_locale, p.signup_locale,
        a.provider_id, a.password FROM auth.users u JOIN public.profiles p ON p.id=u.id
        JOIN auth.accounts a ON a.user_id=u.id WHERE u.id=$1`, [result.user.id])).rows[0];
      expect(persisted).toMatchObject({ email_verified: false, role, first_name: 'Anna', last_name: 'Nowak',
        preferred_locale: locale, account_locale: locale, signup_locale: locale, provider_id: 'credential' });
      expect(persisted.metadata).toEqual({ signup_receipt_version: 2, agree_terms: true, privacy_notice_ack: true,
        optional_consents: { email_marketing: false },
        consent_wording: {
          terms: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
          privacy: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
          email_marketing: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
        },
        role, locale,
        first_name: 'Anna', last_name: 'Nowak', ...(role === 'employer' ? { company_name: 'Firma ' + locale } : {}) });
      expect(await verifyPassword({ hash: persisted.password, password: signupPassword })).toBe(true);
      const receipts = (await admin.query(`SELECT document, kind, source, document_version, locale, ip_address, user_agent,
        consent_version_id, accepted_at FROM public.document_acceptances WHERE profile_id=$1 ORDER BY document`, [result.user.id])).rows;
      expect(receipts).toHaveLength(2);
      for (const receipt of receipts) {
        // #493: regulamin i informacja o prywatności jako osobne elementy z kanału rejestracji.
        expect(receipt).toMatchObject({ locale, ip_address: null, user_agent: null, source: 'signup',
          kind: receipt.document === 'terms' ? 'terms_acceptance' : 'privacy_notice_ack',
          document_version: `${receipt.document}-${locale}-v1` });
        expect(receipt.consent_version_id).toMatch(/^[a-f0-9-]{36}$/);
        expect(receipt.accepted_at).toBeInstanceOf(Date);
      }
      expect((await admin.query('SELECT count(*)::int AS n FROM auth.sessions WHERE user_id=$1', [result.user.id])).rows[0].n).toBe(0);
      expect(sentVerification.find(message => message.user.id === result.user.id)).toBeDefined();
    }
  });

  it('blokuje brak zgody, bezpośredni endpoint i auth.api bez kontekstu, również dla istniejącego adresu', async () => {
    const before = await snapshot();
    const action = vi.fn();
    for (const agreeTerms of [undefined, false]) {
      await expect(withCandidateSignup({ ...form('no-consent@example.invalid'), agreeTerms }, 'pl', action)).rejects.toThrow();
    }
    // #493: bez potwierdzenia informacji o prywatności konto też nie powstaje.
    for (const privacyNoticeAck of [undefined, false]) {
      await expect(withCandidateSignup({ ...form('no-consent@example.invalid'), privacyNoticeAck }, 'pl', action)).rejects.toThrow();
    }
    expect(action).not.toHaveBeenCalled();
    for (const email of ['direct@example.invalid', 'candidate-pl@example.invalid']) {
      const body = { email, name: 'Direct Signup', password: signupPassword,
        raw_user_meta_data: { signup_receipt_version: 1, agree_terms: true, role: 'admin', locale: 'pl' } };
      const response = await post('sign-up/email', body);
      expect(response.status).toBe(400);
      expect((await response.json()).code).toBe('VALIDATED_SIGNUP_REQUIRED');
      await expect(auth.api.signUpEmail({ body })).rejects.toMatchObject({ body: { code: 'VALIDATED_SIGNUP_REQUIRED' } });
    }
    expect(await snapshot()).toEqual(before);
  });

  it('nie przyjmuje metadanych klienta nawet wewnątrz walidowanego kontekstu', async () => {
    const before = await snapshot();
    const response = await withCandidateSignup(form('metadata@example.invalid'), 'pl', body => post('sign-up/email', {
      ...body, raw_user_meta_data: { signup_receipt_version: 1, agree_terms: true, role: 'admin', locale: 'nl' },
    }));
    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe('FIELD_NOT_ALLOWED');
    expect(await snapshot()).toEqual(before);
  });

  it('nie zmienia istniejącego konta ani receiptów przy rejestracji tego samego adresu inną rolą', async () => {
    const before = await snapshot();
    const result = await withEmployerSignup({ ...form('CANDIDATE-PL@EXAMPLE.INVALID', 'fr'), firstName: 'Injected' }, 'pl',
      body => auth.api.signUpEmail({ body }));
    expect(result.token).toBeNull();
    expect(result.user).not.toHaveProperty('raw_user_meta_data');
    expect(await snapshot()).toEqual(before);
    expect((await admin.query("SELECT role, first_name, preferred_locale FROM public.profiles WHERE email='candidate-pl@example.invalid'")).rows[0])
      .toEqual({ role: 'candidate', first_name: 'Anna', preferred_locale: 'pl' });
  });

  it('izoluje równoległe rejestracje i poprawnie inicjalizuje każde połączenie puli', async () => {
    const clients = await Promise.all(Array.from({ length: 4 }, () => pool.connect()));
    try {
      for (const client of clients) {
        expect((await client.query('SELECT current_user, current_schema() AS schema')).rows[0])
          .toEqual({ current_user: 'pracujbe_auth', schema: 'auth' });
      }
    } finally { clients.forEach(client => client.release()); }
    await Promise.all(locales.map(async (locale, index) => {
      const role = index % 2 === 0 ? 'candidate' : 'employer';
      const wrapper = role === 'candidate' ? withCandidateSignup : withEmployerSignup;
      const result = await wrapper({ ...form(`parallel-${locale}@example.invalid`, locale), firstName: 'Person ' + locale }, 'pl',
        body => auth.api.signUpEmail({ body }));
      expect((await admin.query('SELECT role, first_name, preferred_locale FROM public.profiles WHERE id=$1', [result.user.id])).rows[0])
        .toEqual({ role, first_name: 'Person ' + locale, preferred_locale: locale });
      expect((await admin.query('SELECT DISTINCT locale FROM public.document_acceptances WHERE profile_id=$1', [result.user.id])).rows)
        .toEqual([{ locale }]);
    }));
  });

  it.each(['receipt', 'credential'] as const)('wycofuje cały signup po wymuszonej awarii zapisu %s', async failure => {
    const before = await snapshot();
    const target = failure === 'receipt' ? 'public.document_acceptances' : 'auth.accounts';
    // Kontrola ujemna rzeczywistego zapisu, wyłącznie we własnej jednorazowej bazie.
    await admin.query("CREATE FUNCTION public.fail_auth_test_insert() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'AUTH_TEST_INSERT_FAILURE'; END $$");
    await admin.query(`CREATE TRIGGER fail_auth_test_insert BEFORE INSERT ON ${target} FOR EACH ROW EXECUTE FUNCTION public.fail_auth_test_insert()`);
    const sentBefore = sentVerification.length;
    try {
      await expect(withCandidateSignup(form(`rollback-${failure}@example.invalid`), 'pl', body => auth.api.signUpEmail({ body }))).rejects.toThrow();
      expect(await snapshot()).toEqual(before);
      expect(sentVerification).toHaveLength(sentBefore);
    } finally {
      await admin.query(`DROP TRIGGER fail_auth_test_insert ON ${target}`);
      await admin.query('DROP FUNCTION public.fail_auth_test_insert()');
    }
  });

  it('nie fabrykuje akceptacji dla administracyjnego fixture bez markera', async () => {
    const id = randomUUID();
    await admin.query("INSERT INTO auth.users(id,name,email,raw_user_meta_data) VALUES ($1,'Manual Fixture','manual@example.invalid','{\"locale\":\"pl\",\"role\":\"candidate\"}')", [id]);
    expect((await admin.query('SELECT count(*)::int AS n FROM public.document_acceptances WHERE profile_id=$1', [id])).rows[0].n).toBe(0);
  });

  it('obsługuje weryfikację, prywatne metadata, cookie, sesję, reset i wylogowanie', async () => {
    const email = 'candidate-pl@example.invalid';
    const verification = sentVerification.find(message => message.user.email === email)!;
    const id = verification.user.id;
    expect((await post('sign-in/email', { email, password: signupPassword })).status).toBe(403);
    expect((await post('send-verification-email', { email, callbackURL: `${baseURL}/pl/candidate` })).status).toBe(200);
    const verified = await auth.handler(new Request(sentVerification.at(-1)!.url));
    expect(verified.status).toBe(302);
    expect((await admin.query('SELECT email_verified FROM auth.users WHERE id=$1', [id])).rows[0].email_verified).toBe(true);
    const verifiedCookie = cookieFrom(verified);
    expect(verifiedCookie).toContain('__Secure-');
    expect((await readSession(verifiedCookie)).user.id).toBe(id);
    expect((await readSession(verifiedCookie)).user).not.toHaveProperty('raw_user_meta_data');

    const signedIn = await post('sign-in/email', { email, password: signupPassword });
    expect(signedIn.status).toBe(200);
    expect((await signedIn.json()).user).not.toHaveProperty('raw_user_meta_data');
    const cookie = cookieFrom(signedIn);
    const cookieHeader = signedIn.headers.get('set-cookie')!;
    expect(cookieHeader).toMatch(/HttpOnly/i);
    expect(cookieHeader).toMatch(/Secure/i);
    expect(cookieHeader).toMatch(/SameSite=Lax/i);
    const session = await readSession(cookie);
    expect(session.user.id).toBe(id);
    expect(session.session.id).toMatch(/^[a-f0-9-]{36}$/);
    expect(await readSession('__Secure-better-auth.session_token=forged')).toBeNull();
    expect((await post('sign-in/email', { email, password: signupPassword }, undefined, 'https://evil.example.invalid')).status).toBe(403);
    expect((await post('update-user', { raw_user_meta_data: { role: 'admin' } }, cookie)).status).toBe(400);
    expect((await admin.query('SELECT role FROM public.profiles WHERE id=$1', [id])).rows[0].role).toBe('candidate');

    expect((await post('request-password-reset', { email, redirectTo: `${baseURL}/pl/ustaw-nowe-haslo` })).status).toBe(200);
    expect(sentReset).toHaveLength(1);
    expect(sentReset[0]!.user.id).toBe(id);
    // Reset wskazuje konto tokenem także przy aktywnej sesji innego konta.
    const otherId = randomUUID();
    await admin.query("INSERT INTO auth.users(id,name,email,email_verified) VALUES ($1,'Other Fixture','other@example.invalid',true)", [otherId]);
    await admin.query("INSERT INTO auth.accounts(user_id,account_id,provider_id,password) VALUES ($1,$2,'credential',$3)", [otherId, otherId, await hashPassword(signupPassword)]);
    const otherCookie = cookieFrom(await post('sign-in/email', { email: 'other@example.invalid', password: signupPassword }));
    const newPassword = 'ChangedFixturePassword456';
    expect((await post('reset-password', { newPassword }, otherCookie)).status).toBeGreaterThanOrEqual(400);
    expect((await post('reset-password', { token: sentReset[0]!.token, newPassword }, otherCookie)).status).toBe(200);
    expect((await admin.query('SELECT count(*)::int AS n FROM auth.sessions WHERE user_id=$1', [id])).rows[0].n).toBe(0);
    expect(await readSession(cookie)).toBeNull();
    expect(await readSession(verifiedCookie)).toBeNull();
    expect((await readSession(otherCookie)).user.id).toBe(otherId);
    expect((await post('sign-in/email', { email: 'other@example.invalid', password: signupPassword })).status).toBe(200);
    expect((await post('reset-password', { token: sentReset[0]!.token, newPassword })).status).toBeGreaterThanOrEqual(400);
    expect((await post('sign-in/email', { email, password: signupPassword })).status).toBe(401);
    const refreshed = await post('sign-in/email', { email, password: newPassword });
    expect(refreshed.status).toBe(200);
    const refreshedCookie = cookieFrom(refreshed);
    expect((await post('sign-out', {}, refreshedCookie)).status).toBe(200);
    expect(await readSession(refreshedCookie)).toBeNull();
  });
});
