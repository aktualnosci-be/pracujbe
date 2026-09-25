import { NextResponse } from 'next/server';

import { isLocale } from '@/i18n/routing';
import { bannerFontBase64 } from '@/lib/campaign-banner/font';
import { isBannerFormat, renderCampaignBanner } from '@/lib/campaign-banner/render';
import { campaignBannerTexts, isCampaignJobId, loadManagedCampaignJob } from '@/lib/campaign-banner/source';
import { getPortalIdentity, isPortalDataConfigured } from '@/lib/db/portal';
import { checkRateLimit } from '@/lib/rate-limit';
import { captureError } from '@/lib/error-report';

/**
 * Eksport baneru kampanii z oferty (#175, dane z #186): `GET ?format=1200x300&locale=pl`,
 * `&download=1` = załącznik. Dostęp: zalogowany recruiter+ firmy oferty albo administrator —
 * egzekwuje baza (`get_managed_campaign_job`, 0102). Oferta nieaktywna/wygasła/demo/cudza/
 * nieistniejąca = ten sam 404. Tryb demo (bez bazy) = 404: danych demonstracyjnych nie eksportujemy.
 *
 * Odpowiedź nigdy nie jest cache'owana ani indeksowana (`private, no-store`, `X-Robots-Tag`),
 * a CSP/`sandbox` blokują wykonanie czegokolwiek, gdyby SVG otwarto jako dokument.
 * Limit: 60 banerów na godzinę na konto.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const RATE_LIMIT = { max: 60, windowSeconds: 3600 } as const;

const BASE_HEADERS = {
  'Cache-Control': 'private, no-store',
  'X-Robots-Tag': 'noindex, nofollow, noarchive',
  'X-Content-Type-Options': 'nosniff',
} as const;

function empty(status: number): NextResponse {
  return new NextResponse(null, { status, headers: BASE_HEADERS });
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  const search = new URL(request.url).searchParams;
  const format = search.get('format') ?? '1200x300';
  const locale = search.get('locale') ?? 'pl';
  if (!isCampaignJobId(id) || !isBannerFormat(format) || !isLocale(locale)) return empty(400);
  if (!isPortalDataConfigured()) return empty(404);

  try {
    const me = await getPortalIdentity();
    if (!me) return empty(401);

    const allowed = await checkRateLimit('campaign-banner', { identifier: me.id, perIp: false, ...RATE_LIMIT });
    if (!allowed) return empty(429);

    const loaded = await loadManagedCampaignJob(me, id, locale);
    if (loaded.status === 'error') return empty(500);
    if (loaded.status === 'unavailable') return empty(404);

    const svg = renderCampaignBanner({
      format,
      locale,
      job: loaded.job,
      texts: await campaignBannerTexts(loaded.job, locale),
      fontWoff2Base64: await bannerFontBase64(),
    });
    const filename = `pracujbe-${loaded.job.slug}-${locale}-${format}.svg`;
    return new NextResponse(svg, {
      status: 200,
      headers: {
        ...BASE_HEADERS,
        'Content-Type': 'image/svg+xml; charset=utf-8',
        'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; font-src data:; sandbox",
        'Content-Disposition': `${search.get('download') === '1' ? 'attachment' : 'inline'}; filename="${filename}"`,
      },
    });
  } catch (error) {
    captureError(error, { area: 'campaign-banner' });
    return empty(500);
  }
}
