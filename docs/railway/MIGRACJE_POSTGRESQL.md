# Mechanizm migracji PostgreSQL — etap #23

`node scripts/db/migrate.mjs` wymaga jawnych `MIGRATION_DATABASE_URL` i
`DB_MIGRATIONS_DIR`. Używa jednego połączenia, transakcji oraz blokady
advisory. Rejestr `app_migrations.history` przechowuje nazwę, SHA-256 i datę.
Zmiana, usunięcie albo wstawienie pliku przed wykonaną migracją powoduje
odmowę. CRLF jest normalizowane do LF przed obliczeniem sumy.

Wszystkie pliki muszą działać we wspólnej transakcji. Nie mogą zawierać
własnego BEGIN/COMMIT/ROLLBACK ani operacji wymagających wykonania poza
transakcją. Są zaufanym kodem repozytorium podlegającym przeglądowi PR.
Migracje nie są przyjmowane od użytkowników aplikacji.

Polecenie dla pojedynczego katalogu służy testom mechanizmu. Dla całego backendu
użyj opisanego niżej `db:migrate:production`; sam katalog `supabase/migrations`
nie tworzy wymaganych ról na pustym PostgreSQL. Testowy shim nie zastępuje
produkcyjnego auth.

## Weryfikacja wykonana

Na osobnym kontenerze PostgreSQL 16 wykonano `scripts/db/test-migrations.mjs`:
pierwsze zastosowanie, powtórzenie, odmowa edycji/usunięcia/wstawienia w historię,
rollback całego przebiegu po błędzie SQL oraz dwa równoległe migratory.
Test wymaga pustej bazy o nazwie `pracujbe_migration_test`; nie usuwa istniejącej
bazy. CI uruchamia go w osobnym kontenerze z dynamicznym portem.

To dowód działania mechanizmu. Odbiór logowania, danych i plików pozostaje
osobnym warunkiem zakończenia migracji z Supabase.

## Bootstrap

Przygotowano database/bootstrap/0001_roles_and_identity.sql i scripts/db/test-bootstrap.mjs. Subagent wykonał na izolowanym PostgreSQL16 bootstrap,56 migracji, powtórzenie oraz testy ról i kontekstu tożsamości. Pełny istniejący zestaw RLS także przeszedł na osobnej świeżej bazie. CI ma niezależny kontener dla bootstrapu, aby fixture mechanizmu migracji nie wpływały na wynik.

Rola pracujbe_app jest NOLOGIN bez BYPASSRLS i bez własności tabel; operator musi jeszcze przygotować osobne loginy. Migrator pozostaje postgres ze względu na istniejące kontrakty SECURITY DEFINER. Konta i sesje wymagają #24, adapter transakcyjny #25, Storage #26.

## Jedno polecenie dla całego schematu

`npm run db:migrate:production` wymaga jawnego `MIGRATION_DATABASE_URL`. Nie
odczytuje URL aplikacji ani nie tworzy loginów z hasłami. Bootstrap, dotychczasowe
migracje domeny i nowe migracje auth są stosowane razem, na jednym połączeniu,
w jednej transakcji z blokadą i kontrolą sum.

Tryb wybiera `MIGRATION_MODE` (domyślnie bezpieczny odczyt):

| tryb | działanie |
| --- | --- |
| `status` (domyślny) | sesja `READ ONLY`: liczba zastosowanych i lista oczekujących migracji; odmowa przy niezgodnej historii; nie tworzy schematu `app_migrations` |
| `dry-run` | nakłada oczekujące migracje w jednej transakcji i **zawsze** robi `ROLLBACK` — dowód, że przejdą na tej bazie |
| `apply` | nakłada i zatwierdza; wymaga jawnego wyboru |

Procedura na produkcji Railway: `docs/railway/WDROZENIE_MIGRACJI.md`.

W historii bootstrap otrzymuje nazwę `0000_bootstrap_roles_and_identity.sql`.
Plik źródłowy pozostaje w `database/bootstrap`. Pozostałe numery są unikalne
między katalogami `supabase/migrations` i `database/auth`; kolejną zmianę zawsze
dopisuje się po ostatnim numerze. Bootstrapu i zastosowanych plików nie edytować.

