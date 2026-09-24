import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { actAs, realSession } from './support/real-portal';
import { startPortalDb } from './support/portal-db';

/**
 * #25 — zadania serwerowe i poczta na PostgreSQL 16: pula `service` (service_role) dla workera
 * outboxa, inboxu webhooków, limitera, crona i zgłoszeń treści; preferencje powiadomień pod
 * sesją (RLS). Każda operacja workera to osobna transakcja (claim zatwierdzony przed wysyłką).
 */

const { sent } = vi.hoisted(() => ({ sent: [] as Array<{ to: string; html: string; subject: string }> }));

vi.mock('@/lib/db/portal', async () => (await import('./support/real-portal')).realPortal());
vi.mock('@/lib/sentry', () => ({ captureError: vi.fn() }));
vi.mock('next/headers', () => ({ headers: async () => new Headers({ 'x-real-ip': '192.0.2.44' }) }));
vi.mock('@/lib/turnstile/verify', () => ({ enforceTurnstile: async () => null }));
// Konfiguracja integracji nie transformuje JSX; render szablonów sprawdzają testy unit
// (email-outbox-locale, email-recipient-locale-e2e). Tu: jaki język i dane dostał render.
vi.mock('@/emails/templates', () => ({
  renderEmail: async (type: string, locale: string, data: Record<string, unknown>) => ({
    subject: `${type}:${locale}`,
    html: `<html lang="${locale}">${JSON.stringify(data)}</html>`,
    text: `${type}:${locale}`,
  }),
}));
vi.mock('resend', () => ({
  Resend: class {
    emails = {
      send: async (message: { to: string; html: string; subject: string }) => {
        // Chwila opóźnienia: równoległe workery naprawdę się przeplatają.
        await new Promise((resolve) => setTimeout(resolve, 5));
        sent.push(message);
        return { data: { id: `provider-${sent.length}` }, error: null };
      },
    };
  },
}));

const SECRET = 'integration-unsubscribe-secret-0123456789';
process.env.EMAIL_UNSUBSCRIBE_SECRET = SECRET;
process.env.RESEND_API_KEY = 're_test';
process.env.NEXT_PUBLIC_SITE_URL = 'https://pracuj.be';
process.env.MAINTENANCE_SECRET = 'maintenance-secret';

const { processEmailQueue } = await import('../../src/lib/email/outbox');
const { claimWebhook, completeWebhook } = await import('../../src/lib/webhook-inbox');
const { checkRateLimit } = await import('../../src/lib/rate-limit');
const { POST: maintenance } = await import('../../src/app/api/maintenance/route');
const { applyUnsubscribe } = await import('../../src/lib/email/unsubscribe');
const { createUnsubscribeToken } = await import('../../src/lib/email/unsubscribe-token');
const { takeAuthSendBudget } = await import('../../src/lib/email/auth-send-budget');
const { readOpsMetrics } = await import('../../src/lib/ops/metrics-source');
const { loadNotificationPreferences } = await import('../../src/lib/data/notification-preferences');
const { updateNotificationPreferences } = await import('../../src/lib/actions/notification-preferences');
const { submitContentReport, lookupReportCase } = await import('../../src/lib/actions/content-reports');
const { POST: resendWebhook } = await import('../../src/app/api/email/webhook/resend/route');
const { signStandardWebhook } = await import('../../src/lib/webhooks');

const RESEND_SECRET = `whsec_${Buffer.from('resend-integration-key').toString('base64')}`;
process.env.RESEND_WEBHOOK_SECRET = RESEND_SECRET;

let alice: string;
let bob: string;
let companyId: string;
let jobId: string;

function db() {
  return realSession.db!;
}

const PREFS = {
  emailApplications: true,
  emailOffers: false,
  emailMessages: true,
  emailJobMatches: true,
  emailMarketing: false,
  pushEnabled: false,
  inAppEnabled: true,
};

beforeAll(async () => {
  realSession.db = await startPortalDb();
  // 0106 (#25): claim_email_batch wykonywalne przez service_role — bez grantu w teście.
  alice = await db().createUser('candidate', 'nl');
  bob = await db().createUser('candidate', 'fr');
  companyId = (await db().admin.query(
    `INSERT INTO public.companies(name, status) VALUES ('Serwis IT', 'verified') RETURNING id`,
  )).rows[0].id;
  jobId = (await db().admin.query(
    `INSERT INTO public.jobs(company_id, slug, title, status, category, contract_type, city, region, published_at)
     VALUES ($1, $2, 'Magazynier', 'active', 'warehouse', 'permanent', 'Gent', 'Flandria', now())
     RETURNING id`,
    [companyId, `serwis-${randomUUID().slice(0, 8)}`],
  )).rows[0].id;
  await db().admin.query(`INSERT INTO public.job_translations(job_id, locale, title) VALUES ($1, 'pl', 'Magazynier')`, [jobId]);
}, 180_000);

