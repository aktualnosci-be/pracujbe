# Checklista wydajności

Checklista wg sekcji 4 specyfikacji: cele Lighthouse, Core Web Vitals, strategia
renderowania (RSC/SSR/SSG), obrazy (WebP/AVIF), ograniczenie JS, code splitting, fonty.

Konfiguracja bazowa jest w `next.config.mjs` (obrazy AVIF/WebP, `optimizePackageImports`)
— nie modyfikuj tego pliku.

Legenda: `[ ]` do sprawdzenia · `[x]` potwierdzone.

---

## 1. Cele Lighthouse (mobile, produkcja)

| kategoria | cel |
|---|---|
| Performance | ≥ 90 |
| Accessibility | ≥ 95 (WCAG 2.2 AA) |
| Best Practices | ≥ 95 |
| SEO | ≥ 95 |

- [ ] Audyt Lighthouse (mobile + desktop) na kluczowych stronach: główna, lista ofert,
      szczegóły oferty, kategoria, miasto.
- [ ] Audyt w trybie produkcyjnym (`npm run build && npm run start`), nie dev.

## 2. Core Web Vitals (dane polowe)

| metryka | cel (dobry) |
|---|---|
| LCP (Largest Contentful Paint) | < 2,5 s |
| INP (Interaction to Next Paint) | < 200 ms |
| CLS (Cumulative Layout Shift) | < 0,1 |
| TTFB | < 0,8 s |

- [ ] Monitoring CWV w produkcji (Vercel Analytics / Web Vitals + Sentry).
- [ ] LCP: element LCP na stronach ofert to tekst/obraz nad linią zgięcia — priorytetyzuj.
- [ ] CLS: rezerwuj wymiary obrazów i kontenerów (brak przeskoków layoutu).
- [ ] INP: minimalizuj JS wykonywany przy interakcji; wyspy klienckie tylko tam gdzie trzeba.
- [x] INP dialogów: `src/components/ui/light-dialog.tsx` zamiast trybu `modal` Radix — bez
      arkusza w `<head>` i `pointer-events` na `<body>` przy otwarciu (#393; pilnuje
      `tests/e2e/dialog-open-cost.spec.ts`). Nowy dialog modalny buduj na `LightDialog*`.
      Otwarcie w dwóch ramkach: w ramce tapnięcia rysuje się tylko nakładka, a Root Radix
      dostaje `open` w osobnym zadaniu zaraz po niej (nie transition — ta czekałaby na
      trwającą nawigację); zamknięcie od razu
      (CPU 4×, 412 px: „Aplikuj” 104→64 ms, menu 128→56 ms; pilnuje
      `tests/e2e/dialog-open-inp.spec.ts`, próg 200 ms).

## 3. Strategia renderowania (RSC / SSR / SSG / ISR)

- [ ] Komponenty **domyślnie serwerowe** (RSC); `"use client"` tylko przy interakcji/hookach.
- [ ] Strony publiczne: SSG/ISR gdzie treść stabilna (oferty, kategorie, miasta,
      poradniki) z rewalidacją (ISR) zamiast pełnego SSR na każde żądanie.
- [ ] Szczegóły oferty: statyczne generowanie popularnych + ISR / on-demand revalidation
      przy zmianie oferty.
