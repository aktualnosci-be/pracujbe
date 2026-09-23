# Audyt przekrojowy dostępności — publiczna część Pracuj.be

Data: 2026-09-23 · `main` @ f11170e · serwer `http://localhost:3100` (next start, tryb demo)
Skrypty i surowe wyniki: `audit/a11y/` (`axe.js`→`axe.json`, `prog.js`→`prog.json`, `obsc.js`, `obsc-fix.js`, `bn.js`, `ov*.js`, `hd.js`, `s404.js`, zrzuty `banner-320.png`, `banner-640-200.png`, `hdr-*.png`).

## Zakres wykonany

- **axe-core** (osobno: `wcag2a+wcag2aa+wcag21a+wcag21aa+wcag22aa` z `target-size` oraz `best-practice`): 21 tras × 4 języki × {1280, 320 px} × {baner widoczny, baner zamknięty} = **336 przebiegów**, 0 błędów nawigacji. Trasy: home, oferty-pracy, `/oferty-pracy/warehouse-worker-antwerp-1001`, praca, `/praca/kategoria/construction`, `/praca/miasto/antwerp`, poradniki, `/poradniki/numer-niss-i-podatki`, o-nas, faq, kontakt, pomoc, regulamin, polityka-prywatnosci, polityka-cookies, logowanie, rejestracja, rejestracja-pracodawca, reset-hasla, offline, 404 (`/nie-istnieje-xyz`) + dodatkowo 404 ze slugiem (`/oferty-pracy/nope-999`, `/poradniki/nope`, `/praca/kategoria/nope`).
- **Sprawdzenia programowe** (88 stron): `lang`, duplikaty `id`, overflow przy 320 px, overflow przy 640 px + `font-size:200%` (a dodatkowo przy 768/1024/1280 + 200%), cele < 24×24 px przy 320 px (z wyjątkami inline/spacing), Tab do 70–150 kroków na stronę przy 320 i 1280 px: zmiana stylu fokusu (fokus vs blur), obcięcie przez przodka z `overflow`, zasłonięcie (siatka 9 punktów `elementFromPoint`), pozycja banera w kolejności fokusu.

### Co jest w porządku (sprawdzone, bez ustaleń)
- `lang` zgodny z prefiksem na wszystkich 80 zlokalizowanych stronach (wyjątek: nieznany URL — ustalenie 4). Brak zduplikowanych `id`.
- Brak poziomego przewijania przy 320 px na wszystkich trasach i językach.
- axe: 0 × `color-contrast`, 0 × `target-size`, 0 × nazwy dostępne / etykiety formularzy na trasach publicznych.
- Każdy element osiągany Tabem zmienia styl po fokusie (ring/outline/underline) — brak „niewidocznego fokusu”; brak obcięcia pierścienia przez `overflow`; brak pułapek fokusu.
- Cele poniżej 24 px (linki stopki 17 px wys., okruszki, linki „Zobacz wszystkie” 20 px, checkbox zgody 20×20) przechodzą 2.5.8 dzięki wyjątkowi odstępu — axe tego nie zgłasza. Nie zgłaszam.
- Skip link „Przejdź do treści” działa; chwilowe zasłonięcie logo tylko na czas animacji (<100 ms).
- #76: CTA „Spróbuj ponownie” na `/offline` ma 44 px przy 320 px — **potwierdzam** stan opisany w #76 (bez nowego ustalenia).

### Co pokrywa istniejący `tests/e2e/a11y.spec.ts`
Tylko 4 strony PL (`/pl`, `/pl/oferty-pracy`, `/pl/logowanie`, `/pl/rejestracja`) w domyślnym viewporcie + `/{locale}/oferty-pracy` przy 320 px. Blokuje tylko `critical/serious`. Nie obejmuje: szczegółu oferty (tam jest `serious`, ustalenie 5), landingów, poradników, stron prawnych, auth poza dwiema, 404, stanu po zamknięciu banera, zasłaniania fokusu, powiększenia tekstu. `best-practice` nie jest uruchamiane osobno. Ustalenia 1–3 są poza zasięgiem axe, potrzebny osobny test przeglądarkowy.

---

## Ustalenia (od najpoważniejszych)

