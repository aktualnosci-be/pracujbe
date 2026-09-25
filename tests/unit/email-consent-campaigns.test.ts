import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { EMAIL_PREFERENCE_CATEGORIES } from '@/lib/email/categories';
import { createUnsubscribeToken } from '@/lib/email/unsubscribe-token';
import { marketingSenderFromEnv, senderIdentityFromEnv } from '@/lib/email/sender';
import { newsletterJobsFromPayload } from '@/lib/email/newsletter-delivery';
import { checkReceivedEml } from '../../scripts/lib/received-eml.mjs';
import { fakeDb, pgError, resetFakeDb } from '../helpers/fake-db';

/**
 * #45, etap 2 — dowód zgody (akcja ustawień → RPC z wersją treści), wypisanie ze wszystkich
 * kategorii, newsletter z kampanii w workerze (tożsamość i adres nadawcy, text/plain,
 * wypisanie), budżet e-maili Auth i kontrola ODEBRANEJ wiadomości `.eml` (bez trackingu).
 * Scenariusze bazy (dowód, budżet odbiorcy, rezerwacja kampanii): supabase/tests/rls.sql CM45.
 */

const { send } = vi.hoisted(() => ({ send: vi.fn() }));

vi.mock('server-only', () => ({}));
vi.mock('resend', () => ({ Resend: class { emails = { send }; } }));
vi.mock('@/lib/db/portal', async () => (await import('../helpers/fake-db')).fakePortal());
vi.mock('@/lib/error-report', () => ({ captureError: vi.fn() }));
vi.mock('@/lib/env', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/env')>()),
  isProductionMode: () => true,
}));

const SECRET = 'test-unsubscribe-secret-0123456789abcdef';
const PROFILE = '8f2c1d3e-4b5a-4c6d-8e7f-901234567890';
const SITE = 'http://localhost:3000';
const SENDER_ENV = {
  EMAIL_FROM: 'Pracuj.be <news@pracuj.be>',
  EMAIL_SENDER_IDENTITY: 'Operator Testowy BV',
  EMAIL_SENDER_POSTAL_ADDRESS: 'Teststraat 1, 1000 Brussel, België',
};

const NL_JOBS = [
  { slug: 'magazijnier-gent', title: 'Magazijnier', city: 'Gent', locale: 'nl', isDemo: false },
];

beforeEach(() => {
  vi.clearAllMocks();
  resetFakeDb(null)
    .rows('email.outbox.recipient-names', [])
    .exec('email.outbox.defer')
    .exec('email.outbox.mark-sent')
    .exec('email.outbox.mark-failed');
  process.env.EMAIL_UNSUBSCRIBE_SECRET = SECRET;
  process.env.RESEND_API_KEY = 're_test';
  process.env.NEXT_PUBLIC_SITE_URL = SITE;
  for (const key of Object.keys(SENDER_ENV)) delete process.env[key];
  send.mockResolvedValue({ data: { id: 'provider-1' }, error: null });
});

describe('tożsamość nadawcy z konfiguracji', () => {
  it('marketing wymaga jawnego EMAIL_FROM, nazwy i adresu pocztowego', () => {
    expect(marketingSenderFromEnv(SENDER_ENV)).toEqual({
      from: SENDER_ENV.EMAIL_FROM,
      identity: SENDER_ENV.EMAIL_SENDER_IDENTITY,
      postalAddress: SENDER_ENV.EMAIL_SENDER_POSTAL_ADDRESS,
    });
    for (const missing of Object.keys(SENDER_ENV)) {
      const partial: Record<string, string | undefined> = { ...SENDER_ENV, [missing]: '  ' };
      expect(marketingSenderFromEnv(partial)).toBeNull();
    }
  });

  it('wartości jednoliniowe, bez nadmiarowej długości', () => {
    expect(senderIdentityFromEnv({ ...SENDER_ENV, EMAIL_SENDER_POSTAL_ADDRESS: 'A\n  B' })).toMatchObject({
      postalAddress: 'A B',
    });
    expect(senderIdentityFromEnv({ ...SENDER_ENV, EMAIL_SENDER_IDENTITY: 'x'.repeat(301) })).toBeNull();
  });
});

describe('newsletter z payloadu kampanii', () => {
  it('przyjmuje oferty w języku listu', () => {
    expect(newsletterJobsFromPayload({ jobs: NL_JOBS }, 'nl')).toEqual(NL_JOBS);
  });

  it('zły kształt albo inny język = błąd wiersza, nigdy pusty list', () => {
    for (const payload of [null, {}, { jobs: 'x' }, { jobs: [{ ...NL_JOBS[0], locale: 'pl' }] },
      { jobs: [{ ...NL_JOBS[0], title: 5 }] }, { jobs: [{ ...NL_JOBS[0], isDemo: undefined }] }]) {
      expect(() => newsletterJobsFromPayload(payload as Record<string, unknown> | null, 'nl')).toThrow(
        'newsletter_payload_invalid',
      );
    }
  });
});

