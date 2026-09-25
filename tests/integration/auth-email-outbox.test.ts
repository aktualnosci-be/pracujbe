import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAuthServer } from '../../src/lib/auth/server';
import { withCandidateSignup } from '../../src/lib/auth/signup-context';
import {
  claimAuthEmails, completeAuthEmail, createAuthEmailSenders, expireAuthEmails,
  failAuthEmail, prepareAuthEmail,
} from '../../src/lib/auth/email-outbox';
import { loadProductionMigrations } from '../../scripts/db/production-migrations.mjs';
import { applyMigrations } from '../../scripts/db/migrate.mjs';

const baseURL = 'https://auth.example.invalid';
const secret = 'auth-email-queue-test-not-for-production-0123456789';
const container = 'pracujbe-auth-mail-test-' + randomUUID();
const password = randomUUID();
let created = false;
let admin: Pool;
let pool: Pool;
let mail: Pool;
let auth: ReturnType<typeof createAuthServer>;

function docker(...args: string[]) {
  const windows = process.platform === 'win32';
  return execFileSync(windows ? 'wsl.exe' : 'docker', windows ? ['-d', 'Ubuntu', '--', 'docker', ...args] : args,
    { encoding: 'utf8', timeout: 60_000 }).trim();
}

beforeAll(async () => {
  docker('run', '--detach', '--rm', '--name', container, '--publish', '127.0.0.1::5432',
    '--tmpfs', '/var/lib/postgresql/data', '--env', 'POSTGRES_PASSWORD=' + password,
    '--env', 'POSTGRES_DB=auth_mail_test', 'postgres:16');
  created = true;
  const port = Number(docker('port', container, '5432/tcp').split(':').at(-1));
  if (!Number.isInteger(port) || port < 1) throw new Error('Brak portu izolowanej bazy.');
  const target = new URL(`postgresql://postgres:${password}@127.0.0.1:${port}/auth_mail_test`);
  admin = new Pool({ connectionString: target.href, max: 1, connectionTimeoutMillis: 2_000 });
  let ready = false;
  for (let n = 0; n < 60; n++) {
    try { await admin.query('SELECT 1'); ready = true; break; }
    catch { await new Promise(resolve => setTimeout(resolve, 250)); }
  }
  if (!ready) throw new Error('Izolowany PostgreSQL nie uruchomił się.');
  await applyMigrations(admin, await loadProductionMigrations());
  const createPool = async (login: string, role: string) => {
    const loginPassword = randomUUID();
    await admin.query(`CREATE ROLE ${login} LOGIN PASSWORD '${loginPassword}' NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS`);
    await admin.query(`GRANT ${role} TO ${login}`);
    const url = new URL(target);
    url.username = login;
    url.password = loginPassword;
    return new Pool({ connectionString: url.href, options: `-c role=${role} -c search_path=auth`, max: 4, connectionTimeoutMillis: 5_000 });
  };
  pool = await createPool('auth_mail_test_login', 'pracujbe_auth');
  mail = await createPool('mail_worker_test_login', 'pracujbe_auth_mail');
  auth = createAuthServer({ pool, baseURL, secret });
});

beforeEach(async () => {
  // Każdy scenariusz przejmuje tylko własne nowe zlecenia w jednorazowej bazie.
  await admin.query("UPDATE auth.email_outbox SET status='expired', token=null, lease_id=null, lease_expires_at=null WHERE status IN ('queued','leased')");
});

afterAll(async () => {
  try { await pool?.end(); await mail?.end(); await admin?.end(); }
  finally { if (created) docker('rm', '--force', container); }
});

async function signup(instance = auth, locale = 'fr') {
  const input = { email: `${randomUUID()}@example.invalid`, firstName: 'Anna', lastName: 'Nowak', locale,
    password: 'SignupPassword123', passwordConfirm: 'SignupPassword123', agreeTerms: true };
  return withCandidateSignup(input, 'en', body => instance.api.signUpEmail({ body }));
}

