// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * #731 — jeden kontrakt czasu dla `/api/email/process`: caller (Cloudflare Worker) czeka 120 s,
 * przebieg obu kolejek kończy pracę przed budżetem 90 s, dzierżawa (300 s) przeżywa cały
 * przebieg. Rekordy, na które zabrakło czasu albo dzierżawy, wracają do kolejki BEZ zużycia
 * próby, nie zwiększają `failed`, a wynik przebiegu to `ok: false`.
 *
 * Wolny dostawca = prawdziwy transport EmailLabs (`GET` sprawdzenia + `POST` wysyłki) z atrapą
 * `fetch`, w której każde żądanie trwa 9 s (tuż pod limitem 10 s pojedynczego żądania).
 */

vi.mock('@/lib/error-report', () => ({ captureError: vi.fn() }));
const { resendSend } = vi.hoisted(() => ({ resendSend: vi.fn() }));
vi.mock('resend', () => ({ Resend: class { emails = { send: resendSend }; } }));
vi.mock('@/lib/db/portal', async () => (await import('../helpers/fake-db')).fakePortal());

import { AUTH_EMAIL_LEASE_SECONDS, processAuthEmailBatch } from '@/lib/auth/email-worker';
import { EMAIL_LEASE_SECONDS, processEmailQueue } from '@/lib/email/outbox';
import {
  CRON_CALLER_TIMEOUT_MS,
  createRunDeadline,
  EMAIL_MIN_SEND_WINDOW_MS,
  EMAIL_RUN_BUDGET_MS,
} from '@/lib/email/run-deadline';
import { EMAILLABS_REQUEST_TIMEOUT_MS, emailLabsTransport } from '@/lib/email/transport/emaillabs';
import { DEFAULT_TIMEOUT_SECONDS } from '../../infra/cloudflare-cron/src/worker.mjs';
import { fakeDb, resetFakeDb } from '../helpers/fake-db';
import { warmUpEmailRender } from '../helpers/email-render-warmup';

const baseURL = 'https://pracuj.be';
const FROM = 'Pracuj.be <no-reply@pracuj.be>';
const REQUEST_MS = 9_000;

beforeAll(warmUpEmailRender);

/** Wolne API EmailLabs: każde żądanie trwa `REQUEST_MS`; przerwanie sygnałem = odrzucenie. */
function slowEmailLabs(requestMs = REQUEST_MS) {
  const posted: string[] = [];
  const fetchImpl = (url: string, init: RequestInit) =>
    new Promise<Response>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (init.method === 'GET') {
          resolve(new Response('{}', { status: 404 }));
          return;
        }
        const body = JSON.parse(String(init.body)) as { to: { messageId: string }[] };
        const messageId = body.to[0]!.messageId;
        posted.push(messageId);
        resolve(new Response(JSON.stringify({ data: [{ to: [{ messageId }] }] }), { status: 200 }));
      }, requestMs);
      init.signal?.addEventListener('abort', () => {
        clearTimeout(timer);
        reject(new Error('aborted'));
      }, { once: true });
    });
  const transport = emailLabsTransport({ appKey: 'k', secretKey: 's', smtpAccount: 'acc' }, fetchImpl as never);
  return { transport, posted };
}

interface Row {
  id: string;
  status: 'queued' | 'leased' | 'sent' | 'failed';
  attempts: number;
  lease_id: string | null;
  lease_expires_at: Date | null;
  next_attempt_at: number;
}

const uuid = (n: number, prefix = '1') => `${prefix.repeat(8)}-0000-4000-8000-${String(n).padStart(12, '0')}`;

/**
 * Kolejka `auth.email_outbox` w pamięci z semantyką SQL 0061/0137: claim bierze tylko wiersze
 * wolne (queued albo leased po wygaśnięciu), complete/fail/defer tylko z ważną dzierżawą.
 */
