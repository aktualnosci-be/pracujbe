# Audyt: tłumaczenia i testy części publicznej

Zakres: `main` @ f11170e, serwer demo `http://localhost:3100`. Skrypty są w `audit/i18n/`: `panels.js`, `crawl.js`, `interact.js`, `chk.js`, `nf.js`, `scan.js` (AST: literały JSX), `tkeys.js` (użyte `t('…')` a klucze w pl.json).

## Stan ogólny (co jest w porządku)
- `src/messages/{pl,nl,fr,en}.json`: każdy ma 1173 klucze. Żadnego brakującego, żadnej pustej wartości, żadnych polskich znaków diakrytycznych w NL/FR/EN. Wartości identyczne z PL (20 w NL, 17 w FR, 27 w EN) są poprawne: nazwy własne (Leuven, Hasselt, Charleroi, Liège), „Status”, „Transport”, „Standard”, „Menu”, placeholder VAT, `{value}+`. Różnice placeholderów dotyczą tylko ICU plural (`jobs.resultsCount`) i są poprawne.
- Skan AST literałów JSX i atrybutów (`aria-label`/`placeholder`/`alt`/`title`) w `(public)`, `(auth)`, `components/{public,cookies,layout,auth,pwa}`, `not-found`, `error`, `offline`: brak tekstów UI na sztywno. Jedyny wyjątek to `global-error.tsx`, który celowo jest wielojęzyczny i działa bez providera.
- Statyczne sprawdzenie ~1030 wywołań `t('…')`: każdy użyty klucz istnieje (jedyne trafienie to fałszywy alarm z przesłoniętej zmiennej `t` w `(public)/page.tsx`).
- W przeglądarce przeszedłem 27 ścieżek publicznych i auth × 4 języki. Sprawdziłem też: stany po wysłaniu pustych i błędnych formularzy auth, modal aplikowania, baner cookies, puste wyniki na 390 px. Nigdzie nie ma surowych kluczy ani polskiego tekstu w NL/FR/EN. `lang` jest poprawny wszędzie oprócz ustalenia 1.
- Panele w trybie demo: `/{pl,nl,fr,en}/{candidate,employer,admin}` zwracają **200 bez przekierowania** i renderują nagłówek w danym języku („Panel administratora” / „Beheerderspaneel” / „Panneau d'administration” / „Admin panel”). Wszystkie mają `meta robots=noindex, nofollow` oraz nagłówek `X-Robots-Tag: noindex, nofollow, noarchive`. `/pl/admin` w demo **nie** daje 404: przepuszcza i renderuje panel.

---

## 1. [P1] Nieznana ścieżka w segmencie języka pokazuje domyślną angielską stronę 404 Next.js, bez `lang`, nagłówka i linków
- **Kroki:** wejdź na `/nl/bestaat-niet`, `/pl/nie-istnieje`, `/pl/praca/xyz`, `/pl/oferty-pracy/a/b` albo `/en/candidate/xyz` (także `/pl/dashboard`). Dowolny viewport.
- **Obecnie:** HTTP 404, tytuł `404: This page could not be found.`, treść „404 / This page could not be found.”, `<html>` bez atrybutu `lang`, brak nagłówka, stopki i jakiegokolwiek linku (ślepa uliczka). Skrypt `nf.js` zwraca: `{"lang":null,"text":"404\nThis page could not be found.","header":false,"links":0}`.
- **Oczekiwane:** zlokalizowana strona `[locale]/not-found.tsx` („We konden dit niet vinden.” + link „Terug”). Ta strona już istnieje i działa poprawnie, ale tylko dla `notFound()` wywołanego ze slugów (`/oferty-pracy/nie-istnieje-xyz`, `/poradniki/nie-ma`, `/praca/miasto/xyz`).
- **Przyczyna:** w App Routerze `[locale]/not-found.tsx` nie obsługuje ścieżek, które nie pasują do żadnej trasy. Brakuje catch-all.
- **Naruszenia:** Invariant #2 (tekst UI na sztywno po angielsku, tyle że z frameworka), WCAG 3.1.1 (brak języka strony), a do tego ślepa uliczka dla użytkownika z literówką w URL lub ze starym linkiem.
- **Zakres:** wszystkie 4 języki, każda niedopasowana ścieżka pod `/{locale}/…`, także pod panelami.
- **Pliki:** nowy `src/app/[locale]/[...rest]/page.tsx` (`notFound()`; wzorzec next-intl). Ewentualnie `src/app/[locale]/not-found.tsx`, jeśli trzeba dodać `setRequestLocale` lub metadane tytułu. Middleware (`src/middleware.ts`) już przekierowuje `/foo` na `/pl/foo`, więc root `src/app/not-found.tsx` nie jest wymagany.
- **Klucze i18n:** nie są potrzebne (`errors.notFound`, `common.back` istnieją). Opcjonalnie tytuł `<title>` strony 404 z istniejącego klucza.
- **Test regresyjny (e2e):** dla 4 języków `goto('/{l}/nie-ma-takiej-strony')`: status 404, `html[lang={l}]`, H1 = `errors.notFound` z `{l}.json`, widoczny link do strony głównej `/{l}`. Test sprawdza zachowanie, a nie implementację.

## 2. [P2] Issue #121: martwy test `/pl/dashboard` w `seo.spec.ts` (potwierdzam) i luka w pokryciu noindex paneli
- **Stan na main:** `tests/e2e/seo.spec.ts:69-80`. Test `trasa panelu (dashboard) ma noindex, jeśli istnieje` zawsze trafia w `test.skip`, bo `/pl/dashboard` zwraca 404 (potwierdzone w przeglądarce dla 4 języków). Nic nie sprawdza. W `flows.spec.ts` nie ma `/dashboard`; są tam testy `candidate` i `employer`, ale **tylko dla `pl` i bez `admin`**.
- **Po naprawie ustalenia 1** 404 dla `/pl/dashboard` pozostanie 404, a więc test nadal będzie pomijany. Trzeba go usunąć, a nie „naprawić”.
- **Pułapka:** poza produkcją `X-Robots-Tag: noindex` jest ustawiany **globalnie** (`/pl`, `/pl/oferty-pracy`, `/nl/praca` też go mają, a `robots.txt` = `Disallow: /`). Asercja na nagłówku w e2e przejdzie więc zawsze. Rozróżnia tylko `meta[name=robots]`.
- **Pliki:** `tests/e2e/seo.spec.ts` (usuń test 69-80 i punkt 2 z komentarza nagłówkowego) oraz `tests/e2e/flows.spec.ts:58-67` (rozszerz o `admin` i 4 języki).
- **Konflikt z PR #128 (`codex/title-dup-118`):** PR dodaje tylko blok `seoTitles` (linie 20-49) nad komentarzem `Testy SEO`. Symulowałem scalenie przez `git merge-file`: base = main, ours = main bez testu dashboard i bez punktu 2 komentarza, theirs = PR. Wynik to **0 konfliktów**. Gałąź PR jest za `main`, ale to nie wpływa na wynik.
- **Test regresyjny:** pętla `['pl','nl','fr','en'] × ['candidate','employer','admin']`: `meta robots` zawiera `noindex` i widoczny jest H1 lub H2. Do tego **kontrola negatywna**: `/{l}/oferty-pracy` NIE ma `meta robots noindex`, żeby test nie przechodził, gdyby noindex trafił globalnie do layoutu.
- **Klucze i18n:** brak.

## 3. [P2] Test cookies/GA w `smoke.spec.ts` przechodzi zawsze (asercja pusta)
- `tests/e2e/smoke.spec.ts:61-86` sprawdza, że po „Tylko niezbędne” nie ma `script[src*="googletagmanager.com"]` ani `window.gtag`. `src/components/cookies/Analytics.tsx:45` renderuje GA tylko przy `analyticsGranted && GA_ID`, a `NEXT_PUBLIC_GA_MEASUREMENT_ID` nie jest ustawione w `.github/workflows/ci.yml` (job `e2e`). Skrypt nie pojawi się więc **nigdy**, także po „Akceptuj wszystkie”. Test nie wykryje złamania Invariantu #7 (tracking przed zgodą). Dodatkowo asercja po kliknięciu jest wykonywana natychmiast, bez `expect.poll`, więc asynchronicznie wstrzyknięty skrypt i tak by umknął.
- **Pliki:** `tests/e2e/smoke.spec.ts`, ewentualnie `playwright.config.ts` (`webServer.env` z testowym `NEXT_PUBLIC_GA_MEASUREMENT_ID=G-TEST`, co wymaga, żeby build e2e go widział) albo `.github/workflows/ci.yml` (zmienna na etapie builda; poza moim zakresem, do decyzji sesji CI).
- **Szkic:** zbuduj z testowym ID i zablokuj sieć przez `page.route('**/googletagmanager.com/**', r => r.abort())`, rejestrując żądania. Scenariusze: (a) odrzucenie daje 0 żądań do GTM po `waitForTimeout`/`poll`; (b) **kontrola pozytywna**: „Akceptuj wszystkie” daje co najmniej 1 żądanie. Bez (b) test nie dowodzi niczego.
- **Klucze i18n:** brak.

## 4. [P2] Test jednostkowy i18n wykrywa tylko rozbieżność zbiorów kluczy; CLAUDE.md obiecuje więcej
- `tests/unit/i18n-keys.test.ts` sprawdza wyłącznie: niepusty plik, identyczny zbiór kluczy we wszystkich 4 plikach, równą liczbę kluczy. **Nie wykrywa:** (a) kluczy używanych w kodzie, których nie ma w JSON (next-intl pokaże wtedy surowe `namespace.key`), (b) kluczy nieużywanych, (c) pustych wartości, (d) niezgodnych placeholderów ICU (`{count}` itd.), (e) kluczy komunikatów walidacji Zod, które nie istnieją (zob. ustalenie 5). CLAUDE.md, Invariant #2, twierdzi: „Test wykrywa brakujące/nieużywane klucze”, a to jest nieprawda.
- **Pliki:** `tests/unit/i18n-keys.test.ts` (rozszerzenie) lub nowy `tests/unit/i18n-usage.test.ts`. Bazą może być `audit/i18n/tkeys.js`: statyczne mapowanie `useTranslations/getTranslations(ns)` → `t('key')`, z trafnością około 1030/1031. Do tego `CLAUDE.md` (sprostowanie opisu), jeśli nie będzie wykrywania nieużywanych.
- **Test:** niepuste stringi we wszystkich locale; ten sam zbiór nazw argumentów ICU (poza gałęziami plural/select); każdy literał `'<ns>.error.<key>'` w `src/lib/validation/**` istnieje w `pl.json`; każde statycznie wykrywalne `t('…')` istnieje.
- **Klucze i18n:** brak (sam test).

## 5. [P2, utajony] Komunikaty walidacji `application.error.*` (i `offer.error.*`) wskazują na nieistniejące klucze
- `src/lib/validation/application.ts` używa `application.error.{jobRequired,jobInvalid,messageTooLong,phoneInvalid,termsRequired,idempotencyKeyInvalid}`. W `pl.json` nie ma namespace `application` (jest `apply`). To samo dotyczy 9 kluczy `offer.error.*` w `src/lib/validation/offer.ts` (panel, poza zakresem). Dziś nie widać tego w UI, bo `applyToJob` (`src/lib/actions/applications.ts:43-44`) zamienia błąd Zod na `VALIDATION_FAILED`, a `ApplyModal` sam waliduje pola. Wystarczy jednak, że ktoś podepnie schemat pod `zodResolver` w modalu (jak w `AuthForm`), a użytkownik zobaczy surowy `application.error.phoneInvalid`. Klucze `auth.error.*` wszystkie istnieją.
- **Pliki:** `src/lib/validation/application.ts` (przepięcie na `apply.error.*` lub dodanie namespace) i `src/messages/{pl,nl,fr,en}.json` (6 kluczy ×4, jeśli komunikaty mają zostać). Alternatywnie usunięcie martwych komunikatów.
- **Klucze i18n:** tak (lub usunięcie). Test regresyjny: punkt (e) w ustaleniu 4.

## 6. [P2] Strona `/offline` mówi „Coś poszło nie tak” zamiast o braku połączenia
- **Kroki:** `/{l}/offline` (PWA fallback). H1 = `common.error` („Coś poszło nie tak” / „Er ging iets mis” / „Une erreur s'est produite” / „Something went wrong”), a ikona to `WifiOff`. Użytkownik bez sieci nie dowiaduje się, że problemem jest brak połączenia, ani że wystarczy spróbować po jego odzyskaniu. `common.retry` prowadzi do `/`.
- **Zakres:** 4 języki. Powiązane z #76 (cel 48 px dla CTA tej samej strony). Warto poprawić razem, ale #76 dotyczy tylko rozmiaru.
- **Pliki:** `src/app/[locale]/offline/page.tsx`, `src/messages/{pl,nl,fr,en}.json` (nowe klucze np. `offline.title`, `offline.body`).
- **Test:** e2e `/{l}/offline`: H1 równe `offline.title` z JSON danego języka. Lepiej: `context.setOffline(true)` po zarejestrowaniu SW, nawigacja pokazuje stronę offline z tym H1.

## 7. [P2] Strony auth nie mają żadnego nagłówka H1 (tytuł karty to `<div>`)
- `/{l}/{logowanie,rejestracja,rejestracja-pracodawca,reset-hasla,ustaw-nowe-haslo,potwierdzenie}`: `document.querySelector('h1')` zwraca null, bo `CardTitle` w `src/components/ui/card.tsx:30-36` renderuje `<div>`. WCAG 1.3.1 / 2.4.6: czytnik ekranu nie ma nagłówka strony. Możliwy duplikat z sesją a11y. Zgłaszam, bo przy okazji testów wyszło, że `flows.spec` i `a11y.spec` tego nie łapią (axe nie wymaga H1 w tagach WCAG).
- **Pliki:** `src/app/[locale]/(auth)/*/page.tsx` (np. `<CardTitle asChild><h1>…` lub prop `as`), ewentualnie `src/components/ui/card.tsx`.
- **Klucze i18n:** brak.
- **Test:** e2e, 4 języki × strony auth: `getByRole('heading',{level:1})` ma tekst równy tytułowi z JSON (`auth.loginTitle` itd.).

## 8. [P2] Słabe i fałszywie pozytywne asercje w testach e2e stron publicznych
- `tests/e2e/flows.spec.ts:54-55`: `expect(await applyCta.count()).toBeGreaterThan(0)` liczy też ukryte przyciski i nie czeka (snapshot bez auto-retry). Szablon: `await expect(applyCta.first()).toBeVisible()`.
- `tests/e2e/smoke.spec.ts:57-58`: to samo dla linków ofert (`count()` bez oczekiwania).
- `tests/e2e/flows.spec.ts:31-41`: przełączanie języka testowane tylko dla pl→nl i tylko na liście ofert. Brak sprawdzenia `html[lang]` po przełączeniu i brak ścieżki dynamicznej (szczegół oferty lub poradnik, gdzie slug musi zostać zachowany).
- `tests/e2e/seo.spec.ts:39-67`: JSON-LD JobPosting i `lang` sprawdzane tylko dla `pl`.
- **Pokrycie 4 języków:** istnieje dla hero (`flows`), OG image (`seo`), a11y listy ofert na 320 px i PWA manifest. **Brakuje** testu, który w NL/FR/EN przechodzi kluczowe strony publiczne i odrzuca surowe klucze (`/\b[a-z]+\.[a-z]\w+\b/` w `innerText`) oraz tekst PL. Wzorzec: `audit/i18n/crawl.js`. Dziś wszystko przechodzi, więc byłaby to czysta straż regresji.
- **Pliki:** `tests/e2e/flows.spec.ts`, `tests/e2e/smoke.spec.ts`, `tests/e2e/seo.spec.ts`, ewentualnie nowy `tests/e2e/i18n-public.spec.ts`.

## Potwierdzenia i odnośniki do znanych issues
- **#118 / PR #128:** potwierdzam, że podwójna marka występuje też poza `/praca` i `/poradniki`: `…/praca/kategoria/*`, `…/praca/miasto/*` („Bouw vacatures in België | Pracuj.be · Pracuj.be”) oraz strona główna („Pracuj.be — Praca w Belgii bez CV · Pracuj.be”). **PR #128 zmienia tylko `praca/page.tsx` i `poradniki/page.tsx`**, więc kategorie, miasta i strona główna nadal będą miały dwie marki (pliki: `src/app/[locale]/(public)/praca/kategoria/[category]/page.tsx`, `…/praca/miasto/[city]/page.tsx`, `src/app/[locale]/(public)/page.tsx` lub klucze `metadata.homeTitle` / `landing.*` w `src/messages/*.json`). Warto dopisać to do #118.
- **#76:** dotyczy tej samej strony co ustalenie 6. Rozmiaru CTA nie mierzyłem.
