import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * #100 (dokończenie) — zmiana nazwy zapisanego wyszukiwania, link „wyłącz tylko ten alert”
 * w e-mailu `jobMatch` i ponowna kontrola zgody tuż przed wysyłką (#466 pkt 8).
 * Zachowanie bazy (własność, idempotencja, wygaszanie kolejki) — `rls.sql` sekcja SS108.
 */

const { send } = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock('resend', () => ({ Resend: class { emails = { send }; } }));
vi.mock('@/lib/db/portal', async () => (await import('../helpers/fake-db')).fakePortal());
vi.mock('@/lib/sentry', () => ({ captureError: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('server-only', () => ({}));

import type { PortalIdentity } from '@/lib/auth/session';
import { fakeDb, fakeSession, pgError, resetFakeDb } from '../helpers/fake-db';
import {
  ALERT_OFF_TOKEN_TTL_SECONDS,
  alertOffPageUrl,
  createAlertOffToken,
  verifyAlertOffToken,
} from '@/lib/email/saved-search-alert-token';
import { createUnsubscribeToken, verifyUnsubscribeToken } from '@/lib/email/unsubscribe-token';
import { applyAlertOff, inspectAlertOffToken } from '@/lib/email/saved-search-alert-off';
import { renameSavedSearchAction } from '@/lib/actions/saved-searches';
import { renderEmail } from '@/emails/templates';
import { jobMatchAlertOffLabel } from '@/emails/copy';

const SECRET = 'test-unsubscribe-secret-0123456789abcdef';
const PROFILE = '8f2c1d3e-4b5a-4c6d-8e7f-901234567890';
const SEARCH = '5a6b7c8d-1e2f-4a3b-8c4d-5e6f7a8b9c0d';
const OTHER_SEARCH = '0d9c8b7a-6f5e-4d4c-8b3a-2f1e8d7c6b5a';
const SITE = 'https://pracuj.be';
const NOW = Date.UTC(2026, 8, 25, 12, 0, 0);
const MIGRATION = readFileSync(
  resolve(__dirname, '../../supabase/migrations/0108_saved_search_followups.sql'),
  'utf8',
);

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
  send.mockResolvedValue({ data: { id: 'provider-1' }, error: null });
});

describe('token wyłączenia alertu', () => {
  const token = (now = NOW) => createAlertOffToken({ profileId: PROFILE, savedSearchId: SEARCH }, SECRET, now);

  it('poprawny token → profil i wyszukiwanie; w tokenie i URL brak e-maila i nazwy', () => {
    const t = token();
    expect(verifyAlertOffToken(t, SECRET, NOW)).toMatchObject({ ok: true, profileId: PROFILE, savedSearchId: SEARCH });
    const decoded = Buffer.from(t.split('.')[1]!, 'base64url').toString('utf8');
    expect(decoded).toBe(`${PROFILE}|${SEARCH}|${Math.floor(NOW / 1000) + ALERT_OFF_TOKEN_TTL_SECONDS}`);
    const url = alertOffPageUrl(SITE, 'nl', t);
    expect(url.startsWith(`${SITE}/nl/wypisz-alert#t=`)).toBe(true);
    expect(url).not.toContain('@');
  });

  it('podmiana wyszukiwania w danych, inny sekret, śmieci → odrzucone', () => {
    const [v, data, sig] = token().split('.');
    const forged = Buffer.from(
      Buffer.from(data!, 'base64url').toString('utf8').replace(SEARCH, OTHER_SEARCH),
    ).toString('base64url');
    expect(verifyAlertOffToken(`${v}.${forged}.${sig}`, SECRET, NOW)).toEqual({ ok: false, reason: 'signature' });
    expect(verifyAlertOffToken(token(), `${SECRET}x`, NOW)).toEqual({ ok: false, reason: 'signature' });
    expect(verifyAlertOffToken('a1.x', SECRET, NOW)).toEqual({ ok: false, reason: 'malformed' });
    expect(verifyAlertOffToken(null, SECRET, NOW)).toEqual({ ok: false, reason: 'malformed' });
  });

  it('wygasły token → expired', () => {
    const old = token(NOW - (ALERT_OFF_TOKEN_TTL_SECONDS + 60) * 1000);
    expect(verifyAlertOffToken(old, SECRET, NOW)).toEqual({ ok: false, reason: 'expired' });
  });

  it('KONTROLA UJEMNA: token kategorii nie działa jako token alertu i odwrotnie (osobna domena podpisu)', () => {
    const category = createUnsubscribeToken({ profileId: PROFILE, category: 'job_matches' }, SECRET, NOW);
    expect(verifyAlertOffToken(category, SECRET, NOW).ok).toBe(false);
    // Nawet z podmienionym prefiksem wersji podpis się nie zgadza.
    expect(verifyAlertOffToken(category.replace(/^v1\./, 'a1.'), SECRET, NOW).ok).toBe(false);
    expect(verifyUnsubscribeToken(token(), SECRET, NOW).ok).toBe(false);
    expect(verifyUnsubscribeToken(token().replace(/^a1\./, 'v1.'), SECRET, NOW).ok).toBe(false);
  });
});

describe('wyłączenie alertu z linku (zapis po kliknięciu)', () => {
  const token = () => createAlertOffToken({ profileId: PROFILE, savedSearchId: SEARCH }, SECRET);

  it('inspekcja nie woła bazy; zapis woła RPC service_role z danymi z tokenu', async () => {
    fakeDb.rpc('saved_search_alert_unsubscribe', null);
    expect(inspectAlertOffToken(token())).toEqual({ status: 'valid' });
    expect(fakeDb.calls).toHaveLength(0);
    expect(await applyAlertOff(token())).toEqual({ status: 'done' });
    expect(fakeDb.callsTo('saved_search_alert_unsubscribe')).toEqual([
      expect.objectContaining({ args: { p_profile_id: PROFILE, p_saved_search_id: SEARCH }, as: 'service' }),
    ]);
  });

  it('zły/wygasły token → bez zapytania; brak sekretu/puli → unavailable; błąd bazy → error', async () => {
    expect(await applyAlertOff(`${token()}x`)).toEqual({ status: 'invalid' });
    const expired = createAlertOffToken(
      { profileId: PROFILE, savedSearchId: SEARCH },
      SECRET,
      Date.now() - (ALERT_OFF_TOKEN_TTL_SECONDS + 60) * 1000,
    );
    expect(await applyAlertOff(expired)).toEqual({ status: 'expired' });
    expect(fakeDb.calls).toHaveLength(0);

    fakeDb.rpc('saved_search_alert_unsubscribe', () => {
      throw pgError('08006', 'db down');
    });
    expect(await applyAlertOff(token())).toEqual({ status: 'error' });
    fakeSession.serviceConfigured = false;
    expect(await applyAlertOff(token())).toEqual({ status: 'unavailable' });
    delete process.env.EMAIL_UNSUBSCRIBE_SECRET;
    expect(await applyAlertOff('a1.a.b')).toEqual({ status: 'unavailable' });
    expect(inspectAlertOffToken('a1.a.b')).toEqual({ status: 'unavailable' });
  });
});

describe('zmiana nazwy wyszukiwania', () => {
  const ID = SEARCH;
  beforeEach(() => {
    resetFakeDb({ id: PROFILE, role: 'candidate' } as PortalIdentity);
  });

  it('RPC pod sesją z przyciętą nazwą', async () => {
    fakeDb.rpc('rename_saved_search', 'Magazyn nocny');
    expect(await renameSavedSearchAction(ID, '  Magazyn nocny  ')).toEqual({ ok: true });
    expect(fakeDb.callsTo('rename_saved_search')).toEqual([
      expect.objectContaining({ args: { p_saved_search_id: ID, p_name: 'Magazyn nocny' }, as: PROFILE }),
    ]);
  });

  it('pusta, za długa, ze znakiem sterującym, zły id → VALIDATION_FAILED bez zapytania', async () => {
    for (const name of ['   ', 'x'.repeat(81), 'a\u0007b', 'a\nb', 42]) {
      expect(await renameSavedSearchAction(ID, name)).toEqual({ ok: false, error: 'VALIDATION_FAILED' });
    }
    expect(await renameSavedSearchAction('nie-uuid', 'Ok')).toEqual({ ok: false, error: 'VALIDATION_FAILED' });
    expect(fakeDb.calls).toHaveLength(0);
    // Granica: dokładnie 80 znaków przechodzi.
    fakeDb.rpc('rename_saved_search', 'x'.repeat(80));
    expect(await renameSavedSearchAction(ID, 'x'.repeat(80))).toEqual({ ok: true });
  });

  it('cudze → NOT_FOUND; brak sesji → PERMISSION_DENIED; demo → DEMO_UNAVAILABLE; technikalia ukryte', async () => {
    fakeDb.rpc('rename_saved_search', () => {
      throw pgError('P0002', 'NOT_FOUND: wyszukiwanie nie istnieje');
    });
    expect(await renameSavedSearchAction(ID, 'X')).toEqual({ ok: false, error: 'NOT_FOUND' });
    fakeDb.rpc('rename_saved_search', () => {
      throw pgError('42P01', 'relation "saved_searches" does not exist');
    });
    expect(await renameSavedSearchAction(ID, 'X')).toEqual({ ok: false, error: 'INTERNAL' });
    fakeSession.identity = null;
    expect(await renameSavedSearchAction(ID, 'X')).toEqual({ ok: false, error: 'PERMISSION_DENIED' });
    fakeSession.configured = false;
    expect(await renameSavedSearchAction(ID, 'X')).toEqual({ ok: false, error: 'DEMO_UNAVAILABLE' });
  });

  it('limit długości zgodny z bazą (0092/0108: 1–80, bez znaków sterujących)', () => {
    expect(MIGRATION).toMatch(/char_length\(v_name\) not between 1 and 80 or v_name ~ '\[\[:cntrl:\]\]'/);
    expect(MIGRATION).toMatch(/grant execute on function public\.rename_saved_search\(uuid, text\) to authenticated/);
    expect(MIGRATION).toMatch(
      /revoke all on function public\.saved_search_alert_unsubscribe\(uuid, uuid\) from public, anon, authenticated/,
    );
  });
});

describe('e-mail jobMatch: link „wyłącz tylko ten alert”', () => {
  it('link w każdym języku odbiorcy, tylko z opcji workera', async () => {
    for (const locale of ['pl', 'nl', 'fr', 'en'] as const) {
      const url = `${SITE}/${locale}/wypisz-alert#t=tok`;
      const out = await renderEmail(
        'jobMatch',
        locale,
        { searchName: 'Magazyn', count: 1, actionUrl: `${SITE}/${locale}/candidate/wyszukiwania` },
        { alertOffUrl: url },
      );
      expect(out.html).toContain(jobMatchAlertOffLabel[locale]);
      expect(out.html).toContain(url);
      expect(out.text).toContain(url);
    }
  });

  it('KONTROLA UJEMNA: payload kolejki nie podstawi własnego linku', async () => {
    const out = await renderEmail('jobMatch', 'pl', {
      searchName: 'Magazyn',
      count: 1,
      actionUrl: `${SITE}/pl/candidate/wyszukiwania`,
      alertOffUrl: 'https://evil.example/off',
    });
    expect(out.html).not.toContain('evil.example');
    expect(out.html).not.toContain(jobMatchAlertOffLabel.pl);
  });
});

describe('worker: link alertu i kontrola tuż przed wysyłką', () => {
  function row(id: string, template: string, extra: Record<string, unknown> = {}) {
    return {
      id,
      profile_id: PROFILE,
      to_email: `${id}@example.test`,
      template,
      locale: 'fr',
      payload: { searchName: 'Entrepôt', count: 2, jobs: [], companyName: 'Acme', jobTitle: 'Chauffeur' },
      attempts: 0,
      ...extra,
    };
  }
  function mockQueue(rows: unknown[], check: (id: string) => string | null = () => null) {
    fakeDb.rpc('claim_email_batch', rows);
    fakeDb.rpc('email_delivery_send_check', ({ args }: { args: Record<string, unknown> }) =>
      check(String(args['p_delivery_id'])),
    );
    fakeDb.rpc('take_email_send_budget', [{ granted: true, retry_at: null }]);
  }

  it('digest wyszukiwania: link w języku odbiorcy z tokenem tego alertu (bez e-maila)', async () => {
    mockQueue([row('d1', 'jobMatch', { entity_type: 'saved_search', entity_id: SEARCH })]);
    const { processEmailQueue } = await import('@/lib/email/outbox');
    expect(await processEmailQueue()).toMatchObject({ sent: 1, suppressed: 0 });
    const html = send.mock.calls[0]![0].html as string;
    const match = /https:\/\/pracuj\.be\/fr\/wypisz-alert#t=([^"&]+)/.exec(html);
    expect(match).not.toBeNull();
    const verified = verifyAlertOffToken(decodeURIComponent(match![1]!), SECRET);
    expect(verified).toMatchObject({ ok: true, profileId: PROFILE, savedSearchId: SEARCH });
    expect(match![0]).not.toContain('d1@example.test');
    expect(html).toContain(jobMatchAlertOffLabel.fr);
  });

  it('inne maile i jobMatch bez wyszukiwania → bez linku alertu', async () => {
    mockQueue([
      row('d1', 'jobOffer', { entity_type: 'saved_search', entity_id: SEARCH }),
      row('d2', 'jobMatch', { entity_type: 'job', entity_id: SEARCH }),
      row('d3', 'jobMatch', { entity_type: 'saved_search', entity_id: 'nie-uuid' }),
    ]);
    const { processEmailQueue } = await import('@/lib/email/outbox');
    expect(await processEmailQueue()).toMatchObject({ sent: 3 });
    for (const [message] of send.mock.calls) expect(message.html).not.toContain('/wypisz-alert');
  });

  it('wypisanie po claimie: kontrola tuż przed wysyłką zatrzymuje wiersz (bez budżetu i bez send)', async () => {
    mockQueue(
      [row('d1', 'jobMatch', { entity_type: 'saved_search', entity_id: SEARCH }), row('d2', 'jobOffer')],
      (id) => (id === 'd1' ? 'suppressed_alert_disabled' : null),
    );
    const { processEmailQueue } = await import('@/lib/email/outbox');
    expect(await processEmailQueue()).toMatchObject({ processed: 2, sent: 1, failed: 0, suppressed: 1, ok: true });
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]![0].to).toBe('d2@example.test');
    expect(fakeDb.callsTo('email_delivery_send_check').map((c) => c.args)).toEqual([
      { p_delivery_id: 'd1' },
      { p_delivery_id: 'd2' },
    ]);
    expect(fakeDb.callsTo('email_delivery_send_check').every((c) => c.as === 'service')).toBe(true);
    expect(fakeDb.callsTo('take_email_send_budget')).toHaveLength(1);
    // Wiersz wygasza baza (email_delivery_send_check) — worker nie zapisuje porażki ani wysyłki.
    expect(fakeDb.calls.filter((c) => c.kind === 'exec').map((c) => c.values[0])).toEqual(['d2']);
  });

  it('KONTROLA UJEMNA: bez przyczyny wygaszenia ten sam wiersz wychodzi', async () => {
    mockQueue([row('d1', 'jobMatch', { entity_type: 'saved_search', entity_id: SEARCH })]);
    const { processEmailQueue } = await import('@/lib/email/outbox');
    expect(await processEmailQueue()).toMatchObject({ sent: 1, suppressed: 0 });
  });

  it('błąd kontroli → brak wysyłki, wiersz wraca do ponowienia (attempts + 1)', async () => {
    mockQueue([row('d1', 'jobMatch', { entity_type: 'saved_search', entity_id: SEARCH })], () => {
      throw pgError('08006', 'db down');
    });
    const { processEmailQueue } = await import('@/lib/email/outbox');
    expect(await processEmailQueue()).toMatchObject({ sent: 0, failed: 1 });
    expect(send).not.toHaveBeenCalled();
    const failed = fakeDb.callsTo('email.outbox.mark-failed')[0]!;
    expect(failed.values.slice(0, 3)).toEqual(['d1', 'queued', 1]);
  });
});