Test `signup-receipts.test.ts` inicjalizuje pusty PostgreSQL tą samą ścieżką,
potwierdza brak zmian przy drugim przebiegu oraz atomowy zapis profilu/języka
i akceptacji dokumentów. Brak markeru rejestracji nie tworzy fikcyjnych zgód.
Błąd zapisu akceptacji cofa cały INSERT użytkownika. Rollback aplikacji pozostawia
historię akceptacji i poświadczenia; nie usuwa tych danych automatycznie.

Włącz pre-deploy dopiero wraz ze spójnym wydaniem backendu i po przygotowaniu
ograniczonych loginów oraz konfiguracji auth/storage. Test nie potwierdza
gotowości produkcyjnej instancji Railway.

## Bezpłatny cykl życia ofert — część #51

Migracja `0062_free_job_lifecycle.sql` zastępuje funkcje `publish_job` i
`set_job_status`, usuwając z publikacji, wznowienia i ponownego otwarcia kontrolę
planu oraz subskrypcji. Nie usuwa tabel billingowych, katalogu
`plan_entitlements`, funkcji odczytujących uprawnienia ani obsługi błędu
`ENTITLEMENT_LIMIT`, dzięki czemu zachowuje zgodność podczas etapowego wyłączania
monetyzacji.

Pozostają wymagane: sesja użytkownika, rola recruiter+ w firmie, status firmy
`verified`, kompletność publikowanej lub ponownie otwieranej oferty, dozwolona
zmiana stanu, blokada wiersza i zapis CAS. Aplikacyjny limit publikacji i zmian
statusu pozostaje równy 20 operacji na godzinę na użytkownika.

Rollback aplikacji nie cofa automatycznie tej migracji, bo pliki zastosowanych
migracji są niezmienne. Jeśli decyzja produktowa zostanie odwrócona, należy
dodać kolejną migrację przywracającą funkcje z kontrolą
`company_max_active_jobs`, razem z testem limitu i sprawdzeniem istniejących
aktywnych ofert. Tabele billingowe pozostają na miejscu, więc rollback nie
wymaga odtwarzania danych finansowych.

## Uprawnienia klienta i definerów — 0067/0068 (#25)

- `0067`: każda funkcja `SECURITY DEFINER` w `public`/`auth` ma `search_path`
  zakończony `pg_temp`; rolom runtime odebrano `TEMPORARY` na bazie. Nowy definer
  ustawia `set search_path = public, pg_temp` (lub węższy, zawsze z `pg_temp` na końcu).
- `0068`: `authenticated` nie ma `INSERT/UPDATE/DELETE` na tabeli, jeśli żadna polityka
  RLS nie dopuszcza tego polecenia. Nowe tabele nie dostają domyślnie zapisu klienta —
  migracja, która go potrzebuje, dodaje jawny `GRANT` razem z polityką.
- Oba niezmienniki sprawdza `supabase/tests/role-guard.sql` w jobie `rls`
  (produkcyjny bootstrap, kontrole ujemne, strażnik roli po każdym `set role`).
- Rollback nie wymaga zmian danych: przywrócenie poprzedniego `search_path`,
  `GRANT TEMPORARY ON DATABASE … TO PUBLIC` i ponowne granty wypisane przez `NOTICE` 0068.

## Języki serwisu jako dane — 0069 (#29)

- `public.supported_locales` to jedyna lista języków w bazie (pl/nl/fr/en). Odczyt ma
  każdy (`anon`/`authenticated`), zapis tylko migracja.
- Kolumny locale (`profiles.*_locale`, `jobs.default_locale`, `job_translations`,
  `job_requirements`, `applications`, `offers`, `email_deliveries`, `consent_versions`,
  `document_acceptances`, `auth.email_outbox`) mają klucz obcy do
  `supported_locales(code)` zamiast CHECK z listą. Nazwa: `<dawny_check>_fk`.
- Funkcje używają `public.is_supported_locale(text)` (STRICT: NULL → NULL, jak `in (...)`).
  Migracja kończy się asercją, że żadna funkcja ani CHECK nie powiela listy; sekcja
  KK w `supabase/tests/rls.sql` sprawdza to samo oraz dodanie języka jednym wierszem.
- Nowy język (np. ro/uk): osobna migracja `insert into public.supported_locales` —
  dopiero razem z tłumaczeniami UI i `routing.locales` (lista w aplikacji, PR #280).
- Rollback: nowa migracja odtwarzająca CHECK-i z listą w miejsce FK (lista kolumn
  w `NOTICE` 0069) i poprzednie definicje funkcji; bez zmian danych.
