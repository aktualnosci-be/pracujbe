// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const adapters = vi.hoisted(() => ({
  createRuntimePool: vi.fn(),
  createAuthServer: vi.fn(),
}));

vi.mock('@/lib/db/pool', () => ({ createRuntimePool: adapters.createRuntimePool }));
vi.mock('@/lib/auth/server', () => ({ createAuthServer: adapters.createAuthServer }));

const names = ['DATABASE_AUTH_URL', 'BETTER_AUTH_URL', 'BETTER_AUTH_SECRET'] as const;
const configured = {
  DATABASE_AUTH_URL: 'postgresql://auth_login:database-password@db.internal/pracujbe',
  BETTER_AUTH_URL: 'https://pracuj.be',
  BETTER_AUTH_SECRET: 'private-auth-secret-012345678901234567890123',
};

async function loadRuntime() {
  return import('@/lib/auth/runtime');
}

beforeEach(() => {
  vi.resetModules();
  adapters.createRuntimePool.mockReset();
  adapters.createAuthServer.mockReset();
  Object.assign(process.env, configured);
});

afterEach(() => {
  for (const name of names) delete process.env[name];
});

describe('Leniwa kompozycja Better Auth', () => {
  it('sam import nie czyta bazy ani nie tworzy serwera', async () => {
    await loadRuntime();
    expect(adapters.createRuntimePool).not.toHaveBeenCalled();
    expect(adapters.createAuthServer).not.toHaveBeenCalled();
  });

  it.each(names)('bez %s odmawia przed jakimkolwiek I/O', async missing => {
    delete process.env[missing];
    const { getAuthRuntime } = await loadRuntime();
    await expect(getAuthRuntime()).rejects.toThrow('Brak konfiguracji serwera uwierzytelniania.');
    expect(adapters.createRuntimePool).not.toHaveBeenCalled();
    expect(adapters.createAuthServer).not.toHaveBeenCalled();
  });

  it('współdzieli jedną inicjalizację między równoległymi wywołaniami', async () => {
    let release!: (pool: object) => void;
    adapters.createRuntimePool.mockReturnValue(new Promise(resolve => { release = resolve; }));
    const auth = { handler: vi.fn() };
    adapters.createAuthServer.mockReturnValue(auth);
    const { getAuthRuntime } = await loadRuntime();

    const first = getAuthRuntime();
    const second = getAuthRuntime();
    expect(first).toBe(second);
    expect(adapters.createRuntimePool).toHaveBeenCalledTimes(1);
    release({ end: vi.fn() });

    await expect(first).resolves.toBe(auth);
    await expect(getAuthRuntime()).resolves.toBe(auth);
    expect(adapters.createRuntimePool).toHaveBeenCalledWith(configured.DATABASE_AUTH_URL, 'auth');
    expect(adapters.createAuthServer).toHaveBeenCalledWith({
      pool: expect.any(Object),
      baseURL: configured.BETTER_AUTH_URL,
      secret: configured.BETTER_AUTH_SECRET,
    });
    expect(adapters.createAuthServer).toHaveBeenCalledTimes(1);
  });

  it('zamyka utworzoną pulę i pozwala ponowić próbę po błędzie kompozycji', async () => {
    const firstPool = { end: vi.fn().mockResolvedValue(undefined) };
    const secondPool = { end: vi.fn().mockResolvedValue(undefined) };
    const auth = { handler: vi.fn() };
    adapters.createRuntimePool.mockResolvedValueOnce(firstPool).mockResolvedValueOnce(secondPool);
    adapters.createAuthServer.mockImplementationOnce(() => { throw new Error(configured.BETTER_AUTH_SECRET); })
      .mockReturnValueOnce(auth);
    const { getAuthRuntime } = await loadRuntime();

    await expect(getAuthRuntime()).rejects.toThrow('Nie można uruchomić serwera uwierzytelniania.');
    expect(firstPool.end).toHaveBeenCalledOnce();
    await expect(getAuthRuntime()).resolves.toBe(auth);
    expect(adapters.createRuntimePool).toHaveBeenCalledTimes(2);
    expect(secondPool.end).not.toHaveBeenCalled();
  });

  it('nie ujawnia URL, hasła ani sekretu w błędzie inicjalizacji', async () => {
    adapters.createRuntimePool.mockRejectedValue(new Error(Object.values(configured).join(' ')));
    const { getAuthRuntime } = await loadRuntime();

    let message = '';
    try { await getAuthRuntime(); } catch (error) { message = String(error); }
    for (const privateValue of Object.values(configured)) expect(message).not.toContain(privateValue);
    expect(message).toContain('Nie można uruchomić serwera uwierzytelniania.');
  });
});
