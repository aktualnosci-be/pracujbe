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

Nie ustawiaj jeszcze tego polecenia jako pre-deploy Railway. Produkcyjny
bootstrap ról, model auth i kontrakt Storage nie są ukończone. Dotychczasowe
pliki `supabase/migrations` same nie tworzą wszystkich wymaganych zależności
na pustym PostgreSQL. Testowy shim nie zastępuje produkcyjnego auth.

## Weryfikacja wykonana

Na osobnym kontenerze PostgreSQL 16 wykonano `scripts/db/test-migrations.mjs`:
pierwsze zastosowanie, powtórzenie, odmowa edycji/usunięcia/wstawienia w historię,
rollback całego przebiegu po błędzie SQL oraz dwa równoległe migratory.
Test wymaga pustej bazy o nazwie `pracujbe_migration_test`; nie usuwa istniejącej
bazy. CI uruchamia go w osobnym kontenerze z dynamicznym portem.

To dowód działania mechanizmu, nie gotowości schematu aplikacji ani zakończenia
migracji z Supabase. Następny etap: produkcyjny bootstrap i pełne testy RLS
pod docelowymi rolami połączeń.

## Bootstrap

Przygotowano database/bootstrap/0001_roles_and_identity.sql i scripts/db/test-bootstrap.mjs. Subagent wykonał na izolowanym PostgreSQL16 bootstrap,56 migracji, powtórzenie oraz testy ról i kontekstu tożsamości. Pełny istniejący zestaw RLS także przeszedł na osobnej świeżej bazie. CI ma niezależny kontener dla bootstrapu, aby fixture mechanizmu migracji nie wpływały na wynik.

Rola pracujbe_app jest NOLOGIN bez BYPASSRLS i bez własności tabel; operator musi jeszcze przygotować osobne loginy. Migrator pozostaje postgres ze względu na istniejące kontrakty SECURITY DEFINER. Konta i sesje wymagają #24, adapter transakcyjny #25, Storage #26. Nie ma jeszcze jednego produkcyjnego polecenia inicjalizującego cały backend; nie włączać automatycznych migracji Railway na tym etapie.
