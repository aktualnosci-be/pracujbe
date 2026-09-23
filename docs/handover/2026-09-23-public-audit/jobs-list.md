# Audyt: lista ofert i filtry (`/{locale}/oferty-pracy`)

Środowisko: `http://localhost:3100` (next start, tryb demo, 26 ofert demo), `main` @ f11170e, Chromium z Playwright.
Skrypty odtworzeniowe: `audit/jobs-list-scripts/*.js` (każdy uruchamiany `node <plik>`). We wszystkich skryptach baner cookies zamykany pierwszym przyciskiem.

## Co działa (sprawdzone, bez ustaleń)
- Złe parametry obsłużone bez błędu 500: `?page=-1|abc|2.5|1e3`, `?sort=xxx`, `?salaryMin=abc`, `salaryMin>salaryMax`, `?category=bogus` → 200 i rozsądny fallback (`params.js`). Wyjątek: `page` > liczba stron (ustalenie 7).
- Dialog filtrów (mobile, Radix): `role=dialog`, nazwa z tytułu „Filtry”, pułapka fokusu działa (Tab zawija w dialogu), Escape zamyka, fokus wraca na wyzwalacz, przycisk zamknięcia ma nazwę i 48×48, wiersze checkboxów mają etykiety 48 px wysokości, suwaki mają `aria-label`, brak poziomego przewijania w dialogu przy 320 px (`dialog.js`).
- axe (WCAG 2.0/2.1/2.2 A/AA) bez naruszeń: PL/NL, 1280 i 320 px, lista pełna, pusta i z filtrami (`misc.js`).
- 320 px: brak poziomego przewijania dla typowych danych w PL/NL/FR/EN (`mobile.js`). Wyjątek: ustalenie 8.
- Tekst 200% przy 640 px: brak przewijania poziomego ani obciętej treści (`misc.js`).
- Przełącznik języka zachowuje ścieżkę i query, ustawia `lang`; brak surowych kluczy i18n w 4 językach (`lang.js`, curl).
- Stan błędu liczników ma `role=alert` i przycisk ponowienia.

---

## 1. [P1] Desktop: dolne filtry i przycisk „Pokaż N ofert” są niedostępne, dopóki nie przewiniesz całej listy wyników
- **Kroki:** 1280×800 (także 1280×1024), `/pl/oferty-pracy`. Zaznacz kategorię i spróbuj zatwierdzić. `sticky.js`, `sticky2.js`.
- **Wynik obecny:** sidebar ma 1911 px wysokości i jest `sticky top-24` bez własnego przewijania. Przy przewijaniu przez 0–3200 px widać tylko sekcje „Kategoria” i „Lokalizacja”. „Wynagrodzenie”, „Rodzaj umowy” i „Zakwaterowanie” pojawiają się dopiero przy ~4000 px, a „Data dodania” i przycisk „Pokaż 26 ofert” przy ~4400 px z 4896 px, czyli za wszystkimi 12 kartami, tuż nad stopką. Zmiany są oczekujące i nic się nie dzieje, dopóki użytkownik nie kliknie „Pokaż”, więc wygląda to tak, jakby filtr nie działał.
- **Oczekiwany:** wszystkie pola i przycisk zatwierdzenia są osiągalne bez przewijania całej listy wyników.
- **Zakres:** desktop ≥ lg (1024 px+), wszystkie języki.
- **Pliki:** `src/app/[locale]/(public)/oferty-pracy/page.tsx` (`<aside>` → `div.sticky top-24`), `src/components/public/FilterSidebar.tsx` (układ: przewijany obszar pól + stopka z przyciskiem).
- **messages:** nie.
- **Szkic poprawki:** kontener sticky z `max-h-[calc(100dvh-7rem)] flex flex-col`, pola w `overflow-y-auto`, przycisk „Pokaż N ofert” (i alert błędu licznika) w nieprzewijanej stopce, tak jak w `FilterSheet`. Alternatywa: zrezygnować ze sticky.
- **Test regresyjny (Playwright):** viewport 1280×800, przewiń stronę do połowy listy wyników i sprawdź, że przycisk zatwierdzenia sidebara jest w viewporcie (`toBeInViewport`) oraz że da się przewinąć sidebar do sekcji „Data dodania”.

