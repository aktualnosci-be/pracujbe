// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';

import { isCronAuthorized } from '@/lib/cron/auth';
import { cronSecretChecks, cronSecretsFor, type CronTask } from '@/lib/cron/secrets';

const EMAIL = 'email-queue-secret-value-0000000000';
const MAINT = 'maintenance-secret-value-00000000000';
const LEGACY = 'legacy-cron-secret-value-0000000000';

function request(secret?: string): Request {
  return new Request('http://web.railway.internal/api/task', {
    method: 'POST',
    headers: secret ? { authorization: `Bearer ${secret}` } : {},
  });
}

function stubEnv(values: Record<string, string | undefined>) {
  for (const name of ['EMAIL_QUEUE_SECRET', 'MAINTENANCE_SECRET', 'CRON_SECRET']) {
    vi.stubEnv(name, values[name] ?? '');
  }
}

afterEach(() => vi.unstubAllEnvs());

describe('sekrety zadań cron (#13)', () => {
  it('każdy sekret otwiera tylko własne zadanie', () => {
    stubEnv({ EMAIL_QUEUE_SECRET: EMAIL, MAINTENANCE_SECRET: MAINT });
    expect(isCronAuthorized(request(EMAIL), 'emailQueue')).toBe(true);
    expect(isCronAuthorized(request(MAINT), 'maintenance')).toBe(true);
    expect(isCronAuthorized(request(EMAIL), 'maintenance')).toBe(false);
    expect(isCronAuthorized(request(MAINT), 'emailQueue')).toBe(false);
  });

  it.each<CronTask>(['emailQueue', 'maintenance'])('odrzuca brak nagłówka, zły sekret i pusty Bearer (%s)', (task) => {
    stubEnv({ EMAIL_QUEUE_SECRET: EMAIL, MAINTENANCE_SECRET: MAINT });
    expect(isCronAuthorized(request(), task)).toBe(false);
    expect(isCronAuthorized(request('wrong'), task)).toBe(false);
    expect(isCronAuthorized(new Request('http://x/', { headers: { authorization: 'Bearer ' } }), task)).toBe(false);
    expect(isCronAuthorized(new Request('http://x/', { headers: { authorization: EMAIL } }), task)).toBe(false);
  });

  it('bez żadnego sekretu nic nie jest otwarte', () => {
    stubEnv({});
    expect(cronSecretsFor('emailQueue')).toEqual([]);
    expect(cronSecretsFor('maintenance')).toEqual([]);
    expect(isCronAuthorized(request(''), 'maintenance')).toBe(false);
  });

  it('CRON_SECRET działa dla obu zadań, dopóki jest ustawiony (rollback), i znika po usunięciu', () => {
    stubEnv({ EMAIL_QUEUE_SECRET: EMAIL, MAINTENANCE_SECRET: MAINT, CRON_SECRET: LEGACY });
    expect(isCronAuthorized(request(LEGACY), 'emailQueue')).toBe(true);
    expect(isCronAuthorized(request(LEGACY), 'maintenance')).toBe(true);
    stubEnv({ EMAIL_QUEUE_SECRET: EMAIL, MAINTENANCE_SECRET: MAINT });
    expect(isCronAuthorized(request(LEGACY), 'emailQueue')).toBe(false);
    expect(isCronAuthorized(request(LEGACY), 'maintenance')).toBe(false);
    expect(isCronAuthorized(request(EMAIL), 'emailQueue')).toBe(true);
  });

  it('wspólny sekret e-mail i maintenance nie otwiera żadnego zadania (fail-closed)', () => {
    stubEnv({ EMAIL_QUEUE_SECRET: EMAIL, MAINTENANCE_SECRET: EMAIL });
    expect(isCronAuthorized(request(EMAIL), 'emailQueue')).toBe(false);
    expect(isCronAuthorized(request(EMAIL), 'maintenance')).toBe(false);
    expect(cronSecretChecks().cronSecretsSeparate).toBe(false);
  });

  it('CRON_SECRET równy sekretowi e-mail nie otwiera maintenance', () => {
    stubEnv({ EMAIL_QUEUE_SECRET: EMAIL, MAINTENANCE_SECRET: MAINT, CRON_SECRET: EMAIL });
    expect(isCronAuthorized(request(EMAIL), 'emailQueue')).toBe(true);
    expect(isCronAuthorized(request(EMAIL), 'maintenance')).toBe(false);
    expect(cronSecretChecks().cronSecretsSeparate).toBe(false);
  });

  it('raportuje stan bez wartości sekretów', () => {
    stubEnv({ EMAIL_QUEUE_SECRET: EMAIL, MAINTENANCE_SECRET: MAINT, CRON_SECRET: LEGACY });
    const checks = cronSecretChecks();
    expect(checks).toEqual({ maintenanceSecret: true, cronSecretsSeparate: true, legacyCronSecret: true });
    expect(JSON.stringify(checks)).not.toMatch(/secret-value/);
    stubEnv({ EMAIL_QUEUE_SECRET: EMAIL });
    expect(cronSecretChecks()).toEqual({ maintenanceSecret: false, cronSecretsSeparate: false, legacyCronSecret: false });
  });

  // Kontrola ujemna: naiwna reguła „dowolny skonfigurowany sekret” (jak przed #13 przy
  // wspólnej wartości) otworzyłaby maintenance sekretem kolejki — ten test by to wykrył.
  it('kontrola ujemna: naiwna reguła przepuściłaby sekret e-mail do maintenance', () => {
    stubEnv({ EMAIL_QUEUE_SECRET: EMAIL, MAINTENANCE_SECRET: EMAIL });
    const naive = [process.env.MAINTENANCE_SECRET, process.env.CRON_SECRET].filter(Boolean);
    expect(naive).toContain(EMAIL);
    expect(cronSecretsFor('maintenance')).not.toContain(EMAIL);
  });
});
