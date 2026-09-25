import { NextResponse } from 'next/server';

import { breachExportCsv } from '@/lib/admin/breach';
import { parseUuid } from '@/lib/admin/list-params';
import { databaseErrorMessage, isDatabaseError } from '@/lib/db/errors';
import { getPortalIdentity, isPortalDataConfigured, withPortalTransaction } from '@/lib/db/portal';
import { rpc } from '@/lib/db/sql';
import { env } from '@/lib/env';
import { captureError } from '@/lib/error-report';

/**
 * Eksport wpisu rejestru naruszeń (#490) — `POST /api/admin/breaches/<id>/export?format=json|csv`.
 *
 * Dane do przygotowania zgłoszenia (np. przepisania do formularza organu nadzorczego):
 * wpis, historia zmian i liczniki zawiadomień, bez adresów odbiorców. Odczyt i wpis w
 * historii/dzienniku robi jedno RPC `admin_export_breach_incident` pod SESJĄ administratora
 * (`withPortalTransaction`, `is_admin()`), więc każdy eksport zostaje odnotowany. Brak sesji lub roli → 404 (nie
 * ujawniamy istnienia panelu), jak strony `/admin`. Bez env (DEMO) → 404.
 *
 * Wyłącznie `POST` (#603): eksport zapisuje zdarzenie w historii incydentu i w dzienniku
 * audytowym, więc nie może być dostępny przez bezpieczną metodę GET (prefetch, odświeżenie,
 * osadzony zasób nie mogą mnożyć zdarzeń). `GET` zwraca `405` bez autoryzacji ani zapisu.
 * `POST` dodatkowo wymaga zgodnego `Origin` (jak `/api/account/export`) — samo `SameSite=Lax`
 * na cookie sesji nie chroni każdej nawigacji GET, ale chroni żądanie POST z obcej strony.
 */

export const dynamic = 'force-dynamic';

const HEADERS = {
  'Cache-Control': 'no-store, private',
  'X-Robots-Tag': 'noindex, nofollow',
  'X-Content-Type-Options': 'nosniff',
};

function notFound(): Response {
  return new NextResponse(null, { status: 404, headers: HEADERS });
}

function methodNotAllowed(): Response {
  return new NextResponse(null, { status: 405, headers: { ...HEADERS, Allow: 'POST' } });
}

function forbidden(): Response {
  return new NextResponse(null, { status: 403, headers: HEADERS });
}

function sameOrigin(request: Request): boolean {
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

export async function GET(): Promise<Response> {
  return methodNotAllowed();
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  const uuid = parseUuid(id);
  const format = new URL(request.url).searchParams.get('format') === 'csv' ? 'csv' : 'json';
  if (!uuid || !isPortalDataConfigured()) return notFound();
  if (!sameOrigin(request)) return forbidden();

  try {
    const me = await getPortalIdentity();
    if (!me) return notFound();

    let data: unknown;
    try {
      data = await withPortalTransaction(me, (tx) =>
        rpc(tx, 'admin_export_breach_incident', { p_id: uuid, p_format: format }),
      );
    } catch (error) {
      const message = databaseErrorMessage(error);
      if (isDatabaseError(error) && (message.includes('NOT_FOUND') || message.includes('PERMISSION_DENIED') || message.includes('UNAUTHENTICATED'))) {
        return notFound();
      }
      throw error;
    }
    const exported = typeof data === 'object' && data !== null ? (data as Record<string, unknown>) : {};
    const incident =
      typeof exported['incident'] === 'object' && exported['incident'] !== null
        ? (exported['incident'] as Record<string, unknown>)
        : {};
    const reference = typeof incident['reference'] === 'string' ? incident['reference'] : 'breach';
    const safeName = reference.replace(/[^A-Za-z0-9-]/g, '') || 'breach';

    if (format === 'csv') {
      return new NextResponse(breachExportCsv(exported), {
        status: 200,
        headers: {
          ...HEADERS,
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="${safeName}.csv"`,
        },
      });
    }
    return new NextResponse(`${JSON.stringify(exported, null, 2)}\n`, {
      status: 200,
      headers: {
        ...HEADERS,
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="${safeName}.json"`,
      },
    });
  } catch (error) {
    captureError(error, { area: 'admin.exportBreachIncident' });
    return new NextResponse(null, { status: 500, headers: HEADERS });
  }
}
