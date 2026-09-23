# Audyt: ścieżka pracodawcy przed zalogowaniem

Zakres: CTA dla pracodawców (nagłówek desktop i mobile, home, stopka), `/{locale}/rejestracja-pracodawca`, przejście do logowania, publiczne powierzchnie sprzedażowe (#51).
Środowisko: `main` @ f11170e, http://localhost:3100 (tryb demo, bez bazy), Chromium z Playwright i axe-core.
Skrypty i zrzuty: `scratchpad/audit/employer/` (t1–t10.js, `common.js` zamyka baner cookies przyciskiem „Tylko niezbędne”).

Sprawdzone bez uwag:
- axe (WCAG 2.0–2.2 A/AA): 0 naruszeń na `/rejestracja-pracodawca` w PL/NL/FR/EN.
- Brak poziomego przewijania przy 320 px i przy 640 px z tekstem 200% (4 języki).
- `lang`, tytuł i `noindex` są poprawne.
- Pola mają etykiety, `aria-invalid` oraz `aria-describedby` wskazujące błąd i podpowiedź.
- Po pustym wysłaniu fokus trafia na pierwsze błędne pole. Błędy znikają po poprawieniu wartości.
- Przycisk jest zablokowany podczas wysyłki: przy opóźnieniu 1,5 s, podwójnym kliknięciu i Enter poszedł dokładnie 1 POST.
- Wpisane dane zostają po błędzie serwera.
- Fokus jest widoczny (ring 2 px) na wszystkich elementach.
- Menu mobilne zamyka się Escape i oddaje fokus przyciskowi „Menu”.
- Cele w nagłówku mają co najmniej 24 px: Menu i konto 44×44, CTA desktop 36 px wysokości.

Stan #51 (issue otwarte): na publicznych stronach przed zalogowaniem nie widać cen, pakietów ani CTA zakupu w 4 językach. Sprawdzone strony: home, rejestracja pracodawcy, logowanie, lista ofert, FAQ, O nas. „€” występuje tylko w stawkach ofert.
Uwaga poboczna: cały katalog `messages` (~60 KB, razem z przestrzenią `billing`: „Wybierz pakiet”, „Twój plan”…) jest wysyłany w payloadzie RSC każdej strony (`src/app/[locale]/layout.tsx`, `NextIntlClientProvider messages={messages}`). Tych tekstów nie widać w UI, więc nie blokuje to kryterium #51. Ma to jednak wpływ na wydajność i warto to rozważyć przy #51 lub osobno.

Nie da się sprawdzić w demo: poprawne wysłanie formularza w trybie demo zwraca `INTERNAL` („Wystąpił błąd po naszej stronie…”), bo nie ma Supabase. Nie da się tu zweryfikować przekierowania do `/potwierdzenie` ani obsługi istniejącego e-maila.

VAT: formularz rejestracji przed zalogowaniem nie ma pola VAT. VAT jest w `/employer/firma` (patrz #92), więc przed zalogowaniem nie ma walidacji VAT do audytu.

---

## 1. [P1] „Dodaj ofertę pracy” na stronie głównej prowadzi do 404 (4 języki)
- Kryterium: użyteczność kluczowej ścieżki. Pośrednio WCAG 3.2.4 (spójna identyfikacja): ten sam cel „Dodaj ofertę” w nagłówku działa, a na home nie.
- Kroki: `/{pl|nl|fr|en}` przy 1280 px lub 320 px. Kliknij kafelek w hero „Dodaj ofertę pracy / Dotrzyj do tysięcy kandydatów” albo przycisk „Dodaj ofertę pracy” w karcie „Jesteś pracodawcą?”.
- Obecnie: `/{locale}/dla-pracodawcow` zwraca HTTP 404 (skrypt t6 i curl, wszystkie 4 języki). Ładuje się **domyślna, angielska strona 404 Next.js**: „404: This page could not be found.”, `<html lang="">`, bez nagłówka, stopki i tłumaczeń (t7, `cta404-nl.png`).
- Oczekiwane: te same CTA w nagłówku (`Header.tsx`), menu mobilnym i stopce prowadzą do `/rejestracja-pracodawca` (200).
- Pliki:
  - `src/components/public/HeroSearch.tsx` (`POST_JOB_PATH = '/dla-pracodawcow'`)
  - `src/components/public/ForCompanies.tsx` (`POST_JOB_PATH = '/dla-pracodawcow'`)
- Klucze `messages`: nie trzeba zmieniać.
- Szkic poprawki: ustaw cel na `/rejestracja-pracodawca`, najlepiej jako jedną wspólną stałą ścieżki używaną przez Header, MobileNav, Footer, HeroSearch i ForCompanies. Nie twórz strony `/dla-pracodawcow` z wymyśloną treścią. Landing dla pracodawców to decyzja właściciela.
- Problem ogólny, do zgłoszenia osobno lub agentowi od stanów błędów: w `src/app/[locale]` nie ma catch-all `[...rest]/page.tsx` → `notFound()`. Dlatego każda nieznana ścieżka pod locale pokazuje nieprzetłumaczoną domyślną 404 zamiast `src/app/[locale]/not-found.tsx`.
- Test regresyjny (e2e): dla każdego locale zbierz wszystkie `a[href^="/{locale}"]` na `/{locale}` i sprawdź przez `request.get` status 200. Test nie powinien znać konkretnego adresu.

## 2. [P1] Na mobile baner cookies w całości zasłania przycisk „Załóż konto”, także przy maksymalnym przewinięciu
- WCAG: 2.4.11 Focus Not Obscured (Minimum), fokus zasłonięty w całości. Użytkownik nie może wysłać formularza bez wcześniejszej decyzji w banerze.
- Kroki: `/pl/rejestracja-pracodawca` bez zapisanej zgody, viewport 320×568, 320×800 lub 390×844. Ustaw fokus Tabem na przycisku wysyłki albo przewiń do końca strony.
- Obecnie (t5): przy 320×568 baner ma y 231–568, a przycisk y 287–335 przy `scrollY = scrollMax`. `elementFromPoint` na środku przycisku zwraca baner. Tak samo przy 320×800 i 390×844. Kliknięcie Playwrighta kończy się timeoutem („cookie-banner … intercepts pointer events”). Przy 1280×800 jest dobrze.
- Oczekiwane: pod banerem zostaje miejsce (padding lub scroll-padding) i ostatni element strony da się przewinąć ponad baner.
- Zakres: każda krótka strona z formularzem na dole. Prawdopodobnie też logowanie i rejestracja kandydata (komponent **współdzielony**, obszar cookies).
- Pliki:
  - `src/components/cookies/CookieConsent.tsx` (wysokość zmierzona np. ResizeObserverem → zmienna CSS `--cookie-banner-h`)
  - `src/app/globals.css` (`body { padding-bottom: var(--cookie-banner-h, 0) }` i `scroll-padding-bottom`)
  - ewentualnie `src/app/[locale]/(auth)/layout.tsx`
- Klucze `messages`: nie trzeba zmieniać.
- Test (e2e, 320×568, baner widoczny): przewiń do końca, ustaw fokus na `button[type=submit]` i sprawdź, że `elementFromPoint` w środku przycisku zwraca sam przycisk.

## 3. [P2] Puste pole pokazuje komunikat „za krótki” zamiast „wymagane”. Istniejące klucze „Required” są martwe
- WCAG: 3.3.1 i 3.3.3. Komunikat „Wpis jest za krótki.” przy pustym „Imię” i „Nazwisko” nie mówi, czego brakuje.
- Kroki: `/{locale}/rejestracja-pracodawca`, kliknij „Załóż konto” bez wypełniania pól (t1).
- Obecnie: firma pokazuje „Nazwa firmy jest za krótka.”, imię i nazwisko „Wpis jest za krótki.”, hasło „Hasło musi mieć co najmniej 8 znaków.” (NL/FR/EN analogicznie). Klucze `auth.error.companyNameRequired` i `auth.error.nameRequired` nigdy się nie pojawiają, bo RHF przekazuje `''`, a `required_error` działa tylko dla `undefined`.
- Oczekiwane: puste pole daje „Podaj nazwę firmy.”, „Podaj imię.” itd.
- Pliki: `src/lib/validation/auth.ts` (dodaj `.min(1, '…Required')` przed `.min(2, …)` dla companyName i nameSchema, opcjonalnie `passwordRequired`). **Współdzielone** z rejestracją kandydata (imię, nazwisko, hasło).
- `messages`: `companyNameRequired` i `nameRequired` już istnieją. Konkretniejsze komunikaty wymagałyby nowych kluczy `auth.error.firstNameRequired` i `auth.error.lastNameRequired` w pl/nl/fr/en.json.
- Test (unit): `registerEmployerSchema.safeParse({companyName:'', ...})` zwraca komunikat `auth.error.companyNameRequired` dla ścieżki `companyName`. To samo dla imienia i nazwiska.

## 4. [P2] Niezgodność haseł wychodzi dopiero po poprawieniu wszystkich innych pól
- WCAG: 3.3.1. Użytkownik poprawia błędy w kilku rundach.
- Kroki: firma „A”, puste imię, e-mail „jan@”, hasło „abcdefgh”, powtórzenie „x”, wyślij (t2).
- Obecnie: pojawia się 6 błędów, ale nie ma błędu przy „Powtórz hasło”. `.refine` na obiekcie Zod nie uruchamia się, gdy inne pola nie przechodzą walidacji.
- Pliki: `src/lib/validation/auth.ts` (`registerEmployerSchema` i `registerCandidateSchema`). **Współdzielone**.
- Klucze `messages`: nie trzeba zmieniać.
- Szkic: sprawdzać zgodność w `superRefine`, który działa niezależnie od reszty pól (np. `z.object(...).passthrough()` + `superRefine`, albo osobna walidacja pary pól), albo użyć `deps` w RHF.
- Test (unit): dane z błędnym e-mailem i różnymi hasłami dają issues zarówno dla `email`, jak i dla `passwordConfirm`.

## 5. [P2] Zgoda na regulamin bez linków do regulaminu i polityki prywatności, z mylącym brzmieniem
- Kroki: `/{locale}/rejestracja-pracodawca`, pole zgody.
- Obecnie: etykieta checkboxa brzmi „Zakładając konto, akceptujesz regulamin i politykę prywatności.” (wszystkie języki). To zdanie o zgodzie domniemanej, a jednocześnie checkbox jest wymagany. Nie ma linków do `/regulamin` ani `/polityka-prywatnosci`, choć obie trasy istnieją. Ten sam tekst trafia też do `<meta name="description">` strony.
- Oczekiwane: np. „Akceptuję [regulamin] i [politykę prywatności].” z linkami. Klucz `…agreeTerms` o takim brzmieniu już istnieje w innej przestrzeni (pl.json:845).
- Pliki:
  - `src/components/auth/AuthForm.tsx` (`t.rich` z linkami, **współdzielone** z kandydatem)
  - `src/app/[locale]/(auth)/rejestracja-pracodawca/page.tsx` (opis metadata, np. `registerEmployerTitle` lub osobny klucz)
- `messages`: zmiana `auth.agreeTerms` w pl/nl/fr/en na wersję z tagami `<terms>` i `<privacy>`.
- Nie proponuję treści prawnej. Zawartość stron to #61 i decyzja właściciela.
- Test (e2e): etykieta zgody zawiera linki, których `href` kończy się na `/regulamin` i `/polityka-prywatnosci` w bieżącym locale.

## 6. [P2] Strony auth nie mają nagłówka h1 ani żadnego nagłówka
- WCAG: 1.3.1 i 2.4.6.
- Kroki: `/{locale}/rejestracja-pracodawca`. `document.querySelectorAll('h1,h2,h3')` zwraca `[]` (t1).
- Przyczyna: `CardTitle` renderuje `<div>`.
- Pliki:
  - `src/app/[locale]/(auth)/rejestracja-pracodawca/page.tsx`: `<CardTitle asChild><h1>` albo bezpośrednio `<h1 className=…>`.
  - Ten sam wzorzec w `(auth)/rejestracja/page.tsx`, `logowanie/page.tsx` i `reset-hasla/page.tsx` (**współdzielone**).
  - Ewentualnie `src/components/ui/card.tsx` (prop `as`).
- Klucze `messages`: nie trzeba zmieniać.
- Test (e2e): na każdej stronie auth `getByRole('heading', { level: 1 })` ma liczbę 1.

## 7. [P2] Obramowanie checkboxa zgody i pól ma kontrast 1,35:1
- WCAG: 1.4.11.
- Kroki: `/pl/rejestracja-pracodawca`. `--input: 0 0% 87%` (#DEDEDE) na białej karcie daje ok. 1,35:1.
- Checkbox (20×20, `border-input`) jest widoczny wyłącznie dzięki obramowaniu. Na zrzucie `reg-320-pl.png` jest ledwo widoczny i wygląda jak kółko.
- Pola błędne nie mają czerwonej ramki. Tylko pole z fokusem ma ring, a błąd sygnalizuje sam tekst (to nie narusza WCAG, ale osłabia widoczność).
- Pliki:
  - `src/app/globals.css` (token `--input`, lub osobny `--control-border` ≥3:1, np. ok. 0 0% 46%)
  - `src/components/ui/checkbox.tsx`
  - opcjonalnie `src/components/ui/input.tsx` (`aria-[invalid=true]:border-error`)
- Zakres: token globalny, więc zmiana obejmuje wszystkie formularze. Do koordynacji z agentami od innych formularzy.
- Klucze `messages`: nie trzeba zmieniać.
- Test (e2e): policz kontrast `border-color` checkboxa i inputu względem tła karty i sprawdź ≥ 3.

## 8. [P2] Brak przełącznika języka na stronach auth, a język rejestracji zapisuje się jako `preferred_locale`
- Powiązanie z Invariantem #1: język e-maili zależy od tego wyboru.
- Kroki: `/nl/rejestracja-pracodawca` przy 320 i 1280 px. Layout `(auth)` ma tylko logo. Nie ma `LocaleSwitcher` ani stopki.
- Obecnie: pracodawca, który trafił na zły język (np. z linku), może zmienić język tylko przez powrót na home. `registerEmployer` zapisuje `locale` bieżącej strony jako `preferred_locale`.
- Oczekiwane: przełącznik języka zachowuje ścieżkę (`/fr/rejestracja-pracodawca`).
- Pliki: `src/app/[locale]/(auth)/layout.tsx` (dodać istniejący `LocaleSwitcher`, **współdzielony** layout wszystkich stron auth).
- Klucze `messages`: nie trzeba zmieniać.
- Test (e2e): na `/nl/rejestracja-pracodawca` zmiana języka na FR daje URL `/fr/rejestracja-pracodawca` i `html[lang=fr]`.

## 9. [P2] Po błędzie serwera fokus spada na `<body>`
- WCAG: 2.4.3. `role="alert"` jest ogłaszany, ale użytkownik klawiatury traci pozycję.
- Kroki: poprawnie wypełniony formularz, wyślij. W demo przychodzi `INTERNAL` (t3), a `document.activeElement` to `BODY`, bo przycisk był `disabled` w trakcie wysyłki.
- Pliki: `src/components/auth/AuthForm.tsx` (alert z `tabIndex={-1}` i `alertRef.current.focus()` w efekcie obok `scrollIntoView`). **Współdzielone** z logowaniem, rejestracją kandydata i resetem.
- Klucze `messages`: nie trzeba zmieniać.
- Test (e2e): zamockuj błąd akcji (`page.route` na POST → 500 albo tryb demo) i sprawdź, że fokus jest na `[role=alert]`.

## 10. [P2] Przejście do rejestracji z logowania dla pracodawcy wymaga dwóch kroków
- Kroki: `/{locale}/logowanie`. „Nie masz konta? Zarejestruj się” prowadzi tylko do `/rejestracja` (kandydat). Dopiero stamtąd link „Rekrutujesz? Załóż konto pracodawcy”.
- Rejestracja pracodawcy linkuje poprawnie do logowania i do rejestracji kandydata.
- Pliki: `src/app/[locale]/(auth)/logowanie/page.tsx` (drugi link `auth.registerAsEmployer`, klucz już istnieje). Strona **współdzielona**, do uzgodnienia z agentem kandydata.
- Klucze `messages`: nie trzeba zmieniać.
- Test (e2e): na `/pl/logowanie` jest link z `href` `/pl/rejestracja-pracodawca`.

---

Luka w testach: nie ma testu e2e ani unit dla `/rejestracja-pracodawca` ani `registerEmployerSchema`. `tests/e2e/a11y.spec.ts` obejmuje `/pl/rejestracja`, ale nie wersję pracodawcy. Proponuję dodać tę trasę do `PAGES` w a11y.spec oraz test pustego wysłania: fokus na `#companyName`, liczba `[aria-invalid=true]` = 7, każdy `aria-describedby` wskazuje istniejący element.
