// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import worker, {
  CRON_TASKS,
  handleScheduled,
  runTask,
  taskUrl,
} from '../../infra/cloudflare-cron/src/worker.mjs';
import { CRON_PATHS } from '../../scripts/railway-cron-call.mjs';

/**
 * Cloudflare Worker z Cron Triggers (zastępczy harmonogram bez usługi cron w Railway,
 * docs/CLOUDFLARE_CRON.md). Atrapa `fetch` — żaden test nie wysyła żądania.
 */

const ROOT = join(__dirname, '..', '..');
const EMAIL_SECRET = 'email-queue-secret-value-0000000000';
const MAINT_SECRET = 'maintenance-secret-value-00000000000';
const env = {
  CRON_BASE_URL: 'https://pracuj.be',
  EMAIL_QUEUE_SECRET: EMAIL_SECRET,
  MAINTENANCE_SECRET: MAINT_SECRET,
};
const EMAIL = CRON_TASKS['*/5 * * * *'];
const MAINT = CRON_TASKS['0 * * * *'];
const TRANSLATION = CRON_TASKS['*/10 * * * *'];
const logger = () => ({ log: vi.fn(), error: vi.fn() });

function allLogs(l: ReturnType<typeof logger>): string {
  return JSON.stringify([...l.log.mock.calls, ...l.error.mock.calls]);
}

afterEach(() => vi.useRealTimers());

describe('Cloudflare cron worker — konfiguracja', () => {
  it('harmonogramy w wrangler.toml = zadania workera; ścieżki = zadania callera Railway', () => {
    const toml = readFileSync(join(ROOT, 'infra/cloudflare-cron/wrangler.toml'), 'utf8');
    const crons = JSON.parse(/^crons\s*=\s*(\[.*\])$/mu.exec(toml)![1]!) as string[];
    expect(crons.sort()).toEqual(Object.keys(CRON_TASKS).sort());
    expect(Object.values(CRON_TASKS).map((t) => t.path).sort()).toEqual([...CRON_PATHS].sort());
    expect(EMAIL.path).toBe('/api/email/process');
    expect(MAINT.path).toBe('/api/maintenance');
    // #33: worker tłumaczeń chroni sekret maintenance (route: src/app/api/translation/process).
    expect(TRANSLATION).toMatchObject({ path: '/api/translation/process', secret: 'MAINTENANCE_SECRET' });
  });

  it('wrangler.toml nie zawiera sekretów, a worker nie ma adresu HTTP', () => {
    const toml = readFileSync(join(ROOT, 'infra/cloudflare-cron/wrangler.toml'), 'utf8');
    expect(toml).not.toMatch(/^\s*(EMAIL_QUEUE_SECRET|MAINTENANCE_SECRET|CRON_SECRET)\s*=/mu);
    expect(toml).toMatch(/^workers_dev\s*=\s*false$/mu);
    expect(toml).not.toMatch(/^\s*routes?\s*=/mu);
    expect((worker as Record<string, unknown>).fetch).toBeUndefined();
  });

  it.each([
    ['http://pracuj.be', null],
    ['https://pracuj.be/api', null],
    ['https://user:pw@pracuj.be', null],
    ['https://pracuj.be?x=1', null],
    ['https://pracuj.be#x', null],
    ['nie adres', null],
    [undefined, null],
    ['https://pracuj.be', 'https://pracuj.be/api/maintenance'],
    ['https://pracuj.be/', 'https://pracuj.be/api/maintenance'],
  ])('adres bazowy %j → %j', (base, expected) => {
    expect(taskUrl(base, '/api/maintenance')).toBe(expected);
  });
});

