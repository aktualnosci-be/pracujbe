# Checklista uruchomienia produkcyjnego

Lista kontrolna przed startem `pracuj.be` na Railway. Stan opisany na **26 września 2026**.
Punkt oznaczamy `[x]` dopiero po sprawdzeniu na produkcji (odczyt, smoke, własne konto
testowe operatora) — zielony test w CI nie jest odbiorem.

Stack docelowy (bez alternatyw historycznych): jedna usługa web `pracujbe` na Railway z `main`
(`Wait for CI`), PostgreSQL Railway + Better Auth (Supabase usunięte z runtime, #27), prywatny
bucket Railway na CV, poczta **EmailLabs** (Resend tylko jako alternatywa), webhook błędów
Discorda, analityka **Cloudflare Web Analytics** wyłącznie po zgodzie, **bezpłatny MVP** bez
płatności (#51). Powiązane: [`railway/CUTOVER_ROLLBACK.md`](./railway/CUTOVER_ROLLBACK.md)
(kolejność włączania i rollback), [`railway/STATUS.md`](./railway/STATUS.md),
[`railway/KONFIGURACJA_PRODUKCJI.md`](./railway/KONFIGURACJA_PRODUKCJI.md),
[`RELEASE_1_0.md`](./RELEASE_1_0.md), [`SECURITY_CHECKLIST.md`](./SECURITY_CHECKLIST.md),
[`PERFORMANCE_CHECKLIST.md`](./PERFORMANCE_CHECKLIST.md).

---

## 0. Stan produkcji — 26 września 2026

| Obszar | Stan |
|---|---|
| Baza | migracje zastosowane do `0137` (usługa `db-migrator`) |
| Tryb | `mode: "demo"` — `APP_MODE=production` **nieustawione** (decyzja właściciela) |
| Bramka | `SITE_ACCESS_PASSWORD` aktywna: strony = 503 z formularzem hasła, `robots.txt` = `Disallow: /` |
| `/api/health` | 200 `ok`; `databaseReachable`, `auth`, `authMail`, `rateLimit`, `turnstile`, `fileBucket`, `errorWebhook`, `emailProviderReady` (EmailLabs), `queueSecret`, `maintenanceSecret`, `cronSecretsSeparate` = `true` |
| Braki w health | `emaillabsWebhook: false` (brak `EMAILLABS_WEBHOOK_SECRET`) |
| Cron | **brak usług cron** (limit darmowego planu Railway) — `/api/email/process` i `/api/maintenance` nie są wywoływane |
| AI | dostawca OpenAI (#677); brak `OPENAI_API_KEY`; funkcje AI za flagami, domyślnie wyłączone |
| Kopia poza Railwayem | R2 (#569) odłożone — brak zaszyfrowanej kopii poza Railwayem |
| Smoke | `node scripts/railway/prod-smoke.mjs` bez hasła: health i `robots.txt` OK, strony za bramką (oczekiwane) |

---

## 1. Blokery startu

Start = zdjęcie bramki hasła i `APP_MODE=production`. Każdy punkt „P0” blokuje start.

### 1a. Właściciel / infrastruktura / prawnik

| # | Priorytet | Bloker | Skutek, gdy zostanie |
|---|---|---|---|
| W1 | **P0** | **Wywoływanie `/api/email/process`** (cron co 1–5 min). Dziś brak usługi cron. Opcje: płatny plan Railway z usługą cron (`docs/railway/README.md` §Cron), albo zewnętrzny harmonogram wołający publiczny HTTPS z sekretem (np. Cloudflare Workers Cron Triggers; endpoint odpowiada 401 bez sekretu) | **Brak e-maili potwierdzających konto i resetu hasła** (`auth.email_outbox` obsługuje ten sam worker) → nowy użytkownik nie zaloguje się; brak e-maili o aplikacjach, statusach, propozycjach, wiadomościach |
| W2 | **P0** | **Wywoływanie `/api/maintenance`** co godzinę (inny sekret: `MAINTENANCE_SECRET`) | nie działa: wygaszanie ofert (`expire_due_jobs`; publiczna lista i tak ukrywa oferty po terminie), alerty zapisanych wyszukiwań, zwalnianie rezerwacji budżetu AI, czyszczenie tokenów gościa, kolejka usuwania plików, kampanie, retencja |
| W3 | **P0** | Domena: CNAME `pracuj.be` → domena Railway w Cloudflare, SSL, jedna wersja kanoniczna (`www` → apex), `NEXT_PUBLIC_SITE_URL`/`BETTER_AUTH_URL` = `https://pracuj.be` ([`DOMAIN_SETUP.md`](./DOMAIN_SETUP.md)) | serwis niedostępny pod docelowym adresem |
| W4 | **P0** | EmailLabs: domena nadawcy (SPF/DKIM/DMARC), konto SMTP z wyłączonym open trackingiem, webhook + `EMAILLABS_WEBHOOK_SECRET`, statusy „OK” włączone u wsparcia ([`EMAILLABS_SETUP.md`](./EMAILLABS_SETUP.md)) | poczta w spamie; brak blokad po twardych odbiciach (#44) |
| W5 | **P0** | Treść prawna: regulamin, polityka prywatności, polityka cookies, informacja o wieku, zgody (szkice w `docs/legal-drafts/`, nieopublikowane). Dziś strony są placeholderem z `noindex` | start bez podstawy prawnej przetwarzania i akceptacji regulaminu |
| W6 | **P0** | Dane podmiotu (impressum, „O nas”), działający adres kontaktowy i `dmarc@` | brak wymaganej informacji o usługodawcy (DSA/e-commerce) |
| W7 | **P0** | Kopia zapasowa: przed startem co najmniej potwierdzona kopia Railway i jeden próbny restore; R2 poza Railwayem (#569) świadomie odłożone — decyzja do zapisania ([`railway/BACKUP_RESTORE.md`](./railway/BACKUP_RESTORE.md)) | utrata danych bez drogi odtworzenia |
| W8 | **P0** | Decyzje trybu: `APP_MODE=production` (krok 4 runbooka), potem zdjęcie `SITE_ACCESS_PASSWORD` | — (to jest sam start) |
| W9 | P1 | Konto administratora: `profiles.role = 'admin'` dla właściciela (ręcznie w bazie) | brak weryfikacji firm → żadna oferta nie zostanie opublikowana |
| W10 | P1 | Monitoring: `HEALTH_CHECK_SECRET`, `DATABASE_OPS_URL`, uptime na `/api/health` i `/api/health/ops` ([`railway/OPERATIONS.md`](./railway/OPERATIONS.md)) | awarie kolejek/bazy niewidoczne |
| W11 | P1 | DPA i transfery dostawców (Railway, EmailLabs, Cloudflare, Discord; OpenAI dopiero przy włączeniu AI) — mapa: `docs/legal-drafts/dostawcy-i-transfery.md` | ryzyko RODO |
| W12 | P1 | Okresy retencji i DSA (#40, #574): zatwierdzenie wartości, potem `RETENTION_MODE`, `DSA_RETENTION_MODE`, `STORAGE_GC_MODE` (dziś wyłączone/dry-run) — wymaga też W2 | dane trzymane bez terminu |
| W13 | P2 | Cloudflare Web Analytics: `NEXT_PUBLIC_CF_WEB_ANALYTICS_TOKEN` (opcjonalne; bez niego beacon się nie ładuje) | brak statystyk ruchu i danych polowych CWV; podgląd CWV w `/admin/wydajnosc` wymaga dodatkowo `CF_ANALYTICS_ACCOUNT_ID`, `CF_WEB_ANALYTICS_SITE_TAG`, `CF_ANALYTICS_API_TOKEN` |
| W14 | P2 | AI (OpenAI, #677): `OPENAI_API_KEY` jako sekret usługi web (tylko serwer, nigdy `NEXT_PUBLIC_*`) + DPA z OpenAI + ocena AI Act; `ANTHROPIC_API_KEY` nie jest już używany — nie ustawiaj go, a jeśli jest, usuń; do tego czasu **nie** ustawiaj `AI_JOB_IMPORT_ENABLED`, `AI_JOB_ASSIST_ENABLED`, `AI_CV_IMPORT_ENABLED` | — (funkcje wyłączone, nie blokuje startu) |
| W15 | P2 | Google Search Console: domena, zgłoszenie plików `/sitemap/0.xml`, `/sitemap/1.xml` … (wypisane w produkcyjnym `robots.txt`; pojedynczego `/sitemap.xml` nie ma — #599) | wolniejsze indeksowanie |

### 1b. Kod (do zrobienia przez sesje)

| # | Priorytet | Luka | Uwagi |
|---|---|---|---|
| K1 | P1 | Harmonogram zastępczy dla W1/W2 bez płatnego planu Railway (np. Worker z Cron Trigger wołający `scripts/railway-cron-call.mjs`-owy kontrakt: POST, sekret w nagłówku, timeout) + dokumentacja | tylko po wyborze opcji przez właściciela; bez zmian w `.github/workflows` (minuty Actions) |
| K2 | P1 | GC tabel technicznych w `/api/maintenance`: `email_deliveries_gc` (istnieje od `0022`, nie jest wołane), `processed_webhooks`, `rate_limit` (#17) | za flagą jak `RETENTION_MODE` |
| K3 | P1 | Po zatwierdzeniu treści prawnej: zdjęcie `noindex` z `_legal/legal-page.tsx` i dodanie stron do sitemap (FUN-09) | czeka na W5 |
| K4 | ~~P2~~ | **Zrobione:** `/faq` (placeholder) usunięte, middleware daje 308 na `/{locale}/pomoc` (#61) | test `faq-redirect` |
| K5 | P2 | Linki Pomoc/Prywatność w stopce e-maili (#6) | |
| K6 | P2 | Wersja polityki z cookie w receipcie zgody (`record_consent` bierze `consent_versions`) | wymaga migracji |
| K7 | P2 | Domyślna nazwa firmy po nieudanym bootstrapie; nazwa firmy w wiadomościach kandydata | znane braki #24/#25 |
| K8 | P2 | `npm run test:e2e:real` poza CI (gotowy fragment `ci.yml` — issues #351, #66) | decyzja o minutach CI |
| K9 | P3 | CSP nonce/strict-dynamic — warianty A–D w [`CSP_NONCE_ANALYSIS.md`](./CSP_NONCE_ANALYSIS.md) | decyzja właściciela |

---

## 2. Domena i DNS

- [ ] Domena `pracuj.be` w Railway zweryfikowana (CNAME w Cloudflare, [`DOMAIN_SETUP.md`](./DOMAIN_SETUP.md)).
- [ ] Jedna wersja kanoniczna (`www` → apex), SSL, HTTP→HTTPS, HSTS.
- [ ] `NEXT_PUBLIC_SITE_URL=https://pracuj.be` (build), `BETTER_AUTH_URL` = ten sam origin.

## 3. Zmienne środowiskowe (usługa `pracujbe`)

Pełna lista: [`railway/KONFIGURACJA_PRODUKCJI.md`](./railway/KONFIGURACJA_PRODUKCJI.md).

- [x] PostgreSQL + Better Auth + limiter: `DATABASE_APP_URL`, `DATABASE_SERVICE_URL`,
      `DATABASE_AUTH_URL`, `DATABASE_AUTH_MAIL_URL`, `DATABASE_RATE_LIMIT_URL`,
      `RATE_LIMIT_KEY_SECRET`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL` (health 26.09).
- [x] Sekrety cron rozdzielone: `EMAIL_QUEUE_SECRET` ≠ `MAINTENANCE_SECRET`, bez `CRON_SECRET` (health 26.09).
- [x] Turnstile (`NEXT_PUBLIC_TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY`) — [`TURNSTILE.md`](./TURNSTILE.md) (health 26.09).
- [x] Bucket CV (preset „AWS SDK”) + `FILE_DOWNLOAD_SECRET` (health 26.09).
- [x] `ERROR_WEBHOOK_URL` (Discord, #571) (health 26.09).
- [x] EmailLabs: `EMAILLABS_APP_KEY`, `EMAILLABS_SECRET_KEY`, `EMAILLABS_SMTP_ACCOUNT`, `EMAIL_FROM` (health `emailProviderReady` 26.09).
- [ ] `EMAILLABS_WEBHOOK_SECRET` (health `emaillabsWebhook: false`) — W4.
- [ ] `GUEST_APPLY_SECRET` i `EMAIL_UNSUBSCRIBE_SECRET` (≥ 32 znaki) — health `checks.guestApplySecret`/`checks.unsubscribeSecret` = `true` (od tego PR).
- [ ] `HEALTH_CHECK_SECRET`, `DATABASE_OPS_URL` — W10.
- [ ] **`APP_MODE=production`** dopiero po decyzji właściciela (W8). W trybie produkcyjnym brak
      konfiguracji = 503 (fail-closed, SEC-19); publiczne `/api/health` pokazuje wtedy tylko `status`.
- [ ] Nieustawione: `BILLING_ENABLED`, `STRIPE_*`, `AI_*_ENABLED`, `ANTHROPIC_API_KEY` (AI na OpenAI od #677), zmienne Supabase, `CRON_SECRET`.
- [ ] `OPENAI_API_KEY` dopiero razem z włączeniem funkcji AI (W14); sam klucz niczego nie włącza.
- [ ] `NEXT_PUBLIC_CONSENT_POLICY_VERSION` pusta (domyślnie `2.0`) albo zgodna z opublikowaną polityką.

## 4. Baza danych

- [x] PostgreSQL Railway, migracje do `0137` (`db-migrator`, `MIGRATION_MODE=status` po `apply`).
- [ ] Loginy runtime po `verify` ([`railway/LOGINY_POSTGRESQL_ONE_OFF.md`](./railway/LOGINY_POSTGRESQL_ONE_OFF.md)).
- [ ] Brak danych demonstracyjnych (seed nigdy nieuruchomiony na produkcji):
      ```sql
      select count(*) from jobs where is_demo;        -- oczekiwane 0
      select count(*) from companies where is_demo;    -- oczekiwane 0
      ```
- [ ] Kopia i próbny restore — W7.

## 5. Konta (Better Auth)

- [ ] Rejestracja kandydata i pracodawcy, potwierdzenie adresu, logowanie, reset w PL/NL/FR/EN
      — **wymaga W1** (e-maile z `auth.email_outbox` wychodzą tylko przez `/api/email/process`).
- [ ] Mail potwierdzający w języku odbiorcy (Invariant #1).
- [ ] Reset hasła nie ujawnia istnienia konta; limiter i Turnstile aktywne.

## 6. E-mail (EmailLabs)

- [ ] Domena nadawcy zweryfikowana, tracking wyłączony — W4, [`EMAILLABS_SETUP.md`](./EMAILLABS_SETUP.md).
- [ ] Harmonogram `/api/email/process` — W1; pierwsze wywołanie ręczne (kod 0).
- [ ] Webhook `/api/email/webhook/emaillabs` z podpisem — W4.
- [ ] Test end-to-end: aplikacja/propozycja → `email_deliveries` `queued → sent` → e-mail w języku **odbiorcy**.
- [ ] Wypisanie z kategorii (`/wypisz`, nagłówek one-click) działa na odebranym mailu.

## 7. Przepływy krytyczne (na produkcji, kontem testowym operatora)

- [ ] Onboarding kandydata (zapis per krok).
- [ ] Firma → weryfikacja przez admina (W9) → publikacja oferty.
- [ ] Aplikacja idempotentna; zmiana statusu → historia + powiadomienie/e-mail.
- [ ] Propozycja idempotentna; akceptacja/odrzucenie.
- [ ] Wiadomości i powiadomienia in-app; upload i pobranie CV (link 60 s).
- [ ] Aplikacja bez konta (gość) — potwierdzenie linkiem, wymaga W1.

## 8. SEO

- [ ] Produkcyjny `robots.txt` wskazuje `/sitemap/<id>.xml`; w sitemap tylko strony publiczne.
- [ ] `hreflang` + canonical per język; `JobPosting` na ofertach, `Article` na poradnikach.
- [ ] Strony prawne indeksowalne dopiero po zatwierdzeniu treści (K3).
- [ ] Search Console — W15.

## 9. Prywatność / cookies

- [x] Baner i centrum zgód: kategorie necessary/preferences/analytics (marketing usunięty, #570).
- [ ] Zero trackingu przed zgodą na produkcji: beacon Cloudflare dopiero po zgodzie `analytics`,
      lejek ofert (#575) bez żądań przed zgodą (Invariant #7).
- [ ] Polityki opublikowane (PL/NL/FR/EN) — W5; wersja w `consent_versions` (`is_current`).
- [ ] Eksport i usunięcie konta kandydata (`/candidate/ustawienia`) sprawdzone kontem testowym.
- [ ] Retencja — W12, K2.

## 10. Monitoring

- [ ] Kanał Discorda odbiera błędy z produkcji.
- [ ] `/api/health/ops` podłączone do monitoringu, bez alarmów kolejek po włączeniu W1/W2.
- [ ] Logi Railway: retencja i dostęp ustalone.

## 11. CI/CD

- [ ] `ci.yml` zielony na `main` (9 jobów, `ubuntu-latest`); `Wait for CI` włączone.
- [ ] Wdrożony SHA (stopka / `version` w `/api/health`) = SHA z zielonego CI.

## 12. Bezpieczeństwo (skrót)

- [ ] [`SECURITY_CHECKLIST.md`](./SECURITY_CHECKLIST.md) przejrzana dla Railway.
- [ ] Nagłówki (CSP, HSTS, nosniff, referrer-policy, frame-ancestors) na domenie produkcyjnej.
- [ ] Brak kluczy uprzywilejowanych w bundlu klienta; pliki tylko przez podpisane linki.

## 13. Moduły

- [ ] **Płatności wyłączone (#51):** brak cennika/CTA zakupu w 4 językach,
      `POST /api/stripe/webhook` → 404, `/pl/employer/platnosci` → `/pl/employer`.
- [ ] **Moderacja:** zgłoszenia DSA (`/zglos-tresc`) i wiadomości trafiają do `/admin/zgloszenia`.
- [ ] **Rejestr naruszeń** `/admin/naruszenia` dostępny; procedura to szkic
      (`docs/legal-drafts/procedura-naruszen.md`).
- [ ] **audit_logs:** wpisy po testowych operacjach z poprawnym `actor_id`.

## 14. Odbiór wersji 1.0.0

Po sekcjach 1–13, wg [`RELEASE_1_0.md`](./RELEASE_1_0.md): decyzja właściciela, zielone CI,
wdrożony SHA, `PRACUJBE_RELEASE_VERSION=1.0.0`, tag `v1.0.0`, sekcja w `CHANGELOG.md`.

## Po starcie (pierwsze 48 h)

Harmonogram obserwacji: [`railway/CUTOVER_ROLLBACK.md`](./railway/CUTOVER_ROLLBACK.md) §4 —
smoke, `/api/health/ops`, kolejki e-mail, odbicia, 5xx, Search Console.
