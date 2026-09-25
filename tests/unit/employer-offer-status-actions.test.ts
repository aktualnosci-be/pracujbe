import { beforeEach, describe, expect, it, vi } from 'vitest';

import { transitionApplication } from '@/lib/actions/applications';
import { sendOffer } from '@/lib/actions/offers';
import { customOfferMessage } from '@/lib/offers/default-message';
import { fakeDb, pgError, resetFakeDb } from '../helpers/fake-db';
import en from '@/messages/en.json';
import nl from '@/messages/nl.json';
import pl from '@/messages/pl.json';

vi.mock('@/lib/db/portal', async () => (await import('../helpers/fake-db')).fakePortal());
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: vi.fn().mockResolvedValue(true) }));
vi.mock('@/lib/sentry', () => ({ captureError: vi.fn() }));

const EMPLOYER = 'aaaaaaaa-aaaa-4aaa-8aaa-000000000009';
beforeEach(() => {
  vi.clearAllMocks();
  resetFakeDb({ id: EMPLOYER, role: 'employer' });
});

const JOB = 'aaaaaaaa-aaaa-4aaa-8aaa-000000000001';
const CANDIDATE = 'aaaaaaaa-aaaa-4aaa-8aaa-000000000002';
const KEY = 'aaaaaaaa-aaaa-4aaa-8aaa-000000000003';

describe('transitionApplication — mapowanie błędów (#306)', () => {
  it.each([
    'VALIDATION_FAILED: niedozwolone przejście statusu submitted -> hired',
    'VALIDATION_FAILED: stan aplikacji zmienił się równolegle',
  ])('„%s" → INVALID_TRANSITION', async (message) => {
    fakeDb.rpc('transition_application', () => { throw pgError('P0001', message); });
    expect(await transitionApplication('app-1', 'hired')).toEqual({ ok: false, error: 'INVALID_TRANSITION' });
  });

  it('niedozwolony status docelowy pozostaje VALIDATION_FAILED', async () => {
    fakeDb.rpc('transition_application', () => { throw pgError('P0001', 'VALIDATION_FAILED: niedozwolony status docelowy'); });
    expect(await transitionApplication('app-1', 'draft')).toEqual({ ok: false, error: 'VALIDATION_FAILED' });
  });

  it('zapis pod sesją pracodawcy; bez sesji brak wywołania', async () => {
    fakeDb.rpc('transition_application', null);
    expect(await transitionApplication('app-1', 'viewed')).toEqual({ ok: true });
    expect(fakeDb.callsTo('transition_application')[0]).toMatchObject({
      as: EMPLOYER, args: { p_application_id: 'app-1', p_target: 'viewed' },
    });
    resetFakeDb(null);
    expect(await transitionApplication('app-1', 'viewed')).toEqual({ ok: false, error: 'PERMISSION_DENIED' });
    expect(fakeDb.calls).toHaveLength(0);
  });
});

describe('sendOffer — treść w języku odbiorcy (#289, Invariant #1)', () => {
  it('bez własnej treści wysyła NULL (szablon renderuje odbiorca), nie tekst z sesji pracodawcy', async () => {
    fakeDb.rpc('send_offer', 'offer-1');
    expect(await sendOffer({ jobId: JOB, candidateId: CANDIDATE, idempotencyKey: KEY })).toEqual({ ok: true, id: 'offer-1' });
    expect(fakeDb.callsTo('send_offer')[0]!.args).toMatchObject({ p_message: null, p_idempotency_key: KEY, p_expires_at: null });
    expect(fakeDb.callsTo('send_offer')[0]!.as).toBe(EMPLOYER);
  });

  it('własna treść rekrutera trafia bez zmian', async () => {
    fakeDb.rpc('send_offer', 'offer-1');
    await sendOffer({ jobId: JOB, candidateId: CANDIDATE, idempotencyKey: KEY, message: 'Zapraszamy w poniedziałek.' });
    expect(fakeDb.callsTo('send_offer')[0]!.args).toMatchObject({ p_message: 'Zapraszamy w poniedziałek.' });
  });
});

describe('customOfferMessage', () => {
  it('pusta treść i zapisany wcześniej szablon (dowolny język) → standardowe zaproszenie odbiorcy', () => {
    expect(customOfferMessage('')).toBeNull();
    expect(customOfferMessage(pl.dashboard.offerDefaultMessage)).toBeNull();
    expect(customOfferMessage(` ${en.dashboard.offerDefaultMessage}\n`)).toBeNull();
    expect(customOfferMessage(nl.dashboard.offerDefaultMessage)).toBeNull();
  });

  it('własna treść pozostaje', () => {
    expect(customOfferMessage('  Zapraszamy w poniedziałek. ')).toBe('Zapraszamy w poniedziałek.');
  });
});
