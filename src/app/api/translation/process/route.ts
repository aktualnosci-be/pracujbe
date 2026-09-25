import { NextResponse } from 'next/server';

import { isCronAuthorized } from '@/lib/cron/auth';
import { isServiceDatabaseConfigured } from '@/lib/db/portal';
import { isProductionMode } from '@/lib/env';
import { captureError } from '@/lib/sentry';
import { isTranslationEnabled } from '@/lib/translation/config';
import { createTranslationProvider, runTranslationQueue } from '@/lib/translation/run';
import { serviceTranslationStore } from '@/lib/translation/store';

/**
 * Worker kolejki tłumaczeń ofert (#33) — `/api/translation/process`, wołany przez cron
 * (`scripts/railway-cron-call.mjs`, `CRON_AUTH_SECRET` = `MAINTENANCE_SECRET`).
 * Chroniony sekretem zadania `maintenance` (`MAINTENANCE_SECRET`, przejściowo `CRON_SECRET`;
 * `src/lib/cron/secrets.ts`) w `Authorization: Bearer`.
 *
 * Bez flagi `AI_TRANSLATION_ENABLED` (domyślnie) nic nie robi — nie łączy się z bazą ani
 * z dostawcą. Odpowiedź i log zawierają tylko liczniki i kody (bez treści ofert).
 */

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

async function run(request: Request): Promise<Response> {
  if (!isCronAuthorized(request, 'maintenance')) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  if (!isTranslationEnabled()) {
    return NextResponse.json({ ok: true, skipped: 'disabled' });
  }
  if (!isServiceDatabaseConfigured()) {
    if (isProductionMode()) return NextResponse.json({ error: 'unconfigured' }, { status: 503 });
    return NextResponse.json({ ok: true, skipped: 'unconfigured' });
  }
  const provider = createTranslationProvider();
  if (!provider) return NextResponse.json({ ok: true, skipped: 'disabled' });
  try {
    const result = await runTranslationQueue({ store: serviceTranslationStore(), provider });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    // Błąd claimu (baza) — 503 dla crona i monitoringu, bez szczegółów.
    captureError(error, { area: 'translation.worker' });
    return NextResponse.json({ error: 'translation worker failed' }, { status: 503 });
  }
}

export async function GET(request: Request): Promise<Response> {
  return run(request);
}
export async function POST(request: Request): Promise<Response> {
  return run(request);
}
