# Migracja Railway — kolejność pracy

Aktualizacja właściciela: jedna produkcja z main, bez stagingu. [Decyzje](DECYZJE.md) zastępują ten fragment pierwotnego planu.

Aktualizacja 22 września 2026: Railway jest jedyną platformą docelową dla
runtime, PostgreSQL, cronów i prywatnych plików. MVP pozostaje bezpłatny:
nie uruchamiamy Stripe, checkoutu, pakietów ani ograniczeń subskrypcyjnych.
Usunięcie powierzchni sprzedażowych i zależności prowadzi issue #51.

Baza: b35087b, gałąź infra/railway oparta na pracach PR #8. Zmiany migracyjne są osobne; PR migracyjny zależy od tej bazy. Nie skonfigurowano jeszcze usług Railway ani DNS.

- [P0: Railway — plan migracji i pomiar bazowy](https://github.com/aktualnosci-be/pracujbe/issues/11)
- [P0: Railway — jawny APP_MODE i upload CV 5 MB](https://github.com/aktualnosci-be/pracujbe/issues/12)
- [P0: Railway — cron caller i oddzielne sekrety](https://github.com/aktualnosci-be/pracujbe/issues/13)
- [P0: Railway — production web i konfiguracja usług](https://github.com/aktualnosci-be/pracujbe/issues/14)
- [P1: Railway — CI i wdrażanie produkcji z main](https://github.com/aktualnosci-be/pracujbe/issues/15)
- [P1: Railway — odbiór produkcji i integracji](https://github.com/aktualnosci-be/pracujbe/issues/16)
- [P2: Railway — dzienna retencja i GC](https://github.com/aktualnosci-be/pracujbe/issues/17)
- [P1: Railway — domeny, cutover, rollback i obserwacja](https://github.com/aktualnosci-be/pracujbe/issues/18)
- [P2: Railway — IaC i cleanup po okresie stabilności](https://github.com/aktualnosci-be/pracujbe/issues/19)
- [P2: Railway — opcjonalne usprawnienia po migracji](https://github.com/aktualnosci-be/pracujbe/issues/20)
## Pierwszy etap implementacji

Przygotowano jawny APP_MODE, gotowość stagingu niezależną od indeksowania, limit żądania Server Actions 6 MB dla pliku CV do 5 MB oraz jednorazowy caller cron (POST, timeout 120 s, bez logowania sekretów). Oddzielne sekrety endpointów już istniały; opisano ich użycie na Railway. Legacy CRON_SECRET pozostaje na okres przejściowy.

Kontrola lokalna: lint, typecheck i 101 testów jednostkowych zaliczone. Testy regresyjne trybu i gotowości uruchomione przed poprawką wykazały 4 błędy, po poprawce wszystkie przechodzą. Nie potwierdzono jeszcze rzeczywistego uploadu CV z zalogowanym kontem ani integracji i prywatnej sieci Railway — odbiór w issues #14 i #16.

Build produkcyjny i Playwright: 20 zaliczonych, 1 pominięty. Testy przeglądarkowe używają danych demo, nie stanowią odbioru infrastruktury Railway.

Brama CI (#15, #50): CI i sprzątanie przebiegów mają wspólną kolejkę `queue: max`, bez anulowania uruchomionych zadań; joby CI wykonują się liniowo do czasu izolacji runnerów. Railway `production/pracujbe` śledzi `main` i ma włączone natywne `Wait for CI`; stary workflow Vercela, który mógł być zielony mimo pominiętego wdrożenia, został usunięty. Odbiór nadal wymaga potwierdzenia, że CI i wdrożenie dotyczą tego samego SHA.

Nowy backend zatwierdzony dla pustego portalu: #23 migracje, #24 auth, #25 dane/RLS, #26 pliki, #27 odbiór i usunięcie Supabase. Railway: projekt captivating-vision, production/pracujbe, main, Wait for CI potwierdzone odczytem API. Domena pracuj.be dodana; wymagany CNAME xetenf6j.up.railway.app. Nie potwierdzono jeszcze DNS ani gotowości backendu.

Poprawka CI: build E2E przeniesiony do osobnego kroku z limitem 15 minut. Poprzednia awaria była timeoutem 180 s kompilacji w webServer. Cały przebieg 35647500674 przeszedł; kompilacja E2E trwała 3 min 42 s, same testy 54 s. Osobny przebieg 35648115474 stracił katalog roboczy runnera podczas instalacji zależności; przyczyna usunięcia pozostaje nieustalona i wymaga kontroli hosta.

## Fundament nowego backendu — 21 września 2026

Bootstrap ról, wykonawca migracji z blokadą transakcyjną i kontrolą sum oraz testy na izolowanym PostgreSQL 16 są przygotowane (#23). Schemat `database/auth/0057_better_auth_core.sql` zachowuje UUID i klucze obce użytkowników, dodaje tabele sesji i poświadczeń oraz oddzielną rolę auth (#24). Test `scripts/db/test-auth-schema.mjs` sprawdza dostęp przez rzeczywiste ograniczone loginy, unikalność, kaskady i kontrolę ujemną ujawnienia poświadczeń. CI uruchamia go na osobnym klastrze, niezależnym od bootstrapu i testów migratora.

`src/lib/db/transaction.ts` zapewnia pojedyncze połączenie na transakcję, lokalną tożsamość i rolę, rollback oraz usunięcie uszkodzonego połączenia z puli (#25). UUID musi pochodzić ze zweryfikowanej sesji serwerowej. Pomocnik nie przyjmuje roli uprzywilejowanej. Lokalny `npm run verify`: 127 testów zaliczonych, 1 test dowiązania symbolicznego pominięty na Windows, lint i typecheck zaliczone.

To fundament, nie gotowa migracja: publiczny odczyt ofert jest już przełączony na PostgreSQL; przepływy logowania, prywatny odczyt/zapis domeny i magazyn CV nadal wymagają spięcia z aplikacją. Nie uruchamiaj samego schematu auth jako predeploy. `npm run db:migrate:production` układa bootstrap, całą historię domeny i migracje auth we wspólną transakcję z kontrolą sum. Rollback kodu zostawia tabele auth; usunięcie tabel skasowałoby sesje i poświadczenia.

Pule runtime (`src/lib/db/pool.ts`) używają oddzielnych loginów i ról startup dla auth oraz domeny. Kontrola odrzuca login superusera, CREATEROLE, ADMIN OPTION, dodatkowe członkostwo i właściciela bazy. Siedem testów na rzeczywistym PG16 potwierdza startup na dwóch różnych połączeniach, odmowę dostępu między pulami i brak eskalacji. Helper sesji (`src/lib/auth/session.ts`) bierze uprawnienia z aktywnego profilu, a nie pól klienta/cookie, oraz wymaga zweryfikowanego adresu. Sesje oczekują na spięcie z trasami; prywatne panele nadal korzystają ze starego dostawcy.

## Warstwa danych paneli na PostgreSQL — 24 września 2026 (#25)

Loadery, Server Actions, layouty paneli kandydata/pracodawcy/admina, onboarding, worker poczty, webhooki, limiter i cron korzystają z `src/lib/db/*` zamiast klienta Supabase: tożsamość z sesji Better Auth (`getPortalIdentity`), jedno połączenie na transakcję z `SET LOCAL ROLE authenticated`/`anon` i `app.current_uid`, RLS i te same RPC w bazie. Zadania uprzywilejowane idą osobną pulą `service` (`DATABASE_SERVICE_URL`, login z jedynym członkostwem `service_role`, piąty login `db:logins`). Migracja `0107` nadaje `claim_email_batch` EXECUTE dla `service_role`. Opis: `docs/railway/WARSTWA_DANYCH.md`.

Dowód: 8 plików `tests/integration/portal-*.test.ts` na PostgreSQL 16 z pełnymi migracjami i loginami jak w produkcji (prywatność: inny kandydat, obca firma, gość; stronicowanie; idempotencja RPC), testy unit na atrapie transakcji. Klient Supabase został wyłącznie w sesjach/trasach auth i middleware (#24) oraz w uploadzie CV (#26); SDK usuwa #27. Nie ustawiono zmiennych Railway. Znane braki: nazwa firmy z rejestracji nie podpowiada się w formularzu zakładania firmy (metadane konta niedostępne dla `authenticated` — wymaga #24 albo wąskiego RPC); kandydat nie widzi nazwy firmy w wiadomościach (stan od 0014, bez zmian).

## Integracja zmian — 21 września 2026, wieczór

- PR #8 ze stylem scalono do `main` jako `d2de4bbe` po pełnym zielonym CI `35652405154` dla dokładnej wersji PR. PR #21 kieruje już do `main` i zawiera ten merge. Wynik CI samego commita na `main` należy sprawdzić osobno.
- Publiczne oferty, szczegóły i liczniki używają ograniczonej puli `DATABASE_APP_URL`, parametryzowanych zapytań i roli `anon`. W produkcji brak konfiguracji lub awaria bazy powodują błąd, nigdy pokazanie danych demo. 33 testy PostgreSQL sprawdziły filtry, paginację i ukrycie ofert niepublicznych; 5 testów jednostkowych sprawdza podłączenie aplikacji.
- Rejestracja ma walidowany kontekst kandydata/pracodawcy, atomowy zapis poświadczeń, profilu i akceptacji dokumentów. To adapter testowany na PostgreSQL, jeszcze bez publicznej trasy. Bootstrap firmy i ograniczony limiter są osobnymi adapterami.
- Leniwa kompozycja runtime Better Auth łączy istniejącą fabrykę z ograniczoną pulą dopiero przy pierwszym użyciu. Współbieżne wywołania współdzielą inicjalizację, a błąd zamyka pulę, nie ujawnia konfiguracji i pozwala na ponowienie. Nie dodano trasy, nie przepięto akcji, middleware, guardów, health checku ani Railway.
- Transport prywatnego bucketu ma 64 testy podpisu żądań, walidacji i obsługi awarii. Repozytorium CV z migracją `0060` ma 62 testy PostgreSQL własności, stanów skanu i rollbacku. Rzeczywisty bucket Railway i pełny upload użytkownika pozostają do sprawdzenia.
- #26 (kod): upload, pobranie, usunięcie i kwarantanna CV przepięte z Supabase Storage na prywatny bucket Railway (`src/lib/files/*`, trasa `/api/files/cv/[id]`, akcje `actions/files.ts`). Konfiguracja: zmienne presetu „AWS SDK” bucketu + `FILE_DOWNLOAD_SECRET`; `/api/health` raportuje `fileBucket`/`fileDownloadSecret`. Bez nowej migracji. Bucketu nie utworzono — robi to właściciel/integrator (kroki: `STORAGE_ADAPTER_CONTRACT.md`, „Uruchomienie na Railway”).
- Zależności auth wymagają Zod 4. Istniejące schematy aplikacji pozostają na oficjalnym eksporcie `zod/v3`; resolver formularzy obsługuje obie wersje. Nie zmieniono reguł formularzy. Test kompatybilności sprawdza normalizację i klucze błędów zgody/hasła.
- Test braku wycieku puli oczekuje do 2 sekund na zamknięcie backendu PostgreSQL. Nadal wymaga zera obcych połączeń; usuwa wyścig między zamknięciem socketu i aktualizacją `pg_stat_activity`, wykryty w CI `35650817175`.

Nie potwierdzono jeszcze utworzenia PostgreSQL/bucketu na Railway, DNS ani gotowości produkcyjnych przepływów po zmianie dostawcy. Samo scalenie stylu nie jest potwierdzeniem deployu. Historyczny plan Vercel/Supabase/Stripe nie wyznacza dalszych prac.
