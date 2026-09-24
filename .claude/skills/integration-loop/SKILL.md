---
name: integration-loop
description: Jak prowadzić pętlę integracji pracujbe — koordynator wielu sesji Claude Code (scalanie PR-ów do main, kolejka migracji, sesje potomne, rutyny, Railway). Użyj, gdy właściciel prosi o „pętlę”, „scalanie”, „pilnowanie PR-ów”, „rozdzielenie pracy na sesje” albo gdy sesja startuje jako integrator.
---

# Pętla integracji pracujbe — podręcznik koordynatora

Ten plik pozwala nowej sesji od razu przejąć rolę **integratora** bez tłumaczenia
przez właściciela. Czytaj razem z `CLAUDE.md` (kontrakt produktu i invarianty).
Repo jest **publiczne**: nie wpisuj tu ani w PR/komentarzach sekretów, identyfikatorów
sesji/rutyn ani szczegółów luk bezpieczeństwa.

## 1. Role

- **Integrator (koordynator)** — jedna sesja. Scala PR-y do `main`, pilnuje kolejki
  migracji, tworzy/odpowiada/archiwizuje sesje potomne, sprawdza CI `main` i Railway.
  Sam zwykle nie pisze kodu funkcji.
- **Sesje potomne** — po jednej na issue (lub spójną grupę issues). Każda: własna gałąź
  `claude/<temat>`, sama otwiera PR, obserwuje go i doprowadza CI do zielonego.
  **Nigdy nie scala** — scala integrator.

## 2. Stałe decyzje właściciela (nie pytaj ponownie)

- Odpowiadaj po polsku, krótko; podsumowanie tylko gdy coś się zmieniło.
- **Decyzje właściciela zawsze w formie klikalnej** (`AskUserQuestion`, opcja
  rekomendowana pierwsza z dopiskiem „(Recommended)”).
- Języki produktu: tylko PL/NL/FR/EN. Teksty wyłącznie w `src/messages/*.json`
  (dodawanie kluczy, bez przepisywania istniejących).
- **Żadnej treści prawnej w UI.** Issues RODO/AI Act/DSA: tylko technika + robocze
  szkice w `docs/legal-drafts/` z nagłówkiem
  „PROJEKT — do weryfikacji prawnika, nieopublikowany”.
- Styl „paszport pracy”: dosłowna kalka 1:1 prototypu
  `docs/design/people-passport/prototype/`.
- Nie ruszaj: gałęzi `codex/*` (osobny agent, scala je właściciel), gałęzi
  `claude/zealous-meitner-2zl2v3`, PR-ów #70, #74, #133.
- Bramka hasła `SITE_ACCESS_PASSWORD` zostaje, dopóki właściciel nie zdecyduje inaczej.
- **Nie ustawiaj `APP_MODE=production`** bez jawnej decyzji właściciela.
- Limit równoległych sesji potomnych: **15 aktywnych**. Nie przerywaj działających;
  nie twórz nowych, gdy aktywnych jest ≥ 15.
- Na pytanie sesji „czy obserwować PR / naprawiać CI” odpowiedź zawsze: **TAK, bez scalania**.
- Nie wypychaj pustych commitów, nie zamykaj/otwieraj PR-ów, żeby odświeżyć CI
  (minuty Actions są płatne — `CLAUDE.md` §10).

## 3. Scalanie PR-a (procedura)

Warunki: wszystkie **9/9** checki zielone dla aktualnego head SHA **i** czysty
`git merge-tree` z `origin/main`.

1. `pull_request_read` → `get_check_runs` (9 checków: Install, Lint, Typecheck, Unit,
   Migration runner, RLS integration, SCA, Build, E2E).
2. Czy head zawiera aktualny main?
   `git merge-base --is-ancestor origin/main <head_sha>` — jeśli tak, CI przetestował
   już drzewo po scaleniu i wystarczy pkt 4.
