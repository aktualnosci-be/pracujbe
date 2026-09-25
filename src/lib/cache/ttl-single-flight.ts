/**
 * Krótki TTL cache + deduplikacja jednego trwającego obliczenia na klucz (single-flight),
 * w pamięci JEDNEGO procesu (#595, #600). Chroni kosztowne, publiczne, bezstanowe odczyty
 * (agregacje facetów, ping bazy) przed nieograniczonym powtarzaniem tego samego zapytania:
 * dowolna liczba równoległych żądań z tym samym kluczem czeka na JEDNO obliczenie, a świeży
 * wynik jest oddawany bez ponownego wywołania `factory`.
 *
 * To NIE jest limiter (nie ogranicza nadawcy — od tego jest `checkRateLimit`) ani cache
 * współdzielony między instancjami (inaczej niż limiter w PostgreSQL) — świadomy kompromis:
 * cel to zgaszenie kosztu POWTÓRZEŃ w jednym procesie, nie globalna spójność.
 *
 * Ograniczona liczba wpisów (`maxEntries`) — klucz zbudowany ze zmiennych wejścia (np. dowolny
 * tekst wyszukiwania) mógłby inaczej rosnąć bez końca; najstarsze wpisy są usuwane.
 */

interface Entry<V> {
  value: V;
  expiresAt: number;
}

export interface TtlSingleFlightCache<V> {
  /** Zwraca świeży wynik z cache albo woła `factory` (dzieląc się z równoległymi wywołaniami). */
  run(key: string, factory: () => Promise<V>): Promise<V>;
  /** Tylko do testów/diagnostyki: liczba wpisów aktualnie w cache. */
  size(): number;
  /** Tylko do testów: czyści cache i trwające obliczenia. */
  clear(): void;
}

export function createTtlSingleFlightCache<V>(opts: {
  ttlMs: number;
  maxEntries: number;
}): TtlSingleFlightCache<V> {
  const ttlMs = Math.max(0, opts.ttlMs);
  // `ttlMs <= 0` = wyłącznie deduplikacja RÓWNOLEGŁYCH wywołań (przez `inFlight`, oparta na
  // tożsamości obietnicy — odporna na przesunięcia zegara), BEZ zapisu rozstrzygniętego wyniku
  // do `store`. Odrębne (nie nakładające się) wywołania zawsze liczą na nowo. Ma to znaczenie
  // nie tylko dla poprawności produkcyjnej (np. healthcheck ma odzwierciedlać BIEŻĄCY stan bazy
  // na każde odrębne żądanie), ale i dla testów: porównanie `expiresAt > Date.now()` jest podatne
  // na przesunięcia czasu, gdy test manipuluje zegarem (`vi.useFakeTimers()`), więc pomijamy je
  // całkowicie, zamiast ufać porównaniu znaczników czasu w tym trybie.
  const cacheResolved = ttlMs > 0;
  const maxEntries = Math.max(1, Math.trunc(opts.maxEntries));
  const store = new Map<string, Entry<V>>();
  const inFlight = new Map<string, Promise<V>>();

  function evictExpired(now: number): void {
    for (const [key, entry] of store) {
      if (entry.expiresAt <= now) store.delete(key);
    }
  }

  function evictOldestIfNeeded(): void {
    if (store.size <= maxEntries) return;
    evictExpired(Date.now());
    while (store.size > maxEntries) {
      const oldestKey = store.keys().next().value;
      if (oldestKey === undefined) break;
      store.delete(oldestKey);
    }
  }

  return {
    async run(key, factory) {
      if (cacheResolved) {
        const cached = store.get(key);
        if (cached && cached.expiresAt > Date.now()) return cached.value;
      }

      const pending = inFlight.get(key);
      if (pending) return pending;

      const promise = factory()
        .then((value) => {
          if (cacheResolved) {
            // `set` po `delete` (jeśli już istniał) trzyma świeży wpis na końcu kolejki
            // wstawiania — to porządek, wg którego usuwamy najstarsze wpisy.
            store.delete(key);
            store.set(key, { value, expiresAt: Date.now() + ttlMs });
            evictOldestIfNeeded();
          }
          return value;
        })
        .finally(() => {
          inFlight.delete(key);
        });
      inFlight.set(key, promise);
      return promise;
    },
    size() {
      return store.size;
    },
    clear() {
      store.clear();
      inFlight.clear();
    },
  };
}