- [ ] Panele (candidate/employer/admin): SSR + wyspy klienckie (dane per-użytkownik, noindex).
- [ ] Unikaj `dynamic = 'force-dynamic'` tam, gdzie wystarczy ISR.
- [x] Cache ISR z limitem (#298): własny `cacheHandler` (`src/lib/cache/isr-cache-handler.mjs`) —
      LRU w pamięci, 404 losowych slugów tylko krótko w pamięci (nigdy na dysku), wpisy runtime
      w `.next/cache/isr-handler` z limitem wpisów i bajtów. Limity: `DEFAULT_LIMITS` w pliku handlera.

## 4. Ograniczenie JavaScriptu

- [ ] Minimalny JS na stronach publicznych — logika w RSC, interaktywność w małych
      komponentach klienckich.
- [ ] `optimizePackageImports` dla ikon (`lucide-react`) — już w `next.config.mjs`;
      importuj ikony pojedynczo, nie cały pakiet.
- [ ] Brak ciężkich bibliotek klienckich na stronach publicznych (bez dużych date-pickerów,
      wykresów itp. w bundlu głównym).
- [x] Rozmiar JS kluczowych tras pilnowany w CI (budżet gzip, §10, #395).

## 5. Code splitting / lazy loading

- [ ] `next/dynamic` dla ciężkich, rzadko używanych komponentów klienckich (modale,
      edytory, mapy) — ładowane na żądanie.
- [ ] Komponenty poniżej linii zgięcia ładowane leniwie gdzie to sensowne.
- [ ] Trzeci-party skrypty (analytics) — ładowane **po zgodzie** i z `next/script`
      strategią `afterInteractive`/`lazyOnload` (spójne z Invariant #7).

## 6. Obrazy (WebP / AVIF)

- [ ] Używaj `next/image` — automatyczne AVIF/WebP (formaty w `next.config.mjs`).
- [ ] `sizes` ustawione poprawnie dla responsywności (nie serwuj obrazu desktop na mobile).
- [ ] `priority` tylko dla obrazu LCP; reszta lazy (domyślne).
- [ ] Wymiary (`width`/`height` lub `fill` + kontener) rezerwują miejsce (CLS = 0).
- [ ] Logotypy firm z Supabase Storage (`*.supabase.co` w `remotePatterns`) —
      rozsądne rozmiary źródłowe.

## 7. Fonty

- [x] **DM Sans** (krój prototypu „Ludzie i praca”, #5/#7; wcześniej Inter) przez
      `next/font/local` (self-hosted, bez zewnętrznego żądania do Google Fonts). Licencja SIL OFL 1.1,
      tekst w `assets/fonts/DMSans-OFL.txt`.
- [x] Podzbiór (#388): `src/app/fonts/DMSans-latin.woff2` (~42 KB; Inter miał ~73 KB) —
      Latin, Latin-1, Latin Extended-A, interpunkcja typograficzna, €, ™, strzałki; oś `wght`
      400–800, oś opsz 9–40 (strony w stylu prototypu: opsz 9 przez `font-optical-sizing: none`). Przepis:
      `python3 scripts/subset-font.py` (źródło `assets/fonts/`), strażnik
      `tests/unit/font-subset.test.ts` (≤ 60 KB, każdy znak z `src/messages`).
- [x] `font-display: swap` z fontami zastępczymi o dopasowanych metrykach (#388): grupy Arial/
      Liberation Sans, Roboto (Android), DejaVu Sans (Linux) w `globals.css`, wartości ze
      `scripts/font-fallback-metrics.py` (przeliczone dla DM Sans, wght 400 / opsz 9). CLS od
      podmiany fontu (Inter): `/pl` 0,036 → 0, poradnik 0,069 → 0,016; po zmianie na DM Sans
      lab `perf-lab.mjs` — CLS 0,000 na wszystkich trasach (poradnik 0,030 → 0,000 na tej samej
      maszynie).
- [x] Maksymalnie 1–2 rodziny fontów (obecnie jedna).
- [x] Preload dla podstawowej wagi używanej nad linią zgięcia (`next/font`, jeden plik).

Baner zgód a LCP (#389): baner jest w HTML z serwera (maluje się z FCP), a powracającemu
użytkownikowi ukrywa go przed pierwszym malowaniem skrypt z `src/lib/consent-boot.ts`
(`data-consent` na `<html>`). LCP pierwszej wizyty na liście ofert, detalu, logowaniu
i panelach: ~2,0–2,4 s → 0,64–0,86 s. Strażnik: `tests/e2e/first-visit-lcp.spec.ts`.

## 8. Sieć / cache / dostarczanie

- [ ] Statyczne assety z długim cache (immutable) — obsługuje Vercel/Next automatycznie.
- [x] Obrazy i pliki `public/`: `images.minimumCacheTTL` 31 dni; `public/images/*`, ikony
      i `og.png` — `max-age=86400, stale-while-revalidate=604800` (bez `immutable`, brak hasha
      w nazwie); `sw.js` bez długiego cache (#394, `tests/e2e/static-asset-cache.spec.ts`).
      Zmieniony obraz w `public/` = nowa nazwa pliku.
- [ ] ISR / rewalidacja zamiast odpytywania DB na każde żądanie strony publicznej.
- [ ] Zapytania do Supabase: selekcja tylko potrzebnych kolumn, użycie indeksów pod filtry
      ofert (już zdefiniowane: `idx_jobs_active_feed`, trigramy na tytułach itd.).
- [ ] Paginacja list ofert (nie ładuj wszystkiego naraz).
- [ ] Kompresja (Brotli/gzip) — Vercel domyślnie.

## 9. Dostępność (wpływa na SEO/UX)

- [ ] Kontrast WCAG 2.2 AA (tokeny kolorów już dobrane).
- [ ] Nawigacja klawiaturą, widoczny focus, etykiety pól, `aria-*` gdzie potrzebne.
- [ ] Struktura nagłówków (h1→h6) i landmarki.
- [ ] `html lang` ustawiany per locale.

## 10. Bramka wydajności w CI (#395)

Dwa kroki w istniejących jobach (bez nowego joba, drugiego builda i instalacji przeglądarki).
Budżety i progi są w jednym pliku [`perf-budgets.json`](../perf-budgets.json) — zmiana
budżetu to świadomy diff w PR z uzasadnieniem. Obie tabele trafiają do podsumowania
przebiegu (`$GITHUB_STEP_SUMMARY`), razem z tabelą INP-proxy.

**`Build (Next.js)` → „Performance budget (static)”** — `node scripts/perf-budget-static.mjs`
(~1 s, po `check-next-build.mjs`). JS (gzip) trasy = wszystkie pliki `.js` z
`.next/app-build-manifest.json` dla layoutów od korzenia i samej strony (to, co pobiera
przeglądarka; więcej niż „First Load JS” z tabeli `next build`, która nie dolicza layoutów).
Fonty: każdy `.next/static/media/*.woff2` i ich suma. Zod w JS stron publicznych (#390)
pilnuje dalej `check-next-build.mjs`.

| zasób | stan main 2026-09-24 | budżet |
|---|---|---|
| JS `/[locale]/(public)/page` (home) | 164,5 KB | 173 KB |
| JS `/[locale]/(public)/oferty-pracy/page` | 166,4 KB | 175 KB |
| JS `/[locale]/(public)/oferty-pracy/[slug]/page` | 228,9 KB | 244 KB¹ (#576: przedziały wieku w formularzu gościa +1 KB) |
| JS `/[locale]/(public)/poradniki/[slug]/page` | 154,0 KB | 162 KB |
| JS `/[locale]/(auth)/logowanie/page` | 184,8 KB | 194 KB |
| font (jeden plik / razem) | 72,8 KB | 100 KB / 150 KB |

¹ 241 → 243 KB (#575, 2026-09-25): main urósł do ok. 240 KB, a lejek ofert dostał bramkę zgody
analitycznej (odczyt cookie tuż przed wysyłką, kolejka zdarzeń do decyzji) — ok. 1 KB JS na
stronie oferty, wymóg decyzji właściciela (ePrivacy). Odczyt zgody bez Server Action i store'u
banera (`src/lib/consent-cookie.ts`), więc nie ciągnie dodatkowych modułów.

Budżet JS = stan + ok. 5%: aktualizacja zależności mieści się, nowa biblioteka kliencka
w layoucie publicznym już nie (kontrola ujemna w `tests/unit/perf-budget.test.ts`).

**`E2E (Playwright)` → „Performance budget (lab CWV)”** — `node scripts/perf-lab.mjs`
(~2–2,5 min z INP-proxy, po testach E2E, na tym samym buildzie i Chromium co Playwright; własny
`next start` na porcie 3100). Strony: `/pl`, `/pl/oferty-pracy`, pierwsza oferta z listy,
pierwszy poradnik, `/pl/logowanie` × {pierwsza wizyta, z zapisaną zgodą} × 3 próby
w świeżym kontekście, przeplatane runda po rundzie; liczy się **mediana**. Warunki: CPU 4×
(CDP), 1,6 Mb/s / 750 kb/s, RTT 150 ms, 412×823 (mobile, DPR 2), żądania spoza serwera
zablokowane. Metryki obserwowane (`PerformanceObserver`), nie symulacja Lighthouse: LCP
(ostatni kandydat), CLS (największe okno sesji, bez `hadRecentInput`), TBT (część long tasków
po FCP ponad 50 ms). Okno obserwacji: do 1 s bez nowego wpisu (LCP, long task, przesunięcie),
co najmniej 3 s od nawigacji, najwyżej 8 s — łapie treść dorysowaną po `load` (kontrola ujemna:
`<main>` ukryty do 800 ms po hydratacji → LCP ~3,2 s, krok czerwony). Wynik w JSON: `playwright-report/perf-lab.json`
(artefakt tylko przy porażce joba).

| metryka (mediana) | próg | lokalnie (main, 3 przebiegi) |
|---|---|---|
| LCP, pierwsza wizyta | 1 500 ms | 612–848 ms |
| LCP, z zapisaną zgodą | 1 500 ms | 612–836 ms |
| CLS | 0,05 | 0–0,001 |
| TBT | 400 ms | 104–266 ms |
| INP-proxy (filtry / zapis oferty / ApplyModal) | 200 ms (próg „dobrego” INP) | 32–112 ms (main 2026-09-25, 2 przebiegi) |

**INP-proxy** (ten sam krok i ten sam `next start`, próby przeplatane z pomiarem stron) —
czas reakcji na tapnięcie w tych samych warunkach (CPU 4×, 412×823, dotyk), z zapisaną zgodą
(baner nie zasłania wyzwalaczy), 3 próby w świeżym kontekście, **mediana** vs `lab.thresholds.inpMs`:

| interakcja | strona | wyzwalacz → oczekiwany skutek |
|---|---|---|
| otwarcie filtrów | `/pl/oferty-pracy` | „Filtry” (`FilterSheet`) → arkusz filtrów |
| zapis oferty | `/pl/oferty-pracy` | zakładka pierwszej karty (`.pp-save`) → `aria-pressed="true"` |
| otwarcie ApplyModal | pierwsza oferta z listy | „Aplikuj teraz” w dolnym pasku → `role="dialog"` |

Pomiar: `PerformanceObserver` typu `event` (Event Timing, `durationThreshold` 16 ms) od
załadowania strony; po tapnięciu (Playwright `tap`, pointer + touch + click) i pojawieniu się
skutku czekamy na wpis `click`. Czas interakcji = najdłuższy wpis z tym samym `interactionId`
(jak INP w Chromium: od wejścia do następnego malowania, z przetwarzaniem handlerów),
`scripts/lib/perf-budget.mjs` → `inpFromEventEntries`. Brak wpisów = poniżej 16 ms (0). To proxy,
nie INP polowy: jedna interakcja na stronę, bez historii i bez 98. percentyla.

Zapis oferty w CI nie ma sesji kandydata (build bez bazy → przycisk „niedostępne”, wyłączony),
więc skrypt podmienia odpowiedź akcji odczytu stanu (`getPublicSavedJobs`,
`{"status":"unavailable"}` → kandydat bez zapisanych). Mierzone jest tapnięcie —
optymistyczne przełączenie i render kart; sam zapis (`toggleSavedJob`) odpowiada później
i nie wchodzi w czas interakcji. Brak podmiany albo brak skutku tapnięcia = błąd kroku, nie
zielony wynik.

Kontrola ujemna: `--inject-click-delay-ms 300` dodaje blokujący listener kliknięcia (faza
przechwytywania — to samo zadanie co handler Reacta, jak ciężki handler w komponencie).
Wynik lokalny: 344–376 ms we wszystkich trzech interakcjach, krok czerwony (kod 1). Test
jednostkowy tej samej reguły w `tests/unit/perf-budget.test.ts`.

Progi są granicą regresji z zapasem na rozrzut hostowanych runnerów, a nie celem (cele polowe
w §2). Próg przekroczony → komunikat z nazwą strony, medianą i wartościami każdej próby.

Lokalnie (po `npm run build`):

```bash
node scripts/perf-budget-static.mjs
PLAYWRIGHT_CHROMIUM_PATH=/opt/pw-browsers/chromium node scripts/perf-lab.mjs   # własny next start :3100
node scripts/perf-lab.mjs --base http://localhost:3000                         # istniejący serwer
node scripts/perf-lab.mjs --runs 5 --out /tmp/perf-lab.json
node scripts/perf-lab.mjs --interactions-only --inject-click-delay-ms 300           # kontrola ujemna INP → kod 1
```

---

## Proces audytu

```bash
npm run build && npm run start        # tryb produkcyjny lokalnie
# Lighthouse (Chrome DevTools lub CLI) na: /, /{locale}/jobs, /{locale}/jobs/<slug>
npx lighthouse http://localhost:3000/pl --preset=desktop --view
```

- [ ] Audyt przed każdym większym wdrożeniem i po zmianach dotykających stron publicznych.
- [ ] Regresje CWV monitorowane w produkcji (dane polowe > lab).

---

## Powiązane

- [`ARCHITECTURE.md`](./ARCHITECTURE.md) §1 (warstwy renderowania) ·
  [`LAUNCH_CHECKLIST.md`](./LAUNCH_CHECKLIST.md).
</content>
