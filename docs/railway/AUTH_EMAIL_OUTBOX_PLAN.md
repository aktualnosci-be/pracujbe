# Trwała kolejka wiadomości auth — kontrakt transakcji

Stan: 24 września 2026. Mechanizm zaimplementowany dla przypiętego Better Auth 1.7.5. Worker wysyłki podłączony do `/api/email/process` (#24/#78, `src/lib/auth/email-worker.ts`, opis w `docs/RESEND_SETUP.md`); konfiguracja crona i sekretów Railway — osobne zadanie.

## Ustalenie, od którego zależy poprawność

`signUpEmail` wykonuje INSERT użytkownika, credential i callback `sendVerificationEmail` wewnątrz `runWithTransaction`. Odczyt nowego profilu osobną pulą nie zobaczy niezacommitowanego wiersza. INSERT do kolejki z FK do tego profilu, również osobną pulą, może czekać na transakcję, która właśnie czeka na callback.

`requestPasswordReset` w 1.7.5 nie ma analogicznego opakowania: zapisuje verification, a następnie wywołuje callback. Sam transakcyjny callback nie wystarczy więc do wspólnego rollbacku tokenu i wiadomości.

Pakiet `@better-auth/core` 1.7.5 udostępnia przez publiczny eksport `@better-auth/core/context` funkcje `getCurrentAdapter` i `runWithTransaction`. Pierwsza zwraca adapter aktywnej transakcji; druga reużywa już aktywną transakcję. Bezpośredni import wymaga jawnej zależności o tej samej przypiętej wersji, a nie odwołania do wewnętrznej ścieżki `node_modules`.

Źródła: zainstalowane `better-auth/dist/api/routes/{sign-up,password}.mjs`, `@better-auth/core/dist/context/transaction.mjs`, [schematy pluginów i baza](https://better-auth.com/docs/concepts/database), [hooki](https://better-auth.com/docs/concepts/hooks).

## Wybrany projekt do zatwierdzenia

Migracja `0061_auth_email_outbox.sql` w katalogu `database/auth`:

- Prywatna tabela `auth.email_outbox`: identyfikator UUID, użytkownik, typ `verification`/`password_reset`, snapshot odbiorcy i języka, token, termin ważności, SHA-256 klucza idempotencji, stan, próby i dzierżawa workera.
- Wąski widok `auth.email_enqueue` oraz trigger `INSTEAD OF INSERT`. Model pluginu SDK pozwala wstawić tylko użytkownika, typ, token i jego rzeczywisty termin ważności. Trigger czyta profil w tej samej transakcji, wybiera język odbiorcy, tworzy snapshot i używa `INSERT ... ON CONFLICT`. Powtórzenie callbacka dla tego samego tokenu zwraca istniejące zlecenie i nie przywraca usuniętego sekretu.
- Język pochodzi z profilu: `preferred_locale → account_locale → signup_locale → en`. Język otwartego formularza resetu ani callbackURL klienta nie nadpisują go. Nieaktywny/usunięty profil nie dostaje zlecenia.
- `pracujbe_auth` ma dostęp tylko do widoku wejściowego. Nie otrzymuje `service_role` ani dostępu do domenowej kolejki. Nowa rola `pracujbe_auth_mail` obsługuje wyłącznie nazwane funkcje claim/complete/fail/expire. Zwykły runtime i użytkownicy portalu nie czytają tokenów.

Plugin dodaje model widoku. Callback maila wykonuje `await getCurrentAdapter(context.adapter)` i `await adapter.create(...)`. Awaria INSERT propaguje błąd; nie ma `void`, fire-and-forget ani logowania tokenu. Domyślny `runInBackgroundOrAwait` SDK przechwytuje błędy, dlatego plugin zastępuje go oczekiwaniem propagującym wyjątek. Weryfikacja używa rzeczywistego `exp` podpisanego tokenu. Reset sprawdza termin już zapisanego verification przez ten sam adapter.

Plugin opakowuje istniejący endpoint `requestPasswordReset` transakcją, zachowując jego oryginalne opcje, walidację i middleware. To wspólna ścieżka dla API i HTTP. Zewnętrzny wrapper `auth.handler()` nie wystarcza: SDK zastępuje kontekst adaptera na wejściu HTTP i zapis tokenu wychodzi wtedy poza transakcję. Test z awarią enqueue przez HTTP wykrył ten przypadek. Dotychczasowy signup zachowuje swoją transakcję SDK. Nie dodajemy publicznych tras aplikacji ani nie przełączamy istniejących Server Actions.

## Dostarczenie, ponawianie i retencja

Claim używa `FOR UPDATE SKIP LOCKED` i losowego identyfikatora dzierżawy. Tylko aktualny posiadacz dzierżawy może zatwierdzić wynik; spóźniony worker nie zmienia rekordu ponownie przejętego przez inną instancję. Przed claimem wygasłe tokeny przechodzą do `expired` i są kasowane. Próby mają limit, opóźnienie i nie mogą przekroczyć ważności poświadczenia.

Docelowy klucz idempotencji dostawcy to UUID zlecenia. `sent`, terminalne `failed` i `expired` zawsze usuwają token z bazy. Błąd dostawcy zapisujemy jako ustalony kod, bez jego dowolnego komunikatu mogącego zawierać adres albo link. Ponowienie tego samego zlecenia nie tworzy nowego UUID.

Warstwa przygotowania wiadomości buduje adres wyłącznie z kanonicznego origin HTTPS, typu zlecenia, snapshotu języka i tokenu. Dla resetu prowadzi do `/{locale}/ustaw-nowe-haslo`; dla weryfikacji do endpointu SDK z kontrolowanym docelowym panelem. Istniejące szablony `accountConfirmation` i `passwordReset` zostają źródłem treści.

Ten etap nie wysyła przez Resend, nie uruchamia crona i nie dostarcza publicznych tras. Uruchomienie workera oraz regularnego czyszczenia wygasłych sekretów pozostaje bramką przed produkcją. Istniejący domenowy `email_deliveries` i jego worker pozostają bez zmian.

## Dowód wymagany przed zamknięciem etapu

1. Rejestracja przez prawdziwe SDK zapisuje konto, profil, dwie akceptacje oraz wiadomość jednym commitem; niezależne połączenie nie widzi wiadomości przed commitem.
2. Wymuszony błąd enqueue usuwa cały signup. W reset-password błąd enqueue cofa również nowy verification. Nie ma pozornego sukcesu.
3. Reset otwarty w `pl` dla konta `fr`, które wybrało `nl`, zapisuje wiadomość i link `nl`.
4. Duplikat callbacka, także równoległy, daje jedno zlecenie i nie odtwarza tokenu po redakcji.
5. Zwykłe role nie odczytają kolejki ani widoku z tokenami. Dwa workery nie otrzymają tej samej aktywnej dzierżawy.
6. Wygaśnięcie, wysłanie oraz terminalna porażka czyszczą token; stara dzierżawa nie nadpisuje nowej.
7. Kontrole ujemne wykrywają brak transakcji resetu lub redakcji tokenu. Wszystko na jednorazowym PostgreSQL, bez danych produkcyjnych i bez rzeczywistej wysyłki.

Rollback kodu pozostawia tabelę i historię zleceń. Nie usuwamy historii ani tokenów masową migracją wsteczną; worker może opróżnić/oznaczyć pozostałe zlecenia do wygaśnięcia.

## Wykonana weryfikacja

19 testów integracyjnych na jednorazowym PostgreSQL 16 przeszło. Obejmują kryteria powyżej, błędy resetu przez API/HTTP/asResponse, ochronę origin przy cookies, odrzucenie obcego przekierowania i granice parametrów claim (także NULL). Przed poprawką test awarii enqueue wykrywał pozostawienie konta, a wariant HTTP pozostawiał token resetu mimo błędu. Po zmianie pluginu oba rzeczywiste błędy nie występują. Osobne 10 testów serwera auth sprawdza sesje, weryfikację, reset i wylogowanie; przeszły również po zmianie. `npm run verify`: lint, typy i 267 testów zielone, jeden test dowiązania pominięty na Windows.

Nie jest to potwierdzenie wysyłki przez Resend ani działania infrastruktury Railway.
