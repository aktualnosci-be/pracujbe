// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runCron } from '../../scripts/railway-cron-call.mjs';

const env = { CRON_TARGET_URL: 'http://web.railway.internal:3000/api/email/process?private=hidden', CRON_AUTH_SECRET: 'secret-test-value' };
const logger = () => ({ log: vi.fn(), error: vi.fn() });
afterEach(() => vi.useRealTimers());

describe('Railway cron caller', () => {
  it.each([
    {}, { CRON_TARGET_URL: env.CRON_TARGET_URL }, { CRON_AUTH_SECRET: env.CRON_AUTH_SECRET },
    { ...env, CRON_TARGET_URL: 'not a url' }, { ...env, CRON_TARGET_URL: 'ftp://example.com/task' },
    { ...env, CRON_TARGET_URL: 'https://user:password@example.com/task' },
    { ...env, CRON_TARGET_URL: 'https://example.com/task#fragment' },
    { ...env, CRON_TARGET_URL: 'https://example.com/task#' },
    { ...env, CRON_AUTH_SECRET: '   ' }, { ...env, CRON_AUTH_SECRET: 'secret\r\nInjected: value' },
  ])('odrzuca błędną konfigurację bez żądania (%j)', async (configuration) => {
    const fetchImpl = vi.fn();
    expect(await runCron({ env: configuration, fetchImpl, logger: logger() })).toBe(2);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('wysyła jeden POST z osobnym sekretem i nie podąża za przekierowaniem', async () => {
    const response = new Response('private response body', { status: 200 });
    const read = vi.spyOn(response, 'text');
    const fetchImpl = vi.fn().mockResolvedValue(response);
    const logs = logger();
    expect(await runCron({ env, fetchImpl, logger: logs })).toBe(0);
    expect(fetchImpl).toHaveBeenCalledExactlyOnceWith(env.CRON_TARGET_URL, {
      method: 'POST', headers: { authorization: `Bearer ${env.CRON_AUTH_SECRET}`, 'user-agent': 'pracujbe-railway-cron/1.0' },
      redirect: 'error', signal: expect.any(AbortSignal),
    });
    expect(read).not.toHaveBeenCalled();
    expect(response.bodyUsed).toBe(true);
    const output = JSON.stringify(logs.log.mock.calls);
    expect(output).toContain('200');
    for (const privateValue of [env.CRON_TARGET_URL, env.CRON_AUTH_SECRET, 'private response body']) expect(output).not.toContain(privateValue);
  });

  it.each([302, 401, 503])('zwraca 1 dla HTTP %i bez logowania odpowiedzi', async status => {
    const logs = logger();
    expect(await runCron({ env, logger: logs, fetchImpl: vi.fn().mockResolvedValue(new Response('private body', { status })) })).toBe(1);
    expect(JSON.stringify(logs.error.mock.calls)).toContain(String(status));
    expect(JSON.stringify(logs.error.mock.calls)).not.toContain('private body');
  });

  it('nie ujawnia sekretu, adresu ani treści błędu sieci', async () => {
    const logs = logger();
    expect(await runCron({ env, logger: logs, fetchImpl: vi.fn().mockRejectedValue(new Error(`${env.CRON_TARGET_URL} ${env.CRON_AUTH_SECRET} private body`)) })).toBe(1);
    const output = JSON.stringify([...logs.log.mock.calls, ...logs.error.mock.calls]);
    for (const privateValue of [env.CRON_TARGET_URL, env.CRON_AUTH_SECRET, 'private body']) expect(output).not.toContain(privateValue);
  });

  it('przerywa żądanie po 120 sekundach i usuwa timer', async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation((_url, options) => new Promise((_resolve, reject) => {
      options?.signal?.addEventListener('abort', () => reject(new Error('private abort details')));
    }));
    const logs = logger();
    const result = runCron({ env, fetchImpl, logger: logs });
    await vi.advanceTimersByTimeAsync(119_999);
    expect(fetchImpl.mock.calls[0]?.[1]?.signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await result).toBe(1);
    expect(fetchImpl.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    expect(JSON.stringify(logs.error.mock.calls)).not.toContain('private abort details');
  });

  it('usuwa timer także po sukcesie', async () => {
    vi.useFakeTimers();
    expect(await runCron({ env, logger: logger(), fetchImpl: vi.fn().mockResolvedValue(new Response(null, { status: 204 })) })).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });
});
