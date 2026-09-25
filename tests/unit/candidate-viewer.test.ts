import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  readPortalIdentity: vi.fn(),
  getAuthRuntime: vi.fn(async () => ({ api: {} })),
  getDomainPool: vi.fn(async () => ({})),
  captureError: vi.fn(),
}));
vi.mock('server-only', () => ({}));
vi.mock('next/headers', () => ({ headers: async () => new Headers({ cookie: 'test-only' }) }));
vi.mock('@/lib/auth/runtime', () => ({ getAuthRuntime: mocks.getAuthRuntime }));
vi.mock('@/lib/db/runtime', () => ({ getDomainPool: mocks.getDomainPool }));
vi.mock('@/lib/auth/session', () => ({ readPortalIdentity: mocks.readPortalIdentity }));
vi.mock('@/lib/error-report', () => ({ captureError: mocks.captureError }));

import { readCandidateViewerId } from '@/lib/auth/candidate-viewer';

const id = '11111111-1111-4111-8111-111111111111';

function configure() {
  vi.stubEnv('DATABASE_APP_URL', 'postgres://test-placeholder');
  vi.stubEnv('DATABASE_AUTH_URL', 'postgres://auth-placeholder');
  vi.stubEnv('BETTER_AUTH_SECRET', 'test-secret');
  vi.stubEnv('BETTER_AUTH_URL', 'http://localhost:3000');
}

afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });

describe('Kandydat przeglądający listę ofert (#97)', () => {
  it('bez konfiguracji auth/bazy lista działa jak dla gościa, bez odczytu sesji', async () => {
    vi.stubEnv('DATABASE_APP_URL', '');
    expect(await readCandidateViewerId()).toBeNull();
    expect(mocks.readPortalIdentity).not.toHaveBeenCalled();
  });

  it('zweryfikowany kandydat → jego UUID z sesji serwera', async () => {
    configure();
    mocks.readPortalIdentity.mockResolvedValue({ id, role: 'candidate' });
    expect(await readCandidateViewerId()).toBe(id);
    expect(mocks.readPortalIdentity).toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.any(Headers));
  });

  it.each([
    ['pracodawca', { id, role: 'employer' }],
    ['admin', { id, role: 'admin' }],
    ['gość', null],
  ])('%s → lista gościa', async (_case, identity) => {
    configure();
    mocks.readPortalIdentity.mockResolvedValue(identity);
    expect(await readCandidateViewerId()).toBeNull();
  });

  it('awaria sesji nie blokuje listy i trafia do kanału błędów', async () => {
    configure();
    mocks.readPortalIdentity.mockRejectedValue(new Error('session store down'));
    expect(await readCandidateViewerId()).toBeNull();
    expect(mocks.captureError).toHaveBeenCalledWith(expect.any(Error), { area: 'auth.readCandidateViewerId' });
  });
});
