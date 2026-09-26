# Matryca zgodności z prototypem „04 Ludzie i praca” (#7)

Pomiar: 2026-09-24, `main` + zmiany z PR #7, build produkcyjny w trybie demo (bez bazy danych),
Chromium, `deviceScaleFactor 1`, zgoda cookies „tylko niezbędne” zapisana z góry. Prototyp
`docs/design/people-passport/prototype` (motyw `people`, widok przez `view=…; render()`),
witryna `#site` na pełną szerokość okna, ten sam plik DM Sans co aplikacja (Google Fonts podmienione
lokalnie, opsz 9).

Powtórzenie (poza CI):

```bash
npm run build && npm run start            # tryb demo, port 3000
PLAYWRIGHT_CHROMIUM_PATH=/opt/pw-browsers/chromium node scripts/design/compare-prototype.mjs
# wyniki: test-results/prototype-compare/{results.json,matrix.md,*-proto.png,*-app.png,*-diff.png}
```

## Metoda

- **% różnicy** — nakładka zrzutów całej strony (prototyp `#site` ↔ aplikacja), odsetek pikseli
  różniących się w którymkolwiek kanale RGB o więcej niż **40/255**, na wspólnym obszarze (od góry
  do wysokości krótszej strony). Liczony tylko dla ekranów mających odpowiednik 1:1 w prototypie;
  dane demo aplikacji (inne oferty, osoby, liczby) są częścią różnicy.
