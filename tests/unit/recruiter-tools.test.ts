import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PortalIdentity } from '@/lib/auth/session';
import { bulkTransitionApplications, transitionApplication } from '@/lib/actions/applications';
import { deleteMessageTemplate, saveMessageTemplate } from '@/lib/actions/message-templates';
import {
  BULK_TRANSITION_MAX,
  TRANSITION_RATE_LIMITS,
  parseApplicationStatusFilter,
  summarizeBulkOutcomes,
} from '@/lib/applications/bulk';
import { getExpectedActiveCompany } from '@/lib/company-context';
import { checkRateLimit } from '@/lib/rate-limit';
import {
  fillTemplate,
  findSensitiveVariant,
  messageTemplateSchema,
  pickTemplateVariant,
} from '@/lib/validation/message-template';
import { fakeDb, pgError, resetFakeDb } from '../helpers/fake-db';
// Alias: nazwa `use*` myli regułę react-hooks/rules-of-hooks (to nie hook Reacta, tylko beforeEach/afterEach).
import { useRecruitmentMode as recruitmentModeInTests } from '../helpers/portal-mode';

// Istniejące przepływy rekrutacyjne testowane w trybie RECRUITMENT (#1128, tryb ogłoszeniowy = domyślny).
recruitmentModeInTests();

/**
 * Narzędzia rekrutera (0170): limit zmiany statusu (LIM17-01), akcja zbiorcza przez
 * `bulk_transition_applications` z firmą widoku, szablony odpowiedzi z wariantem wg języka
 * kandydata (Invariant #1).
 */

vi.mock('@/lib/db/portal', async () => (await import('../helpers/fake-db')).fakePortal());
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: vi.fn(async () => true) }));
vi.mock('@/lib/error-report', () => ({ captureError: vi.fn() }));
vi.mock('@/lib/company-context', () => ({ getExpectedActiveCompany: vi.fn() }));

const USER = '11111111-1111-4111-8111-111111111111';
const COMPANY = '22222222-2222-4222-8222-222222222222';
const OTHER_COMPANY = '33333333-3333-4333-8333-333333333333';
const APP = (n: number) => `aaaaaaaa-aaaa-4aaa-8aaa-${String(n).padStart(12, '0')}`;
const TEMPLATE = '44444444-4444-4444-8444-444444444444';

beforeEach(() => {
  vi.clearAllMocks();
  resetFakeDb({ id: USER, role: 'employer' } as PortalIdentity);
  vi.mocked(checkRateLimit).mockResolvedValue(true);
  vi.mocked(getExpectedActiveCompany).mockImplementation(async (_tx, _uid, expected) =>
    expected === COMPANY
      ? {
          ok: true,
          context: { activeId: COMPANY, activeStatus: 'verified', activeName: 'Firma', activeRole: 'owner', companies: [] },
        }
      : { ok: false, error: 'ACTIVE_COMPANY_CHANGED' },
  );
  fakeDb.rpc('transition_application', null);
});

describe('transitionApplication: limiter LIM17-01', () => {
  it('sprawdza limit per konto i per konto × zgłoszenie przed RPC', async () => {
    expect(await transitionApplication(APP(1), 'shortlisted')).toEqual({ ok: true });
    expect(checkRateLimit).toHaveBeenCalledWith('application-status', {
      ...TRANSITION_RATE_LIMITS.perUser, identifier: USER, perIp: false,
    });
    expect(checkRateLimit).toHaveBeenCalledWith('application-status-item', {
      ...TRANSITION_RATE_LIMITS.perApplication, identifier: `${USER}:${APP(1)}`, perIp: false,
    });
  });

  it('przekroczony limit = RATE_LIMITED bez zmiany statusu', async () => {
    vi.mocked(checkRateLimit).mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    expect(await transitionApplication(APP(1), 'interview')).toEqual({ ok: false, error: 'RATE_LIMITED' });
    expect(fakeDb.callsTo('transition_application')).toHaveLength(0);
  });
});

