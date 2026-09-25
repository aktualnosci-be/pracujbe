# Konfiguracja usługi production — lista kontrolna (#14)

Stan: 25 września 2026, `main` po #532/#533/#27. Jedno środowisko `production`, gałąź `main`,
bez stagingu (decyzja właściciela 21.09). Ten dokument wymienia **nazwy** zmiennych i ustawień —
nigdy wartości. Sekretów nie wpisuj do repozytorium, issue, PR ani logów. Odhaczenie pozycji
wymaga odczytu z Railway (UI/API), a nie samej zmiany w kodzie.

Strażnik: `tests/unit/production-config-checklist.test.ts` — każda zmienna czytana przez
aplikację musi być na tej liście (albo w wykazie „nie ustawiać”), a każda z listy poza 2D w `.env.example`.

## 1. Ustawienia usługi web (`pracujbe`)

- [ ] Źródło: repozytorium `aktualnosci-be/pracujbe`, gałąź `main`, włączone **Wait for CI**.
- [ ] Builder: Railpack, Node 22 (`.nvmrc`, `engines`), instalacja z `package-lock.json`.
- [ ] Build: `npm run build`; start: `npm run start` (Next nasłuchuje na `PORT` od platformy).
- [ ] Healthcheck: ścieżka `/api/health`, timeout 300 s. Health = 200 tylko przy komplecie zmiennych
      z sekcji 2A i odpowiadającej bazie (`SELECT 1`); inaczej 503 i wdrożenie nie przejdzie.
- [ ] Jedna replika, region europejski (EU West).
- [ ] Publiczna domena `pracuj.be` (Cloudflare → CNAME Railway), HTTPS działa.
- [ ] Prywatna domena usługi znana (dla usług cron, sekcja 4).

## 2. Zmienne usługi web przy `APP_MODE=production`

`NEXT_PUBLIC_*` są wbudowywane w artefakt w czasie builda — po ich zmianie potrzebny jest nowy
build (Railway buduje ze zmiennymi usługi). Pozostałe są czytane w runtime.

### 2A. Rdzeń gotowości — bez którejkolwiek: 503 na każdej stronie i w `/api/health`

| Zmienna | Znaczenie |
|---|---|
| `APP_MODE` | `production` — jedyne źródło trybu; **ustawia właściciel** po #25/#26 |
| `NEXT_PUBLIC_SITE_URL` | `https://pracuj.be` (build-time: canonical, linki, e-maile) |
| `DATABASE_APP_URL` | login z członkostwem wyłącznie w `pracujbe_app` (strony, panele pod RLS) |
| `DATABASE_SERVICE_URL` | login z członkostwem wyłącznie w `service_role` (worker poczty, webhooki, cron, admin) |
| `DATABASE_AUTH_URL` | login z członkostwem wyłącznie w `pracujbe_auth` (Better Auth) |
| `BETTER_AUTH_URL` | origin HTTPS = `NEXT_PUBLIC_SITE_URL`, bez ścieżki |
| `BETTER_AUTH_SECRET` | losowy, ≥ 32 znaki, niezależny od innych sekretów |
| `DATABASE_RATE_LIMIT_URL` | login z członkostwem wyłącznie w `pracujbe_rate_limit` |
| `RATE_LIMIT_KEY_SECRET` | HMAC kluczy limitera, ≥ 32 znaki |

Loginy tworzy `npm run db:logins` (`LOGINY_POSTGRESQL_ONE_OFF.md`) po migracjach
(`WDROZENIE_MIGRACJI.md`).

### 2B. Wymagane do działania funkcji (bez nich 200, ale funkcja nie działa lub odmawia)