## 2. [P1] Awaria lub wolna odpowiedź `/api/job-filter-facets` całkowicie blokuje zatwierdzanie filtrów
- **Kroki:** 1280×800, `/pl/oferty-pracy`. W Playwright `route('**/api/job-filter-facets**')` → 500 (lub opóźnienie 8 s). Zaznacz „Budownictwo”. `facetfail.js`.
- **Wynik obecny:** przycisk zmienia się na „Liczba ofert niedostępna” i zostaje `disabled`. „Policz ponownie” przy trwałej awarii nie pomaga, przycisk nadal jest `disabled`. Przy wolnym API widać „Liczymy oferty…” i też `disabled`. Filtrowanie jest niemożliwe, chociaż sama lista (SSR) działałaby. Ten sam kod jest w mobilnym `FilterSheet`.
- **Oczekiwany:** licznik jest tylko podpowiedzią. Zatwierdzenie zawsze działa, a przy błędzie lub ładowaniu przycisk pokazuje etykietę bez liczby.
- **Zakres:** desktop i mobile, wszystkie języki.
- **Pliki:** `src/components/public/FilterSidebar.tsx` (`disabled={liveFacets.status !== 'idle'}`), `src/components/public/FilterSheet.tsx` (to samo).
- **messages:** tak. Nowy klucz np. `filters.showResultsNoCount` („Pokaż oferty” / „Toon vacatures” / „Afficher les offres” / „Show jobs”) we wszystkich 4 plikach. `countLoading` i `countUnavailable` mogą zostać jako tekst pomocniczy.
- **Szkic:** nie blokować przycisku. Przy `status !== 'idle'` wyświetlać `showResultsNoCount` i obok status (`aria-live`).
- **Test:** Playwright z mockiem 500 dla facets: zaznacz checkbox, kliknij zatwierdź i sprawdź, że URL zawiera `category=`.

## 3. [P1] WCAG 2.4.11 (AA) — fokus całkowicie zasłonięty przez sticky nagłówek przy Shift+Tab
- **Kroki:** `/pl/oferty-pracy?category=construction,transport,warehouse,production`, przewiń na dół, ustaw fokus w stopce i cofaj Shift+Tab. `obscure.js`.
- **Wynik obecny (1280×800):** tytuły ofert („Operator CNC – Kortrijk”, „Magazynier – Antwerpia” itd., 29 px wysokości) mają fokus przy `top=0–10`, a nagłówek sięga do 65 px, więc są zakryte w 100%. Przy 320×640 zakryte jest też podsumowanie sortowania („Sortuj: Najnowsze”, 38 px w całości).
- **Oczekiwany:** element z fokusem nie jest w całości zasłonięty przez treść autora.
- **Zakres:** wszystkie strony z sticky `Header`, wszystkie języki. Poprawka jest globalna i może pokrywać się z ustaleniami innych sesji.
- **Pliki:** `src/app/globals.css` (`html { scroll-padding-top: … }` równe wysokości nagłówka + margines, np. `5rem`).
- **messages:** nie.
- **Test:** Playwright: przewiń na dół, zrób Shift+Tab do linku oferty i sprawdź `rect.top >= header.getBoundingClientRect().bottom`.

## 4. [P2] Brak stanu ładowania po zatwierdzeniu filtrów, sortowania i paginacji (4.1.3)
- **Kroki:** 1280×800, `/pl/oferty-pracy`. Opóźnij odpowiedź RSC dla `oferty-pracy?` o 4 s (route w Playwright, nagłówek `rsc`), zaznacz „Transport”, kliknij „Pokaż 2 ofert”. Skrypt `slownav.js`.
- **Wynik obecny:** 1,2 s po kliknięciu URL się nie zmienił, przycisk nadal jest aktywny, nie ma `aria-busy`, zostają stare wyniki i stary licznik („Znaleziono 26 ofert”). Brak `loading.tsx` dla `oferty-pracy`. Użytkownik na wolnym łączu nie wie, że coś się dzieje, i może klikać wielokrotnie (invariant 11: blokada podczas zapisu i brak podwójnego kliknięcia).
- **Oczekiwany:** widoczny i ogłaszany stan „Ładowanie wyników…”, przycisk zablokowany na czas nawigacji, wyniki oznaczone `aria-busy`.
- **Pliki:** `src/components/public/FilterSidebar.tsx`, `src/components/public/FilterSheet.tsx` (`useTransition` wokół `router.push`, `isPending` → disabled/aria-busy), opcjonalnie nowy `src/app/[locale]/(public)/oferty-pracy/loading.tsx` (szkielet listy; linki sortowania i paginacji to zwykłe `<Link>`).
- **messages:** możliwe użycie istniejącego klucza ładowania lub nowego `jobs.loadingResults` w 4 plikach.
- **Test:** Playwright z opóźnioną odpowiedzią RSC: po kliknięciu zatwierdzenia przycisk jest `disabled` / `aria-busy=true` przed zmianą URL.

