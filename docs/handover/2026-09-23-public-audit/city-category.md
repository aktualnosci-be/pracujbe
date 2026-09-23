# Audyt: strony miast i kategorii (`/{locale}/praca`, `/praca/kategoria/[category]`, `/praca/miasto/[city]`)

Środowisko: http://localhost:3100 (next start, demo, bez bazy), `main` @ f11170e, Chromium z Playwright.
Skrypty: `audit/cc/*.js` (a.js — nagłówki/breadcrumb/axe 4×4 stron; b.js — liczniki; d.js — przełącznik języka;
e.js — baner vs stopka; f.js/k.js/i.js — 320 px / 640–1280 px + tekst 200%; m.js — kolejność Tab i fokus).

## Co działa (sprawdzone, bez ustaleń)
- Nieistniejący slug (`/pl/praca/kategoria/xyz`, `/pl/praca/miasto/xyz`, `/praca/miasto/Brussels`) → HTTP 404,
  strona 404 z `lang` i H1 w języku strony, `noindex, nofollow`. Nie ma „pustej strony 200”.
- Przełącznik języka (stopka) na hubie, kategorii i mieście zachowuje klucz sluga: `/pl/praca/miasto/brussels`
  → `/fr/…/brussels` → `/en/…/brussels`; `lang`, H1 i breadcrumb są przetłumaczone. Brak surowych kluczy i18n (PL/NL/FR/EN).
- axe (wcag2a/aa, 21a/aa, 22aa): 0 naruszeń na 16 stronach (4 widoki × 4 języki).
- 320 px: brak poziomego przewijania na wszystkich 16 stronach. Rzeczywiste 200% (viewport 640 px, font bazowy): brak przewijania.
- Fokus klawiatury widoczny (ring box-shadow) na breadcrumbach, kaflach huba, kartach ofert, chipach; kolejność Tab zgodna z DOM.
- Kontrast pustego stanu (kod): `text-muted-foreground` #616161 i `text-accent` #D72D36 na `bg-soft` #F7F7F7 ≥ 4.5:1.
- Pusty wynik: w demo każda kategoria i miasto ma ≥1 ofertę (b.js), więc stanu pustego nie da się odtworzyć — nie raportuję.
- #189: w demo link „zobacz wszystkie w mieście” (`/nl/oferty-pracy?city=Antwerpen`) daje 4 wyniki — **nie potwierdzam w demo**
  (zależy od danych w bazie; issue pozostaje otwarte).

---

## 1. [P1] Kafle huba: tytuły i opisy wychodzą poza kafel i poza stronę przy powiększeniu tekstu 200% — WCAG 1.4.4, 1.4.10
**Kroki:** `/nl/praca` (także pl/fr/en), viewport 640×800 (oraz 768, 1024, 1280), `document.documentElement.style.fontSize='200%'`, baner cookies zamknięty.
**Wynik obecny:** `scrollWidth` 669–722 przy 640 px (PL 669, FR/EN 671, NL 722), 903–1140 przy 768 px (część to nagłówek, patrz uwagi).
Tekst H3 kafli jest obcinany/wystaje: „installati…”, „Schoonm…” (zrzut `cc/hub-200-tiles.png`), text-nody „Seizoenswerk” do x=722,
„Antwerpen” x=675; opisy (np. „Productiejobs…”) też wystają. Przy 1280 px + 200% tekstu przepełnienie jest wewnątrz kafli
(H3 `scrollWidth > clientWidth` we wszystkich językach).
**Oczekiwany:** tekst zawija się w kaflu; siatka redukuje kolumny, gdy rośnie tekst; brak przewijania w poziomie.
**Przyczyna:** `LandingHubGrid` — sztywne `sm:grid-cols-2 lg:grid-cols-3` (breakpointy w px nie reagują na rozmiar tekstu),
ikona `h-12 w-12` + strzałka zabierają szerokość, H3 ma `min-w-0 flex-1` bez `break-words`/`hyphens`.
**Zakres:** tylko hub `/praca` (kafle branż i miast), 4 języki; najgorzej NL/FR (długie złożenia).
**Pliki:** `src/components/public/LandingHubGrid.tsx`.
**i18n:** bez zmian.
**Szkic:** siatka `grid-cols-[repeat(auto-fill,minmax(min(100%,18rem),1fr))]` (rem → liczba kolumn spada przy większym tekście);
H3 i opis `break-words hyphens-auto` (`lang` jest ustawiony na `<html>`); opcjonalnie ikona nad tytułem przy wąskim kaflu.
**Test regresyjny:** e2e dla `/{pl,nl,fr,en}/praca` przy 640 i 1024 px po ustawieniu `fontSize='200%'`: żaden text-node w
`main ul[aria-label]` nie ma prostokąta (Range.getClientRects) wystającego poza prostokąt swojego `<a>` kafla, oraz
`scrollWidth <= clientWidth`.