afterAll(async () => {
  await realSession.db?.stop();
});

beforeEach(() => {
  sent.length = 0;
  actAs(null);
});

describe('worker outboxa na puli service (#25)', () => {
  it('dwa równoległe workery nie dostają tego samego wiersza; wynik zapisany po wysyłce', async () => {
    await db().admin.query(`DELETE FROM public.email_deliveries`);
    const ids: string[] = [];
    for (let i = 0; i < 6; i++) {
      const { rows } = await db().admin.query(
        `INSERT INTO public.email_deliveries(profile_id, to_email, template, locale, payload)
         VALUES ($1, $2, 'jobPublished', $3, $4::jsonb) RETURNING id`,
        [i % 2 ? alice : bob, `r${i}@example.invalid`, i % 2 ? 'nl' : 'fr', JSON.stringify({ jobTitle: `Oferta ${i}` })],
      );
      ids.push(rows[0].id);
    }

    const [a, b] = await Promise.all([processEmailQueue(3), processEmailQueue(3)]);
    expect(a.ok && b.ok).toBe(true);
    expect(a.sent + b.sent).toBe(6);
    // Każdy odbiorca dokładnie raz — claim (FOR UPDATE SKIP LOCKED) zatwierdzony przed wysyłką.
    expect(sent.map((m) => m.to).sort()).toEqual(ids.map((_, i) => `r${i}@example.invalid`).sort());

    const { rows } = await db().admin.query(
      `SELECT status::text, attempts, locked_at, provider_message_id FROM public.email_deliveries WHERE id = ANY($1::uuid[])`,
      [ids],
    );
    for (const row of rows) {
      expect(row).toMatchObject({ status: 'sent', attempts: 1, locked_at: null });
      expect(row.provider_message_id).toMatch(/^provider-\d+$/);
    }
    // Kolejny przebieg: nic do wysłania (brak podwójnej wysyłki).
    expect(await processEmailQueue(10)).toMatchObject({ processed: 0, ok: true });
  });

  it('Invariant #1: treść w języku wiersza (odbiorcy), imię odbiorcy z profilu', async () => {
    await db().admin.query(`UPDATE public.profiles SET first_name = 'Anke' WHERE id = $1`, [alice]);
    await db().admin.query(
      `INSERT INTO public.email_deliveries(profile_id, to_email, template, locale, payload)
       VALUES ($1, 'anke@example.invalid', 'jobPublished', 'nl', '{"jobTitle":"Chauffeur"}'::jsonb)`,
      [alice],
    );
    await processEmailQueue(5);
    const mail = sent.find((m) => m.to === 'anke@example.invalid')!;
    expect(mail.html).toContain('lang="nl"');
    expect(mail.html).toContain('Anke');
  });

  it('odmowa budżetu odkłada wiersz bez zwiększania attempts', async () => {
    const { rows } = await db().admin.query(
      `INSERT INTO public.email_deliveries(profile_id, to_email, template, locale, payload)
       VALUES ($1, 'budget@example.invalid', 'jobPublished', 'fr', '{"jobTitle":"X"}'::jsonb) RETURNING id`,
      [bob],
    );
    // Pula transakcyjna wyczerpana w bieżącym (dobowym) oknie.
    await db().admin.query(`UPDATE public.email_send_budget_config SET window_seconds = 86400`);
    await db().admin.query(
      `INSERT INTO public.email_send_windows(window_start, transactional_used)
       VALUES (to_timestamp(floor(extract(epoch from clock_timestamp()) / 86400) * 86400), 1000)
       ON CONFLICT (window_start) DO UPDATE SET transactional_used = 1000`,
    );
    try {
      expect(await processEmailQueue(5)).toMatchObject({ sent: 0, deferred: 1, ok: true });
      const after = await db().admin.query(
        `SELECT status::text, attempts, locked_at, next_attempt_at > now() AS later FROM public.email_deliveries WHERE id = $1`,
        [rows[0].id],
      );
      expect(after.rows[0]).toEqual({ status: 'queued', attempts: 0, locked_at: null, later: true });
    } finally {
      await db().admin.query(`DELETE FROM public.email_send_windows`);
      await db().admin.query(`UPDATE public.email_send_budget_config SET window_seconds = 60`);
      await db().admin.query(`DELETE FROM public.email_deliveries WHERE id = $1`, [rows[0].id]);
    }
  });

  it('budżet e-maili Auth przez pulę service', async () => {
    expect(await takeAuthSendBudget('passwordReset')).toEqual({ status: 'granted' });
  });
});