describe('Cloudflare cron worker — wywołanie', () => {
  it.each([
    { ...env, EMAIL_QUEUE_SECRET: undefined },
    { ...env, EMAIL_QUEUE_SECRET: '' },
    { ...env, EMAIL_QUEUE_SECRET: 'secret\r\nInjected: value' },
    { ...env, CRON_BASE_URL: 'http://pracuj.be' },
    { ...env, CRON_BASE_URL: undefined },
    { ...env, CRON_TIMEOUT_SECONDS: '0' },
    { ...env, CRON_TIMEOUT_SECONDS: '601' },
    { ...env, CRON_TIMEOUT_SECONDS: '1.5' },
  ])('błędna konfiguracja → 2 bez żądania (%j)', async (configuration) => {
    const fetchImpl = vi.fn();
    const l = logger();
    expect(await runTask({ task: EMAIL, env: configuration, fetchImpl, logger: l })).toBe(2);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(allLogs(l)).not.toContain('secret');
  });

  it('jeden POST z sekretem tylko tego zadania, bez czytania treści i bez podążania za przekierowaniem', async () => {
    const response = new Response('private response body', { status: 200 });
    const read = vi.spyOn(response, 'text');
    const fetchImpl = vi.fn().mockResolvedValue(response);
    const l = logger();
    expect(await runTask({ task: EMAIL, env, fetchImpl, logger: l })).toBe(0);
    expect(fetchImpl).toHaveBeenCalledExactlyOnceWith('https://pracuj.be/api/email/process', {
      method: 'POST',
      headers: { authorization: `Bearer ${EMAIL_SECRET}`, 'user-agent': 'pracujbe-cloudflare-cron/1.0' },
      redirect: 'manual',
      signal: expect.any(AbortSignal),
    });
    expect(read).not.toHaveBeenCalled();
    expect(allLogs(l)).not.toMatch(/pracuj\.be|secret|private/u);
    expect(l.log).toHaveBeenCalledWith('Zadanie cron emailQueue zakończone: HTTP 200.');
  });

  it('maintenance dostaje sekret maintenance (kontrola ujemna: nie sekret kolejki)', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    expect(await runTask({ task: MAINT, env, fetchImpl, logger: logger() })).toBe(0);
    const init = fetchImpl.mock.calls[0]![1] as { headers: Record<string, string> };
    expect(init.headers.authorization).toBe(`Bearer ${MAINT_SECRET}`);
    expect(init.headers.authorization).not.toContain(EMAIL_SECRET);
  });

  it.each([301, 302, 401, 404, 500, 503])('HTTP %i → 1', async (status) => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(null, { status }));
    const l = logger();
    expect(await runTask({ task: EMAIL, env, fetchImpl, logger: l })).toBe(1);
    expect(l.error).toHaveBeenCalledWith(`Zadanie cron emailQueue zakończone błędem HTTP ${status}.`);
  });

  it('błąd sieci → 1 bez komunikatu dostawcy', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error(`boom ${EMAIL_SECRET}`));
    const l = logger();
    expect(await runTask({ task: EMAIL, env, fetchImpl, logger: l })).toBe(1);
    expect(allLogs(l)).not.toContain(EMAIL_SECRET);
  });

  it('przekroczony czas → 1 i przerwane żądanie', async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn(
      (_url: string, init: { signal: AbortSignal }) =>
        new Promise<Response>((_resolve, reject) => init.signal.addEventListener('abort', () => reject(new Error('abort')))),
    );
    const l = logger();
    const pending = runTask({ task: EMAIL, env: { ...env, CRON_TIMEOUT_SECONDS: '5' }, fetchImpl: fetchImpl as never, logger: l });
    await vi.advanceTimersByTimeAsync(5000);
    expect(await pending).toBe(1);
    expect(l.error).toHaveBeenCalledWith('Przekroczono czas zadania cron emailQueue.');
  });
});

describe('Cloudflare cron worker — scheduled', () => {
  it('harmonogram wybiera zadanie; sukces nie rzuca', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    await expect(handleScheduled({ cron: '0 * * * *' }, env, { fetchImpl, logger: logger() })).resolves.toBe(0);
    expect(fetchImpl.mock.calls[0]![0]).toBe('https://pracuj.be/api/maintenance');
  });

  it('błąd zadania, zła konfiguracja i nieznany harmonogram = przebieg nieudany (wyjątek)', async () => {
    const failing = vi.fn().mockResolvedValue(new Response(null, { status: 500 }));
    await expect(handleScheduled({ cron: '*/5 * * * *' }, env, { fetchImpl: failing, logger: logger() })).rejects.toThrow(
      'CRON_TASK_FAILED',
    );
    const unused = vi.fn();
    await expect(
      handleScheduled({ cron: '*/5 * * * *' }, { ...env, EMAIL_QUEUE_SECRET: '' }, { fetchImpl: unused, logger: logger() }),
    ).rejects.toThrow('CRON_MISCONFIGURED');
    await expect(handleScheduled({ cron: '* * * * *' }, env, { fetchImpl: unused, logger: logger() })).rejects.toThrow(
      'CRON_UNKNOWN_SCHEDULE',
    );
    expect(unused).not.toHaveBeenCalled();
  });
});

describe('bramka hasła (SITE_ACCESS_PASSWORD) nie blokuje zadań cron', () => {
  it('middleware nie obejmuje /api/email/process i /api/maintenance (kontrola ujemna: strona tak)', async () => {
    vi.doMock('next-intl/middleware', () => ({ default: () => () => new Response(null) }));
    const { config } = await import('@/middleware');
    const [matcher] = config.matcher;
    const matches = (path: string) => new RegExp(`^${matcher}$`).test(path);
    for (const task of Object.values(CRON_TASKS)) expect(matches(task.path), task.path).toBe(false);
    expect(matches('/pl')).toBe(true);
    expect(matches('/pl/oferty-pracy')).toBe(true);
  });

  it('trasy zadań autoryzują wyłącznie sekretem, nie cookie bramki', () => {
    for (const path of ['src/app/api/email/process/route.ts', 'src/app/api/maintenance/route.ts']) {
      const source = readFileSync(join(ROOT, path), 'utf8');
      expect(source, path).toMatch(/isCronAuthorized\(/u);
      expect(source, path).not.toMatch(/site-access|SITE_ACCESS/u);
    }
  });
});
