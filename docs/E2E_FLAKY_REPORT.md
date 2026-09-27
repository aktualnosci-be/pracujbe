# Raport niestabilnych testów E2E z kilku przebiegów (#375)

Od #447 CI nie ukrywa flaków: `retries: 1` + `failOnFlakyTests`, a reporter
`tests/e2e/reporters/flaky-report.ts` wypisuje test, który przeszedł dopiero przy
ponowieniu. Jeden przebieg CI pokazuje jednak tylko to, co wylosowało się w nim.
Skrypt `scripts/e2e-flaky-report.mjs` służy do świadomego szukania flaków **lokalnie,
poza CI** (nie zużywa minut Actions): uruchamia Playwrighta kilka razy bez ponowień
i porównuje wyniki.

## Użycie

```bash
# 5 przebiegów pełnej suity. Każdy przebieg startuje własny serwer; po `npm run build`
# z PLAYWRIGHT_SKIP_BUILD=1 bez ponownego builda. Serwer już uruchomiony na porcie
# (`npm run start -- -p 3000`) zostanie użyty tylko przy jawnym E2E_REUSE_SERVER=1:
PLAYWRIGHT_SKIP_BUILD=1 npm run test:e2e:flaky -- --runs 5
E2E_REUSE_SERVER=1 npm run test:e2e:flaky -- --runs 5

# Obok innego przebiegu na tej samej maszynie — osobny port (patrz „Port serwera” niżej):
E2E_PORT=3517 npm run test:e2e:flaky -- --runs 3 -- tests/e2e/smoke.spec.ts

# Wybrane specy i opcje Playwrighta po `--` (bez --reporter i --retries — ustawia je skrypt):
npm run test:e2e:flaky -- --runs 3 -- tests/e2e/smoke.spec.ts tests/e2e/a11y.spec.ts --workers=4

# Sama agregacja gotowych raportów JSON (np. z kilku maszyn: `npx playwright test --reporter=json > r1.json`):
node scripts/e2e-flaky-report.mjs r1.json r2.json r3.json
```

Opcje: `--runs N` (≥ 2), `--out katalog` (domyślnie `playwright-report/flaky-runs/`;
nie `test-results/`, bo Playwright czyści go na starcie każdego przebiegu). W katalogu
zostają raporty `run-NN.json` i podsumowanie `flaky-summary.json`.

## Port serwera i ponowne użycie (E2E_PORT, E2E_REUSE_SERVER)

Porty wszystkich konfiguracji wylicza jedno miejsce: `scripts/lib/e2e-server.mjs`
(test `tests/unit/e2e-server.test.ts`).

| konfiguracja | bez `E2E_PORT` (CI) | `E2E_PORT=N` |
|---|---|---|
| `playwright.config.ts` (demo) | 3000 | N |
| `playwright.applications-fixture.config.ts` full / error | 4319 / 4320 | N+1 / N+2 |
| `playwright.real-flow.config.ts` | 4331 | N+3 |
| `scripts/perf-lab.mjs` (bez `--base`) | 3100 | N+100 |

Dwa równoległe przebiegi na jednej maszynie (np. dwie sesje agentów) dostają różne `N`
(np. 3517 i 3700 — sloty N…N+100 nie mogą na siebie zachodzić, czyli różnica ≥ 101). Nie trzeba
kopiować konfiguracji.

`E2E_REUSE_SERVER=1` (ignorowane w CI) każe Playwrightowi użyć serwera, który już słucha
na porcie konfiguracji demo — np. własnego `npm run dev -- -p 3517`. Domyślnie wyłączone:
zajęty port kończy przebieg błędem Playwrighta („is already used”), zamiast po cichu
testować serwer innej gałęzi albo innego builda. Konfiguracje fixture i real-flow nigdy nie
używają cudzego serwera (potrzebują własnych zmiennych), a `perf-lab.mjs` przy zajętym porcie
kończy się błędem.

Adres kanoniczny w HTML (`NEXT_PUBLIC_SITE_URL`) jest wklejany w buildzie i nie zależy od
portu — bez tej zmiennej zostaje `http://localhost:3000`, tak jak oczekują specy SEO.
Ciasteczka ustawiane w specach na `http://localhost:3000` działają na każdym porcie
(ciasteczka nie rozróżniają portów).

## Co raportuje

- **Niestabilne** — test, który w zebranych przebiegach przynajmniej raz przeszedł
  i przynajmniej raz padł, albo ma status `flaky` w którymś raporcie (padł, przeszedł przy
  ponowieniu — np. raport z CI). Dla każdego: `plik:linia`, projekt, tytuł, liczniki
  i pierwsze linie błędów.
- **Czerwone w każdym przebiegu** — osobna lista. To realny błąd, nie flak.
- Pominięte (`skip`) się nie liczą.

Kod wyjścia: `0` brak niestabilnych, `1` są niestabilne, `2` błąd użycia albo przebieg
bez raportu JSON (np. zła konfiguracja). Czerwone w każdym przebiegu nie zmieniają kodu.

## Co dalej z flakiem

„Flake” nie jest przyczyną (CLAUDE.md §10, `.claude/skills/integration-loop` §5):
każdy wykryty test dostaje issue z root cause (wyścig w produkcie, czekanie na stały czas
zamiast warunku, współdzielony stan). Nie wyłączamy testów i nie dodajemy ponowień.

## Pliki

- `scripts/e2e-flaky-report.mjs` — CLI (przebiegi, zapis raportów, kod wyjścia).
- `scripts/lib/flaky-aggregate.mjs` — czysta logika agregacji i klasyfikacji.
- `tests/unit/flaky-aggregate.test.ts` — test na prawdziwych raportach JSON Playwrighta
  (`tests/fixtures/flaky-report/`), z kontrolą ujemną (stabilne przebiegi → brak flaka).
