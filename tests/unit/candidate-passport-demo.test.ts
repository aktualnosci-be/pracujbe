import { describe, expect, it, vi } from 'vitest';

import { getCandidateOverview, getCandidatePassport, getCandidateProfileSummary } from '@/lib/data/candidate';

vi.mock('@/lib/db/portal', () => ({
  isPortalDataConfigured: () => false,
  getPortalIdentity: vi.fn(),
  withPortalTransaction: vi.fn(),
}));

describe('profil w trybie demonstracyjnym', () => {
  it('nie przedstawia nieistniejącej osoby ani postępu jako danych kandydata', async () => {
    const [overview, summary, passport] = await Promise.all([
      getCandidateOverview(), getCandidateProfileSummary(), getCandidatePassport(),
    ]);

    expect(summary.firstName).toBeNull();
    expect(summary.completionPct).toBe(0);
    expect(Object.values(summary.checklist)).toEqual([false, false, false, false, false, false]);
    expect(overview.profileCompletionPct).toBe(summary.completionPct);
    expect(passport).toMatchObject({ loadFailed: false, occupations: [], skills: [], languages: [] });
  });
});
