# Warstwa danych paneli na PostgreSQL Railway (#25)

Loadery (`src/lib/data/*`), Server Actions (`src/lib/actions/*`), layouty paneli, onboarding
i zadania serwerowe czytają i piszą bazę **bezpośrednio**, parametryzowanymi zapytaniami, bez
PostgREST i bez klienta Supabase. Wzorzec: publiczny odczyt ofert (`src/lib/db/public-jobs.ts`).

## Wejścia

| moduł | do czego |
| --- | --- |
| `getPortalIdentity()` (`src/lib/db/portal.ts`) | zalogowany użytkownik żądania: sesja Better Auth → `readPortalIdentity` (aktywny profil, potwierdzony e-mail, rola z bazy). Raz na żądanie (`cache`). `null` = gość albo brak konfiguracji. |
| `withPortalTransaction(identity, tx => …)` | jedno połączenie z puli domeny (`DATABASE_APP_URL`), `BEGIN` → `SET LOCAL ROLE authenticated` (gość: `anon`) → `app.current_uid` = UUID z sesji → zapytania → `COMMIT`/`ROLLBACK`. RLS i RPC decydują w bazie. Przyjmuje wyłącznie obiekt z `getPortalIdentity()`. |
| `withServiceRole(tx => …)` | osobna pula `service` (`DATABASE_SERVICE_URL`, login z jedynym członkostwem `service_role`). Tylko worker poczty, webhooki, cron, limiter i odczyty panelu admina **po** `requireAdmin`. Nigdy w loaderach kandydata/pracodawcy. |
| `isPortalDataConfigured()` | zastępuje `isSupabaseConfigured()` w warstwie paneli: `DATABASE_APP_URL` + konfiguracja Better Auth. Bez niej panele działają w trybie demo jak dotąd. |

Zapytania (`src/lib/db/sql.ts`) — wynik budowany w PostgreSQL przez `json_agg`/`to_json`,
czyli w tym samym kształcie co PostgREST (czas ISO z mikrosekundami, `bigint` jako liczba,
`jsonb` jako obiekt):

| helper | odpowiednik PostgREST |
| --- | --- |
| `queryRows(tx, 'nazwa', sql, values)` | `.select()` → tablica |
| `queryOne(...)` | `.maybeSingle()` (więcej niż jeden wiersz = błąd) |
| `queryCount(tx, 'nazwa', 'SELECT 1 FROM … WHERE …', values)` | `{ count: 'exact', head: true }` |
| `execute(...)` | `insert/update/delete` pod RLS (zwykle zbędne — zapis idzie przez RPC) |
| `rpc(tx, 'fn', { p_x: … })` | `.rpc()` funkcji skalarnej/jsonb/rekordu/void |
| `rpcRows(tx, 'fn', { … })` | `.rpc()` funkcji `SETOF`/`TABLE` |
| `jsonArg(value)` | argument `json`/`jsonb` (tablica wysłana jako JSON, nie literał tablicy PG) |
| `attempt(tx, () => …)` | niezależne żądania: SAVEPOINT, błąd sekcji nie przerywa transakcji |

Nazwa zapytania (`'employer.jobs-page'`) i nazwy funkcji/argumentów to **stałe** z kodu;
wartości zawsze w `$n`. Tablice: `col = ANY($1::uuid[])`.

## Reguły przepinania

1. `supabase.auth.getUser()` → `getPortalIdentity()`. `me.role` to rola z profilu (już
   sprawdzona) — nie czytamy jej drugi raz.
2. Jedna logiczna operacja = jedna transakcja. Błąd dowolnego zapytania przerywa transakcję:
   gdzie wcześniej każdy odczyt mógł zawieść osobno (np. liczniki pulpitu, #244), użyj
   `attempt` **sekwencyjnie**. `Promise.all` na jednej transakcji tylko dla „wszystko albo nic”.
3. Relacje osadzone PostgREST (`profiles(first_name)`) → podzapytanie
   `(SELECT to_json(p) FROM (SELECT … FROM public.profiles p WHERE p.id = a.candidate_id) p)`
   albo `LEFT JOIN`. RLS działa w podzapytaniu tak samo jak w osadzeniu.
4. `.range(a, b)` → `LIMIT b-a+1 OFFSET a`; `.or()`, `.is(null)`, `.in()` → SQL.
5. Błąd bazy to wyjątek (pg `DatabaseError`: `message`, `code`, `detail`). Mapowanie na kody
   użytkowe zostaje (`isDatabaseError`, `databaseErrorMessage` z `src/lib/db/errors.ts`);
   wyjątki spoza bazy → Sentry. Użytkownik nie widzi technikaliów (Invariant #8).
6. RPC zostają tymi samymi funkcjami SQL (idempotencja, CAS, historia, outbox bez zmian).
7. Tryb demo i gałęzie fixture E2E (`PLAYWRIGHT_APPLICATIONS_FIXTURE`) bez zmian.

## Testy

- **Unit** (`tests/helpers/fake-db.ts`): `vi.mock('@/lib/db/portal', … fakePortal())`, wyniki
  rejestrowane po nazwie zapytania albo RPC; argumenty RPC odtwarzane po nazwach. Nieznane
  zapytanie = błąd testu.
- **PostgreSQL 16** (`tests/integration/support/portal-db.ts` + `real-portal.ts`): pełne
  migracje produkcyjne, loginy runtime jak w produkcji, loadery i akcje wołane bez zmian.
  Każdy przepięty przepływ sprawdza prywatność (obca firma / inny kandydat / gość),
  zakres danych i stronicowanie. CI: job „Migration runner” (Docker). Lokalnie bez Dockera:
  `INTEGRATION_PG_ADMIN_URL=postgresql://postgres@127.0.0.1:5432/postgres npx vitest run
  --config vitest.integration.config.ts tests/integration/portal-*.test.ts`.
