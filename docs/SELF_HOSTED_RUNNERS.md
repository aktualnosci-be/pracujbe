# Self-hosted runnery CI — Pracuj.be (archiwalne)

> **Od 2026-09-23 CI działa na GitHub-hosted `ubuntu-latest`** (decyzja właściciela).
> Ten dokument opisuje poprzednią konfigurację i przydaje się tylko przy ewentualnym powrocie.

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
przydziela im tego samego joba. Do czasu naprawy hosta (#50) workflow CI uruchamia
joby i całe przebiegi po kolei. To zabezpieczenie nie zastępuje osobnych katalogów.

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
| Node.js | 22 (patrz `.nvmrc`) | `actions/setup-node@v4` dobierze wersję, ale bazowy Node przyspiesza |
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
> **RLS (`rls`):** job uruchamia `scripts/test-rls.sh` — nakłada produkcyjny bootstrap ról
> (`database/bootstrap`) + wszystkie migracje domeny i auth na kontener `postgres:16` (usługa
> GH Actions), sprawdza model ról z kontrolami ujemnymi (`supabase/tests/role-guard.sql`)
> i wykonuje adwersaryjne asercje `supabase/tests/rls.sql`; po każdym przełączeniu na rolę
> klienta strażnik (`role-assert.sql`) potwierdza `current_user`, brak ścieżki do
> właściciela tabel/SUPERUSER/BYPASSRLS i `row_security=on`. Runner musi mieć **Docker**. Skrypty i migracje są
> kopiowane do kontenera usługi, gdzie działają Bash i `psql`. Nie publikujemy portu bazy
> na hoście; każdy job ma własną bazę. Job nie wymaga `node_modules`. Lokalnie: `npm run test:rls`
> (peer auth: `sudo -u postgres bash scripts/test-rls.sh`).
>
> **Bramka CI:** błąd RLS lub danych demonstracyjnych kończy job niepowodzeniem.
> Wynik trzeba sprawdzić w rzeczywistym przebiegu; poprawna konfiguracja nie jest dowodem
> przejścia asercji. Wdrożenie ma wymagać zielonego wyniku tego joba.

---

## 4. Cache i wydajność

- `actions/setup-node@v4` z `cache: npm` cache'uje `~/.npm`. Na self-hosted katalog `~` jest trwały,
  więc kolejne przebiegi instalują szybciej.
- Job `install` zapisuje `node_modules` w cache Actions; większość kolejnych jobów
  odtwarza to drzewo, a po chybieniu cache uruchamia `npm ci`. Nie używamy
  artefaktu `node_modules`.
- Job `unit` zawsze wykonuje `npm ci` z `package-lock.json` po odtworzeniu cache
  pobrań npm (`~/.npm`), bez przywracania `node_modules`. Przed Vitest sprawdza,
  czy Node odnajduje pakiet `ms`; przy awarii zapisuje diagnostykę jego obecności.
  To ogranicza zależność tego joba od kompletności cache `node_modules`, ale nie
  zabezpiecza przed usunięciem katalogu **w trakcie** testów przez proces hosta.
  Przy takim objawie nadal trzeba skontrolować hooki i katalogi runnerów z §2.

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
