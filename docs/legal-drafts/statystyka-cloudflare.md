# PROJEKT — do weryfikacji prawnika, nieopublikowany

> Szkic roboczy do issue #570. Nie jest opinią prawną ani decyzją. Fakty pochodzą z kodu
> (stan na 2026-09-25). Oceny prawne są sformułowane jako pytania. Treść banera, polityki
> prywatności i polityki cookies w UI nie jest tu zmieniana (strony prawne: placeholder + noindex).

| Pole | Wartość |
|---|---|
| Wersja | 0.1 (szkic) |
| Przepływ | statystyka odwiedzin — Cloudflare Web Analytics (beacon JS) |
| Decyzja właściciela | 25.09.2026: Cloudflare Web Analytics zamiast Google Analytics i Meta Pixel |
| Właściciel decyzji prawnych | _do uzupełnienia_ |

## 1. Fakty z kodu

- Beacon `https://static.cloudflareinsights.com/beacon.min.js` jest ładowany
  (`src/components/cookies/Analytics.tsx`) **wyłącznie** gdy:
  - ustawiono token witryny `NEXT_PUBLIC_CF_ANALYTICS_TOKEN` (32 znaki hex),
  - użytkownik zgodził się na kategorię `analytics` w banerze cookies (wersja polityki 2.0),
  - trasa nie jest prywatna (logowanie, rejestracja, linki jednorazowe, panele — `route-policy.ts`).
- Konfiguracja beaconu: `{"token": "...", "spa": true}` — liczone są też przejścia między
  stronami bez przeładowania.
- Kod portalu nie zapisuje w urządzeniu niczego na potrzeby beaconu. Według deklaracji
  dostawcy beacon nie ustawia cookies ani `localStorage` — do potwierdzenia przez właściciela
  na produkcji (odebrane nagłówki i stan przeglądarki).
- Wycofanie zgody: skryptu raz załadowanego w karcie nie da się usunąć, więc kod blokuje jego
  wysyłki (`sendBeacon`/`fetch`/XHR do `cloudflareinsights.com` i `/cdn-cgi/rum`) po sprawdzeniu
  zgody w chwili wysyłki — także gdy zgodę wycofano w innej karcie.
- CSP: `script-src` + `static.cloudflareinsights.com`, `connect-src` + `cloudflareinsights.com`.
  Hosty Google i Meta usunięte.
- Pozostałe cookies `_ga*`, `_gid`, `_gat*`, `_fbp`, `_fbc` z wcześniejszych wizyt są usuwane przy
  każdej synchronizacji zgody.
- Baner pyta tylko o kategorię analityczną (bez „preferencji” i „marketingu” — żadna funkcja ich
  nie używa). Zgody zapisane w wersji 1.0 są nieważne (baner pojawia się ponownie).

## 2. Pytania do prawnika / właściciela

1. Czy beacon bez cookies wymaga zgody (art. 5 ust. 3 ePrivacy / art. 129 belgijskiej ustawy
   o łączności elektronicznej)? Kod przyjmuje wariant ostrożny: tylko po zgodzie.
2. Rola Cloudflare (podmiot przetwarzający?) i umowa DPA; region przetwarzania i transfer poza EOG.
3. Zakres danych zbieranych przez beacon (adres strony, referrer, dane techniczne, adres IP
   połączenia) i retencja po stronie dostawcy.
4. Treść opisu kategorii „Analityczne” w banerze i w polityce cookies (dziś ogólna, bez zmian).
5. Czy liczenie przejść SPA (`spa: true`) mieści się w udzielonej zgodzie.
