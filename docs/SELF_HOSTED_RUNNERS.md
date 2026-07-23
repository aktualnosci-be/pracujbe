# Self-hosted runnery CI/CD — Pracuj.be

Cały CI/CD (`.github/workflows/ci.yml`, `deploy.yml`) działa na **self-hosted runnerach**.
To wymóg projektu. Poniżej jak je postawić, jakie etykiety i narzędzia są wymagane.

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

---

## 3. Wymagane oprogramowanie na runnerze

| narzędzie | wersja | uwagi |
|---|---|---|
| Node.js | 22 (patrz `.nvmrc`) | `actions/setup-node@v4` dobierze wersję, ale bazowy Node przyspiesza |
| git | dowolna aktualna | checkout |
| Przeglądarki Playwright | Chromium | zainstaluj raz: `npx playwright install --with-deps chromium` |
| biblioteki systemowe | zależności Chromium | na Ubuntu: `npx playwright install-deps` (wymaga sudo) |
| Docker | dowolna aktualna | wymagane przez job `rls` (usługa kontenerowa `postgres:16`) |
| Klient `psql` | 16 (lub zgodny) | job `rls`: na Ubuntu `sudo apt-get install -y postgresql-client` |
| Vercel CLI | pobierane w jobie | `npm i -g vercel@latest` (deploy) |

> **Playwright:** job `e2e` wykonuje `npx playwright install chromium` (bez `--with-deps`,
> bo tamto wymaga sudo w trakcie CI). Zależności systemowe zainstaluj **raz** przy provisioningu runnera.
>
> **RLS (`rls`):** job uruchamia `scripts/test-rls.sh` — nakłada `supabase/tests/shim.sql`
> + wszystkie migracje na kontener `postgres:16` (usługa GH Actions) i wykonuje adwersaryjne
> asercje `supabase/tests/rls.sql`. Runner musi mieć **Docker** (usługi kontenerowe) oraz
> klienta **`psql`**. Job nie wymaga `node_modules`. Lokalnie: `npm run test:rls`
> (peer auth: `sudo -u postgres bash scripts/test-rls.sh`).

---

## 4. Cache i wydajność

- `actions/setup-node@v4` z `cache: npm` cache'uje `~/.npm`. Na self-hosted katalog `~` jest trwały,
  więc kolejne przebiegi instalują szybciej.
- Job `install` buduje `node_modules` raz i przekazuje je jako artefakt do pozostałych jobów
  (`upload-artifact`/`download-artifact`), by nie instalować wielokrotnie.
- Alternatywnie (jeden runner, sekwencyjnie) można scalić joby w jeden, by pominąć pakowanie artefaktu —
  aktualny podział daje równoległość, gdy runnerów jest kilka.

---

## 5. Sekrety wymagane przez CI/CD

Ustaw w **Settings → Secrets and variables → Actions** (repo lub organizacja):

| sekret | używany przez | opis |
|---|---|---|
| `VERCEL_TOKEN` | deploy.yml | token API Vercel |
| `VERCEL_ORG_ID` | deploy.yml | ID organizacji Vercel |
| `VERCEL_PROJECT_ID` | deploy.yml | ID projektu Vercel |
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
- Zasada least privilege: osobny runner/grupa dla deployu (dostęp do `VERCEL_TOKEN`).

---

## 7. Weryfikacja

Po rejestracji: **Actions → CI → Run workflow** (workflow_dispatch) lub wypchnij commit na `develop`.
Runner powinien podjąć zadania; w logach jobów zobaczysz nazwę maszyny.
