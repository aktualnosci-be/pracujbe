/**
 * Jawna reguła wyłączania botów i podglądów z lejka ofert (#99). Czysta funkcja nagłówków —
 * testowana w `tests/unit/job-funnel-request-filter.test.ts`. Nie zapisuje ani nie loguje
 * żadnego nagłówka; decyzja zapada w pamięci i jest odrzucana.
 *
 * Żądanie NIE jest liczone, gdy:
 * 1. brak nagłówka User-Agent albo pasuje do {@link BOT_USER_AGENT} (roboty wyszukiwarek,
 *    podglądy linków w komunikatorach/sieciach społecznościowych, przeglądarki headless,
 *    biblioteki HTTP);
 * 2. to prefetch/prerender (`Sec-Purpose`/`Purpose`/`X-Purpose`/`X-Moz` = prefetch lub
 *    prerender, `Next-Router-Prefetch`);
 * 3. przyszło z innej witryny (`Sec-Fetch-Site` inne niż same-origin, gdy nagłówek jest obecny).
 */
export const BOT_USER_AGENT =
  /bot\b|bot\/|crawl|spider|slurp|mediapartners|facebookexternalhit|facebot|embedly|preview|whatsapp|telegram|skype|discord|slack|linkedinbot|pinterest|vkshare|headless|phantomjs|puppeteer|playwright|selenium|lighthouse|pagespeed|chrome-lighthouse|curl\/|wget\/|python-requests|python-urllib|httpclient|okhttp|axios\/|node-fetch|go-http-client|java\/|libwww|scrapy|monitor|uptime|pingdom/i;

const PREFETCH = /prefetch|prerender/i;

export type FunnelRequestVerdict = 'count' | 'bot' | 'prefetch' | 'cross-site';

export function classifyFunnelRequest(headers: Headers): FunnelRequestVerdict {
  const userAgent = headers.get('user-agent')?.trim() ?? '';
  if (!userAgent || BOT_USER_AGENT.test(userAgent)) return 'bot';

  for (const name of ['sec-purpose', 'purpose', 'x-purpose', 'x-moz']) {
    if (PREFETCH.test(headers.get(name) ?? '')) return 'prefetch';
  }
  if (headers.has('next-router-prefetch')) return 'prefetch';

  const fetchSite = headers.get('sec-fetch-site');
  if (fetchSite !== null && fetchSite !== 'same-origin') return 'cross-site';
  return 'count';
}
