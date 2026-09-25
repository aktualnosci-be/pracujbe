import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * #100 — zapisane wyszukiwania i alerty o nowych ofertach.
 *
 * - filtry zapisu = te same argumenty `get_public_jobs`, które wysyła lista (jedno źródło),
 * - lustro kluczy filtrów TS ↔ kanonizacja SQL (0092),
 * - akcje: walidacja, tryb demo, brak sesji → link logowania, limit, błąd bez technikaliów,
 * - e-mail `jobMatch`: CTA i adresy ofert w locale ODBIORCY, zły slug pominięty, 4 języki,
 * - powiadomienie in-app prowadzi do zarządzania wyszukiwaniami.
 * Zachowanie bazy (izolacja, idempotencja, opt-out) — `supabase/tests/rls.sql` sekcja SS100.
 */

vi.mock('@/lib/error-report', () => ({ captureError: vi.fn() }));
vi.mock('@/lib/db/portal', async () => (await import('../helpers/fake-db')).fakePortal());
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import type { PortalIdentity } from '@/lib/auth/session';
import { fakeDb, fakeSession, pgError, resetFakeDb } from '../helpers/fake-db';
import type { Locale } from '@/i18n/routing';
import {
  hasSavedSearchFilters,
  parseJobListQuery,
  savedSearchFiltersFromQuery,
  savedSearchQueryString,
} from '@/lib/job-list-query';
import {
  deleteSavedSearchAction,
  saveSearchAction,
  setSavedSearchAlertsAction,
} from '@/lib/actions/saved-searches';
import { renderEmail } from '@/emails/templates';
import { buildDeliveryData, deliveryJobMatchJobs } from '@/lib/email/delivery-data';
import { resolveHref, titleKeyForType } from '@/lib/data/notifications';
import { loadMySavedSearches, mapSavedSearchRow } from '@/lib/data/saved-searches';

const USER = '11111111-1111-4111-8111-111111111111';

const MIGRATION = readFileSync(
  resolve(__dirname, '../../supabase/migrations/0092_saved_search_alerts.sql'),
  'utf8',
);
const LOCALES: readonly Locale[] = ['pl', 'nl', 'fr', 'en'];
const NOW = Date.parse('2026-09-24T10:00:00Z');

describe('filtry listy → zapisane wyszukiwanie', () => {
  it('te same argumenty SQL co lista, bez świeżości (date)', () => {
    const query = parseJobListQuery(
      {
        keyword: ' magazynier ',
        category: 'warehouse,production',
        contractType: 'permanent',
        salaryMin: '2000',
        salaryMax: '3000',
        accommodation: 'provided',
        immediate: '1',
        noLang: '1',
        date: '7d',
        sort: 'salary',
        page: '3',
      },
      'pl',
      NOW,
    );
    expect(query.filterParams.since).toBe(new Date(NOW - 7 * 86_400_000).toISOString());
    expect(savedSearchFiltersFromQuery(query)).toEqual({
      keyword: 'magazynier',
      categories: ['warehouse', 'production'],
      contractTypes: ['permanent'],
      salaryMin: 2000,
      salaryMax: 3000,
      accommodation: true,
      immediate: true,
      noLanguage: true,
    });
    const qs = savedSearchQueryString(query);
    expect(qs.startsWith('?')).toBe(true);
    expect(qs).not.toContain('date=');
    expect(qs).not.toContain('page=');
  });

  it('miasto z innej wersji językowej → dokładne aliasy, jak w zapytaniu listy (#189)', () => {
    const query = parseJobListQuery({ city: 'Antwerpen' }, 'pl', NOW);
    const filters = savedSearchFiltersFromQuery(query);
    expect(filters.city).toBeUndefined();
    expect(filters.locations).toEqual(query.filterParams.locations);
    expect(filters.locations?.length).toBeGreaterThan(1);
  });

  it('bez filtrów nie ma czego zapisać (kontrola ujemna: sama data i sort)', () => {
    const query = parseJobListQuery({ date: '24h', sort: 'salary' }, 'pl', NOW);
    expect(hasSavedSearchFilters(savedSearchFiltersFromQuery(query))).toBe(false);
  });

  it('lustro: klucze filtrów w TS = allow-lista kanonizacji w SQL', () => {
    const match = MIGRATION.match(/where k not in \(([^)]*)\)/s);
    const sqlKeys = [...(match?.[1] ?? '').matchAll(/'([A-Za-z]+)'/g)].map((m) => m[1]).sort();
    const full = savedSearchFiltersFromQuery(
      parseJobListQuery(
        {
          keyword: 'a',
          city: 'NieznaneMiasto',
          category: 'warehouse',
          location: 'Liège',
          contractType: 'permanent',
          salaryUnit: 'hour',
          salaryMin: '15',
          salaryMax: '30',
          accommodation: 'provided',
          immediate: '1',
          noLang: '1',
        },
        'pl',
        NOW,
      ),
    );
    expect(Object.keys(full).sort()).toEqual(sqlKeys);
  });

  it('jednostka godzinowa (0091) trafia do zapisu tylko przy widełkach, jak do zapytania listy', () => {
    const hourly = parseJobListQuery({ salaryUnit: 'hour', salaryMin: '15', salaryMax: '30' }, 'pl', NOW);
    expect(hourly.filterParams.salaryUnit).toBe('hour');
    expect(savedSearchFiltersFromQuery(hourly)).toEqual({ salaryMin: 15, salaryMax: 30, salaryUnit: 'hour' });
    expect(savedSearchQueryString(hourly)).toContain('salaryUnit=hour');
    // Kontrola ujemna: sama jednostka bez widełek niczego nie zawęża — nie ma czego zapisać.
    const unitOnly = parseJobListQuery({ salaryUnit: 'hour' }, 'pl', NOW);
    expect(hasSavedSearchFilters(savedSearchFiltersFromQuery(unitOnly))).toBe(false);
  });
});

