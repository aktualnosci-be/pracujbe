# Railway IaC — `.railway/railway.ts` (#19)

Stan: **plik w repozytorium, nie jest włączony.** Railway nie czyta katalogu `.railway/`
przy wdrożeniu. Konfiguracja usług zmienia się dopiero po `railway config apply`,
a to uruchamia właściciel. Plik nie dowodzi, że produkcja tak wygląda. Dowodem jest
dopiero `railway config plan` bez żadnych zmian.

## Dlaczego nie `railway.json` / `railway.toml`

Railway wycofuje Config as Code: nowe usługi nie mogą go włączyć, a istniejące pliki
przestają być czytane **2026-12-01** ([docs](https://docs.railway.com/config-as-code)).
Plik CaC w korzeniu repozytorium byłby też czytany przy każdym deployu i nadpisywałby
ustawienia z panelu, czyli zmieniłby konfigurację produkcji po samym scaleniu PR-a.
Zastępuje go Infrastructure as Code (`.railway/railway.ts`,
[docs](https://docs.railway.com/infrastructure-as-code)). Tego wymaga też issue #19
i `PLAN_MIGRACJI.md` §13. Strażnik odrzuca pojawienie się `railway.json`/`railway.toml`.

## Co opisuje plik

Stan odczytany z API Railway 2026-09-25, projekt `captivating-vision`, środowisko
`production`:

| Usługa | Źródło | Build | Start | Healthcheck | Restart | Wait for CI |
|---|---|---|---|---|---|---|
| `pracujbe` | `main`, Railpack | `npm run build` | puste = `npm start` Railpacka | `/api/health` | domyślny (ON_FAILURE) | tak |
| `db-migrator` | `main`, Railpack | `echo "db-migrator: bez builda Next.js"` | `npm run db:migrate:production` | brak | `NEVER` | **nie** |

Obie usługi mają 1 replikę w `europe-west4-drams3a`. `pracujbe` ma domenę `pracuj.be`.
Zmienne są wpisane tylko z nazwy, jako `preserve()`: wartość zostaje w Railway.
Nazwy odpowiadają liście z panelu w dniu odczytu. Pełną listę zmiennych produkcji
prowadzi #14.

Świadomie **poza plikiem**:

- `PostgreSQL 18` i bucket CV. Plik eksportuje `partial = "pracujbe-repo"`, więc
  zarządza tylko usługami, które sam deklaruje. Plik całego projektu bez `partial`
  **usunąłby** przy `apply` każdy zasób, którego nie wymienia.
- Usługi cron (#13) dopisze osobna zmiana, gdy powstaną w Railway.
- `Wait for CI` (`checkSuites`) i builder: DSL ich nie opisuje, ustawienia zostają
  w panelu. `plan` nie może pokazywać ich zmiany.

## Strażnik

`tests/unit/railway-iac.test.ts` (w `npm run verify` i w CI) wykonuje plik z atrapą
`railway/iac`. Nie wymaga pakietu `railway` ani dostępu do Railway. Sprawdza, że:

- plik się parsuje, ma `partial` i dokładnie usługi `pracujbe` oraz `db-migrator`;
- źródło to `aktualnosci-be/pracujbe@main`;
- każda zmienna ma wartość `preserve()`: brak literałów i referencji `${{…}}`;
- w całym pliku, także w komentarzach, nie ma URL-i PostgreSQL, kluczy Stripe/Resend/AWS,
  JWT, kluczy prywatnych ani tokenu Railway;
- skrypty `npm run …` istnieją w `package.json`, a trasa `/api/health` istnieje;
- `db-migrator` ma `restartPolicyType: NEVER`, nie ma healthchecku, a jego login
  (`MIGRATION_DATABASE_URL`) nie trafia do web;
- nie ma plików `railway.json`/`railway.toml`.

Kontrola ujemna: każda z 11 mutacji (literał zmiennej, URL bazy, `${{…}}`, brak `partial`,
restart ON_FAILURE, inny healthcheck, zły skrypt, login migratora w web, baza w zasobach,
błąd składni, obcy import) daje czerwony test.

Pakiet `railway` nie jest zależnością projektu, a `.railway/` jest poza `tsc` i ESLint:
katalogi z kropką nie pasują do globów `tsconfig.json`. Dzięki temu CI i SCA działają
bez zmian.

## Włączenie (decyzja właściciela)

Nic z poniższych kroków nie zostało wykonane. Kolejność:

1. Z czystej kopii `main` na maszynie operatora:
   ```bash
   npm install --no-save railway   # SDK potrzebne CLI do wykonania pliku
   railway login
   railway link                    # captivating-vision / production
   railway config plan             # tylko odczyt
   ```
2. Oczekiwany wynik: `Your Railway configuration is already up to date.` Każda pozycja
   w planie oznacza różnicę między plikiem a produkcją. Wtedy **stop**: popraw plik
   w PR (albo porównaj z `railway config pull --force` do pliku tymczasowego), nie
   w Railway. Szczególnie niedopuszczalne są: usunięcie usługi, zmiennej albo domeny,
   zmiana `checkSuites` i dopisanie start command w `pracujbe`.
3. Dopiero przy pustym planie: `railway config apply`. Pierwszy apply z `partial`
   zapisuje własność usług `pracujbe` i `db-migrator`, nawet gdy nie ma zmian.
   Sprawdź to przez `railway config partials list`.
4. Od tej chwili zmiany konfiguracji tych usług idą przez PR z tym plikiem. Planowanie
   w CI (`railwayapp/config`, sekret `RAILWAY_TOKEN`) to osobna decyzja. Wymaga zmiany
   w `.github/workflows` i jest poza zakresem tej zmiany.

Wycofanie: `railway config partials release pracujbe-repo` zwalnia własność i nie
zmienia usług. Po nim można usunąć plik.

## Propozycje (nie wdrożone, zmieniłyby produkcję)

- **`db-migrator` bez `Wait for CI`.** Migrator wdraża się przy każdym pushu `main`,
  zanim CI zakończy pracę. Przy `MIGRATION_MODE=status` to tylko odczyt, ale przy
  `apply` nałożyłby migracje z czerwonego SHA. Rekomendacja: włączyć `Wait for CI`
  także tu.
- **Watch paths.** Żadna usługa ich nie ma. Dla `db-migrator` rozsądne byłyby
  `database/**`, `supabase/migrations/**`, `scripts/db/**`, `package.json`,
  `package-lock.json`. Nie wpisujemy ich do pliku: dokumentacja DSL IaC nie opisuje tego
  pola, a zgadywanie jest wykluczone (#19). Ustaw je w panelu, potem
  `railway config pull` pokaże właściwy zapis.
- `pracujbe`: jawne `start: "npm run start"` i `healthcheckTimeout` (plan: 300 s)
  zamiast wartości domyślnych, jako osobna, świadoma zmiana z planem.
