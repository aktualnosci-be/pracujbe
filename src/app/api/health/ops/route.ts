import { domainPoolStats } from '@/lib/db/runtime';
import { backupAlerts, readBackupFreshness } from '@/lib/ops/backup-freshness';
import { HEALTH_TOKEN_HEADER, healthTokenMatches } from '@/lib/ops/health-token';
import { readOpsMetrics, readSchemaState } from '@/lib/ops/metrics-source';
import { expectedMigrationFromEnv, schemaAlerts, schemaSummary } from '@/lib/ops/schema-state';
import { evaluateOps } from '@/lib/ops/sensors';
import { portalLegalModeAlerts, portalLegalModeSummary } from '@/lib/ops/portal-mode';
import { isRecruitmentEnabled } from '@/lib/portal-mode';

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
 * #1143: `portal_legal_mode_mismatch` — env `PORTAL_LEGAL_MODE` i tryb w bazie (0171) różnią się
 * (503 `alert`); `portalLegalMode` = nazwy trybów env/bazy/efektywnego.
 *
 * #1065: `schema_behind_code` — najwyższa zastosowana migracja (`ops_schema_state()`, 0964) jest starsza
 * niż ta, którą zna wdrożony kod (`PRACUJBE_EXPECTED_MIGRATION` z builda): przepływy z nowymi
 * funkcjami bazy dostaną `INTERNAL` do czasu migracji (503 `alert`); `schema_state_unreadable` —
 * stanu nie da się odczytać. `schema` = nazwy migracji (oczekiwana/zastosowana), bez konfiguracji.
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
  // Stan schematu czytamy tylko, gdy build zna oczekiwaną migrację (dev/testy bez niej nie płacą zapytaniem).
  const expectedMigration = expectedMigrationFromEnv();
  const [result, backup, schemaState] = await Promise.all([
    readOpsMetrics(),
    readBackupFreshness(),
    expectedMigration ? readSchemaState() : Promise.resolve({ kind: 'unconfigured' } as const),
  ]);
  if (result.kind !== 'ok') {
    const status = result.kind === 'unconfigured' ? 'unconfigured' : 'unavailable';
    return Response.json({ status, checkedAt, backup }, { status: 503, headers });
  }

  const appPool = domainPoolStats();
  const evaluation = evaluateOps(result.metrics, appPool, result.aiBudget);
  // #1143: env i baza muszą mówić to samo; rozbieżność = alarm (tryb efektywny i tak ogłoszeniowy).
  const envRecruitment = isRecruitmentEnabled();
  const dbRecruitment = result.metrics.portalLegalMode?.recruitmentEnabled;
  const alerts = [
    ...evaluation.alerts,
    ...portalLegalModeAlerts(dbRecruitment, envRecruitment),
    ...backupAlerts(backup),
    ...schemaAlerts(expectedMigration, schemaState),
  ];
  const status = alerts.length ? 'alert' : 'ok';
  const portalLegalMode = portalLegalModeSummary(dbRecruitment, envRecruitment);
  return Response.json(
    { ...evaluation, status, alerts, checkedAt, metrics: result.metrics, appPool, aiBudget: result.aiBudget ?? null, backup, portalLegalMode, schema: schemaSummary(expectedMigration, schemaState) },
    { status: status === 'ok' ? 200 : 503, headers },
  );
}
