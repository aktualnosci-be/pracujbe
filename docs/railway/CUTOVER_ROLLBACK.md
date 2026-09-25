# Cutover produkcji, rollback i obserwacja (#18, #16)

Runbook dla operatora usługi `pracujbe` w środowisku `production` projektu
`captivating-vision`. Opisuje **kolejność** włączania konfiguracji, **cofnięcie**
zmian i **obserwację** po wdrożeniu. Dokument nie zawiera wartości sekretów: wszystkie
wartości są wyłącznie w Railway (Variables) albo w menedżerze haseł operatora.

Zasady stałe:

- jedna produkcja z `main`, natywne `Wait for CI` (`docs/DEPLOYMENT.md`);
- `APP_MODE=production` ustawia się **wyłącznie po jawnej decyzji właściciela**;
- bramka `SITE_ACCESS_PASSWORD` zostaje przez cały cutover, do osobnej decyzji
  właściciela — usunięcie tej zmiennej otwiera serwis publicznie;
- baza produkcyjna nigdy nie jest cofana destrukcyjnie; schemat idzie tylko do przodu
  (`WDROZENIE_MIGRACJI.md`, `MIGRACJE_POSTGRESQL.md`);
- każda zmiana zmiennych = jedno wdrożenie z zestawem zmian (Railway „staged changes”),
  po nim sprawdzenie z sekcji 4, zanim przejdziesz do następnego kroku;
