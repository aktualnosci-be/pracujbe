import { domainPoolStats } from '@/lib/db/runtime';
import { backupAlerts, readBackupFreshness } from '@/lib/ops/backup-freshness';
import { HEALTH_TOKEN_HEADER, healthTokenMatches } from '@/lib/ops/health-token';
import { readOpsMetrics } from '@/lib/ops/metrics-source';
import { evaluateOps } from '@/lib/ops/sensors';

/**
 * Czujki operacyjne (#47) — wyłącznie dla monitoringu wewnętrznego.
 *
 * Wymaga `HEALTH_CHECK_SECRET` w nagłówku `x-health-token` ZAWSZE (także poza produkcją).
 * Bez skonfigurowanego sekretu albo z błędnym tokenem → 404: endpoint nie potwierdza
 * nawet swojego istnienia. Odpowiedź zawiera same liczby i kody sygnałów
 * (`src/lib/ops/sensors.ts`) — bez adresów, treści, identyfikatorów i konfiguracji.
 *
 * HTTP 200 `ok` — brak alarmów (także sygnał recovery po alarmie);
 * HTTP 503 `alert` — co najmniej jeden próg przekroczony (kody w `alerts`);
 * HTTP 503 `unavailable` — metryk nie da się odczytać (baza/konfiguracja; szczegół w kanale błędów);
 * HTTP 503 `unconfigured` — brak źródła metryk (`DATABASE_OPS_URL` ani service-role).
 *
 * #569: `backup` = wiek ostatniej kopii w R2 (klucz odczytu `BACKUP_S3_READ_*`). Każdy stan
 * poza `ok` — także `unconfigured` — dokłada alarm `backup_*` do `alerts` (503).
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const headers = { 'cache-control': 'no-store' } as const;

export async function GET(request: Request): Promise<Response> {
  if (!healthTokenMatches(request.headers.get(HEALTH_TOKEN_HEADER))) {
    return Response.json({ error: 'not_found' }, { status: 404, headers });
  }

  const checkedAt = new Date().toISOString();
  const [result, backup] = await Promise.all([readOpsMetrics(), readBackupFreshness()]);
  if (result.kind !== 'ok') {
    const status = result.kind === 'unconfigured' ? 'unconfigured' : 'unavailable';
    return Response.json({ status, checkedAt, backup }, { status: 503, headers });
  }

  const appPool = domainPoolStats();
  const evaluation = evaluateOps(result.metrics, appPool, result.aiBudget);
  const alerts = [...evaluation.alerts, ...backupAlerts(backup)];
  const status = alerts.length ? 'alert' : 'ok';
  return Response.json(
    { ...evaluation, status, alerts, checkedAt, metrics: result.metrics, appPool, aiBudget: result.aiBudget ?? null, backup },
    { status: status === 'ok' ? 200 : 503, headers },
  );
}
