# CSP: co blokowałaby polityka nonce / `strict-dynamic` (#585)

> Analiza bez zmian polityki produkcyjnej. Egzekwowana CSP w `next.config.mjs` zostaje
> taka, jaka jest (`script-src 'self' 'unsafe-inline' …`). PR #634 dokłada równoległy
> `Content-Security-Policy-Report-Only` z hashami — ten dokument go nie dotyka i opisuje,
> czego brakuje do **wymuszającej** polityki z nonce i `'strict-dynamic'`.

## 1. Metoda

- Build produkcyjny z `main` (f1302f8, Next.js 15.5.24) z testowym tokenem Cloudflare Web
  Analytics — tym samym co w jobie `E2E (Playwright)` (`playwright.config.ts`), `next start`
  w trybie demo (bez bazy).
- Pomiar: `node scripts/security/csp-inline-inventory.mjs` (poza CI). Skrypt dokłada do każdej
  odpowiedzi dokumentu `Content-Security-Policy-Report-Only` z polityką docelową:

  ```
  script-src 'nonce-csp-inventory' 'strict-dynamic' 'report-sample';
  style-src 'self' 'nonce-csp-inventory' 'report-sample'
  ```

  Aplikacja tego nonce nie zna, więc każde zgłoszenie to element, który trzeba objąć nonce,
  hashem albo przepisać. Nic nie jest blokowane (Report-Only), więc skrypty wstawiane po
  hydratacji też się wykonują i są mierzone. Wynik zawiera tylko rodzaj, liczbę, bajty i liczbę
  różnych skrótów — bez treści skryptów.
- 26 tras w `pl`, te same rodziny co bramki a11y w E2E (`a11y-public-routes`, `panel-a11y`,
  `admin-a11y`): strona główna, lista i szczegół oferty, landingi, poradniki, strony treściowe,
  auth, 404, offline, panele kandydata/pracodawcy/admina. Na każdej stronie klik „Akceptuj
  wszystkie” (beacon analityki po zgodzie); na liście ofert przy 390 px także „Filtry”.

## 2. Skrypty (`script-src`)

