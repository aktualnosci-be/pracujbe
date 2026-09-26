import 'server-only';

import {
  buildWebVitalsRequest,
  parseWebVitalsResponse,
  readWebVitalsConfig,
  webVitalsDateRange,
  type WebVitalsPeriod,
  type WebVitalsReport,
} from '@/lib/web-vitals/field-report';

/**
 * Klient GraphQL Analytics API Cloudflare dla danych polowych CWV (tylko serwer, tylko odczyt).
 * Token w nagłówku `Authorization`, nigdy w adresie ani w logach; timeout 8 s; wynik = jawny
 * stan (`unconfigured` / `error` z kodem / `ok`). Wywołuje go wyłącznie panel admina.
 */

export const CF_GRAPHQL_ENDPOINT = 'https://api.cloudflare.com/client/v4/graphql';
const TIMEOUT_MS = 8000;

export type FieldWebVitalsResult =
  | { status: 'unconfigured' }
  | { status: 'error'; code: 'CF_HTTP_ERROR' | 'CF_TIMEOUT' | 'CF_API_ERROR' | 'CF_BAD_RESPONSE' }
  | { status: 'ok'; report: WebVitalsReport; accountId: string | null; demo: boolean };

export async function fetchFieldWebVitals(
  period: WebVitalsPeriod,
  options: { env?: Record<string, string | undefined>; fetchImpl?: typeof fetch; now?: Date } = {},
): Promise<FieldWebVitalsResult> {
  const config = readWebVitalsConfig(options.env ?? process.env);
  if (!config) return { status: 'unconfigured' };
  const now = options.now ?? new Date();
  const doFetch = options.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await doFetch(CF_GRAPHQL_ENDPOINT, {
      method: 'POST',
      headers: { authorization: `Bearer ${config.apiToken}`, 'content-type': 'application/json' },
      body: JSON.stringify(buildWebVitalsRequest(config, period, now)),
      cache: 'no-store',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    const timeout = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
    return { status: 'error', code: timeout ? 'CF_TIMEOUT' : 'CF_HTTP_ERROR' };
  }
  if (!response.ok) return { status: 'error', code: 'CF_HTTP_ERROR' };
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { status: 'error', code: 'CF_BAD_RESPONSE' };
  }
  const parsed = parseWebVitalsResponse(body, webVitalsDateRange(period, now));
  if (!parsed.ok) return { status: 'error', code: parsed.code };
  return { status: 'ok', report: parsed.report, accountId: config.accountId, demo: false };
}
