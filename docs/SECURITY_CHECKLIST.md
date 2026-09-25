# Checklista bezpieczeństwa

Checklista wg sekcji 26 specyfikacji. Przechodź przed każdym wdrożeniem produkcyjnym
i przy każdym nowym przepływie dotykającym danych. Zasady twarde: Invarianty w
[`CLAUDE.md`](../CLAUDE.md) §7. Model bezpieczeństwa: [`ARCHITECTURE.md`](./ARCHITECTURE.md) §8.

Legenda: `[ ]` do sprawdzenia · `[x]` potwierdzone.

---

## 1. Row Level Security (RLS)

- [ ] RLS **enabled** na każdej tabeli z danymi użytkownika (deny-by-default).
- [ ] Każda tabela ma polityki `SELECT/INSERT/UPDATE/DELETE` zawężone do właściciela /
      członka firmy (nie polegaj na filtrach w aplikacji jako jedynej granicy).
- [ ] Tabele serwisowe (`audit_logs`, `system_events`, `email_deliveries`,
      `discount_codes`) mają RLS enabled i **brak polityk** (dostęp tylko service role).
- [ ] Funkcje pomocnicze RLS są `SECURITY DEFINER` + `set search_path = public`
      (`is_company_member`, `is_company_admin`, `company_is_verified`,
      `is_job_company_member`, `job_is_public`, `owns_candidate_profile`).
- [ ] Test negatywny: `anon` i obcy `authenticated` nie odczytują cudzych
      `applications`/`offers`/`messages`/`candidate_profiles`.
- [ ] Firma A nie widzi danych firmy B (test cross-tenant).

## 2. Service role key

- [ ] `SUPABASE_SERVICE_ROLE_KEY` **nigdy** jako `NEXT_PUBLIC_*`.
- [ ] `@/lib/supabase/admin` nie jest importowany w żadnym komponencie klienckim
      (`"use client"`) ani w kodzie trafiającym do bundle'a przeglądarki (Invariant #6).
- [ ] Użycie admin clienta ograniczone do: webhooki, kolejka e-mail, operacje admina.
- [ ] Grep w buildzie: klucz service role nie występuje w `.next/static`.

## 3. Signed URLs / pliki prywatne

