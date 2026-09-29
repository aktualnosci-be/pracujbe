import { HEALTH_TOKEN_HEADER, healthTokenMatches } from '@/lib/ops/health-token';
import { readOpsStatus } from '@/lib/ops/status';

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
 * #569: `backup` = wiek ostatniej kopii w R2 (klucz odczytu `BACKUP_S3_READ_*`). Każdy stan
 * poza `ok` — także `unconfigured` — dokłada alarm `backup_*` do `alerts` (503).
 *
 * 0180: `maintenanceRun` = ostatni przebieg `/api/maintenance` (brak = ostrzeżenie, > 2 h = alarm).
 * Ten sam odczyt (`readOpsStatus`) pokazuje panel `/admin/operacje`.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const headers = { 'cache-control': 'no-store' } as const;

export async function GET(request: Request): Promise<Response> {
  if (!healthTokenMatches(request.headers.get(HEALTH_TOKEN_HEADER))) {
    return Response.json({ error: 'not_found' }, { status: 404, headers });
  }

  const checkedAt = new Date().toISOString();
  const result = await readOpsStatus();
  if (result.kind !== 'ok') {
    return Response.json({ status: result.kind, checkedAt, backup: result.backup }, { status: 503, headers });
  }

  const { status, alerts, warnings, metrics, appPool, aiBudget, maintenanceRun, backup, portalLegalMode } = result;
  return Response.json(
    { status, alerts, warnings, checkedAt, metrics, appPool, aiBudget, maintenanceRun: maintenanceRun ?? null, backup, portalLegalMode },
    { status: status === 'ok' ? 200 : 503, headers },
  );
}
