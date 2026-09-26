import { beforeEach, describe, expect, it, vi } from 'vitest';

import { fakeDb, resetFakeDb } from '../helpers/fake-db';

/**
 * #581: `/api/maintenance` jest bezpieczny wyłącznie przez `POST`. `GET` jest metodą
 * bezpieczną (RFC 9110 §9.2.1) i nie może uruchomić żadnego zadania — kontrola ujemna:
 * bez tej poprawki `GET` wołał dokładnie ten sam mutujący przebieg co `POST`.
 */

vi.mock('@/lib/db/portal', async () => (await import('../helpers/fake-db')).fakePortal());
vi.mock('@/lib/env', () => ({ isProductionMode: vi.fn(), fileBucketConfig: () => null }));
vi.mock('@/lib/error-report', () => ({ captureError: vi.fn() }));

const { GET } = await import('@/app/api/maintenance/route');

beforeEach(() => {
  vi.resetAllMocks();
  resetFakeDb(null);
  process.env.MAINTENANCE_SECRET = 'maintenance-secret';
});

describe('/api/maintenance — GET (#581)', () => {
  it('405 z Allow: POST, bez sekretu, bez żadnego zapytania do bazy', async () => {
    const response = await GET();
    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe('POST');
    expect(fakeDb.calls).toHaveLength(0);
  });
});