function memoryAuthOutbox(count: number, leaseMsOverride?: number) {
  const rows: Row[] = Array.from({ length: count }, (_, i) => ({
    id: uuid(i + 1), status: 'queued', attempts: 0, lease_id: null, lease_expires_at: null, next_attempt_at: 0,
  }));
  let leaseSeq = 0;
  const valid = (row: Row | undefined, leaseId: unknown) =>
    row !== undefined && row.status === 'leased' && row.lease_id === leaseId
    && (row.lease_expires_at?.getTime() ?? 0) > Date.now();
  const pool = {
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      if (sql.includes('expire_emails')) return { rows: [{ expired: 0 }] };
      if (sql.includes('claim_emails')) {
        const [limit, leaseSeconds] = params as [number, number];
        const now = Date.now();
        const free = rows.filter((r) => (r.status === 'queued' && r.next_attempt_at <= now)
          || (r.status === 'leased' && (r.lease_expires_at?.getTime() ?? 0) <= now)).slice(0, limit);
        return {
          rows: free.map((r) => {
            leaseSeq += 1;
            r.status = 'leased';
            r.attempts += 1;
            r.lease_id = uuid(leaseSeq, '9');
            r.lease_expires_at = new Date(now + (leaseMsOverride ?? leaseSeconds * 1000));
            return {
              id: r.id, user_id: uuid(1, '2'), kind: 'verification', recipient_email: 'anna@example.com',
              first_name: 'Anna', recipient_role: 'candidate', locale: 'pl', token: 'hdr.payload.sig',
              expires_at: new Date(now + 3_600_000), lease_id: r.lease_id, lease_expires_at: r.lease_expires_at,
            };
          }),
        };
      }
      if (sql.includes('take_send_budget')) return { rows: [{ granted: true, retry_at: null }] };
      const row = rows.find((r) => r.id === params[0]);
      if (sql.includes('defer_email')) {
        if (!valid(row, params[1])) return { rows: [{ deferred: false }] };
        Object.assign(row!, { status: 'queued', attempts: Math.max(row!.attempts - 1, 0), lease_id: null,
          lease_expires_at: null, next_attempt_at: Date.now() + 1000 });
        return { rows: [{ deferred: true }] };
      }
      if (sql.includes('complete_email')) {
        if (!valid(row, params[1])) return { rows: [{ completed: false }] };
        Object.assign(row!, { status: 'sent', lease_id: null, lease_expires_at: null });
        return { rows: [{ completed: true }] };
      }
      if (sql.includes('fail_email')) {
        if (!valid(row, params[1])) return { rows: [{ recorded: false }] };
        Object.assign(row!, { status: 'queued', lease_id: null, lease_expires_at: null, next_attempt_at: Date.now() + 60_000 });
        return { rows: [{ recorded: true }] };
      }
      throw new Error(`nieoczekiwane zapytanie ${sql}`);
    }),
  };
  return { pool, rows };
}

describe('kontrakt czasu (#731)', () => {
  it('budżet przebiegu < limit callera < dzierżawa; okno wysyłki mieści GET + POST EmailLabs', () => {
    const wrangler = readFileSync(join(process.cwd(), 'infra/cloudflare-cron/wrangler.toml'), 'utf8');
    expect(wrangler).toMatch(new RegExp(`CRON_TIMEOUT_SECONDS = "${CRON_CALLER_TIMEOUT_MS / 1000}"`));
    expect(DEFAULT_TIMEOUT_SECONDS * 1000).toBe(CRON_CALLER_TIMEOUT_MS);
    // Zapas na odpowiedź HTTP i zapis wyników: przebieg kończy się wyraźnie przed callerem.
    expect(CRON_CALLER_TIMEOUT_MS - EMAIL_RUN_BUDGET_MS).toBeGreaterThanOrEqual(20_000);
    // Dzierżawa przeżywa cały przebieg — rekord nie wraca do puli w trakcie przebiegu, który go trzyma.
    expect(AUTH_EMAIL_LEASE_SECONDS * 1000).toBeGreaterThan(CRON_CALLER_TIMEOUT_MS);
    expect(EMAIL_LEASE_SECONDS * 1000).toBeGreaterThan(CRON_CALLER_TIMEOUT_MS);
    expect(EMAIL_MIN_SEND_WINDOW_MS).toBeGreaterThanOrEqual(2 * EMAILLABS_REQUEST_TIMEOUT_MS);
  });
});