- **style** — odsetek zgodnych właściwości kluczowych elementów (`getComputedStyle` +
  `getBoundingClientRect`): nagłówek strony, kafelek „.be” logo, H1, nadtytuł, pierwszy przycisk
  w kolorze marki, aktywna pozycja menu panelu, krój/kolor tekstu. Tolerancja 1 px (interlinia
  1,5 px) i 8/255 na kanał koloru (#777 → #767676 = zgodne). Trasy bez ekranu w prototypie są
  porównywane z ekranem, z którego prymitywów są złożone (kolumna „Ekran prototypu”).
- **Status** (gorszy z 1280/390 px): ✓ — różnica ≤ 10% i style ≥ 85% (bez ekranu: style ≥ 90%);
  ~ — różnica ≤ 30% i style ≥ 60% (bez ekranu: ≥ 70%), odstępstwa uzasadnione; ✗ — poniżej,
  odstępstwo strukturalne opisane w zadaniach Z1–Z6.

## Ekrany i trasy

| Grupa | Ekran prototypu | Trasa aplikacji | % różnicy 1280 | % różnicy 390 | style 1280 | style 390 | Status | Uzasadnienie / odstępstwa |
|---|---|---|---|---|---|---|---|---|
| public | `home` | `/pl` | 7.6% | 10.7% | 100% | 100% | ~ | Różnice = teksty aplikacji („Zaloguj się”, podpis zdjęcia), stany demo i sekcje spoza prototypu pod „W czym jesteś dobry?”. ([#484](https://github.com/aktualnosci-be/pracujbe/pull/484)) |
| public | `jobs` | `/pl/oferty-pracy` | 7.3% | 16.3% | 100% | 98% | ~ | Nagłówek i wyszukiwarka = kalka; panel filtrów = `.p-list-layout` 190/165 px i `.people .filters` (Z3). Różnica: dane demo, baner demo, breadcrumb, opis pod H1, liczniki i „Pokaż więcej” w filtrach (funkcje aplikacji); 390 px — H1 w jednym wierszu zamiast dwóch (krótszy tekst). |
| public | `detail` | `/pl/oferty-pracy/[slug]` | 7.6% | 15.4% | 94% | 89% | ~ | `offer-layout` prototypu (Z2): nadtytuł „kategoria / miasto”, H1 `.extended`, karta-paszport, treść w `.paper`, panel 300 px „Twój następny krok” (`.btn` + `.btn.secondary`). Różnice: „przyciskiem głównym” prototypu jest CTA karty (12 px), kotwice sekcji, dopasowanie, kontakt i podobne oferty w panelu, dolny pasek aplikowania < 1024 px (prototyp: panel pod treścią < 950 px). |
| public | `jobs` | `/pl/praca` | — | — | 94% | 94% | ✓ | Brak ekranu; nagłówek `.pp-page-title` = `.p-list-header h1` (ten PR). Bez nadtytułu (treść bez odpowiednika). |
| public | `jobs` | `/pl/praca/kategoria/logistics` | — | — | 94% | 94% | ✓ | jw. |
| public | `jobs` | `/pl/praca/miasto/antwerpen` | — | — | 94% | 94% | ✓ | jw. |
| public | `home` | `/pl/dla-pracodawcow` | — | — | 85% | 87% | ~ | Brak ekranu; układ hero strony głównej (#339). H1 mniejszy niż hero prototypu — strona treściowa, nie strona główna. ([#484](https://github.com/aktualnosci-be/pracujbe/pull/484)) |
| public | `jobs` | `/pl/poradniki` | — | — | 94% | 90% | ✓ | Brak ekranu; `.pp-page-title` (ten PR). |
| public | `jobs` | `/pl/poradniki/[slug]` | — | — | 90% | 90% | ✓ | jw. |
| public | `jobs` | `/pl/faq` | — | — | 94% | 90% | ✓ | Strony informacyjne (`_legal/legal-page.tsx`): `.pp-page-title` (ten PR). Treść prawna = placeholder (#40). |
| public | `jobs` | `/pl/o-nas` | — | — | 94% | 90% | ✓ | jw. |
| public | `jobs` | `/pl/kontakt` | — | — | 94% | 90% | ✓ | jw. |
| public | `jobs` | `/pl/pomoc` | — | — | 94% | 90% | ✓ | jw. |
| public | `jobs` | `/pl/regulamin` | — | — | 94% | 90% | ✓ | jw. |
| public | `jobs` | `/pl/polityka-prywatnosci` | — | — | 94% | 90% | ✓ | jw. |
| public | `jobs` | `/pl/polityka-cookies` | — | — | 94% | 90% | ✓ | jw. |
| public | `jobs` | `/pl/zglos-tresc` | — | — | 94% | 90% | ✓ | Formularz DSA (#41): `.pp-page-title` (ten PR). |
| public | `jobs` | `/pl/nie-ma-takiej-strony` | — | — | 98% | 100% | ✓ | Strona 404 = `.p-list-header` (nadtytuł „404”, H1 `.pp-page-title`) + `.pp-btn`/`.pp-btn-secondary` (Z5). Jedyna różnica: przycisk 49 px zamiast 58 px przycisku wyszukiwarki prototypu. |
| auth | `apply` | `/pl/logowanie` | — | — | 97% | 97% | ✓ | Brak ekranu; kalka `#people/apply` (Z4): nagłówek i stopka witryny, H1 `.extended` 40/30 px, `.dash-intro`, karta `.paper.demo-form` (pola 15 px/promień 11 px, przycisk `.people .btn`). Brak nadtytułu (treść bez odpowiednika). |
| auth | `apply` | `/pl/rejestracja` | — | — | 97% | 97% | ✓ | jw. |
| auth | `apply` | `/pl/rejestracja-pracodawca` | — | — | 95% | 95% | ✓ | jw. |
| auth | `apply` | `/pl/reset-hasla` | — | — | 95% | 95% | ✓ | jw. |
| auth | `apply` | `/pl/ustaw-nowe-haslo` | — | — | 94% | 94% | ✓ | jw. |
| auth | `apply` | `/pl/potwierdzenie` | — | — | 94% | 94% | ✓ | jw. |
| auth | `apply` | `/pl/wypisz` | — | — | 94% | 94% | ✓ | jw. |
| candidate | `candidate` | `/pl/candidate` | 9.5% | 13.1% | 86% | 75% | ~ | Treść = kalka `#people/candidate`. Różnice: chrome panelu (pasek 64 px z powiadomieniami zamiast nagłówka witryny 95 px, logo w sidebarze zamiast `.side-person`) → Z1; ≤ 850 px dolny pasek zakładek (decyzja #496). ([#507](https://github.com/aktualnosci-be/pracujbe/pull/507)) |
| candidate | `profile` | `/pl/candidate/profil` | 7.4% | 13.1% | 86% | 81% | ~ | jw. (`#people/profile`). ([#507](https://github.com/aktualnosci-be/pracujbe/pull/507)) |
| candidate | `applications` | `/pl/candidate/aplikacje` | 5.8% | 11.1% | 83% | 79% | ~ | jw. (`#people/applications`). ([#507](https://github.com/aktualnosci-be/pracujbe/pull/507)) |
| candidate | `proposals` | `/pl/candidate/propozycje` | 8.6% | 14.9% | 80% | 75% | ~ | jw. (`#people/proposals`). ([#507](https://github.com/aktualnosci-be/pracujbe/pull/507)) |
| candidate | `messages` | `/pl/candidate/wiadomosci` | 6.6% | 12.6% | 81% | 75% | ~ | jw. (`#people/messages`). ([#507](https://github.com/aktualnosci-be/pracujbe/pull/507)) |
| candidate | `saved` | `/pl/candidate/zapisane` | 7.8% | 13.5% | 81% | 69% | ~ | jw. (`#people/saved`); karty `.pp-passport` zamiast `.job`. ([#507](https://github.com/aktualnosci-be/pracujbe/pull/507)) |
| candidate | `saved` | `/pl/candidate/oferty-polecane` | — | — | 81% | 69% | ✗ | Brak ekranu; złożone z `saved`. Niska zgodność przy 390 px = dolny pasek zakładek (Z1). ([#507](https://github.com/aktualnosci-be/pracujbe/pull/507)) |
| candidate | `profile` | `/pl/candidate/onboarding` | — | — | 81% | 81% | ~ | Brak ekranu; `.paper.demo-form` + numer kroku. ([#507](https://github.com/aktualnosci-be/pracujbe/pull/507)) |
| candidate | `saved` | `/pl/candidate/wyszukiwania` | — | — | 84% | 75% | ~ | Brak ekranu; prymitywy panelu. ([#507](https://github.com/aktualnosci-be/pracujbe/pull/507)) |
| candidate | `profile` | `/pl/candidate/ustawienia` | — | — | 79% | 73% | ~ | Brak ekranu; przełączniki zamiast przycisku głównego. ([#507](https://github.com/aktualnosci-be/pracujbe/pull/507)) |
| employer | `employer` | `/pl/employer` | 6.7% | 11.3% | 88% | 69% | ~ | Treść = kalka `#people/employer`; karty paszportowe ofert zamiast tabeli (decyzja #171). Chrome panelu → Z1. ([#496](https://github.com/aktualnosci-be/pracujbe/pull/496)) |
| employer | `newjob` | `/pl/employer/oferty/nowa` | 6.5% | 13.1% | 92% | 75% | ~ | Kalka `#people/newjob` (9 kroków zamiast skrótu prototypu). ([#496](https://github.com/aktualnosci-be/pracujbe/pull/496)) |
| employer | `talent` | `/pl/employer/kandydaci` | 9.2% | 17.4% | 90% | 68% | ~ | Kalka `#people/talent`; H1 40 px `.extended` (ten PR). ([#496](https://github.com/aktualnosci-be/pracujbe/pull/496)) |
| employer | `company` | `/pl/employer/firma` | 23.7% | 29.7% | 92% | 83% | ~ | Kalka `#people/company`; większa różnica pikseli = formularz edycji + baner statusu weryfikacji ponad treścią prototypu. ([#496](https://github.com/aktualnosci-be/pracujbe/pull/496)) |
| employer | `talent` | `/pl/employer/oferty` | — | — | 90% | 68% | ✗ | Brak ekranu; H1 `.extended` (ten PR). 390 px: dolny pasek zakładek (Z1). ([#496](https://github.com/aktualnosci-be/pracujbe/pull/496)) |
| employer | `talent` | `/pl/employer/aplikacje` | — | — | 87% | 68% | ✗ | jw. ([#496](https://github.com/aktualnosci-be/pracujbe/pull/496)) |
| employer | `profile` | `/pl/employer/aplikacje/[id]` | — | — | 85% | 67% | ✗ | Brak ekranu; szczegół zgłoszenia z prymitywów `profile`. 390 px: Z1. ([#496](https://github.com/aktualnosci-be/pracujbe/pull/496)) |
| employer | `messages` | `/pl/employer/wiadomosci` | — | — | 88% | 75% | ~ | Wspólny widok wiadomości z kandydatem. ([#507](https://github.com/aktualnosci-be/pracujbe/pull/507)) |
| employer | `talent` | `/pl/employer/statystyki` | — | — | 90% | 77% | ~ | Brak ekranu; H1 `.extended` (ten PR). ([#496](https://github.com/aktualnosci-be/pracujbe/pull/496)) |
| employer | `company` | `/pl/employer/zespol` | — | — | 92% | 83% | ~ | Brak ekranu; H1 `.extended` (ten PR). ([#496](https://github.com/aktualnosci-be/pracujbe/pull/496)) |
| employer | `company` | `/pl/employer/ustawienia` | — | — | 83% | 75% | ~ | Brak ekranu; przełączniki zamiast przycisku. ([#496](https://github.com/aktualnosci-be/pracujbe/pull/496)) |
| employer | `company` | `/pl/employer/firma/nowa` | — | — | 92% | 83% | ~ | Brak ekranu; H1 `.extended` (ten PR). ([#496](https://github.com/aktualnosci-be/pracujbe/pull/496)) |
| admin | `employer` | `/pl/admin` | — | — | 81% | 69% | ✗ | Brak ekranu; prymitywy panelu pracodawcy (#483). Chrome panelu → Z1; przyciski w tabelach mniejsze niż `.btn`. ([#483](https://github.com/aktualnosci-be/pracujbe/pull/483)) |
| admin | `employer` | `/pl/admin/firmy` | — | — | 86% | 75% | ~ | jw. ([#483](https://github.com/aktualnosci-be/pracujbe/pull/483)) |
| admin | `company` | `/pl/admin/firmy/[id]` | — | — | 81% | 69% | ✗ | H1 `.extended` 40/30 px (Z6); przyciski akcji = `.btn`. Pozostała różnica = chrome panelu → Z1. |
| admin | `employer` | `/pl/admin/zgloszenia` | — | — | 86% | 75% | ~ | Filtry statusu i rodzaju = `.btn`/`.btn.secondary` (Z6). Pozostała różnica = chrome panelu → Z1. |
| admin | `employer` | `/pl/admin/uzytkownicy` | — | — | 86% | 83% | ~ | jw. ([#483](https://github.com/aktualnosci-be/pracujbe/pull/483)) |
| admin | `employer` | `/pl/admin/poczta` | — | — | 81% | 75% | ~ | Filtry = `.btn`/`.btn.secondary` zamiast pigułek (Z6). Pozostała różnica = chrome panelu → Z1. |
| admin | `employer` | `/pl/admin/dziennik` | — | — | 86% | 83% | ~ | jw. ([#483](https://github.com/aktualnosci-be/pracujbe/pull/483)) |
| brand | `home` | `/pl/offline` | — | — | 55% | 55% | ✗ | Samodzielny `public/offline.html` bez nagłówka witryny (działa bez sieci); logo/kolory prototypu. ([#510](https://github.com/aktualnosci-be/pracujbe/pull/510)) |
| email | `materials/newsletter.html` | `React Email (newsletter)` | 6.2% | 18.6% | — | — | ~ | Odstępstwa klientów pocztowych (#510): bez nadtytułu „PRACA W BELGII” i czerwonej drugiej linii, inne teksty i liczba ofert; 390 px — różna wysokość treści. ([#510](https://github.com/aktualnosci-be/pracujbe/pull/510)) |
| email | `materials/newsletter.html` | `React Email (transactional)` | — | — | — | — | — | Wszystkie typy: jeden layout z newslettera (paleta pilnowana testem `email-palette`); bez pomiaru pikseli — inna treść. ([#510](https://github.com/aktualnosci-be/pracujbe/pull/510)) |

Ekran prototypu `#people/brand` (identyfikacja) nie ma trasy w aplikacji — pokrywają go logo
(`src/components/brand/Logo.tsx`), zasoby marki poniżej i test `brand-assets.test.ts`.
Widok `#people/apply` (formularz aplikowania) = `ApplyModal`/formularz gościa; w trybie demo modal
pokazuje komunikat zamiast formularza (#297), dlatego służy tu tylko jako referencja formularzy
(auth). Pomiar obejmuje język PL; układ w NL/FR/EN pilnują istniejące testy reflow/zoom.

## Etap 04 — panele i kreatory (#5), pomiar 2026-09-25

Ponowny pomiar 29 tras paneli (kandydat, pracodawca, admin) przy 1280/390 px. Przed zmianą
wyniki były identyczne z tabelą powyżej; rozbieżności stylów w panelach (58 pomiarów) to:

| Właściwość | Liczba pomiarów | Przyczyna | Stan |
|---|---|---|---|
| nagłówek (wysokość 64 vs 95/77 px, 16 vs 14 px), logo (24/700 vs 29/800) | 58 / 46 | chrome panelu | **Z1 — decyzja właściciela** |
| aktywna pozycja menu przy 390 px (dolny pasek zakładek zamiast `.side-item.active`) | 15 | chrome panelu (#496) | **Z1 — decyzja właściciela** |
| interlinia przycisku `.btn`: 20 px (`text-sm`) zamiast `normal` (≈ 18,2 px) | 32 | prototyp nie ustawia `line-height` | **poprawione** |
| H1 przy 390 px (1 zamiast 2 wierszy), brak przycisku głównego / nadtytułu | 12 / 14 / 4 | inna treść ekranu (dane demo, krótsze teksty) | bez zmian — nie styl |
| „przycisk główny” w ustawieniach i propozycjach | 6 | heurystyka mierzy inny element (przełącznik, CTA karty 12 px) | bez zmian — artefakt pomiaru |

Poprawka: `leading-[normal]` w `BTN_PRIMARY`/`BTN_SECONDARY`/`BTN_ACTION`/`BTN_SMALL`
(`panel-styles.ts`), `Button size="passport"`, przycisk „Zapisz” w wariancie paszportu i
przycisk pomocniczy onboardingu. Po zmianie style tras paneli +2 pp (tabela wyżej; kolumny
„style” zmierzone na `next dev` tego drzewa, % pikseli z buildu produkcyjnego sprzed zmiany —
interlinia nie zmienia wysokości przycisku 49 px). Strażnik: `prototype-matrix.spec.ts` —
`BTN` sprawdza interlinię (Z2/Z4/Z5/Z6), nowy test „przyciski paneli” (PL/FR, 7 tras) zbiera
każdy przycisk `.btn` w `main`; kontrola ujemna: pigułka z `text-sm` (20 px) nie przechodzi.

Wszystkie pozostałe statusy ✗ w panelach (`oferty-polecane`, `employer/oferty`,
`employer/aplikacje`, `aplikacje/[id]`, `admin`, `admin/firmy/[id]`) wynikają wyłącznie z
pomiaru przy 390 px chrome'u panelu (Z1). Poza Z1 treść paneli i kreatorów nie ma już
rozbieżności stylów względem prototypu.

## Favicon, PWA, OG

| Zasób | Rozmiar | Dominujące kolory | Status |
|---|---|---|---|
| `/og.png` | 1200×630 | #ffffff 93.0%, #d92932 4.2%, #151515 2.3% | ✓ |
| `/icon-512.png` | 512×512 | #d92932 83.9%, #ffffff 13.7%, #000000 1.3% | ✓ |
| `/icon-maskable-512.png` | 512×512 | #d92932 92.4%, #ffffff 7.0%, #fcedee 0.1% | ✓ |
| `/apple-touch-icon.png` | 180×180 | #d92932 84.7%, #ffffff 12.9%, #eea2a6 0.2% | ✓ |
| `/icon.svg` | 64×64 | #d92932 80.5%, #ffffff 10.4%, #000000 0.8% | ✓ |

Wszystkie zasoby = znak z konturów DM Sans 800 na czerwonym `#D92932` z białym „.be” (#510);
favicon prototypu (`#C23D22`, Arial) był szkicem kierunku i nie jest wzorcem.

## Poprawione w tym PR

1. Lista ofert: nagłówek `.p-list-header` (nadtytuł „Oferty pracy”, H1 40/32 px) i wyszukiwarka
   `.people .search` (jeden kontener 17 px, pola bez ramek, fokus = obrys komórki, czerwony przycisk
   58/48 px „Szukaj pracy ↗”) — pozostałość z [#484](https://github.com/aktualnosci-be/pracujbe/pull/484). Formularz GET bez JS bez zmian.
2. Strony treściowe (hub/landing ofert, poradniki, strony informacyjne, zgłoszenie treści):
   wspólny H1 `.pp-page-title` = `.p-list-header h1`.
3. Podstrony pracodawcy: H1 `.people .extended h1` (40/30 px), jak podstrony kandydata.
4. Aktywna pozycja sidebaru paneli: pełne `#fff0f0` (`--pp-side-active-bg`) zamiast
   przezroczystej czerwieni na `#fafafa`; `.eyebrow` paneli z interlinią `normal` (≈ 1,3).
5. Ostatnie ślady starej palety: cień paska CTA szczegółu oferty i baneru zgód (`rgba(15,42,71)`)
   → `--foreground`; font strony bramki hasła Inter → DM Sans; komentarze „granatowy”.
   Strażnik `tests/unit/legacy-palette.test.ts` (hexy, rgb, HSL, Inter; kontrola ujemna).

## Zadania (większe rozbieżności, poza tym PR)

- **Z1 — chrome paneli** (kandydat, pracodawca, admin): prototyp ma nagłówek witryny 95 px
  (logo, „Oferty pracy”, „Dla pracodawców”, „Moje konto”, „Panel pracodawcy”) i w sidebarze kartę
  `.side-person` (inicjały, nazwa, rola); aplikacja — pasek 64 px z dzwonkiem i kontem, logo
  24 px w sidebarze, a ≤ 850 px dolny pasek zakładek (prototyp: poziome menu). Zmiana dotyka
  `DashboardShell`, testów a11y/zoom wszystkich paneli i decyzji #496 — do decyzji właściciela.
- ~~**Z2 — szczegół oferty**~~ — zrobione (pomiar 2026-09-25, style 94% / 89%): `.offer-page`
  (40 px 5%, ≤ 600 px: 25 px), powrót jako `.text-link`, nagłówek `.extended` (nadtytuł
  „kategoria / miasto”, H1 40/30 px, `.dash-intro` z firmą), karta `.job-passport` z metryką,
  treść i firma w `.paper` (h2 23 px, h3 18 px, akapity 15 px / 1,7), panel 300 px
  `.paper.apply-box` („Twój następny krok”, nowe klucze `job.applyBox*`), przyciski `.btn`
  (także w dolnym pasku). Zostają: kotwice sekcji (#3), dopasowanie, kontakt, podobne oferty,
  zgłoszenie DSA, dolny pasek < 1024 px.
- ~~**Z3 — panel filtrów listy**~~ — zrobione (pomiar 2026-09-25): kolumna 190 px (≤ 1050 px:
  165 px, odstęp 32/24 px), linia `--pp-line-data` (#e8e8e8), h3 15 px/700 bez wersalików,
  etykiety 13 px, checkbox 16 px, przełącznik jednostki i „Pokaż N ofert” w geometrii `.btn`.
  Liczniki, wyszukiwarka miejscowości i „Pokaż więcej” zostają (funkcje aplikacji, #188/#216).
  Panel boczny od 1024 px, poniżej — arkusz filtrów (jak dotąd); 200% tekstu = arkusz.
  Strażnik: `prototype-matrix.spec.ts` (4 języki, 1280/1040 px, bez poziomego przewijania).
- ~~**Z4 — strony auth**~~ — zrobione (pomiar 2026-09-25, style 94–95% ✓): layout `(auth)` =
  nagłówek i stopka witryny, strony z `src/components/auth/auth-page.tsx` (H1 `.extended`,
  `.dash-intro`, `.paper.demo-form`, ikona stanu jak `.company-icon`), pola `.demo-form input`,
  przyciski `Button size="passport"` (+ `variant="passportSecondary"`). Przełącznik języka:
  w nagłówku (> 850 px) i w stopce — zachowuje ścieżkę, parametry i `?next=`.
- ~~**Z5 — strona 404**~~ — zrobione (pomiar 2026-09-25): `.p-list-header` z nadtytułem „404”,
  H1 `.pp-page-title` (40/32 px), `.pp-btn` + nowy `.pp-btn-secondary` (`.btn.secondary`,
  linia `--pp-line-btn` #ddd); także globalna 404 poza językami.
- ~~**Z6 — przyciski w panelu admina**~~ — zrobione (pomiar 2026-09-25): filtry list
  (firmy, zgłoszenia, naruszenia, poczta, pytania) = `filterTabClass` (aktywny `.btn`, reszta
  `.btn.secondary`, bez pigułek), akcje w wierszach i dialogu = `BTN_ACTION` (geometria
  `.people .btn`: 14 px/650, 49 px, promień 11 px), szczegół firmy z H1 `.extended`.
  Strażnik: `tests/e2e/prototype-matrix.spec.ts` (style z prototypu + axe, kontrola ujemna
  na pigułce).