### 1. [P1] Baner cookies przy powiększeniu tekstu 200%: przyciski poza ekranem, a baner wyższy niż viewport — WCAG 1.4.4, 1.4.10
**Przyczyna (wspólny komponent):** `src/components/cookies/CookieConsent.tsx` (kontener `fixed inset-x-0 bottom-0` bez `max-h`/`overflow-y-auto`; rząd `sm:flex-row` przycisków) + domyślne `whitespace-nowrap` w `src/components/ui/button.tsx`.
**Odtworzenie** (`audit/a11y/bn.js`): pierwsza wizyta (bez cookie zgody), `document.documentElement.style.fontSize='200%'`.
| język / viewport | wynik |
|---|---|
| PL 640 px | „Akceptuj wszystkie” x=592…934 → poza ekranem 640 |
| FR 640 px | „Personnaliser” 474…743 i „Tout accepter” 759…1032 poza ekranem |
| PL/FR 768 px | ostatni przycisk poza ekranem |
| PL 1024 px | baner 849 px wys., `top=-49`, „Akceptuj wszystkie” do x=1139 |
| FR 1024/1280 px | baner 897 px wys. przy viewport 800 → `top=-97`: tytuł/opis banera ucięte u góry, nie da się ich przewinąć (`position:fixed`) |

