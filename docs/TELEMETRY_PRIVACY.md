# Telemetria bez danych kandydata (#502)

Dane osobowe usuwamy **w aplikacji, przed wysłaniem** — redakcja po stronie usługi działa
dopiero po transmisji.

## Kanały i filtr

| Kanał | Stan w kodzie | Ochrona |
|---|---|---|
| Sentry Node/Edge (`sentry.server/edge.config.ts`, przez `src/instrumentation.ts`) | aktywny tylko z `NEXT_PUBLIC_SENTRY_DSN` | `beforeSend: redactSentryEvent` (#508, `src/lib/sentry-egress.ts`): nowe zdarzenie z samym kodem błędu; tracing wyłączony |
| Sentry w przeglądarce (`sentry.client.config.ts`) | plik nie jest ładowany (brak `withSentryConfig`/`instrumentation-client`) — kanał nieaktywny | jw., gdy zostanie wpięty |
| `captureError` (`src/lib/sentry.ts`) i `onRequestError` | jw. | do SDK trafia tylko kod (#508); zdarzenie i tak przechodzi `redactSentryEvent` |
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

`tests/unit/privacy-redaction.test.ts` (reguły, konsola, filtr #508 na pełnym zdarzeniu,
strażnik konfiguracji telemetrii), `tests/unit/privacy-sentry-sdk.test.ts` (payload
wychodzący z SDK przez przechwycony transport z opcjami jak w configach: `captureError`,
`onRequestError`, breadcrumbs, `cause`, tracing) i kontrola ujemna
`privacy-sentry-sdk-control.test.ts` (to samo bez filtra niesie dane). Uzupełniają testy
#508 (`sentry-egress`, `sentry-capture`). Uruchamiane w jobie `unit`.

## Poza kodem (właściciel)

Konfiguracja produkcyjna Sentry (czy DSN jest ustawiony), region, retencja, dostęp personelu,
umowa powierzenia i transfer poza EOG, logi Railway (retencja, dostęp), wpis do rejestru
czynności (#485), retencja i usuwanie danych już wysłanych (#486), ocena ewentualnych
incydentów wg runbooka #490. Do czasu tej oceny Sentry pozostaje wyłączone (brak DSN).