async function snapshot() {
  return (await admin.query(`SELECT (SELECT count(*)::int FROM auth.users) AS users,
    (SELECT count(*)::int FROM auth.accounts) AS accounts,
    (SELECT count(*)::int FROM public.profiles) AS profiles,
    (SELECT count(*)::int FROM public.document_acceptances) AS receipts,
    (SELECT count(*)::int FROM auth.verifications) AS verifications,
    (SELECT count(*)::int FROM auth.email_outbox) AS emails`)).rows[0];
}

async function failEnqueue(action: () => Promise<void>) {
  await admin.query("CREATE FUNCTION auth.fail_test_enqueue() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'PRIVATE_TOKEN_MUST_NOT_BE_LOGGED'; END $$");
  await admin.query('CREATE TRIGGER fail_test_enqueue BEFORE INSERT ON auth.email_outbox FOR EACH ROW EXECUTE FUNCTION auth.fail_test_enqueue()');
  try { await action(); }
  finally {
    await admin.query('DROP TRIGGER fail_test_enqueue ON auth.email_outbox');
    await admin.query('DROP FUNCTION auth.fail_test_enqueue()');
  }
}

describe('Trwała kolejka auth na PostgreSQL', () => {
  it('utrwala konto i wiadomość razem, a inne połączenie nie widzi wiadomości przed commitem', async () => {
    const senders = createAuthEmailSenders(secret);
    let observed = false;
    const guarded = createAuthServer({ pool, baseURL, secret,
      sendVerificationEmail: async message => {
        await senders.sendVerificationEmail(message);
        expect((await admin.query('SELECT id FROM auth.email_outbox WHERE user_id=$1', [message.user.id])).rows).toHaveLength(0);
        expect((await admin.query('SELECT id FROM public.profiles WHERE id=$1', [message.user.id])).rows).toHaveLength(0);
        observed = true;
      },
    });
    const result = await signup(guarded);
    expect(observed).toBe(true);
    expect((await admin.query('SELECT locale, kind, token FROM auth.email_outbox WHERE user_id=$1', [result.user.id])).rows[0])
      .toMatchObject({ locale: 'fr', kind: 'verification', token: expect.any(String) });
    expect((await admin.query('SELECT count(*)::int AS n FROM public.document_acceptances WHERE profile_id=$1', [result.user.id])).rows[0].n).toBe(2);
  });

  it('awaria enqueue cofa cały signup i nie ujawnia SQL ani poświadczenia w loggerze SDK', async () => {
    const before = await snapshot();
    const output = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await failEnqueue(async () => {
        await expect(signup()).rejects.toMatchObject({ body: { code: 'AUTH_EMAIL_QUEUE_FAILED' } });
      });
      expect(await snapshot()).toEqual(before);
      expect(JSON.stringify(output.mock.calls)).not.toContain('PRIVATE_TOKEN_MUST_NOT_BE_LOGGED');
    } finally { output.mockRestore(); }
  });

  it('reset wybiera język odbiorcy oraz termin rzeczywistego tokenu, ignorując docelowy język formularza', async () => {
    const account = await signup();
    await admin.query("UPDATE public.profiles SET preferred_locale='nl' WHERE id=$1", [account.user.id]);
    await auth.api.requestPasswordReset({ body: { email: account.user.email, redirectTo: `${baseURL}/pl/ustaw-nowe-haslo` } });
    const row = (await admin.query("SELECT * FROM auth.email_outbox WHERE user_id=$1 AND kind='password_reset'", [account.user.id])).rows[0];
    expect(row.locale).toBe('nl');
    expect(row.first_name).toBe('Anna');
    const verification = (await admin.query('SELECT expires_at FROM auth.verifications WHERE identifier=$1', ['reset-password:' + row.token])).rows[0];
    expect(row.expires_at).toEqual(verification.expires_at);
    const delivery = (await claimAuthEmails(mail)).find(item => item.kind === 'password_reset')!;
    const prepared = prepareAuthEmail(delivery, baseURL);
    expect(prepared).toMatchObject({ locale: 'nl', template: 'passwordReset', idempotencyKey: row.id });
    if (!('resetUrl' in prepared.data)) throw new Error('Brak adresu resetu hasła w przygotowanej wiadomości.');
    const url = new URL(prepared.data.resetUrl);
    expect(url.origin).toBe(baseURL);
    // Strona w języku odbiorcy, token wyłącznie we fragmencie (#505) — nie w ścieżce ani query.
    expect(url.pathname).toBe('/nl/ustaw-nowe-haslo');
    expect(url.search).toBe('');
    expect(new URLSearchParams(url.hash.slice(1)).get('token')).toBe(row.token);
  });

  it.each(['api', 'http', 'api-response'] as const)('awaria enqueue cofa verification resetu przez %s', async channel => {
    const account = await signup();
    const before = await snapshot();
    await failEnqueue(async () => {
      const body = { email: account.user.email, redirectTo: `${baseURL}/pl/ustaw-nowe-haslo` };
      if (channel === 'api') {
        await expect(auth.api.requestPasswordReset({ body })).rejects.toMatchObject({ body: { code: 'AUTH_EMAIL_QUEUE_FAILED' } });
      } else {
        const response = channel === 'api-response'
          ? await auth.api.requestPasswordReset({ body, asResponse: true })
          : await auth.handler(new Request(`${baseURL}/api/auth/request-password-reset`, {
            method: 'POST', headers: { origin: baseURL, 'content-type': 'application/json' }, body: JSON.stringify(body),
          }));
        expect(response.status).toBe(500);
        expect((await response.json()).code).toBe('AUTH_EMAIL_QUEUE_FAILED');
      }
    });
    expect(await snapshot()).toEqual(before);
  });

  it('nie tworzy zlecenia resetu nieistniejącego konta', async () => {
    const before = await snapshot();
    expect(await auth.api.requestPasswordReset({ body: { email: 'missing@example.invalid' } })).toMatchObject({ status: true });
    expect(await snapshot()).toEqual(before);
  });

  it('HTTP reset zachowuje odpowiedź SDK i ochronę origin z cookies oraz przekierowania', async () => {
    const account = await signup();
    const request = (origin: string, redirectTo: string) => auth.handler(new Request(
      `${baseURL}/api/auth/request-password-reset`, {
        method: 'POST', headers: { origin, 'content-type': 'application/json', cookie: 'test-client=1' },
        body: JSON.stringify({ email: account.user.email, redirectTo }),
      },
    ));
    const before = await snapshot();
    expect((await request('https://other.example.invalid', `${baseURL}/pl/ustaw-nowe-haslo`)).status).toBe(403);
    expect((await request(baseURL, 'https://other.example.invalid/')).status).toBe(403);
    expect(await snapshot()).toEqual(before);
    const response = await request(baseURL, `${baseURL}/pl/ustaw-nowe-haslo`);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: true });
    expect((await admin.query("SELECT count(*)::int AS n FROM auth.email_outbox WHERE user_id=$1 AND kind='password_reset'", [account.user.id])).rows[0].n).toBe(1);
  });

  it('deduplikuje równoległe enqueue i nie odtwarza tokenu po wysłaniu', async () => {
    const account = await signup();
    const row = (await admin.query('SELECT * FROM auth.email_outbox WHERE user_id=$1', [account.user.id])).rows[0];
    const enqueue = () => pool.query('INSERT INTO auth.email_enqueue(user_id,kind,token,expires_at) VALUES ($1,$2,$3,$4) RETURNING id, token',
      [row.user_id, row.kind, row.token, row.expires_at]);
    const duplicates = await Promise.all([enqueue(), enqueue()]);
    duplicates.forEach(result => expect(result.rows).toEqual([{ id: row.id, token: null }]));
    const [delivery] = await claimAuthEmails(mail);
    expect(await completeAuthEmail(mail, delivery!, 'provider-test-id')).toBe(true);
    await enqueue();
    expect((await admin.query('SELECT id, status, token, idempotency_key FROM auth.email_outbox WHERE user_id=$1', [account.user.id])).rows)
      .toEqual([{ id: row.id, status: 'sent', token: null, idempotency_key: row.idempotency_key }]);
  });

  it('widok jest zawsze pusty; auth i worker nie mają dostępu do tabeli ani obcych funkcji', async () => {
    await signup();
    expect((await pool.query('SELECT * FROM auth.email_enqueue')).rows).toHaveLength(0);
    await expect(pool.query('SELECT token FROM auth.email_outbox')).rejects.toMatchObject({ code: '42501' });
    await expect(mail.query('SELECT token FROM auth.email_outbox')).rejects.toMatchObject({ code: '42501' });
    await expect(pool.query('SELECT * FROM auth.claim_emails()')).rejects.toMatchObject({ code: '42501' });
    await expect(mail.query('SELECT * FROM public.profiles')).rejects.toMatchObject({ code: '42501' });
    for (const role of ['anon', 'authenticated', 'pracujbe_app', 'service_role']) {
      expect((await admin.query("SELECT has_table_privilege($1,'auth.email_outbox','SELECT') AS allowed", [role])).rows[0].allowed).toBe(false);
      expect((await admin.query("SELECT has_table_privilege($1,'auth.email_enqueue','SELECT') AS allowed", [role])).rows[0].allowed).toBe(false);
    }
  });

  it('dwa workery nie przejmują tego samego zlecenia', async () => {
    await signup();
    const results = await Promise.all([claimAuthEmails(mail), claimAuthEmails(mail)]);
    expect(results.flat()).toHaveLength(1);
  });

  it.each([[null, 300], [20, null], [0, 300], [101, 300], [20, 601]])
    ('odrzuca nieograniczone przejęcie kolejki: limit %s, dzierżawa %s', async (limit, lease) => {
      await expect(mail.query('SELECT * FROM auth.claim_emails($1,$2)', [limit, lease]))
        .rejects.toMatchObject({ code: '23514' });
    });

  it('stara dzierżawa nie może ACK ani nadpisać wyniku nowego workera', async () => {
    await signup();
    const [oldDelivery] = await claimAuthEmails(mail);
    await admin.query("UPDATE auth.email_outbox SET lease_expires_at=now()-interval '1 second' WHERE id=$1", [oldDelivery!.id]);
    const [newDelivery] = await claimAuthEmails(mail);
    expect(newDelivery!.lease_id).not.toBe(oldDelivery!.lease_id);
    expect(await completeAuthEmail(mail, oldDelivery!, 'old-provider')).toBe(false);
    expect(await failAuthEmail(mail, oldDelivery!, 'delivery_failed')).toBe(false);
    expect(await completeAuthEmail(mail, newDelivery!, 'new-provider')).toBe(true);
    expect((await admin.query('SELECT token, provider_message_id FROM auth.email_outbox WHERE id=$1', [oldDelivery!.id])).rows[0])
      .toEqual({ token: null, provider_message_id: 'new-provider' });
  });

  it('ponawia z opóźnieniem, a końcowa porażka usuwa token', async () => {
    await signup();
    const [delivery] = await claimAuthEmails(mail);
    expect(await failAuthEmail(mail, delivery!, 'provider_unavailable')).toBe(true);
    expect(await claimAuthEmails(mail)).toHaveLength(0);
    await admin.query("UPDATE auth.email_outbox SET attempts=4,next_attempt_at=now()-interval '1 second' WHERE id=$1", [delivery!.id]);
    const [last] = await claimAuthEmails(mail);
    expect(await failAuthEmail(mail, last!, 'delivery_failed')).toBe(true);
    expect((await admin.query('SELECT status, token, attempts FROM auth.email_outbox WHERE id=$1', [delivery!.id])).rows[0])
      .toEqual({ status: 'failed', token: null, attempts: 5 });
  });

  it('wygaśnięcie czyści token oraz blokuje przygotowanie wiadomości', async () => {
    await signup();
    const [delivery] = await claimAuthEmails(mail);
    await admin.query("UPDATE auth.email_outbox SET expires_at=now()-interval '1 second' WHERE id=$1", [delivery!.id]);
    expect(await expireAuthEmails(mail)).toBe(1);
    expect((await admin.query('SELECT status, token, lease_id FROM auth.email_outbox WHERE id=$1', [delivery!.id])).rows[0])
      .toEqual({ status: 'expired', token: null, lease_id: null });
    expect(await completeAuthEmail(mail, delivery!, 'too-late')).toBe(false);
    expect(() => prepareAuthEmail({ ...delivery!, expires_at: new Date(0) }, baseURL)).toThrow('wygasły');
    expect(() => prepareAuthEmail(delivery!, 'https://attacker@example.invalid')).toThrow('kanonicznego origin');
  });
});
