import { NextResponse } from 'next/server';

import { auditExportCsv, auditExportJson } from '@/lib/admin/audit-export';
import {
  normalizeAdminSearch,
  parseAuditAction,
  parseAuditEntity,
  parseUuid,
  parseYmd,
} from '@/lib/admin/list-params';
import { exportAuditLogs } from '@/lib/data/admin';
import { isPortalDataConfigured } from '@/lib/db/portal';
import { env } from '@/lib/env';
import { captureError } from '@/lib/error-report';

/**
 * Eksport dziennika zdarzeń — `POST /api/admin/audit-export?format=csv|json&entity=&action=&actor=&from=&to=&id=`.
 *
 * Filtry i ich walidacja jak lista `/admin/dziennik` (nieznana wartość = brak filtra), od
 * najnowszego wpisu, najwyżej `AUDIT_EXPORT_LIMIT` wierszy (obcięcie: nagłówek
 * `X-Export-Truncated: true`, w JSON `truncated`, w CSV ostatni wiersz `#truncated,<limit>`).
 * Rolę admina potwierdza `exportAuditLogs` (brak sesji/roli → 404, nie ujawniamy panelu; bez
 * env/DEMO → 404). Każdy eksport zapisuje w tej samej transakcji wpis `audit_log.exported`
 * (bez treści wpisów i bez frazy aktora).
 *
 * Wyłącznie `POST` (jak eksport naruszeń, #603): eksport zapisuje zdarzenie w dzienniku, więc
 * GET (prefetch, odświeżenie, osadzony zasób) nie może go wywołać — `GET` = 405 bez zapisu.
 * `POST` wymaga zgodnego `Origin` (CSRF), odpowiedź `no-store`.
 */

export const dynamic = 'force-dynamic';

const HEADERS = {
  'Cache-Control': 'no-store, private',
  'X-Robots-Tag': 'noindex, nofollow',
  'X-Content-Type-Options': 'nosniff',
};

function empty(status: number, extra: Record<string, string> = {}): Response {
  return new NextResponse(null, { status, headers: { ...HEADERS, ...extra } });
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
  return empty(405, { Allow: 'POST' });
}

export async function POST(request: Request): Promise<Response> {
  if (!isPortalDataConfigured()) return empty(404);
  if (!sameOrigin(request)) return empty(403);

  const sp = new URL(request.url).searchParams;
  const format = sp.get('format') === 'csv' ? 'csv' : 'json';
  const filters = {
    entity: parseAuditEntity(sp.get('entity')),
    action: parseAuditAction(sp.get('action')),
    id: parseUuid(sp.get('id')),
    actor: normalizeAdminSearch(sp.get('actor') ?? undefined),
    from: parseYmd(sp.get('from')),
    to: parseYmd(sp.get('to')),
  };

  try {
    const result = await exportAuditLogs(
      {
        entity: filters.entity,
        action: filters.action,
        entityId: filters.id,
        actor: filters.actor,
        from: filters.from,
        to: filters.to,
      },
      format,
    );
    if (!result) return empty(404);

    const exportedAt = new Date();
    const stamp = exportedAt.toISOString().slice(0, 10);
    const meta = {
      'X-Export-Row-Count': String(result.rows.length),
      'X-Export-Truncated': result.truncated ? 'true' : 'false',
      'X-Export-Limit': String(result.limit),
    };
    if (format === 'csv') {
      return new NextResponse(auditExportCsv(result.rows, result), {
        status: 200,
        headers: {
          ...HEADERS,
          ...meta,
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="audit-log-${stamp}.csv"`,
        },
      });
    }
    return new NextResponse(
      auditExportJson(result.rows, { truncated: result.truncated, limit: result.limit, filters, exportedAt }),
      {
        status: 200,
        headers: {
          ...HEADERS,
          ...meta,
          'Content-Type': 'application/json; charset=utf-8',
          'Content-Disposition': `attachment; filename="audit-log-${stamp}.json"`,
        },
      },
    );
  } catch (error) {
    captureError(error, { area: 'admin.exportAuditLogs' });
    return empty(500);
  }
}
