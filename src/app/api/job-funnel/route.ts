import { NextResponse } from 'next/server';

import { isDatabaseConfigured } from '@/lib/env';
import { readTextWithLimit } from '@/lib/http/read-limited';
import { parseFunnelPayload } from '@/lib/job-funnel/events';
import { funnelRateLimiter } from '@/lib/job-funnel/rate-limit';
import { classifyFunnelRequest } from '@/lib/job-funnel/request-filter';
import { captureError } from '@/lib/error-report';

/**
 * Endpoint serwerowego lejka ofert (#99). Strony ofert są statyczne/ISR (#298), więc
 * wyświetlenia zgłasza lekka wyspa kliencka PO załadowaniu (`fetch` z `credentials: 'omit'`).
 * Cache strony pozostaje nienaruszony, a do endpointu nie trafiają cookies.
 *
 * Invariant #7: brak identyfikatora osoby, cookies, storage i fingerprintu. Do bazy trafia
 * tylko (oferta, dzień, +1) oraz losowy nonce jednego załadowania widoku (deduplikacja retry).
 * Nie logujemy nagłówków ani adresu. Boty/prefetch → `request-filter.ts`.
 *
 * Odpowiedzi celowo nie ujawniają, czy zdarzenie zostało zliczone: 204 dla każdej poprawnej
 * próby (także bota, duplikatu, oferty niepublicznej, trybu demo), 400 dla błędnego body,
 * 429 po przekroczeniu limitu. Zawsze `no-store`, nigdy `Set-Cookie`.
 */
export const dynamic = 'force-dynamic';

const MAX_BODY_BYTES = 4096;
const NO_STORE = { 'Cache-Control': 'private, no-store' } as const;

function empty(status: number): NextResponse {
  return new NextResponse(null, { status, headers: NO_STORE });
}

/** Adres z nagłówka zaufanego proxy (jak `lib/rate-limit.ts`); używany wyłącznie w limiterze. */
function clientAddress(headers: Headers): string {
  const realIp = headers.get('x-real-ip')?.trim();
  if (realIp) return realIp;
  const forwarded = headers.get('x-forwarded-for')?.split(',').map((part) => part.trim()).filter(Boolean);
  return forwarded?.at(-1) ?? 'unknown';
}

export async function POST(request: Request): Promise<NextResponse> {
  const body = await readTextWithLimit(request, MAX_BODY_BYTES);
  if (!body.ok) return empty(413);

  let parsed: unknown;
  try {
    parsed = JSON.parse(body.text);
  } catch {
    return empty(400);
  }
  const payload = parseFunnelPayload(parsed);
  if (!payload) return empty(400);

  if (classifyFunnelRequest(request.headers) !== 'count') return empty(204);
  if (!funnelRateLimiter.hit(clientAddress(request.headers))) return empty(429);
  // Tryb demo: oferty nie pochodzą z bazy, nie ma czego zliczać.
  if (!isDatabaseConfigured()) return empty(204);

  try {
    const [{ getDomainPool }, { recordJobFunnelEvent }] = await Promise.all([
      import('@/lib/db/runtime'),
      import('@/lib/db/job-funnel'),
    ]);
    await recordJobFunnelEvent(await getDomainPool(), payload);
  } catch (error) {
    // Utrata pojedynczego zliczenia nie może psuć strony — klient nie ponawia.
    captureError(error, { area: 'job-funnel.record', event: payload.event });
  }
  return empty(204);
}

export function GET(): NextResponse {
  return new NextResponse(null, { status: 405, headers: { ...NO_STORE, Allow: 'POST' } });
}
