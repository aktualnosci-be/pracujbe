/**
 * Sekrety zadań cron (#13). Każde zadanie ma własny sekret: `EMAIL_QUEUE_SECRET` otwiera tylko
 * `/api/email/process`, `MAINTENANCE_SECRET` tylko `/api/maintenance` — przejęcie jednego nie
 * uruchamia drugiego zadania.
 *
 * `CRON_SECRET` to sekret przejściowy (harmonogram z `vercel.json`, rollback): działa dla obu
 * zadań, dopóki zmienna jest ustawiona. Usunięcie zmiennej = koniec starej ścieżki bez zmiany
 * kodu; przywrócenie = rollback. Sekret użyty w dwóch rolach nie otwiera niczego w tej roli,
 * w której łamie rozdział (fail-closed): wspólny sekret e-mail/maintenance i `CRON_SECRET`
 * równy któremuś z nich są pomijane.
 *
 * Moduł bez importów — czytany też przez `readinessChecks()` w `env.ts`.
 */

export type CronTask = 'emailQueue' | 'maintenance';

type Env = Record<string, string | undefined>;

const DEDICATED: Record<CronTask, 'EMAIL_QUEUE_SECRET' | 'MAINTENANCE_SECRET'> = {
  emailQueue: 'EMAIL_QUEUE_SECRET',
  maintenance: 'MAINTENANCE_SECRET',
};

const OTHER: Record<CronTask, CronTask> = { emailQueue: 'maintenance', maintenance: 'emailQueue' };

function read(env: Env, name: string): string | null {
  const value = env[name];
  return value ? value : null;
}

/** Sekrety, które otwierają dane zadanie (kolejność bez znaczenia). */
export function cronSecretsFor(task: CronTask, env: Env = process.env): string[] {
  const own = read(env, DEDICATED[task]);
  const other = read(env, DEDICATED[OTHER[task]]);
  const legacy = read(env, 'CRON_SECRET');
  const secrets: string[] = [];
  if (own && own !== other) secrets.push(own);
  if (legacy && legacy !== own && legacy !== other) secrets.push(legacy);
  return secrets;
}

/** Stan rozdziału sekretów dla `/api/health` — same wartości logiczne, bez sekretów. */
export function cronSecretChecks(env: Env = process.env): {
  maintenanceSecret: boolean;
  cronSecretsSeparate: boolean;
  legacyCronSecret: boolean;
} {
  const email = read(env, DEDICATED.emailQueue);
  const maintenance = read(env, DEDICATED.maintenance);
  const legacy = read(env, 'CRON_SECRET');
  return {
    maintenanceSecret: Boolean(maintenance),
    cronSecretsSeparate: Boolean(email && maintenance && email !== maintenance && legacy !== email && legacy !== maintenance),
    legacyCronSecret: Boolean(legacy),
  };
}
