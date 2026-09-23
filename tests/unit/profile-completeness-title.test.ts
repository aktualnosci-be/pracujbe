import { describe, expect, it } from 'vitest';

import { getProfileLevelTitle } from '@/lib/profile-completeness';

describe('ocena kompletności profilu', () => {
  it.each([0, 17, 59])('nie nazywa profilu o kompletności %i%% dobrym', (completionPct) => {
    expect(getProfileLevelTitle(completionPct, 'Dobry poziom')).toBeUndefined();
  });

  it.each([60, 67, 100])('pokazuje przetłumaczoną ocenę od %i%%', (completionPct) => {
    expect(getProfileLevelTitle(completionPct, 'Good level')).toBe('Good level');
  });
});
