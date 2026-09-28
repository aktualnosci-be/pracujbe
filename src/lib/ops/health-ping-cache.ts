import { createTtlSingleFlightCache } from '@/lib/cache/ttl-single-flight';

/**
 * `ttlMs: 0` — celowo BEZ ponownego użycia rozstrzygniętego wyniku (healthcheck ma odzwierciedlać
 * realny, BIEŻĄCY stan bazy na każde odrębne żądanie — patrz komentarz w `route.ts`). Cache
 * chroni wyłącznie przed RÓWNOLEGŁYMI żądaniami (#600): dopóki jedno `pool.query('SELECT 1')`
 * trwa, kolejne żądania (nawet setki naraz) czekają na TEN SAM wynik zamiast otwierać nowe
 * zapytanie — to jest właściwa ochrona przed zalewem. Gdy zapytanie się zakończy, następne,
 * odrębne żądanie zawsze sprawdza bazę od nowa.
 *
 * Wydzielone z `route.ts` (#986 build fix): pliki tras Next.js dopuszczają wyłącznie
 * ustalone eksporty (GET/POST/…/config) — dodatkowy `resetHealthPingCacheForTests` łamał
 * typy trasy przy `next build` ("nie jest prawidłowym polem eksportu Route").
 */
export const DATABASE_PING_CACHE_KEY = 'ping';

export const pingCache = createTtlSingleFlightCache<boolean>({
  ttlMs: 0,
  maxEntries: 1,
});

/**
 * Tylko dla testów: `pingCache` żyje w module (jeden proces, #600/#645) i normalnie kończy
 * dzielony wpis dopiero, gdy realne zapytanie się rozstrzygnie. Test symulujący zawieszoną bazę
 * (mock `pool.query`, który NIGDY się nie rozstrzyga) inaczej trwale zatruwałby stan modułu na
 * resztę pliku testowego — kolejne, odrębne testy w tym samym pliku dzieliłyby ten sam, wiecznie
 * trwający wpis `inFlight` i healthcheck fałszywie zwracałby 503 po realnym odzyskaniu bazy.
 */
export function resetHealthPingCacheForTests(): void {
  pingCache.clear();
}