describe('akcje zapisanych wyszukiwań', () => {
  const input = {
    name: 'Magazynier · Liège',
    locale: 'pl',
    filters: { keyword: 'magazynier', categories: ['warehouse'] },
    query: '?keyword=magazynier&category=warehouse',
  };

  beforeEach(() => {
    resetFakeDb({ id: USER, role: 'candidate' } as PortalIdentity);
  });

  /** Kolejne odpowiedzi RPC: wartość albo błąd bazy (komunikat). */
  function replies(fn: string, ...values: Array<unknown | { fail: string }>) {
    let index = 0;
    fakeDb.rpc(fn, () => {
      const value = values[Math.min(index++, values.length - 1)];
      if (value && typeof value === 'object' && 'fail' in value) throw pgError('P0001', String(value.fail));
      return value;
    });
  }

  it('zapis woła RPC z filtrami (jsonb) pod sesją i zwraca created', async () => {
    replies('save_saved_search', [{ saved_search_id: 'id-1', created: true }]);
    expect(await saveSearchAction(input)).toEqual({ ok: true, id: 'id-1', created: true });
    const call = fakeDb.callsTo('save_saved_search')[0]!;
    expect(call).toMatchObject({ kind: 'rpcrows', as: USER });
    expect({ ...call.args, p_filters: JSON.parse(String(call.args['p_filters'])) }).toEqual({
      p_name: input.name,
      p_locale: 'pl',
      p_filters: input.filters,
      p_query: input.query,
      p_frequency: 'daily',
    });
  });

  it('istniejące wyszukiwanie → created=false (bez duplikatu)', async () => {
    replies('save_saved_search', [{ saved_search_id: 'id-1', created: false }]);
    expect(await saveSearchAction(input)).toEqual({ ok: true, id: 'id-1', created: false });
  });

  it('bez sesji → UNAUTHENTICATED; inna rola → PERMISSION_DENIED; limit → własny kod', async () => {
    fakeSession.identity = null;
    expect(await saveSearchAction(input)).toEqual({ ok: false, error: 'UNAUTHENTICATED' });
    expect(fakeDb.calls).toHaveLength(0);
    fakeSession.identity = { id: USER, role: 'candidate' } as PortalIdentity;
    replies(
      'save_saved_search',
      { fail: 'UNAUTHENTICATED' },
      { fail: 'PERMISSION_DENIED: tylko kandydat' },
      { fail: 'SAVED_SEARCH_LIMIT_REACHED: 20' },
      { fail: 'relation "x" does not exist' },
    );
    expect(await saveSearchAction(input)).toEqual({ ok: false, error: 'UNAUTHENTICATED' });
    expect(await saveSearchAction(input)).toEqual({ ok: false, error: 'PERMISSION_DENIED' });
    expect(await saveSearchAction(input)).toEqual({ ok: false, error: 'SAVED_SEARCH_LIMIT_REACHED' });
    expect(await saveSearchAction(input)).toEqual({ ok: false, error: 'INTERNAL' });
  });

  it('nieznany filtr, puste filtry, zły adres → VALIDATION_FAILED bez zapytania', async () => {
    expect(await saveSearchAction({ ...input, filters: { since: 'x' } })).toEqual({
      ok: false,
      error: 'VALIDATION_FAILED',
    });
    expect(await saveSearchAction({ ...input, filters: {} })).toEqual({ ok: false, error: 'VALIDATION_FAILED' });
    expect(await saveSearchAction({ ...input, query: 'https://evil.example' })).toEqual({
      ok: false,
      error: 'VALIDATION_FAILED',
    });
    expect(fakeDb.calls).toHaveLength(0);
  });

  it('tryb demo nic nie zapisuje (bez udawanego sukcesu)', async () => {
    fakeSession.configured = false;
    expect(await saveSearchAction(input)).toEqual({ ok: false, error: 'DEMO_UNAVAILABLE' });
    expect(fakeDb.calls).toHaveLength(0);
  });

  it('przełącznik alertu i usunięcie: UUID + RPC; cudze → NOT_FOUND', async () => {
    const id = '6f1c2a4e-1b2c-4d5e-8f90-123456789abc';
    replies('set_saved_search_alerts', false);
    expect(await setSavedSearchAlertsAction(id, false, 'weekly')).toEqual({ ok: true });
    expect(fakeDb.callsTo('set_saved_search_alerts')[0]!.args).toEqual({
      p_saved_search_id: id,
      p_enabled: false,
      p_frequency: 'weekly',
    });
    expect(await setSavedSearchAlertsAction('nie-uuid', true, 'daily')).toEqual({
      ok: false,
      error: 'VALIDATION_FAILED',
    });
    expect(await setSavedSearchAlertsAction(id, true, 'hourly')).toEqual({ ok: false, error: 'VALIDATION_FAILED' });
    replies('delete_saved_search', { fail: 'NOT_FOUND: wyszukiwanie nie istnieje' });
    expect(await deleteSavedSearchAction(id)).toEqual({ ok: false, error: 'NOT_FOUND' });
  });

  it('lista: tylko własne wyszukiwania (profil z sesji), błąd ≠ pusta lista', async () => {
    fakeDb.rows('saved-searches.mine', [{ id: 's1', name: 'n', query: '?keyword=x', frequency: 'daily', alerts_enabled: true }]);
    expect(await loadMySavedSearches()).toMatchObject({ status: 'ready', demo: false, searches: [{ id: 's1', alertsEnabled: true }] });
    expect(fakeDb.callsTo('saved-searches.mine')[0]).toMatchObject({ values: [USER], as: USER });
    fakeDb.rows('saved-searches.mine', () => { throw pgError('XX000', 'boom'); });
    expect(await loadMySavedSearches()).toEqual({ status: 'error' });
    fakeSession.configured = false;
    expect(await loadMySavedSearches()).toEqual({ status: 'ready', searches: [], demo: true });
  });
});

