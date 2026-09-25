import { isServiceDatabaseConfigured, withServiceRole } from '@/lib/db/portal';
import { rpcRows } from '@/lib/db/sql';
import { captureError } from '@/lib/sentry';

/**
 * Budżet wysyłki e-maili Auth (#45) — `take_email_send_budget` (0087) dla puli `auth`.
 *
 * Pula `auth` ma sufit równy limitowi dostawcy, a newsletter i powiadomienia kończą się
 * wcześniej (rezerwy), więc odmowa oznacza, że okno dostawcy jest już pełne. Awaria bazy
 * lub brak puli service_role (#25: `DATABASE_SERVICE_URL`) NIE blokuje e-maila
 * logowania/resetu (fail-open): limit dostawcy pozostaje ostatnią granicą, a błąd trafia
 * do Sentry. Pobranie budżetu to własna, krótka transakcja service_role.
 */

export type AuthBudgetResult =
  | { status: 'granted' | 'skipped' }
  | { status: 'denied'; retryAfterSeconds: number };

export async function takeAuthSendBudget(
  template: string,
  now: () => number = Date.now,
): Promise<AuthBudgetResult> {
  if (!isServiceDatabaseConfigured()) return { status: 'skipped' };
  try {
    const [grant] = await withServiceRole((tx) =>
      rpcRows<{ granted?: boolean; retry_at?: string | null }>(tx, 'take_email_send_budget', {
        p_template: template,
      }),
    );
    if (grant?.granted === false) {
      const retryAt = grant.retry_at ? Date.parse(grant.retry_at) : Number.NaN;
      const seconds = Number.isNaN(retryAt) ? 60 : Math.ceil((retryAt - now()) / 1000);
      return { status: 'denied', retryAfterSeconds: Math.min(Math.max(seconds, 1), 3600) };
    }
    return { status: grant?.granted === true ? 'granted' : 'skipped' };
  } catch (err) {
    captureError(err, { area: 'auth.email-hook.budget' });
    return { status: 'skipped' };
  }
}
