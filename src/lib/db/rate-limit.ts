import 'server-only';

import { createHmac } from 'node:crypto';
import { isIP } from 'node:net';
import type { TransactionClient, TransactionPool } from './transaction';

export interface DatabaseRateLimitOptions {
  /** Nazwa akcji pochodzi ze stałej serwerowej, nie z formularza. */
  action: string;
  /** Adres ustalony przez adapter zaufanego proxy; ten helper nie czyta nagłówków. */
  trustedClientIp: string;
  identifier?: string;
  max: number;
  windowSeconds: number;
  /** Osobny sekret wspólny dla instancji; nigdy hasło bazy ani sekret sesji. */
  keySecret: string;
}

/**
 * Rzucany, gdy limiter PostgreSQL NIE MÓGŁ ustalić decyzji (błędna konfiguracja wywołania,
 * awaria połączenia/transakcji/RPC — np. rotacja loginu limitera albo niedostępna osobna
 * baza). To NIE jest przekroczenie limitu (#608): warstwa wyżej (`src/lib/rate-limit.ts`)
 * decyduje o polityce fail-safe/fail-open per akcja, tak jak `src/lib/turnstile/policy.ts`
 * dla Turnstile. `checkDatabaseRateLimit` zwraca `boolean` WYŁĄCZNIE, gdy RPC faktycznie
 * odpowiedziało — `true`/`false` znaczy wtedy naprawdę „w limicie” / „przekroczono”.
 */
export class RateLimitUnavailableError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'RateLimitUnavailableError';
  }
}

/**
 * Wewnętrzny limiter PostgreSQL. Wymaga osobnej puli z ograniczonym loginem
 * członkowskim wyłącznie pracujbe_rate_limit. Zwraca `boolean` tylko dla rzeczywistej
 * decyzji RPC; błędna konfiguracja wywołania i każda awaria (połączenie, transakcja,
 * `SET LOCAL ROLE`, RPC, COMMIT) rzuca {@link RateLimitUnavailableError} — nie jest
 * cicho zamieniana na `false` (#608: awaria ≠ przekroczenie limitu).
 * RPC atomowo zwiększa licznik także odrzuconej próby; COMMIT zachowuje ten zapis.
 * Do bazy trafia HMAC, nigdy surowy adres IP ani identyfikator. Niczego nie loguje.
 */
export async function checkDatabaseRateLimit(
  pool: TransactionPool,
  options: DatabaseRateLimitOptions,
): Promise<boolean> {
  if (!/^[a-z][a-z0-9-]{0,63}$/.test(options.action) ||
    typeof options.trustedClientIp !== 'string' || isIP(options.trustedClientIp) === 0 ||
    !Number.isInteger(options.max) || options.max < 1 || options.max > 2_147_483_647 ||
    !Number.isInteger(options.windowSeconds) || options.windowSeconds < 1 || options.windowSeconds > 2_147_483_647 ||
    typeof options.keySecret !== 'string' || Buffer.byteLength(options.keySecret, 'utf8') < 32 ||
    (options.identifier !== undefined && (typeof options.identifier !== 'string' || options.identifier.length > 256))) {
    throw new RateLimitUnavailableError('checkDatabaseRateLimit: nieprawidłowe parametry wywołania');
  }
  // Równoważne zapisy IPv6 muszą korzystać z tego samego licznika.
  const ip = isIP(options.trustedClientIp) === 6
    ? new URL(`http://[${options.trustedClientIp}]/`).hostname
    : options.trustedClientIp;
  const key = createHmac('sha256', options.keySecret)
    .update(JSON.stringify([options.action, ip, options.identifier ?? null])).digest('hex');

  let client: TransactionClient | undefined;
  let destroy = false;
  try {
    client = await pool.connect();
  } catch (error) {
    throw new RateLimitUnavailableError('checkDatabaseRateLimit: brak połączenia', { cause: error });
  }
  try {
    await client.query('BEGIN');
    await client.query('SET LOCAL ROLE pracujbe_rate_limit');
    const result = await client.query(
      'SELECT public.rate_limit_hit($1, $2, $3) AS allowed',
      [key, options.max, options.windowSeconds],
    ) as { rows: { allowed: unknown }[] };
    await client.query('COMMIT');
    return result.rows[0]?.allowed === true;
  } catch (error) {
    try { await client.query('ROLLBACK'); }
    catch { destroy = true; }
    throw new RateLimitUnavailableError('checkDatabaseRateLimit: błąd transakcji/RPC', { cause: error });
  } finally {
    try { client.release(destroy); }
    catch { /* pula i tak zamyka połączenie po awarii release */ }
  }
}
