# Wdrożenie produkcji (Railway)

Pracuj.be ma jedną produkcję w Railway. Usługa `pracujbe` w środowisku
`production` śledzi gałąź `main` repozytorium `aktualnosci-be/pracujbe`.
Repozytorium nie ma osobnego workflow wdrożeniowego GitHub Actions.

## Bramka CI

W usłudze Railway musi być włączone natywne **Wait for CI**. Po każdym pushu
do `main` Railway czeka na zakończenie GitHub Actions dla tego commita i wdraża
go wyłącznie po zielonym wyniku. Czerwone, anulowane albo niedokończone CI nie
może uruchomić produkcyjnego wdrożenia.

CI działa w `.github/workflows/ci.yml` na self-hosted runnerach i obejmuje
lint, typecheck, testy jednostkowe, testy PostgreSQL/RLS, E2E oraz build.
Automatyczne anulowanie dotyczy tylko kolejnych wersji tego samego Pull Requesta;
przebiegi po pushu do `main` nie są anulowane przez następny push.

## Konfiguracja usługi

- środowisko: `production`;
- źródło: repozytorium `aktualnosci-be/pracujbe`, gałąź `main`;
- builder: Railpack, Node 22;
- build: `npm run build`;
- start: `npm run start`;
- healthcheck: `/api/health`;
- wymagane wartości: `APP_MODE=production` i
  `NEXT_PUBLIC_SITE_URL=https://pracuj.be`;
- `PORT` dostarcza Railway.

Zmienne i sekrety aplikacji przechowuj w Railway, nigdy w repozytorium.
Konfiguracja PostgreSQL, auth, prywatnego bucketu i cronów jest opisana w
[`railway/README.md`](./railway/README.md) i realizowana etapami w issues #23–#27.

## Odbiór wdrożenia

Dla każdego odbieranego wydania zapisz trzy dowody:

1. SHA na `main`;
2. zielony wynik wszystkich wymaganych jobów CI dla tego SHA;
3. udane wdrożenie Railway wskazujące dokładnie ten sam SHA.

Następnie sprawdź `/api/health` i kluczowe ścieżki produktu na
`https://pracuj.be`. Zielone CI samo nie dowodzi wdrożenia, a zielony historyczny
workflow nie zastępuje wyniku Railway.

## Rollback

Rollback aplikacji wykonuje operator w Railway do poprzedniego sprawdzonego
wdrożenia albo przez `git revert` i nowy push do `main`. Nie cofaj destrukcyjnie
produkcyjnej bazy. Zmiany schematu wymagają osobnego, jawnego planu zgodnego z
[`railway/MIGRACJE_POSTGRESQL.md`](./railway/MIGRACJE_POSTGRESQL.md).

Nie uruchamiaj drugiej produkcji w Vercel. `vercel.json` pozostaje przejściowo,
ponieważ istniejące trasy cron są jeszcze migrowane; nie jest konfiguracją
docelowego hostingu.
