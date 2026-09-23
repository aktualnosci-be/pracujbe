# Audyt: poradniki i pozostałe treści publiczne

Zakres: `/{pl,nl,fr,en}/poradniki`, `/poradniki/[slug]` (6 slugów + nieistniejący), `/o-nas`, `/faq`, `/kontakt`, `/pomoc`, `/regulamin`, `/polityka-prywatnosci`, `/polityka-cookies`.
Serwer: http://localhost:3100 (tryb demo, `main` @ f11170e). Skrypty: `audit/content/{a..h}.js`, zrzuty `audit/content/*.png`.

## Co działa (sprawdzone, bez ustaleń)
- axe (wcag2a/aa/21aa/22aa): **0 naruszeń** na wszystkich 10 trasach × 4 języki × 320/1280 px.
- `lang` zgodny z locale. Jest jeden `<main>` i jeden `H1`. Hierarchia H1→H2 poprawna, bez przeskoków.
- Przełącznik języka zachowuje slug poradnika i ścieżkę stron prawnych; `lang`, H1, `<title>` i description zmieniają się poprawnie (PL→NL→FR).
- 320 px przy 100%: brak poziomego przewijania na wszystkich trasach i we wszystkich językach.
- Fokus klawiatury jest widoczny: outline 2px na linkach, a karta poradnika ma dodatkowo pierścień `focus-within`. Kolejność Tab jest logiczna: skip link → header → breadcrumb → karty → footer.
- Strony prawne i informacyjne mają `noindex, nofollow`, poradniki są indeksowalne, a nieistniejący slug zwraca 404 i `noindex`.
- **FAQ nie ma accordionu.** Strona zawiera tylko wspólny placeholder, więc nie było czego sprawdzać pod kątem `aria-expanded` i obsługi klawiaturą. Trzeba to zrobić, gdy pojawi się treść (#61).
- Cele dotykowe w breadcrumbie (np. 95×17 px) i link „Wróć do poradników” (160×20 px) mają mniej niż 24 px wysokości, ale mieszczą się w wyjątku odstępów z 2.5.8. Nie zgłaszam ich.

---

## 1. [P1] Baner cookies całkowicie zasłania sfokusowane linki stopki (WCAG 2.4.11 Focus Not Obscured, AA)
**Kroki:** otwórz `/pl/regulamin` bez zapisanej zgody, przy 1280×800 i 320×800, i przechodź Tabem do stopki (skrypt `content/h.js`).
**Wynik obecny:** zasłonięte w 100% wysokości są przy 320 px: Oferty pracy, Dodaj ofertę, O nas, Pytania i odpowiedzi, Regulamin, Polityka prywatności, Polityka cookie, „Ustawienia cookie” (20/20 px) i przełącznik języka „Polski” (36/36 px). Przy 1280 px zasłonięte są „Ustawienia cookie” i „Polski”. Strony prawne są krótkie, więc stopka zawsze leży pod stałym banerem i nie da się jej przewinąć ponad niego. W teście Playwright klik w przełącznik języka dostał timeout, bo zdarzenia przechwytywał baner (`e.js`, pierwsza wersja).
**Oczekiwany:** element z fokusem jest przynajmniej częściowo widoczny, a stopka (także link „Polityka cookie”) jest osiągalna przy otwartym banerze.
**Zakres:** wszystkie strony publiczne, 4 języki. Najdotkliwsze na krótkich stronach z mojego zakresu. Komponent jest wspólny, więc warto to skoordynować z sesją cookies, jeśli taka istnieje.
**Pliki:** `src/components/cookies/CookieConsent.tsx` (baner `fixed inset-x-0 bottom-0`, linia ~147); ewentualnie `src/app/globals.css`.
**Messages:** bez zmian.
**Szkic poprawki:** gdy baner jest widoczny, ustaw na `<html>` `scroll-padding-bottom` oraz `padding-bottom` na body/wrapperze równe wysokości banera (ResizeObserver → zmienna CSS `--cookie-banner-h`). Po zamknięciu banera usuń oba ustawienia.
**Test regresyjny:** e2e bez zgody na `/pl/regulamin` przy 320 i 1280 px. Tab do każdego linku w `footer`, a dla każdego sprawdź, że `activeElement.getBoundingClientRect()` nie leży w całości w prostokącie `[aria-labelledby=cookie-banner-title]`. Dodatkowo: klik w przełącznik języka działa bez wcześniejszego zamykania banera.

## 2. [P2] Karty poradników wychodzą poza ekran przy powiększeniu tekstu 200% (długie słowa NL/PL) (WCAG 1.4.4 / 1.4.10)
**Kroki:** viewport 640×900, `document.documentElement.style.fontSize='200%'`, `/nl/poradniki` i `/pl/poradniki` (skrypt `content/b.js`, zrzut `content/nl-card-640-200.png`).
**Wynik obecny:**
- `/nl/poradniki`: `scrollWidth=717` przy `clientWidth=640`. Tytuł karty „Rijksregisternummer (NISS)…” (prawa krawędź 717 px) i zajawka („identificatienummer”) wystają poza kartę.
- `/pl/poradniki`: 645/640 („Bezpieczeństwo na budowie…”).
- Na stronie artykułu PL sekcja „Więcej poradników” daje 648/640.
**Oczekiwany:** słowa zawijają się lub dzielą; brak poziomego przewijania dokumentu.
**Zakres:** lista `/poradniki` i sekcja „Więcej poradników” na artykule; najbardziej NL, potem PL. Przy 320 px i 200% tekstu też są overflowy w kartach (PL/NL), ale całą stronę (453 px) rozpycha tam wspólny header (logo `.be` i ikony, poza zakresem, patrz „Uwagi poboczne”).
**Pliki:** `src/components/public/GuideCard.tsx` (h2 z linkiem i `<p>` zajawki). Profilaktycznie `src/components/public/GuideContent.tsx` (h2/p/li) i h1 w `src/app/[locale]/(public)/poradniki/[slug]/page.tsx`.
**Messages:** bez zmian.
**Szkic poprawki:** dodaj `break-words hyphens-auto` (`overflow-wrap:anywhere` dla bardzo długich złożeń) do tytułu i zajawki karty oraz do nagłówków i akapitów artykułu. `lang` na `<html>` jest już ustawiony, więc przeglądarka podzieli słowa zgodnie z językiem.
**Test regresyjny:** e2e dla 4 języków przy 640 px i font-size 200% na `/poradniki` i `/poradniki/numer-niss-i-podatki`: `documentElement.scrollWidth <= clientWidth` oraz żaden `article` w `main` nie ma `scrollWidth > clientWidth`. Najlepiej dopisać te trasy do istniejącego `tests/e2e/public-zoom.spec.ts`.

## 3. [P2] 404 dla nieistniejącego poradnika: brak nawigacji, tytuł strony głównej, niejasny link „Wstecz” (WCAG 2.4.2, 2.4.4)
**Kroki:** otwórz `/fr/poradniki/xyz` (i analogicznie w PL/NL/EN), przy 1280 lub 320 px (zrzut `content/404-fr.png`).
**Wynik obecny:**
- Status 404 i `noindex` są poprawne.
- Nie renderują się header, footer ani przełącznik języka, bo `src/app/[locale]/not-found.tsx` leży poza `(public)/layout`. Komentarz w pliku błędnie twierdzi, że dziedziczy Header/Footer.
- `<title>` to tytuł strony głównej („Pracuj.be — Praca w Belgii bez CV”), więc nie mówi o błędzie.
- Jedyny link ma etykietę `common.back` („Wstecz” / „Retour”), a prowadzi na `/{locale}`, czyli na stronę główną, nie wstecz.
- Nie ma linku do listy poradników.
**Oczekiwany:** 404 w chrome strony publicznej, tytuł informujący o braku strony, link z etykietą zgodną z celem (strona główna) oraz link do `/poradniki`.
**Zakres:** każdy `notFound()` w `(public)`: poradniki, a prawdopodobnie też oferty, kategorie i miasta (inne sesje mogą to potwierdzić). 4 języki.
**Pliki:** nowy `src/app/[locale]/(public)/not-found.tsx` (renderuje się wewnątrz `(public)/layout`) albo `src/app/[locale]/(public)/poradniki/[slug]/not-found.tsx` z linkiem do listy; korekta `src/app/[locale]/not-found.tsx` (etykieta, metadata `title`, komentarz).
**Messages:** potrzebne nowe klucze we wszystkich 4 plikach `src/messages/*.json`, np. `errors.notFoundTitle` (tytuł dokumentu) i `guides.notFoundCta` („Zobacz wszystkie poradniki”); dla linku do strony głównej wystarczy istniejący `common.home`.
**Test regresyjny:** e2e na `/{locale}/poradniki/nie-istnieje` w 4 językach: status 404, widoczny `banner` i `contentinfo`, `title` różny od tytułu strony głównej, link o nazwie `common.home` z `href=/{locale}` i link do `/{locale}/poradniki`.

## 4. [P2] Placeholdery stron prawnych i informacyjnych nie komunikują jasno stanu: zapowiedź „Poniżej…” bez treści i data „Ostatnia aktualizacja”
**Kroki:** otwórz `/nl/regulamin` (tak samo `/o-nas`, `/faq`, `/kontakt`, `/pomoc` i obie polityki) we wszystkich 4 językach.
**Wynik obecny:** siedem różnych stron ma identyczną treść: H1, potem „Hieronder vind je de belangrijkste informatie. Deze sectie is in voorbereiding.” / „Poniżej znajdziesz najważniejsze informacje…”, potem „Treść … w przygotowaniu”, na końcu „Ostatnia aktualizacja: 23 lipca 2026”.
- Pierwsze zdanie zapowiada treść, której pod nim nie ma.
- Data aktualizacji sugeruje istniejący, datowany dokument. To mylące szczególnie przy regulaminie i polityce prywatności.
- Informacja o przygotowaniu jest zwykłym szarym akapitem (`text-muted-foreground`), a nie wyróżnionym komunikatem o stanie.
- Ten sam tekst trafia też do meta description.
**Oczekiwany:** jednoznaczny stan „w przygotowaniu” bez sugerowania istnienia treści ani daty wersji. **Nie proponuję żadnej treści prawnej ani kontaktowej (#61)**; zmienia się tylko prezentacja stanu.
**Zakres:** 7 tras × 4 języki.
**Pliki:** `src/app/[locale]/(public)/_legal/legal-page.tsx` (ukryć `lastUpdated` w stanie placeholder, np. flagą; komunikat jako wyróżniony blok `role="note"`), `src/messages/{pl,nl,fr,en}.json` (namespace `legal`).
**Messages:** zmiana brzmienia `legal.intro` (usunąć „Poniżej znajdziesz…”) albo nowy klucz, np. `legal.placeholderNotice`. Brzmienie zatwierdza właściciel (#61). `legal.lastUpdated` zostaje na czas po publikacji treści.
**Test regresyjny:** test komponentu lub e2e: w trybie placeholder strona prawna nie zawiera elementu z datą aktualizacji i zawiera widoczny komunikat `role=note` z `legal.placeholderNotice`.

## 5. [P2] „Polityka cookie” (cel linku z banera) nie daje sposobu na zmianę zgód
**Kroki:** na dowolnej stronie bez zgody kliknij w banerze „Więcej informacji o cookies”, co prowadzi do `/pl/polityka-cookies`.
**Wynik obecny:** użytkownik trafia na placeholder (patrz 4) bez przycisku ustawień. „Ustawienia cookie” są tylko w stopce, a przy otwartym banerze stopka jest pod nim zasłonięta (patrz 1).
**Oczekiwany:** strona polityki cookies pokazuje przycisk otwierający centrum ustawień zgód, bo ta funkcja już istnieje. Nie wymaga to nowej treści prawnej.
**Pliki:** `src/app/[locale]/(public)/polityka-cookies/page.tsx` (osadzić `src/components/cookies/CookieSettingsButton.tsx`, np. przez prop lub slot w `LegalPage` w `_legal/legal-page.tsx`).
**Messages:** bez zmian; przycisk ma już własną etykietę.
**Test regresyjny:** e2e na `/{locale}/polityka-cookies`: w `main` jest przycisk ustawień cookies, który otwiera dialog centrum zgód.

## 6. [P2] Czas czytania i zakres treści NL/FR/EN wprowadzają w błąd (tłumaczenia skrócone o około 2/3)
**Kroki:** otwórz `/{pl,nl,fr,en}/poradniki/praca-w-belgii-bez-znajomosci-jezyka` (skrypt `content/g.js`).
**Wynik obecny:**

| poradnik | PL | NL | FR | EN |
|---|---|---|---|---|
| praca-w-belgii-bez-znajomosci-jezyka | 311 słów, 3×H2 | 107 słów, 1×H2 | 115 słów, 1×H2 | 110 słów, 1×H2 |
| umowa-interim-co-warto-wiedziec | 258, 3×H2 | 103, 1×H2 | 115, 1×H2 | 115, 1×H2 |
| numer-niss-i-podatki | 245, 3×H2 | 94, 1×H2 | 110, 1×H2 | 101, 1×H2 |

Mimo to wszystkie języki pokazują ten sam czas, np. „6 min leestijd” przy około 107 słowach. Czytelnik nie dostaje informacji, że wersja językowa jest skrócona; w kodzie jest to opisane świadomie (`guides.ts`, nagłówek pliku).
**Oczekiwany:** czas czytania odpowiada treści w danym języku. Informację o skróconej wersji (z linkiem do pełnej PL) warto rozważyć jako decyzję właściciela; nie proponuję tu nowej treści.
**Pliki:** `src/lib/guides/guides.ts` (`readingMinutes` liczony z `body` danej translacji albo przeniesiony do `GuideTranslation`), `src/components/public/GuideCard.tsx`, `src/app/[locale]/(public)/poradniki/[slug]/page.tsx`.
**Messages:** bez zmian dla samego czasu. Jeśli powstanie adnotacja o skróconej wersji, potrzebny nowy klucz `guides.shortTranslationNote` w 4 plikach.
**Test regresyjny:** unit dla `getGuideBySlug(slug, locale)`: `readingMinutes` rośnie monotonicznie z liczbą słów treści w danym języku; dla obecnych danych NL musi dać mniej minut niż PL.

## 7. [P2] Poradniki i Pomoc są nieosiągalne z nawigacji publicznej
**Kroki:** na `/pl` i `/pl/oferty-pracy` przejrzyj linki w header i footer (`Footer.tsx` linie 18–29, 72–83).
**Wynik obecny:** `/poradniki` jest indeksowalną sekcją z 6 artykułami, ale z publicznego chrome nie prowadzi do niej żaden link. Jedyne wejścia to sitemap i link w onboardingu kandydata (`OnboardingWizard.tsx:468`). `Header.tsx:23` ma komentarz, że poradniki „dojdą wraz z implementacją”, a są już zaimplementowane. `/pomoc` jest linkowana tylko z paneli (`DashboardShell.tsx`), nie ze stopki.
**Oczekiwany:** link „Poradniki” w stopce (sekcja kandydata), opcjonalnie w headerze lub menu mobilnym. Dodanie Pomocy do stopki zależy od #61 (dziś to placeholder).
**Pliki:** `src/components/layout/Footer.tsx`; opcjonalnie `src/components/layout/Header.tsx` i `src/components/layout/MobileNav.tsx`.
**Messages:** można użyć istniejącego `guides.pageTitle` albo dodać `footer.guides` w 4 plikach (zgodnie z konwencją pozostałych linków stopki).
**Test regresyjny:** e2e: w `contentinfo` na `/{locale}` istnieje link do `/{locale}/poradniki` z nazwą z i18n, a po kliknięciu H1 to `guides.pageTitle`.

## 8. [P2] Breadcrumb poradników bez `aria-current="page"`
**Kroki:** otwórz `/pl/poradniki` i `/pl/poradniki/umowa-interim-co-warto-wiedziec`.
**Wynik obecny:** na stronie jest 0 elementów `[aria-current]`, a bieżąca pozycja jest tylko wizualnie ciemniejsza. Przy 320 px tytuł w breadcrumbie jest ucięty wielokropkiem (np. 288/418 px w FR). Nie ma utraty informacji, bo pełny tytuł jest w H1.
**Oczekiwany:** ostatni `<li>` oznaczony `aria-current="page"`.
**Pliki:** `src/app/[locale]/(public)/poradniki/page.tsx`, `src/app/[locale]/(public)/poradniki/[slug]/page.tsx`. Jeśli breadcrumb powtarza się w innych trasach, lepszy byłby wspólny komponent.
**Messages:** bez zmian.
**Test regresyjny:** e2e: `nav[aria-label=breadcrumb] [aria-current=page]` istnieje i ma tekst równy H1.

---

## Uwagi poboczne (poza moim zakresem, do przekazania)
- **Wspólny header przy 320 px i tekście 200%:** strona ma szerokość 453 px na każdej trasie. Wystają kafelek logo `.be` (prawa krawędź 341 px) i ikony SVG (416–420 px). Plik: `src/components/layout/Header.tsx` / `src/components/brand/Logo.tsx`. Przy 640 px i 200% (reflow) header jest w porządku.
- **#118 potwierdzam:** `/poradniki` ma podwójny sufiks w tytule: „Poradniki — praca w Belgii | Pracuj.be · Pracuj.be” (4 języki; `guides.metaTitle` plus szablon tytułu).
- Canonical i hreflang wskazują na `http://localhost:3000`, bo `env.siteUrl` ma lokalny fallback. To konfiguracja środowiska, nie błąd kodu.
