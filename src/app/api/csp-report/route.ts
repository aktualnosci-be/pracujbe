import { NextResponse } from 'next/server';

import { readTextWithLimit } from '@/lib/http/read-limited';
import { trustedClientIp } from '@/lib/http/trusted-ip';
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
 * Limity: body ≤ 64 KB, ≤ 10 raportów przetwarzanych z żądania (dalsze pomijane, paczka nie jest
 * odrzucana w całości, #1110), 20 żądań/min z adresu i 300 wpisów/min
 * na proces (zalew raportów nie zapcha logów). Odpowiedź zawsze bez treści i `no-store`.
 *
 * Report-Only (#585) ma OSOBNĄ grupę i adres (`?policy=report-only`) oraz osobne, mniejsze
 * budżety: jego oczekiwany szum (wbudowane skrypty RSC Next.js na każdej stronie) nie może
 * zjeść limitu raportów polityki egzekwowanej. Wpis z `disposition=report` zawsze liczy się
 * do budżetu Report-Only, niezależnie od adresu, na który przyszedł.
 */
export const dynamic = 'force-dynamic';

const MAX_BODY_BYTES = 64 * 1024;
const NO_STORE = { 'Cache-Control': 'private, no-store' } as const;

const perAddress = createFunnelRateLimiter({ max: 20, windowMs: 60_000 });
const perProcess = createFunnelRateLimiter({ max: 300, windowMs: 60_000, maxKeys: 1 });
const reportOnlyPerAddress = createFunnelRateLimiter({ max: 10, windowMs: 60_000 });
const reportOnlyPerProcess = createFunnelRateLimiter({ max: 60, windowMs: 60_000, maxKeys: 1 });

function isReportOnlyRequest(request: Request): boolean {
  return new URL(request.url).searchParams.get('policy') === 'report-only';
}

function empty(status: number): NextResponse {
  return new NextResponse(null, { status, headers: NO_STORE });
}

/**
 * Adres niepoprawny albo nieustalony → wspólny zastępczy klucz (jak `lib/rate-limit.ts`).
 * Brak nagłówka proxy nie może ani wyłączać limitu (klucz zmienny na życzenie klienta),
 * ani blokować całego ruchu — wszystkie takie żądania dzielą jedną, wspólną pulę.
 */
const UNKNOWN_IP = '0.0.0.0';

/**
 * Adres z JEDYNEGO, jawnie skonfigurowanego, zaufanego nagłówka proxy (#588/#602,
 * `@/lib/http/trusted-ip`) — NIGDY z `X-Forwarded-For`, który klient dopisuje sam i może
 * dowolnie zmieniać przy każdym żądaniu, omijając limiter (#648).
 */
function clientAddress(headers: Headers): string {
  return trustedClientIp(headers) ?? UNKNOWN_IP;
}

export async function POST(request: Request): Promise<NextResponse> {
  if (!isCspReportContentType(request.headers.get('content-type'))) return empty(415);
  const addressLimiter = isReportOnlyRequest(request) ? reportOnlyPerAddress : perAddress;
  if (!addressLimiter.hit(clientAddress(request.headers))) return empty(429);

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
    const budget = violation.disposition === 'report' ? reportOnlyPerProcess : perProcess;
    if (!budget.hit('process')) continue;
    console.warn('[csp-report]', JSON.stringify(violation));
  }
  return empty(204);
}

export function GET(): NextResponse {
  return new NextResponse(null, { status: 405, headers: { ...NO_STORE, Allow: 'POST' } });
}