## 2. [P1] Baner cookies całkowicie zasłania przełącznik języka w stopce (także gdy ma fokus) — WCAG 2.4.11
**Kroki:** nowa sesja (bez zgody), `/pl/praca/kategoria/care`, 1280×900; przewiń na sam dół lub Tab do „Język”.
**Wynik obecny:** trigger `footer [role=combobox]` top/bottom 784/820, baner `fixed bottom-0` 783/900 → sfokusowany element
w pełni zasłonięty (`fullyHidden: true`); kliknięcie myszą niemożliwe (Playwright: „cookie-banner … intercepts pointer events”).
Przy 320×640 baner zajmuje 303–640 px i również przykrywa przełącznik. `body` nie ma `padding-bottom` na czas banera.
Użytkownik, który chce najpierw zmienić język (np. przeczytać baner po NL), musi najpierw podjąć decyzję o cookies.
**Oczekiwany:** można przewinąć stronę tak, by stopka była nad banerem; fokus nigdy w pełni zasłonięty.
**Zakres:** wszystkie strony publiczne ze stopką (sprawdzone na hubie/kategorii/mieście, 4 języki) — problem wspólny, nie tylko tego obszaru.
**Pliki:** `src/components/cookies/CookieConsent.tsx` (ew. layout publiczny `src/app/[locale]/(public)/layout.tsx`,
jeśli padding ma być tam).
**i18n:** bez zmian.
**Szkic:** gdy baner jest widoczny, ustawiać `padding-bottom` równy jego wysokości (ResizeObserver → zmienna CSS na `<body>`)
lub `scroll-padding-bottom`, żeby ostatnie elementy dało się przewinąć ponad baner; alternatywnie przełącznik języka w banerze.
**Test regresyjny:** e2e bez zgody: `footer [role=combobox]`.focus() → prostokąt triggera nie jest w całości zawarty w prostokącie banera;
po `scrollTo(bottom)` `elementFromPoint` środka triggera leży w `footer`.

## 3. [P2] Pominięty poziom nagłówka: H1 → H3 (tytuły ofert) na stronach kategorii i miasta — WCAG 1.3.1 (dobra praktyka 2.4.6)
**Kroki:** `/pl/praca/kategoria/construction`, `/pl/praca/miasto/brussels` (i nl/fr/en).
**Wynik obecny:** kolejność `H1: Praca w branży: Budownictwo` → `H3: Murarz – Bruksela` … → `H2: Inne branże`.
Sekcja listy ma tylko `aria-label={t('availableJobs')}`, bez nagłówka; H3 pochodzi z `JobCard`. (axe nie zgłasza, bo
`heading-order` jest regułą best-practice, nieuwzględnioną w tagach bramki).
**Oczekiwany:** H1 → H2 „Dostępne oferty” → H3 oferty → H2 „Inne branże/miasta”.
**Zakres:** kategoria + miasto, 4 języki. Hub jest poprawny (H1 → H2 → H3).
**Pliki:** `src/app/[locale]/(public)/praca/kategoria/[category]/page.tsx`, `src/app/[locale]/(public)/praca/miasto/[city]/page.tsx`.
**i18n:** bez nowych kluczy — użyć istniejącego `landing.availableJobs`.
**Szkic:** w `<section>` dodać `<h2 id="jobs-heading" className="sr-only">{t('availableJobs')}</h2>` (lub widoczny) i
zamienić `aria-label` na `aria-labelledby`.
**Test regresyjny:** e2e: na obu landingach kolejne poziomy nagłówków w `main` nigdy nie rosną o więcej niż 1
(albo włączyć regułę axe `heading-order` dla tych stron w `tests/e2e/a11y.spec.ts`).

## 4. [P2] Breadcrumb: bieżąca strona bez `aria-current="page"`
**Kroki:** hub, kategoria, miasto (4 języki) — `nav[aria-label="Ścieżka nawigacji"] li:last-child`.
**Wynik obecny:** ostatni element to zwykły `<li class="text-foreground">` bez `aria-current`; czytnik nie ogłasza, że to bieżąca strona
(wyróżnienie tylko kolorem). Nawigacja (`<nav aria-label>` + `<ol>`, separatory `aria-hidden`) poza tym poprawna.
**Oczekiwany:** `<li><span aria-current="page">…</span></li>`.
**Zakres:** 3 strony obszaru (ten sam wzorzec kopiowany jest też w `oferty-pracy/page.tsx`, `poradniki/*` — poza obszarem).
**Pliki:** `src/app/[locale]/(public)/praca/page.tsx`, `…/praca/kategoria/[category]/page.tsx`, `…/praca/miasto/[city]/page.tsx`
(lepiej: wydzielić wspólny `src/components/public/Breadcrumbs.tsx` i użyć w trzech plikach — wtedy JSON-LD i widok z jednej listy).
**i18n:** bez zmian (`common.breadcrumb`, `common.home`, `landing.breadcrumbHub`).
**Test regresyjny:** e2e: `getByRole('navigation', { name: <common.breadcrumb> }).locator('[aria-current="page"]')` ma dokładnie 1 element
i jego tekst = nazwa bieżącej strony, na 3 widokach.

