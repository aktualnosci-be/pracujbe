import { NextResponse } from 'next/server';

import { parseClientErrorPayload } from '@/lib/client-error/payload';
import { env } from '@/lib/env';
import { errorWebhookFromEnv, installErrorWebhook } from '@/lib/error-webhook';
import { readTextWithLimit } from '@/lib/http/read-limited';
import { trustedClientIp } from '@/lib/http/trusted-ip';
import { createFunnelRateLimiter } from '@/lib/job-funnel/rate-limit';

/**
 * Zgłoszenia błędów z przeglądarki (#502) → ten sam kanał co błędy serwera (webhook
 * `ERROR_WEBHOOK_URL`, `src/lib/error-webhook`). Wysyła je `src/lib/client-error/reporter.ts`.
 *
 * - Tylko ta sama witryna: `Origin` = origin żądania albo `NEXT_PUBLIC_SITE_URL`, a obecny
 *   `Sec-Fetch-Site` musi być `same-origin` — inaczej 403.
 * - Body ≤ 4 KB (limit przy streamingu), wyłącznie pola `code`/`route`/`release`
 *   (`parseClientErrorPayload`); inne pola (np. `message`, `stack`) = 400, nic nie wychodzi.
 * - Limiter w pamięci po HMAC adresu z losową solą procesu (jak lejek ofert, #99); adres
 *   WYŁĄCZNIE z jedynego zaufanego nagłówka proxy (`trustedClientIp`, #588/#602/#901) —
 *   NIGDY z `X-Forwarded-For`/`X-Real-IP` wprost, który klient może dowolnie zmieniać przy
 *   każdym żądaniu (jak `#646` dla lejka ofert). Adres nie trafia do wiadomości, logów ani
 *   bazy. Cookies nie są czytane.
 * - Brak (poprawnego) `ERROR_WEBHOOK_URL` = 204 bez wysyłki.
 * Odpowiedzi bez treści, zawsze `no-store`.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const MAX_BODY_BYTES = 4096;
const NO_STORE = { 'Cache-Control': 'private, no-store' } as const;

/** 10 zgłoszeń na minutę z jednego adresu — karta i tak wysyła najwyżej 10 na załadowanie. */
const limiter = createFunnelRateLimiter({ max: 10, windowMs: 60_000 });

function empty(status: number, extra?: Record<string, string>): NextResponse {
  return new NextResponse(null, { status, headers: { ...NO_STORE, ...extra } });
}

function sameOrigin(request: Request): boolean {
  const fetchSite = request.headers.get('sec-fetch-site');
  if (fetchSite !== null && fetchSite !== 'same-origin') return false;
  const origin = request.headers.get('origin');
  if (!origin) return false;
  const allowed = new Set<string>([new URL(request.url).origin]);
  try {
    allowed.add(new URL(env.siteUrl).origin);
  } catch {
    // Nieprawidłowy NEXT_PUBLIC_SITE_URL — zostaje origin żądania.
  }
  return allowed.has(origin);
}

/**
 * Adres niepoprawny albo nieustalony → wspólny zastępczy klucz (jak `lib/rate-limit.ts` i
 * `job-funnel/route.ts`). Brak zaufanego nagłówka proxy nie może dawać klientowi osobnego
 * budżetu na każdą zmyśloną wartość — wszystkie takie żądania dzielą jedną, wspólną pulę.
 */
const UNKNOWN_IP = '0.0.0.0';

/** Adres z JEDYNEGO, jawnie skonfigurowanego, zaufanego nagłówka proxy; używany wyłącznie w limiterze. */
function clientAddress(headers: Headers): string {
  return trustedClientIp(headers) ?? UNKNOWN_IP;
}

export async function POST(request: Request): Promise<NextResponse> {
  if (!sameOrigin(request)) return empty(403);

  const body = await readTextWithLimit(request, MAX_BODY_BYTES);
  if (!body.ok) return empty(413);
  let parsed: unknown;
  try {
    parsed = JSON.parse(body.text);
  } catch {
    return empty(400);
  }
  const payload = parseClientErrorPayload(parsed);
  if (!payload) return empty(400);

  if (!errorWebhookFromEnv()) return empty(204);
  if (!limiter.hit(clientAddress(request.headers))) return empty(429);

  await installErrorWebhook()
    .send({ code: payload.code, route: payload.route, release: payload.release, source: 'client' })
    .catch(() => undefined);
  return empty(204);
}

export function GET(): NextResponse {
  return empty(405, { Allow: 'POST' });
}
