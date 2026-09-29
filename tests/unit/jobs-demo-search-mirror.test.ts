import { describe, expect, it } from 'vitest';

import { getJobs } from '@/lib/jobs';

/**
 * #1119 — lustro demo (`getJobsFromDemo`) szuka tak samo jak SQL (0110/0153): słowo kluczowe
 * tylko w tytule oferty, miasto tylko w nazwie miasta. Dawniej demo szukało też w nazwie
 * firmy, opisie, wyróżnikach i slugu, więc wynik w demo rozjeżdżał się z produkcją.
 */
const base = { locale: 'pl' as const, page: 1, pageSize: 100 };

describe('lustro demo wyszukiwania', () => {
  it('słowo kluczowe z tytułu znajduje ofertę', async () => {
    const result = await getJobs({ ...base, keyword: 'Magazynier' });
    expect(result.total).toBeGreaterThan(0);
    expect(result.jobs.every((job) => job.title.toLowerCase().includes('magazynier'))).toBe(true);
  });

  it('słowo z nazwy firmy, wyróżnika albo sluga nie jest szukane (baza szuka tylko w tytule)', async () => {
    for (const keyword of ['CleanPro', 'Start od zaraz', 'office-cleaner-brussels']) {
      expect((await getJobs({ ...base, keyword })).total, keyword).toBe(0);
    }
  });

  it('miasto: nie dopasowuje po slugu oferty', async () => {
    // „cleaner” występuje tylko w slugu (office-cleaner-…), nie w żadnym mieście.
    expect((await getJobs({ ...base, city: 'cleaner' })).total).toBe(0);
    expect((await getJobs({ ...base, city: 'Bruksela' })).total).toBeGreaterThan(0);
  });
});