describe('renderDelivery — marketing tylko z tożsamością, wypisaniem i text/plain', () => {
  const unsubscribeUrl = `${SITE}/nl/wypisz?t=tok`;
  const row = { template: 'newsletter', payload: { campaignId: 'c1', jobs: NL_JOBS } };

  it('newsletter: nadawca, adres, wypisanie w HTML i text/plain; From z konfiguracji', async () => {
    const { renderDelivery } = await import('@/lib/email/outbox');
    const out = await renderDelivery(row, 'nl', {}, unsubscribeUrl, SENDER_ENV);
    expect(out.from).toBe(SENDER_ENV.EMAIL_FROM);
    for (const part of [out.html, out.text]) {
      expect(part).toContain(SENDER_ENV.EMAIL_SENDER_IDENTITY);
      expect(part).toContain(SENDER_ENV.EMAIL_SENDER_POSTAL_ADDRESS);
      expect(part).toContain(unsubscribeUrl);
    }
    expect(out.html).toContain('Afzender');
    expect(out.text).toContain('Postadres');
  });

  it('KONTROLA UJEMNA: bez tożsamości albo bez wypisania newsletter nie powstaje', async () => {
    const { renderDelivery } = await import('@/lib/email/outbox');
    await expect(renderDelivery(row, 'nl', {}, unsubscribeUrl, {})).rejects.toThrow('sender identity');
    await expect(
      renderDelivery(row, 'nl', {}, unsubscribeUrl, { ...SENDER_ENV, EMAIL_SENDER_POSTAL_ADDRESS: '' }),
    ).rejects.toThrow('sender identity');
    await expect(renderDelivery(row, 'nl', {}, undefined, SENDER_ENV)).rejects.toThrow('unsubscribe');
  });

  it('mail transakcyjny: zawsze text/plain; nadawca w stopce, gdy skonfigurowany', async () => {
    const { renderDelivery } = await import('@/lib/email/outbox');
    const data = { jobTitle: 'Chauffeur', companyName: 'Acme', offerUrl: `${SITE}/nl/candidate/propozycje` };
    const bare = await renderDelivery({ template: 'jobOffer', payload: null }, 'nl', data, undefined, {});
    expect(bare.text.trim().length).toBeGreaterThan(0);
    expect(bare.text).toContain('Chauffeur');
    expect(bare.html).not.toContain('data-email-sender');
    const withSender = await renderDelivery({ template: 'jobOffer', payload: null }, 'nl', data, undefined, SENDER_ENV);
    expect(withSender.html).toContain(SENDER_ENV.EMAIL_SENDER_POSTAL_ADDRESS);
    expect(withSender.from).toBe(SENDER_ENV.EMAIL_FROM);
  });
});

