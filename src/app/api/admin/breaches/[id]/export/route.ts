import { NextResponse } from 'next/server';

import { breachExportCsv } from '@/lib/admin/breach';
import { parseUuid } from '@/lib/admin/list-params';
import { isSupabaseConfigured } from '@/lib/env';
import { captureError } from '@/lib/sentry';
import { createServerClient } from '@/lib/supabase/server';

/**
 * Eksport wpisu rejestru naruszeń (#490) — `GET /api/admin/breaches/<id>/export?format=json|csv`.
 *
 * Dane do przygotowania zgłoszenia (np. przepisania do formularza organu nadzorczego):
 * wpis, historia zmian i liczniki zawiadomień, bez adresów odbiorców. Odczyt i wpis w
 * historii/dzienniku robi jedno RPC `admin_export_breach_incident` pod SESJĄ administratora
 * (`is_admin()`), więc każdy eksport zostaje odnotowany. Brak sesji lub roli → 404 (nie
 * ujawniamy istnienia panelu), jak strony `/admin`. Bez env (DEMO) → 404.
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

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  const uuid = parseUuid(id);
  const format = new URL(request.url).searchParams.get('format') === 'csv' ? 'csv' : 'json';
  if (!uuid || !isSupabaseConfigured()) return notFound();

  try {
    const supabase = await createServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return notFound();

    const { data, error } = await supabase.rpc('admin_export_breach_incident', {
      p_id: uuid,
      p_format: format,
    });
    if (error) {
      const message = error.message ?? '';
      if (message.includes('NOT_FOUND') || message.includes('PERMISSION_DENIED') || message.includes('UNAUTHENTICATED')) {
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