describe('kolejka kont pod wolnym dostawcą (#731)', () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] }));
  afterEach(() => vi.useRealTimers());

  it('20 listów, wolny GET i POST: koniec przed budżetem, reszta odłożona bez `failed`, ok=false', async () => {
    const { pool, rows } = memoryAuthOutbox(20);
    const { transport, posted } = slowEmailLabs();
    const pending = processAuthEmailBatch(pool as never, transport, { baseURL, from: FROM, limit: 20 });
    await vi.advanceTimersByTimeAsync(CRON_CALLER_TIMEOUT_MS);
    const result = await pending;

    expect(result.sent).toBeGreaterThan(0);
    expect(result.sent + (result.deadlineDeferred ?? 0)).toBe(20);
    expect(result).toMatchObject({ processed: 20, failed: 0, ok: false });
    expect(result.leaseLost ?? 0).toBe(0);
    expect(posted).toHaveLength(result.sent);
    // Żaden rekord nie zostaje w dzierżawie; odłożone wracają do kolejki bez zużycia próby.
    expect(rows.filter((r) => r.status === 'leased')).toHaveLength(0);
    expect(rows.filter((r) => r.status === 'queued').every((r) => r.attempts === 0)).toBe(true);
  });

  it('przebieg kończy się przed budżetem 90 s (pomiar czasu zakończenia)', async () => {
    const { pool } = memoryAuthOutbox(20);
    const { transport } = slowEmailLabs();
    const started = Date.now();
    let finishedAt = 0;
    const pending = processAuthEmailBatch(pool as never, transport, { baseURL, from: FROM, limit: 20 })
      .then((r) => { finishedAt = Date.now(); return r; });
    await vi.advanceTimersByTimeAsync(CRON_CALLER_TIMEOUT_MS);
    await pending;
    expect(finishedAt - started).toBeLessThanOrEqual(EMAIL_RUN_BUDGET_MS);
  });

  it('KONTROLA UJEMNA: bez budżetu przebiegu ta sama paczka trwa dłużej niż limit callera', async () => {
    const { pool } = memoryAuthOutbox(20);
    const { transport } = slowEmailLabs();
    const started = Date.now();
    let finishedAt = 0;
    const pending = processAuthEmailBatch(pool as never, transport, {
      baseURL, from: FROM, limit: 20, deadline: createRunDeadline({ budgetMs: Number.POSITIVE_INFINITY }),
    }).then((r) => { finishedAt = Date.now(); return r; });
    await vi.advanceTimersByTimeAsync(20 * 2 * REQUEST_MS);
    const result = await pending;
    // Wysyła więcej, niż zmieści się w limicie callera — Cloudflare widziałby timeout. Paczkę
    // zatrzymuje dopiero ochrona dzierżawy (300 s), nie budżet przebiegu.
    expect(result.sent).toBeGreaterThan(CRON_CALLER_TIMEOUT_MS / (2 * REQUEST_MS));
    expect(result.failed).toBe(0);
    expect(finishedAt - started).toBeGreaterThan(CRON_CALLER_TIMEOUT_MS);
  });

  it('dzierżawa za krótka na bezpieczną wysyłkę → odłożenie bez próby; wygasła → leaseLost, nie failed', async () => {
    const short = memoryAuthOutbox(2, EMAIL_MIN_SEND_WINDOW_MS - 1);
    const { transport, posted } = slowEmailLabs();
    const shortResult = await processAuthEmailBatch(short.pool as never, transport, { baseURL, from: FROM });
    expect(shortResult).toMatchObject({ sent: 0, failed: 0, deadlineDeferred: 2, ok: false });
    expect(posted).toHaveLength(0);
    expect(short.pool.query.mock.calls.some(([sql]) => String(sql).includes('fail_email'))).toBe(false);

    const gone = memoryAuthOutbox(1, -1);
    const goneResult = await processAuthEmailBatch(gone.pool as never, transport, { baseURL, from: FROM });
    expect(goneResult).toMatchObject({ sent: 0, failed: 0, leaseLost: 1, ok: false });
    expect(gone.pool.query.mock.calls.some(([sql]) => String(sql).includes('fail_email'))).toBe(false);
  });

  it('KONTROLA UJEMNA: świeża dzierżawa — list wychodzi, ok=true', async () => {
    const { pool } = memoryAuthOutbox(1);
    const { transport, posted } = slowEmailLabs();
    const pending = processAuthEmailBatch(pool as never, transport, { baseURL, from: FROM });
    await vi.advanceTimersByTimeAsync(2 * REQUEST_MS);
    expect(await pending).toMatchObject({ sent: 1, failed: 0, ok: true });
    expect(posted).toHaveLength(1);
  });

  it('przerwanie żądania callera: trwająca wysyłka przerwana, reszta odłożona, ok=false', async () => {
    const { pool, rows } = memoryAuthOutbox(5);
    const { transport, posted } = slowEmailLabs();
    const caller = new AbortController();
    const pending = processAuthEmailBatch(pool as never, transport, {
      baseURL, from: FROM, deadline: createRunDeadline({ signal: caller.signal }),
    });
    await vi.advanceTimersByTimeAsync(2 * REQUEST_MS + 1_000); // pierwszy list wysłany, drugi w trakcie
    caller.abort();
    await vi.advanceTimersByTimeAsync(0);
    const result = await pending;
    expect(posted).toHaveLength(1);
    expect(result).toMatchObject({ sent: 1, ok: false });
    // Przerwana wysyłka to próba z niejednoznacznym wynikiem (ponowienie tym samym kluczem);
    // listy bez próby wracają do kolejki jako odłożone, nie jako porażki.
    expect(result.failed).toBe(1);
    expect(result.deadlineDeferred).toBe(3);
    expect(rows.filter((r) => r.status === 'leased')).toHaveLength(0);
  });

  it('dwa nakładające się przebiegi: bez duplikatów i bez rekordów w dzierżawie po zakończeniu', async () => {
    const { pool, rows } = memoryAuthOutbox(8);
    const { transport, posted } = slowEmailLabs();
    const first = processAuthEmailBatch(pool as never, transport, { baseURL, from: FROM, limit: 4 });
    await vi.advanceTimersByTimeAsync(30_000);
    const second = processAuthEmailBatch(pool as never, transport, { baseURL, from: FROM, limit: 8 });
    await vi.advanceTimersByTimeAsync(CRON_CALLER_TIMEOUT_MS * 2);
    const [a, b] = await Promise.all([first, second]);
    expect(new Set(posted).size).toBe(posted.length);
    expect(a.sent + b.sent).toBe(posted.length);
    expect(a.failed + b.failed).toBe(0);
    expect(rows.filter((r) => r.status === 'leased')).toHaveLength(0);
    expect(rows.filter((r) => r.status === 'sent')).toHaveLength(posted.length);
  });
});

