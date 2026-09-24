# Eksport baneru kampanii 1200 × 300

Zatwierdzony wzór z `prototype/materials/banner-1200x300.svg` jest materiałem demonstracyjnym. Do przygotowania konkretnej kampanii użyj lokalnego eksportu. Niczego on nie publikuje ani nie wysyła.

1. Zapisz plik JSON z dokładnie czterema polami:

```json
{
  "title": "Pokaż, co potrafisz. Znajdź pracę w Belgii.",
  "cta": "Sprawdź oferty pracy",
  "url": "https://pracuj.be/pl/oferty-pracy?utm_campaign=paszport",
  "campaign": "Paszport pracy 2026"
}
```

2. Przy zainstalowanych zależnościach projektu uruchom:

```bash
node scripts/export-campaign-banner.mjs campaign.json output/banner
```

Powstaną `output/banner.svg` i `output/banner.png` (1200 × 300). Otwórz oba pliki i sprawdź tekst, kontrast oraz rzeczywisty adres przed użyciem. `title` może zajmować najwyżej dwie linie; długość tytułu, CTA i oznaczenia kampanii jest mierzona w Arial, a eksport odrzuca przepełnienie. SVG zachowuje klikalny adres w przycisku, natomiast PNG jest obrazem — adres docelowy trzeba dodatkowo ustawić w miejscu publikacji. Nie należy zakładać, że samo `utm_campaign` oznacza zgodę na śledzenie; zasady cookies portalu nadal obowiązują.

Adres musi używać HTTPS, domeny `pracuj.be` lub `www.pracuj.be` i ścieżki zaczynającej się od jednego z obecnie obsługiwanych języków: `/pl`, `/nl`, `/fr`, `/en`. RO i UK można dodać po wdrożeniu tych ścieżek w portalu. Skrypt odrzuca dane logowania w URL, port, fragment, puste pola i słowa wskazujące na materiały próbne. Służy do kampanii prowadzących do własnego portalu; cel poza tą domeną wymaga osobnej decyzji i zmiany walidacji. Inne formaty pozostają projektami demonstracyjnymi.

Weryfikacja: `npm run verify` i `npx vitest run tests/unit/campaign-banner-export.test.ts`. Przy braku Chromium instalacja przeglądarki Playwright jest wymagana do eksportu PNG. Wycofanie funkcji polega na usunięciu skryptu i tej instrukcji; eksport nie zmienia danych portalu ani bazy.

## Baner z prawdziwej oferty w panelu (#175, dane z #186)

Dla opublikowanej oferty panel pracodawcy ma link „Baner kampanii” (`/employer/oferty/[id]/baner`, noindex). Strona pokazuje podgląd trzech formatów — 1200 × 300, 300 × 250 i 300 × 600 (geometria wzorów z `prototype/materials`) — z przełącznikiem języka baneru (PL/NL/FR/EN). Każdy format można pobrać jako SVG (klikalny przycisk do oferty) albo PNG w dokładnym rozmiarze (rysowany w przeglądarce, bez usług zewnętrznych). Nic nie jest publikowane ani wysyłane.

- **Dane:** wyłącznie RPC `get_managed_campaign_job` (migracja `0102`): slug, tytuł w języku baneru, firma, miasto, rodzaj umowy, zakwaterowanie, stawka. Baza zwraca je tylko dla oferty `active`, nieusuniętej, niewygasłej, niedemonstracyjnej (`is_demo = false` oferty i firmy) firmy `verified` — i tylko recruiter+ tej firmy albo administratorowi. Każdy inny przypadek (także cudza oferta) daje ten sam komunikat „baner niedostępny”. Bez danych osobowych: brak kontaktów, osób i opisu.
- **Endpoint:** `GET /api/employer/jobs/[id]/banner?format=1200x300|300x250|300x600&locale=pl|nl|fr|en[&download=1]` — sesja wymagana (401), limit 60 banerów/h na konto (429), brak danych = 404, tryb demo = 404. Nagłówki: `Cache-Control: private, no-store`, `X-Robots-Tag: noindex`, CSP `default-src 'none'; …; sandbox`, `nosniff`. Administrator (bez członkostwa w firmie) korzysta bezpośrednio z tego adresu.
- **Wygląd:** znak jak `Logo.tsx`, kolory = tokeny `--pp-*` (`BANNER_PALETTE`, strażnik porównuje z `globals.css`), osadzony DM Sans (SIL OFL). Tekst mierzy serwer tablicą szerokości fontu (`src/lib/campaign-banner/metrics.generated.ts`, `python3 scripts/campaign-banner-metrics.py`); za długi tytuł przechodzi na mniejszy krój, potem kończy się „…”. Stawka tylko gdy oferta ją ma. Każdy tekst jest oczyszczany ze znaków sterujących i escapowany; SVG zawiera tylko `svg/title/style/g/rect/line/text/a`.
- **Kod:** `src/lib/campaign-banner/*`, `src/app/api/employer/jobs/[id]/banner/route.ts`, `src/app/[locale]/employer/oferty/[id]/baner/page.tsx`, `src/components/employer/BannerPngButton.tsx`.

Weryfikacja: `tests/unit/campaign-banner*.test.ts`, `tests/unit/banner-png-button.test.tsx`, E2E `tests/e2e/campaign-banner.spec.ts`, `supabase/tests/rls.sql` sekcja CJ186 (`npm run test:rls`). Wycofanie: usunięcie wymienionych plików, linku na liście ofert, kluczy `campaignBanner` w `src/messages` i rollback `supabase/rollback/0102_campaign_job_source.down.sql` (cofa też źródło eksportera posta #181).
