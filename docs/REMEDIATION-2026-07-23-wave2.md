# Remediacja — dwa audyty z 2026-07-23 (fala 2)

Odpowiedź na dwa niezależne audyty (`docs/audit/` — raporty użytkownika). Oba badały stan **sprzed**
migracji `0012` (RPC procesów) i workera e-mail, więc część ich ustaleń była już częściowo zamknięta.
Ta fala domyka pozostałe P0/P1. Legenda: **fixed** = zrobione i zweryfikowane · **partial** · **deferred**.

## Weryfikacja lokalna (czego audytorzy nie mogli zrobić)
- `npm run typecheck` 0 · `npm run lint` 0 · `npm run test` **19/19** (doszedł `error-keys`) · `npm run build` OK (**83 strony**).
- **Migracje 0001–0013 aplikują się czysto od zera na PostgreSQL 16** + testy adwersaryjne RLS (role `anon`/`authenticated`).

## P0 — zamknięte (migracje 0013, zweryfikowane adwersaryjnie)
| Ustalenie (audyty) | Status | Co zrobiono |
|---|---|---|
| Anonimowy odczyt profili kandydatów + tabel-dzieci (skills/languages/certs); helper bez `profile_completed` | **fixed** | `0013`: `anon` odcięty; dostęp tylko dla AKTYWNEGO członka ZWERYFIKOWANEJ firmy (`current_user_has_verified_company`); helper wymaga `profile_completed`. Test: anon/niezweryfikowana firma nie widzą; zweryfikowana firma i właściciel widzą. |
| Obejście idempotencji/integralności propozycji + aplikacji (podmiana klucza/treści/statusu) | **fixed** | `0011` (RPC/idempotencja/triggery) + `0013` (zamrożenie payloadu: offers.idempotency_key/message/locale/sent_at; applications.message/phone/availability/locale/idempotency_key/match_score/submitted_at). Zapis domenowy przez RPC `0012`. |

## P1 — zamknięte w tej fali
| Ustalenie | Status | Co zrobiono |
|---|---|---|
| Modal aplikowania udaje sukces bez zapisu (F-01/P1-03) | **fixed** | `ApplyModal` woła Server Action `applyToJob` (jobId + idempotency); sukces tylko po realnym zapisie; niezalogowany → komunikat + logowanie. |
| Panele bez guardów, SSG (F-03/P1-05) | **fixed** | middleware next-intl + odświeżanie sesji Supabase SSR; guardy layoutów (getUser+redirect; employer: aktywne `company_members`) + `force-dynamic`; realne wylogowanie w `DashboardShell`. W trybie demo (bez env) panele działają. |
| Reset hasła bez kroku „ustaw nowe hasło" (P1-06) | **fixed** | strona `/ustaw-nowe-haslo` + `updatePassword` (`auth.updateUser`); callback z allowlistowanym `next`. |
| Rejestracja pracodawcy nie tworzy firmy (P1-07) | **fixed** | `bootstrapCompany` (RPC `create_company_with_owner`) po potwierdzeniu; idempotentnie. |
| Brak outboxa/kolejki e-mail, `resolveRecipientLocale` martwy (F-04/P1-09) | **fixed** | `0012` outbox (`attempts/next_attempt_at/payload`) + `resolve_recipient_locale` w DB + worker `/api/email/process` (Resend, retry/backoff). Język = język odbiorcy (zweryfikowane). |
| Zgody bez serwerowego rejestru + revoke trackerów (F-07/P1-10) | **fixed** | `src/lib/actions/consent.ts` → tabela `consents`; przy wycofaniu: `ga-disable`, `fbq revoke`, czyszczenie `_ga*/_fbp/_fbc`. |
| Brak stron prawnych — 404 (P1-12) | **fixed** | `regulamin, polityka-prywatnosci, polityka-cookies, o-nas, faq, kontakt, pomoc` ×4 języki + poprawione linki (Footer/CookieConsent). Treść = placeholder do uzupełnienia (prawnik). |
| `jobs.search` brak klucza (F-02) | **fixed** | dodane w 4 językach. |
| `toUserMessageKey` rozjazd SNAKE↔camel (F-18) | **fixed** | camelCase + test `error-keys` (każdy kod ma klucz). |
| `recipient-locale` wrażliwe na wielkość liter (F-16) | **fixed** | `toLowerCase()`. |
| Kontrast `--success`/`--warning` < AA (F-19) | **fixed** | dodane `--success-text #15803D` / `--warning-text #B45309`. |
| self-hosted CI bez guardu forków + `permissions` (F-17/F-22) | **fixed** | guard `head.repo.full_name == github.repository` na każdym jobie + `permissions: contents: read`. |

## Otwarte (kolejne fale)
| Ustalenie | Waga | Uwaga |
|---|---|---|
| Onboarding realny zapis per krok (P1-04) | P1 | **w toku** (server action `saveOnboardingStep` + RHF). |
| Publiczny `select=*` firm/ofert ujawnia VAT/e-mail/telefon (P1-01) | P1 | widoki `public_companies`/`public_jobs` + revoke anon + przepisanie `src/lib/jobs.ts` (P1-02). Dotyczy trybu z realną bazą (dziś fallback demo). |
| Rate limiting / anty-bot aplikacyjny (F-05/P2-02) | P1/P2 | limiter per IP+identifier (tabela/Upstash) na auth i aplikowaniu. |
| Pełna CSP (F-12/P2-03) | P2 | CSP z nonce; inline GA/Pixel jako świadomy wyjątek. |
| Storage prywatny + signed URLs (P2-11) | P2 | polityki `storage.objects` + walidacja uploadu. |
| ISR detalu oferty (F-11) · sitemap query URLs (F-10/P2-05) · `pick` namespace i18n (F-14) | P2 | wydajność/SEO. |
| PWA: ikony + service worker (P2-09) | P2 | manifest wskazuje brakujące ikony. |
| next/font/local zamiast google (F-06) | P1(CI) | build na runnerze bez dostępu do fonts.googleapis.com; wymaga `.woff2` w repo. |
| Podatności zależności — `npm audit` (P2-13) | P2 | Dependabot: alerty w grafie prod (Next/next-intl/Sentry); bump + ponowny audit. |
| Testy integracyjne RLS w CI (P2-08) | P1 | uruchamiać Postgres w CI + skrypty adwersaryjne (są już lokalnie w historii sesji). |

## Nota
Werdykt obu audytów (NO-GO) był słuszny dla badanego stanu. Po falach 1–2 zamknięto **oba P0** i większość
P1; pozostają P1-01/P1-02 (widoki publiczne + data-layer), onboarding save (w toku), rate limiting oraz zestaw P2.
