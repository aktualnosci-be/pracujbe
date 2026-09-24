// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';

import { AppError } from '@/lib/errors';

const captureException = vi.fn();
vi.mock('@sentry/nextjs', () => ({ captureException }));

afterEach(() => {
  captureException.mockClear();
  vi.unstubAllEnvs();
});

it('ręczny captureError nie przekazuje do SDK oryginalnego błędu ani kontekstu', async () => {
  vi.stubEnv('NEXT_PUBLIC_SENTRY_DSN', 'https://public@example.invalid/1');
  const { captureError } = await import('@/lib/sentry');
  const original = new AppError('PERMISSION_DENIED', {
    cause: new Error('anna@example.com CV-Anna-Nowak.pdf'),
    context: { message: 'Poufna treść wiadomości' },
  });

  captureError(original, { area: 'candidate.private', phone: '+32470123456' });

  expect(captureException).toHaveBeenCalledTimes(1);
  const [sent, options] = captureException.mock.calls[0]!;
  expect(sent).toBeInstanceOf(Error);
  expect(sent).not.toBe(original);
  expect(sent.message).toBe('Application error');
  expect(sent.cause).toBeUndefined();
  expect(options).toEqual({ tags: { errorCode: 'PERMISSION_DENIED' } });
});
