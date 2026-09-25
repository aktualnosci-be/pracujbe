# Zastąpienie Supabase Auth — przegląd i plan #24

Stan przeglądu: 21 września 2026. Odczyt kodu i aktualnych źródeł dostawcy; bez instalacji biblioteki, zmian aplikacji, bazy lub usług. Decyzja właściciela: pusty portal, Railway PostgreSQL, tylko production wdrażane z main. Nie trzeba przenosić haseł ani sesji dotychczasowych kont.

## Wniosek

Rekomendowany kandydat: **Better Auth 1.7.5**, sesje w PostgreSQL, adapter przez istniejący pakiet `pg`. Nie potrzeba Prisma, Drizzle, Redisa ani osobnego serwera auth. Wersję należy przypiąć i zatwierdzić w lockfile. To propozycja integracji, nie dowód działającego zamiennika.

Bezpośredni odczyt publicznego rejestru npm (`https://registry.npmjs.org/better-auth/latest`) zwrócił 1.7.5; peer dependencies obejmują Next `^14 || ^15 || ^16`, React i React DOM `^18 || ^19`, pg `^8`. Repo używa Next 15.5.24, React 19 i pg 8.23.0. Aktualne [oficjalne instrukcje Next.js](https://better-auth.com/docs/integrations/next) opisują App Router, `toNextJsHandler`, `auth.api.getSession` i plugin `nextCookies()` dla Server Actions. Plugin musi być ostatni w konfiguracji. Odczyt RSC sam nie zapisuje cookies, więc trzeba osobno sprawdzić odświeżanie sesji przez trasę HTTP.

## Kontrakt bazy i UUID

Zachować `auth.users.id = public.profiles.id` jako UUID. Migracja 0002 ma prawdziwy FK z kaskadą, a 0012 i 0020 odczytują adres odbiorcy z `auth.users.email`. Nie mapować modelu użytkownika Better Auth bezpośrednio na `public.profiles`: profil zawiera własne role, soft delete, preferencje i ochronę domenową.

Proponowana konfiguracja: dedykowany serwerowy Pool z `search_path=auth`, `user.modelName='users'`, pozostałe modele nazwane `sessions`, `accounts`, `verifications`; kolumny core mapowane jawnie na snake_case. `advanced.database.generateId='uuid'`. Adapter wspiera PostgreSQL bez ORM i wskazanie schematu. [Adapter PostgreSQL](https://better-auth.com/docs/adapters/postgresql).

Better Auth obsługuje własne nazwy tabel i kolumn, dodatkowe pola oraz UUID. Wygenerować SQL z konkretnej przypiętej wersji i konfiguracji, przejrzeć go i włączyć do naszego runnera migracji; nie wykonywać automatycznego `migrate latest` przy każdym starcie. [Schemat i UUID](https://better-auth.com/docs/concepts/database).

Minimalny podział danych projektowych:

| Tabela | Kontrakt integracyjny |
|---|---|
| `auth.users` | UUID, email, name, email_verified, image, created_at, updated_at oraz jawne pola rejestracji opisane niżej |
| `auth.accounts` | konto credential, hash hasła, UUID użytkownika; komplet kolumn wymaganych przez wygenerowany schemat |
| `auth.sessions` | losowy token sesji, UUID użytkownika, termin ważności, czas aktualizacji; nigdy identyfikator podany przez formularz |
| `auth.verifications` | dane weryfikacji/resetu według schematu biblioteki, bez dostępu użytkowników aplikacji |
| `public.profiles` | niezmienne ID, role i stan konta jako autorytatywna domena, języki komunikacji |

Nie wpisywać hashy do historycznego `encrypted_password` tylko po to, żeby udawać GoTrue. Hasło Better Auth należy do accounts. Istniejące `raw_user_meta_data` może pozostać dla zgodności bootstrapu, ale nie może być publicznie zapisywanym źródłem roli.

Migrator jest właścicielem DDL. Osobna rola auth zapisuje wyłącznie wymagane tabele auth; zwykły runtime domenowy nie czyta hashy, tokenów ani sessions. Rola auth nie może mieć ogólnego BYPASSRLS nad danymi aplikacji. Uprawnienia triggera bootstrapującego profil nadaje się wąsko i jawnie.

## Rejestracja i bootstrap profilu

Obecny `handle_new_user()` (0008) czyta role/imiona/locale z `raw_user_meta_data`, tworzy profil i notification_preferences. To trzeba dostosować, nie usunąć bez zamiennika.

Proponowany wariant: jawne dodatkowe pola użytkownika auth: first_name, last_name, signup_role, signup_locale, company_name. Walidacja wspólna dla Server Actions i bezpośredniej trasy biblioteki wymaga pełnego istniejącego schematu rejestracji (łącznie z potwierdzeniem hasła i agreeTerms). Signup_role dopuszcza WYŁĄCZNIE candidate/employer; nie jest aktualizowalną rolą aplikacji. BEFORE-hook tworzenia użytkownika buduje te dane z walidowanego kontekstu rejestracji. Dopasowany trigger SQL tworzy profil, preferencje i receipt dokumentów w tej samej operacji utworzenia użytkownika; brak receiptu powinien przerwać tworzenie, zamiast pozostawić niezapisane zobowiązanie.

Przed implementacją potwierdzić małym testem adaptera, że hook przekazuje dodatkowe pola przed INSERT oraz że błąd triggera nie pozostawia osieroconego konta credential. Jeśli potrzebny jest kompatybilny JSON metadata, budować go po stronie serwera/triggera z tych pól; nigdy przyjmować dowolnego JSON roli z przeglądarki. Nie polegać na `after` hooku wykonującym zapis przez osobny Pool jako gwarancji wspólnej transakcji.

Publiczna trasa `update-user` nie może aktualizować signup_role ani metadanych inicjalizacji. Najprościej ograniczyć handler HTTP do potrzebnych endpointów i zachować mutujące formularze przez istniejące Server Actions; wtedy dodatkowa walidacja bezpośredniego API musi objąć wszystkie pozostawione endpointy. Nie otwierać domyślnego catch-all bez przeglądu dostępnych operacji.

Wymagać weryfikacji adresu, bez automatycznego logowania po rejestracji. Firma może powstać idempotentnie po potwierdzeniu konta przez `create_company_with_owner`; nazwa z bezpiecznych danych rejestracji, rola z profiles. Ponowne zgłoszenie istniejącego adresu nie może nadpisywać jego profilu, roli, firmy ani zgód — sukces antyenumeracyjny biblioteki nie jest dowodem utworzenia nowego użytkownika.

## Mapa istniejących funkcji

| Obecnie | Docelowo |
|---|---|
| `signIn` w `src/lib/actions/auth.ts` | Zachować Zod, limiter i AuthActionResult; `auth.api.signInEmail`, headers z bieżącego żądania, rola odczytana z profiles, redirect przez next-intl |
| `registerCandidate` / `registerEmployer` | Te same formularze, walidacja i strona potwierdzenia; `signUpEmail` z wymaganym name z istniejących pól imienia i nazwiska; wspólny bootstrap powyżej |
| `requestPasswordReset` | `requestPasswordReset` biblioteki, neutralny wynik dla nieistniejącego konta, limit 5/h, link i język odbiorcy |
| `updatePassword` | Przyjmuje także token resetu; wywołuje `resetPassword({newPassword, token})`. Sama zalogowana sesja nie jest dowodem recovery |
| `NewPasswordForm` + strona ustaw-nowe-haslo | Odczyt tokenu z linku, przekazanie go do akcji, obsługa wygasłego/użytego tokenu; nie logować tokenu w analityce lub Sentry |
| `bootstrapCompany` | Zweryfikowana sesja → profil → transakcyjny RPC pod tym samym UUID; bez parametru SupabaseClient i bez user_metadata z klienta |
| `signOut` | Unieważnienie sesji w DB przez bibliotekę, usunięcie cookie, redirect; awaria DB nie może być raportowana jako potwierdzone globalne wylogowanie |
| `/auth/callback` | Koniec wymiany GoTrue PKCE. Callback aplikacyjny po weryfikacji sprawdza sesję, rolę i bezpieczny cel; stary code nie może tworzyć sesji |
| `/api/auth/email-hook` | Usunąć po odbiorze nowych callbacków wysyłki; nie zostawiać martwej zależności SEND_EMAIL_HOOK_SECRET |
| `supabase.auth.getUser()` w loaderach/akcjach | Jeden serwerowy helper sesji i profilu, potem tożsamość do warstwy PostgreSQL #25 |

Oficjalny mechanizm resetu używa tokenu i `resetPassword`. Ustawić `revokeSessionsOnPasswordReset=true`, ponieważ nie jest to zachowanie domyślne. Formularz zachowuje obecne ograniczenie 8–72 znaków, litera i cyfra; biblioteka nie zastępuje tej walidacji. [Email i hasło](https://better-auth.com/docs/authentication/email-password).

## Sesja, RLS i zabezpieczenia tras

Nowy helper `getCurrentSession()` ma być server-only i sprawdzać sesję w PostgreSQL, następnie `profiles.is_active=true`, `deleted_at IS NULL` i potwierdzenie e-maila. Nie używać cookie cache na etapie migracji: cofnięcie sesji ma działać od następnego żądania. Biblioteka dokumentuje opóźnienie odwołania przy cache; [sesje](https://better-auth.com/docs/concepts/session-management).

`middleware.ts` zachowuje next-intl i fail-closed gotowość, usuwa rotację Supabase. Obecność cookie może służyć wyłącznie do szybkiego redirectu. Guardy pozostają w layoutach ORAZ każdej chronionej akcji/trasie. Candidate odsyła employer/admin do właściwych paneli; employer wymaga aktywnego członkostwa; admin wymaga aktualnej roli z profiles. Weryfikację company_members i cookie pb_active_company z `company-context.ts` trzeba zachować. Role owner/admin/recruiter/member firmy nie stają się rolami sesji auth.

Do #25 przekazywać tylko UUID uzyskany ze zweryfikowanej sesji. `auth.uid()` w SQL odtwarza się z ustawienia transakcyjnego, np. claim sub ustawionego przez zaufany serwer. Nigdy z nagłówka użytkownika lub JSON body. Każde żądanie: BEGIN → SET LOCAL rola i parametr tożsamości → zapytania/RPC → COMMIT/ROLLBACK → oddanie połączenia. Anonim ma NULL. Próby kolejnych użytkowników na jednym połączeniu muszą dowieść braku wycieku. Auth Pool i Pool domenowy mają oddzielne zadania.

W konfiguracji produkcji: stały baseURL `https://pracuj.be`, silny sekret tylko na serwerze, dokładna allowlista origin, cookies Secure/HttpOnly/SameSite, bez wildcard Railway i bez localhost. Nie wyłączać kontroli CSRF/origin. Sprawdzić nagłówki proxy Railway eksperymentalnie przed zaufaniem x-real-ip; obecny komentarz w limiterze nie jest dowodem kontraktu nowego hosta. [Zabezpieczenia Better Auth](https://better-auth.com/docs/reference/security).

Zachować limiter aplikacyjny: signin 10/300s, register i password-reset 5/3600s, awaria limitera auth blokuje próbę. Wywołania `auth.api` na serwerze nie korzystają automatycznie z limitera HTTP biblioteki, więc nie wolno usuwać `checkRateLimit`. Dla pozostawionych tras HTTP zapewnić trwały limiter DB i test bezpośredniego wywołania. [Limity](https://better-auth.com/docs/concepts/rate-limit).

## E-mail i język odbiorcy

Zastąpić GoTrue webhook callbackami `sendVerificationEmail` i `sendResetPassword`. Zachować Resend i istniejące szablony React Email. Język wybiera `resolveRecipientLocale(profile)` w kolejności preferred_locale → account_locale → signup_locale → en. Rejestracja zapisuje locale przed wysłaniem; reset czyta konto odbiorcy, nawet gdy formularz otwarto w innym języku. Obecny email-hook czyta tylko metadata.locale — tego uproszczenia nie przenosić.

Wysyłka musi mieć trwałą kolejkę/retry i idempotencję Resend. Zapisać żądanie wysyłki przed potwierdzeniem sukcesu; nie zostawiać nieobsłużonej obietnicy `void sendEmail`. Jeżeli kolejka przechowuje URL z tokenem, to jest poświadczenie: dane dostępne wyłącznie workerowi, bez logowania, krótka retencja po wysyłce i termin ważności zgodny z biblioteką. Nie wkładać tokenu do publicznego payloadu powiadomień. Niedostępna wysyłka nie może pozorować dostarczenia listu. Limity i neutralne odpowiedzi nie mogą ujawniać istnienia adresu.

## Kolejność i bramka odbioru

1. #23: bootstrap ról i istniejących migracji; izolowana baza testowa. #24: przypięta biblioteka, wygenerowany schemat i test zgodności UUID/triggerów.
2. Helper sesji, endpointy i cookies; rejestracja/profile/zgody; weryfikacja i wysyłka. Potem logowanie/wylogowanie/reset oraz idempotentny bootstrap firmy.
3. #25: wszystkie odczyty i akcje z getUser oraz gałęzie isSupabaseConfigured przełączyć na nowy backend. Nie wdrażać do produkcji samych nowych cookies, gdy reszta aplikacji oczekuje Supabase JWT.
4. Gotowość produkcji zależy od nowej DB, auth secret i HTTPS; dostępność wysyłki potwierdzona przed otwarciem rejestracji. Brak konfiguracji nie uruchamia demo. #27 usuwa SDK i stare endpointy dopiero po odbiorze całości.

Wymagane testy integracyjne na prawdziwym PostgreSQL: rejestracja kandydat/pracodawca we wszystkich czterech językach; ten sam UUID w users/profiles/accounts/sessions; role admin i dowolne metadata odrzucane; bezpośredni HTTP signup nie omija zgód/walidacji; awaria triggera nie zostawia konta częściowego; brak sesji przed weryfikacją; odwołanie, wygaśnięcie i fałszywe cookie; reset obcego konta nie zmienia języka, token działa raz, sesje unieważnione; bootstrap firmy ponowiony bez duplikatu; brak PII firmy B, nieaktywny członek odcięty; podmieniony callback/origin odrzucony; limiter zachowany w Server Actions; różne UUID na ponownie użytym połączeniu; niedostępna DB daje fail-closed. Dodatkowo E2E obecnych formularzy, SSR i a11y.

Nie wykonano tych testów w tym przeglądzie. Pozostają warunkami odbioru implementacji, a nie zaliczonym wynikiem.

## Doprecyzowanie implementacji po schemacie 0057

Ponowny odczyt bieżącego kodu: 21 września 2026. Ten rozdział jest planem następnego PR, nie listą wykonanych zmian. Schemat `database/auth/0057_better_auth_core.sql` zawiera wyłącznie core auth i zachowuje `raw_user_meta_data`; **nie zawiera jeszcze pól signup_role/signup_locale ani nowego triggera zgód** proponowanych wyżej. Najpierw trzeba wybrać i przetestować jeden sposób przekazania danych rejestracji do triggera. Nie dopisywać tych pól do konfiguracji SDK, zakładając, że już istnieją w bazie.

### Dokładny zakres plików

| Plik | Następna zmiana i warunek odbioru |
|---|---|
| `package.json`, `package-lock.json` | Przypięte Better Auth 1.7.5; kompilacja na istniejącym Next/React; bez wymiany frameworka lub ORM |
| nowy `src/lib/auth/server.ts` | Leniwa inicjalizacja server-only, jawne mapowania z 0057, auth Pool, sekret/baseURL, weryfikacja e-maila, cookies, ograniczenie endpointów; import nie łączy się z DB podczas builda |
| nowy `src/lib/auth/session.ts` | Zweryfikowana sesja + aktywny profil; jeden helper dla akcji i loaderów; brak cookie cache i brak zaufania do roli zwróconej z klienta |
| nowy `src/lib/auth/errors.ts` | Mapowanie stabilnych kodów SDK do istniejącego ErrorCode; żaden message/body dostawcy nie trafia do UI |
| nowy `src/app/api/auth/[...all]/route.ts` | Node runtime, handler biblioteki z jawną listą dopuszczonych metod/operacji; origin, limity, rozmiar body; callback auth poza next-intl |
| `src/lib/actions/auth.ts` | Zachować sygnatury formularzy oprócz rozszerzenia UpdatePasswordInput o token; podmienić dostawcę, odczyt profilu, bootstrap firmy, limiter i wysyłkę |
| `src/lib/validation/auth.ts` | Wspólny schemat resetu z tokenem używany także przez NewPasswordForm; nadal 8–72 znaki, litera+cyfra, zgodne powtórzenie, zgody przy signup |
| `src/components/auth/AuthForm.tsx` | Zachować układ i tłumaczenia. Zmiany tylko jeśli wymaga ich mapowanie błędów; sprawdzić, że unchecked agreeTerms zatrzymuje wywołanie, bo payload obecnie buduje `agreeTerms: true` dopiero po udanej walidacji RHF |
| `src/app/[locale]/(auth)/ustaw-nowe-haslo/page.tsx` | Dodać Next15 `searchParams: Promise<...>`, wydobyć pojedynczy token/error i przekazać do formularza; utrzymać noindex |
| `src/app/[locale]/(auth)/ustaw-nowe-haslo/NewPasswordForm.tsx` | Token w wywołaniu updatePassword, obsługa braku/wygaśnięcia bez pozornego sukcesu; zachować focus, wartości pól i komunikaty |
| `src/app/auth/callback/route.ts` | Usunąć PKCE Supabase; callback weryfikuje nową sesję, stan profilu i dozwolony redirect, ewentualnie bootstrap firmy; nie używa dowolnego next do decydowania o roli |
| `src/app/[locale]/(auth)/potwierdzenie/page.tsx` | Przynajmniej skorygować opis starej wymiany kodu w komentarzu; strona pozostaje informacyjna, nie tworzy sesji |
| `src/middleware.ts` | next-intl + fail-closed zostają; brak klienta Supabase i rotacji JWT. Nie importować pg/auth serwera do Edge middleware |
| `src/lib/rate-limit.ts` | Trwały limiter PostgreSQL bez isSupabaseConfigured i bez createAdminClient; nadal osobna ścieżka uprzywilejowana, nie auth Pool |
| nowy `src/lib/auth/email.ts` | Callbacki weryfikacji/resetu, profil odbiorcy, resolveRecipientLocale, trwały zapis zlecenia i bezpieczne linki |
| `src/lib/email/outbox.ts` | Zastąpić adapter Supabase; utrzymać atomowy claim, retry i idempotencyKey=delivery.id; dla maili auth kontrolować termin tokenu i usuwanie wrażliwego payloadu |
| `src/lib/env.ts`, `src/app/api/health/route.ts`, `.env.example` | Nowe zależności gotowości zamiast Supabase; bez sekretów NEXT_PUBLIC; health nadal nie ujawnia szczegółów anonimowo |
| `src/app/api/auth/email-hook/route.ts` | Wycofać po odbiorze nowej wysyłki; nie przenosić zależności od podpisu GoTrue do Better Auth |
| `src/app/[locale]/{candidate,employer,admin}/layout.tsx`, `candidate/onboarding/{layout,page}.tsx` | Guard nowej sesji; zachować force-dynamic/noindex i reguły roli; adaptery danych panelu to zależność #25 |

`src/lib/db/transaction.ts` już udostępnia `withUserTransaction(pool, trustedUserId, action)` i ustawia `app.current_uid` lokalnie w transakcji. Użyć tej implementacji zamiast tworzyć drugi mechanizm tożsamości. Trzeba nadal dostarczyć rzeczywisty ograniczony Pool domenowy i typowane repozytorium profilu. **Auth Pool nie może używać helpera domenowego**: jego tabele i rola są osobne. Zwykły login NOINHERIT auth wymaga jawnego ustawienia roli na połączeniu; samo podanie jego URL do pg.Pool bez tego kroku nie daje uprawnień z 0057. Adapter i test muszą wykazać poprawną inicjalizację KAŻDEGO nowego połączenia, nie tylko pierwszego.

Zmiany w `src/messages/{pl,nl,fr,en}.json` i `src/lib/errors/index.ts` tylko przy rzeczywiście nowym stanie UI. Obecne AUTH_INVALID_CREDENTIALS, VALIDATION_FAILED, RATE_LIMITED, EMAIL_DELIVERY_FAILED i INTERNAL pokrywają większość potrzeb; nie kopiować komunikatów angielskich z SDK.

Aby zachować obecną ścieżkę „link potwierdzenia → panel”, ustawić jawnie `emailAndPassword.requireEmailVerification=true`, `emailAndPassword.autoSignIn=false` oraz `emailVerification.autoSignInAfterVerification=true`. Brak sesji przed potwierdzeniem i jej zapis po potwierdzeniu są osobnymi testami. Opcje potwierdza [referencja konfiguracji](https://better-auth.com/docs/reference/options). Na tym etapie nie włączać zmiany adresu ani usuwania użytkownika przez domyślne endpointy SDK: aplikacja ma soft delete i kopię e-maila w profiles, a auth.users ma kaskadowy FK. Takie operacje wymagają osobnych akcji domenowych, nie samej opcji w bibliotece.

### Rejestracja: nie przenosić ukrytych założeń

1. Obecne publiczne akcje same wybierają candidate/employer, a Zod usuwa nieznane pola. Zachować tę granicę: podpis formularza nie przyjmuje role=admin. Wspólny helper wewnętrzny nie powinien zostać dodatkowym eksportem Server Action przyjmującym dowolną rolę.
2. Bezpośredni endpoint biblioteki może ominąć Server Actions. W pierwszej wersji preferowane ograniczenie publicznego catch-all: rejestracja wyłącznie przez akcje aplikacji; publiczna weryfikacja/get-session i niezbędne ścieżki resetu według rzeczywistej listy endpointów 1.7.5. Sprawdzić testem, że blokada HTTP nie wyłącza wewnętrznego `auth.api` i nie blokuje callbacków biblioteki. Alternatywą jest pełna ta sama walidacja w endpointach — nie wolno zostawić wariantu połowicznego.
3. Dla bridge do starego `handle_new_user` dane first_name/last_name/locale/company_name/role muszą zostać dodane przed INSERT auth.users. Jeśli przechodzą przez hook konfiguracji, użyć izolowanego kontekstu pojedynczego żądania; zakaz modułowej zmiennej `currentSignup`, bo równoległa rejestracja pomiesza role i języki. Potwierdzić w teście adaptera obsługę dodatkowego JSON metadata i `input:false`; nie zgadywać zachowania SDK.
4. Obecny preferred_locale i receipt zapisują się po signUp metodą best-effort. `record_document_acceptance` w 0054 jest dostępny tylko service_role; pracujbe_auth z 0057 celowo NIE ma tych praw. Nie nadawać całego service_role auth. Osobna migracja wąskiego triggera/funkcji musi atomowo dodać preferowany język i dwa receipty po walidacji zgód, albo jasno zablokować możliwość aktywacji częściowo utworzonego konta. Nie interpretować każdego INSERT users jako zgody człowieka, bo to mogłoby tworzyć fikcyjne receipty w narzędziach administracyjnych.
5. Konflikt tego samego adresu (także różna wielkość liter) nie może zmienić roli ani danych istniejącego konta. Nie wykonywać aktualizacji na podstawie syntetycznego success/id ze ścieżki antyenumeracyjnej. Weryfikacja adresu i utworzenie profilu muszą być dowodem rzeczywistego nowego konta.

### Bootstrap pracodawcy: konkretna luka we współbieżności

Odczyt kodu wykazał, że `bootstrapCompany()` wykonuje najpierw SELECT członkostwa, a później oddzielne RPC. `create_company_with_owner` w 0011 zawsze tworzy nową firmę i ownera; sprawdza tylko obecność auth.uid(), nie rolę employer ani wcześniejsze członkostwo. Opis „idempotentny” nie obejmuje dwóch równoległych callbacków.

W następnej implementacji zamknąć bootstrap w jednym `withUserTransaction`: zablokować własny wiersz profiles `FOR UPDATE`, sprawdzić aktywność i role=employer, ponownie odczytać członkostwo, a dopiero potem wywołać RPC. Oba wywołania muszą użyć tego samego klienta transakcji. Nie zmieniać ogólnej możliwości posiadania wielu firm: ograniczenie dotyczy wyłącznie automatycznego bootstrapu po signup. Przy istniejącym nieaktywnym członkostwie nie reaktywować go ani nie tworzyć zastępczej firmy automatycznie.

Test: dwa jednoczesne wywołania bootstrapu świeżego pracodawcy → dokładnie jedna firma i jedno członkostwo owner. Kandydat z podmienionym company_name → brak firmy. Błąd INSERT członkostwa → brak pozostawionej firmy. Awaria bootstrapu po weryfikacji → konto pozostaje możliwe do zalogowania i bezpiecznego ponowienia.

### Reset, locale i limiter: kontrakty do sprawdzenia

- `NewPasswordForm` dziś wysyła wyłącznie dwa hasła; page nie czyta searchParams. `updatePassword` uznaje dowolną aktywną sesję za recovery. Nowy token musi wskazywać resetowane konto niezależnie od sesji przeglądarki: otwarcie linku B w przeglądarce zalogowanej na A zmienia hasło B, nigdy A. Bez tokenu sesja A nie daje prawa do resetu. Osobna zmiana hasła w ustawieniach wymaga currentPassword i nie może korzystać z tego endpointu.
- Przy zgubionym, wygasłym lub ponownie użytym tokenie nie pokazywać `auth.passwordUpdated`. Nie tworzyć automatycznej sesji resetem; po sukcesie obecny link do logowania jest właściwym zakończeniem. Unieważnić wszystkie sesje resetowanego konta.
- `requestPasswordReset` dziś buduje docelową ścieżkę z currentLocale, zaś GoTrue email-hook wybiera meta.locale z fallbackiem pl. Nowy mail ORAZ docelowy formularz należy zbudować z locale odbiorcy. Test: konto fr/preferred nl, formularz resetu pl → wiadomość nl i link do `/nl/ustaw-nowe-haslo`.
- `src/emails/templates.tsx` już obsługuje accountConfirmation `{firstName, confirmationUrl}` i passwordReset `{firstName, resetUrl}`. Nie trzeba nowych szablonów. Obecny outbox rozkłada payload, a następnie nadpisuje tylko linki application/offer/action/message, więc zachowuje resetUrl/confirmationUrl; nadal trzeba sprawdzić prywatność i TTL tych poświadczeń przed wykorzystaniem tej tabeli.
- `checkRateLimit` dziś omija wszystko bez isSupabaseConfigured. Po usunięciu Supabase ta gałąź wyłączyłaby limiter na produkcji. Bypass musi zależeć wyłącznie od jawnego trybu demo; błąd DB dla auth blokuje próbę. Nie przekazywać auth roli do RPC limitera tylko po to, żeby ominąć brak uprawnień.
- Lepiej nie wysyłać e-maila bezpośrednio z obsługi resetu istniejącego konta, kiedy ścieżka nieistniejącego wraca natychmiast. Kolejka, neutralny wynik i testy czasowe muszą ograniczać tę różnicę bez opóźniania utrwalania zlecenia. Odrębny limit na ponowne wysłanie weryfikacji chroni przed spamem przez endpoint biblioteki.

### Konkretny zestaw nowych testów

| Proponowany plik | Dowód, którego dziś brakuje |
|---|---|
| `tests/unit/auth-actions.test.ts` | Serwerowy Zod przed SDK; kandydat/pracodawca bez przyjęcia admina; stabilne błędy; limity mimo auth.api; redirect poza catch |
| `tests/unit/auth-rate-limit.test.ts` | Brak zmiennych Supabase przy skonfigurowanej Railway nie wyłącza limitera; błąd DB signin/register/reset blokuje |
| `tests/unit/auth-session.test.ts` | Profil zamknięty/usunięty, niepotwierdzony e-mail, odwołana sesja i błąd DB nie dają tożsamości; brak zaufania do cookie/role z wejścia |
| `tests/unit/auth-email.test.ts` | Pełny fallback locale, gotowe szablony, bezpieczny origin i docelowy locale linku; kolejka zamiast pozornej wysyłki |
| `tests/unit/auth-callback.test.ts` | Fałszywy code/cookie, obcy origin, `//`, backslash i zakodowany separator odrzucone; rola nie pochodzi z next |
| `tests/unit/new-password-form.test.tsx` | Token przekazany, brak tokenu nie wywołuje mutacji, błąd nie czyści poprawnych pól i nie wyświetla sukcesu |
| nowy test integracyjny `scripts/db/test-auth-runtime.mjs` lub równoważny runner TS | Rzeczywiste Better Auth + SQL0057 + adapter: signup, hash credential, verify, cookie, getSession, revoke, reset, równoległy bootstrap i rollback błędnego triggera |
| `tests/e2e/auth-real.spec.ts` z oddzielną konfiguracją lokalną | Przeglądarka przechodzi rejestrację → testowa skrzynka → weryfikacja → panel → logout → reset; role i PL/NL/FR/EN; lokalna testowa wysyłka zamiast listów do realnych odbiorców |

Istniejące `tests/e2e/flows.spec.ts` jawnie uruchamia panele bez sesji w trybie demo, a `a11y.spec.ts` sprawdza wygląd formularzy. Zielony wynik tych testów **nie dowodzi nowego auth**. Nowa konfiguracja integracyjna musi korzystać z rzeczywistej izolowanej bazy i aktywnej bramki sesji. Nie używać bypassu demo do ułatwienia testów logowania.

Kontrole ujemne nowych testów: chwilowe usunięcie sprawdzenia tokenu → reset-test oblewa; zamiana recipient locale na currentLocale → email-test oblewa; wyłączenie blokady profilu w bootstrapie → test współbieżny wykrywa duplikat; pominięcie limitera Server Action → test limitu oblewa. To plan testów — żadna z tych mutacji nie została wykonana w tym uzupełnieniu.

### Granica następnego etapu

Można zakończyć osobny PR konfiguracją, adapterem i testami integracyjnymi bez przepinania publicznego ruchu. Nie można ogłosić auth ukończonym ani przełączyć middleware na nowe cookie, dopóki guardy oraz loadery/actiony #25 dalej czytają Supabase. Włączenie produkcyjne wymaga jednej spójnej wersji aplikacji: nowe sesje, profile, dane, limity, mail i readiness. Ten dokument nie tworzy nowego środowiska, nie wymaga stagingu i nie upoważnia do tworzenia usług.

### Wykonany etap adaptera SDK (21 września 2026)

`src/lib/auth/server.ts` udostępnia fabrykę Better Auth 1.7.5 ze wstrzykiwaną pulą `pg`, osobnym sekretem, kanonicznym origin HTTPS i callbackami trwałej wysyłki. Mapuje schemat 0057, generuje UUID, wymaga potwierdzenia e-maila, wyłącza cache cookie i usuwa wszystkie sesje po resecie hasła. Ochrona origin oraz CSRF jest jawnie włączona również w testach (SDK domyślnie pomija origin w środowisku testowym). Rejestracja, zmiana e-maila i usuwanie konta pozostają wyłączone do spięcia reguł domenowych.

Wykonano 6 test?w konfiguracji `tests/unit/auth-server.test.ts` oraz test rzeczywistego SDK w `tests/integration/auth-server.test.ts` na osobnym PostgreSQL 16: wszystkie przesz?y. Test korzysta z ograniczonego loginu i roli `pracujbe_auth`, sprawdza blokadę signup, odmowę logowania przed weryfikacją, callback maila, weryfikację, UUID i cookie sesji, odrzucenie fałszywego cookie oraz obcego origin, jednorazowy reset, unieważnienie obu wcześniejszych sesji, stare/nowe hasło i wylogowanie. Kontrolowany użytkownik testowy powstaje jawnie w fixture; test nie dowodzi działającej rejestracji portalu. Bez zmiennej `AUTH_RUNTIME_TEST_DATABASE_URL` test integracyjny jest jawnie pomijany. Uruchomienie wymaga pustej lokalnej bazy `pracujbe_auth_runtime_test`, jawnego portu oraz `AUTH_RUNTIME_TEST_ISOLATED_CLUSTER=yes`. Kontener testowy usunięto. TypeScript i lint obu plików przeszły. Nie dodano publicznej trasy, globalnej instancji ani przełączenia istniejących akcji.

### Leniwa kompozycja runtime (22 września 2026)

`src/lib/auth/runtime.ts` składa istniejącą fabrykę Better Auth z ograniczoną
pulą `pracujbe_auth` dopiero przy pierwszym wywołaniu `getAuthRuntime()`.
Konfiguracja jest prywatna i jawna: `DATABASE_AUTH_URL`, `BETTER_AUTH_URL`
oraz `BETTER_AUTH_SECRET`. Sam import modułu ani brak konfiguracji nie otwiera
połączenia. Równoległe wywołania współdzielą jeden promise procesu; po błędzie
utworzona pula jest zamykana, odrzucony promise usuwany, a następne wywołanie
może ponowić inicjalizację. Błąd zewnętrzny jest zastępowany stałym komunikatem,
aby URL, hasło loginu i sekret nie trafiły do odpowiedzi lub logu wyższego poziomu.

To nadal nie jest przełączenie auth. Nie ma route handlera, importu runtime z
middleware, Server Actions, guardów, health checku ani konfiguracji Railway.
Zmienne w `.env.example` dokumentują kontrakt przyszłego wdrożenia; dopóki
wywołujący nie zostanie dodany w osobnym PR, moduł pozostaje nieaktywny.

### Przepięcie tras i akcji (24 września 2026)

Wykonane dla issue #24 (gałąź `claude/pg-auth-routes`): trasa `/api/auth/[...all]` z listą dozwolonych operacji (tylko `GET /get-session`), Server Actions na `auth.api` z jawnym przeniesieniem `Set-Cookie`, strony `potwierdz-email` i `ustaw-nowe-haslo` z tokenem we fragmencie, worker kolejki 0061, limiter PostgreSQL, guardy paneli na `getCurrentIdentity()`, middleware bez Supabase, gotowość i `/api/health` na PostgreSQL. Odstępstwa od planu powyżej: link weryfikacji nie prowadzi do endpointu SDK, tylko do strony aplikacji (przycisk → `confirmEmail`), a receipt akceptacji nie zapisuje IP ani user-agenta (trigger 0059 nie ma dostępu do żądania). Budżet wysyłki puli `auth` (#45) dotyczy dotąd tylko hooka Supabase — worker PostgreSQL go nie pobiera; do dołożenia razem z usunięciem hooka w #27.
