# Test wdrożeniowy produkcji i odbiór #12

Stan: 25 września 2026.

Kryteria issue względem `main`:
- `APP_MODE` jest jedynym źródłem trybu (`src/lib/env.ts` i nagłówki w `next.config.mjs`; `VERCEL_ENV` ignorowane) — `railway-env.test.ts`, `railway-config.test.ts`.
- Produkcja bez konfiguracji → 503 w middleware i `/api/health` — `readiness-postgres-only.test.ts`.
- Staging (`APP_MODE=production` + adres staging) = gotowy, ale noindex (bez HSTS, `X-Robots-Tag: noindex`, pusty sitemap, `Disallow: /`) — `railway-env.test.ts`, `railway-config.test.ts`, `sitemap-robots.test.ts`.
- Server Actions `6mb` przy limicie CV 5 MB (`CV_MAX_BYTES`, te same reguły w przeglądarce i akcji) — `railway-config.test.ts`, `cv-file-rules.test.ts`.
- `MAINTENANCE_SECRET`, `HEALTH_CHECK_SECRET` i pozostałe zmienne udokumentowane w `.env.example` (bez wartości).
- Anonimowe `/candidate`, `/employer`, `/admin` w produkcji nigdy nie renderują danych demo: gość → logowanie, rola z profilu — `panel-guards-production.test.ts` (4 języki, kontrola ujemna trybu demo).
- Test wdrożeniowy: `SMOKE_BASE_URL=https://pracuj.be HEALTH_CHECK_SECRET=… EXPECTED_SHA=<sha> node scripts/production-smoke.mjs` — tylko odczyt: health `ok` + `mode: production` + wersja z oczekiwanym SHA (szczegóły health mają teraz `version`), panele bez sesji → logowanie w 4 językach, `robots.txt` bez `Disallow: /`, canonical HTTPS. Kontrole ujemne (stan produkcji z 22–23.09: demo, panele demo, stary SHA, robots, canonical localhost) w `production-smoke.test.ts`.

Nie jest to dowód wdrożenia: odbiór produkcji = uruchomienie skryptu po ustawieniu zmiennych i `APP_MODE=production` (decyzja właściciela) i zapisanie wyniku z SHA.
