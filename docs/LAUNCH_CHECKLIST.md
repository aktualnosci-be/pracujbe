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
- [ ] **`APP_MODE=production`** (SEC-19, fail-closed) ustawione jawnie w Railway — inaczej brak konfiguracji Supabase
      cicho degraduje do trybu demo. W trybie production brak konfiguracji → **503 maintenance**
      (middleware) oraz `GET /api/health` → 503. Zweryfikuj `GET /api/health` = `{status:"ok"}`
      po wdrożeniu (readiness dla load-balancera/monitoringu).
- [ ] `SUPABASE_SERVICE_ROLE_KEY`, `RESEND_API_KEY`, `EMAIL_QUEUE_SECRET`,
      `SENTRY_AUTH_TOKEN` jako **sekrety** (nie `NEXT_PUBLIC_*`).
- [ ] Użyte są wyłącznie produkcyjne klucze i sekrety.
- [ ] Turnstile (#46): `NEXT_PUBLIC_TURNSTILE_SITE_KEY` (dostępny przy buildzie) i sekret
      `TURNSTILE_SECRET_KEY`. Bez nich w produkcji rejestracja i reset hasła są odrzucane —
      patrz [`TURNSTILE.md`](./TURNSTILE.md).
- [ ] `NEXT_PUBLIC_CONSENT_POLICY_VERSION` zgodny z aktualną polityką.

## 3. Baza danych (Supabase produkcja)

- [ ] Projekt `pracujbe-prod` (region EU), plan Pro (backupy/PITR).
- [ ] Wszystkie migracje zastosowane (`supabase db push`), zgodne ze staging.
- [ ] RLS enabled i zweryfikowane (patrz [`SECURITY_CHECKLIST.md`](./SECURITY_CHECKLIST.md) §1).
- [ ] **Seed OFF** — brak danych `is_demo = true` na produkcji:
      ```sql
      select count(*) from jobs where is_demo;        -- oczekiwane 0
      select count(*) from companies where is_demo;    -- oczekiwane 0
      ```
- [ ] Konta demo (`@pracuj.be` z seedu, hasło `DemoPass123!`) **nie istnieją** na produkcji.
- [ ] Backupy włączone i przetestowany restore (przynajmniej próbny).

## 4. Auth

- [ ] Confirm email = ON; szablony e-mail Auth w PL/NL/FR/EN i z brandingiem.
- [ ] **Send Email Hook** (Authentication → Hooks → Send Email) ustawiony na
      `https://pracuj.be/api/auth/email-hook` z sekretem `SEND_EMAIL_HOOK_SECRET` —
      e-maile Auth (potwierdzenie/reset) idą w JĘZYKU ODBIORCY (Invariant #1). Zweryfikuj
      na staging, że mail przychodzi w języku rejestracji (a nie domyślnym GoTrue).
- [ ] Site URL = `https://pracuj.be`; Redirect URLs (allow list) obejmują produkcję.
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

- [ ] Rejestracja + logowanie + reset (Supabase Auth) w każdym języku.
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

- [ ] Sentry (client + server + edge) odbiera zdarzenia z produkcji; source maps uploadowane.
- [ ] Alerty Sentry na wzrost błędów krytycznych.
- [ ] Web Vitals są mierzone wybranym mechanizmem produkcyjnym.
- [ ] `system_events` / `audit_logs` zapisują operacje wrażliwe.
- [ ] Logi dispatchera kolejki e-mail obserwowane (brak narastającego `queued`/`failed`).

## 11. CI/CD

- [ ] `ci.yml` zielony na `main` (lint/typecheck/unit/e2e/build) na self-hosted runnerach.
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
- [ ] Plan wsparcia / kontaktu na wypadek incydentu.

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
- [ ] **Płatności (Stripe):** integracja jest wdrożona i provider-gated. Bez `STRIPE_SECRET_KEY`
      panel `/employer/platnosci` działa w trybie DEMO. Aby włączyć:
      1. ustaw `STRIPE_SECRET_KEY` (sk_live_...) jako sekret serwera;
      2. dodaj webhook w Stripe → endpoint `https://pracuj.be/api/stripe/webhook`, zdarzenia:
         `checkout.session.completed`, `customer.subscription.created/updated/deleted`,
         `invoice.paid`, `invoice.payment_failed`; skopiuj sekret do `STRIPE_WEBHOOK_SECRET`;
      3. checkout używa inline `price_data` z `PLANS` (bez ręcznego zakładania Price);
      4. webhook jest ŹRÓDŁEM PRAWDY (zapis `subscriptions/invoices/payments` service-rolem);
         klient nie pisze tych tabel. Billing wymaga roli owner/admin.
      5. przetestuj checkout (test mode) → subskrypcja `active` w DB → anulowanie
         (`cancel_at_period_end`) → webhook aktualizuje stan.
- [ ] **audit_logs:** przejrzyj wpisy po testowych operacjach (status aplikacji/oferty,
      utworzenie/weryfikacja firmy) — obecne z poprawnym `actor_id`.

---

## Po starcie (pierwsze 48 h)

- [ ] Monitoruj Sentry i kolejkę e-mail.
- [ ] Sprawdź indeksowanie w Search Console (brak paneli/staging w indeksie).
- [ ] Zweryfikuj dostarczalność e-maili (brak masowego spamu/bounce).
- [ ] Potwierdź CWV z danych polowych.

---

## Powiązane

- [`DEPLOYMENT.md`](./DEPLOYMENT.md) · [`DOMAIN_SETUP.md`](./DOMAIN_SETUP.md) ·
  [`SECURITY_CHECKLIST.md`](./SECURITY_CHECKLIST.md) ·
  [`PERFORMANCE_CHECKLIST.md`](./PERFORMANCE_CHECKLIST.md) ·
  [`SUPABASE_SETUP.md`](./SUPABASE_SETUP.md) · [`RESEND_SETUP.md`](./RESEND_SETUP.md).
</content>
