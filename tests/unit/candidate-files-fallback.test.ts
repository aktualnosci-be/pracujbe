import { describe, expect, it, vi } from 'vitest';

import { getCandidateFiles } from '@/lib/data/candidate';

vi.mock('@/lib/db/portal', () => ({
  isPortalDataConfigured: () => false,
  getPortalIdentity: vi.fn(),
  withPortalTransaction: vi.fn(),
}));

describe('Dokumenty kandydata bez bazy', () => {
  it('nie pokazuje fikcyjnego CV w zwykłym fallbacku', async () => {
    await expect(getCandidateFiles()).resolves.toEqual([]);
  });
});
