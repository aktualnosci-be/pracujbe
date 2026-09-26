import { isValidElement, type ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import pl from '@/messages/pl.json';
import nl from '@/messages/nl.json';
import fr from '@/messages/fr.json';
import en from '@/messages/en.json';
import {
  adminBannerBackHref,
  adminBannerHref,
  parseAdminBannerCompany,
} from '@/lib/admin/campaign-banner-link';
import { fakeDb, fakeSession, resetFakeDb } from '../helpers/fake-db';

/**
 * Baner kampanii w panelu admina (`/admin/oferty/[id]/baner`, #175 „Otwarte”).
 *
 * Link w `/admin/firmy/[id]` tylko przy ofercie aktywnej; strona sama potwierdza rolę admina
 * (`requireAdmin` → `notFound()`) PRZED odczytem `get_managed_campaign_job`, więc nie-admin
 * dostaje 404 także wtedy, gdy baza zwróciłaby wiersz (kontrola ujemna). Admin dostaje dane
 * z RPC pod własną sesją; w trybie demo (bez bazy) — „baner niedostępny” bez odczytu.
 */

vi.mock('@/lib/db/portal', async () => (await import('../helpers/fake-db')).fakePortal());
vi.mock('next/navigation', () => ({
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
}));
vi.mock('@/lib/error-report', () => ({ captureError: vi.fn() }));
vi.mock('@/i18n/navigation', () => ({ Link: () => null }));
vi.mock('next-intl/server', () => ({
  setRequestLocale: vi.fn(),
  getTranslations: async (arg: string | { namespace: string }) => {
    const namespace = typeof arg === 'string' ? arg : arg.namespace;
    const messages = pl as unknown as Record<string, Record<string, string>>;
    return (key: string) => messages[namespace]?.[key] ?? key;
  },
}));

const { default: AdminCampaignBannerPage } = await import('@/app/[locale]/admin/oferty/[id]/baner/page');

const ADMIN_ID = '00000000-0000-4000-8000-00000000a001';
const EMPLOYER_ID = '00000000-0000-4000-8000-00000000e001';
const JOB_ID = '5c3a1f0e-1111-4000-8000-000000000001';
const COMPANY_ID = '7d2b0c1e-2222-4000-8000-000000000002';
const ROW = {
  slug: 'kierowca-c-e-gandawa',
  title: 'Kierowca C+E',
  company_name: 'Transport Gent BV',
  city: 'Gandawa',
  contract_type: 'permanent',
  accommodation: false,
  salary_min: 2900,
  salary_max: 3300,
  currency: 'EUR',
  salary_period: 'month',
};

type ViewProps = {
  loaded: { status: string; job?: { slug: string } };
  pagePath: string;
  query: Record<string, string>;
  backHref: string;
  backLabel: string;
  unavailableHint: string;
};

async function render(search: { jezyk?: string; firma?: string } = {}, id = JOB_ID): Promise<ViewProps> {
  const element = (await AdminCampaignBannerPage({
    params: Promise.resolve({ locale: 'pl', id }),
    searchParams: Promise.resolve(search),
  })) as ReactElement<ViewProps>;
  expect(isValidElement(element)).toBe(true);
  return element.props;
}

describe('adminBannerHref — link w szczególe firmy', () => {
  it('oferta aktywna → trasa admina z powrotem do firmy', () => {
    expect(adminBannerHref({ id: JOB_ID, status: 'active' }, COMPANY_ID)).toBe(
      `/admin/oferty/${JOB_ID}/baner?firma=${COMPANY_ID}`,
    );
  });

  it('kontrola ujemna: szkic, wstrzymana, zamknięta, wygasła → brak linku', () => {
    for (const status of ['draft', 'paused', 'closed', 'expired']) {
      expect(adminBannerHref({ id: JOB_ID, status }, COMPANY_ID)).toBeNull();
    }
  });

  it('nie prowadzi do surowego endpointu ani do panelu pracodawcy', () => {
    const href = adminBannerHref({ id: JOB_ID, status: 'active' }, COMPANY_ID) ?? '';
    expect(href).not.toMatch(/\/api\//);
    expect(href).not.toMatch(/\/employer\//);
  });

  it('niebezpieczny identyfikator (ścieżka, query) → brak linku / brak powrotu', () => {
    expect(adminBannerHref({ id: '../x', status: 'active' }, COMPANY_ID)).toBeNull();
    expect(adminBannerHref({ id: JOB_ID, status: 'active' }, 'a/b?c')).toBe(`/admin/oferty/${JOB_ID}/baner`);
    expect(parseAdminBannerCompany('//evil.example')).toBeNull();
    expect(parseAdminBannerCompany(undefined)).toBeNull();
    expect(adminBannerBackHref(null)).toBe('/admin/firmy');
    expect(adminBannerBackHref(COMPANY_ID)).toBe(`/admin/firmy/${COMPANY_ID}`);
  });
});

describe('/admin/oferty/[id]/baner', () => {
  beforeEach(() => {
    resetFakeDb({ id: ADMIN_ID, role: 'admin' });
    fakeDb.rpc('get_managed_campaign_job', [ROW]);
  });

  it('admin: dane z get_managed_campaign_job pod własną sesją, powrót do firmy', async () => {
    const props = await render({ jezyk: 'nl', firma: COMPANY_ID });
    expect(props.loaded).toMatchObject({ status: 'ok', job: { slug: ROW.slug } });
    expect(props.pagePath).toBe(`/admin/oferty/${JOB_ID}/baner`);
    expect(props.query).toEqual({ firma: COMPANY_ID });
    expect(props.backHref).toBe(`/admin/firmy/${COMPANY_ID}`);
    expect(props.backLabel).toBe(pl.campaignBanner.backToCompany);
    const call = fakeDb.calls.find((c) => c.name === 'get_managed_campaign_job');
    expect(call?.args).toMatchObject({ p_job_id: JOB_ID, p_locale: 'nl' });
    expect(call?.as).toBe(ADMIN_ID);
  });

  it('KONTROLA UJEMNA: pracodawca (nie-admin) → 404 bez odczytu, choć baza zwróciłaby wiersz', async () => {
    fakeSession.identity = { id: EMPLOYER_ID, role: 'employer' };
    await expect(render()).rejects.toThrow('NEXT_NOT_FOUND');
    expect(fakeDb.calls).toHaveLength(0);
  });

  it('KONTROLA UJEMNA: bez sesji → 404 bez odczytu', async () => {
    fakeSession.identity = null;
    await expect(render()).rejects.toThrow('NEXT_NOT_FOUND');
    expect(fakeDb.calls).toHaveLength(0);
  });

  it('oferta, której baza nie zwraca (nieaktywna/demo/wygasła) → „niedostępny”, komunikat admina', async () => {
    fakeDb.rpc('get_managed_campaign_job', []);
    const props = await render();
    expect(props.loaded).toEqual({ status: 'unavailable' });
    expect(props.unavailableHint).toBe(pl.campaignBanner.unavailableHintAdmin);
    expect(props.backHref).toBe('/admin/firmy');
  });

  it('identyfikator nie-UUID → „niedostępny” bez odczytu (nadal tylko dla admina)', async () => {
    const props = await render({}, 'demo-c2-job-1');
    expect(props.loaded).toEqual({ status: 'unavailable' });
    expect(fakeDb.calls.filter((c) => c.name === 'get_managed_campaign_job')).toHaveLength(0);
  });

  it('tryb demo (bez bazy) → „niedostępny” bez odczytu', async () => {
    fakeSession.configured = false;
    const props = await render();
    expect(props.loaded).toEqual({ status: 'unavailable' });
    expect(fakeDb.calls).toHaveLength(0);
  });
});

describe('klucze i18n', () => {
  it('nowe klucze w PL/NL/FR/EN', () => {
    for (const messages of [pl, nl, fr, en]) {
      expect(messages.campaignBanner.backToCompany).toBeTruthy();
      expect(messages.campaignBanner.unavailableHintAdmin).toBeTruthy();
      expect(messages.campaignBanner.openBannerLabel).toContain('{title}');
    }
  });
});