describe('inbox webhooków: osobne transakcje claim/complete', () => {
  it('claimed → locked (dzierżawa widoczna od razu) → completed → duplicate', async () => {
    const id = `it:${randomUUID()}`;
    expect(await claimWebhook(id, 'integration')).toBe('claimed');
    expect(await claimWebhook(id, 'integration')).toBe('locked');
    expect(await completeWebhook(id)).toBe(true);
    expect(await claimWebhook(id, 'integration')).toBe('duplicate');
    expect(await completeWebhook(`it:${randomUUID()}`)).toBe(false);
  });

  it('wygasła dzierżawa pozwala na ponowne przetworzenie', async () => {
    const id = `it:${randomUUID()}`;
    expect(await claimWebhook(id, 'integration', 1)).toBe('claimed');
    await db().admin.query(`UPDATE public.processed_webhooks SET locked_until = now() - interval '1 second' WHERE id = $1`, [id]);
    expect(await claimWebhook(id, 'integration', 1)).toBe('claimed');
  });
});

describe('webhook Resend: claim → record_email_event → complete (osobne transakcje)', () => {
  function signed(body: string, id: string) {
    const ts = String(Math.floor(Date.now() / 1000));
    return new Request('https://pracuj.be/api/email/webhook/resend', {
      method: 'POST',
      headers: { 'svix-id': id, 'svix-timestamp': ts, 'svix-signature': signStandardWebhook(RESEND_SECRET, id, ts, body) },
      body,
    });
  }

  it('twarde odbicie: status wysyłki bounced, blokada adresu, inbox completed; powtórka = duplicate', async () => {
    const delivery = (await db().admin.query(
      `INSERT INTO public.email_deliveries(profile_id, to_email, template, locale, payload, status, provider_message_id)
       VALUES ($1, 'odbicie@example.invalid', 'jobPublished', 'fr', '{}'::jsonb, 'sent', 'prov-bounce-1') RETURNING id`,
      [bob],
    )).rows[0].id;
    const body = JSON.stringify({
      type: 'email.bounced',
      created_at: new Date().toISOString(),
      data: { email_id: 'prov-bounce-1', to: ['odbicie@example.invalid'], bounce: { type: 'Permanent' } },
    });
    const id = `msg_${randomUUID()}`;
    const res = await resendWebhook(signed(body, id));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    const row = await db().admin.query(`SELECT status::text FROM public.email_deliveries WHERE id = $1`, [delivery]);
    expect(row.rows).toEqual([{ status: 'bounced' }]);
    const blocked = await db().admin.query(
      `SELECT reason FROM public.email_suppressions WHERE email = 'odbicie@example.invalid' AND lifted_at IS NULL`,
    );
    expect(blocked.rows).toEqual([{ reason: 'hard_bounce' }]);
    const inbox = await db().admin.query(`SELECT status FROM public.processed_webhooks WHERE id = $1`, [`resend:${id}`]);
    expect(inbox.rows).toEqual([{ status: 'completed' }]);

    const again = await resendWebhook(signed(body, id));
    expect(await again.json()).toMatchObject({ duplicate: true });
  });
});

describe('limiter rate_limit_hit przez service_role', () => {
  it('przekroczenie → false; inny klucz niezależny', async () => {
    const identifier = randomUUID();
    const opts = { max: 2, windowSeconds: 60, identifier };
    expect(await checkRateLimit('apply', opts)).toBe(true);
    expect(await checkRateLimit('apply', opts)).toBe(true);
    expect(await checkRateLimit('apply', opts)).toBe(false);
    expect(await checkRateLimit('apply', { ...opts, identifier: randomUUID() })).toBe(true);
  });
});

