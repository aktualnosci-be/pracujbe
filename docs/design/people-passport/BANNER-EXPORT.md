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
