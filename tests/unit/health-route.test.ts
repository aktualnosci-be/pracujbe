// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * #600 — publiczny `GET /api/health`: single-flight ogranicza RÓWNOLEGŁE `pool.query('SELECT 1')`
 * do NAJWYŻEJ jednego na raz, niezależnie od liczby jednoczesnych żądań; healthcheck nadal
 * odzwierciedla BIEŻĄCY stan bazy na każde ODRĘBNE (nie nakładające się) żądanie — bez
 * ponownego użycia starego wyniku (`tests/unit/railway-env.test.ts` polega na natychmiastowej
 * zmianie stanu przy przełączeniu mocka `pool.query`). `vi.resetModules()` przed każdym testem
 * daje świeży moduł (i świeży cache w jego zamknięciu), żeby testy się nie zanieczyszczały.
 */

const queryMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/db/runtime', () => ({
  getDomainPool: async () => ({ query: queryMock }),
}));

async function loadGet() {
  const mod = await import('@/app/api/health/route');
  return mod.GET;
}

function request(): Request {
  return new Request('https://pracuj.be/api/health');
}

beforeEach(() => {
  vi.resetModules();
  queryMock.mockReset();
  vi.stubEnv('APP_MODE', 'demo');
  vi.stubEnv('DATABASE_APP_URL', 'postgres://example/db');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('GET /api/health — cache + single-flight ping bazy (#600)', () => {
  it('równoległe żądania dzielą JEDNO zapytanie do bazy (single-flight)', async () => {
    const GET = await loadGet();
    let resolveQuery!: (value: unknown) => void;
    queryMock.mockImplementation(
      () => new Promise((resolve) => { resolveQuery = resolve; }),
    );

    const responses = Promise.all([GET(request()), GET(request()), GET(request())]);
    // Kilka ticków mikrotask/makrotask — zanim `pool.query` (za dynamicznym importem) w ogóle
    // zostanie wywołane, `resolveQuery` musi już wskazywać na obietnicę zwróconą przez mock.
    await new Promise((resolve) => setTimeout(resolve, 0));
    resolveQuery({ rows: [{ ok: 1 }] });
    const results = await responses;

    expect(queryMock).toHaveBeenCalledTimes(1);
    for (const res of results) expect(res.status).toBe(200);
  });

  it('odrębne (nie nakładające się) żądania po kolei NADAL sprawdzają bazę — bez stałej stemplowanej odpowiedzi', async () => {
    // Kontrola ujemna wobec ryzyka nadużycia cache: gdyby wynik był reużywany między odrębnymi
    // żądaniami (nie tylko równoległymi), zmiana stanu bazy w locie nie byłaby widoczna od razu —
    // dokładnie to psuje testy #429 (`railway-env.test.ts`, `readiness-postgres-only.test.ts`).
    const GET = await loadGet();
    queryMock.mockResolvedValueOnce({ rows: [{ ok: 1 }] });
    const first = await GET(request());
    expect(first.status).toBe(200);

    queryMock.mockRejectedValueOnce(new Error('connect ECONNREFUSED'));
    const second = await GET(request());
    expect(second.status).toBe(503);
    expect(queryMock).toHaveBeenCalledTimes(2);
  });

  it('kontrola ujemna: bez single-flight równoległe żądania liczyłyby się osobno', async () => {
    // Symulacja poprzedniego zachowania: każde wywołanie woła bazę wprost, bez przechodzenia
    // przez cache modułu. Pilnuje, żeby test wyżej faktycznie sprawdzał deduplikację, a nie
    // przypadek, w którym mock i tak zwraca ten sam wynik.
    queryMock.mockResolvedValue({ rows: [{ ok: 1 }] });
    await Promise.all([queryMock(), queryMock(), queryMock()]);
    expect(queryMock).toHaveBeenCalledTimes(3);
  });

  it('po lokalnym timeoncie trwające zapytanie NADAL blokuje nowe zapytanie, dopóki się nie zakończy (#645)', async () => {
    // Regresja #645: `pool.query('SELECT 1')` przekraczające 2 s lokalnego timeoutu nie może być
    // „zgubione” dla single-flight — kolejne, pozornie odrębne żądanie w tym oknie nie powinno
    // otwierać drugiego zapytania na tej samej (być może zablokowanej) puli.
    vi.useFakeTimers();
    try {
      const GET = await loadGet();
      let resolveQuery!: (value: unknown) => void;
      queryMock.mockImplementation(
        () => new Promise((resolve) => { resolveQuery = resolve; }),
      );

      const first = GET(request());
      // Zanim `pool.query` (za dynamicznym importem) w ogóle zostanie wywołane.
      await vi.advanceTimersByTimeAsync(0);
      expect(queryMock).toHaveBeenCalledTimes(1);

      // Lokalny timeout żądania mija — odpowiedź wraca jako niedostępna — ale zapytanie nadal trwa.
      await vi.advanceTimersByTimeAsync(2_000);
      const firstResponse = await first;
      expect(firstResponse.status).toBe(503);

      // Nowe, „odrębne” żądanie w tym samym oknie NIE otwiera drugiego zapytania (regresja #645).
      const second = GET(request());
      await vi.advanceTimersByTimeAsync(0);
      expect(queryMock).toHaveBeenCalledTimes(1);

      // Zapytanie faktycznie się kończy — dopiero teraz single-flight zwalnia wpis.
      resolveQuery({ rows: [{ ok: 1 }] });
      const secondResponse = await second;
      expect(secondResponse.status).toBe(200);
      expect(queryMock).toHaveBeenCalledTimes(1);

      // Kolejne, naprawdę odrębne żądanie po zakończeniu poprzedniego zapytania — nowe zapytanie.
      queryMock.mockResolvedValueOnce({ rows: [{ ok: 1 }] });
      const third = await GET(request());
      expect(third.status).toBe(200);
      expect(queryMock).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
