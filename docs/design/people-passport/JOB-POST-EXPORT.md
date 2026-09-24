# Eksport posta 1080 × 1080 z prawdziwej oferty

Wzór `prototype/materials/social-1080.svg` zawiera fikcyjną ofertę i stawkę — nie jest gotowym materiałem. Post z konkretnej oferty przygotowuje lokalny eksport `scripts/export-job-post.mjs` (#181). Skrypt niczego nie publikuje ani nie wysyła.

## Użycie

```bash
DATABASE_APP_URL="postgresql://…" node scripts/export-job-post.mjs slug-oferty pl output/post
```

- `slug-oferty` — identyfikator z adresu `https://pracuj.be/{język}/oferty-pracy/{slug}`.
- Język: `pl`, `nl`, `fr` albo `en` (etykiety z `src/messages`, stawka jak w portalu — `src/lib/salary.ts`).
- Powstają `output/post.svg` i `output/post.png` (1080 × 1080). PNG jest podglądem — obejrzyj go przed użyciem. SVG zachowuje klikalny odnośnik; w PNG adres trzeba ustawić w miejscu publikacji.
- Chromium: jak w innych eksportach (`PLAYWRIGHT_CHROMIUM_PATH`, `PLAYWRIGHT_BROWSERS_PATH`, `npx playwright install chromium`). Wymagany Node ≥ 22.18 (import modułu `.ts`).

## Skąd są dane (#186)

Eksporter nie przyjmuje danych oferty od operatora — ani pliku JSON, ani flag. Jedynym źródłem jest ten sam publiczny odczyt co w portalu: ograniczony login aplikacji (`DATABASE_APP_URL`), transakcja gościa `SET LOCAL ROLE anon` i RPC `get_public_job`. RPC zwraca ofertę tylko wtedy, gdy ma status `active`, nie jest usunięta ani wygasła, a firma jest `verified`. Oferta nieistniejąca, nieaktywna, wygasła albo niezweryfikowanej firmy daje ten sam komunikat „oferta niedostępna”. Skrypt odrzuca login migratora/superusera (`SET ROLE` nie odbiera mu uprawnień) i nie używa klucza service-role.

Obiekt oferty jest zamrożony i znany tylko modułowi źródła; renderer odrzuca obiekt zbudowany ręcznie, np. `{ ...oferta, isDemo: false }`.

**Ograniczenie:** żaden publiczny odczyt nie ujawnia `is_demo`. Produkcja nie ładuje seeda demo (seed odmawia pracy na bazie z realnymi firmami), ale pełna kontrola `is_demo` po stronie bazy wymaga wąskiego RPC z migracją i rollbackiem — poza zakresem tej zmiany (#186).

## Układ i walidacja

- Wymagane: tytuł, firma, miasto. Brak którejkolwiek wartości lub znaki sterujące = błąd bez zapisu plików.
- Stawka pojawia się tylko, gdy oferta ma kwotę. Bez stawki nie ma pola wynagrodzenia ani tekstu zastępczego — lokalizacja zajmuje całą kartę.
- Tytuł: dwie linie po 77 px, dłuższy trzy linie po 60 px; dłuższy = błąd przed zapisem. Stawka zmniejsza krój do 40 px, potem błąd. Firma, miasto, region, warunki i adres są mierzone (Arial, canvas Chromium) i skracane z „…”.
- Wszystkie teksty są escapowane w SVG.

Tytuł pochodzi z tłumaczenia wybranego przez `get_public_job` (język posta → język domyślny oferty → en), więc może być w innym języku niż etykiety.

Weryfikacja: `npx vitest run tests/unit/job-post-export.test.ts`. Wycofanie: usunięcie skryptu, modułu `scripts/lib/job-post-source.mjs`, testu i tej instrukcji; eksport nie zmienia danych ani schematu bazy.
