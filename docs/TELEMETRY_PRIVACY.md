# Telemetria bez danych kandydata (#502)

Dane osobowe usuwamy **w aplikacji, przed wysłaniem** — redakcja po stronie Sentry działa
dopiero po transmisji. Jedno źródło reguł: `src/lib/privacy/redact.ts`.

## Kanały i filtr

| Kanał | Stan w kodzie | Filtr |
|---|---|---|
| Sentry Node (`sentry.server.config.ts`, przez `src/instrumentation.ts`) | aktywny tylko z `NEXT_PUBLIC_SENTRY_DSN` | `sentryPrivacyOptions` |
| Sentry Edge (`sentry.edge.config.ts`) | jw. | `sentryPrivacyOptions` |
| Sentry w przeglądarce (`sentry.client.config.ts`) | plik nie jest ładowany (brak `withSentryConfig`/`instrumentation-client`) — kanał nieaktywny | `sentryPrivacyOptions` + `denyUrls`, gdy zostanie wpięty |
| Automatyczne błędy żądań (`onRequestError`) | jw. jak Node/Edge | do SDK trafia metoda i ścieżka bez query, bez nagłówków; potem `beforeSend` |
| Ręczne `captureError` (`src/lib/sentry.ts`) | jw. | allowlist kluczy kontekstu (`SAFE_CONTEXT_KEYS`), potem `beforeSend` |
| Tracing (transakcje, spany, nagłówek kopert) | `tracesSampleRate: 0.1` | `beforeSendTransaction`, `beforeSendSpan`, `PracujbePrivacy` (DSC); `tracePropagationTargets: []` |
| Logi serwera (stdout/stderr → Railway) | zawsze poza `next dev` | `installConsoleRedaction()` w `register()` |

`sentryPrivacyOptions` (`src/lib/privacy/sentry-scrub.ts`): `sendDefaultPii: false`, usunięte
`user`, nagłówki, cookies, body, `query_string` i `env` żądania; URL bez query i fragmentu;
redakcja wiadomości wyjątków (z `cause` przez linked errors), `extra`, `contexts`, tagów,
breadcrumbów (bez argumentów konsoli), spanów; bez zmiennych ramek stosu.

## Reguły redakcji

- Wartości: e-mail, telefon (BE i międzynarodowy), NISS/BIS, IBAN, JWT, `Bearer`, pary
  `token=`/`secret=`/`password=`…, długie tokeny (UUID zostają), nazwy plików dokumentów,
  wiersze z błędów Postgresa (`Failing row contains`, `Key (…)=(…)`), query i fragment URL.
- Pola po nazwie: imię/nazwisko, treść wiadomości, bio, CV/plik, dane kontaktowe, adres,
  nagłówki, cookies, body/payload, IP, user agent, sesja.
- Zostają: kod błędu (`errorCode`), `area`, UUID-y korelacyjne, ścieżki bez parametrów, statusy.

Imion w dowolnym tekście nie da się wykryć wzorcem — dlatego kontekst `captureError` przechodzi
allowlist, a nie tylko denylistę. Nowy klucz kontekstu dodawaj do `SAFE_CONTEXT_KEYS` tylko,
gdy niesie kod/obszar/UUID.

## Testy

`tests/unit/privacy-redaction.test.ts` (reguły, zdarzenie, konsola, strażnik konfiguracji),
`tests/unit/privacy-sentry-sdk.test.ts` (payload wychodzący z SDK przez przechwycony transport:
`captureError`, `onRequestError`, breadcrumbs, tracing) i kontrola ujemna
`privacy-sentry-sdk-control.test.ts` (to samo bez filtra niesie dane). Uruchamiane w jobie `unit`.

## Poza kodem (właściciel)

Konfiguracja produkcyjna Sentry (czy DSN jest ustawiony), region, retencja, dostęp personelu,
umowa powierzenia i transfer poza EOG, wpis do rejestru czynności (#485), retencja i usuwanie
danych już wysłanych (#486), ocena ewentualnych incydentów wg runbooka #490. Do czasu tej
oceny Sentry pozostaje wyłączone (brak DSN).