describe('bulkTransitionApplications', () => {
  it('woła RPC z firmą widoku i zwraca wynik per zgłoszenie', async () => {
    fakeDb.rpc('bulk_transition_applications', [
      { application_id: APP(1), outcome: 'changed' },
      { application_id: APP(2), outcome: 'invalid_transition' },
      { application_id: APP(3), outcome: 'unexpected-value' },
    ]);
    const result = await bulkTransitionApplications([APP(1), APP(2), APP(3)], 'rejected', COMPANY);
    expect(result).toEqual({
      ok: true,
      results: [
        { applicationId: APP(1), outcome: 'changed' },
        { applicationId: APP(2), outcome: 'invalid_transition' },
        { applicationId: APP(3), outcome: 'error' },
      ],
    });
    expect(fakeDb.callsTo('bulk_transition_applications')[0]?.args).toMatchObject({
      p_company_id: COMPANY, p_target: 'rejected',
    });
    expect(checkRateLimit).toHaveBeenCalledWith('application-status-bulk', {
      ...TRANSITION_RATE_LIMITS.bulkPerUser, identifier: USER, perIp: false,
    });
  });

  it('inna firma niż aktywna (przełączenie w innej karcie) = ACTIVE_COMPANY_CHANGED, bez RPC', async () => {
    fakeDb.rpc('bulk_transition_applications', []);
    expect(await bulkTransitionApplications([APP(1)], 'rejected', OTHER_COMPANY)).toEqual({
      ok: false, error: 'ACTIVE_COMPANY_CHANGED',
    });
    expect(fakeDb.callsTo('bulk_transition_applications')).toHaveLength(0);
  });

  it('walidacja: pusta lista, duplikaty, ponad limit, status spoza menu', async () => {
    const many = Array.from({ length: BULK_TRANSITION_MAX + 1 }, (_, i) => APP(i + 1));
    for (const [ids, target] of [
      [[], 'rejected'],
      [[APP(1), APP(1)], 'rejected'],
      [many, 'rejected'],
      [[APP(1)], 'withdrawn'],
      [['nie-uuid'], 'rejected'],
    ] as const) {
      expect(await bulkTransitionApplications([...ids], target, COMPANY)).toEqual({ ok: false, error: 'VALIDATION_FAILED' });
    }
    expect(fakeDb.calls).toHaveLength(0);
  });

  it('limit operacji zbiorczych = RATE_LIMITED; błąd bazy bez technikaliów', async () => {
    vi.mocked(checkRateLimit).mockResolvedValueOnce(false);
    expect(await bulkTransitionApplications([APP(1)], 'rejected', COMPANY)).toEqual({ ok: false, error: 'RATE_LIMITED' });
    fakeDb.rpc('bulk_transition_applications', () => {
      throw pgError('42501', 'PERMISSION_DENIED: akcja zbiorcza wymaga roli recruiter+');
    });
    expect(await bulkTransitionApplications([APP(1)], 'rejected', COMPANY)).toEqual({ ok: false, error: 'PERMISSION_DENIED' });
  });

  it('raport liczy wyniki', () => {
    expect(summarizeBulkOutcomes([{ outcome: 'changed' }, { outcome: 'changed' }, { outcome: 'not_found' }])).toEqual({
      changed: 2, unchanged: 0, invalid_transition: 0, not_found: 1, permission_denied: 0, error: 0,
    });
  });

  it('filtr statusu z URL przyjmuje tylko znane statusy', () => {
    expect(parseApplicationStatusFilter('rejected')).toBe('rejected');
    expect(parseApplicationStatusFilter('draft')).toBeNull();
    expect(parseApplicationStatusFilter(['rejected'])).toBeNull();
    expect(parseApplicationStatusFilter("rejected' OR 1=1")).toBeNull();
  });
});

