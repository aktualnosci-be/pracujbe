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

Eksporter nie przyjmuje danych oferty od operatora — ani pliku JSON, ani flag. Jedynym źródłem jest wąski odczyt `get_campaign_job` (migracja `0102`) przez ograniczony login aplikacji (`DATABASE_APP_URL`) w transakcji gościa `SET LOCAL ROLE anon`. RPC zwraca wyłącznie pola grafiki (slug, tytuł w języku posta, firma, miasto, region, umowa, zakwaterowanie, stawka i okres) i tylko wtedy, gdy oferta ma status `active`, nie jest usunięta, nie wygasła, nie jest demonstracyjna (`is_demo = false` oferty i firmy), a firma jest `verified`. Każdy inny przypadek — także oferta nieistniejąca — daje ten sam komunikat „oferta niedostępna”. Skrypt odrzuca login migratora/superusera (`SET ROLE` nie odbiera mu uprawnień) i nie używa klucza service-role.

Obiekt oferty jest zamrożony i znany tylko modułowi źródła; renderer odrzuca obiekt zbudowany ręcznie, np. `{ ...oferta, isDemo: false }`. Dowód filtrów w bazie: `supabase/tests/rls.sql` sekcja CJ186 (każdy przypadek + kontrola ujemna po zdjęciu każdego filtra). Rollback funkcji: `supabase/rollback/0102_campaign_job_source.down.sql`.

## Układ i walidacja

- Wymagane: tytuł, firma, miasto. Brak którejkolwiek wartości lub znaki sterujące = błąd bez zapisu plików.
- Stawka pojawia się tylko, gdy oferta ma kwotę. Bez stawki nie ma pola wynagrodzenia ani tekstu zastępczego — lokalizacja zajmuje całą kartę.
- Tytuł: dwie linie po 77 px, dłuższy trzy linie po 60 px; dłuższy = błąd przed zapisem. Stawka zmniejsza krój do 40 px, potem błąd. Firma, miasto, region, warunki i adres są mierzone (Arial, canvas Chromium) i skracane z „…”.
- Wszystkie teksty są escapowane w SVG.

Tytuł pochodzi z tłumaczenia wybranego przez `get_campaign_job` (język posta → język domyślny oferty → en), więc może być w innym języku niż etykiety.

Weryfikacja: `npx vitest run tests/unit/job-post-export.test.ts`. Wycofanie: usunięcie skryptu, modułu `scripts/lib/job-post-source.mjs`, testu i tej instrukcji oraz rollback `0102`; eksport nie zmienia danych.