| Zmienna | Bez niej |
|---|---|
| `DATABASE_AUTH_MAIL_URL` | listy potwierdzenia adresu i resetu hasła czekają w kolejce; cron poczty 503 |
| `EMAIL_PROVIDER` | wybór dostawcy (`emaillabs` na produkcji); jawna wartość bez kluczy dostawcy blokuje wysyłkę (503 cronu) |
| `EMAILLABS_APP_KEY`, `EMAILLABS_SECRET_KEY`, `EMAILLABS_SMTP_ACCOUNT` | przy `EMAIL_PROVIDER=emaillabs` żaden e-mail nie wychodzi; cron poczty 503 (`docs/EMAILLABS_SETUP.md`) |
| `RESEND_API_KEY` | przy `EMAIL_PROVIDER=resend` żaden e-mail nie wychodzi; cron poczty 503 |
| `EMAIL_FROM`, `EMAIL_REPLY_TO` | nadawca domyślny; newsletter/marketing nie wychodzi bez jawnego `EMAIL_FROM` |
| `EMAIL_SENDER_IDENTITY`, `EMAIL_SENDER_POSTAL_ADDRESS` | newsletter/marketing nie wychodzi (stopka nadawcy, #45) |
| `EMAIL_UNSUBSCRIBE_SECRET` | brak linków wypisania → marketing nie wychodzi |
| `RESEND_WEBHOOK_SECRET` | webhook doręczeń 503 (brak blokad po odbiciach, #44) |
| `EMAILLABS_WEBHOOK_SECRET` | webhook raportów EmailLabs 503 (brak blokad po odbiciach) |
| `EMAILLABS_WEBHOOK_BASIC_USER`, `EMAILLABS_WEBHOOK_BASIC_PASSWORD` | opcjonalnie; oba albo żaden — gdy ustawione, webhook wymaga też Basic auth |
| `EMAIL_QUEUE_SECRET` | cron `/api/email/process` bez autoryzacji (401) |
| `MAINTENANCE_SECRET` | cron `/api/maintenance` bez autoryzacji |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY` | w produkcji rejestracja, reset hasła, zgłoszenia treści i aplikacja bez konta są odrzucane (fail-closed); logowanie działa |
| `TURNSTILE_ALLOWED_HOSTNAMES` | opcjonalnie; domyślnie host `NEXT_PUBLIC_SITE_URL` |
| `GUEST_APPLY_SECRET` | aplikacja bez konta wyłączona (#98) |
| `AWS_ENDPOINT_URL`, `AWS_DEFAULT_REGION`, `AWS_S3_BUCKET_NAME`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_S3_URL_STYLE` | upload/pobranie CV niedostępne (#26, preset „AWS SDK” bucketu Railway) |
| `FILE_DOWNLOAD_SECRET` | brak linków pobrania CV |
| `HEALTH_CHECK_SECRET` | brak szczegółów `/api/health` i czujek `/api/health/ops` (#47) |
| `DATABASE_OPS_URL` | czujki używają puli service (#47) |
| `ERROR_WEBHOOK_URL` | brak powiadomień o błędach serwera na Discordzie (#571; `…/api/webhooks/<id>/<token>` albo z końcówką `/slack`; tylko serwer, nie jako zmienna publiczna); `/api/health` `checks.errorWebhook=false` |
| `BACKUP_S3_ENDPOINT`, `BACKUP_S3_BUCKET`, `BACKUP_S3_READ_ACCESS_KEY_ID`, `BACKUP_S3_READ_SECRET_ACCESS_KEY` | czujka wieku kopii w R2 (#569) zgłasza `backup_unconfigured` (503 `/api/health/ops`); tylko klucz ODCZYTU — klucz zapisu `BACKUP_S3_ACCESS_KEY_ID`/`BACKUP_S3_SECRET_ACCESS_KEY` wyłącznie w usłudze `backup` |
| `BACKUP_S3_PREFIX`, `BACKUP_S3_REGION` | opcjonalnie; prefiks jak w usłudze `backup`, region domyślnie `auto` |
| `SITE_ACCESS_PASSWORD` | bramka „w przygotowaniu” wyłączona — **zostaje do decyzji właściciela** |

### 2C. Opcjonalne

| Zmienna | Uwagi |
|---|---|
| `NEXT_PUBLIC_DEFAULT_LOCALE` | domyślnie `pl` |
| `DSA_RETENTION_MODE` | domyślnie wyłączone; `dry-run` = podgląd, `apply` = anonimizacja spraw DSA w `/api/maintenance` — tylko po decyzji właściciela o terminach (#40) |
| `NEXT_PUBLIC_CONSENT_POLICY_VERSION` | wersja polityki cookies w zgodach |
| `NEXT_PUBLIC_GA_MEASUREMENT_ID`, `NEXT_PUBLIC_META_PIXEL_ID` | tracking wyłącznie po zgodzie (Invariant #7) |
| `AI_JOB_IMPORT_ENABLED`, `ANTHROPIC_API_KEY`, `AI_JOB_IMPORT_MODEL` | import ogłoszeń przez AI (#465), domyślnie wyłączony |
| `AI_JOB_ASSIST_ENABLED`, `AI_JOB_ASSIST_MODEL` | asystent redagowania oferty (#37), domyślnie wyłączony; ten sam `ANTHROPIC_API_KEY` |
| `AI_CV_IMPORT_ENABLED`, `AI_CV_IMPORT_MODEL` | import CV przez AI (#487, #498, `docs/AI_CV_IMPORT.md`), domyślnie wyłączony; ten sam `ANTHROPIC_API_KEY` |
| `AI_TRANSLATION_ENABLED`, `AI_TRANSLATION_MODEL`, `AI_TRANSLATION_EFFORT` | tłumaczenia AI — rdzeń kolejki (#31, #32, `docs/AI_TRANSLATION.md`), domyślnie wyłączone; ten sam `ANTHROPIC_API_KEY` |
| `PRACUJBE_RELEASE_VERSION` | tylko przy wydaniu 1.0.0 (#103) |

### 2D. Nie ustawiać w produkcji

| Zmienna | Powód |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_DB_URL` | kod ich nie czyta od #27 — jeśli zostały w usłudze, usuń |
| `NEXT_PUBLIC_SENTRY_DSN`, `SENTRY_DSN`, `SENTRY_ORG`, `SENTRY_PROJECT`, `SENTRY_AUTH_TOKEN` | Sentry usunięte w #571 (kanał błędów = `ERROR_WEBHOOK_URL`) — jeśli zostały w usłudze, usuń |
| `SEND_EMAIL_HOOK_SECRET` | hook GoTrue usunięty w #27 (kolejka auth PostgreSQL) |
| `BILLING_ENABLED`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | bezpłatne MVP (#51) |
| `AI_JOB_IMPORT_PROVIDER`, `AI_JOB_ASSIST_PROVIDER`, `AI_CV_IMPORT_PROVIDER`, `AI_TRANSLATION_PROVIDER` | atrapy testowe; ignorowane przy `APP_MODE=production` |
| `CRON_SECRET` | przestarzały wspólny sekret cronów; używaj `EMAIL_QUEUE_SECRET`/`MAINTENANCE_SECRET` |
| `CRON_TARGET_URL`, `CRON_AUTH_SECRET` | tylko w usługach cron (sekcja 4), nie w web |

## 3. Zmienne ustawiane przez platformę (nie ręcznie)

`PORT`, `RAILWAY_GIT_COMMIT_SHA` (SHA w wersji artefaktu i w szczegółach `/api/health`),
`NODE_ENV`.

## 4. Usługi cron (osobne, bez publicznej domeny)

Każda: komenda `node scripts/railway-cron-call.mjs`, restart NEVER, tylko dwie zmienne.
Najpierw jedno wywołanie ręczne. **Jeden harmonogram na zadanie** — żadnych równoległych
cronów (także poza Railway).

| Usługa | `CRON_TARGET_URL` | `CRON_AUTH_SECRET` | Harmonogram |
|---|---|---|---|
| `cron-email` | `http://<prywatna domena web>:<PORT>/api/email/process` | = `EMAIL_QUEUE_SECRET` | co 5 min |
| `cron-maintenance` | `http://<prywatna domena web>:<PORT>/api/maintenance` | = `MAINTENANCE_SECRET` | `0 * * * *` |

Kopie i odtworzenie bazy: `OPERATIONS.md` sekcja 5 (osobne usługi, własne zmienne). Usługa
`backup` (#569) buduje się z `docker/backup/Dockerfile` i wysyła kopie do Cloudflare R2
(`BACKUP_RESTORE.md`, „Kopia poza Railwayem”).

## 5. Odbiór

- [ ] Odczyt listy nazw zmiennych usługi web z Railway: komplet 2A, pozycje 2B zgodnie z decyzją
      właściciela, **brak** zmiennych z 2D.
- [ ] Nowy deployment z `main` po zielonym CI; SHA w stopce i w `/api/health` (z tokenem) = SHA `main`.
- [ ] `node scripts/production-smoke.mjs` (test wdrożeniowy z #12, `TEST_WDROZENIOWY.md`) zielony, wynik zapisany w issue.
- [ ] Usługi cron: po jednym wywołaniu ręcznym kod 0; harmonogramy jak w sekcji 4, bez duplikatów.
