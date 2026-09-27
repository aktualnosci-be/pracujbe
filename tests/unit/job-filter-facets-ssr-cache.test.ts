// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * #903 — `getJobFilterFacets` (`src/lib/jobs.ts`) jest wołane BEZPOŚREDNIO przy renderowaniu SSR
 * listy ofert (`oferty-pracy/page.tsx`), z pominięciem cache/single-flight, który dotąd chronił
 * tylko osobny endpoint AJAX `/api/job-filter-facets` (#595). Te same filtry i ten sam widz w
 * krótkim oknie powinny dzielić JEDNĄ agregację SQL, niezależnie od tego, przez którą ścieżkę
 * (SSR czy AJAX) wynik jest pobierany.
 *
 * `vi.resetModules()` przed każdym testem daje świeży moduł (świeży cache w jego zamknięciu) —
 * ten sam wzorzec co `tests/unit/health-route.test.ts` (#600).
 */

const filterFacets = vi.fn();
vi.mock('@/lib/db/runtime', () => ({ getDomainPool: async () => ({}) }));
vi.mock('@/lib/db/public-jobs', () => ({
  getPublicJobFilterFacets: (...args: unknown[]) => filterFacets(...args),
}));
vi.mock('@/lib/error-report', () => ({ captureError: vi.fn() }));

function facetsResult(total: number) {
  return {
    total,
    categories: {},
    locations: [],
    contracts: {},
    accommodation: { provided: 0, unavailable: 0 },
    immediate: 0,
    noLanguage: 0,
  };
}

async function loadGetJobFilterFacets() {
  const mod = await import('@/lib/jobs');
  return mod.getJobFilterFacets;
}

beforeEach(() => {
  vi.resetModules();
  filterFacets.mockReset();
  vi.stubEnv('DATABASE_APP_URL', 'postgres://test-placeholder');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('getJobFilterFacets — cache + single-flight na poziomie funkcji współdzielonej (#903)', () => {
  it('te same filtry i ten sam widz w krótkim oknie → jedna agregacja SQL dla wielu wywołań (SSR + równoległe żądania)', async () => {
    const getJobFilterFacets = await loadGetJobFilterFacets();
    let resolveFacets!: (value: unknown) => void;
    filterFacets.mockImplementation(
      () => new Promise((resolve) => { resolveFacets = resolve; }),
    );
    const params = { locale: 'pl', keyword: 'magazyn', categories: ['warehouse' as const] };
    const viewer = { candidateId: 'candidate-1' };

    const first = Promise.all([
      getJobFilterFacets(params, viewer),
      getJobFilterFacets(params, viewer),
    ]);
    // Kilka ticków mikrotask/makrotask — zanim mock (za dynamicznym importem `import('@/lib/db/public-jobs')`
    // w `getJobFilterFacets`) w ogóle zostanie wywołany, `resolveFacets` musi już wskazywać na
    // obietnicę zwróconą przez mock (ten sam wzorzec co `tests/unit/health-route.test.ts`, #600).
    await new Promise((resolve) => setTimeout(resolve, 0));
    resolveFacets(facetsResult(11));
    const [r1, r2] = await first;
    expect(r1).toMatchObject({ total: 11 });
    expect(r2).toMatchObject({ total: 11 });
    expect(filterFacets).toHaveBeenCalledTimes(1);

    // Kolejne, ODRĘBNE wywołanie z tymi samymi filtrami i tym samym widzem — nadal z cache, bez
    // nowej agregacji (dokładnie ten scenariusz z issue #903: SSR renderujący stronę ponownie).
    const r3 = await getJobFilterFacets(params, viewer);
    expect(r3).toMatchObject({ total: 11 });
    expect(filterFacets).toHaveBeenCalledTimes(1);
  });

  it('kontrola ujemna: inny kandydat (inne blokady firm, #97) → OSOBNA agregacja, wynik pierwszego kandydata nie wycieka do drugiego', async () => {
    const getJobFilterFacets = await loadGetJobFilterFacets();
    filterFacets
      .mockResolvedValueOnce(facetsResult(3))
      .mockResolvedValueOnce(facetsResult(9));
    const params = { locale: 'pl', keyword: 'magazyn' };

    const a = await getJobFilterFacets(params, { candidateId: 'candidate-a' });
    const b = await getJobFilterFacets(params, { candidateId: 'candidate-b' });

    expect(a).toMatchObject({ total: 3 });
    expect(b).toMatchObject({ total: 9 });
    expect(filterFacets).toHaveBeenCalledTimes(2);
  });

  it('kontrola ujemna: inne filtry tego samego widza → OSOBNA agregacja (cache nie miesza wyników różnych zapytań)', async () => {
    const getJobFilterFacets = await loadGetJobFilterFacets();
    filterFacets
      .mockResolvedValueOnce(facetsResult(3))
      .mockResolvedValueOnce(facetsResult(9));
    const viewer = { candidateId: 'candidate-1' };

    const a = await getJobFilterFacets({ locale: 'pl', keyword: 'magazyn' }, viewer);
    const b = await getJobFilterFacets({ locale: 'pl', keyword: 'kierowca' }, viewer);

    expect(a).toMatchObject({ total: 3 });
    expect(b).toMatchObject({ total: 9 });
    expect(filterFacets).toHaveBeenCalledTimes(2);
  });
});
