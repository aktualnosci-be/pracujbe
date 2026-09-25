# Raport niestabilnych testów E2E z kilku przebiegów (#375)

Od #447 CI nie ukrywa flaków: `retries: 1` + `failOnFlakyTests`, a reporter
`tests/e2e/reporters/flaky-report.ts` wypisuje test, który przeszedł dopiero przy
ponowieniu. Jeden przebieg CI pokazuje jednak tylko to, co wylosowało się w nim.
Skrypt `scripts/e2e-flaky-report.mjs` służy do świadomego szukania flaków **lokalnie,
poza CI** (nie zużywa minut Actions): uruchamia Playwrighta kilka razy bez ponowień
i porównuje wyniki.

## Użycie

```bash
# 5 przebiegów pełnej suity (serwer: `reuseExistingServer` poza CI — przy uruchomionym
# `npm run build && npm run start` przebiegi nie budują aplikacji od nowa):
npm run test:e2e:flaky -- --runs 5

# Wybrane specy i opcje Playwrighta po `--` (bez --reporter i --retries — ustawia je skrypt):
npm run test:e2e:flaky -- --runs 3 -- tests/e2e/smoke.spec.ts tests/e2e/a11y.spec.ts --workers=4

# Sama agregacja gotowych raportów JSON (np. z kilku maszyn: `npx playwright test --reporter=json > r1.json`):
node scripts/e2e-flaky-report.mjs r1.json r2.json r3.json
```

Opcje: `--runs N` (≥ 2), `--out katalog` (domyślnie `playwright-report/flaky-runs/`;
nie `test-results/`, bo Playwright czyści go na starcie każdego przebiegu). W katalogu
zostają raporty `run-NN.json` i podsumowanie `flaky-summary.json`.

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
