// Porty i ponowne użycie serwera testów przeglądarkowych — jedno źródło dla konfiguracji
// Playwright (playwright*.config.ts) i skryptów (scripts/perf-lab.mjs).
//
// E2E_PORT — port bazowy jednego „slotu” przebiegów na maszynie. Bez zmiennej porty są
// dokładnie takie jak dotąd (CI bez zmian): demo 3000, fixture 4319/4320, real-flow 4331,
// lab CWV 3100. Z E2E_PORT=N każda konfiguracja dostaje własny port w zakresie N…N+100,
// więc dwa równoległe przebiegi z różnymi N nie trafiają na swoje serwery:
//   demo N, fixture full N+1, fixture error N+2, real-flow N+3, lab CWV N+100.
//
// E2E_REUSE_SERVER=1 — Playwright podłącza się do serwera już działającego na porcie
// (np. własnego `npm run dev`). Domyślnie wyłączone: zajęty port kończy przebieg czytelnym
// błędem Playwrighta zamiast cichego testowania cudzego serwera (innej gałęzi, innego builda).

/** Przesunięcia portów względem E2E_PORT (tylko gdy zmienna jest ustawiona). */
export const E2E_PORT_OFFSETS = Object.freeze({
  demo: 0,
  fixtureFull: 1,
  fixtureError: 2,
  realFlow: 3,
  perfLab: 100,
});

/** Porty domyślne (bez E2E_PORT) — takie same jak przed wprowadzeniem zmiennej. */
export const E2E_DEFAULT_PORTS = Object.freeze({
  demo: 3000,
  fixtureFull: 4319,
  fixtureError: 4320,
  realFlow: 4331,
  perfLab: 3100,
});

const MAX_BASE_PORT = 65535 - E2E_PORT_OFFSETS.perfLab;

/**
 * Port bazowy z E2E_PORT albo `undefined`, gdy zmiennej nie ustawiono.
 * Nieprawidłowa wartość (nie liczba całkowita 1024…65435) = wyjątek, nie cichy powrót do 3000.
 * @param {Record<string, string | undefined>} [env]
 * @returns {number | undefined}
 */
export function e2eBasePort(env = process.env) {
  const raw = env.E2E_PORT?.trim();
  if (!raw) return undefined;
  if (!/^\d+$/.test(raw)) throw new Error(`E2E_PORT musi być liczbą całkowitą, jest: „${raw}”.`);
  const port = Number(raw);
  if (port < 1024 || port > MAX_BASE_PORT) {
    throw new Error(`E2E_PORT musi być w zakresie 1024–${MAX_BASE_PORT}, jest: ${port}.`);
  }
  return port;
}

/**
 * Port serwera danej konfiguracji.
 * @param {keyof typeof E2E_DEFAULT_PORTS} kind
 * @param {Record<string, string | undefined>} [env]
 * @returns {number}
 */
export function e2ePort(kind, env = process.env) {
  if (!(kind in E2E_DEFAULT_PORTS)) throw new Error(`Nieznany rodzaj serwera E2E: ${kind}.`);
  const base = e2eBasePort(env);
  return base === undefined ? E2E_DEFAULT_PORTS[kind] : base + E2E_PORT_OFFSETS[kind];
}

/**
 * Adres bazowy serwera danej konfiguracji (bez końcowego ukośnika).
 * @param {keyof typeof E2E_DEFAULT_PORTS} kind
 * @param {{ host?: string, env?: Record<string, string | undefined> }} [options]
 * @returns {string}
 */
export function e2eBaseUrl(kind, { host = 'localhost', env = process.env } = {}) {
  return `http://${host}:${e2ePort(kind, env)}`;
}

/**
 * Czy Playwright ma użyć serwera już działającego na porcie. Tylko jawne E2E_REUSE_SERVER=1
 * i nigdy w CI (tam każdy przebieg startuje własny serwer z bieżącego builda).
 * @param {Record<string, string | undefined>} [env]
 * @returns {boolean}
 */
export function e2eReuseServer(env = process.env) {
  return env.E2E_REUSE_SERVER === '1' && !env.CI;
}
