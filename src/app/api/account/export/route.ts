import { NextResponse } from 'next/server';

import { databaseErrorMessage, isDatabaseError } from '@/lib/db/errors';
import { getPortalIdentity, isPortalDataConfigured, withPortalTransaction } from '@/lib/db/portal';
import { rpc } from '@/lib/db/sql';
import { env } from '@/lib/env';
import { captureError } from '@/lib/sentry';

/**
 * Eksport danych kandydata (#486, prawo dostępu) — plik JSON do pobrania.
 *
 * Tylko POST z formularza tej samej witryny: cookies sesji są `SameSite=Lax`, więc obca strona
 * nie wyśle żądania z sesją; dodatkowo `Origin` musi wskazywać ten serwis. Dane buduje RPC
 * `export_my_data` (0105) pod sesją kandydata (#25: `withPortalTransaction`) — zakres, pominięcie danych innych osób, limit
 * 10 eksportów na dobę i ślad wniosku żyją w bazie. Odpowiedź `no-store` (nie trafia do cache
 * przeglądarki ani pośredników); treść nie jest logowana. Błędy bez technikaliów (Invariant #8).
 *
 * Tryb demo (bez env): pusty eksport z `demo: true` (Invariant #12) — przepływ działa bez backendu.
 */

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const HEADERS = {
  'Cache-Control': 'private, no-store',
  'X-Robots-Tag': 'noindex',
  'X-Content-Type-Options': 'nosniff',
} as const;

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

function fileName(date: Date): string {
  return `pracujbe-dane-${date.toISOString().slice(0, 10)}.json`;
}

function download(body: unknown): Response {
  return new NextResponse(JSON.stringify(body, null, 2), {
    status: 200,
    headers: {
      ...HEADERS,
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="${fileName(new Date())}"`,
    },
  });
}

function failure(error: 'forbidden' | 'unauthorized' | 'rate_limited' | 'unavailable', status: number): Response {
  return NextResponse.json({ error }, { status, headers: HEADERS });
}

export async function POST(request: Request): Promise<Response> {
  if (!sameOrigin(request)) return failure('forbidden', 403);
  if (!isPortalDataConfigured()) {
    return download({ format: 'pracujbe-export/1', demo: true, generatedAt: new Date().toISOString() });
  }

  try {
    const me = await getPortalIdentity();
    if (!me) return failure('unauthorized', 401);
    const data = await withPortalTransaction(me, (tx) => rpc(tx, 'export_my_data'));
    if (typeof data !== 'object' || data === null) return failure('unavailable', 503);
    return download(data);
  } catch (error) {
    const message = databaseErrorMessage(error);
    if (isDatabaseError(error) && message.includes('RATE_LIMITED')) return failure('rate_limited', 429);
    if (isDatabaseError(error) && (message.includes('PERMISSION_DENIED') || message.includes('UNAUTHENTICATED'))) {
      return failure('unauthorized', 401);
    }
    captureError(error, { area: 'account.export' });
    return failure('unavailable', 503);
  }
}
