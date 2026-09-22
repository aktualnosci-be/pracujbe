# Jednorazowe przygotowanie loginów PostgreSQL na Railway

Ta instrukcja tworzy i rotuje cztery ograniczone loginy runtime po migracjach
`0000..0061`. Nie uruchamia migracji, nie usuwa ról ani danych i nie wykonuje
żadnego `DROP`. Polecenia należy uruchomić lokalnie przez operatora, po ręcznym
sprawdzeniu nazwy usługi i bazy w Railway. Skrypt nie został uruchomiony na
produkcji w ramach PR-a, który go dodaje.

## Kontrakt

| login                        | jedyne członkostwo    | zastosowanie       |
| ---------------------------- | --------------------- | ------------------ |
| `pracujbe_web`               | `pracujbe_app`        | domenowa pula WWW  |
| `pracujbe_auth_runtime`      | `pracujbe_auth`       | Better Auth        |
| `pracujbe_limiter`           | `pracujbe_rate_limit` | limiter            |
| `pracujbe_auth_mail_runtime` | `pracujbe_auth_mail`  | worker poczty auth |

Każdy login ma `LOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS NOCREATEDB
NOCREATEROLE NOREPLICATION`, bez `ADMIN OPTION`, z `INHERIT FALSE` i `SET TRUE`
na jedynym członkostwie oraz bez własności bazy. Skrypt odmawia działania,
jeśli zastany login ma dodatkowe członkostwo, silniejszą flagę, bezpośredni
grant do obiektu albo jest właścicielem obiektu bazy. Provisioning i rotacja są
pojedynczą transakcją. Błąd wycofuje cały przebieg.

Preflight i verify są tylko odczytem. Wszystkie sekrety pochodzą ze zmiennych
środowiskowych. Nie wpisuj URL-i ani haseł po nazwie polecenia i nie włączaj
trace/debug powłoki. Skrypt wypisuje wyłącznie stałe komunikaty bez wartości
połączenia, loginów i haseł. Brak `DB_LOGIN_DRY_RUN` oznacza bezpieczny dry-run;
rzeczywisty zapis wymaga jawnego `DB_LOGIN_DRY_RUN=no`.

Hasło nigdy nie jest przekazywane do PostgreSQL. Proces oblicza lokalnie losowo
solony verifier `SCRAM-SHA-256` i dopiero verifier wysyła jako parametr protokołu.
Dynamiczny DDL może więc zawierać wyłącznie verifier, z którego nie da się
odzyskać hasła jawnego.

## 1. Ustaw jawny cel i sekrety w bieżącej sesji operatora

Ustaw poniższe zmienne w bezpiecznym magazynie/sesji powłoki. Nie zapisuj ich
w repozytorium ani historii poleceń:

```text
MIGRATION_DATABASE_URL
EXPECTED_DATABASE_NAME
EXPECTED_MIGRATION_USER
EXPECTED_POSTGRES_MAJOR

DATABASE_APP_PASSWORD
AUTH_DATABASE_PASSWORD
RATE_LIMIT_DATABASE_PASSWORD
AUTH_MAIL_DATABASE_PASSWORD
```

`MIGRATION_DATABASE_URL` jest osobnym połączeniem administratora migracji.
Skrypt nie używa `DATABASE_APP_URL` jako awaryjnego źródła. Oczekiwane wartości
muszą odpowiadać odczytowi Railway; dla obecnego schematu PostgreSQL major musi
mieć co najmniej 16. Każde hasło musi mieć 32–1024 drukowalne znaki ASCII bez
spacji; ten jawny zakres zapobiega różnicom SASLprep przy lokalnym liczeniu SCRAM.

## 2. Preflight i dry-run

```bash
npm run db:logins -- preflight
DB_LOGIN_DRY_RUN=yes npm run db:logins -- provision
```

Oba polecenia odmawiają działania, jeżeli połączenie wskazuje inną bazę,
użytkownika albo wersję, serwer jest repliką tylko do odczytu, historia i sumy
migracji nie są dokładnie zgodne z `0000..0061`, role bazowe lub RLS są
niezgodne albo portal nie jest pusty (`auth.users`, profile, firmy, oferty,
aplikacje i propozycje mają mieć zero wierszy).

## 3. Provisioning i kontrola

```bash
DB_LOGIN_DRY_RUN=no npm run db:logins -- provision
npm run db:logins -- verify
```

Ponowienie provisioningu jest bezpieczne: zgodne, istniejące loginy pozostają
bez zmian. Inne hasło ustawia wyłącznie jawna rotacja. Po verify zbuduj cztery
URL-e runtime w Railway z odpowiadających loginów i haseł. Sekretów nie kopiuj
do issue, PR-a ani logów CI.

## 4. Rotacja

Najpierw ustaw cztery nowe sekrety:

```text
DATABASE_APP_NEW_PASSWORD
AUTH_DATABASE_NEW_PASSWORD
RATE_LIMIT_DATABASE_NEW_PASSWORD
AUTH_MAIL_DATABASE_NEW_PASSWORD
```

Następnie wykonaj kontrolę i rotację:

```bash
DB_LOGIN_DRY_RUN=yes npm run db:logins -- rotate
DB_LOGIN_DRY_RUN=no npm run db:logins -- rotate
npm run db:logins -- verify
```

Po udanej rotacji zaktualizuj odpowiadające URL-e usług w Railway i wykonaj
kontrolowany restart. Stare hasła usuń z magazynu dopiero po potwierdzeniu
połączeń. W razie błędu przed `COMMIT` transakcja zachowuje poprzednie hasła;
nie próbuj naprawiać stanu przez ręczne dodawanie członkostw.

## Rollback

Skrypt nie ma automatycznego rollbacku przez kasowanie loginów. Bezpieczny
rollback rotacji to ponowne uruchomienie trybu `rotate` z poprzednimi, nadal
chronionymi wartościami jako `*_NEW_PASSWORD`. Usuwanie loginów lub danych
wymaga osobnej decyzji operatora i nie jest częścią tej procedury.