describe('worker: newsletter z kampanii', () => {
  function mockQueue(rows: unknown[]) {
    fakeDb.rpc('claim_email_batch', rows);
    fakeDb.rpc('email_delivery_send_check', null);
    fakeDb.rpc('take_email_send_budget', [{ granted: true, retry_at: null }]);
  }
  const queued = {
    id: 'n1',
    profile_id: PROFILE,
    to_email: 'n1@example.test',
    template: 'newsletter',
    locale: 'nl',
    payload: { campaignId: 'c1', jobs: NL_JOBS },
    attempts: 0,
    lock_token: 'lock-n1',
  };

  it('wysyła HTML + text/plain, nagłówki RFC 8058 i From z konfiguracji', async () => {
    Object.assign(process.env, SENDER_ENV);
    mockQueue([queued]);
    const { processEmailQueue } = await import('@/lib/email/outbox');
    expect(await processEmailQueue()).toMatchObject({ sent: 1, failed: 0 });
    const [message] = send.mock.calls[0]!;
    expect(message.from).toBe(SENDER_ENV.EMAIL_FROM);
    expect(message.text).toContain(SENDER_ENV.EMAIL_SENDER_POSTAL_ADDRESS);
    expect(message.html).toContain(SENDER_ENV.EMAIL_SENDER_IDENTITY);
    expect(message.headers['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
    expect(message).not.toHaveProperty('tracking');
  });

  it('KONTROLA UJEMNA: bez EMAIL_SENDER_* nic nie wychodzi (ponowienie, nie wysyłka)', async () => {
    mockQueue([queued]);
    const { processEmailQueue } = await import('@/lib/email/outbox');
    expect(await processEmailQueue()).toMatchObject({ sent: 0, failed: 1 });
    expect(send).not.toHaveBeenCalled();
  });
});

describe('wypisanie ze wszystkich kategorii (strona /wypisz)', () => {
  it('scope=all → email_unsubscribe_all ze źródłem strony i językiem', async () => {
    fakeDb.rpc('email_unsubscribe_all', true);
    const { unsubscribeFromEmail } = await import('@/lib/actions/email-unsubscribe');
    const form = new FormData();
    form.set('t', createUnsubscribeToken({ profileId: PROFILE, category: 'offers' }, SECRET));
    form.set('l', 'fr');
    form.set('scope', 'all');
    expect(await unsubscribeFromEmail(null, form)).toEqual({ status: 'done', category: 'offers', scope: 'all' });
    expect(fakeDb.callsTo('email_unsubscribe_all')).toEqual([
      expect.objectContaining({
        args: { p_profile_id: PROFILE, p_source: 'unsubscribe_page', p_locale: 'fr' },
        as: 'service',
      }),
    ]);
  });

  it('cudzy (inny sekret) albo wygasły token → brak zapisu', async () => {
    const { unsubscribeFromEmail } = await import('@/lib/actions/email-unsubscribe');
    const foreign = new FormData();
    foreign.set('t', createUnsubscribeToken({ profileId: PROFILE, category: 'offers' }, `${SECRET}-other`));
    foreign.set('scope', 'all');
    expect(await unsubscribeFromEmail(null, foreign)).toEqual({ status: 'invalid' });
    const expired = new FormData();
    expired.set('t', createUnsubscribeToken({ profileId: PROFILE, category: 'offers' }, SECRET, Date.UTC(2020, 0, 1)));
    expired.set('scope', 'all');
    expect(await unsubscribeFromEmail(null, expired)).toEqual({ status: 'expired' });
    expect(fakeDb.calls).toHaveLength(0);
  });

  it('nieznany język formularza nie trafia do dowodu (null → język odbiorcy w bazie)', async () => {
    fakeDb.rpc('email_unsubscribe', true);
    const { unsubscribeFromEmail } = await import('@/lib/actions/email-unsubscribe');
    const form = new FormData();
    form.set('t', createUnsubscribeToken({ profileId: PROFILE, category: 'messages' }, SECRET));
    form.set('l', 'de');
    await unsubscribeFromEmail(null, form);
    expect(fakeDb.callsTo('email_unsubscribe')[0]?.args).toEqual({
      p_profile_id: PROFILE,
      p_category: 'messages',
      p_source: 'unsubscribe_page',
      p_locale: null,
    });
  });
});

describe('ustawienia: zapis z dowodem zgody', () => {
  const values = {
    emailApplications: true,
    emailOffers: false,
    emailMessages: true,
    emailJobMatches: true,
    emailMarketing: true,
    pushEnabled: false,
    inAppEnabled: true,
  };

  it('RPC set_notification_preferences z językiem strony i wersją pokazanej treści', async () => {
    resetFakeDb({ id: PROFILE, role: 'employer' }).rpc('set_notification_preferences', null);
    const { updateNotificationPreferences } = await import('@/lib/actions/notification-preferences');
    const { emailConsentWordingVersion } = await import('@/lib/email/consent-wording');
    expect(await updateNotificationPreferences({ ...values, locale: 'nl', role: 'employer' })).toEqual({ ok: true });
    const [call] = fakeDb.callsTo('set_notification_preferences');
    // Zapis pod sesją (RLS/auth.uid()), p_prefs jako jsonb.
    expect(call?.as).toBe(PROFILE);
    expect(call?.args).toEqual({
      p_prefs: JSON.stringify({
        email_applications: true,
        email_offers: false,
        email_messages: true,
        email_job_matches: true,
        email_marketing: true,
        push_enabled: false,
        in_app_enabled: true,
      }),
      p_locale: 'nl',
      p_wording_version: emailConsentWordingVersion('nl', 'employer'),
    });
  });

  it('kontrola ujemna (#605): rola z formularza jest ignorowana, liczy się rola profilu sesji', async () => {
    // Sesja kandydata, ale formularz podszywa się pod pracodawcę — dowód MUSI użyć roli sesji.
    resetFakeDb({ id: PROFILE, role: 'candidate' }).rpc('set_notification_preferences', null);
    const { updateNotificationPreferences } = await import('@/lib/actions/notification-preferences');
    const { emailConsentWordingVersion } = await import('@/lib/email/consent-wording');
    expect(
      await updateNotificationPreferences({ ...values, locale: 'nl', role: 'employer' }),
    ).toEqual({ ok: true });
    const [call] = fakeDb.callsTo('set_notification_preferences');
    expect(call?.args['p_wording_version']).toBe(emailConsentWordingVersion('nl', 'candidate'));
    expect(call?.args['p_wording_version']).not.toBe(emailConsentWordingVersion('nl', 'employer'));
  });

  it('admin nie ma tego ekranu ustawień → PERMISSION_DENIED bez zapisu', async () => {
    resetFakeDb({ id: PROFILE, role: 'admin' });
    const { updateNotificationPreferences } = await import('@/lib/actions/notification-preferences');
    expect(await updateNotificationPreferences({ ...values, locale: 'pl' })).toEqual({
      ok: false,
      error: 'PERMISSION_DENIED',
    });
    expect(fakeDb.calls).toHaveLength(0);
  });

  it('gość → PERMISSION_DENIED bez zapisu; odmowa bazy → PERMISSION_DENIED, inny błąd → INTERNAL', async () => {
    const { updateNotificationPreferences } = await import('@/lib/actions/notification-preferences');
    resetFakeDb(null);
    expect(await updateNotificationPreferences({ ...values, locale: 'pl' })).toEqual({ ok: false, error: 'PERMISSION_DENIED' });
    expect(fakeDb.calls).toHaveLength(0);
    resetFakeDb({ id: PROFILE, role: 'candidate' }).rpc('set_notification_preferences', () => {
      throw pgError('42501', 'UNAUTHENTICATED');
    });
    expect(await updateNotificationPreferences({ ...values, locale: 'pl' })).toEqual({ ok: false, error: 'PERMISSION_DENIED' });
    fakeDb.rpc('set_notification_preferences', () => {
      throw pgError('22023', 'VALIDATION_FAILED: prefs');
    });
    expect(await updateNotificationPreferences({ ...values, locale: 'pl' })).toEqual({ ok: false, error: 'INTERNAL' });
  });

  it('nieobsługiwany język → VALIDATION_FAILED bez zapisu', async () => {
    const { updateNotificationPreferences } = await import('@/lib/actions/notification-preferences');
    expect(await updateNotificationPreferences({ ...values, locale: 'de' })).toEqual({
      ok: false,
      error: 'VALIDATION_FAILED',
    });
    expect(fakeDb.calls).toHaveLength(0);
  });

  it('wersja treści: deterministyczna, inna dla języka i roli, format zgodny z bazą', async () => {
    const { emailConsentWordingVersion } = await import('@/lib/email/consent-wording');
    const v = emailConsentWordingVersion('pl', 'candidate');
    expect(v).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(emailConsentWordingVersion('pl', 'candidate')).toBe(v);
    expect(emailConsentWordingVersion('fr', 'candidate')).not.toBe(v);
    expect(emailConsentWordingVersion('pl', 'employer')).not.toBe(v);
  });
});

describe('budżet e-maili Auth', () => {
  it('odmowa → denied z Retry-After do następnego okna', async () => {
    const { takeAuthSendBudget } = await import('@/lib/email/auth-send-budget');
    const now = Date.UTC(2026, 8, 24, 12, 0, 0);
    fakeDb.rpc('take_email_send_budget', [{ granted: false, retry_at: new Date(now + 42_000).toISOString() }]);
    expect(await takeAuthSendBudget('passwordReset', () => now)).toEqual({
      status: 'denied',
      retryAfterSeconds: 42,
    });
    expect(fakeDb.callsTo('take_email_send_budget')).toEqual([
      expect.objectContaining({ args: { p_template: 'passwordReset' }, as: 'service' }),
    ]);
  });

  it('błąd bazy nie blokuje logowania/resetu (fail-open)', async () => {
    const { takeAuthSendBudget } = await import('@/lib/email/auth-send-budget');
    fakeDb.rpc('take_email_send_budget', () => {
      throw pgError('08006', 'db down');
    });
    expect(await takeAuthSendBudget('passwordReset')).toEqual({ status: 'skipped' });
    fakeDb.rpc('take_email_send_budget', [{ granted: true, retry_at: null }]);
    expect(await takeAuthSendBudget('passwordReset')).toEqual({ status: 'granted' });
  });

  it('brak puli service → skipped bez zapytań (e-mail Auth wychodzi)', async () => {
    const { takeAuthSendBudget } = await import('@/lib/email/auth-send-budget');
    const { fakeSession } = await import('../helpers/fake-db');
    fakeSession.serviceConfigured = false;
    expect(await takeAuthSendBudget('passwordReset')).toEqual({ status: 'skipped' });
    expect(fakeDb.calls).toHaveLength(0);
  });
});

describe('lustro SQL ↔ TS (0101)', () => {
  const sql = readFileSync(join(process.cwd(), 'supabase/migrations/0101_email_consent_campaigns.sql'), 'utf8');

  it('kategorie dowodu zgody = kategorie preferencji', () => {
    const body = /constraint email_consent_events_category check \(\s*category in \(([^)]*)\)/.exec(sql)![1]!;
    expect([...body.matchAll(/'(\w+)'/g)].map((m) => m[1])).toEqual([...EMAIL_PREFERENCE_CATEGORIES]);
  });

  it('format wersji treści w bazie = format z aplikacji', () => {
    expect(sql).toContain("'^sha256:[0-9a-f]{64}$'");
  });
});

// --- Odebrana wiadomość (.eml) -------------------------------------------------------------

function toEml(message: {
  from: string;
  subject: string;
  html: string;
  text: string;
  headers?: Record<string, string>;
}): string {
  const boundary = 'b-test-45';
  const headers = Object.entries(message.headers ?? {}).map(([k, v]) => `${k}: ${v}`);
  const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64').replace(/(.{76})/g, '$1\r\n');
  return [
    `From: ${message.from}`,
    'To: n1@example.test',
    `Subject: ${message.subject}`,
    ...headers,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative;\r\n boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: base64',
    '',
    b64(message.text),
    `--${boundary}`,
    'Content-Type: text/html; charset=utf-8',
    'Content-Transfer-Encoding: base64',
    '',
    b64(message.html),
    `--${boundary}--`,
    '',
  ].join('\r\n');
}

describe('kontrola odebranej wiadomości (.eml)', () => {
  const opts = {
    allowedHosts: ['localhost:3000'],
    identity: SENDER_ENV.EMAIL_SENDER_IDENTITY,
    postalAddress: SENDER_ENV.EMAIL_SENDER_POSTAL_ADDRESS,
    marketing: true,
  };
  const listHeaders = {
    'List-Unsubscribe': `<https://localhost:3000/api/email/unsubscribe?t=tok&l=nl>`,
    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
  };

  async function newsletterMessage() {
    const { renderDelivery } = await import('@/lib/email/outbox');
    const out = await renderDelivery(
      { template: 'newsletter', payload: { jobs: NL_JOBS } },
      'nl',
      {},
      `${SITE}/nl/wypisz?t=tok`,
      SENDER_ENV,
    );
    return { ...out, headers: listHeaders };
  }

  it('wiadomość z workera przechodzi: HTML + text/plain, nadawca, adres, RFC 8058, bez trackingu', async () => {
    expect(checkReceivedEml(toEml(await newsletterMessage()), opts)).toEqual({ ok: true, failures: [] });
  });

  it('KONTROLA UJEMNA: piksel otwarć i przepisany link kliknięć dostawcy są wykrywane', async () => {
    const m = await newsletterMessage();
    const pixel = m.html.replace('</body>', '<img src="https://open.tracking.example/o/abc" width="1" height="1"></body>');
    const rewritten = m.html.replace(/href="http:\/\/localhost:3000\/nl\/oferty-pracy"/, 'href="https://click.tracking.example/l/xyz"');
    expect(rewritten).not.toBe(m.html);
    for (const html of [pixel, rewritten]) {
      const res = checkReceivedEml(toEml({ ...m, html }), opts);
      expect(res.ok).toBe(false);
      expect(res.failures.join('\n')).toMatch(/tracking or foreign link/);
    }
  });

  it('KONTROLA UJEMNA: brak text/plain, adresu pocztowego albo List-Unsubscribe-Post', async () => {
    const m = await newsletterMessage();
    expect(checkReceivedEml(toEml({ ...m, text: '' }), opts).failures).toContain('missing text/plain part');
    const noAddress = { ...m, html: m.html.replaceAll(SENDER_ENV.EMAIL_SENDER_POSTAL_ADDRESS, ''), text: m.text.replaceAll(SENDER_ENV.EMAIL_SENDER_POSTAL_ADDRESS, '') };
    expect(checkReceivedEml(toEml(noAddress), opts).failures).toEqual(
      expect.arrayContaining(['sender postal address missing in HTML', 'sender postal address missing in text/plain']),
    );
    const noPost = { ...m, headers: { 'List-Unsubscribe': listHeaders['List-Unsubscribe'] } };
    expect(checkReceivedEml(toEml(noPost), opts).failures).toContain(
      'missing List-Unsubscribe-Post: List-Unsubscribe=One-Click',
    );
  });
});