describe('e-mail jobMatch', () => {
  const payload = {
    searchName: 'Magazynier · Liège',
    count: 7,
    jobs: [
      { title: 'Magasinier de nuit', companyName: 'Acme', city: 'Liège', slug: 'magazynier-nocny' },
      { title: 'Wstrzyknięcie', slug: '../../admin' },
      { title: '', slug: 'pusty-tytul' },
    ],
  };

  it('CTA do zarządzania wyszukiwaniami i adresy ofert w locale odbiorcy; zły slug pominięty', () => {
    const { data } = buildDeliveryData({ template: 'jobMatch', locale: 'fr', payload }, 'https://pracuj.be/');
    expect(data['actionUrl']).toBe('https://pracuj.be/fr/candidate/wyszukiwania');
    expect(data['jobs']).toEqual([
      {
        title: 'Magasinier de nuit',
        companyName: 'Acme',
        city: 'Liège',
        url: 'https://pracuj.be/fr/oferty-pracy/magazynier-nocny',
      },
    ]);
  });

  it('najwyżej 5 ofert w treści', () => {
    const many = { jobs: Array.from({ length: 9 }, (_, i) => ({ title: `Oferta ${i}`, slug: `oferta-${i}` })) };
    expect(deliveryJobMatchJobs(many, 'https://pracuj.be', 'pl')).toHaveLength(5);
  });

  it.each(LOCALES)('renderuje temat i treść w języku odbiorcy (%s)', async (locale) => {
    const { data } = buildDeliveryData({ template: 'jobMatch', locale, payload }, 'https://pracuj.be');
    const { subject, html } = await renderEmail('jobMatch', locale, data as never);
    expect(subject).toContain('Magazynier · Liège');
    expect(html).toContain(`https://pracuj.be/${locale}/oferty-pracy/magazynier-nocny`);
    expect(html).toContain('Magasinier de nuit');
    expect(html).toContain('7');
    expect(html).not.toContain('../../admin');
  });

  it('tematy różnią się między językami (brak treści w języku nadawcy)', async () => {
    const subjects = await Promise.all(
      LOCALES.map(async (locale) => {
        const { data } = buildDeliveryData({ template: 'jobMatch', locale, payload }, 'https://pracuj.be');
        return (await renderEmail('jobMatch', locale, data as never)).subject;
      }),
    );
    expect(new Set(subjects).size).toBe(LOCALES.length);
  });
});

describe('powiadomienie in-app i odczyt listy', () => {
  it('alert wyszukiwania → własny tytuł i strona zarządzania', () => {
    expect(titleKeyForType('job_match', { kind: 'saved_search' }, 'saved_search')).toBe('itemSavedSearch');
    expect(titleKeyForType('job_match', {}, 'job')).toBe('itemJobMatch');
    expect(resolveHref('saved_search', 'candidate', 'x')).toBe('/candidate/wyszukiwania');
  });

  it('adres wyszukiwania linkujemy tylko jako query (`?…`)', () => {
    expect(mapSavedSearchRow({ id: 'a', name: 'n', query: '?keyword=x', frequency: 'weekly' })).toMatchObject({
      query: '?keyword=x',
      frequency: 'weekly',
    });
    expect(mapSavedSearchRow({ id: 'a', name: 'n', query: '//evil.example/x' })?.query).toBe('');
    expect(mapSavedSearchRow({ name: 'bez id' })).toBeNull();
  });
});
