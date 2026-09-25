import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { activateEmailCampaign, cancelEmailCampaign } from '@/lib/actions/admin-campaigns';
import {
  CAMPAIGN_RECIPIENT_KEY,
  CAMPAIGN_STATUSES,
  CAMPAIGN_STATUS_KEY,
  campaignPreview,
  campaignSendingReady,
  campaignStatusesFor,
  canActivateCampaign,
  canCancelCampaign,
  parseCampaignFilter,
  recipientStatsOf,
} from '@/lib/admin/campaigns';
import { AUDIT_ACTION_KEY, AUDIT_ENTITY_TYPES } from '@/lib/admin/list-params';
import { getEmailCampaign, listEmailCampaigns } from '@/lib/data/admin-campaigns';
import { fakeDb, fakeSession, pgError, resetFakeDb } from '../helpers/fake-db';

/**
 * #45 (otwarte) — panel admina kampanii e-mail: reguły (lustro RPC 0108), gotowość nadawcy,
 * podgląd treści w każdym języku, akcje pod sesją admina (CAS statusu) i odczyt service-rolem
 * dopiero po potwierdzeniu roli. Kontrole ujemne: brak nadawcy = brak RPC aktywacji,
 * brak nadawcy = brak kolejkowania w harmonogramie.
 */

vi.mock('@/lib/db/portal', async () => (await import('../helpers/fake-db')).fakePortal());
vi.mock('next/navigation', () => ({
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
}));
vi.mock('@/lib/sentry', () => ({ captureError: vi.fn() }));
vi.mock('@/lib/env', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/env')>()),
  isProductionMode: vi.fn(() => true),
}));

const CAMPAIGN_ID = '7c0e8f4c-2b1d-4c3e-9f7a-1d2e3f4a5b6c';
const ADMIN_ID = '00000000-0000-4000-8000-00000000a001';
const MIGRATION = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/0108_admin_email_campaigns.sql'),
  'utf8',
);
const MESSAGES = Object.fromEntries(
  ['pl', 'nl', 'fr', 'en'].map((l) => [
    l,
    (JSON.parse(readFileSync(resolve(process.cwd(), 'src/messages', `${l}.json`), 'utf8')) as {
      admin: Record<string, string>;
    }).admin,
  ]),
);

const SENDER_ENV = {
  EMAIL_FROM: 'Pracuj.be <news@example.test>',
  EMAIL_SENDER_IDENTITY: 'Operator testowy',
  EMAIL_SENDER_POSTAL_ADDRESS: 'Rue de Test 1, 1000 Bruxelles',
  EMAIL_UNSUBSCRIBE_SECRET: 'x'.repeat(40),
};

function stubSender(values: Partial<typeof SENDER_ENV> = SENDER_ENV) {
  for (const key of Object.keys(SENDER_ENV) as Array<keyof typeof SENDER_ENV>) {
    vi.stubEnv(key, values[key] ?? '');
  }
}

function jobsIn(locale: string) {
  return { jobs: [{ slug: `job-${locale}`, title: `Title ${locale}`, city: 'Gent', locale, isDemo: false }] };
}
const FULL_CONTENT = { pl: jobsIn('pl'), nl: jobsIn('nl'), fr: jobsIn('fr'), en: jobsIn('en') };

