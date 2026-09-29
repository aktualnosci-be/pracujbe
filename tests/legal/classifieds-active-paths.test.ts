// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { sendOffer } from '@/lib/actions/offers';
import { toggleSavedJob } from '@/lib/actions/candidate';
import { updateNotificationPreferences } from '@/lib/actions/notification-preferences';
import {
  deleteSavedSearchAction,
  renameSavedSearchAction,
  saveSearchAction,
  setSavedSearchAlertsAction,
} from '@/lib/actions/saved-searches';
import { createJobDraft, publishJob, setJobStatus } from '@/lib/actions/jobs';
import { isRecruitmentEnabled } from '@/lib/portal-mode';
import { fakeDb, resetFakeDb } from '../helpers/fake-db';

/**
 * #1249 — strona pozytywna strażnika trybu ogłoszeniowego (#1128). Wyłączenia funkcji
 * rekrutacyjnych sprawdzają `classifieds-only.test.ts` i `classifieds-process-off.test.ts`;
 * tu pilnujemy braku NADMIERNEJ blokady: ścieżki aktywne portalu ogłoszeniowego (zapisane
 * oferty i wyszukiwania, kreator i publikacja oferty, cykl życia oferty, ustawienia konta)
 * w trybie `CLASSIFIEDS_ONLY` (domyślnym w Vitest) nie zwracają `RECRUITMENT_DISABLED`
 * i docierają do warstwy danych (atrapa bazy widzi zapytanie).
 *
 * Atrapa nie zna większości zapytań (brak handlera = błąd bazy → `INTERNAL`) — to celowe:
 * dowodem jest samo dotarcie do bazy, a poprawność zapisu sprawdzają testy tych akcji.
 * Kontrola ujemna: akcja wyłączona (`sendOffer`) w tej samej uprzęży zwraca
 * `RECRUITMENT_DISABLED` bez zapytania.
 */

const UUID = '11111111-1111-4111-8111-111111111111';
const COMPANY = '33333333-3333-4333-8333-333333333333';
const USER = '22222222-2222-4222-8222-222222222222';

vi.mock('next/headers', () => ({
  headers: vi.fn(async () => new Headers({ 'x-real-ip': '203.0.113.9', 'user-agent': 'UA' })),
  cookies: vi.fn(async () => ({ get: () => undefined, set: () => undefined, delete: () => undefined })),
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: vi.fn(async () => true) }));
vi.mock('@/lib/turnstile/verify', () => ({ enforceTurnstile: vi.fn(async () => null) }));
vi.mock('@/lib/error-report', () => ({ captureError: vi.fn() }));
vi.mock('@/lib/job-trust/ai-check', () => ({
  jobFraudCheckProvider: vi.fn(() => null),
  checkJobContentWithAi: vi.fn(async () => null),
}));
vi.mock('@/lib/db/portal', async () => (await import('../helpers/fake-db')).fakePortal());

type Role = 'candidate' | 'employer';
const ACTIVE: { name: string; role: Role; call: () => Promise<unknown> }[] = [
  { name: 'toggleSavedJob (zapisane oferty)', role: 'candidate', call: () => toggleSavedJob(UUID, true) },
  {
    name: 'saveSearchAction (zapis wyszukiwania)',
    role: 'candidate',
    call: () => saveSearchAction({ name: 'Magazyn', locale: 'pl', filters: { keyword: 'magazyn' }, query: '?keyword=magazyn' }),
  },
  { name: 'setSavedSearchAlertsAction (alert)', role: 'candidate', call: () => setSavedSearchAlertsAction(UUID, true, 'daily') },
  { name: 'renameSavedSearchAction', role: 'candidate', call: () => renameSavedSearchAction(UUID, 'Nowa nazwa') },
  { name: 'deleteSavedSearchAction', role: 'candidate', call: () => deleteSavedSearchAction(UUID) },
  {
    name: 'updateNotificationPreferences (konto)',
    role: 'candidate',
    call: () =>
      updateNotificationPreferences({
        emailApplications: false,
        emailOffers: false,
        emailMessages: false,
        emailJobMatches: true,
        emailMarketing: false,
        pushEnabled: false,
        inAppEnabled: true,
        locale: 'pl',
      }),
  },
  { name: 'createJobDraft (kreator)', role: 'employer', call: () => createJobDraft('pl', COMPANY, UUID) },
  { name: 'publishJob (publikacja)', role: 'employer', call: () => publishJob(UUID) },
  { name: 'setJobStatus (wstrzymanie oferty)', role: 'employer', call: () => setJobStatus(UUID, 'pause') },
];

function errorOf(result: unknown): unknown {
  return result && typeof result === 'object' && 'error' in result ? (result as { error: unknown }).error : undefined;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('tryb ogłoszeniowy: ścieżki aktywne nie są blokowane (#1249)', () => {
  it('Vitest działa domyślnie w trybie ogłoszeniowym', () => {
    expect(isRecruitmentEnabled()).toBe(false);
  });

  it.each(ACTIVE)('$name: bez RECRUITMENT_DISABLED, dociera do bazy', async ({ role, call }) => {
    resetFakeDb({ id: USER, role });
    const result = await call();
    expect(errorOf(result)).not.toBe('RECRUITMENT_DISABLED');
    expect(fakeDb.calls.length).toBeGreaterThan(0);
  });

  it('kontrola ujemna: akcja wyłączona w tej samej uprzęży = RECRUITMENT_DISABLED bez zapytania', async () => {
    resetFakeDb({ id: USER, role: 'employer' });
    const result = await sendOffer({ jobId: UUID, candidateId: USER, idempotencyKey: UUID });
    expect(errorOf(result)).toBe('RECRUITMENT_DISABLED');
    expect(fakeDb.calls).toHaveLength(0);
  });
});