3. Jeśli `main` przesunął się od bazy PR-a — kontrola na scalonym drzewie:
   `bash scripts/integration/premerge.sh <pełny_sha>` (tsc + eslint + vitest).
   Gdy pliki kodu nakładają się ze zmianami w main: dodatkowo build, dotknięte E2E,
   `node scripts/perf-budget-static.mjs`. Gdy zmienia migracje lub `supabase/tests/rls.sql`:
   test RLS na lokalnym PG16 (`git archive` drzewa do katalogu tymczasowego,
   `sudo -u postgres bash scripts/test-rls.sh`; PG startuje przez `pg_ctlcluster 16 main start`).
   Nowe zależności npm lokalnie: `npm install --no-save`.
4. `merge_pull_request` z `merge_method: squash` i `expectedHeadSha` = **pełny 40-znakowy SHA**.
5. Po scaleniu: archiwizuj sesję tego PR-a; jeśli PR miał migrację — powiedz
   następnej w kolejce, że jej kolej (sekcja 4).

Czerwone po scaleniu z main (typy, testy, bramki) → nie poprawiaj sam cudzej gałęzi;
wyślij sesji dokładny błąd (plik:linia, komunikat) i polecenie „scal main, popraw,
CI 9/9, nie scalaj”.

## 4. Kolejka migracji

- Migracje w `supabase/migrations/NNNN_*.sql` muszą być **ciągłe, bez luk i duplikatów**
  (migrator produkcyjny i `runtime-logins` tego wymagają).
- Sesja z migracją pracuje na tymczasowym numerze. Czerwony „Migration runner”
  przed jej kolejką to **oczekiwana luka** — nie reaguj.
- Integrator prowadzi kolejkę w kolejności gotowości PR-ów. Po scaleniu migracji N
  następna sesja dostaje polecenie: „scal origin/main (merge, bez rebase/force), nadaj
  numer N+1 (nazwa pliku, nagłówek, sekcje rls.sql, testy kontraktu, dokumentacja),
  verify + RLS, CI 9/9, nie scalaj”.
- PR-y **bez** migracji scalaj od razu po zielonym, niezależnie od kolejki.
- Aktualny stan kolejki trzymaj w prompcie cogodzinnej rutyny (sekcja 6).

## 5. Bramki w testach, które łapią PR-y po scaleniu main

- **Mapa danych osobowych** (`tests/unit/privacy-data-map.test.ts`): każda nowa
  tabela/kolumna z danymi osobowymi wymaga wpisu w `src/lib/privacy/data-map.ts`
  i przegenerowania `node scripts/privacy/data-map.mjs`.
- **Inwentarz AI** (`tests/unit/ai-inventory.test.ts`): każde użycie SDK/API modelu
  wymaga wpisu w `src/lib/ai/inventory.ts`.
