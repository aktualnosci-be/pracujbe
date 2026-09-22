# Self-hosted runnery CI — Pracuj.be

CI (`.github/workflows/ci.yml`) działa na **self-hosted runnerach**. Wdrożenie
produkcji obsługuje natywna integracja Railway po zielonym CI. Poniżej jak
postawić runnery oraz jakie etykiety i narzędzia są wymagane.

---

## 1. Etykiety (labels)

Workflowy używają:

```yaml
runs-on: [self-hosted, linux, x64]
```

Każdy runner musi mieć etykiety: `self-hosted` (domyślna), `linux`, `x64`.
Jeśli używasz innych (np. `arm64` albo dedykowanej nazwy maszyny), zaktualizuj `runs-on`
we wszystkich workflowach **spójnie**.

---

## 2. Rejestracja runnera

### Wariant A — runner na repozytorium
GitHub → repo `aktualnosci-be/pracujbe` → **Settings → Actions → Runners → New self-hosted runner**.
Wybierz Linux x64 i wykonaj wyświetlone komendy na swojej maszynie:

```bash
mkdir actions-runner && cd actions-runner
curl -o actions-runner.tar.gz -L https://github.com/actions/runner/releases/download/vX.Y.Z/actions-runner-linux-x64-X.Y.Z.tar.gz
tar xzf actions-runner.tar.gz
./config.sh --url https://github.com/aktualnosci-be/pracujbe --token <REGISTRATION_TOKEN> --labels self-hosted,linux,x64
```

### Wariant B — runner na organizacji (współdzielony)
GitHub → organizacja `aktualnosci-be` → **Settings → Actions → Runners → New runner**.
Zalecane, jeśli będzie więcej repozytoriów. Ogranicz dostęp runnera do wybranych repo w ustawieniach grupy runnerów.

### Uruchomienie jako usługa (auto-start)

```bash
sudo ./svc.sh install
sudo ./svc.sh start
sudo ./svc.sh status
```

### Kilka runnerów na jednym hoście — obowiązkowa izolacja katalogów

Każda usługa runnera musi mieć **własny katalog instalacji i własny katalog roboczy**.
Dwie usługi nie mogą korzystać z tego samego `_work`, nawet jeśli GitHub zwykle nie
przydziela im tego samego joba. Workflow CI celowo uruchamia niezależne joby równolegle.

Przykładowy poprawny układ dla dwóch runnerów:

```text
/opt/actions-runner-pracujbe-1/        # pierwsza instalacja runnera
└── _work/
/opt/actions-runner-pracujbe-2/        # druga instalacja runnera
└── _work/
```

Przy rejestracji można nadać katalog roboczy jawnie (`./config.sh ... --work _work`).
Sam katalog `_work` może mieć tę samą nazwę tylko dlatego, że znajduje się wewnątrz
innego katalogu instalacji. Niedozwolony jest wspólny katalog w rodzaju
`/home/debian/actions-runner/_work` wskazany przez dwie usługi.

Po rejestracji sprawdź definicje obu usług i rzeczywiste katalogi procesów. Każda
usługa ma wskazywać inną instalację runnera. Jeśli ścieżki się pokrywają, zatrzymaj
drugą usługę i zarejestruj ją ponownie w osobnym katalogu przed uruchomieniem CI.

### Hook kończący job — kontrakt bezpieczeństwa

Hook wskazany przez `ACTIONS_RUNNER_HOOK_JOB_COMPLETED` działa w cyklu życia runnera,
więc musi zakończyć całą pracę **synchronicznie przed zwrotem sterowania**. Po wyjściu
hooka runner może natychmiast przyjąć następny job.

Hook kończący job:

- nie uruchamia sprzątania w tle (`&`, `nohup`, timer, opóźniony `sleep`, osobna usługa),
- nie usuwa `GITHUB_WORKSPACE`, katalogu `_work` ani `_work/_temp`,
- nie usuwa katalogów należących do innej usługi runnera,
- zwraca kod różny od zera, jeśli jego własna, bezpieczna czynność się nie powiodła,
- kończy się dopiero wtedy, gdy wszystkie uruchomione przez niego procesy zakończyły pracę.

Nie jest potrzebne ręczne kasowanie workspace między jobami: `actions/checkout`
przygotowuje checkout dla bieżącego joba. Jeśli host wymaga dodatkowego sprzątania
zasobów spoza workspace (na przykład własnych kontenerów testowych), musi ono być
ograniczone do zasobów utworzonych przez zakończony job i wykonać się synchronicznie.

Szczególnie niebezpieczny jest hook, który uruchamia opóźnione `rm -rf`, kończy się,
a po kilkudziesięciu sekundach kasuje katalog nowego joba. Objawem jest poprawny start
testu, po którym kolejne polecenie zgłasza brak bieżącego katalogu lub plików checkoutu.
Serializacja workflow nie naprawia tej konfiguracji: hook może usunąć workspace
następnego joba także wtedy, gdy joby wykonują się jeden po drugim.

Po zmianie hooka zrestartuj wszystkie usługi runnerów i uruchom pełny CI. Weryfikacja
jest zakończona dopiero wtedy, gdy równoległe joby przechodzą, a ich katalogi istnieją
do końca każdego joba. Pojedynczy zielony job nie potwierdza izolacji dwóch runnerów.

