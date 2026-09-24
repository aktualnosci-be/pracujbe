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

## 3. Strategia renderowania (RSC / SSR / SSG / ISR)

- [ ] Komponenty **domyślnie serwerowe** (RSC); `"use client"` tylko przy interakcji/hookach.
- [ ] Strony publiczne: SSG/ISR gdzie treść stabilna (oferty, kategorie, miasta,
      poradniki) z rewalidacją (ISR) zamiast pełnego SSR na każde żądanie.
- [ ] Szczegóły oferty: statyczne generowanie popularnych + ISR / on-demand revalidation
      przy zmianie oferty.
- [ ] Panele (candidate/employer/admin): SSR + wyspy klienckie (dane per-użytkownik, noindex).
- [ ] Unikaj `dynamic = 'force-dynamic'` tam, gdzie wystarczy ISR.

## 4. Ograniczenie JavaScriptu

- [ ] Minimalny JS na stronach publicznych — logika w RSC, interaktywność w małych
      komponentach klienckich.
- [ ] `optimizePackageImports` dla ikon (`lucide-react`) — już w `next.config.mjs`;
      importuj ikony pojedynczo, nie cały pakiet.
- [ ] Brak ciężkich bibliotek klienckich na stronach publicznych (bez dużych date-pickerów,
      wykresów itp. w bundlu głównym).
- [ ] Analiza bundla (`@next/bundle-analyzer` lub `next build` output) — pilnuj rozmiaru
      największych route'ów.

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

- [x] **Inter** przez `next/font/local` (self-hosted, bez zewnętrznego żądania do Google Fonts).
- [x] Podzbiór (#388): `src/app/fonts/InterVariable-latin.woff2` (~73 KB zamiast 344 KB) —
      Latin, Latin-1, Latin Extended-A, interpunkcja typograficzna, €, ™, strzałki; oś `wght`
      400–700. Przepis: `python3 scripts/subset-font.py` (źródło `assets/fonts/`), strażnik
      `tests/unit/font-subset.test.ts` (≤ 90 KB, każdy znak z `src/messages`).
- [x] `font-display: swap` z fontami zastępczymi o dopasowanych metrykach (#388): grupy Arial/
      Liberation Sans, Roboto (Android), DejaVu Sans (Linux) w `globals.css`, wartości ze
      `scripts/font-fallback-metrics.py`. CLS od podmiany fontu: `/pl` 0,036 → 0, poradnik
      0,069 → 0,016 (Playwright, CPU 4×, 1,6 Mb/s).
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
