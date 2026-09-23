import { beforeEach, describe, expect, it, vi } from 'vitest';

import { transitionApplication } from '@/lib/actions/applications';
import { sendOffer } from '@/lib/actions/offers';
import { customOfferMessage } from '@/lib/offers/default-message';
import { createServerClient } from '@/lib/supabase/server';
import en from '@/messages/en.json';
import nl from '@/messages/nl.json';
import pl from '@/messages/pl.json';

vi.mock('@/lib/supabase/server', () => ({ createServerClient: vi.fn() }));
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: vi.fn().mockResolvedValue(true) }));

const rpc = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(createServerClient).mockResolvedValue({ rpc } as never);
});

const JOB = 'aaaaaaaa-aaaa-4aaa-8aaa-000000000001';
const CANDIDATE = 'aaaaaaaa-aaaa-4aaa-8aaa-000000000002';
const KEY = 'aaaaaaaa-aaaa-4aaa-8aaa-000000000003';

describe('transitionApplication — mapowanie błędów (#306)', () => {
  it.each([
    'VALIDATION_FAILED: niedozwolone przejście statusu submitted -> hired',
    'VALIDATION_FAILED: stan aplikacji zmienił się równolegle',
  ])('„%s" → INVALID_TRANSITION', async (message) => {
    rpc.mockResolvedValue({ error: { message } });
    expect(await transitionApplication('app-1', 'hired')).toEqual({ ok: false, error: 'INVALID_TRANSITION' });
  });

  it('niedozwolony status docelowy pozostaje VALIDATION_FAILED', async () => {
    rpc.mockResolvedValue({ error: { message: 'VALIDATION_FAILED: niedozwolony status docelowy' } });
    expect(await transitionApplication('app-1', 'draft')).toEqual({ ok: false, error: 'VALIDATION_FAILED' });
  });
});

describe('sendOffer — treść w języku odbiorcy (#289, Invariant #1)', () => {
  it('bez własnej treści wysyła NULL (szablon renderuje odbiorca), nie tekst z sesji pracodawcy', async () => {
    rpc.mockResolvedValue({ data: 'offer-1', error: null });
    expect(await sendOffer({ jobId: JOB, candidateId: CANDIDATE, idempotencyKey: KEY })).toEqual({ ok: true, id: 'offer-1' });
    expect(rpc).toHaveBeenCalledWith('send_offer', expect.objectContaining({ p_message: null, p_idempotency_key: KEY }));
  });

  it('własna treść rekrutera trafia bez zmian', async () => {
    rpc.mockResolvedValue({ data: 'offer-1', error: null });
    await sendOffer({ jobId: JOB, candidateId: CANDIDATE, idempotencyKey: KEY, message: 'Zapraszamy w poniedziałek.' });
    expect(rpc).toHaveBeenCalledWith('send_offer', expect.objectContaining({ p_message: 'Zapraszamy w poniedziałek.' }));
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
