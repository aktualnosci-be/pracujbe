import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * Odświeżenie sesji Better Auth przy zwykłym przeglądaniu panelu (#864): Server Components nie
 * mogą zapisać `Set-Cookie`, więc bez wywołania z przeglądarki regularne przeglądanie (bez
 * Server Actions) nie przedłuża 7-dniowej sesji. `SessionKeepAlive` woła jedyny dozwolony
 * endpoint SDK (`GET /api/auth/get-session`, `http-allowlist.ts`) raz na zamontowanie — SDK
 * sam decyduje, czy odnowić cookie (próg `updateAge`).
 */

const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn() }));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('SessionKeepAlive (#864)', () => {
  it('woła GET /api/auth/get-session tego samego pochodzenia, raz na zamontowanie', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const { SessionKeepAlive } = await import('@/components/auth/SessionKeepAlive');
    render(<SessionKeepAlive />);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/auth/get-session',
      expect.objectContaining({ credentials: 'same-origin' }),
    );
  });

  it('renderuje pusty wynik — nic widocznego w panelu', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const { SessionKeepAlive } = await import('@/components/auth/SessionKeepAlive');
    const { container } = render(<SessionKeepAlive />);
    expect(container).toBeEmptyDOMElement();
  });

  it('błąd sieci jest best-effort — nie rzuca i nie blokuje montowania (Invariant #8)', async () => {
    fetchMock.mockRejectedValue(new Error('network down'));
    vi.stubGlobal('fetch', fetchMock);
    const { SessionKeepAlive } = await import('@/components/auth/SessionKeepAlive');
    expect(() => render(<SessionKeepAlive />)).not.toThrow();
    // Mikrozadanie odrzucenia obsłużone przez `.catch` — nic nie ucieka jako unhandled rejection.
    await Promise.resolve();
    await Promise.resolve();
  });
});