- żadnych testów niszczących dane na produkcji — tylko odczyt i własne konto testowe
  operatora (#16).

## 1. Warunki wstępne (przed pierwszym krokiem)

| # | Warunek | Dowód do zapisania |
|---|---|---|
| P1 | SHA na `main` ma zielone wszystkie joby CI | SHA + link do przebiegu |
| P2 | Railway wdrożył dokładnie ten SHA | ID wdrożenia Railway |
| P3 | Migracje zastosowane, `MIGRATION_MODE=status` = 0 oczekujących (`WDROZENIE_MIGRACJI.md`) | wynik `status` (bez URL-a bazy) |
| P4 | Loginy runtime po `verify` (`LOGINY_POSTGRESQL_ONE_OFF.md`) | wynik `verify` |
| P5 | Kopia bazy z dowodem odtworzenia (`BACKUP_RESTORE.md`, `OPERATIONS.md` §2) | nazwa pliku kopii, czas |
| P6 | **Ostatnie dobre wdrożenie** zanotowane (ID + SHA) — to cel rollbacku | ID wdrożenia |
| P7 | Smoke test bazowy zielony (sekcja 4.1) w obecnym stanie | log smoke bez sekretów |
| P8 | Zrzut listy nazw zmiennych usługi (same nazwy, bez wartości) | lista nazw |

Brak któregokolwiek punktu = **stop**, cutover nie startuje.

## 2. Kolejność włączania

Kroki idą od konfiguracji, która niczego nie przełącza, do przełącznika trybu na
końcu. Powód: w trybie produkcyjnym niekompletna konfiguracja kończy się 503
(fail-closed, SEC-19), a w trybie demo `/api/health` pokazuje pełną mapę `checks`,
więc każdą grupę zmiennych da się sprawdzić, zanim zmieni się tryb.

### Krok 1 — PostgreSQL domeny i adres serwisu

Zmienne: `DATABASE_APP_URL`, `DATABASE_SERVICE_URL`, `DATABASE_RATE_LIMIT_URL`,
`RATE_LIMIT_KEY_SECRET` (co najmniej 32 bajty), `NEXT_PUBLIC_SITE_URL=https://pracuj.be`,
opcjonalnie `DATABASE_OPS_URL` i `HEALTH_CHECK_SECRET` (czujki, `OPERATIONS.md`).

- `NEXT_PUBLIC_*` wchodzi do bundla — wymaga nowego buildu (wdrożenia), nie restartu.
- Sprawdzenie: `/api/health` → 200, w szczegółach `database`, `serviceDatabase`,
  `rateLimit`, `httpsSiteUrl`, `databaseReachable` = `true`; smoke zielony.

### Krok 2 — Better Auth

Zmienne: `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL` (dokładnie ten sam origin co
`NEXT_PUBLIC_SITE_URL`, bez ścieżki), `DATABASE_AUTH_URL`, `DATABASE_AUTH_MAIL_URL`.

- `BETTER_AUTH_SECRET` ustawiasz raz. Rotacja unieważnia wszystkie sesje — tylko przy
  podejrzeniu wycieku.
- Sprawdzenie: w szczegółach health `auth`, `authUrl`, `authMail` = `true`; smoke
  zielony (strony `/logowanie`, `/rejestracja`, `/reset-hasla` w 4 językach);
  ręcznie: rejestracja i logowanie **własnym kontem testowym operatora**.

### Krok 3 — Resend i kolejka e-mail

Zmienne usługi web: `RESEND_API_KEY`, `EMAIL_FROM`, `EMAIL_QUEUE_SECRET`,
`EMAIL_UNSUBSCRIBE_SECRET`, `RESEND_WEBHOOK_SECRET` (webhook
`/api/email/webhook/resend`). `EMAIL_SENDER_*` — dopiero przy decyzji o marketingu.
Tracking w Resend wyłączony (`docs/RESEND_SETUP.md`).

Usługa cron e-mail (osobna, bez domeny publicznej, `README.md` §Cron):
`CRON_TARGET_URL` = prywatny adres web + `/api/email/process`, `CRON_AUTH_SECRET` =
ten sam sekret co `EMAIL_QUEUE_SECRET`.

- Najpierw **jedno wywołanie ręczne** crona (kod 0 w logu), dopiero potem harmonogram.
- Tylko jeden aktywny zestaw harmonogramów (nie równolegle z Vercelem).
- Sprawdzenie: e-mail weryfikacyjny konta testowego dochodzi w języku konta;
  `/api/health/ops` bez alarmów `email_queue_age`/`auth_email_queue_age`.

### Krok 4 — `APP_MODE=production` (decyzja właściciela)

- Ustaw dopiero, gdy kroki 1–3 mają zielone sprawdzenia i właściciel potwierdził
  decyzję. Bramka `SITE_ACCESS_PASSWORD` pozostaje.
- Sprawdzenie: publiczne `/api/health` → 200 `{"status":"ok"}` (w produkcji bez
  szczegółów; szczegóły tylko z nagłówkiem `x-health-token`); smoke zielony;
  `robots.txt`/sitemap w wariancie produkcyjnym.
- Wynik 503 `unconfigured` = brakuje zmiennej z kroków 1–3 → rollback z sekcji 3.2.

### Krok 5 — cron maintenance

Usługa `cron-maintenance`: `CRON_TARGET_URL` = prywatny adres web + `/api/maintenance`,
`CRON_AUTH_SECRET` = `MAINTENANCE_SECRET` usługi web (inny niż `EMAIL_QUEUE_SECRET`).
Jedno wywołanie ręczne, potem `0 * * * *` (UTC), restart NEVER (`README.md`).

## 3. Rollback

### 3.1 Kiedy

Natychmiast, gdy po kroku: smoke ma choć jeden błąd, `/api/health` ≠ 200, rośnie
odsetek 5xx w logach/metrykach Railway, logowanie konta testowego nie działa albo
`/api/health/ops` zgłasza alarm, który nie znika w ciągu 15 minut.

### 3.2 Wyzerowanie zmiennych (cofnięcie konfiguracji)

Kolejność odwrotna do włączania; każdy etap = jedno wdrożenie + smoke:

1. usuń `APP_MODE` (powrót do trybu demo, bez fail-closed 503);
2. wyłącz harmonogramy cronów (email, maintenance) — kolejka zostaje w bazie,
   wiadomości nie giną i wyjdą po ponownym włączeniu;
3. usuń `RESEND_API_KEY` (worker przestaje wysyłać, rekordy `email_deliveries` zostają);
4. usuń zmienne Better Auth z kroku 2 (logowanie wyłączone; tabel auth **nie** usuwaj —
   to skasowałoby konta i sesje);
5. zmienne baz z kroku 1 — tylko jeśli problem dotyczy samego połączenia.

`SITE_ACCESS_PASSWORD` zostaje na miejscu w każdym wariancie rollbacku.

### 3.3 Redeploy ostatniego dobrego wdrożenia

Railway → usługa `pracujbe` → Deployments → wdrożenie z punktu P6 → Rollback/Redeploy.
Po operacji porównaj listę nazw zmiennych z P8 i zakładkę Variables: wymagany stan
zmiennych ustaw jawnie według 3.2, nie zakładaj, że wrócił sam. Następnie smoke.

Alternatywa dla błędu w kodzie: `git revert` na `main` → CI → `Wait for CI` → wdrożenie.

### 3.4 Czego nie robić

- nie cofaj bazy, nie edytuj zastosowanych migracji, nie usuwaj wpisów historii
  migratora; naprawa schematu = nowa migracja (`WDROZENIE_MIGRACJI.md` §Rollback);
- nie odtwarzaj kopii bezpośrednio na produkcję (`OPERATIONS.md` §4);
- nie rotuj `BETTER_AUTH_SECRET` ani haseł loginów „na wszelki wypadek”;
- nie uruchamiaj drugiej produkcji w Vercelu.

## 4. Obserwacja po wdrożeniu

### 4.1 Smoke test (`scripts/railway/prod-smoke.mjs`)

Uruchamiany ręcznie przez operatora, poza CI. Sprawdza `/api/health` (200 i
`status: ok`), `/` (przekierowanie na `/{język}`), `robots.txt`, `sitemap.xml` oraz
strony publiczne i auth w PL/NL/FR/EN: oczekiwany kod, brak 5xx, limit czasu każdego
żądania. Tylko GET — nie tworzy danych.

```bash
# hasło bramki wczytaj z menedżera haseł do zmiennej środowiska, nie wpisuj go jawnie
SITE_ACCESS_PASSWORD="$(…)" node scripts/railway/prod-smoke.mjs
# inny adres / limit czasu (ms):
PROD_SMOKE_BASE_URL=https://pracuj.be PROD_SMOKE_TIMEOUT_MS=20000 node scripts/railway/prod-smoke.mjs
```

Kod wyjścia: `0` wszystko zgodne, `1` co najmniej jeden błąd, `2` zła konfiguracja.
Skrypt nie wypisuje hasła ani cookie bramki. Bez `SITE_ACCESS_PASSWORD` przy aktywnej
bramce kończy się błędem z podpowiedzią. Testy: `tests/unit/railway-prod-smoke.test.ts`
(atrapa serwera, kontrole ujemne: 5xx, 404, timeout, złe hasło, brak hasła, health).

### 4.2 Harmonogram obserwacji

| Kiedy | Co |
|---|---|
| zaraz po wdrożeniu | smoke; `/api/health`; logi Railway bez błędów startu |
| +15 min, +1 h | smoke; `/api/health/ops` (nagłówek `x-health-token`) bez alarmów; 5xx i czas odpowiedzi w metrykach Railway |
| przez 48 h, co kilka godzin | smoke; CPU i RAM usługi web i bazy (brak stałego wzrostu); `db_connections` < 80%; wiek kolejek e-mail i auth; nieudane wysyłki (`email_failed`, `auth_email_failed`) i odbicia z webhooka Resend; `webhook_stuck`; `maintenance_lag` po włączeniu kroku 5; upload i pobranie CV kontem testowym, gdy bucket jest skonfigurowany |
| przez 48 h | płatności wyłączone (#51): `/api/stripe/webhook` = 404; żadnych zdarzeń Stripe |

Sentry pozostaje bez DSN do decyzji właściciela (`docs/TELEMETRY_PRIVACY.md`) — do
tego czasu źródłem błędów są logi Railway (redagowane) i czujki `/api/health/ops`.

### 4.3 Protokół

Po każdym kroku dopisz do `docs/railway/STATUS.md` (bez wartości zmiennych, bez
adresów prywatnych i bez danych osobowych):

| Pole | Przykład |
|---|---|
| krok | 2 — Better Auth |
| SHA i ID wdrożenia | `abc1234`, `<id Railway>` |
| nazwy zmienionych zmiennych | `BETTER_AUTH_URL`, … |
| wynik smoke | `0`, 72/72 |
| health / ops | 200 ok / bez alarmów |
| decyzja | kontynuacja / rollback (3.2 lub 3.3) i powód |

Konfiguracja docelowa nie jest dowodem wdrożenia — dowodem są zapisane wyniki
sprawdzeń dla konkretnego SHA i wdrożenia.
