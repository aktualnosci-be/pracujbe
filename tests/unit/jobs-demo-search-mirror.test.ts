import { describe, expect, it } from 'vitest';

import { getJobs, type JobDetail } from '@/lib/jobs';

/**
 * #1119 — lustro demo (`getJobsFromDemo`) szuka tak samo jak SQL (0110/0153): słowo kluczowe
 * w tytule oferty (od 0957, #866, także w wymaganiach), miasto tylko w nazwie miasta. Dawniej demo szukało też w nazwie
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

  it('#866: słowo z wymagań oferty (np. VCA) znajduje ofertę bez tego słowa w tytule', async () => {
    const result = await getJobs({ ...base, keyword: 'vca' });
    expect(result.total).toBeGreaterThan(0);
    // Żaden tytuł nie zawiera „VCA” — trafienie wynika wyłącznie z wymagań (jak SQL 0957).
    expect(result.jobs.some((job) => job.title.toLowerCase().includes('vca'))).toBe(false);
    for (const job of result.jobs) {
      // Lustro demo zwraca pełne oferty (JobDetail), lista typuje je jako JobListItem.
      const detail = job as JobDetail;
      const lines = [...detail.requirementsMandatory, ...detail.requirementsOptional];
      expect(lines.some((line) => line.toLowerCase().includes('vca')), job.slug).toBe(true);
    }
  });

  it('#866: kontrola ujemna — słowo spoza tytułu i wymagań nadal nie jest szukane', async () => {
    // „Start od zaraz” to wyróżnik, a nie wymaganie — wynik jak w SQL (tylko tytuł + kwalifikacje).
    expect((await getJobs({ ...base, keyword: 'Start od zaraz' })).total).toBe(0);
    expect((await getJobs({ ...base, keyword: 'vca-nieistniejace' })).total).toBe(0);
  });

  it('miasto: nie dopasowuje po slugu oferty', async () => {
    // „cleaner” występuje tylko w slugu (office-cleaner-…), nie w żadnym mieście.
    expect((await getJobs({ ...base, city: 'cleaner' })).total).toBe(0);
    expect((await getJobs({ ...base, city: 'Bruksela' })).total).toBeGreaterThan(0);
  });
});