## 5. [P2] Mobile: po „Pokaż N ofert” fokus trafia na `<body>` (2.4.3), wyniki nie mają nagłówka
- **Kroki:** 320×640, `/pl/oferty-pracy`. Otwórz „Filtry” klawiaturą, Spacja na „Budownictwo”, Enter na „Pokaż 4 ofert”. `focusafter.js`.
- **Wynik obecny:** po nawigacji `document.activeElement` to `BODY`, a kolejny Tab trafia na „Przejdź do treści”. Użytkownik klawiatury lub czytnika ekranu wraca na początek strony. Struktura nagłówków: H1, potem od razu H3 kart ofert, bez H2 „Wyniki” (1.3.1, nie ma do czego skoczyć). Dodatkowo przy otwarciu dialogu fokus trafia na „Wyczyść wszystko”, akcję kasującą oczekujący wybór, zamiast na tytuł lub zamknięcie.
- **Oczekiwany:** po zatwierdzeniu fokus na nagłówku lub liczniku wyników (`tabIndex=-1`), a po otwarciu dialogu na pierwszym polu albo na przycisku zamknięcia.
- **Pliki:** `src/components/public/FilterSheet.tsx` (`onCloseAutoFocus` → `preventDefault` + fokus na `#results-heading` po nawigacji; `onOpenAutoFocus`), `src/app/[locale]/(public)/oferty-pracy/page.tsx` (H2 wyników z `id`, np. wizualnie ukryty lub połączony z licznikiem).
- **messages:** tak, jeśli H2 ma własny tekst, np. `jobs.resultsHeading` w 4 plikach. Można też użyć istniejącego `jobs.resultsCount` jako treści H2.
- **Test:** Playwright 320 px: zatwierdź filtry klawiaturą i sprawdź, że `activeElement` jest nagłówkiem lub licznikiem wyników, a nie `BODY`.

## 6. [P2] „Pokaż {count} ofert” bez odmiany liczby we wszystkich 4 językach
- **Kroki:** `/pl/oferty-pracy`, zaznacz „Budownictwo” → przycisk „Pokaż 4 ofert” (`dialog.js`), z `keyword=magazyn` → „Pokaż 2 ofert” (`desktop.js`). Tak samo wyjdzie „Show 1 jobs”, „Toon 1 vacatures”, „Afficher 1 offres”.
- **Pliki:** `src/messages/pl.json`, `nl.json`, `fr.json`, `en.json` — klucz `filters.showResults` (obecnie bez ICU plural). `jobs.resultsCount` ma już poprawny wzorzec do skopiowania. Kod bez zmian (`FilterSidebar.tsx`, `FilterSheet.tsx` przekazują `count`).
- **Szkic:** PL `{count, plural, =0 {Brak ofert} one {Pokaż # ofertę} few {Pokaż # oferty} many {Pokaż # ofert} other {Pokaż # oferty}}`, analogicznie NL/FR/EN.
- **Test:** unit (Vitest) z `IntlMessageFormat` / next-intl: dla PL 1/2/5/22 i EN 1/2 sprawdzić oczekiwane formy, żeby test pilnował treści, a nie implementacji.

## 7. [P2] Pusty wynik bez działającej drogi wyjścia; `page` poza zakresem pokazuje sprzeczny stan
- **Kroki A:** `/pl/oferty-pracy?keyword=zzzzqqq` (`params.js`, `misc.js`). Stan pusty „Nie znaleźliśmy ofert… Spróbuj zmienić filtry.” nie ma żadnego linku ani przycisku (0 elementów). Link „Wyczyść filtry” obok chipów ma href `/pl/oferty-pracy?keyword=zzzzqqq`, czyli ten sam adres, więc nic nie robi, bo celowo zachowuje keyword i city.
- **Kroki B:** `/pl/oferty-pracy?page=999`. Licznik „Znaleziono 26 ofert”, 0 kart, komunikat „Nie znaleźliśmy ofert spełniających kryteria. Spróbuj zmienić filtry.”, a paginacja oznacza `aria-current="page"` na stronie 3. Trzy komunikaty są sprzeczne i nie ma filtrów do zmiany.
- **Oczekiwany:** w stanie pustym link „Wyczyść wszystkie filtry i wyszukiwanie” (do `/oferty-pracy`, z zachowaniem tylko sortowania) oraz ewentualnie „Usuń słowo kluczowe”. Przy `page` > liczba stron: przekierowanie (`redirect`) na ostatnią stronę albo osobny komunikat „Ta strona nie istnieje” z linkiem do strony 1.
- **Pliki:** `src/app/[locale]/(public)/oferty-pracy/page.tsx` (`clearFiltersHref`, blok stanu pustego, walidacja `page` względem `total`), `src/components/public/Pagination.tsx` (nie oznaczać `aria-current` dla strony innej niż żądana).
- **messages:** tak, np. `jobs.emptyReset` („Wyczyść wyszukiwanie i filtry”), `jobs.pageOutOfRange` w 4 plikach (jeśli bez redirectu).
- **Test:** Playwright: `?keyword=zzzzqqq` → kliknięcie akcji w stanie pustym prowadzi do listy z liczbą wyników > 0. `?page=999` → URL/strona z kartami albo komunikat out-of-range, bez tekstu „zmień filtry”.

