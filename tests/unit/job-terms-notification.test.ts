import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getTranslations } from 'next-intl/server';

import en from '@/messages/en.json';
import fr from '@/messages/fr.json';
import nl from '@/messages/nl.json';
import pl from '@/messages/pl.json';
import type { PortalIdentity } from '@/lib/auth/session';
import { getNotificationsPage, resolveHref, titleKeyForType } from '@/lib/data/notifications';
import { fakeDb, resetFakeDb } from '../helpers/fake-db';

vi.mock('next-intl/server', () => ({ getTranslations: vi.fn() }));
vi.mock('@/lib/db/portal', async () => (await import('../helpers/fake-db')).fakePortal());
vi.mock('@/lib/error-report', () => ({ captureError: vi.fn() }));

/**
 * 0144: powiadomienie o istotnej zmianie warunków oferty, na którą kandydat aplikował.
 * Baza zapisuje tylko `data` (rodzaj, slug, pola); tytuł i link składa aplikacja.
 */

const JOB = '9b2f4c1e-7d3a-4f5b-8c6d-1e2f3a4b5c6d';
const DATA = { kind: 'job_terms_changed', slug: 'magazynier-gent-1', fields: ['salary'] };

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getTranslations).mockResolvedValue(((key: string) => key) as never);
});

describe('powiadomienie job_terms (0144)', () => {
  it('tytuł z klucza i18n, obecny w 4 językach i różny od ogólnego „system”', () => {
    expect(titleKeyForType('system', DATA, 'job_terms')).toBe('itemJobTermsChanged');
    for (const messages of [pl, nl, fr, en]) {
      expect(messages.notifications.itemJobTermsChanged).toMatch(/\S/);
      expect(messages.notifications.itemJobTermsChanged).not.toBe(messages.notifications.itemSystem);
    }
  });

  it('kandydat: link do publicznej oferty po slugu', () => {
    expect(resolveHref('job_terms', 'candidate', JOB, DATA)).toBe('/oferty-pracy/magazynier-gent-1');
  });

  it.each(['../candidate', '//evil.example', 'a?b=1', 'Magazynier', '', 'a'.repeat(201)])(
    'slug spoza formatu (%j) → historia zgłoszeń, nie dowolny adres',
    (slug) => {
      expect(resolveHref('job_terms', 'candidate', JOB, { ...DATA, slug })).toBe('/candidate/aplikacje');
    },
  );

  it('bez data (kontrola ujemna) → historia zgłoszeń; pracodawca → lista ofert', () => {
    expect(resolveHref('job_terms', 'candidate', JOB)).toBe('/candidate/aplikacje');
    expect(resolveHref('job_terms', 'employer', JOB, DATA)).toBe('/employer/oferty');
  });

  it('pełna lista przekazuje data z bazy do linku', async () => {
    resetFakeDb({ id: '11111111-1111-4111-8111-111111111111', role: 'candidate' } as PortalIdentity);
    fakeDb
      .rows('notifications.page', () => [{
        id: '00000000-0000-4000-8000-000000000001', type: 'system', entity_type: 'job_terms',
        entity_id: JOB, data: DATA, read_at: null, created_at: '2026-09-26T03:00:00.000000+00:00',
      }])
      .count('notifications.unread', () => 1);
    const result = await getNotificationsPage('pl');
    if (result.status !== 'ready') throw new Error('page');
    expect(result.page.items[0]).toMatchObject({
      title: 'itemJobTermsChanged',
      href: '/oferty-pracy/magazynier-gent-1',
    });
  });
});
