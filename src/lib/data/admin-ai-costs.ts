/**
 * Warstwa danych panelu administratora — koszty AI (#36).
 *
 * Jak `@/lib/data/admin`: funkcja sama potwierdza rolę admina (`requireAdmin`) PRZED otwarciem
 * transakcji service-role (`ai_cost_report` jest dostępne tylko dla service_role). Bez
 * konfiguracji bazy — pusty raport trybu DEMO z limitami startowymi.
 */

import { emptyAiCostReport, parseAiCostReport, type AiCostReport } from '@/lib/admin/ai-costs';
import { requireAdmin } from '@/lib/data/admin';
import { isPortalDataConfigured, withServiceRole } from '@/lib/db/portal';
import { rpc } from '@/lib/db/sql';
import { captureError } from '@/lib/error-report';

export type AiCostReportResult = { status: 'ok'; report: AiCostReport; demo: boolean } | { status: 'error' };

export async function getAiCostReport(days = 31): Promise<AiCostReportResult> {
  if (!isPortalDataConfigured()) return { status: 'ok', report: emptyAiCostReport(), demo: true };
  await requireAdmin();
  try {
    const data = await withServiceRole((tx) => rpc(tx, 'ai_cost_report', { p_days: days }));
    const report = parseAiCostReport(data);
    if (!report) throw new Error('ai_cost_report: nieoczekiwana odpowiedź');
    return { status: 'ok', report, demo: false };
  } catch (error) {
    captureError(error, { area: 'adminAiCosts.report' });
    return { status: 'error' };
  }
}
