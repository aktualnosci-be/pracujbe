# Checklista uruchomienia produkcyjnego

Kompletna lista kontrolna przed startem `pracuj.be` w produkcji. Przejdź w kolejności;
nie oznaczaj `[x]`, dopóki nie zweryfikowano na środowisku produkcyjnym.
Powiązane: [`DEPLOYMENT.md`](./DEPLOYMENT.md),
[`DOMAIN_SETUP.md`](./DOMAIN_SETUP.md), [`SECURITY_CHECKLIST.md`](./SECURITY_CHECKLIST.md),
[`PERFORMANCE_CHECKLIST.md`](./PERFORMANCE_CHECKLIST.md).

Migracja backendu do Railway jest w toku. Ta lista opisuje warunki przyszłego
odbioru; obecność usługi i bramki CI nie potwierdza gotowości produkcyjnej.

---

## 1. Domena i DNS

- [ ] Domena `pracuj.be` dodana w Railway i zweryfikowana (patrz [`DOMAIN_SETUP.md`](./DOMAIN_SETUP.md)).
- [ ] Rekordy DNS wskazują na domenę Railway; propagacja zakończona.
- [ ] Przekierowanie `www.pracuj.be` → `pracuj.be` (lub odwrotnie) — jedna wersja kanoniczna.
- [ ] SSL aktywny (certyfikat wystawiony), HTTP→HTTPS wymuszone, HSTS.
- [ ] `NEXT_PUBLIC_SITE_URL=https://pracuj.be` w środowisku Production.

## 2. Zmienne środowiskowe (Production)

- [ ] Wszystkie zmienne ustawione w Railway (`production`) — patrz [`DEPLOYMENT.md`](./DEPLOYMENT.md).
- [ ] **`APP_MODE=production`** (SEC-19, fail-closed) ustawione jawnie w Railway — inaczej brak konfiguracji bazy
      (PostgreSQL + Better Auth) cicho degraduje do trybu demo. W trybie production brak konfiguracji → **503 maintenance**
      (middleware) oraz `GET /api/health` → 503. Zweryfikuj `GET /api/health` = `{status:"ok"}`
      po wdrożeniu (readiness dla load-balancera/monitoringu).
- [ ] `DATABASE_*`, `BETTER_AUTH_SECRET`, klucze dostawcy poczty (`EMAILLABS_*` albo
      `RESEND_API_KEY`), `EMAIL_QUEUE_SECRET`, `FILE_DOWNLOAD_SECRET`, `ERROR_WEBHOOK_URL`
      jako **sekrety** (nie `NEXT_PUBLIC_*`) — pełna lista:
      [`railway/KONFIGURACJA_PRODUKCJI.md`](./railway/KONFIGURACJA_PRODUKCJI.md).
