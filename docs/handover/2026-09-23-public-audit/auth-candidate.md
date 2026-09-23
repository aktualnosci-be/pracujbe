# Audyt: rejestracja i logowanie kandydata

Zakres: `/{pl,nl,fr,en}/logowanie`, `/rejestracja`, `/reset-hasla`, `/ustaw-nowe-haslo`, `/potwierdzenie`
(`src/app/[locale]/(auth)/**` bez `rejestracja-pracodawca`, `src/components/auth/AuthForm.tsx`,
`src/app/[locale]/(auth)/ustaw-nowe-haslo/NewPasswordForm.tsx`, `src/lib/validation/auth.ts`).
Serwer: http://localhost:3100 (tryb demo, bez bazy), `main` @ f11170e. Skrypty: `audit/auth-candidate/t1.js … t8.js`, zrzuty obok.

## Co działa (sprawdzone w przeglądarce, bez uwag)
- `autocomplete`: given-name / family-name / email / current-password / new-password — poprawne na wszystkich formularzach.
- Etykiety `<label for>` na wszystkich polach i na checkboxie zgody. Po nieudanym wysłaniu polu ustawia się `aria-invalid="true"` i `aria-describedby` wskazujące `<id>-error` (hasło dodatkowo `password-hint`). Po poprawieniu wartości błąd znika sam (ponowna walidacja przy zmianie).
- Fokus trafia na pierwsze błędne pole (RHF `shouldFocusError`): `firstName` / `email` / `password`.
- Podwójne wysłanie jest zablokowane: 3× Enter przy opóźnionej odpowiedzi daje dokładnie 1 POST server action; przycisk jest `disabled` i pokazuje „Ładowanie...”.
- Po błędzie serwera wpisane dane zostają (łącznie z hasłami).
- 320 px: brak poziomego przewijania (`scrollWidth == clientWidth`) na pl/nl/fr. Przy 640 px i tekście 200% formularze się mieszczą.
- Pierścień fokusu (biały 2 px + czerwony 4 px) widać na wszystkich elementach. `noindex, nofollow` na wszystkich stronach auth. `lang` jest zgodny z locale. Nie ma surowych kluczy i18n (4 języki × 5 stron). axe: jedyne naruszenie to `page-has-heading-one` (patrz #5); po pokazaniu błędów walidacji axe nie zgłasza nic więcej.

---

## 1. Baner cookies całkowicie zasłania fokusowane pola, checkbox i przycisk „Załóż konto” — P1, WCAG 2.4.11 Focus Not Obscured (Minimum)
**Odtworzenie:** otwórz `/pl/rejestracja` bez zapisanej zgody i przechodź klawiszem Tab (`t7.js`).
- 390×844: `passwordConfirm`, `agreeTerms`, przycisk „Załóż konto”, „Rekrutujesz? …” i „Zaloguj się” leżą **w całości** pod banerem (baner zaczyna się na y=527, a elementy mają top 637–825). Zrzut: `auth-candidate/obscured-390_pl_rejestracja.png`.
- 1366×768: `agreeTerms` i submit są w całości zasłonięte. Przy 1280×900 zasłonięte są linki pod formularzem.
- `/pl/logowanie` przy 390×844: zasłonięte są „Nie pamiętasz hasła?” i „Załóż konto”, a przycisk „Zaloguj się” częściowo.

**Oczekiwane:** fokusowany element jest widoczny. **Obecnie:** przeglądarka przewija element do widoku, ale ląduje on pod `position:fixed` banerem (`CookieConsent.tsx:147`). Baner jest na końcu kolejności Tab, więc użytkownik klawiatury wypełnia formularz „na ślepo”.
**Zakres:** wszystkie strony auth, wszystkie języki. Problem jest globalny, ale najbardziej szkodzi na ścieżce rejestracji.
**Pliki:** `src/components/cookies/CookieConsent.tsx` (zmierzyć wysokość banera i wystawić ją jako `--cookie-banner-h` na `<html>` przez ResizeObserver), `src/app/globals.css` (`html { scroll-padding-bottom: var(--cookie-banner-h, 0) }` oraz `padding-bottom` na body, gdy baner jest widoczny). Kluczy i18n nie trzeba.
**Uwaga poboczna (cookies, inna sesja):** przy 640 px i tekście 200% przyciski banera (`whitespace-nowrap`) wystają poza viewport, do x=934 (pl) i x=1032 (fr).
**Test regresyjny (Playwright, 390×844, bez zgody):** Tab do `#agreeTerms` i do submitu, potem sprawdź, że `getBoundingClientRect().bottom` elementu ≤ `top` banera.

## 2. Po błędzie wysyłki fokus ucieka na `<body>`, a komunikat błędu nie dostaje fokusu — P1, WCAG 2.4.3 Focus Order / 3.3.1
**Odtworzenie:** na `/pl/rejestracja` wypełnij poprawnie i wyślij (demo zwraca błąd). Tak samo `/pl/logowanie`, `/pl/reset-hasla`, `/pl/ustaw-nowe-haslo` (`t2.js`, `t3.js`).
**Obecnie:** `document.activeElement === <body>` na wszystkich 4 formularzach. Przycisk dostaje `disabled` podczas wysyłki, więc przeglądarka zdejmuje z niego fokus. Alert `role="alert"` jest tylko przewijany (`scrollIntoView`), a nie fokusowany. Użytkownik klawiatury po błędzie zaczyna Tab od początku strony.
**Oczekiwane:** fokus przechodzi na komunikat błędu (albo wraca na przycisk wysyłki).
**Pliki:** `src/components/auth/AuthForm.tsx`, `src/app/[locale]/(auth)/ustaw-nowe-haslo/NewPasswordForm.tsx`. Na kontenerze alertu dodać `tabIndex={-1}`, a w `useEffect` wywołać `alertRef.current?.focus({preventScroll:true})` po `scrollIntoView`. Ten sam mechanizm przyda się dla komunikatu sukcesu resetu hasła (`role="status"`). Kluczy i18n nie trzeba.
**Test regresyjny:** w trybie demo wyślij poprawny formularz i oczekuj, że `document.activeElement` ma `role="alert"` (lub jest przyciskiem submit), a nie jest `BODY`.

## 3. W trybie demo każde wysłanie kończy się komunikatem „Wystąpił błąd po naszej stronie. Pracujemy nad tym.” — P2
**Odtworzenie:** `/pl/logowanie`, `/pl/rejestracja`, `/pl/reset-hasla`, `/pl/ustaw-nowe-haslo` z poprawnymi danymi (`t2.js`, zrzuty `reg-demo.png`, `login-demo.png`).
**Obecnie:** `createServerClient()` rzuca `INTERNAL` (brak env Supabase) i formularz pokazuje `errors.internal`. Technikaliów nie widać (Invariant #8 spełniony), ale komunikat jest nieprawdziwy: nikt „nad tym nie pracuje”, bo konta są w tej instancji po prostu wyłączone. Użytkownik nie wie, czy ponowić próbę. Przed wysłaniem nic nie informuje, że logowanie i rejestracja nie działają.
**Oczekiwane:** zrozumiały komunikat, np. „Logowanie i zakładanie kont jest chwilowo niedostępne” (bez słowa „demo” i bez szczegółów konfiguracji), najlepiej widoczny już przed wypełnianiem formularza.
**Pliki:**
- `src/lib/actions/auth.ts`: przy `!isSupabaseConfigured()` zwracać nowy kod, np. `AUTH_UNAVAILABLE`, zamiast `INTERNAL`.
- `src/lib/errors` (definicja kodu).
- `src/components/auth/AuthForm.tsx` i `NewPasswordForm.tsx` (opcjonalnie informacja nad formularzem przekazana z page.tsx przez `isSupabaseConfigured()`).
- Strony `logowanie|rejestracja|reset-hasla|ustaw-nowe-haslo/page.tsx`.

W trybie produkcyjnym brak konfiguracji daje 503 w middleware, więc problem dotyczy tylko demo, stagingu i E2E.
**i18n:** nowy klucz `errors.authUnavailable` (i ewentualnie `auth.unavailableNotice`) w `src/messages/{pl,nl,fr,en}.json`. Test kluczy wymusi komplet.
**Test regresyjny:** unit dla `signIn`/`registerCandidate`/`requestPasswordReset` bez env, który oczekuje `{ok:false,error:'AUTH_UNAVAILABLE'}`. Do tego E2E: tekst alertu ≠ `errors.internal`.

## 4. Brak przełącznika „pokaż hasło” — P2 (użyteczność; pomocne dla WCAG 3.3.8 Accessible Authentication)
**Odtworzenie:** na wszystkich polach typu password w `/logowanie`, `/rejestracja`, `/ustaw-nowe-haslo` nie ma przycisku odsłaniającego hasło (`t1.js`: jedyne kontrolki to inputy i checkbox).
**Dlaczego to ważne:** grupa docelowa (telefon, pracownicy fizyczni) i reguła „litera + cyfra” zwiększają liczbę pomyłek, a formularz rejestracji wymaga dwukrotnego wpisania hasła na ślepo.
**Pliki:** nowy komponent `src/components/auth/PasswordInput.tsx` (Input i `<button type="button" aria-pressed aria-controls>` z ikoną Eye/EyeOff, cel ≥ 44×44 px, przełączanie `type` password↔text bez gubienia `autoComplete` i `ref` z `register`). Użyć go w `AuthForm.tsx` (pola `type: 'password'`) i `NewPasswordForm.tsx`.
**i18n:** `auth.showPassword`, `auth.hidePassword` w 4 plikach.
**Test regresyjny:** klik w przełącznik zmienia `type` na `text` i `aria-pressed="true"`, wartość zostaje, a `autocomplete` nadal ma wartość `new-password`/`current-password`.

## 5. Żadna strona auth nie ma nagłówka `<h1>` — P2, WCAG 1.3.1 / 2.4.6 (axe `page-has-heading-one`)
**Odtworzenie:** wszystkie 5 stron × 4 języki. `document.querySelectorAll('h1,h2')` daje `[]`, bo tytuł karty „Załóż konto kandydata” / „Zaloguj się” jest renderowany jako `<div>` (`CardTitle`).
**Pliki:** `src/app/[locale]/(auth)/{logowanie,rejestracja,reset-hasla,ustaw-nowe-haslo,potwierdzenie}/page.tsx`. Użyć `<CardTitle asChild><h1>…</h1></CardTitle>` albo dodać do `src/components/ui/card.tsx` prop `as`. Nie zmieniać globalnie `CardTitle` na h1, bo karty w panelach też go używają. Kluczy i18n nie trzeba.
**Test regresyjny:** dla każdej strony auth dokładnie jeden `h1` o treści `auth.<title>`. Można też dodać te strony do bramki `tests/e2e/a11y.spec.ts`: logowanie i rejestracja już tam są, ale reguła `page-has-heading-one` ma wagę moderate i bramka jej nie łapie.

## 6. Mylące komunikaty dla pustych pól: „Wpis jest za krótki.” zamiast „To pole jest wymagane.”, „Hasło musi mieć co najmniej 8 znaków.” zamiast „Podaj hasło.” — P2, WCAG 3.3.1/3.3.3
**Odtworzenie:** `/pl/rejestracja`, klik „Załóż konto” bez danych (`t2.js`, zrzut `reg-errors.png`). Imię i Nazwisko pokazują „Wpis jest za krótki.”, a Hasło „Hasło musi mieć co najmniej 8 znaków.”. Na `/ustaw-nowe-haslo` puste hasło też daje „…co najmniej 8 znaków.”. Tak samo w nl („De invoer is te kort.”) i en („The entry is too short.”).
**Przyczyna:** w `src/lib/validation/auth.ts` `nameRequired` i `passwordRequired` działają tylko przy `undefined` (`required_error`), a formularz wysyła `''`.
**Pliki:** `src/lib/validation/auth.ts`. W `nameSchema` dodać `.min(1,'auth.error.nameRequired')` przed `.min(2,…)`, a w `passwordSchema` dodać `.min(1,'auth.error.passwordRequired')` przed `.min(8,…)`. Schematy działają też na serwerze, więc kontrakt się nie zmienia. Klucze już istnieją we wszystkich 4 językach.
**Test regresyjny (Vitest):** `registerCandidateSchema.safeParse({firstName:'', password:'', …})` zwraca `auth.error.nameRequired` / `auth.error.passwordRequired` na odpowiednich ścieżkach.

## 7. Błędne pola nie są oznaczone wizualnie (czerwona ramka ma tylko pole z fokusem) — P2
**Odtworzenie:** `/pl/rejestracja`, pusty submit, zrzut `reg-errors.png`. Wszystkie 6 pól ma `aria-invalid="true"`, ale ramkę `border-input` (szarą) mają wszystkie poza fokusowanym. Błąd sygnalizuje tylko czerwony tekst pod polem. Przy długim formularzu na telefonie trudno znaleźć, które pole jest złe.
**Pliki:** `src/components/ui/input.tsx`: dodać `aria-[invalid=true]:border-error` (token semantyczny, bez hexów). To zmiana globalna, korzystna też dla innych formularzy. Checkbox: `src/components/ui/checkbox.tsx` analogicznie. Kluczy i18n nie trzeba.
**Test regresyjny:** po pustym submicie `getComputedStyle(#lastName).borderColor` jest równe kolorowi tokenu `--error` (porównanie z wartością z `:root`, nie z hexem).

## 8. Zgoda na regulamin i politykę prywatności nie linkuje do tych dokumentów — P2
**Odtworzenie:** `/pl/rejestracja`. Etykieta checkboxa „Zakładając konto, akceptujesz regulamin i politykę prywatności.” to zwykły tekst, a jedyne linki na stronie to `/pl`, `/pl/rejestracja-pracodawca`, `/pl/logowanie` i `/pl/polityka-cookies` (`t3.js`). Strony `/pl/regulamin` i `/pl/polityka-prywatnosci` istnieją (200). Akcja `signUpUser` zapisuje receipt akceptacji `terms`+`privacy`, choć użytkownik nie miał jak tych dokumentów otworzyć z formularza.
**Pliki:** `src/components/auth/AuthForm.tsx` (`t.rich('agreeTerms', { terms: c => <Link href="/regulamin" target="_blank">…, privacy: … })`). Uwaga: link wewnątrz `<Label>` przełącza checkbox po kliknięciu, więc linki trzeba umieścić poza `<label>` albo zatrzymać propagację. **Nie** wymyślać treści dokumentów (#9/#61), tylko linkować do istniejących stron.
**i18n:** zmiana `auth.agreeTerms` na rich text (`<terms>regulamin</terms> i <privacy>politykę prywatności</privacy>`) w 4 plikach.
**Test regresyjny:** na `/{locale}/rejestracja` w obrębie bloku zgody są linki o `href` kończącym się na `/regulamin` i `/polityka-prywatnosci` z bieżącym prefiksem locale. Klik w link nie zaznacza checkboxa.

## 9. Na stronach auth nie ma przełącznika języka — P2
**Odtworzenie:** `/nl/logowanie` (i każda strona auth). Layout `(auth)` renderuje tylko logo, a stopka i header z `LocaleSwitcher` są wyłączone. Nie da się zmienić języka inaczej niż edycją URL albo przejściem na stronę główną (co gubi kontekst, np. `?error=`). Dla grupy docelowej (obcokrajowcy) to realna bariera: link z e-maila trafia w języku konta, a nie przeglądarki.
**Pliki:** `src/app/[locale]/(auth)/layout.tsx`: dodać `LocaleSwitcher` z `src/components/layout/LocaleSwitcher.tsx` w headerze. Sprawdzić, czy switcher zachowuje query (`?error=`). Obecnie używa `usePathname`, który zwraca ścieżkę bez query. Kluczy i18n nie trzeba (switcher ma swoje).
**Test regresyjny:** na `/pl/logowanie?error=AUTH_INVALID_CREDENTIALS` wybór `nl` prowadzi na `/nl/logowanie?error=AUTH_INVALID_CREDENTIALS`, `html[lang=nl]`, a alert jest po niderlandzku.

## 10. Uwaga do weryfikacji z bazą (nie da się odtworzyć w demo, ustalone z kodu)
Nie jest to ustalenie odtworzone w przeglądarce. Zapisuję je, bo dotyczy zrozumiałości błędów.
- `src/lib/actions/auth.ts` → `mapAuthError`: `email_not_confirmed` (i każdy `status === 400`) jest mapowany na `AUTH_INVALID_CREDENTIALS`, czyli „Nieprawidłowy e-mail lub hasło.”. Świeżo zarejestrowany kandydat, który nie kliknął linku, usłyszy, że ma złe hasło, i prawdopodobnie zresetuje hasło, co nic nie da.
- `updatePassword`: brak sesji recovery (wygasły link) też daje „Nieprawidłowy e-mail lub hasło.” na stronie `/ustaw-nowe-haslo`, która w ogóle nie ma pola e-mail.

Propozycja: osobne kody `AUTH_EMAIL_NOT_CONFIRMED` (komunikat „Potwierdź adres e-mail — sprawdź skrzynkę”, bez ujawniania istnienia konta tylko wtedy, gdy hasło było poprawne, co Supabase już weryfikuje) i `AUTH_LINK_EXPIRED` (z linkiem do `/reset-hasla`). Klucze `errors.*` w 4 językach. Weryfikacja wymaga sesji z Supabase (inna sesja lub staging).

## Drobne (bez osobnego zgłoszenia)
- Samodzielne linki tekstowe („Nie pamiętasz hasła?”, „Wróć do logowania”, „Rekrutujesz? …”, „Zaloguj się”) mają 17 px wysokości. Spełniają 2.5.8 (wyjątek odstępu: środki linków są 32 px od siebie), ale są poniżej przyjętych w repo 44 px dla mobile. Checkbox zgody ma 20×20 px, co wystarcza dzięki klikalnej etykiecie.
- Na mobile (390 px) formularz zaczyna się dopiero na y≈145, bo layout `(auth)` ma `py-8` headera, a strona ma własne `container … min-h-[calc(100vh-8rem)] py-12`. Przez to podwójne wypełnienie baner z #1 zasłania pola jeszcze wcześniej. Pliki: pięć `page.tsx` w `(auth)` (usunąć zewnętrzny `container min-h py-12`, bo layout już centruje).