| # | Źródło | Gdzie w kodzie | Zmierzone | Blokowane przez nonce + `strict-dynamic`? | Jak objąć |
|---|---|---|---|---|---|
| S1 | Zewnętrzne chunki `/_next/static/chunks/*.js` wstawiane przez parser | Next.js (App Router) | każda strona, do 27 na stronę, 516 zgłoszeń | **Tak.** Przy `'strict-dynamic'` przeglądarka ignoruje `'self'` i hosty, a skrypty z parsera muszą mieć nonce. | Next dokłada nonce do własnych `<script>`, gdy middleware przekaże nonce w nagłówku żądania. Wymaga renderowania per żądanie (§4). |
| S2 | Inline ładunek RSC `self.__next_f.push(…)` | Next.js | 911 skryptów na 26 stronach, do 66 na stronę, ~5,3 MB | **Tak** (981 zgłoszeń inline razem z S3/S4). | Tylko nonce od Next (jak S1). **Hash niemożliwy:** każdy z 911 skryptów miał inny skrót — treść zależy od strony, danych i rewalidacji. |
| S3 | Inline React/Next przy streamingu: `$RC`/`$RS`/`$RT`, przeniesienie `link[rel=icon]` do `<head>` | Next.js / React | 45 skryptów na 11 stronach renderowanych dynamicznie (panele, auth, lista ofert, 404) | **Tak.** | Nonce od Next (jak S1). |
| S4 | Skrypt banera zgód w `<head>` (`consentBootScript()`) | `src/lib/consent-boot.ts`, `src/app/[locale]/layout.tsx` | 1 na każdej stronie, ~430 B | **Tak.** | Treść stała w obrębie buildu (zależy tylko od `CONSENT_POLICY_VERSION`) → **hash działa** (tak robi Report-Only z #634). Albo `nonce` z nagłówka żądania. |
| S5 | JSON-LD (`type="application/ld+json"`) | strony ofert, landingi, poradniki, pomoc, dla pracodawców, `HomeFaq` | 8 bloków na 7 stronach | **Nie.** Blok danych nie jest wykonywany, więc `script-src` go nie obejmuje. | Nic. |
| S6 | Beacon Cloudflare Web Analytics (`next/script`, po zgodzie) | `src/components/cookies/Analytics.tsx` | ładowany po zgodzie, **0 zgłoszeń** | **Nie**, pod warunkiem że S1 ma nonce: skrypt wstawia runtime Next, a `'strict-dynamic'` przenosi zaufanie. | Nic poza S1. Host `static.cloudflareinsights.com` zostaje w `script-src` tylko dla przeglądarek bez `'strict-dynamic'`. |
| S7 | Widżet Turnstile (`api.js`) | `src/components/auth/TurnstileWidget.tsx` (`document.createElement('script')`) | niezmierzone (tryb demo bez kluczy) | Z kodu: **nie**, jak S6 (skrypt wstawiany z zaufanego chunku). | Sprawdzić na środowisku z kluczami przed włączeniem polityki. |

Wniosek dla skryptów: wszystko poza S4 to kod Next.js/React, który da się objąć tylko nonce
nadawanym **per żądanie**. S4 da się objąć hashem.

## 3. Style (`style-src` bez `'unsafe-inline'`)

| # | Źródło | Gdzie | Zmierzone | Uwagi |
|---|---|---|---|---|
| Y1 | Atrybuty `style="…"` w HTML z serwera | `next/image` (`color:transparent`, pozycjonowanie `fill`), paski postępu `style={{ width }}` (`src/components/ui/match-bar.tsx`, `src/components/employer/RecruitmentFunnel.tsx`, `src/components/candidate/ProfileCompleteness.tsx`), `src/app/global-error.tsx` | 45 zgłoszeń na 9 stronach, do 20 na stronę | **Nonce nie obejmuje atrybutów.** Potrzebne `'unsafe-hashes'` z hashem każdej wartości (szerokość paska jest zmienna, więc niepraktyczne), przepisanie na klasy albo zmienne CSS ustawiane przez CSSOM, albo zostawienie `'unsafe-inline'` tylko w `style-src`. |
| Y2 | Styl ustawiany z JS przez CSSOM (`--cookie-banner-h` na `<html>`, `next-route-announcer`) | `CookieConsent`, Next.js | obecne na każdej stronie, **0 zgłoszeń** | CSSOM (`el.style.x = …`) nie podlega CSP. Nic do zrobienia. |
| Y3 | `<style>` w `<noscript>` | `NOSCRIPT_HIDE_BANNER` (`src/lib/consent-boot.ts`), `FilterSheet` (ukrycie przycisku filtrów bez JS) | działa tylko bez JS (pomiar z JS go nie widzi) | CSP obowiązuje także bez JS: bez nonce/hash te reguły przestaną działać i bez JS baner oraz przycisk filtrów będą widoczne. Treść stała → wystarczy hash albo nonce. |
| Y4 | `<style>` renderowane w czasie działania | — | 0 na zmierzonych trasach (także z otwartym arkuszem filtrów) | Brak. |

Szablony e-maili (`src/emails`) mają style inline z założenia, ale CSP ich nie dotyczy (nie są
stronami serwisu).

## 4. Warianty

| Wariant | Co daje | Koszt / ryzyko |
|---|---|---|
| **A. Nonce per żądanie na całym serwisie** (middleware generuje nonce, Next dokłada go do S1–S3, layout do S4) | Pełna polityka `'strict-dynamic'` dla skryptów. | Każda strona renderowana per żądanie — koniec ISR/statycznych stron publicznych (#298), własnego `cacheHandler`, trafień `x-nextjs-cache` (E2E `public-cache-headers`), strażnika `static-public-pages.test` i budżetów CWV (#395). Regres wydajności na stronach z największym ruchem. |
| **B. Hashe zamiast nonce** | Działa dla S4 i Y3. | Nie działa dla S2/S3 (911 różnych skrótów na 26 stronach) ani S1 bez nonce. Sam wariant B nie usuwa `'unsafe-inline'`. |
| **C. Hybryda: nonce tylko na trasach już dynamicznych** (panele `candidate`/`employer`/`admin`, auth — `force-dynamic`, `noindex`), strony publiczne ISR bez zmian | Wymuszająca polityka tam, gdzie są dane osobowe i sesja, bez ruszania cache stron publicznych. | Dwie polityki (middleware wybiera po ścieżce), osobne testy; strony publiczne dalej z `'unsafe-inline'` w `script-src`. Y1 w panelach (paski postępu) do przepisania albo `'unsafe-inline'` w samym `style-src`. |
| **D. Obecny stan + Report-Only (#634)** | Zero ryzyka regresji, raporty na `/api/csp-report`. | Nic nie jest blokowane. |

Wybór wariantu to decyzja właściciela (koszt ISR w A, dwie polityki w C). Ten dokument niczego
nie przesądza i nie zmienia `next.config.mjs`.

Kroki techniczne wspólne dla A i C (do zrobienia dopiero po decyzji):

1. Middleware: losowy nonce na żądanie, nagłówek `Content-Security-Policy` z
   `'nonce-…' 'strict-dynamic'` na odpowiedzi i w nagłówkach żądania, żeby Next dołożył nonce
   do S1–S3.
2. `src/app/[locale]/layout.tsx`: `nonce` na skrypcie banera (S4) i na `<noscript><style>` (Y3),
   albo hash obu w polityce.
3. `FilterSheet`: nonce/hash dla `<noscript><style>` albo przeniesienie reguły do arkusza CSS.
4. Y1: paski postępu przez klasę + zmienną CSS ustawianą w efekcie klienta, albo
   `'unsafe-inline'` tylko w `style-src`.
5. Najpierw Report-Only z docelową polityką na produkcji (`/api/csp-report`), potem
   wymuszenie; E2E z polityką wymuszającą na zmienionych trasach.

## 5. Powtórzenie pomiaru

```bash
NEXT_PUBLIC_CF_WEB_ANALYTICS_TOKEN=e2e-cf-analytics-token-00000000 npm run build
npx next start -p 3000 &
PLAYWRIGHT_CHROMIUM_PATH=/opt/pw-browsers/chromium \
  node scripts/security/csp-inline-inventory.mjs --out csp-inventory.json
```

Liczby w §2–§3 pochodzą z przebiegu 2026-09-25 na f1302f8. Klasyfikację skryptów i parsowanie
zgłoszeń pilnuje `tests/unit/csp-inline-inventory.test.ts`.

**Ograniczenia pomiaru:** jeden język (`pl`), tryb demo (bez sesji i bazy), Turnstile bez kluczy
(S7 niezmierzony), strony błędu (`global-error`) tylko z kodu.