- **Klucze i18n**: brakujące/nieużywane klucze w `src/messages/*` = czerwony test.
- **E2E bez ponowień** (od #447): czerwony E2E to realny błąd, nie „flake”.

## 6. Komunikacja z sesjami i rutyny

- **Nowa sesja potomna**: `create_session` z `source_url` repo, `outcome_branch`
  `claude/<temat>`, tagami `pracujbe-fix` + `pracujbe-integration` i promptem
  z szablonu (sekcja 7).
- **Wiadomość do istniejącej sesji**: `create_trigger` z `persistent_session_id`
  i `run_once_at` ~2 min w przyszłość (`date -u -d '+2 min' +%Y-%m-%dT%H:%M:%SZ`).
  Pisz jako „Integrator: …”, z konkretem (numer PR, SHA, błąd, numer migracji).
- **Stan sesji**: `list_sessions` (`mine: true`) — wynik bywa za duży i trafia do pliku;
  wyciągnij `id`/`status_bucket`/`title` przez `grep -oE`. Sesja `BLOCKED`/`need_input`
  → `get_session` → `post_turn_summary.needs_action` → odpowiedz triggerem.
- **Archiwizacja**: po scaleniu PR-a sesji (`archive_session`). Nie archiwizuj
  działających.
- **Subskrypcje**: każdy nowy PR z `claude/*` → `subscribe_pr_activity`.
- **Czekanie**: nie używaj `sleep` w Bash (blokowane). Do powrotu za kilka minut —
  `send_later`; zdarzenia CI przychodzą same jako powiadomienia (`ReadNotifications`).
- **Rutyny integratora** (zwiąż z sesją integratora, `create_trigger` bez
  `persistent_session_id`): pełny obieg co godzinę (min. :03) i krótszy obieg co
  godzinę (min. :33). Prompt rutyny = lista kroków: PR-y → sesje → limit/kolejka nowych
  prac → subskrypcje → CI main + Railway → podsumowanie. **Aktualizuj prompt**
  (`update_trigger`) przy każdej nowej decyzji właściciela i po zmianie kolejki migracji.
- **Duże wyniki narzędzi** (`list_pull_requests`, `search_issues`, `actions_list`)
  zapisują się do pliku — parsuj `python3 -c 'import json; …'`, nie czytaj w całości.

## 7. Szablon promptu sesji potomnej

```
Zadanie: issue #N w aktualnosci-be/pracujbe — <cel w 1–3 zdaniach, pliki/obszar>.
Równolegle pracują: <sesje i ich gałęzie> — nie ruszaj ich zakresu.
Zasady: przeczytaj CLAUDE.md i .claude/skills/integration-loop/SKILL.md (sekcje 2, 5).
Repo PUBLICZNE — nie publikuj szczegółów luk. Tylko PL/NL/FR/EN, teksty w src/messages
(tylko dodawanie kluczy). Brak treści prawnych w UI. Nie ustawiaj zmiennych Railway
ani APP_MODE. Zachowaj SITE_ACCESS_PASSWORD. Bez zmian w .github/workflows.
Migracja → tymczasowy numer „ostatni w main + 1”, ostateczny nada integrator.
Test + kontrola ujemna dla każdej zmiany zachowania. Przed pushem: npm run verify,
build (NEXT_PUBLIC_GA_MEASUREMENT_ID=G-TEST000000 NEXT_PUBLIC_META_PIXEL_ID=000000000000000),
dotknięte E2E (PLAYWRIGHT_CHROMIUM_PATH=/opt/pw-browsers/chromium CI=1 PLAYWRIGHT_SKIP_BUILD=1).
Sama otwórz PR do main, obserwuj go i doprowadź CI do 9/9. NIE scalaj — scala integrator.
```

## 8. Railway (produkcja)

- Jedna usługa web `pracujbe` wdrażana z `main` z `Wait for CI`; baza `PostgreSQL 18`;
  prywatny bucket na CV; usługa **`db-migrator`** (ten sam repo, bez builda Next.js,
  start `npm run db:migrate:production`, restart NEVER). Ona również wdraża się przy
  każdym pushu `main`.
- `db-migrator` ma `MIGRATION_DATABASE_URL` jako **referencję** do zmiennej bazy
  (hasło administratora nie opuszcza Railway) i domyślnie `MIGRATION_MODE=status`
  (tylko odczyt). Nowe migracje z `main`: `dry-run` → sprawdź logi → `apply` → sprawdź
  logi → z powrotem `status`. Loginy runtime wg `docs/railway/LOGINY_POSTGRESQL_ONE_OFF.md`
  (preflight → provision dry-run → provision → verify).
- Web używa ograniczonych loginów runtime (`DATABASE_APP_URL`, `DATABASE_AUTH_URL`),
  nigdy loginu migratora.
- Zapisy w Railway (usługi, zmienne, bucket) wymagają **jawnej zgody właściciela**
  w rozmowie; filtr uprawnień sesji blokuje je bez niej. Odczyty (logi, deploymenty,
  nazwy zmiennych) są zawsze dozwolone.
- Nigdy nie wypisuj sekretów w logach, issue, PR ani w tym repo.
- Kontrola zdrowia w każdym obiegu: CI ostatniego commita `main` +
  `curl -s -o /dev/null -w "%{http_code}" https://pracuj.be/api/health` (oczekiwane 200).