describe('/api/maintenance', () => {
  it('expire_due_jobs wygasza tylko aktywne po terminie; odpowiedź = liczniki', async () => {
    const due = (await db().admin.query(
      `INSERT INTO public.jobs(company_id, slug, title, status, category, contract_type, city, region, published_at, expires_at)
       VALUES ($1, $2, 'Po terminie', 'active', 'warehouse', 'permanent', 'Gent', 'Flandria', now() - interval '2 days', now() - interval '1 hour')
       RETURNING id`,
      [companyId, `due-${randomUUID().slice(0, 8)}`],
    )).rows[0].id;
    const res = await maintenance(new Request('http://web.internal/api/maintenance', {
      method: 'POST',
      headers: { authorization: 'Bearer maintenance-secret' },
    }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ ok: true });
    expect(body.expiredJobs).toBeGreaterThanOrEqual(1);
    const statuses = await db().admin.query(`SELECT id, status::text FROM public.jobs WHERE id = ANY($1::uuid[])`, [[due, jobId]]);
    const byId = Object.fromEntries(statuses.rows.map((r) => [r.id, r.status]));
    expect(byId).toEqual({ [due]: 'expired', [jobId]: 'active' });
  });
});

describe('wypisanie z e-maili (token) przez service_role', () => {
  it('kategoria z tokenu → preferencja wyłączona, ponowienie idempotentne; dowód zgody', async () => {
    const token = createUnsubscribeToken({ profileId: bob, category: 'messages' }, SECRET);
    expect(await applyUnsubscribe(token, { source: 'one_click', locale: 'fr' })).toEqual({ status: 'done', category: 'messages' });
    expect(await applyUnsubscribe(token, { source: 'one_click', locale: 'fr' })).toEqual({ status: 'done', category: 'messages' });
    const prefs = await db().admin.query(`SELECT email_messages, email_offers FROM public.notification_preferences WHERE profile_id = $1`, [bob]);
    expect(prefs.rows[0]).toEqual({ email_messages: false, email_offers: true });
    const events = await db().admin.query(
      `SELECT category, granted, source, locale FROM public.email_consent_events WHERE profile_id = $1 AND category = 'messages'`,
      [bob],
    );
    expect(events.rows).toEqual([{ category: 'messages', granted: false, source: 'one_click', locale: 'fr' }]);
  });

  it('scope=all wyłącza wszystkie kategorie e-mail', async () => {
    const token = createUnsubscribeToken({ profileId: bob, category: 'offers' }, SECRET);
    expect(await applyUnsubscribe(token, { source: 'unsubscribe_page', scope: 'all' })).toMatchObject({ status: 'done', scope: 'all' });
    const prefs = await db().admin.query(
      `SELECT email_applications, email_offers, email_messages, email_job_matches, email_marketing FROM public.notification_preferences WHERE profile_id = $1`,
      [bob],
    );
    expect(Object.values(prefs.rows[0])).toEqual([false, false, false, false, false]);
  });
});