describe('szablony: wybór wariantu wg języka kandydata (Invariant #1)', () => {
  const template = { variants: { pl: 'Dzień dobry {imie}', nl: 'Hallo {imie}' } };

  it('wersja w języku kandydata = wstawienie', () => {
    expect(pickTemplateVariant(template, 'nl')).toEqual({ status: 'match', locale: 'nl', body: 'Hallo {imie}' });
  });

  it('brak wersji w języku kandydata = informacja dla rekrutera, nie cichy inny język', () => {
    expect(pickTemplateVariant(template, 'fr')).toEqual({ status: 'missing', candidateLocale: 'fr', available: ['pl', 'nl'] });
    expect(pickTemplateVariant(template, null)).toEqual({ status: 'missing', candidateLocale: null, available: ['pl', 'nl'] });
  });

  it('kontrola ujemna: naiwny wybór „pierwszy dostępny” dałby polski kandydatowi FR', () => {
    const naive = Object.values(template.variants)[0];
    expect(naive).toBe('Dzień dobry {imie}');
    expect(pickTemplateVariant(template, 'fr').status).toBe('missing');
  });

  it('zmienne: wypełnia znane wartości, pusta zostawia znacznik', () => {
    expect(fillTemplate('Hej {imie}, {stanowisko} w {firma}', { imie: 'Ana', stanowisko: 'Magazynier', firma: 'Firma' }))
      .toBe('Hej Ana, Magazynier w Firma');
    expect(fillTemplate('Hej {imie}', { imie: '  ' })).toBe('Hej {imie}');
    expect(fillTemplate('{nieznane}', {})).toBe('{nieznane}');
  });

  it('schemat: nazwa, co najmniej jedna treść, tylko języki serwisu', () => {
    const base = { id: null, name: 'Zaproszenie', variants: { pl: 'Treść' }, expectedUpdatedAt: null };
    expect(messageTemplateSchema.safeParse(base).success).toBe(true);
    expect(messageTemplateSchema.safeParse({ ...base, name: '  ' }).success).toBe(false);
    expect(messageTemplateSchema.safeParse({ ...base, variants: { pl: '  ' } }).success).toBe(false);
    expect(messageTemplateSchema.safeParse({ ...base, variants: { de: 'Hallo' } }).success).toBe(false);
    expect(messageTemplateSchema.safeParse({ ...base, variants: { pl: 'x'.repeat(4001) } }).success).toBe(false);
  });

  it('numer rejestru narodowego w wariancie jest wykrywany (#495)', () => {
    expect(findSensitiveVariant({ pl: 'ok', nl: 'Rijksregisternummer 85.07.30-033.28' })).toBe('nl');
    expect(findSensitiveVariant({ pl: 'Zapraszamy w poniedziałek o 8:00' })).toBeNull();
  });
});

describe('akcje szablonów', () => {
  const input = { id: null, name: 'Zaproszenie', variants: { pl: 'Zapraszamy', nl: '  ' }, expectedUpdatedAt: null };

  it('zapis: firma widoku, tylko niepuste warianty', async () => {
    fakeDb.rpc('save_company_message_template', TEMPLATE);
    expect(await saveMessageTemplate(input, COMPANY)).toEqual({ ok: true, id: TEMPLATE });
    const [call] = fakeDb.callsTo('save_company_message_template');
    expect(call?.args['p_company_id']).toBe(COMPANY);
    expect(JSON.parse(String(call?.args['p_variants']))).toEqual({ pl: 'Zapraszamy' });
  });

  it('zmiana aktywnej firmy = ACTIVE_COMPANY_CHANGED bez zapisu', async () => {
    fakeDb.rpc('save_company_message_template', TEMPLATE);
    expect(await saveMessageTemplate(input, OTHER_COMPANY)).toEqual({ ok: false, error: 'ACTIVE_COMPANY_CHANGED' });
    expect(fakeDb.callsTo('save_company_message_template')).toHaveLength(0);
  });

  it('numer dokumentu w treści = odmowa przed bazą', async () => {
    const result = await saveMessageTemplate({ ...input, variants: { pl: 'NISS 85.07.30-033.28' } }, COMPANY);
    expect(result).toEqual({ ok: false, error: 'VALIDATION_FAILED', reason: 'sensitiveId' });
    expect(fakeDb.calls).toHaveLength(0);
  });

  it('limit i CAS z bazy mapowane na kody', async () => {
    fakeDb.rpc('save_company_message_template', () => {
      throw pgError('42501', 'TEMPLATE_LIMIT: najwyżej 50 szablonów na firmę');
    });
    expect(await saveMessageTemplate(input, COMPANY)).toEqual({ ok: false, error: 'TEMPLATE_LIMIT' });
    fakeDb.rpc('save_company_message_template', () => {
      throw pgError('42501', 'STALE_STATE: szablon zmieniono równolegle');
    });
    expect(await saveMessageTemplate(input, COMPANY)).toEqual({ ok: false, error: 'STALE_STATE' });
  });

  it('usunięcie: zły identyfikator bez bazy, cudzy = NOT_FOUND', async () => {
    expect(await deleteMessageTemplate('x', COMPANY)).toEqual({ ok: false, error: 'VALIDATION_FAILED' });
    fakeDb.rpc('delete_company_message_template', () => {
      throw pgError('P0002', 'NOT_FOUND');
    });
    expect(await deleteMessageTemplate(TEMPLATE, COMPANY)).toEqual({ ok: false, error: 'NOT_FOUND' });
  });
});
