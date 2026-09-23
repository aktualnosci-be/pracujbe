# Wdrożenie produkcji (Railway)

Pracuj.be ma jedną produkcję w Railway. Usługa `pracujbe` w środowisku
`production` śledzi gałąź `main` repozytorium `aktualnosci-be/pracujbe`.
Repozytorium nie ma osobnego workflow wdrożeniowego GitHub Actions.

## Bramka CI

W usłudze Railway musi być włączone natywne **Wait for CI**. Po każdym pushu
do `main` Railway czeka na zakończenie GitHub Actions dla tego commita i wdraża
go wyłącznie po zielonym wyniku. Czerwone, anulowane albo niedokończone CI nie
może uruchomić produkcyjnego wdrożenia.

CI działa w `.github/workflows/ci.yml` na GitHub-hosted runnerach
(`ubuntu-latest`) i obejmuje lint, typecheck, testy jednostkowe, testy
PostgreSQL/RLS, E2E oraz build. Joby niezależne biegną równolegle; build i E2E
startują po zielonym lint/typecheck/unit. Nowy push do PR anuluje nieaktualny
przebieg tego PR, ale przebiegi `main` nigdy nie są anulowane — Railway wdraża
po zielonym CI dla SHA na `main` przez natywne `Wait for CI`; nie uruchamiamy
deployu jako joba Actions.

## Konfiguracja usługi

- środowisko: `production`;
- źródło: repozytorium `aktualnosci-be/pracujbe`, gałąź `main`;
- builder: Railpack, Node 22;
- build: `npm run build`;
- start: `npm run start`;
- healthcheck: `/api/health`;
- wymagane wartości: `APP_MODE=production` i
  `NEXT_PUBLIC_SITE_URL=https://pracuj.be`;
- `PORT` dostarcza Railway;
- do czasu publicznego startu: `SITE_ACCESS_PASSWORD` — każda strona pokazuje
  formularz hasła (503, noindex); po podaniu hasła cookie ważne 30 dni. Zmiana
  hasła unieważnia wydane cookies, usunięcie zmiennej otwiera serwis. `/api/*`
  (health, webhooki) działa bez hasła.

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

## Wersja widoczna w stopce

Każdy build otrzymuje automatyczny identyfikator w formacie
`0.YYYYMMDD.M+SHA`, na przykład `0.20260922.41945987+1e4b285f`.
Data i liczba milisekund od północy są liczone w UTC, a skrócony SHA pochodzi z
`RAILWAY_GIT_COMMIT_SHA` (lokalnie również z `GITHUB_SHA`). Wersja oraz czas
pokazywany obok niej powstają z tego samego momentu. Produkcyjny build Railway
uruchomiony z GitHuba zawsze zawiera SHA; lokalny build bez tych zmiennych ma
samą część liczbową i nadal da się go odróżnić po czasie.

Automatyczne wersje mają zawsze major `0`. Upływ czasu, liczba wdrożeń ani
ukończenie pojedynczego etapu nie mogą samodzielnie utworzyć `1.0.0`.
Wersja `1.0.0` wymaga jawnej decyzji właściciela po odbiorze checklisty
premiery; jej wprowadzenie będzie osobną zmianą w mechanizmie wersjonowania.
Wartość `version` w `package.json` opisuje prywatny pakiet Node i nie jest
numerem wdrożenia widocznym dla użytkownika.
