import { describe, expect, it, vi } from 'vitest';

import { createTtlSingleFlightCache } from '@/lib/cache/ttl-single-flight';

/**
 * #595/#600 — cache w pamięci procesu z krótkim TTL i deduplikacją jednego trwającego
 * obliczenia na klucz. Używany przez publiczne, kosztowne odczyty (ping bazy, facety ofert).
 */
describe('createTtlSingleFlightCache', () => {
  it('równoległe wywołania z tym samym kluczem dzielą JEDNO obliczenie (single-flight)', async () => {
    const cache = createTtlSingleFlightCache<number>({ ttlMs: 10_000, maxEntries: 10 });
    let calls = 0;
    let resolveFactory!: (value: number) => void;
    const factory = () =>
      new Promise<number>((resolve) => {
        calls += 1;
        resolveFactory = resolve;
      });

    const results = Promise.all([cache.run('k', factory), cache.run('k', factory), cache.run('k', factory)]);
    await Promise.resolve();
    resolveFactory(42);
    expect(await results).toEqual([42, 42, 42]);
    expect(calls).toBe(1);
  });

  it('świeży wpis (< TTL) jest zwracany bez ponownego wywołania `factory`', async () => {
    const cache = createTtlSingleFlightCache<number>({ ttlMs: 10_000, maxEntries: 10 });
    const factory = vi.fn(async () => 1);
    await cache.run('k', factory);
    await cache.run('k', factory);
    await cache.run('k', factory);
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it('wygasły wpis (> TTL) uruchamia `factory` ponownie', async () => {
    vi.useFakeTimers();
    try {
      const cache = createTtlSingleFlightCache<number>({ ttlMs: 1_000, maxEntries: 10 });
      const factory = vi.fn(async () => 1);
      await cache.run('k', factory);
      vi.advanceTimersByTime(1_001);
      await cache.run('k', factory);
      expect(factory).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('inny klucz → osobne obliczenie (bez mieszania wyników różnych zapytań)', async () => {
    const cache = createTtlSingleFlightCache<string>({ ttlMs: 10_000, maxEntries: 10 });
    const a = await cache.run('a', async () => 'wynik-a');
    const b = await cache.run('b', async () => 'wynik-b');
    expect(a).toBe('wynik-a');
    expect(b).toBe('wynik-b');
  });

  it('błąd `factory` nie jest cache’owany — kolejne wywołanie próbuje ponownie', async () => {
    const cache = createTtlSingleFlightCache<number>({ ttlMs: 10_000, maxEntries: 10 });
    const factory = vi
      .fn<() => Promise<number>>()
      .mockRejectedValueOnce(new Error('awaria'))
      .mockResolvedValueOnce(7);
    await expect(cache.run('k', factory)).rejects.toThrow('awaria');
    await expect(cache.run('k', factory)).resolves.toBe(7);
    expect(factory).toHaveBeenCalledTimes(2);
  });

  it('ogranicza liczbę wpisów (`maxEntries`) — najstarszy klucz jest usuwany', async () => {
    const cache = createTtlSingleFlightCache<number>({ ttlMs: 10_000, maxEntries: 2 });
    await cache.run('a', async () => 1);
    await cache.run('b', async () => 2);
    await cache.run('c', async () => 3);
    expect(cache.size()).toBeLessThanOrEqual(2);

    // Kontrola ujemna: bez limitu (`maxEntries` bardzo duże) wszystkie trzy klucze by zostały.
    const unbounded = createTtlSingleFlightCache<number>({ ttlMs: 10_000, maxEntries: 1_000 });
    await unbounded.run('a', async () => 1);
    await unbounded.run('b', async () => 2);
    await unbounded.run('c', async () => 3);
    expect(unbounded.size()).toBe(3);
  });

  it('`ttlMs: 0` — tylko deduplikacja RÓWNOLEGŁYCH wywołań; odrębne wywołania zawsze liczą od nowa', async () => {
    const cache = createTtlSingleFlightCache<number>({ ttlMs: 0, maxEntries: 5 });

    // Równoległe wywołania nadal dzielą jedno obliczenie.
    const factory = vi.fn(async () => 1);
    const [a, b] = await Promise.all([cache.run('k', factory), cache.run('k', factory)]);
    expect([a, b]).toEqual([1, 1]);
    expect(factory).toHaveBeenCalledTimes(1);

    // Kolejne, ODRĘBNE wywołanie (już nie równoległe) liczy od nowa — bez reużycia wyniku.
    await cache.run('k', factory);
    expect(factory).toHaveBeenCalledTimes(2);
  });

  it('`ttlMs: 0` odporny na przesunięcia zegara (np. `vi.useFakeTimers()` w innym teście)', async () => {
    const cache = createTtlSingleFlightCache<number>({ ttlMs: 0, maxEntries: 5 });
    await cache.run('k', async () => 1);

    // Symulacja: zegar „cofnął się” względem chwili zapisu (dokładnie to robi przełączenie
    // z fake na real timers, gdy fake czas uciekł do przodu) — mimo to kolejne wywołanie
    // NIE dostaje reużytego wyniku, bo w tym trybie nic nie jest porównywane ze znacznikiem czasu.
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(0);
    try {
      const factory = vi.fn(async () => 2);
      const result = await cache.run('k', factory);
      expect(result).toBe(2);
      expect(factory).toHaveBeenCalledTimes(1);
    } finally {
      nowSpy.mockRestore();
    }
  });

  it('kontrola ujemna: BEZ cache każde wywołanie liczyłoby się osobno', async () => {
    let calls = 0;
    const factoryNoCache = async () => {
      calls += 1;
      return calls;
    };
    await Promise.all([factoryNoCache(), factoryNoCache(), factoryNoCache()]);
    expect(calls).toBe(3);
  });
});