- [ ] Użyte są wyłącznie produkcyjne klucze i sekrety.
- [ ] Turnstile (#46): `NEXT_PUBLIC_TURNSTILE_SITE_KEY` (dostępny przy buildzie) i sekret
      `TURNSTILE_SECRET_KEY`. Bez nich w produkcji rejestracja i reset hasła są odrzucane —
      patrz [`TURNSTILE.md`](./TURNSTILE.md).
- [ ] Aplikacja bez konta (#98): sekret `GUEST_APPLY_SECRET` (≥ 32 znaki). Bez niego w
      produkcji formularz gościa zwraca „chwilowo niedostępne” — patrz [`GUEST_APPLY.md`](./GUEST_APPLY.md).
- [ ] `NEXT_PUBLIC_CONSENT_POLICY_VERSION` zgodny z aktualną polityką i RÓWNY
      `consent_versions.version` opublikowanego wiersza dokumentu `cookies` (np. oba „2.0”).
      Receipt zgody (`record_consent`, migracja `0142`) zapisuje wersję z cookie klienta tylko
      wtedy, gdy taki opublikowany wiersz istnieje (`published_at` ustawione i nie w przyszłości);
      inna konwencja nazw (np. „2026-01” z danych demo) = receipt wskazuje bieżącą wersję.

## 3. Baza danych (PostgreSQL Railway, produkcja)

- [ ] Usługa PostgreSQL Railway w regionie EU; osobne loginy ról (`npm run db:logins`).
- [ ] Wszystkie migracje zastosowane (`npm run db:migrate:production`,
      [`railway/MIGRACJE_POSTGRESQL.md`](./railway/MIGRACJE_POSTGRESQL.md)).
- [ ] RLS enabled i zweryfikowane (patrz [`SECURITY_CHECKLIST.md`](./SECURITY_CHECKLIST.md) §1).
- [ ] **Seed OFF** — brak danych `is_demo = true` na produkcji:
      ```sql
      select count(*) from jobs where is_demo;        -- oczekiwane 0
      select count(*) from companies where is_demo;    -- oczekiwane 0
      ```
- [ ] Konta demo (`@pracuj.be` z seedu, hasło `DemoPass123!`) **nie istnieją** na produkcji.
- [ ] Backupy włączone i przetestowany restore (przynajmniej próbny) —
      [`railway/BACKUP_RESTORE.md`](./railway/BACKUP_RESTORE.md).

## 4. Auth

- [ ] Konta Better Auth na PostgreSQL Railway (#24): `DATABASE_AUTH_URL`, `BETTER_AUTH_SECRET`,
      `BETTER_AUTH_URL` = `https://pracuj.be`; `/api/health` z tokenem pokazuje `auth`/`authUrl` = true.
- [ ] E-maile kont (potwierdzenie/reset) z kolejki `auth.email_outbox`: `DATABASE_AUTH_MAIL_URL` +
      `RESEND_API_KEY` + cron `/api/email/process`; mail przychodzi w JĘZYKU ODBIORCY (Invariant #1).
- [ ] Rate limits i (opcjonalnie) CAPTCHA włączone.
- [ ] Reset hasła nie ujawnia istnienia konta.

## 5. E-mail (Resend)

- [ ] Domena wysyłkowa zweryfikowana (SPF/DKIM/DMARC) — [`RESEND_SETUP.md`](./RESEND_SETUP.md).
- [ ] `EMAIL_FROM` na zweryfikowanej domenie; `EMAIL_REPLY_TO` działa.
- [ ] Dispatcher kolejki (cron) skonfigurowany i chroniony `EMAIL_QUEUE_SECRET`.
- [ ] Webhook Resend podłączony (delivered/opened/bounced/complained) z weryfikacją podpisu.
- [ ] Test end-to-end: aplikacja/propozycja → `email_deliveries` `queued → sent` →
      e-mail dociera w języku **odbiorcy**.

## 6. Przepływy krytyczne (real, nie mock)

- [ ] Rejestracja + logowanie + reset (Better Auth) w każdym języku.
- [ ] Onboarding kandydata (zapis per krok).
- [ ] Aplikacja na ofertę — idempotentna (`UNIQUE candidate_id, job_id`).
- [ ] Zmiany statusu aplikacji → historia + powiadomienie/e-mail do kandydata.
- [ ] Propozycja pracy — idempotentna (`idempotency_key`), kolejka e-mail.
- [ ] Wiadomości / powiadomienia in-app.
- [ ] Język komunikacji = język odbiorcy we wszystkich powiadomieniach (Invariant #1).

## 7. SEO

- [ ] `sitemap.xml` generuje tylko strony publiczne (bez paneli/staging).
- [ ] `robots.txt` produkcyjny zezwala na indeksowanie stron publicznych; panele `noindex`.
- [ ] `hreflang` + kanoniczne linki per język poprawne.
- [ ] `JobPosting` JSON-LD na ofertach; `Article` na poradnikach.
- [ ] Metadane (title/description/OG) uzupełnione; favicon i OG image z logo.
- [ ] Google Search Console: domena zweryfikowana, sitemap zgłoszona.

## 8. Wydajność i dostępność

- [ ] Lighthouse (mobile) spełnia cele — [`PERFORMANCE_CHECKLIST.md`](./PERFORMANCE_CHECKLIST.md).
- [ ] Core Web Vitals w normie na kluczowych stronach.
- [ ] Kontrast WCAG 2.2 AA, nawigacja klawiaturą.

## 9. Prywatność / RODO / cookies

- [ ] Baner cookies + centrum ustawień (necessary/preferences/analytics/marketing).
- [ ] **Zero trackingu przed zgodą** (GA/Pixel ładowane po zgodzie) — Invariant #7.
- [ ] Polityka prywatności, regulamin, polityka cookies opublikowane (PL/NL/FR/EN),
      wersjonowane w `consent_versions` (`is_current`).
- [ ] Mechanizm eksportu/usunięcia danych na żądanie.
- [ ] Minimalizacja danych; retencja zdefiniowana. **Retencja e-maili:** zaplanuj dzienny cron
      wywołujący RPC `email_deliveries_gc(90)` (usuwa zakończone dostawy > 90 dni — adresy/treści;
      RODO). Dane demo są oznaczone `is_demo=true` na tabelach procesowych (0022) — łatwe do
      odfiltrowania/usunięcia (Invariant #12).

## 10. Monitoring i obserwowalność

- [ ] Webhook błędów Discorda (`ERROR_WEBHOOK_URL`, #571; Sentry usunięte) odbiera zdarzenia z produkcji
      (`/api/health` → `checks.errorWebhook`).
- [ ] Czujki `/api/health/ops` podłączone do monitoringu (`docs/railway/OPERATIONS.md`).
- [ ] Web Vitals są mierzone wybranym mechanizmem produkcyjnym.
- [ ] `system_events` / `audit_logs` zapisują operacje wrażliwe.
- [ ] Logi dispatchera kolejki e-mail obserwowane (brak narastającego `queued`/`failed`).

## 11. CI/CD

- [ ] `ci.yml` zielony na `main` (lint/typecheck/unit/migrations/sca/rls/build/e2e) na `ubuntu-latest`.
- [ ] Railway śledzi `main`, a `Wait for CI` jest włączone.
- [ ] Udane CI i wdrożenie Railway wskazują ten sam SHA.

## 12. Bezpieczeństwo (skrót)

- [ ] Pełna [`SECURITY_CHECKLIST.md`](./SECURITY_CHECKLIST.md) przejrzana.
- [ ] Service role key nieobecny w bundlu klienta.
- [ ] Pliki wrażliwe tylko przez signed URLs.
- [ ] Rate limiting / brute force / anty-bot aktywne.
- [ ] Nagłówki bezpieczeństwa (CSP, HSTS, nosniff, referrer-policy).

## 13. Prawne / operacyjne

- [ ] Dane kontaktowe i informacje o podmiocie (impressum) na stronie.
- [ ] Adres `dmarc@pracuj.be` / `kontakt@pracuj.be` odbiera pocztę.
- [ ] Zgłoszenia treści (`reports`) trafiają do moderacji.
- [ ] Plan wsparcia / kontaktu na wypadek incydentu. Rejestr naruszeń w panelu (`/admin/naruszenia`, #490) gotowy; procedura to szkic do weryfikacji prawnika (`docs/legal-drafts/procedura-naruszen.md`).

## 14. Moduły: firma / admin / płatności / pliki

- [ ] **Storage:** migracja `0018_storage.sql` utworzyła prywatny bucket `candidate-files`
      + polityki `storage.objects` (właściciel operuje tylko na własnym folderze). Bucket
      **niepubliczny**; dostęp wyłącznie przez signed URLs. Zweryfikuj upload/pobranie CV.
- [ ] **Admin:** co najmniej jedno konto ma `profiles.role = 'admin'` (nadawane ręcznie w DB,
      NIE przez self-signup):
      ```sql
      update public.profiles set role='admin' where id = '<uuid właściciela>';
      ```
      `/admin` dostępny tylko dla admina (inni → 404). Weryfikacja firm (`admin_set_company_status`)
      i moderacja zgłoszeń (`admin_resolve_report`) zapisują `audit_logs` (actor = admin).
- [ ] **Firma pracodawcy:** rejestracja pracodawcy → `/employer/firma` (utworzenie firmy,
      status `unverified`) → admin weryfikuje → dopiero `verified` pozwala publikować oferty
      i wysyłać propozycje (egzekwowane w DB). Przejdź ten łańcuch end-to-end na produkcji.
- [ ] **Płatności — wyłączone (bezpłatny MVP, #51):** w Railway NIE ustawiaj `BILLING_ENABLED`
      (brak = wyłączone) ani `STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET`; jeśli zostały, usuń je.
      Sprawdź na produkcji: brak cennika/pakietów/CTA zakupu w PL/NL/FR/EN,
      `POST /api/stripe/webhook` → 404, `/pl/employer/platnosci` → przekierowanie na `/pl/employer`.
      Publikacja ofert nie zależy od subskrypcji. Tabele finansowe zostają bez użycia (cleanup
      osobno). Monetyzacja = nowa decyzja właściciela i osobny projekt.
- [ ] **audit_logs:** przejrzyj wpisy po testowych operacjach (status aplikacji/oferty,
      utworzenie/weryfikacja firmy) — obecne z poprawnym `actor_id`.

---

## 15. Odbiór wersji 1.0.0

Wykonaj na końcu, po sekcjach 1–14. Kryteria, blokery i kroki opisuje
[`RELEASE_1_0.md`](./RELEASE_1_0.md). Do tego czasu build zostaje w trybie
automatycznym `0.YYYYMMDD.M+SHA`.

- [ ] Wszystkie blokery z `RELEASE_1_0.md` §2 zamknięte albo jawnie odłożone przez
      właściciela w decyzji poniżej.
- [ ] **Decyzja właściciela** o wydaniu 1.0.0 zapisana (link do komentarza w issue
      albo `docs/railway/DECYZJE.md`): …
- [ ] **Zielone CI** dla wydawanego commita na `main` (link do przebiegu): …
- [ ] **Wdrożony SHA** w Railway `production` = SHA z zielonego CI (link do
      wdrożenia): …
- [ ] `PRACUJBE_RELEASE_VERSION=1.0.0` ustawione w Railway, build zakończony,
      stopka pokazuje `v1.0.0+<pierwsze 8 znaków SHA>`.
- [ ] Adnotowany tag `v1.0.0` na tym SHA wypchnięty (link do tagu): …
- [ ] `CHANGELOG.md` ma sekcję `## [1.0.0] — RRRR-MM-DD`.

---

## Po starcie (pierwsze 48 h)

- [ ] Monitoruj kanał błędów (webhook Discorda) i kolejkę e-mail.
- [ ] Sprawdź indeksowanie w Search Console (brak paneli/staging w indeksie).
- [ ] Zweryfikuj dostarczalność e-maili (brak masowego spamu/bounce).
- [ ] Potwierdź CWV z danych polowych.

---

## Powiązane

- [`DEPLOYMENT.md`](./DEPLOYMENT.md) · [`RELEASE_1_0.md`](./RELEASE_1_0.md) ·
  [`DOMAIN_SETUP.md`](./DOMAIN_SETUP.md) ·
  [`SECURITY_CHECKLIST.md`](./SECURITY_CHECKLIST.md) ·
  [`PERFORMANCE_CHECKLIST.md`](./PERFORMANCE_CHECKLIST.md) ·
  [`railway/README.md`](./railway/README.md) · [`EMAILLABS_SETUP.md`](./EMAILLABS_SETUP.md) ·
  [`RESEND_SETUP.md`](./RESEND_SETUP.md).
</content>
