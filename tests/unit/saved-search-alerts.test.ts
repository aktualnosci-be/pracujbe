import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * #100 — zapisane wyszukiwania i alerty o nowych ofertach.
 *
 * - filtry zapisu = te same argumenty `get_public_jobs`, które wysyła lista (jedno źródło),
 * - lustro kluczy filtrów TS ↔ kanonizacja SQL (0093),
 * - akcje: walidacja, tryb demo, brak sesji → link logowania, limit, błąd bez technikaliów,
 * - e-mail `jobMatch`: CTA i adresy ofert w locale ODBIORCY, zły slug pominięty, 4 języki,
 * - powiadomienie in-app prowadzi do zarządzania wyszukiwaniami.
 * Zachowanie bazy (izolacja, idempotencja, opt-out) — `supabase/tests/rls.sql` sekcja SS100.
 */

const rpc = vi.fn();
vi.mock('@/lib/env', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/env')>()),
  isSupabaseConfigured: vi.fn(() => true),
}));
vi.mock('@/lib/sentry', () => ({ captureError: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createServerClient: async () => ({ rpc }) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { isSupabaseConfigured } from '@/lib/env';
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
import { mapSavedSearchRow } from '@/lib/data/saved-searches';

const MIGRATION = readFileSync(
  resolve(__dirname, '../../supabase/migrations/0093_saved_search_alerts.sql'),
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
          salaryMin: '2000',
          salaryMax: '3000',
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
});

describe('akcje zapisanych wyszukiwań', () => {
  const input = {
    name: 'Magazynier · Liège',
    locale: 'pl',
    filters: { keyword: 'magazynier', categories: ['warehouse'] },
    query: '?keyword=magazynier&category=warehouse',
  };

  beforeEach(() => {
    rpc.mockReset();
    vi.mocked(isSupabaseConfigured).mockReturnValue(true);
  });

  it('zapis woła RPC z filtrami i zwraca created', async () => {
    rpc.mockResolvedValue({ data: [{ saved_search_id: 'id-1', created: true }], error: null });
    expect(await saveSearchAction(input)).toEqual({ ok: true, id: 'id-1', created: true });
    expect(rpc).toHaveBeenCalledWith('save_saved_search', {
      p_name: input.name,
      p_locale: 'pl',
      p_filters: input.filters,
      p_query: input.query,
      p_frequency: 'daily',
    });
  });

  it('istniejące wyszukiwanie → created=false (bez duplikatu)', async () => {
    rpc.mockResolvedValue({ data: [{ saved_search_id: 'id-1', created: false }], error: null });
    expect(await saveSearchAction(input)).toEqual({ ok: true, id: 'id-1', created: false });
  });

  it('bez sesji → UNAUTHENTICATED; inna rola → PERMISSION_DENIED; limit → własny kod', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'UNAUTHENTICATED' } });
    expect(await saveSearchAction(input)).toEqual({ ok: false, error: 'UNAUTHENTICATED' });
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'PERMISSION_DENIED: tylko kandydat' } });
    expect(await saveSearchAction(input)).toEqual({ ok: false, error: 'PERMISSION_DENIED' });
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'SAVED_SEARCH_LIMIT_REACHED: 20' } });
    expect(await saveSearchAction(input)).toEqual({ ok: false, error: 'SAVED_SEARCH_LIMIT_REACHED' });
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'relation "x" does not exist' } });
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
    expect(rpc).not.toHaveBeenCalled();
  });

  it('tryb demo nic nie zapisuje (bez udawanego sukcesu)', async () => {
    vi.mocked(isSupabaseConfigured).mockReturnValue(false);
    expect(await saveSearchAction(input)).toEqual({ ok: false, error: 'DEMO_UNAVAILABLE' });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('przełącznik alertu i usunięcie: UUID + RPC; cudze → NOT_FOUND', async () => {
    const id = '6f1c2a4e-1b2c-4d5e-8f90-123456789abc';
    rpc.mockResolvedValue({ data: false, error: null });
    expect(await setSavedSearchAlertsAction(id, false, 'weekly')).toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledWith('set_saved_search_alerts', {
      p_saved_search_id: id,
      p_enabled: false,
      p_frequency: 'weekly',
    });
    expect(await setSavedSearchAlertsAction('nie-uuid', true, 'daily')).toEqual({
      ok: false,
      error: 'VALIDATION_FAILED',
    });
    expect(await setSavedSearchAlertsAction(id, true, 'hourly')).toEqual({ ok: false, error: 'VALIDATION_FAILED' });
    rpc.mockResolvedValue({ data: null, error: { message: 'NOT_FOUND: wyszukiwanie nie istnieje' } });
    expect(await deleteSavedSearchAction(id)).toEqual({ ok: false, error: 'NOT_FOUND' });
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
