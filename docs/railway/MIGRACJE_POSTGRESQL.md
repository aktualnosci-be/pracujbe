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