describe('kolejka domenowa pod wolnym dostawcą (#731)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    resetFakeDb(null)
      .rows('email.outbox.recipient-names', [])
      .exec('email.outbox.defer')
      .exec('email.outbox.mark-sent')
      .exec('email.outbox.mark-failed')
      .rpc('email_delivery_send_check', null)
      .rpc('take_email_send_budget', [{ granted: true, retry_at: null }])
      .rpc('claim_email_batch', Array.from({ length: 20 }, (_, i) => ({
        id: `d${i}`, profile_id: null, to_email: `d${i}@example.test`, template: 'jobPublished', locale: 'nl',
        payload: { jobTitle: 'Magazijnier' }, attempts: 0, lock_token: `lt-${i}`,
      })));
    process.env.RESEND_API_KEY = 're_test';
    delete process.env.EMAIL_FROM;
    process.env.NEXT_PUBLIC_SITE_URL = baseURL;
    resendSend.mockReset().mockImplementation(() => new Promise((resolve) => {
      setTimeout(() => resolve({ data: { id: 'provider-1' }, error: null }), 2 * REQUEST_MS);
    }));
  });
  afterEach(() => vi.useRealTimers());

  it('20 wierszy: koniec przed budżetem, reszta zwolniona bez mark-failed, ok=false', async () => {
    const started = Date.now();
    let finishedAt = 0;
    const pending = processEmailQueue(20).then((r) => { finishedAt = Date.now(); return r; });
    await vi.advanceTimersByTimeAsync(CRON_CALLER_TIMEOUT_MS);
    const result = await pending;
    expect(finishedAt - started).toBeLessThanOrEqual(EMAIL_RUN_BUDGET_MS);
    expect(result.sent).toBeGreaterThan(0);
    expect(result).toMatchObject({ failed: 0, ok: false, deadlineDeferred: 20 - result.sent });
    expect(fakeDb.callsTo('email.outbox.mark-failed')).toHaveLength(0);
    expect(fakeDb.callsTo('email.outbox.defer')).toHaveLength(20 - result.sent);
  });

  it('KONTROLA UJEMNA: bez budżetu przebiegu ta sama paczka przekracza limit callera', async () => {
    const started = Date.now();
    let finishedAt = 0;
    const pending = processEmailQueue(20, { deadline: createRunDeadline({ budgetMs: Number.POSITIVE_INFINITY }) })
      .then((r) => { finishedAt = Date.now(); return r; });
    await vi.advanceTimersByTimeAsync(20 * 2 * REQUEST_MS);
    expect(await pending).toMatchObject({ sent: 20, ok: true });
    expect(finishedAt - started).toBeGreaterThan(CRON_CALLER_TIMEOUT_MS);
  });
});