## 8. [P2] Długie słowo w chipie filtra (keyword/location) powoduje poziome przewijanie przy 320 px (1.4.10)
- **Kroki:** 320×640, `/nl/oferty-pracy?keyword=vrachtwagenchauffeursopleidingscentrum` → `scrollWidth` 338 > 320. URL jako keyword → 327. Przy 120 znakach → 1001 (`chip.js`, `mobile.js`). Słowa z odstępami się zawijają. Problem dotyczy niderlandzkich i niemieckich złożeń oraz wklejonych adresów.
- **Pliki:** `src/app/[locale]/(public)/oferty-pracy/page.tsx` (chip `Link`: `max-w-full min-w-0`, `span`: `[overflow-wrap:anywhere]` lub `truncate` + pełna treść w `aria-label`, który już istnieje).
- **messages:** nie.
- **Test:** Playwright 320 px z keyword o długości 40 znaków bez spacji: `document.documentElement.scrollWidth <= clientWidth`.

## 9. [P2] Menu sortowania (`<details>`): Escape i kliknięcie poza nie zamykają, brak `aria-current`; małe cele na mobile
- **Kroki:** 1280×800, `/pl/oferty-pracy?sort=salary`, fokus na „Sortuj: …”, Enter otwiera, Escape nie zamyka, kliknięcie poza menu też nie (`sort.js`). Aktywna opcja różni się tylko kolorem i grubością (`font-weight 500`, czerwony), nie ma `aria-current`.
- **Cele dotykowe 320 px (`mobile.js`):** podsumowanie sortowania 288×38, opcje sortowania 230×36, chipy „Usuń filtr: …” wysokości 30 px, link „Wyczyść filtry” 96×20. WCAG 2.5.8 formalnie spełnione (wyjątek odstępu), ale poniżej przyjętych w repo 44–48 px na mobile. Pozostałe kontrolki listy i dialogu mają 48 px.
- **Pliki:** `src/app/[locale]/(public)/oferty-pracy/page.tsx` (`sortMenu`, chipy, link „Wyczyść filtry”). Opcja: zamienić na Radix DropdownMenu lub dodać mały komponent kliencki zamykający na Escape/klik poza; `aria-current="true"` na wybranej opcji; `min-h-11` na mobile.
- **messages:** nie.
- **Test:** Playwright: otwórz sortowanie, Escape → `details.open === false`; wybrana opcja ma `aria-current`; przy 320 px wysokość chipów i sortowania ≥ 44.

## 10. Potwierdzam #189 — dodatkowy przypadek na liście: zmiana języka z filtrem lokalizacji zeruje wyniki
- **Kroki:** 1280×800, `/pl/oferty-pracy?location=Bruksela&category=construction&sort=salary` → „Znaleziono 1 ofertę”. Przełącznik w stopce → Nederlands → `/nl/oferty-pracy?location=Bruksela&…` → „Geen vacatures gevonden”, chip „Bruksela”, a lista miast w sidebarze ma teraz obok siebie „Bruksela” (0) i „Brussel” (`lang.js`).
- Ta sama przyczyna co #189 (parametr `location` przenosi przetłumaczoną nazwę). Proponuję dopisać do kryteriów akceptacji #189: „zmiana języka na `/oferty-pracy?location=…` nie zmienia zbioru ofert”. Pliki jak w #189 oraz `src/components/public/job-filters.ts` (`parseSidebarFilters` → `locations`) i `src/components/layout/LocaleSwitcher.tsx` (przenosi query 1:1).

---

## Uwagi drobne (niezgłaszane osobno)
- `?q=` jest ignorowany, bo parametr nazywa się `keyword`. Żaden link w repo nie używa `q`, więc to nie jest błąd.
- Paginowane strony (`?page=2`) mają canonical na stronę 1 i taki sam `<title>`. Możliwe powiązanie z #118 (tytuły SEO) i do decyzji SEO, nie odtwarzałem skutków w wyszukiwarce.
- Na desktopie sidebar to ok. 24 tabulacje przed pierwszym wynikiem (source order). Po poprawce 1 warto rozważyć link „Przejdź do wyników”.