- [ ] Buckety z danymi wrażliwymi (`cv`/`documents`, `attachments`, `invoices`) są
      **prywatne** (Invariant #10).
- [ ] Dostęp do plików prywatnych wyłącznie przez `createSignedUrl` generowany
      **serwerowo** po sprawdzeniu uprawnień; krótki TTL (60–300 s).
- [ ] Brak publicznych linków do dokumentów kandydatów.
- [ ] Polityki `storage.objects` wiążą ścieżkę z właścicielem; upload tylko dla właściciela.

## 4. Rate limiting

- [ ] Logowanie / rejestracja / reset hasła — limit prób (Supabase Auth Rate Limits).
- [ ] Wysyłka e-maili (Auth i transakcyjnych) — limit na użytkownika/adres.
- [ ] Aplikowanie / wysyłka propozycji / wiadomości — limit per użytkownik (kod `RATE_LIMITED`).
- [ ] Endpoint kolejki e-mail i webhooki — limit + autoryzacja.

## 5. Brute force / ochrona konta

- [ ] Blokada/opóźnienie po serii nieudanych logowań.
- [ ] Silna polityka haseł (min. długość, złożoność).
- [ ] Sesje: bezpieczne cookies (HttpOnly, Secure, SameSite) — zarządzane przez Supabase SSR.
- [ ] Potwierdzenie e-mail wymagane przed pełnym dostępem (Confirm email ON).

## 6. Anty-bot

- [ ] Formularze publiczne (rejestracja, kontakt, aplikacja) chronione (honeypot i/lub
      CAPTCHA — Supabase Auth wspiera hCaptcha/Turnstile; włącz na produkcji).
      Logowanie, rejestracja i reset hasła: Cloudflare Turnstile z weryfikacją serwerową
      (#46, [`TURNSTILE.md`](./TURNSTILE.md)) — ustaw klucze w produkcji.
- [ ] Rate limiting jako druga warstwa anty-bot.

## 7. Nieujawnianie istnienia e-maila

- [ ] Reset hasła: komunikat **identyczny** niezależnie od tego, czy konto istnieje
      („Jeśli konto istnieje, wysłaliśmy instrukcje").
- [ ] Rejestracja: nie ujawniaj wprost „adres już zajęty" w sposób umożliwiający
      enumerację (rozważ komunikat neutralny / wysyłkę e-maila informacyjnego).
- [ ] Logowanie: jednolity komunikat `AUTH_INVALID_CREDENTIALS` (bez rozróżniania
      „zły e-mail" vs „złe hasło").

## 8. Minimalizacja danych (RODO)

- [ ] Zbieramy tylko dane niezbędne (profil zawodowy zamiast pełnego CV).
- [ ] Dane demo oznaczone `is_demo=true`, usuwalne; wyłączone na produkcji.
- [ ] Retencja: plan usuwania/anonimizacji nieaktywnych kont i wygasłych danych.
- [ ] Eksport i usunięcie danych na żądanie (prawo dostępu / do bycia zapomnianym).
- [ ] `consents` + `consent_versions` rejestrują zgody z wersją polityki i źródłem.

## 9. Zgody / cookies / tracking

- [ ] **Zero trackingu przed zgodą** (Invariant #7): beacon Cloudflare Web Analytics
      ładowany dopiero po zgodzie w kategorii `analytics` (#570 — zamiast Google Analytics
      i Meta Pixel, usunięte).
- [ ] Baner cookies z kategoriami (necessary/preferences/analytics/marketing) + centrum
      ustawień; `necessary` always-on.
- [ ] Zgody zapisywane w `consents` z `consent_version_id` (wersjonowanie polityki:
      `NEXT_PUBLIC_CONSENT_POLICY_VERSION`).

## 10. Ujawnianie błędów

- [ ] Użytkownik nie widzi stack trace / SQL / surowej odpowiedzi dostawcy (Invariant #8).
- [ ] Wszystkie błędy przez `AppError` (`@/lib/errors`) → komunikat z klucza tłumaczenia.
- [ ] Szczegóły techniczne trafiają wyłącznie do Sentry / `system_events`, nie do UI.

## 11. Sekrety i konfiguracja

- [ ] Sekrety tylko w Vercel/GitHub Secrets — nie w repo (`.env.local` w `.gitignore`).
- [ ] Osobne klucze Supabase/Resend dla prod i staging.
- [ ] `EMAIL_QUEUE_SECRET` chroni endpoint dispatchera; webhooki weryfikują podpis.
- [ ] Rotacja kluczy przy podejrzeniu wycieku; least privilege dla tokenów CI.

## 12. Nagłówki i transport

- [ ] HTTPS wymuszony (HSTS), przekierowanie HTTP→HTTPS (Vercel).
- [ ] Bezpieczne nagłówki: CSP (na tyle restrykcyjne, na ile pozwala aplikacja),
      `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `X-Frame-Options`/frame-ancestors.
- [ ] `poweredByHeader` wyłączony (ustawione w `next.config.mjs`).

## 13. Autoryzacja w Server Actions

- [ ] Każda akcja wrażliwa sprawdza sesję i uprawnienia **przed** zapisem (nie polega
      wyłącznie na RLS jako komunikacie błędu).
- [ ] Kolejność dla propozycji: autoryzacja → firma `verified` → oferta `active` →
      walidacja → INSERT idempotentny (patrz [`ARCHITECTURE.md`](./ARCHITECTURE.md) §4).
- [ ] Operacje admina → wpis w `audit_logs`.

---

## Test bezpieczeństwa (E2E / integracyjne — do dopisania)

- [ ] anon nie odczytuje danych paneli,
- [ ] cross-tenant (firma A vs B),
- [ ] service role key nieobecny w bundlu klienta,
- [ ] reset hasła nie ujawnia istnienia konta,
- [ ] tracking nie ładuje się przed zgodą.

---

## Powiązane

- [`ARCHITECTURE.md`](./ARCHITECTURE.md) · [`SUPABASE_SETUP.md`](./SUPABASE_SETUP.md) ·
  [`RESEND_SETUP.md`](./RESEND_SETUP.md) · [`LAUNCH_CHECKLIST.md`](./LAUNCH_CHECKLIST.md).
</content>
