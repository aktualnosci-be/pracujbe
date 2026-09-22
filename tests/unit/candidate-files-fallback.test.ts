import { describe, expect, it, vi } from 'vitest';

import { getCandidateFiles } from '@/lib/data/candidate';

vi.mock('@/lib/env', () => ({ isSupabaseConfigured: () => false }));

describe('Dokumenty kandydata bez bazy', () => {
  it('nie pokazuje fikcyjnego CV w zwykłym fallbacku', async () => {
    await expect(getCandidateFiles()).resolves.toEqual([]);
  });
});