beforeEach(() => {
  vi.clearAllMocks();
  resetFakeDb(null);
  stubSender();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('reguły statusów (lustro RPC 0108)', () => {
  it('aktywacja tylko szkicu, zatrzymanie szkicu/aktywnej/zakończonej', () => {
    expect(CAMPAIGN_STATUSES.filter(canActivateCampaign)).toEqual(['draft']);
    expect(CAMPAIGN_STATUSES.filter(canCancelCampaign)).toEqual(['draft', 'active', 'completed']);
    expect(MIGRATION).toContain("if v_row.status <> 'draft' then");
    expect(MIGRATION).toContain("if v_row.status not in ('draft', 'active', 'completed') then");
  });

  it('RPC admina: is_admin(), CAS statusu, audyt, grant tylko dla authenticated', () => {
    for (const fn of ['admin_activate_email_campaign', 'admin_cancel_email_campaign']) {
      expect(MIGRATION).toContain(`revoke all on function public.${fn}(uuid, text) from public;`);
      expect(MIGRATION).toContain(`grant execute on function public.${fn}(uuid, text) to authenticated;`);
    }
    expect(MIGRATION.match(/if not public\.is_admin\(\)/g)).toHaveLength(2);
    expect(MIGRATION.match(/is distinct from p_expected_status then\s+raise exception 'STALE_STATE/g)).toHaveLength(2);
    expect(MIGRATION).toContain("write_audit('email_campaign.activated'");
    expect(MIGRATION).toContain("write_audit('email_campaign.cancelled'");
  });

  it('filtr listy: nieznany → wszystkie; zamknięte = zakończone + zastąpione + zatrzymane', () => {
    expect(parseCampaignFilter('x')).toBe('all');
    expect(campaignStatusesFor('all')).toBeNull();
    expect(campaignStatusesFor('closed')).toEqual(['completed', 'superseded', 'cancelled']);
    expect(campaignStatusesFor('draft')).toEqual(['draft']);
  });

  it('liczniki odbiorców: komplet statusów, nieznany tylko w sumie', () => {
    expect(
      recipientStatsOf([
        { status: 'delivered', n: 5 },
        { status: 'queued', n: '2' },
        { status: 'coś-nowego', n: 1 },
      ]),
    ).toMatchObject({ delivered: 5, queued: 2, failed: 0, total: 8 });
  });

  it('dziennik: akcje i typ obiektu mają etykiety; klucze i18n we wszystkich językach', () => {
    expect(AUDIT_ENTITY_TYPES).toContain('email_campaign');
    const keys = [
      AUDIT_ACTION_KEY['email_campaign.activated']!,
      AUDIT_ACTION_KEY['email_campaign.cancelled']!,
      ...Object.values(CAMPAIGN_STATUS_KEY),
      ...Object.values(CAMPAIGN_RECIPIENT_KEY),
      'entityEmailCampaign',
      'navCampaigns',
    ];
    for (const locale of Object.keys(MESSAGES)) {
      for (const key of keys) expect(MESSAGES[locale]![key], `${locale}.${key}`).toBeTruthy();
    }
  });
});

describe('gotowość wysyłki marketingu', () => {
  it('komplet nadawcy + sekret wypisania → gotowe', () => {
    expect(campaignSendingReady(SENDER_ENV)).toBe(true);
  });

  it('KONTROLA UJEMNA: brak dowolnej wartości albo za krótki sekret → niegotowe', () => {
    for (const key of Object.keys(SENDER_ENV) as Array<keyof typeof SENDER_ENV>) {
      expect(campaignSendingReady({ ...SENDER_ENV, [key]: undefined }), key).toBe(false);
    }
    expect(campaignSendingReady({ ...SENDER_ENV, EMAIL_UNSUBSCRIBE_SECRET: 'krótki' })).toBe(false);
  });
});

describe('podgląd treści', () => {
  it('każdy język serwisu, ta sama walidacja co worker', () => {
    const preview = campaignPreview(FULL_CONTENT);
    expect(preview.map((p) => p.locale)).toEqual(['pl', 'nl', 'fr', 'en']);
    expect(preview.every((p) => p.status === 'ok')).toBe(true);
  });

  it('KONTROLA UJEMNA: brak języka, zły język oferty, zły kształt → „niepoprawna”', () => {
    const { en: _en, ...withoutEn } = FULL_CONTENT;
    expect(campaignPreview(withoutEn).find((p) => p.locale === 'en')?.status).toBe('invalid');
    expect(
      campaignPreview({ ...FULL_CONTENT, nl: jobsIn('pl') }).find((p) => p.locale === 'nl')?.status,
    ).toBe('invalid');
    expect(campaignPreview(null).every((p) => p.status === 'invalid')).toBe(true);
    expect(campaignPreview({ ...FULL_CONTENT, fr: { jobs: [] } }).find((p) => p.locale === 'fr')?.status).toBe(
      'invalid',
    );
  });
});

describe('activateEmailCampaign / cancelEmailCampaign', () => {
  function mockSession(role: 'admin' | 'employer' | null, rpcError?: string) {
    resetFakeDb(role ? { id: ADMIN_ID, role } : null);
    for (const fn of ['admin_activate_email_campaign', 'admin_cancel_email_campaign']) {
      fakeDb.rpc(fn, () => {
        if (rpcError) throw pgError('P0001', rpcError);
        return null;
      });
    }
  }

  it('aktywacja: RPC pod sesją admina ze statusem widzianym przez admina (CAS)', async () => {
    mockSession('admin');
    await expect(activateEmailCampaign(CAMPAIGN_ID, 'draft')).resolves.toEqual({ ok: true });
    const [call] = fakeDb.callsTo('admin_activate_email_campaign');
    expect(call).toMatchObject({ as: ADMIN_ID, args: { p_campaign_id: CAMPAIGN_ID, p_expected_status: 'draft' } });
  });

  it('KONTROLA UJEMNA: bez nadawcy marketingu aktywacja odmawia bez wywołania bazy', async () => {
    mockSession('admin');
    stubSender({ ...SENDER_ENV, EMAIL_SENDER_POSTAL_ADDRESS: '' });
    await expect(activateEmailCampaign(CAMPAIGN_ID, 'draft')).resolves.toEqual({
      ok: false,
      error: 'VALIDATION_FAILED',
      reason: 'senderMissing',
    });
    expect(fakeDb.calls).toHaveLength(0);
    // Zatrzymanie działa także bez nadawcy.
    await expect(cancelEmailCampaign(CAMPAIGN_ID, 'active')).resolves.toEqual({ ok: true });
    expect(fakeDb.callsTo('admin_cancel_email_campaign')).toHaveLength(1);
  });

  it('zły identyfikator albo status → VALIDATION_FAILED bez RPC; bez sesji → PERMISSION_DENIED', async () => {
    mockSession('admin');
    await expect(activateEmailCampaign('nie-uuid', 'draft')).resolves.toEqual({ ok: false, error: 'VALIDATION_FAILED' });
    await expect(cancelEmailCampaign(CAMPAIGN_ID, 'paused')).resolves.toEqual({ ok: false, error: 'VALIDATION_FAILED' });
    expect(fakeDb.calls).toHaveLength(0);
    mockSession(null);
    await expect(cancelEmailCampaign(CAMPAIGN_ID, 'active')).resolves.toEqual({ ok: false, error: 'PERMISSION_DENIED' });
    expect(fakeDb.calls).toHaveLength(0);
  });

  it('błędy RPC → stabilne kody', async () => {
    mockSession('admin', 'STALE_STATE: rewizja zmieniła status');
    await expect(activateEmailCampaign(CAMPAIGN_ID, 'draft')).resolves.toEqual({ ok: false, error: 'STALE_STATE' });
    mockSession('admin', 'INVALID_TRANSITION: rewizja jest już zamknięta');
    await expect(cancelEmailCampaign(CAMPAIGN_ID, 'cancelled')).resolves.toEqual({ ok: false, error: 'INVALID_TRANSITION' });
    mockSession('employer', 'PERMISSION_DENIED');
    await expect(cancelEmailCampaign(CAMPAIGN_ID, 'active')).resolves.toEqual({ ok: false, error: 'PERMISSION_DENIED' });
  });

  it('tryb demo nic nie zapisuje', async () => {
    mockSession('admin');
    fakeSession.configured = false;
    await expect(cancelEmailCampaign('demo-k2', 'active')).resolves.toEqual({ ok: true, demo: true });
    expect(fakeDb.calls).toHaveLength(0);
  });
});

describe('odczyt listy i szczegółu', () => {
  it('bez roli admina → notFound przed odczytem service-role', async () => {
    resetFakeDb({ id: ADMIN_ID, role: 'employer' });
    await expect(listEmailCampaigns()).rejects.toThrow('NEXT_NOT_FOUND');
    await expect(getEmailCampaign(CAMPAIGN_ID)).rejects.toThrow('NEXT_NOT_FOUND');
    expect(fakeDb.calls).toHaveLength(0);
  });

  it('lista: service-role, filtr statusu i slugu, liczby odbiorców bez danych osobowych', async () => {
    resetFakeDb({ id: ADMIN_ID, role: 'admin' });
    fakeDb
      .rows('admin.email-campaigns', [
        {
          id: CAMPAIGN_ID,
          slug: 'newsletter-wrzesien',
          revision: 2,
          template: 'newsletter',
          status: 'active',
          created_at: '2026-09-24T10:00:00.000000+00:00',
          activated_at: '2026-09-24T10:05:00.000000+00:00',
          closed_at: null,
        },
      ])
      .rows('admin.email-campaign-recipients', [
        { campaign_id: CAMPAIGN_ID, status: 'delivered', n: 7 },
        { campaign_id: CAMPAIGN_ID, status: 'queued', n: 3 },
      ]);
    const result = await listEmailCampaigns({ status: 'closed', q: 'wrzesien' });
    const [list] = fakeDb.callsTo('admin.email-campaigns');
    expect(list!.as).toBe('service');
    expect(list!.text).toContain('status = ANY');
    expect(list!.values).toContainEqual(['completed', 'superseded', 'cancelled']);
    expect(list!.values).toContain('%wrzesien%');
    const [stats] = fakeDb.callsTo('admin.email-campaign-recipients');
    // Same liczby: w wyniku tylko kampania, status i licznik (bez profile_id / delivery_id).
    expect(stats!.text).toMatch(/SELECT campaign_id, status, count\(\*\)::int AS n\s+FROM/);
    expect(stats!.text).not.toMatch(/profile_id|delivery_id/);
    expect(result).toMatchObject({
      status: 'ok',
      rows: [{ id: CAMPAIGN_ID, revision: 2, status: 'active', recipients: { delivered: 7, queued: 3, total: 10 } }],
      nextCursor: null,
    });
  });

  it('szczegół: identyfikator spoza UUID → not_found bez zapytania; błąd bazy → error', async () => {
    resetFakeDb({ id: ADMIN_ID, role: 'admin' });
    await expect(getEmailCampaign('abc')).resolves.toEqual({ status: 'not_found' });
    expect(fakeDb.calls).toHaveLength(0);
    fakeDb.rows('admin.email-campaign', () => {
      throw pgError('57014', 'canceling statement');
    });
    await expect(getEmailCampaign(CAMPAIGN_ID)).resolves.toEqual({ status: 'error' });
  });

  it('demo: lista i szczegół bez bazy', async () => {
    fakeSession.configured = false;
    const list = await listEmailCampaigns({ status: 'draft' });
    expect(list.status === 'ok' && list.rows.map((r) => r.id)).toEqual(['demo-k3']);
    const detail = await getEmailCampaign('demo-k2');
    expect(detail.status === 'ok' && detail.campaign.revisions.map((r) => r.revision)).toEqual([2, 1]);
  });
});

describe('/api/maintenance — kolejkowanie kampanii tylko z nadawcą', () => {
  const TASKS = [
    'release_stale_discount_reservations',
    'release_stale_checkout_intents',
    'expire_due_jobs',
    'purge_guest_application_requests',
    'process_saved_search_alerts',
    'process_email_campaigns',
    'run_retention_purge',
  ];
  const request = () =>
    new Request('http://web.internal/api/maintenance', {
      method: 'POST',
      headers: { authorization: 'Bearer maintenance-secret' },
    });

  beforeEach(() => {
    resetFakeDb(null);
    for (const fn of TASKS) fakeDb.rpc(fn, 0);
    fakeDb.rpc('claim_storage_deletions', []);
    vi.stubEnv('MAINTENANCE_SECRET', 'maintenance-secret');
    vi.stubEnv('CRON_SECRET', '');
  });

  it('z kompletem nadawcy → process_email_campaigns', async () => {
    const { POST } = await import('@/app/api/maintenance/route');
    const res = await POST(request());
    expect(res.status).toBe(200);
    expect(fakeDb.callsTo('process_email_campaigns')).toHaveLength(1);
  });

  it('KONTROLA UJEMNA: bez nadawcy odbiorcy nie są rezerwowani, reszta zadań działa', async () => {
    stubSender({ ...SENDER_ENV, EMAIL_FROM: '' });
    const { POST } = await import('@/app/api/maintenance/route');
    const res = await POST(request());
    expect(res.status).toBe(200);
    expect(fakeDb.callsTo('process_email_campaigns')).toHaveLength(0);
    expect(fakeDb.callsTo('expire_due_jobs')).toHaveLength(1);
    expect(await res.json()).toMatchObject({ ok: true, campaignEmailsQueued: 0 });
  });
});
