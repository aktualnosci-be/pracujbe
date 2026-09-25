import { NextResponse } from 'next/server';

import { readTextWithLimit } from '@/lib/http/read-limited';
import { createFunnelRateLimiter } from '@/lib/job-funnel/rate-limit';
import { isCspReportContentType, parseCspReports } from '@/lib/security/csp-report';

/**
 * Odbiór raportów naruszeń CSP (#47) — `report-uri` i `report-to` z `next.config.mjs`.
 * Endpoint tylko zapisuje raport w logu serwera; nie zmienia polityki ani niczego w bazie.
 *
 * Bez danych osobowych: z raportu zostaje dyrektywa, rodzaj/origin zablokowanego zasobu,
 * ścieżka strony bez query i identyfikatorów (`src/lib/security/csp-report.ts`). Nie
 * logujemy nagłówków, adresu IP, user agenta, `script-sample` ani referrera. Adres służy
 * wyłącznie limiterowi (HMAC z solą procesu, bez zapisu).
 *
 * Limity: body ≤ 16 KB, ≤ 10 raportów w żądaniu, 20 żądań/min z adresu i 300 wpisów/min
 * na proces (zalew raportów nie zapcha logów). Odpowiedź zawsze bez treści i `no-store`.
 */
export const dynamic = 'force-dynamic';

const MAX_BODY_BYTES = 16 * 1024;
const NO_STORE = { 'Cache-Control': 'private, no-store' } as const;

const perAddress = createFunnelRateLimiter({ max: 20, windowMs: 60_000 });
const perProcess = createFunnelRateLimiter({ max: 300, windowMs: 60_000, maxKeys: 1 });

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
  if (!isCspReportContentType(request.headers.get('content-type'))) return empty(415);
  if (!perAddress.hit(clientAddress(request.headers))) return empty(429);

  const body = await readTextWithLimit(request, MAX_BODY_BYTES);
  if (!body.ok) return empty(413);

  let parsed: unknown;
  try {
    parsed = JSON.parse(body.text);
  } catch {
    return empty(400);
  }
  const violations = parseCspReports(parsed);
  if (!violations) return empty(400);

  for (const violation of violations) {
    // Po przekroczeniu budżetu procesu raporty są odrzucane po cichu (przeglądarka nie ponawia).
    if (!perProcess.hit('process')) break;
    console.warn('[csp-report]', JSON.stringify(violation));
  }
  return empty(204);
}

export function GET(): NextResponse {
  return new NextResponse(null, { status: 405, headers: { ...NO_STORE, Allow: 'POST' } });
}
