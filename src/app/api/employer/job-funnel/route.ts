import { NextResponse } from 'next/server';
import { getTranslations } from 'next-intl/server';

import { isLocale } from '@/i18n/routing';
import { getJobFunnel } from '@/lib/data/employer';
import { getPortalIdentity, isPortalDataConfigured } from '@/lib/db/portal';
import { captureError } from '@/lib/error-report';
import { jobFunnelCsv, jobFunnelCsvFilename } from '@/lib/job-funnel/csv';
import { parseFunnelRange } from '@/lib/job-funnel/range';

/**
 * Eksport lejka ofert (#99) do CSV — `GET /api/employer/job-funnel?dni=7|30|90&locale=pl`.
 *
 * Te same dane co `/employer/statystyki`: `getJobFunnel` pod sesją/RLS, RPC
 * `get_company_job_funnel` (recruiter+ AKTYWNEJ firmy, 0089 — uprawnienia egzekwuje baza).
 * Zakres jak na stronie (`parseFunnelRange`: nieznana wartość = domyślne 30 dni), nagłówki
 * kolumn i statusy w języku panelu (`locale`, spoza listy = 400). Tylko odczyt — bez zapisu,
 * więc GET jest bezpieczny dla prefetchu.
 *
 * Kody: tryb demo (bez bazy) = 404 (danych demonstracyjnych nie eksportujemy), brak sesji =
 * 401, brak firmy albo rola bez prawa do lejka (`member`) = 403, awaria odczytu = 500 bez treści
 * (Invariant #8). Odpowiedź nigdy nie jest cache'owana ani indeksowana.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const BASE_HEADERS = {
  'Cache-Control': 'private, no-store',
  'X-Robots-Tag': 'noindex, nofollow, noarchive',
  'X-Content-Type-Options': 'nosniff',
} as const;

function empty(status: number): NextResponse {
  return new NextResponse(null, { status, headers: BASE_HEADERS });
}

export async function GET(request: Request): Promise<NextResponse> {
  const search = new URL(request.url).searchParams;
  const locale = search.get('locale') ?? 'pl';
  if (!isLocale(locale)) return empty(400);
  if (!isPortalDataConfigured()) return empty(404);

  try {
    const me = await getPortalIdentity();
    if (!me) return empty(401);

    const funnel = await getJobFunnel(parseFunnelRange(search.get('dni')));
    if (funnel.status === 'denied') return empty(403);
    if (funnel.status === 'error') return empty(500);

    const [t, ts] = await Promise.all([
      getTranslations({ locale, namespace: 'jobFunnel' }),
      getTranslations({ locale, namespace: 'status' }),
    ]);
    const csv = jobFunnelCsv(funnel.range, funnel.jobs, funnel.totals, {
      from: t('csvFrom'),
      to: t('csvTo'),
      offer: t('offer'),
      status: t('csvStatus'),
      searchAppearances: t('searchAppearances'),
      detailViews: t('detailViews'),
      applyStarted: t('applyStarted'),
      applicationsSubmitted: t('applicationsSubmitted'),
      total: t('csvTotal'),
      untitled: t('untitled'),
      statusLabel: (status) => (/^[a-z]+$/.test(status) && ts.has(status) ? ts(status) : ''),
    });
    return new NextResponse(csv, {
      status: 200,
      headers: {
        ...BASE_HEADERS,
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${jobFunnelCsvFilename(funnel.range)}"`,
      },
    });
  } catch (error) {
    captureError(error, { area: 'employer.jobFunnelCsv' });
    return empty(500);
  }
}
