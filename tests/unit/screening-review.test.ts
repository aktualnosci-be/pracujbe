import { beforeEach, describe, expect, it, vi } from 'vitest';

import { decideScreeningReview } from '@/lib/actions/admin';
import { publishJob } from '@/lib/actions/jobs';
import { AUDIT_ACTION_KEY, parseScreeningReviewFilter } from '@/lib/admin/list-params';
import { titleKeyForType } from '@/lib/data/notifications';
import { toUserMessageKey } from '@/lib/errors';
import { isSupabaseConfigured } from '@/lib/env';
import { checkRateLimit } from '@/lib/rate-limit';
import { SCREENING_REVIEW_REASON_MAX } from '@/lib/screening/risk';
import { buildScreeningReviewNotices, screeningReviewReasonError } from '@/lib/screening/review';
import { createServerClient } from '@/lib/supabase/server';

/**
 * #497 — przegląd pytań screeningowych po stronie aplikacji: stan pytań blokujących publikację
 * (ta sama reguła co strażnik w bazie), mapowanie błędów publikacji, akcja admina.
 */

vi.mock('@/lib/env', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/env')>()),
  isSupabaseConfigured: vi.fn(),
}));
vi.mock('@/lib/supabase/server', () => ({ createServerClient: vi.fn() }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: vi.fn() }));
vi.mock('@/lib/sentry', () => ({ captureError: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

const JOB_ID = '5a0e8f4c-2b1d-4c3e-9f7a-1d2e3f4a5b6c';
const REVIEW_ID = '6b1f9a5d-3c2e-4d4f-8a8b-2e3f4a5b6c7d';

type Result = { data?: unknown; error?: unknown };

function chain(result: Result) {
  const q: Record<string, unknown> = {};
  for (const m of ['select', 'is', 'eq', 'in', 'order', 'limit']) q[m] = () => q;
  q.maybeSingle = () => Promise.resolve(result);
  q.then = (done: (value: Result) => unknown) => Promise.resolve(result).then(done);
  return q;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(isSupabaseConfigured).mockReturnValue(true);
  vi.mocked(checkRateLimit).mockResolvedValue(true);
});

describe('buildScreeningReviewNotices', () => {
  const questions = [
    { position: 0, content_fingerprint: 'a', risk_categories: [] },
    { position: 2, content_fingerprint: 'c', risk_categories: ['age'] },
    { position: 1, content_fingerprint: 'b', risk_categories: ['family', 'nieznana'] },
    { position: 3, content_fingerprint: 'd', risk_categories: ['health'] },
    { position: 4, content_fingerprint: 'e', risk_categories: ['union'] },
  ];
  const reviews = [
    { content_fingerprint: 'b', status: 'rejected', decision_reason: 'Usuń opcję o ciąży.' },
    { content_fingerprint: 'c', status: 'pending', decision_reason: null },
    { content_fingerprint: 'd', status: 'approved', decision_reason: null },
    // Decyzja o innej (wcześniejszej) treści pytania nie przechodzi na bieżącą.
    { content_fingerprint: 'e-stara', status: 'approved', decision_reason: null },
  ];

  it('tylko oznaczone pytania bez akceptacji bieżącej treści, w kolejności pozycji', () => {
    expect(buildScreeningReviewNotices(questions, reviews)).toEqual([
      { index: 1, status: 'rejected', categories: ['family'], reason: 'Usuń opcję o ciąży.' },
      { index: 2, status: 'pending', categories: ['age'], reason: null },
      { index: 4, status: 'pending', categories: ['union'], reason: null },
    ]);
  });

  it('niepoprawne dane → pusta lista (bez wyjątku)', () => {
    expect(buildScreeningReviewNotices(null, undefined)).toEqual([]);
    expect(buildScreeningReviewNotices([{ position: 'x', risk_categories: ['age'] }], [])).toEqual([]);
  });
});

describe('uzasadnienie decyzji', () => {
  it('odrzucenie wymaga uzasadnienia, akceptacja nie; limit jak w RPC', () => {
    expect(screeningReviewReasonError('rejected', '  ')).toBe('required');
    expect(screeningReviewReasonError('approved', '')).toBeNull();
    expect(screeningReviewReasonError('approved', 'x'.repeat(SCREENING_REVIEW_REASON_MAX + 1))).toBe(
      'tooLong',
    );
    expect(screeningReviewReasonError('rejected', 'Brak podstawy dla stanowiska.')).toBeNull();
  });
});

describe('publishJob — pytania blokujące publikację', () => {
  function mockPublish(message: string) {
    const rpc = vi.fn().mockResolvedValue({ error: { message } });
    const from = vi.fn((table: string) => {
      if (table === 'jobs') return chain({ data: { id: JOB_ID, title: 'Magazynier' }, error: null });
      if (table === 'job_screening_questions') {
        return chain({
          data: [{ position: 1, content_fingerprint: 'b', risk_categories: ['age'] }],
          error: null,
        });
      }
      return chain({ data: [{ content_fingerprint: 'b', status: 'pending' }], error: null });
    });
    vi.mocked(createServerClient).mockResolvedValue({
      auth: { getUser: () => Promise.resolve({ data: { user: { id: 'emp-1' } } }) },
      from,
      rpc,
    } as never);
    return { rpc, from };
  }

  it('SCREENING_REVIEW_REQUIRED z bazy → kod + pytania do poprawy', async () => {
    mockPublish('SCREENING_REVIEW_REQUIRED: 1');
    await expect(publishJob(JOB_ID)).resolves.toEqual({
      ok: false,
      error: 'SCREENING_REVIEW_REQUIRED',
      screening: [{ index: 1, status: 'pending', categories: ['age'], reason: null }],
    });
  });

  it('SCREENING_QUESTION_REJECTED z bazy → własny kod (nie ogólny błąd)', async () => {
    mockPublish('SCREENING_QUESTION_REJECTED: 1');
    const res = await publishJob(JOB_ID);
    expect(res.ok).toBe(false);
    expect(res.ok ? null : res.error).toBe('SCREENING_QUESTION_REJECTED');
  });

  it('kontrola ujemna: inny błąd publikacji nie dołącza stanu pytań', async () => {
    const { from } = mockPublish('VALIDATION_FAILED: brak wymagań obowiązkowych');
    await expect(publishJob(JOB_ID)).resolves.toEqual({ ok: false, error: 'VALIDATION_FAILED' });
    expect(from).not.toHaveBeenCalledWith('screening_question_reviews');
  });

  it('komunikaty błędów mają klucze i18n', () => {
    expect(toUserMessageKey('SCREENING_REVIEW_REQUIRED')).toBe('errors.screeningReviewRequired');
    expect(toUserMessageKey('SCREENING_QUESTION_REJECTED')).toBe('errors.screeningQuestionRejected');
  });
});

describe('decideScreeningReview (admin)', () => {
  function mockRpc(result: { error: unknown } = { error: null }) {
    const rpc = vi.fn().mockResolvedValue(result);
    vi.mocked(createServerClient).mockResolvedValue({
      auth: { getUser: () => Promise.resolve({ data: { user: { id: 'admin-1' } } }) },
      rpc,
    } as never);
    return rpc;
  }

  it('odrzucenie bez uzasadnienia nie dociera do bazy', async () => {
    const rpc = mockRpc();
    await expect(decideScreeningReview(REVIEW_ID, 'rejected', ' ')).resolves.toEqual({
      ok: false,
      error: 'VALIDATION_FAILED',
      field: 'reason',
      reason: 'required',
    });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('akceptacja → RPC z przyciętym/pustym uzasadnieniem', async () => {
    const rpc = mockRpc();
    await expect(decideScreeningReview(REVIEW_ID, 'approved', '  ')).resolves.toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledWith('admin_decide_screening_review', {
      p_review_id: REVIEW_ID,
      p_decision: 'approved',
      p_reason: null,
    });
  });

  it('nieznana decyzja i zły identyfikator → VALIDATION_FAILED bez RPC', async () => {
    const rpc = mockRpc();
    await expect(decideScreeningReview(REVIEW_ID, 'maybe' as never, '')).resolves.toEqual({
      ok: false,
      error: 'VALIDATION_FAILED',
    });
    await expect(decideScreeningReview('nie-uuid', 'approved', '')).resolves.toEqual({
      ok: false,
      error: 'VALIDATION_FAILED',
    });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('decyzja już podjęta / treść zmieniona → STALE_STATE', async () => {
    mockRpc({ error: { message: 'STALE_STATE: przegląd nie oczekuje na decyzję' } });
    await expect(decideScreeningReview(REVIEW_ID, 'approved', '')).resolves.toEqual({
      ok: false,
      error: 'STALE_STATE',
    });
  });
});

describe('powiązania UI', () => {
  it('tytuł powiadomienia o decyzji wg statusu', () => {
    expect(titleKeyForType('system', { kind: 'screening_review', status: 'approved' }, 'job')).toBe(
      'itemScreeningApproved',
    );
    expect(titleKeyForType('system', { kind: 'screening_review', status: 'rejected' }, 'job')).toBe(
      'itemScreeningRejected',
    );
  });

  it('dziennik zna akcje audytu z migracji 0103, filtr kolejki domyślnie oczekujące', () => {
    expect(AUDIT_ACTION_KEY['screening_question.review_requested']).toBeDefined();
    expect(AUDIT_ACTION_KEY['screening_question.reviewed']).toBeDefined();
    expect(parseScreeningReviewFilter('xxx')).toBe('pending');
    expect(parseScreeningReviewFilter('decided')).toBe('decided');
  });
});
