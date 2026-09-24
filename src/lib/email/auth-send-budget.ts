import type { createAdminClient } from '@/lib/supabase/admin';
import { captureError } from '@/lib/sentry';

/**
 * Budżet wysyłki e-maili Auth (#45) — `take_email_send_budget` (0087) dla puli `auth`.
 *
 * Pula `auth` ma sufit równy limitowi dostawcy, a newsletter i powiadomienia kończą się
 * wcześniej (rezerwy), więc odmowa oznacza, że okno dostawcy jest już pełne. Awaria bazy
 * lub brak klienta service-role NIE blokuje e-maila logowania/resetu (fail-open): limit
 * dostawcy pozostaje ostatnią granicą, a błąd trafia do Sentry.
 */

type AdminClient = ReturnType<typeof createAdminClient>;

export type AuthBudgetResult =
  | { status: 'granted' | 'skipped' }
  | { status: 'denied'; retryAfterSeconds: number };

export async function takeAuthSendBudget(
  admin: AdminClient | null,
  template: string,
  now: () => number = Date.now,
): Promise<AuthBudgetResult> {
  let client = admin;
  try {
    if (!client) {
      if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return { status: 'skipped' };
      client = (await import('@/lib/supabase/admin')).createAdminClient();
    }
    const { data, error } = await client.rpc('take_email_send_budget', { p_template: template });
    if (error) {
      captureError(error, { area: 'auth.email-hook.budget' });
      return { status: 'skipped' };
    }
    const grant = (Array.isArray(data) ? data[0] : data) as
      | { granted?: boolean; retry_at?: string | null }
      | null
      | undefined;
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