---

## 3. Wymagane oprogramowanie na runnerze

| narzędzie | wersja | uwagi |
|---|---|---|
| GitHub Actions Runner | co najmniej 2.329.0 | projekt przyjmuje wyższe minimum uwzględniające `checkout@v7` i uwierzytelnione komendy Git z akcji kontenerowych; sam runtime Node 24 wymaga 2.327.1. Oba runnery raportowały 2.337.0 w CI 22.09.2026 |
| Node.js | 22 (patrz `.nvmrc`) | `actions/setup-node@v7` dobierze wersję aplikacji; runtime samej akcji to niezależny Node 24 |
| git | dowolna aktualna | checkout |
| Przeglądarki Playwright | Chromium | zainstaluj raz: `npx playwright install --with-deps chromium` |
| biblioteki systemowe | zależności Chromium | na Ubuntu: `npx playwright install-deps` (wymaga sudo) |
| Docker | dowolna aktualna | wymagane przez job `rls` (usługa kontenerowa `postgres:16`) |
| Klient `psql` | dostarczany przez `postgres:16` | job `rls` wykonuje testy wewnątrz kontenera; instalacja na hoście nie jest potrzebna |

> **Playwright:** job `e2e` wykonuje `npx playwright install chromium` (bez `--with-deps`,
> bo tamto wymaga sudo w trakcie CI). Zależności systemowe zainstaluj **raz** przy provisioningu runnera.
> Gdy runner ma preinstalowaną przeglądarkę o innej wersji builda niż oczekuje Playwright
> (błąd „Executable doesn't exist"), ustaw `PLAYWRIGHT_CHROMIUM_PATH` na ścieżkę binarki
> (np. `/opt/pw-browsers/chromium`) — `playwright.config.ts` użyje jej przez `executablePath`.
>
> **RLS (`rls`):** job uruchamia `scripts/test-rls.sh` — nakłada `supabase/tests/shim.sql`
> + wszystkie migracje na kontener `postgres:16` (usługa GH Actions) i wykonuje adwersaryjne
> asercje `supabase/tests/rls.sql`. Runner musi mieć **Docker**. Skrypty i migracje są
> kopiowane do kontenera usługi, gdzie działają Bash i `psql`. Nie publikujemy portu bazy
> na hoście; każdy job ma własną bazę. Job nie wymaga `node_modules`. Lokalnie: `npm run test:rls`
> (peer auth: `sudo -u postgres bash scripts/test-rls.sh`).
>
> **Bramka CI:** błąd RLS lub danych demonstracyjnych kończy job niepowodzeniem.
> Wynik trzeba sprawdzić w rzeczywistym przebiegu; poprawna konfiguracja nie jest dowodem
> przejścia asercji. Wdrożenie ma wymagać zielonego wyniku tego joba.

---

## 4. Cache i wydajność

- `actions/setup-node@v7` z `cache: npm` cache'uje `~/.npm`. Na self-hosted katalog `~` jest trwały,
  więc kolejne przebiegi instalują szybciej.
- Job `install` buduje `node_modules` raz i zapisuje je przez `actions/cache@v6`; pozostałe
  joby odtwarzają ten sam klucz przez `actions/cache/restore@v6`.
- Alternatywnie (jeden runner, sekwencyjnie) można scalić joby w jeden, by pominąć pakowanie artefaktu —
  aktualny podział daje równoległość, gdy runnerów jest kilka.

---

## 5. Sekrety wymagane przez CI/CD

Ustaw w **Settings → Secrets and variables → Actions** (repo lub organizacja):

| sekret | używany przez | opis |
|---|---|---|
| `SENTRY_AUTH_TOKEN` | (opcjonalnie build) | upload source maps |

Build w `ci.yml` używa placeholderów env i **nie wymaga** sekretów Supabase —
strony publiczne mają fallback demonstracyjny, więc `next build` przechodzi bez bazy.
Testy e2e używające prawdziwej bazy wymagają osobnego, testowego projektu Supabase
(dodaj jego klucze jako sekrety, gdy dopiszesz e2e przepływów wymagających DB).

---

## 6. Bezpieczeństwo runnerów

- **Nie uruchamiaj self-hosted runnerów dla publicznych forków** — złośliwy PR może wykonać kod na runnerze.
  Repo `pracujbe` jest prywatne; jeśli to się zmieni, wyłącz uruchamianie workflowów z forków
  lub wymagaj approvala (Settings → Actions → Fork pull request workflows).
- Runner ma dostęp do sekretów — trzymaj go w izolowanym środowisku (kontener/VM), regularnie aktualizuj.
- Railway nie wymaga sekretu wdrożeniowego na runnerze; połączenie repozytorium
  i bramka `Wait for CI` są konfigurowane po stronie projektu Railway.

---

## 7. Weryfikacja

Po rejestracji: **Actions → CI → Run workflow** (workflow_dispatch) lub wypchnij commit na `develop`.
Runner powinien podjąć zadania; w logach jobów zobaczysz nazwę maszyny.
