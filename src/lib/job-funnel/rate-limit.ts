import 'server-only';

import { createHmac, randomBytes } from 'node:crypto';

/**
 * Limiter endpointu lejka (#99). Okno stałe w pamięci procesu: licznik żądań na klucz
 * HMAC(adres) z losową solą procesu — surowy adres nie jest przechowywany, a klucza nie da
 * się powiązać między restartami ani instancjami. Nic nie trafia do bazy ani logów.
 *
 * Uzasadnienie: zapis zdarzeń jest tani, a limiter chroni agregat przed zawyżaniem przez
 * jedno źródło. Awaria nie jest możliwa (brak I/O), więc brak rozróżnienia fail-open/closed.
 */
export interface FunnelRateLimiter {
  hit(clientAddress: string, now?: number): boolean;
}

export function createFunnelRateLimiter(options: {
  max: number;
  windowMs: number;
  maxKeys?: number;
}): FunnelRateLimiter {
  const salt = randomBytes(32);
  const maxKeys = options.maxKeys ?? 50_000;
  let windowStart = 0;
  let counts = new Map<string, number>();

  return {
    hit(clientAddress, now = Date.now()) {
      if (now - windowStart >= options.windowMs) {
        windowStart = now;
        counts = new Map();
      }
      const key = createHmac('sha256', salt).update(clientAddress).digest('base64url').slice(0, 22);
      const next = (counts.get(key) ?? 0) + 1;
      // Zalew unikalnych kluczy nie może rozdmuchać pamięci: nowy klucz ponad limit = odrzucenie.
      if (next === 1 && counts.size >= maxKeys) return false;
      counts.set(key, next);
      return next <= options.max;
    },
  };
}

/** 60 zdarzeń na minutę z jednego adresu: z zapasem na przeglądanie, za mało na zawyżanie. */
export const funnelRateLimiter = createFunnelRateLimiter({ max: 60, windowMs: 60_000 });