Oczekiwane: wszystkie trzy równorzędne opcje (Invariant #7) widoczne i osiągalne; treść banera przewijalna. Obecnie: przy 200% tekstu użytkownik nie widzi „Akceptuj/Personnaliser”, a część opisu jest niedostępna. Dotyczy **każdej** strony publicznej i auth we wszystkich 4 językach (baner jest globalny). Fixed baner nie zwiększa `scrollWidth` dokumentu, więc test overflow dokumentu tego nie wykryje.
**Poprawka (szkic):** na kontenerze banera `max-h-[100dvh] overflow-y-auto`; przyciski `whitespace-normal h-auto min-h-11 text-center` (lokalnie przez `className`, bez zmiany wariantu globalnego), rząd przycisków `flex-wrap` zamiast sztywnego `sm:flex-row`. Klucze `src/messages/*.json`: bez zmian.
**Test regresyjny:** Playwright, 4 języki × {640, 1024} px, `fontSize=200%`: każdy `button` w `[aria-labelledby="cookie-banner-title"]` ma `getBoundingClientRect()` w całości w `[0, innerWidth] × [0, innerHeight]` po `scrollIntoView` w obrębie banera, a `#cookie-banner-title` ma `top >= 0`.

### 2. [P1] Baner cookies na mobile zasłania fokus i jest na końcu kolejności Tab — WCAG 2.4.11 (AA), 2.4.3
**Przyczyna:** `src/components/cookies/CookieConsent.tsx` (fixed, 337 px wys. przy 320×800 = 42% ekranu; renderowany za `<main>` i stopką) + brak `scroll-padding-bottom` w `src/app/globals.css`.
**Odtworzenie** (`audit/a11y/obsc.js`, 320×800, baner widoczny, Tab od początku; fokus „całkowicie zasłonięty” = wszystkie 9 punktów elementu pod banerem):
- `/pl/oferty-pracy`: 11 z 41 zatrzymań fokusu całkowicie zasłoniętych (np. „Filtry”, „Sortuj: Najnowsze”, pierwsze karty ofert); po zamknięciu banera 0.
- `/fr/praca`: 23 z 41; `/pl/oferty-pracy/warehouse-worker-antwerp-1001`: 18 z 35; `/pl/logowanie`: 3 z 10 („Zaloguj się”, „Nie pamiętasz hasła?”, „Załóż konto”).
- 1280 px: `/pl/oferty-pracy/[slug]` 8 elementów całkowicie zasłoniętych (sekcje `<summary>` „Zakres obowiązków”…), stopka („Język”, linki) na wszystkich stronach.
- Kolejność: przyciski banera są osiągalne dopiero po ~55–70 Tabach (za całą stopką; na `/pl/oferty-pracy` pozycja >60). Shift+Tab z początku strony trafia od razu na „Akceptuj wszystkie” — pierwsza decyzja jest łatwiejsza „od tyłu”.
Zakres: wszystkie strony, 4 języki; najsilniej przy 320 px.
**Poprawka (szkic):** (a) przenieść baner w DOM przed `<main>`/Header (np. zaraz po SkipLink) przy zachowaniu `fixed`, żeby był na początku kolejności Tab; (b) gdy baner widoczny — ustawiać na `<html>` `scroll-padding-bottom` = wysokość banera (ResizeObserver lub zmienna CSS) i `padding-bottom` na `body`, aby dało się przewinąć ostatnie elementy nad baner; (c) skrócić baner na mobile (przyciski w dwóch kolumnach/krótszy opis). Weryfikacja hipotezy `obsc-fix.js`: samo `scroll-padding-bottom` zmniejsza zasłonięcia z 18→5 (detal) i 23→4 (`/fr/praca`); reszta to końcówka strony — potrzebny też `padding-bottom`. Klucze: bez zmian.
**Test regresyjny:** 320×800, baner widoczny, 4 języki, `/oferty-pracy` + detal oferty: Tab przez stronę, dla każdego `document.activeElement` co najmniej jeden punkt (środek) nie może należeć do banera (`elementFromPoint`); dodatkowo pierwszy przycisk banera osiągalny w ≤ N Tabach (np. ≤ 5).

### 3. [P1] Mobilny pasek „Aplikuj teraz” na szczególe oferty zasłania fokus — WCAG 2.4.11
**Plik:** `src/app/[locale]/(public)/oferty-pracy/[slug]/page.tsx` (l. ~615, `div.fixed inset-x-0 bottom-0 z-40 … lg:hidden`).
**Odtworzenie:** `/pl/oferty-pracy/warehouse-worker-antwerp-1001`, 320×800, **po zamknięciu banera**, Tab: 9 z 31 zatrzymań całkowicie zasłoniętych przez pasek (zakładki „Opis oferty”, „Informacje o firmie”, `<summary>` „Zakres obowiązków”, „Co oferujemy”, „O firmie”…). NL i EN: 12 z 31 (sprawdzone), FR analogicznie w przebiegu z banerem.
**Poprawka:** wrapper strony `<lg`: `pb-[wysokość paska]` + `scroll-padding-bottom` (np. przez klasę na `<main>` / `html:has(...)` albo zmienną CSS ustawianą przez stronę). Test (`obsc-fix.js`) pokazuje spadek 9→2 samym scroll-padding; pozostałe 2 w stopce wymagają `padding-bottom`. Klucze: bez zmian.
**Test regresyjny:** jak w pkt 2, 320 px, baner zamknięty, detal oferty — żaden fokusowany element nie jest w całości pod `[data-sticky-apply]` (dodać atrybut testowy lub rolę regionu).

### 4. [P1] Nieznany adres w obrębie języka zwraca domyślne angielskie 404 Next.js bez `lang` — WCAG 3.1.1 (A), 2.4.2
**Odtworzenie:** `/pl/nie-istnieje-xyz` (również `/nl/…`, `/fr/…`, `/en/…`), oba viewporty: `<html>` bez `lang`, `<title>404: This page could not be found.</title>`, tekst „This page could not be found.” po angielsku, brak `<main>`, brak Header/Footer i linku powrotu. axe: `html-has-lang` (serious), `landmark-one-main`, `region`. Natomiast `notFound()` wywołany przez stronę (np. `/nl/oferty-pracy/nope-999`) renderuje poprawnie `src/app/[locale]/not-found.tsx` (NL, `lang="nl"`) — problem dotyczy tylko nieznanych ścieżek.
**Przyczyna:** brak trasy catch-all w `[locale]`; `src/app/[locale]/not-found.tsx` uruchamia się tylko przez `notFound()`. Root `src/app/layout.tsx` celowo nie renderuje `<html>`.
**Poprawka:** dodać `src/app/[locale]/[...rest]/page.tsx` wywołujący `notFound()` (standardowy wzorzec next-intl), ewentualnie `src/app/not-found.tsx` dla ścieżek bez prefiksu. Klucze: bez zmian (`errors.notFound`, `common.back` istnieją). Uwaga poboczna: zlokalizowane 404 renderuje się poza `(public)/layout` — bez Header/Footer/SkipLink (`src/app/[locale]/not-found.tsx`); do decyzji, czy przenieść pod layout publiczny.
**Test regresyjny:** dla 4 języków `GET /{l}/nie-istnieje-xyz` → status 404, `html[lang={l}]`, `h1` = tłumaczenie `errors.notFound`, link do strony głównej.

### 5. [P2] Szczegół oferty: niepoprawna lista definicji „Zakwaterowanie i dojazd” — WCAG 1.3.1 (axe `definition-list`, `dlitem`, serious)
**Plik:** `src/app/[locale]/(public)/oferty-pracy/[slug]/page.tsx` (l. ~457–487): `<dl>` → `<div class="flex">` → ikona + `<div>` → `<dt>/<dd>`. HTML dopuszcza tylko jeden poziom `div` między `dl` a `dt/dd`.
**Zakres:** wszystkie oferty, 4 języki, 1280 i 320 px (16/16 przebiegów). Jest to `serious`, więc blokowałoby CI, ale szczegółu oferty nie ma w `a11y.spec.ts`.
**Poprawka:** jeden `div` na parę (`<div class="flex …"><dt class="flex gap-2.5"><Icon aria-hidden/>…</dt><dd>…</dd></div>`) albo ikona wewnątrz `dt`. Klucze: bez zmian.
**Test regresyjny:** dodać detal oferty (`/{l}/oferty-pracy/<slug demo>`, 320 i 1280) do `PAGES` w `tests/e2e/a11y.spec.ts`.

### 6. [P2] Strony auth nie mają żadnego nagłówka — WCAG 1.3.1 / 2.4.6 (axe best-practice `page-has-heading-one`)
**Pliki:** `src/components/ui/card.tsx` (`CardTitle` renderuje `<div>`), użycia w `src/app/[locale]/(auth)/{logowanie,rejestracja,rejestracja-pracodawca,reset-hasla,ustaw-nowe-haslo,potwierdzenie}/page.tsx`.
**Odtworzenie:** `/pl/logowanie`, `/pl/rejestracja`, `/pl/rejestracja-pracodawca`, `/pl/reset-hasla` (i NL/FR/EN): `document.querySelectorAll('h1,h2,h3,[role=heading]')` → pusto; tytuł „Zaloguj się” to `DIV`. Czytnik ekranu nie ma punktu nawigacji na kluczowej ścieżce rejestracji.
**Poprawka:** `CardTitle` z propem `as` (domyślnie `h3` jak w shadcn) i `as="h1"` na stronach auth; albo owinąć tytuł w `<h1>`. Klucze: bez zmian.
**Test regresyjny:** dla 6 tras auth × 4 języki: dokładnie jeden `h1` o treści = tłumaczenie tytułu (`auth.*Title`).

### 7. [P2] Hierarchia nagłówków w listach ofert: h1 → h3 bez h2 (axe `heading-order`)
**Pliki:** `src/components/public/JobCard.tsx` (l. 87, sztywne `<h3>`), `src/app/[locale]/(public)/oferty-pracy/page.tsx`, `src/app/[locale]/(public)/praca/kategoria/[category]/page.tsx`, `src/app/[locale]/(public)/praca/miasto/[city]/page.tsx`.
**Odtworzenie:** `/pl/oferty-pracy` przy 320 px: `H1 Oferty pracy w Belgii` → `H3 Zbieracz owoców…`; przy 1280 px karty ofert trafiają semantycznie pod `H2 Filtry`. Kategoria/miasto: h1 → h3 w obu viewportach. 4 języki.
**Poprawka:** nagłówek sekcji wyników `h2` (może być `sr-only`) przed listą albo prop `headingLevel` w `JobCard`. Klucze: prawdopodobnie nowy klucz w `src/messages/{pl,nl,fr,en}.json` (np. `jobs.resultsHeading`), chyba że użyjemy istniejącego tekstu licznika wyników.
**Test regresyjny:** na liście/landingach nagłówek najbliżej poprzedzający pierwszą kartę ma poziom = poziom karty − 1 i nie jest to „Filtry”.

### 8. [P2] Nagłówek strony przy 768–1150 px i tekście 200% wypycha akcje poza ekran — WCAG 1.4.4
**Plik:** `src/components/layout/Header.tsx` (nawigacja i przyciski `hidden md:inline-flex`, `whitespace-nowrap` z `button.tsx`, brak zawijania/przejścia na menu mobilne).
**Odtworzenie** (`ov3.js`, `ov4.js`): baner zamknięty, `fontSize=200%`, viewport 768: poziomy scroll dokumentu na **wszystkich** stronach publicznych — PL 292 px, NL 351, FR 372, EN 135; „Dodaj ofertę”/„Publier une offre” do x=1060/1140. FR 1024: 132 px. 1280: OK. Zrzuty `hdr-*.png`.
**Poprawka:** przełączać menu desktop dopiero od `lg` (albo `min-width` w `em`, żeby breakpoint rósł z tekstem), dopuścić `flex-wrap`/`min-w-0` w pasku akcji. Klucze: bez zmian.
**Test regresyjny:** 4 języki × 768/1024 px, `fontSize=200%`: `scrollWidth <= clientWidth` i przyciski nagłówka w całości w viewporcie.

### 9. [P2] Karty poradników i hubu `/praca` nie łamią długich słów przy tekście 200% — WCAG 1.4.4/1.4.10
**Pliki:** `src/components/public/GuideCard.tsx` (link tytułu w `h2`), `src/components/public/LandingHubGrid.tsx` (`h3` kategorii i opis `p`).
**Odtworzenie** (`ov2.js`): 640 px + `fontSize=200%`, baner zamknięty: `/nl/poradniki` overflow 77 px („Rijksregisternummer…”), `/pl/poradniki` 5 px; `/pl/praca` 29, `/nl/praca` 82, `/fr/praca` 31, `/en/praca` 31 px (tekst „Schoonmaak”, „Production” wychodzi z kart `sm:grid-cols-2`). Uwaga: to test skrajny (640 + 200% tekstu); przy 320 px i 100% OK.
**Poprawka:** `break-words [overflow-wrap:anywhere] hyphens-auto` na tytułach kart (`lang` jest poprawny, więc `hyphens` zadziała), `min-w-0` na elementach flex. Klucze: bez zmian.
**Test regresyjny:** 4 języki, `/poradniki` i `/praca` przy 640 px + 200%: brak overflow dokumentu.

### 10. [P2] Nazwy języków w przełączniku bez atrybutu `lang` — WCAG 3.1.2 (AA)
**Plik:** `src/components/layout/LocaleSwitcher.tsx` (`SelectItem` → `{localeNames[loc]}`; używany w `Footer.tsx` i `MobileNav.tsx`).
**Odtworzenie:** `/pl` → przełącznik „Język” w stopce: opcje „Nederlands”, „Français”, „English” nie mają `lang`, więc czytnik czyta je polską syntezą.
**Poprawka:** `<SelectItem value={loc} lang={loc}>` (lub `<span lang={loc}>` wewnątrz); to samo dla `SelectValue`. Klucze: bez zmian.
**Test regresyjny:** po otwarciu przełącznika każda opcja `[role=option]` ma `lang` równy swojemu locale.

---

## Podział pracy (pliki → ustalenia)
- `src/components/cookies/CookieConsent.tsx`, `src/app/globals.css`, (lokalnie) `src/components/ui/button.tsx` → 1, 2
- `src/app/[locale]/(public)/oferty-pracy/[slug]/page.tsx` → 3, 5
- `src/app/[locale]/[...rest]/page.tsx` (nowy), `src/app/[locale]/not-found.tsx` → 4
- `src/components/ui/card.tsx` + `src/app/[locale]/(auth)/*/page.tsx` → 6
- `src/components/public/JobCard.tsx`, listy/landingi, ew. `src/messages/*.json` → 7
- `src/components/layout/Header.tsx` → 8
- `src/components/public/GuideCard.tsx`, `src/components/public/LandingHubGrid.tsx` → 9
- `src/components/layout/LocaleSwitcher.tsx` → 10
- `tests/e2e/a11y.spec.ts`: rozszerzyć o detal oferty, landingi, poradnik, strony prawne, wszystkie trasy auth, 404; przebieg po zamknięciu banera; osobny spec na zasłanianie fokusu i powiększenie tekstu (1–3, 8–9).