describe('preferencje powiadomień pod sesją', () => {
  it('zapis i odczyt tylko własnego wiersza; inny użytkownik widzi swoje (domyślne)', async () => {
    actAs({ id: alice, role: 'candidate' });
    expect(await updateNotificationPreferences({ ...PREFS, locale: 'nl', role: 'candidate' })).toEqual({ ok: true });
    expect(await loadNotificationPreferences()).toEqual({ status: 'ready', preferences: PREFS });

    const carol = await db().createUser('candidate', 'en');
    actAs({ id: carol, role: 'candidate' });
    const own = await loadNotificationPreferences();
    expect(own).toMatchObject({ status: 'ready', preferences: { emailOffers: true } });

    // Dowód zmiany zgody z językiem strony i wersją treści (0101).
    const events = await db().admin.query(
      `SELECT source, locale, wording_version FROM public.email_consent_events WHERE profile_id = $1 AND category = 'offers'`,
      [alice],
    );
    // Wycofanie zgody: bez wersji treści (wersja dotyczy tylko udzielenia zgody).
    expect(events.rows).toEqual([{ source: 'settings', locale: 'nl', wording_version: null }]);

    actAs({ id: alice, role: 'candidate' });
    expect(await updateNotificationPreferences({ ...PREFS, emailMarketing: true, locale: 'fr', role: 'candidate' })).toEqual({ ok: true });
    const granted = await db().admin.query(
      `SELECT granted, locale, wording_version FROM public.email_consent_events WHERE profile_id = $1 AND category = 'marketing'`,
      [alice],
    );
    expect(granted.rows).toHaveLength(1);
    expect(granted.rows[0]).toMatchObject({ granted: true, locale: 'fr' });
    expect(granted.rows[0].wording_version).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it('gość: odczyt = błąd, zapis = PERMISSION_DENIED', async () => {
    actAs(null);
    expect(await loadNotificationPreferences()).toEqual({ status: 'error' });
    expect(await updateNotificationPreferences({ ...PREFS, locale: 'pl' })).toEqual({ ok: false, error: 'PERMISSION_DENIED' });
  });

  it('RLS: sesja nie czyta cudzego wiersza nawet bezpośrednim zapytaniem', async () => {
    const { withUserTransaction } = await import('../../src/lib/db/transaction');
    const rows = await withUserTransaction(db().web, bob, async (tx) =>
      (await tx.query('SELECT profile_id FROM public.notification_preferences WHERE profile_id = $1', [alice])) as { rows: unknown[] },
    );
    expect(rows.rows).toEqual([]);
  });
});

describe('zgłoszenie treści (DSA) przez service_role', () => {
  function input(overrides: Record<string, unknown> = {}) {
    return {
      target: 'job' as const,
      jobId,
      category: 'fraud' as const,
      details: 'Oferta wymaga wpłaty przed rozmową kwalifikacyjną.',
      contentUrl: '',
      reporterName: '',
      reporterEmail: 'zglaszajacy@example.invalid',
      goodFaith: true as const,
      locale: 'fr' as const,
      idempotencyKey: randomUUID(),
      accessCode: 'ABCDEFGHIJKLMNOPQRSTUVWX',
      ...overrides,
    };
  }

  it('zalogowany: reporter z sesji, idempotencja, sprawa; e-mail w języku konta odbiorcy (Inv. #1)', async () => {
    actAs({ id: alice, role: 'candidate' });
    const payload = input();
    const first = await submitContentReport(payload, 'token');
    expect(first).toMatchObject({ ok: true, created: true });
    const again = await submitContentReport(payload, 'token');
    expect(again).toEqual({ ...first, created: false });
    if (!first.ok) return;

    const report = await db().admin.query(
      `SELECT reporter_id FROM public.reports WHERE case_number = $1`,
      [first.caseNumber],
    );
    expect(report.rows).toEqual([{ reporter_id: alice }]);
    const mail = await db().admin.query(
      `SELECT locale FROM public.email_deliveries WHERE template = 'reportReceived' AND to_email = 'zglaszajacy@example.invalid'`,
    );
    // Zalogowany zgłaszający dostaje e-mail w języku swojego konta (nl), nie formularza (fr).
    expect(mail.rows).toEqual([{ locale: 'nl' }]);

    const found = await lookupReportCase({ caseNumber: first.caseNumber, accessCode: payload.accessCode });
    expect(found).toMatchObject({ ok: true, report: { caseNumber: first.caseNumber, status: 'open' } });
    expect(await lookupReportCase({ caseNumber: first.caseNumber, accessCode: 'ZZZZZZZZZZZZZZZZZZZZZZZZ' })).toEqual({
      ok: false,
      error: 'NOT_FOUND',
    });
  });

  it('gość: reporter null; treść niepubliczna → NOT_FOUND', async () => {
    const guest = await submitContentReport(input({ reporterEmail: 'gosc@example.invalid' }), 'token');
    expect(guest).toMatchObject({ ok: true, created: true });
    if (guest.ok) {
      const row = await db().admin.query(`SELECT reporter_id FROM public.reports WHERE case_number = $1`, [guest.caseNumber]);
      expect(row.rows).toEqual([{ reporter_id: null }]);
      // Gość nie ma profilu: język e-maila = język formularza.
      const mail = await db().admin.query(
        `SELECT locale FROM public.email_deliveries WHERE template = 'reportReceived' AND to_email = 'gosc@example.invalid'`,
      );
      expect(mail.rows).toEqual([{ locale: 'fr' }]);
    }
    expect(await submitContentReport(input({ jobId: randomUUID() }), 'token')).toEqual({ ok: false, error: 'NOT_FOUND' });
  });
});

describe('ops_metrics przez pulę service (bez DATABASE_OPS_URL)', () => {
  it('zwraca liczniki w oczekiwanym kształcie', async () => {
    delete process.env.DATABASE_OPS_URL;
    expect(await readOpsMetrics()).toMatchObject({ kind: 'ok' });
  });
});
