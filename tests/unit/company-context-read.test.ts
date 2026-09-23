import { describe, expect, it, vi } from 'vitest';
import { getActiveCompany } from '@/lib/company-context';

vi.mock('server-only', () => ({}));
vi.mock('next/headers', () => ({ cookies: vi.fn() }));

function client(data: unknown) {
  const query = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockResolvedValue({ data, error: null }),
  };
  return { from: vi.fn().mockReturnValue(query) } as never;
}

describe('active company membership read', () => {
  it('confirms no membership only for an actual empty array', async () => {
    expect((await getActiveCompany(client([]), 'user-1')).activeId).toBeNull();
  });

  it.each([null, undefined, [{ role: 'member' }]])(
    'rejects incomplete membership data',
    async (rows) => {
      await expect(getActiveCompany(client(rows), 'user-1')).rejects.toThrow();
    },
  );
});