## 5. [P2] Małe cele dotykowe: linki breadcrumb 17 px i „Zobacz wszystkie…” 20 px wysokości; chipy 34 px — 2.5.8 / standard repo 44 px
**Kroki:** 320×700, dowolny język; pomiar `getBoundingClientRect` (f.js).
**Wynik obecny:** „Strona główna” 95×17, „Praca” 38×17 (EN „Jobs” 32×17); „See all jobs” 98×20, „Bekijk alle jobs in …” 202×20;
chipy „Inne branże/miasta” wysokość 34 px. Breadcrumb formalnie mieści się w wyjątku odstępu 2.5.8 (sąsiedzi daleko), ale
poniżej przyjętych w repo 44 px na mobile i poniżej 24 px wysokości samego celu.
**Oczekiwany:** min. 24×24 (pewnie), docelowo ~44 px wysokości obszaru klikalnego na mobile dla linków nawigacyjnych i CTA „zobacz wszystkie”.
**Zakres:** hub (breadcrumb, „Zobacz wszystkie oferty”), kategoria/miasto (breadcrumb, „Zobacz wszystkie … ”, chipy), 4 języki.
**Pliki:** te same 3 `page.tsx` (lub wspólny `Breadcrumbs.tsx` z pkt 4).
**i18n:** bez zmian.
**Szkic:** linkom breadcrumb i „see all” dodać `inline-flex min-h-11 items-center` (bez zmiany wyglądu tekstu), chipom `min-h-11`
(lub `py-2.5`); zachować `focus-visible:ring`.
**Test regresyjny:** e2e na 320 px: każdy `a` w breadcrumb, CTA „see all” i chipy mają wysokość ≥ 44 px (ew. ≥ 24 dla breadcrumb, jeśli
zespół tak zdecyduje).

## 6. [P2] Zlokalizowane slugi miast i brak strony pod `/praca/kategoria` / `/praca/miasto` dają 404 zamiast przekierowania
**Kroki:** `curl -I` → `/nl/praca/miasto/brussel` 404, `/fr/praca/miasto/bruxelles` 404, `/pl/praca/miasto/bruksela` 404,
`/pl/praca/miasto/Brussels` 404; `/pl/praca/kategoria/` → 308 → `/pl/praca/kategoria` → 404 (to samo `/pl/praca/miasto`).
**Wynik obecny:** użytkownik wpisujący nazwę miasta w swoim języku albo skracający URL trafia na 404 z jednym przyciskiem „Wróć” na stronę główną.
**Oczekiwany:** 308 na kanoniczny klucz (`brussel|bruxelles|bruksela|Brussels` → `brussels`), `/praca/kategoria` i `/praca/miasto` → 308 na `/praca`.
**Zakres:** miasto (wszystkie 10 kluczy × 4 języki), kategoria (tylko goły segment). Kanoniczne adresy i hreflang bez zmian.
**Pliki:** `src/app/[locale]/(public)/praca/miasto/[city]/page.tsx` (mapa alias→klucz z `locations` + `permanentRedirect`),
nowe `src/app/[locale]/(public)/praca/kategoria/page.tsx` i `src/app/[locale]/(public)/praca/miasto/page.tsx` (tylko `permanentRedirect('/praca')`) —
albo reguły w `src/middleware.ts`. Uwaga: nie dotykać `generateMetadata` (PR #128/#183).
**i18n:** bez zmian (aliasy wyliczane z istniejących `locations.*` dla 4 języków, znormalizowane: lowercase, bez diakrytyków).
**Test regresyjny:** unit dla funkcji `resolveCityKey(alias)` (każda przetłumaczona nazwa z `src/messages/*.json` → klucz; nieznany → null)
+ e2e: `/nl/praca/miasto/brussel` kończy się na `/nl/praca/miasto/brussels` z 200; `/pl/praca/kategoria` → `/pl/praca`.

---

## Uwagi poza zakresem (odtworzone, do przekazania właściwym sesjom)
- **Nagłówek przy tekście 200% (768/1024 px):** `header div.flex.items-center.gap-2` („Zaloguj się / Dodaj ofertę”) sięga x=1060 →
  poziomy scroll na wszystkich stronach publicznych (1.4.4). Plik: `src/components/layout/Header.tsx`.
- **JobCard przy 640 px + tekst 200%:** `li` kart na landingach mają `scrollWidth > clientWidth` (np. „Seizoenswerk…”, „Technique et i…”) —
  komponent `src/components/public/JobCard.tsx` (obszar listy ofert).
- **Baner cookies przy 640 px + tekst 200%:** przyciski „Aanpassen”/„Alles accepteren” wychodzą poza viewport (x=659/984) — `CookieConsent.tsx`.
- **Tytuł dokumentu dubluje markę:** „… | Pracuj.be · Pracuj.be” na hubie/kategorii/mieście (4 języki) — metadane, #118/PR #128, nie ruszam.
- Przełącznik języka `SelectTrigger h-9` = 36 px wysokości (poniżej 44 px repo na mobile) — `src/components/layout/LocaleSwitcher.tsx` (stopka/menu).
