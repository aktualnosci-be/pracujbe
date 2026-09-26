// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

import { captureError, setErrorReporter } from '@/lib/error-report';
import { AppError } from '@/lib/errors';

/**
 * `captureError` w przeglądarce (#502): przekazuje reporterowi wyłącznie kod; błąd z `digest`
 * (błąd serwera, zgłoszony już przez `onRequestError`) jest pomijany.
 */
afterEach(() => setErrorReporter(null));

describe('captureError w przeglądarce', () => {
  it('przekazuje sam kod — bez treści wyjątku', () => {
    const reporter = vi.fn();
    setErrorReporter(reporter);
    captureError(new Error('jan.kowalski@example.com'), { email: 'jan.kowalski@example.com' });
    captureError(new AppError('NOT_FOUND'));
    expect(reporter.mock.calls).toEqual([[{ code: 'INTERNAL' }], [{ code: 'NOT_FOUND' }]]);
  });

  it('błąd z digest (serwerowy) nie jest zgłaszany drugi raz', () => {
    const reporter = vi.fn();
    setErrorReporter(reporter);
    captureError(Object.assign(new Error('x'), { digest: '12345' }));
    captureError(new Error('x'), { digest: '67890' });
    expect(reporter).not.toHaveBeenCalled();
    // Kontrola ujemna: pusty digest = błąd klienta, zgłaszany.
    captureError(new Error('x'), { digest: '' });
    expect(reporter).toHaveBeenCalledTimes(1);
  });
});
