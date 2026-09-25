# Telemetria bez danych kandydata (#502)

Dane osobowe usuwamy **w aplikacji, przed wysłaniem** — redakcja po stronie usługi działa
dopiero po transmisji.

## Kanały i filtr

| Kanał | Stan w kodzie | Ochrona |
|---|---|---|
| Webhook błędów Discorda (#571, `src/lib/error-webhook/`, rejestrowany w `register()` w `src/instrumentation.ts`) | aktywny tylko z poprawną `ERROR_WEBHOOK_URL` (https, `discord.com`/`discordapp.com`, `/api/webhooks/<id>/<token>[/slack]`); pusta = brak wysyłki, `/api/health` `checks.errorWebhook=false` | wiadomość budowana od zera: kod z `ErrorCodes` (inaczej `INTERNAL`), trasa przez `redactUrl` (bez query/fragmentu, bez segmentów z danymi; `onRequestError` daje szablon trasy), wydanie, środowisko, czas; limit 2000 znaków |
| `captureError` (`src/lib/error-report.ts`) i `onRequestError` | serwer: przez zarejestrowany reporter; przeglądarka: no-op (reporter nie istnieje, adres nie trafia do bundla) | do reportera trafia tylko kod — bez wyjątku, `cause` i kontekstu |
| Logi serwera (stdout/stderr → Railway) | zawsze poza `next dev` | `installConsoleRedaction()` w `register()` — reguły z `src/lib/privacy/redact.ts` |

## Reguły redakcji logów (`src/lib/privacy/redact.ts`)

- Wartości: e-mail, telefon (BE i międzynarodowy), NISS/BIS, IBAN, JWT, `Bearer`, pary
  `token=`/`secret=`/`password=`…, długie tokeny (UUID zostają), nazwy plików dokumentów,
  wiersze z błędów Postgresa (`Failing row contains`, `Key (…)=(…)`), query i fragment URL.
- Pola obiektów po nazwie: imię/nazwisko, treść wiadomości, bio, CV/plik, dane kontaktowe,
  adres, nagłówki, cookies, body/payload, IP, user agent, sesja.
- Błędy: nazwa, wiadomość, stack i łańcuch `cause` po redakcji, bez pól własnych błędu.
- Zostają: kody błędów, `area`, UUID-y korelacyjne, ścieżki bez parametrów, statusy.

Imion w dowolnym tekście nie da się wykryć wzorcem — dlatego nie loguj obiektów domenowych
ani surowych odpowiedzi dostawców; loguj kod i obszar.

## Testy

`tests/unit/privacy-redaction.test.ts` (reguły, konsola, wiadomość webhooka z danymi na
wejściu, strażnik konfiguracji telemetrii) i `tests/unit/error-webhook.test.ts` (#571: oba
formaty adresu i odrzucenie obcych, brak wysyłki bez zmiennej, payload bez PII z kontrolą
ujemną, `onRequestError` z szablonem trasy, limit i obcięcie, deduplikacja, 429 `retry_after`,
timeout, ciche awarie bez adresu w logach, strażnik bundla klienta i braku SDK Sentry).
Uruchamiane w jobie `unit`.

## Webhook błędów (#571)

- Sentry usunięte (`@sentry/nextjs`, `sentry.*.config.ts`, `sentry-egress`): SDK w przeglądarce
  i tak nie było ładowane, a serwerowe zdarzenia zawierały tylko kod — webhook daje ten sam
  zakres bez zależności (mniej kodu w buildzie serwera i Edge, bez hosta Sentry w CSP).
- Ten sam kod najwyżej raz na 10 min (następna wiadomość podaje liczbę pominiętych), po 429
  przerwa wg `retry_after` (maks. 1 h), timeout 3 s. Błąd webhooka nie zmienia odpowiedzi
  i nie jest logowany z adresem. Stan deduplikacji jest per proces.

## Poza kodem (właściciel)

Adres webhooka w Railway (`ERROR_WEBHOOK_URL`), kto ma dostęp do kanału Discorda, region,
retencja i warunki Discorda, logi Railway (retencja, dostęp), wpis do rejestru
czynności (#485), retencja i usuwanie danych już wysłanych (#486), ocena ewentualnych
incydentów wg runbooka #490. Wiadomość nie zawiera danych osobowych, ale ocena kanału należy do właściciela.
