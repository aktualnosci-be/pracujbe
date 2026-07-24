# CLAUDE.md — Pracuj.be

> **Przeznaczenie tego pliku.** To jest mapa i kontrakt projektu dla kolejnych modeli
> (Claude Code / inne LLM) oraz ludzi kontynuujących pracę. Zanim cokolwiek zmienisz —
> przeczytaj ten plik w całości. Opisuje: czym jest produkt, jak zbudowana jest aplikacja,
> jakie są niezmienne reguły (invariants), co jest już zrobione, a co pozostaje do zrobienia
> (roadmapa etapów 1–8 ze specyfikacji).

---

## 0. TL;DR dla modelu kontynuującego pracę

1. **Stack:** Next.js 15 (App Router, React Server Components) · TypeScript `strict` · Tailwind + shadcn/ui · Supabase (Postgres/Auth/Storage/RLS) · Zod · React Hook Form · Resend + React Email · Sentry · Vitest + Playwright · Vercel.
2. **CI/CD działa na self-hosted runnerach** (patrz `.github/workflows/*` i sekcja „CI/CD" niżej). Nie zmieniaj `runs-on` z powrotem na `ubuntu-latest` bez wyraźnej prośby.
3. **Niezmienne reguły (NIGDY nie łam):** patrz sekcja „Invariants". Najważniejsze: język e-maili = język odbiorcy; wysyłka propozycji idempotentna; brak service-role key w przeglądarce; brak trackingu przed zgodą; RLS na wszystkim; żadnych tekstów UI na sztywno.
4. **Gdzie co jest:** patrz „Struktura katalogów".
5. **Co dalej:** patrz „Roadmapa / status" — sekcja z checkboxami. Wybierz kolejny niezaznaczony punkt.
6. **Zawsze uruchom przed commitem:** `npm run verify` (lint + typecheck + unit). E2E gdy dotykasz przepływów.

---

## 1. Produkt

**Pracuj.be** — lekka, wielojęzyczna platforma rekrutacyjna, przede wszystkim dla osób
szukających pracy w **Belgii** i belgijskich pracodawców. Grupa docelowa: Polacy w Belgii,
obcokrajowcy, pracownicy fizyczni/techniczni/produkcja/magazyn/kierowcy/budowa/gastronomia/
sprzątanie, praca sezonowa, osoby bez profesjonalnego CV.

**Kluczowa obietnica:** „Znajdź pracę w Belgii szybko i bez zbędnych formalności".

**Wyróżnik:** kandydat nie musi mieć klasycznego CV — tworzy **prosty profil zawodowy**,
który jest dopasowywany do ofert (matching).

**Pozycjonowanie:** prostota, zaufanie, przejrzystość, szybkość, bezpieczeństwo. Prościej
niż LinkedIn/Indeed/StepStone. Użytkownik rozumie stronę w kilka sekund.

**Ekspansja (przyszłość):** NL, LU, DE, FR, PL, reszta UE. Architektura ma to umożliwiać
(kraje/regiony/miasta jako dane, nie hardcode).

---

## 2. System wizualny (identyfikacja)

> 🎨 **ŹRÓDŁO PRAWDY DLA UI:** zatwierdzone makiety w `docs/design/screens/` + specyfikacja
> `docs/DESIGN_SCREENS.md` (7 ekranów: home, lista ofert, szczegóły oferty, panel kandydata,
> panel pracodawcy, onboarding, stany UI — desktop + mobile). Gdy cokolwiek tu różni się od makiet,
> **makiety wygrywają**.
>
> **KOREKTA PALETY (potwierdzona przez użytkownika):** kolorem MARKI/AKCJI jest **granat `#0F2A47`**
> (przyciski, sidebar paneli, stopka), a jasny niebieski `#2563EB` to **akcent** (linki, „.be" w logo,
> aktywny krok). To odwrotnie niż w pierwotnej specyfikacji — pełna tabela w `docs/DESIGN_SCREENS.md §0`.
> Makiety są pionowo rozciągnięte (artefakt generatora) — odstępy rób normalnie, nie kopiuj rozciągnięcia.

Całkowicie nowa identyfikacja — **nie** kopiujemy Work-Volume.com.

**Zasady:** minimalizm, jasność, mobile-first, dużo pustej przestrzeni, wysoka czytelność.
**Unikaj:** ciężkich gradientów, ciemnych ekranów, glassmorphism, dużych animacji,
autoodtwarzanych filmów, przeładowanych dashboardów, zbędnych cieni.

**Paleta (tokeny CSS w `src/app/globals.css`, mapowane w Tailwind):**

| token | hex | użycie |
|---|---|---|
| primary | `#2563EB` | akcje główne, linki |
| primary-dark | `#1D4ED8` | hover/active |
| text | `#172033` | tekst podstawowy |
| muted (foreground) | `#566881` | tekst drugorzędny (przyciemniony z `#64748B` dla WCAG AA ≥4.5:1 na tle soft/białym) |
| background | `#FFFFFF` | tło |
| soft | `#F8FAFC` | sekcje/tła kart |
| border | `#E2E8F0` | obramowania |
| success | `#16A34A` | sukces / firma zweryfikowana |
| warning | `#EA580C` | ostrzeżenia |
| error | `#DC2626` | błędy |

Kontrast **WCAG 2.2 AA** obowiązkowy. Paleta zdefiniowana raz jako zmienne — nie wpisuj hexów w komponentach.

**Typografia:** **Inter** przez `next/font` (self-hosted, subset `latin` + `latin-ext` dla PL/znaków
diakrytycznych). Maksymalnie 2 rodziny fontów (na razie jedna). Nagłówki wyraźne, nie przesadzone.

**Logo:** tekstowo-symboliczne „Pracuj.be" — znak „P" + subtelny pin/strzałka. Czytelne w małym
rozmiarze, działa jako favicon i w social media. **Zakazane** stereotypy: krawat, teczka, uścisk dłoni,
sylwetka w kasku. Komponent: `src/components/brand/Logo.tsx`. Favicon/OG generowane z tego znaku.

---

## 3. Architektura techniczna

- **Framework:** Next.js 15, App Router, React 19, React Server Components domyślnie.
  Klienckie komponenty (`"use client"`) tylko gdy naprawdę potrzebne (formularze, interakcje).
- **Rendering:** publiczne strony SSR/SSG (oferty statycznie generowane/rewalidowane), panele SSR + wyspy klienckie.
- **Język/typy:** TypeScript `strict: true`. Walidacja I/O przez **Zod** (jedno źródło typów: `z.infer`).
- **UI:** Tailwind CSS + **shadcn/ui** (dostępne komponenty Radix). Komponenty w `src/components/ui`.
- **Dane/Auth/Storage:** **Supabase**. Trzy klienty:
  - `src/lib/supabase/server.ts` — RSC/Server Actions/Route Handlers (cookies, sesja użytkownika).
  - `src/lib/supabase/client.ts` — komponenty klienckie (anon key).
  - `src/lib/supabase/admin.ts` — **tylko** kod serwerowy zaufany (service role). NIGDY nie importować w komponencie klienckim.
- **Bezpieczeństwo danych:** **Row Level Security** na każdej tabeli. Operacje wrażliwe = Server Actions/Route Handlers.
- **Formularze:** React Hook Form + Zod resolver. Server Actions do zapisu.
- **E-mail:** **Resend** + **React Email** (szablony w `src/emails`), wysyłka przez kolejkę (`email_deliveries`).
- **Błędy/monitoring:** **Sentry** (client + server + edge). Centralny system błędów `src/lib/errors`.
- **Testy:** **Vitest** (unit/integration) + **Playwright** (e2e). Patrz `tests/`.
- **Hosting:** **Vercel** (produkcja + staging). Migracje SQL wersjonowane w `supabase/migrations`.
- **i18n:** `next-intl`, routing z prefiksem locale (`/pl`, `/nl`, `/fr`, `/en`), teksty w `src/messages/*.json`.

---

## 4. Struktura katalogów

```
pracujbe/
├─ CLAUDE.md                      # ten plik — mapa/kontrakt projektu
├─ README.md                      # szybki start + skrypty
├─ .github/workflows/             # CI/CD na self-hosted runnerach
│  ├─ ci.yml                      # lint · typecheck · unit · e2e · build
│  └─ deploy.yml                  # deploy na Vercel (staging/prod)
├─ docs/                          # dokumentacja rozszerzona
│  ├─ ARCHITECTURE.md
│  ├─ SELF_HOSTED_RUNNERS.md      # jak postawić i zarejestrować runnery
│  ├─ SUPABASE_SETUP.md
│  ├─ RESEND_SETUP.md
│  ├─ DEPLOYMENT.md
│  ├─ STAGING.md
│  ├─ SECURITY_CHECKLIST.md
│  ├─ PERFORMANCE_CHECKLIST.md
│  └─ LAUNCH_CHECKLIST.md
├─ supabase/
│  ├─ migrations/                 # *.sql wersjonowane (kolejność wg prefiksu)
│  └─ seed.sql                    # dane demonstracyjne (oznaczone is_demo=true)
├─ src/
│  ├─ app/
│  │  ├─ layout.tsx               # root layout (html/lang ustawiane w [locale])
│  │  ├─ [locale]/                # wszystkie strony z prefiksem języka
│  │  │  ├─ layout.tsx
│  │  │  ├─ page.tsx              # strona główna
│  │  │  ├─ (public)/...          # oferty, kategorie, miasta, poradniki, o nas...
│  │  │  ├─ (auth)/...            # logowanie, rejestracja, reset, potwierdzenie
│  │  │  ├─ candidate/...         # panel kandydata (noindex)
│  │  │  ├─ employer/...          # panel pracodawcy (noindex)
│  │  │  └─ admin/...             # panel administratora (noindex)
│  │  ├─ api/                     # route handlers (webhooki, kolejka e-mail, itp.)
│  │  ├─ sitemap.ts / robots.ts
│  ├─ components/
│  │  ├─ ui/                      # shadcn/ui
│  │  ├─ brand/                   # Logo, znaki
│  │  ├─ public/                  # komponenty stron publicznych
│  │  └─ cookies/                 # baner + centrum zgód
│  ├─ lib/
│  │  ├─ supabase/                # server.ts, client.ts, admin.ts
│  │  ├─ i18n/                    # konfiguracja next-intl, locale, fallback e-mail
│  │  ├─ matching/                # deterministyczny scoring dopasowania
│  │  ├─ email/                   # wysyłka + kolejka + wybór języka odbiorcy
│  │  ├─ errors/                  # centralny system błędów + kody
│  │  └─ validation/              # schematy Zod
│  ├─ emails/                     # szablony React Email (PL/NL/FR/EN)
│  ├─ messages/                   # pl.json, nl.json, fr.json, en.json
│  └─ types/                      # typy współdzielone, generowane z DB
├─ tests/
│  ├─ unit/                       # Vitest
│  └─ e2e/                        # Playwright
├─ .env.example
├─ next.config.mjs
├─ tailwind.config.ts
├─ tsconfig.json
├─ vitest.config.ts
└─ playwright.config.ts
```

---

## 5. Model danych (Postgres / Supabase)

UUID PK wszędzie, `created_at`/`updated_at` (trigger `set_updated_at`), soft-delete
(`deleted_at`) tam gdzie potrzebne, FK z kontrolowanym `ON DELETE`, statusy jako enumy/CHECK,
indeksy pod filtry ofert. Pełny DDL w `supabase/migrations/`.

Tabele (grupy):

- **Tożsamość/role:** `profiles` (1:1 z `auth.users`, pole `role`, `preferred_locale`,
  `account_locale`, `signup_locale`), `candidate_profiles`, `employer_profiles`.
- **Firmy:** `companies` (status weryfikacji), `company_members` (rola w firmie, aktywność).
- **Oferty:** `jobs`, `job_translations`, `job_requirements`, `job_skills`.
- **Słowniki:** `categories`, `occupations`, `skills`, `languages`, `certificates`, `locations`.
- **Profil kandydata (relacje):** `candidate_skills`, `candidate_languages`, `candidate_certificates`.
- **Procesy:** `applications`, `application_status_history`, `matches`, `saved_jobs`,
  `offers`, `offer_status_history`.
- **Komunikacja:** `conversations`, `conversation_members`, `messages`,
  `notifications`, `notification_preferences`, `email_deliveries`.
- **Pliki/zgody/zgłoszenia:** `files`, `consents`, `consent_versions`, `reports`.
- **Płatności:** `subscriptions`, `payments`, `invoices`, `discount_codes`.
- **Audyt:** `audit_logs`, `system_events`.

Statusy (enumy):
- `application_status`: draft, submitted, viewed, shortlisted, interview, offer_sent, offer_accepted, offer_declined, rejected, withdrawn, hired.
- `offer_status`: draft, sent, viewed, accepted, declined, expired, cancelled.
- `company_status`: unverified, pending, verified, rejected, suspended.
- `job_status`: draft, active, paused, closed, expired.

---

## 6. Role i uprawnienia

Role (`profiles.role`): `candidate`, `employer`, `admin`. Architektura przewiduje też:
`moderator`, `recruiter`, `company_member`, `company_owner` (poprzez `company_members.role`).

Zasada uprawnień (egzekwowana przez RLS + walidację w Server Actions):
- Kandydat: edytuje wyłącznie własne dane; widzi własne aplikacje/wiadomości.
- Pracodawca/członek firmy: dostęp tylko do danych własnej firmy; wymaga aktywnego `company_members`.
- Firma A nie widzi danych firmy B.
- Admin: operacje przez kod serwerowy (service role), każda wrażliwa akcja → `audit_logs`.

---

## 7. INVARIANTS — reguły, których NIGDY nie łam

Te reguły wynikają wprost ze specyfikacji i z błędów poprzedniego produktu. Łamanie ich to bug.

1. **Język komunikacji = język ODBIORCY.** E-maile i powiadomienia zawsze w języku odbiorcy.
   Fallback: `recipient.preferred_locale → account_locale → signup_locale → 'en'`.
   NIGDY nie używaj języka nadawcy / sesji pracodawcy / admina / przeglądarki nadawcy / domyślnego serwera.
   Implementacja: `src/lib/i18n/recipient-locale.ts`. Test: `tests/unit/recipient-locale.test.ts`.
2. **Brak tekstów UI na sztywno.** Wszystkie stringi w `src/messages/*.json`. Test wykrywa brakujące/nieużywane klucze.
3. **Wysyłka propozycji idempotentna.** Server action z kluczem idempotencyjnym + transakcja.
   Zapis w DB niezależny od wysyłki e-mail (e-mail w kolejce `email_deliveries`, ponawialny).
   Podwójne kliknięcie / retry z tym samym kluczem = brak duplikatu.
4. **Aplikowanie idempotentne.** Unikat `(candidate_id, job_id)` — jedna aplikacja.
5. **RLS wszędzie.** Każda tabela z danymi użytkownika ma polityki. Domyślnie deny.
6. **Service role key tylko na serwerze.** `src/lib/supabase/admin.ts` nie może trafić do bundle klienta.
7. **Zero trackingu przed zgodą.** GA/Meta Pixel/remarketing ładują się dopiero po zgodzie w kategoriach cookies.
8. **Użytkownik nie widzi technikaliów.** Żadnego stack trace/SQL/surowej odpowiedzi API/komunikatu dostawcy.
   Błędy przez centralny system (`src/lib/errors`), user-facing komunikat z klucza tłumaczenia.
9. **Panele = `noindex`.** `candidate/*`, `employer/*`, `admin/*`, staging — wyłączone z indeksowania i sitemap.
10. **Pliki prywatne przez signed URLs.** Bez publicznych bucketów dla danych wrażliwych.
11. **Formularze:** blokada przycisku podczas zapisu, brak podwójnego kliknięcia, zachowanie danych po błędzie,
    błędy przy polach, przewijanie do pierwszego błędu, jasny sukces.
12. **Dane demonstracyjne oznaczone** (`is_demo = true`) — łatwe do odfiltrowania/usunięcia.

---

## 8. Matching (dopasowanie) — deterministyczny

`src/lib/matching/score.ts`. **Bez niekontrolowanego AI** przy decyzjach. Suma 100 pkt:

| kryterium | pkt |
|---|---|
| zawód i kategoria | 20 |
| umiejętności | 20 |
| lokalizacja (promień) | 15 |
| doświadczenie | 10 |
| dostępność | 10 |
| język | 10 |
| certyfikaty | 5 |
| transport / prawo jazdy | 5 |
| warunki umowy | 5 |

Wynik zwraca: `score` (%), listy `matched` / `missing` / `strengths`, oznaczenie wymagań
obowiązkowych oraz krótkie wyjaśnienie (np. „Dobre dopasowanie: spełniasz 8 z 10 najważniejszych wymagań").

---

## 9. Przepływy krytyczne

**Kandydat → oferta → pracodawca:**
1. Kandydat: rejestracja → onboarding (6 krótkich kroków, każdy zapisywany) → profil (wskaźnik kompletności).
2. Kandydat aplikuje (idempotentnie) → `applications(status=submitted)` → powiadomienie + e-mail do pracodawcy (w języku pracodawcy).
3. Pracodawca zmienia status → `application_status_history` + powiadomienie/e-mail do kandydata (w języku kandydata).
4. Pracodawca wysyła propozycję (idempotentnie) → `offers(status=sent)` → powiadomienie + kolejka e-mail.
5. Kandydat akceptuje/odrzuca → `offer_status_history` + powiadomienie do pracodawcy.

**Wysyłka e-mail (kolejka):**
`enqueueEmail({ type, recipientProfileId, relatedId, payload })` →
wyznacz locale odbiorcy (fallback) → wstaw `email_deliveries(status=queued)` →
worker/route handler renderuje React Email w locale odbiorcy → Resend → zapisz
`status/provider_id/attempts/last_error`. Błąd = retry, nie usuwa rekordu źródłowego.

**Propozycja (idempotentnie):** patrz Invariant #3. Kolejność w server action:
autoryzacja → status firmy `verified` → status oferty `active` → walidacja kandydata →
`INSERT ... ON CONFLICT (idempotency_key) DO NOTHING RETURNING *` w transakcji →
historia → notyfikacja → enqueue e-mail.

---

## 10. CI/CD — self-hosted (WAŻNE)

Cały CI/CD chodzi na **self-hosted runnerach** (wymóg projektu). Zobacz:
- `.github/workflows/ci.yml` — `runs-on: [self-hosted, linux, x64]`, joby: install → lint → typecheck → unit → e2e → build.
- `.github/workflows/deploy.yml` — deploy na Vercel (staging na `develop`/PR, prod na `main`), też self-hosted.
- `docs/SELF_HOSTED_RUNNERS.md` — jak zarejestrować runner (repo/org), wymagane labele, narzędzia (Node 22, przeglądarki Playwright), sekrety.

**Reguły CI:**
- `runs-on` używa labeli `self-hosted` + `linux` + `x64` (dostosuj etykiety do swoich maszyn).
- Nie przełączaj na `ubuntu-latest` bez wyraźnej prośby użytkownika.
- Runner musi mieć: Node 22 (`.nvmrc`), zależności systemowe Playwrighta, dostęp do sekretów (Supabase test, Vercel token).
- Cache zależności (`~/.npm`) — na self-hosted zwykle przez `actions/cache` lub trwały wolumen.

---

## 11. Roadmapa / status (etapy 1–8 wg specyfikacji)

Legenda: `[x]` zrobione · `[~]` częściowo/scaffold · `[ ]` do zrobienia.
**Model kontynuujący: wybierz pierwszy niezaznaczony punkt, zrób, zaznacz, zaktualizuj ten plik.**

> 🔒 **Audyt bezpieczeństwa 2026-07-23** (`docs/audit/audyt-2026-07-23.md`) + remediacja
> (`docs/REMEDIATION-2026-07-23.md`). Zamknięte P0-01..04 oraz P1-01..14 i P2-01 (migracje
> `0011`–`0016` zweryfikowane testami adwersaryjnymi na PostgreSQL 16 — teraz również **w CI**,
> job `rls` na usłudze `postgres:16`, `supabase/tests/*`). Domknięte od poprzedniej fali:
> widoki publiczne firm/ofert (P1-03/04 → `0014`), outbox e-mail (P1-13 → `0012`/`outbox.ts`),
> revoke trackerów + serwerowy log zgód (P1-08/09), pełna CSP (P2-01 → `next.config.mjs`,
> wariant nonce/strict-dynamic = follow-up z E2E), integracyjne testy RLS w CI. Zależności:
> Dependabot 0 critical / 0 high (23 moderate wymagają majorów next-intl v4 / Sentry v9+ — osobna
> migracja). Statusy poniżej rozdzielają `schema/scaffold` od `backend flow` i `tested` —
> nie oznaczaj funkcji jako gotowej bez działającego przepływu.
>
> 🔒 **Audyt multidyscyplinarny 2026-07-24** (8 dziedzin, adwersaryjna weryfikacja; 45 potwierdzonych:
> 0×P0, 7×P1, 14×P2, 24×P3). Remediacja: migracje `0020`/`0021` + naprawy app-layer. Zamknięte P1:
> maszyna stanów offers/applications egzekwowana w BAZIE (koniec fałszowania akceptacji oferty i skoków
> statusu przez pracodawcę bezpośrednim PATCH — dowód: `supabase/tests/rls.sql` sekcja I), opt-out e-mail
> (`enqueue_email` czyta `notification_preferences`), spójny `get_public_jobs_count` (locale), StatusPill
> kontrast AA, e-maile Auth w języku odbiorcy (Send Email Hook `/api/auth/email-hook`). P2/P3: revoke PII,
> relacja send_offer, respond_to_offer guard, atomowy claim outboxa + `get_conversation_summaries` (0021),
> indeksy trigram, React `cache()` w panelach, lejek z historii, focus-trap/aria/ARIA, rate-limit IP,
> timingSafeEqual, magic-bytes uploadu, JSON-LD escape, noindex auth, OG/hreflang. **Odłożone (P3, świadomie):**
> `is_demo` na tabelach procesowych (Inv. #12 — prod nie ładuje seed), retencja `email_deliveries` (cron),
> nonce/strict-dynamic CSP (E2E). Weryfikacja: tsc/lint/vitest/build + RLS+seed (PG16) + Playwright — zielone.
>
> 🔒 **Weryfikacja remediacji 2026-07-24** (adwersaryjna kontrola napraw 0020–0022 + email-hook; 6 potwierdzonych:
> 0×P0, 0×P1, 2×P2, 4×P3). Domknięte migracją `0023` + app-layer: (P2) `get_conversation_summaries` usunięto
> `counterparty_name` (SECURITY DEFINER omijało RLS na `profiles` — kandydat mógł wprost pobrać imię+nazwisko
> rekrutera; app-layer i tak rozwiązuje drugą stronę pod RLS); (P2) email-hook obcina prefiks `v1,whsec_`
> (Supabase podaje sekret z `v1,`) — inaczej wszystkie e-maile Auth failowały weryfikację; (P3) email-hook:
> kontrola świeżości `webhook-timestamp` (±300 s, anty-replay) + fail-closed 500 zamiast „cichego" 200 przy
> dryfcie env; (P3) `getMyApplications` używa nowego `get_applied_jobs_display` (własne aplikacje niezależnie
> od statusu oferty — koniec pustych tytułów dla ofert zamkniętych/unverified; dowód: `rls.sql` I9); (P3)
> nieaktualny komentarz outbox.ts. Weryfikacja: tsc/lint/vitest/build + RLS+seed (PG16) + Playwright — zielone.
>
> 🔒 **Audyt zewnętrzny 2026-07-24** (`AUDYT_APLIKACJI_PRACUJBE_...md`, ~60 ustaleń: 0×P0, ~14×P1,
> ~20×P2, reszta P3; NO-GO na produkcję). Teza: **niespójna granica zaufania** — flow mają bezpieczne
> RPC, ale RLS/granty pozwalały klientowi na bezpośredni DML omijający walidację/limity/powiadomienia.
> Remediacja falami (weryfikacja adwersaryjna na PG16 przed każdą naprawą):
> **Wave A (0025) — ZROBIONE:** RPC-only DML — `revoke insert/update/delete` na applications/offers/
> conversations/conversation_members/messages od anon/authenticated (zostaje SELECT pod RLS; SECURITY
> DEFINER RPC + triggery integralności piszą dalej). `withdraw_application` RPC (koniec bezpośredniego
> PATCH aplikacji). SEC-01: `rate_limit_hit` odebrany anon/authenticated → woła go tylko service_role
> (admin client); usunięto zduplikowany limiter w `actions/jobs.ts`. Dowód: `rls.sql` sekcja J
> (J1–J8: bezpośredni INSERT/UPDATE/DELETE odrzucany, withdraw RPC działa/idempotentny/nie-cudzy,
> limiter tylko service_role).
> **Wave B (0026) — ZROBIONE:** SEC-03 — `get_public_jobs`/`_count` clamp p_limit∈[1,100],
> p_offset≤10000, keyword/city ≤100 znaków (`left`), locale z allow-listy. SEC-04 — twarde sufity
> długości pól tekstowych jako CHECK na tabelach (applications.message/phone/idem, offers.message/idem,
> messages.body, companies.name/vat) — egzekwowane niezależnie od ścieżki (RPC/trigger/definer). Dowód:
> `rls.sql` sekcja K (K1 clamp limitu, K1b długi keyword, K1c allow-lista locale, K2/K2b CHECK długości).
> **Wave D (0027) — ZROBIONE:** SEC-08 — dostęp do rozmowy firmowej wymaga AKTYWNEGO członkostwa
> (`is_conversation_member` gejtuje po `company_id`: aktywny członek LUB strona kandydata; były pracownik
> z `is_active=false` traci dostęp — jeden chokepoint domyka RLS odczytu i RPC send_message/mark_read).
> SEC-11 (część) — `company_can_view_candidate` filtruje `deleted_at is null` (soft-deleted relacja nie
> daje PII; okno retencji czasowej = decyzja polityki, odłożone). Dowód: `rls.sql` sekcja L. **Legal
> (FUN-09) — safe default:** strony prawne/informacyjne (placeholder) → `noindex` (`_legal/legal-page.tsx`)
> i usunięte z sitemap; E2E asercja noindex regulaminu.
> **Wave E1 (0028) — ZROBIONE:** FUN-04 — koniec cichej utraty danych onboardingu: transakcyjne RPC
> `set_candidate_skills/languages/certificates` (replace-all, dedup, RPC-only DML na relacjach
> kandydata); kroki 3/5 realnie zapisują. Dowód: `rls.sql` sekcja M.
> **Wave E1b (0029) — ZROBIONE:** FUN-05 — kompletność liczona w DB (`finish_onboarding`), a nie
> ustawiana przez klienta; guard trigger blokuje `authenticated` przed zmianą `profile_completed`/
> `is_searchable` (kolumnowy REVOKE nie działa przy grancie table-level); `set_candidate_searchable`
> (opt-in tylko dla kompletnego profilu). Dowód: `rls.sql` sekcja N.
> **Wave E2 (0030) — ZROBIONE:** FUN-03 — relacje `job_languages`/`job_certificates` (RLS jak
> job_skills); kreator (krok 7) realnie zapisuje języki i certyfikaty; `get_public_job` zwraca
> języki (koniec pustej listy), `get_job_match_profile` zwraca języki+certyfikaty → matching je
> uwzględnia. Dowód: `rls.sql` sekcja O.
> **Wave E3 (0031) — ZROBIONE:** FUN-01 — transakcyjne `publish_job` (autoryzacja + firma
> verified + status=draft + KOMPLETNOŚĆ: tytuł/miasto/region bez placeholderów, tłumaczenie,
> wymaganie obowiązkowe) + guard trigger `guard_job_publish` (aktywacja oferty tylko przez RPC;
> klient nie ustawi status='active' bezpośrednio). Dowód: `rls.sql` sekcja P. FUN-02 (pełna
> transakcyjność per-krok) — częściowo: publish atomowy, relacje replace-all; pełne owinięcie
> każdego kroku w RPC = follow-up.
> **Wave C1 (0032) — ZROBIONE:** SEC-10 (owner invariants) — trigger `enforce_owner_invariants`
> na company_members: rolę owner nadaje/odbiera tylko aktywny owner; nie można zdemotować/
> usunąć/dezaktywować OSTATNIEGO aktywnego ownera (koniec przejęcia firmy przez admina i
> osierocenia firmy). Dowód: `rls.sql` sekcja Q.
> **Wave C2 (0033) — ZROBIONE:** SEC-09 (capability RBAC) — `can_manage_jobs`/`is_job_manager`
> (recruiter+ = owner/admin/recruiter). ZAPIS ofert (jobs + job_translations/requirements/skills/
> languages/certificates), `publish_job` i dostęp do PII kandydata (`company_can_view_candidate`)
> wymagają recruiter+ — zwykły `member` traci prawa rekrutacyjne (odczyt ofert firmowych zostaje).
> Dowód: `rls.sql` sekcja R. Bramkowanie propozycji/zmian statusu do recruiter+ = follow-up C3
> (te ścieżki już wymagają członkostwa i idą przez SECURITY DEFINER RPC).
> **Wave F — SEC-19 (fail-closed env) — ZROBIONE:** jawny `APP_MODE` (`env.appMode`/`isProductionMode`/
> `isAppReady`); w trybie produkcyjnym brak konfiguracji Supabase → middleware zwraca **503
> maintenance** (nie fikcyjny tryb demo), a `GET /api/health` → 503 `{status:"unconfigured"}`
> (readiness dla monitoringu). Demo (lokalnie/staging/E2E) bez zmian. Zweryfikowane runtime
> (503 na stronie i /api/health).
> **Wave F — FUN-06 (matching) — ZROBIONE (część):** `scoreMatch` — praca zdalna znosi
> ograniczenie lokalizacji (pełne punkty), promień dojazdu (`radiusKm>=50` przy dopasowaniu
> regionu → pełne punkty), wymagania OBOWIĄZKOWE jako próg (niespełnione → wynik nie „good",
> cap 65). `get_job_match_profile` zwraca `remote` (0034). i18n `match.criteria` (remoteJob/
> withinCommuteRadius). Testy: matching.test 10 (było 7). **Odłożone (FUN-06):** poziomy
> języków/certyfikatów (wymaga rozszerzenia MatchCandidate/MatchJob o levele) + geokodowanie.
> **Wave F — FUN-07 (multi-company) — ZROBIONE:** jeden cookie-aware kontekst aktywnej firmy
> (`src/lib/company-context.ts`, cookie `pb_active_company` WALIDOWANA względem członkostw —
> nie ufamy jej), akcja `setActiveCompany` (walidacja + cookie + revalidate), REALNY przełącznik
> `CompanySwitcher` w sidebarze; wszystkie pickery (jobs createDraft, employer/company/billing
> loadContext, company action) czytają aktywną firmę zamiast „pierwszego członkostwa"; panel
> pokazuje realną firmę i użytkownika (koniec atrapy „AGO Jobs & HR / Jan Kowalski" — FUN-13).
> **Wave F — SEC-17 (seed) — ZROBIONE:** seed DEMO ma bezpiecznik — odmawia uruchomienia na
> bazie z realnymi (nie-demo) firmami/ofertami (ochrona przed przypadkowym seedem znanych kont
> na staging/produkcji); czysta/lokalna/CI baza przechodzi. Test negatywny w `test-seed.sh`.
> **P1 możliwe autonomicznie — ZAMKNIĘTE** (SEC-01/03/04/05/06/07/08/09/10/17/19, FUN-01/03/04/
> 05/06(część)/07). **FUN-08 (billing) — ZROBIONE:** realny Stripe (checkout/webhook/cancel,
> webhook = źródło prawdy, provider-gated). **P1 wymagające infra/treści (otwarte):** CI-01/02/07
> (separacja runnerów + twarda bramka RLS/Storage — infra), FUN-09 (realna treść prawna — noindex
> safe default zrobiony). **P2/P3 — ZROBIONE:** SEC-16 (0035, in_app opt-out trigger),
> SEC-15 (outbox: sprawdzanie błędów zapisu po wysyłce + log do reconciliacji), SEC-14 (0036,
> `processed_webhooks` dedup po event.id/webhook-id + limit rozmiaru body dla Stripe/email-hook;
> dowód rls.sql T). **C3 (0037) — ZROBIONE:** propozycje (enforce_offer_integrity
> INSERT → can_manage_jobs) i zmiany statusu aplikacji (transition_application → is_job_manager)
> wymagają recruiter+; respond_to_offer (kandydat) bez zmian. Dowód: rls.sql sekcja U.
> **CI-08 (SCA) — ZROBIONE:** osobny job `sca` (`npm audit --audit-level=high`) na self-hosted
> runnerze blokuje CI przy podatności o severity >= high (obecnie 0). **QA-01 (a11y w CI) —
> ZROBIONE:** bramka axe-core (`@axe-core/playwright`) w `tests/e2e/a11y.spec.ts` (uruchamiana w
> jobie `e2e`) blokuje przy naruszeniach WCAG 2.x A/AA critical/serious na home/liście ofert/
> logowaniu/rejestracji; domknięte realne naruszenia kontrastu tokenami: `--muted-foreground`
> przyciemniony do AA (`#566881`), nowy `--accent-on-dark` (`#60A5FA`) dla „.be" na granatowej
> stopce, tekst akcentu na tincie `bg-accent/10` → `text-accent-dark`, tekst stanu (verified/%,
> „zawsze wł.") → `-text` warianty (`text-success-text`), usunięty zdublowany landmark `<main>`
> na stronie głównej. **Pozostałe follow-up (nieautonomiczne):** SEC-12 (skan CV — wymaga AV/usługi
> zewn.), FUN-02 (pełna transakcyjność każdego kroku kreatora — duży refactor), CI-01/02/07
> (separacja runnerów + twarda bramka RLS/Storage — infra), FUN-09 (treść prawna do zatwierdzenia),
> perf/CWV (Lighthouse w CI — pozostała część audytu H).

### Etap 1 — fundament
- [x] Architektura, stack, konfiguracja projektu (Next 15, TS strict, Tailwind)
- [x] System wizualny: tokeny kolorów, typografia (Inter), globals.css
- [x] i18n: routing `[locale]`, next-intl, pliki `pl/nl/fr/en`, middleware
- [x] Model danych: migracje SQL (schemat + enumy + indeksy)
- [x] RLS: polityki bazowe
- [x] Role i routing paneli (candidate/employer/admin, noindex)
- [x] CI/CD na self-hosted (ci.yml, deploy.yml) + docs
- [x] Centralny system błędów + kody + Sentry (config)
- [ ] shadcn/ui — pełny zestaw komponentów (na razie podstawowe)

### Redesign wg makiet — `docs/DESIGN_SCREENS.md` (ZROBIONE, UI)
- [x] Paleta granatowa: `globals.css` + `tailwind.config.ts` (`--primary` #0F2A47 + `--accent` #2563EB), `manifest.ts` theme_color
- [x] Komponenty z makiet: JobCard(wiersz+hover), FilterSidebar+FilterSheet, StatusPill, StatCard, MatchBar, Stepper, DashboardShell(sidebar+bottom tab bar), NotificationsDropdown, Toast, ApplyModal, RecruitmentFunnel, PricingPackageCard, BelgiumSkyline (hero SVG)
- [x] Odwzorowanie 7 ekranów (home, lista+filtry, detal+modal, panel kandydata, onboarding, panel pracodawcy, stany cookies) — **UI gotowe**; panele na danych DEMO (podpięcie realnych danych = warstwa backendu, niżej)
- [x] Restrukturyzacja layoutów: root=(html/body/providery/cookies), `(public)/layout`=Header+Footer, `(auth)/layout` minimalny, panele=własny layout (DashboardShell, noindex)

### Etap 2 — strony publiczne
- [x] Strona główna (hero + sekcje) SSR — redesign wg makiety 01
- [x] Lista ofert + filtry (FilterSidebar/FilterSheet, chipy, sort, paginacja) — wg makiety 02; infinite scroll opcjonalnie później
- [x] Szczegóły oferty + JobPosting JSON-LD + ApplyModal — wg makiety 03
- [x] Landing pages: `/praca` (hub) + `/praca/kategoria/[category]` + `/praca/miasto/[city]` (filtrowane przez getJobs, generateStaticParams, metadata+hreflang, BreadcrumbList JSON-LD, indeksowalne)
- [x] SEO: sitemap.ts (pusty na non-prod), robots.ts, metadata + hreflang, X-Robots-Tag
- [x] Poradniki (blog) + Article JSON-LD — `/poradniki` + `/poradniki/[slug]` (6 poradników w `src/lib/guides/guides.ts`)

### Etap 3 — kandydat
- [x] Rejestracja / logowanie / reset / potwierdzenie e-mail — strony + Supabase Auth actions, callback (P1-01). Guardy tras paneli komplet: `/candidate` (auth + rola≠employer→/employer), `/employer` (auth + aktywne `company_members`→/rejestracja-pracodawca), `/admin` (auth + rola=admin, else `notFound`), wszystkie `force-dynamic` + noindex.
- [x] Onboarding kandydata (6 kroków) — UI + realny zapis per krok do DB (`saveOnboardingStep`, RHF + stan zapisu)
- [x] Panel kandydata — realne dane pod sesją (RLS) + akcje (zapis oferty, wycofanie aplikacji, odpowiedź na propozycję), noindex; fallback demo bez env

### Etap 4 — pracodawca
- [x] Konto firmy + weryfikacja — `/employer/firma` (create przez `create_company_with_owner`, edycja, baner statusu) + weryfikacja przez admina (`admin_set_company_status`, 0019)
- [x] Panel pracodawcy — realne dane pod sesją (RLS) + akcje (zmiana statusu aplikacji, wysyłka propozycji), noindex; fallback demo bez env
- [x] Kreator oferty (9 kroków, autozapis draftu, publikacja z kontrolą `verified`) — `src/lib/actions/jobs.ts` + `JobWizard`

### Etap 5 — procesy
- [x] Matching (logika + test jednostkowy + integracja z UI) — deterministyczny `scoreMatch` (test), RPC `get_job_match_profile` (0024, tokeny wymagań oferty), loader `getMyJobMatch` (profil kandydata pod RLS + oferta przez RPC), wyspa kliencka `JobMatchCard` na detalu oferty (SSR/SEO bez zmian dla anonimów; kandydat widzi „Twoje dopasowanie" %, atuty, braki). i18n `match` (pl/nl/fr/en). Dowód RPC: `rls.sql` I10.
- [x] Aplikacje — RPC `apply_to_job`/`transition_application` (idempotentne, historia auto, kolejka e-mail) + server actions + wpięcie do UI paneli/ApplyModal (zweryfikowane na PG)
- [x] Propozycje pracy — RPC `send_offer`/`respond_to_offer` (idempotentne, outbox, niezależne od e-maila) + server actions + wpięcie do UI paneli (zweryfikowane na PG)
- [~] Wiadomości — konwersacje/wątek/wysyłka/przeczytania gotowe (RPC 0016 + UI `/…/wiadomosci`, zweryfikowane na PG16); **do zrobienia:** załączniki, zgłoszenia

### Etap 6 — komunikacja
- [x] Wybór języka odbiorcy (fallback) — util + test + `resolve_recipient_locale()` w DB (INVARIANT #1 egzekwowany przy kolejkowaniu)
- [~] Kolejka e-mail + worker + ponawianie — outbox (`email_deliveries`: attempts/next_attempt_at/payload), worker `src/lib/email/outbox.ts` + route `/api/email/process` (sekret) gotowe; realna wysyłka wymaga `RESEND_API_KEY`
- [~] Szablony React Email PL/NL/FR/EN — komplet typów w `src/emails`; podpięte do outboxa (payload z RPC)
- [x] Powiadomienia in-app + preferencje — in-app (RPC 0016, dropdown+badge, „oznacz wszystkie") + ekran preferencji `/candidate/ustawienia` i `/employer/ustawienia` (upsert `notification_preferences` pod RLS)

### Etap 7 — admin / prywatność / płatności
- [~] Cookies: baner + kategorie + centrum ustawień + zapis zgód (podstawa)
- [x] Panel administratora — `/admin/**` (guard role='admin'→notFound, noindex): dashboard, firmy
  (weryfikuj/odrzuć/zawieś), zgłoszenia (moderacja), użytkownicy; odczyt service-role, zapis przez RPC (0019)
- [x] Audit logs — triggery AFTER (0017) na applications/offers/companies + `write_audit`; actor=auth.uid()
- [x] Płatności / subskrypcje / faktury / kody rabatowe — REALNY Stripe (FUN-08), provider-gated:
  `startCheckout` tworzy sesję Stripe Checkout (subskrypcja, inline `price_data` z `PLANS`, kupon z
  kodu rabatowego), `cancelSubscription` = `cancel_at_period_end`, webhook `/api/stripe/webhook`
  (weryfikacja podpisu) = ŹRÓDŁO PRAWDY: synchronizuje `subscriptions/invoices/payments` service-rolem
  (klient nie pisze tych tabel). Billing = rola owner/admin. Bez `STRIPE_SECRET_KEY` = tryb demo.

### Etap 7 — hardening operacyjny (bezpieczeństwo/CI)
- [x] CSP (P2-01) — `next.config.mjs` (default/object/frame-ancestors/base/form-action + zawężone
  connect/img/font, GA/Meta/Supabase/Sentry). Wariant nonce/strict-dynamic = follow-up (E2E).
- [x] Rate limiting aplikacyjny — RPC `rate_limit_hit` (`0015`) wpięty w auth/apply/wiadomości.
- [x] Integracyjne testy RLS/triggerów w CI — job `rls` (usługa `postgres:16`), `scripts/test-rls.sh`,
  `supabase/tests/{shim,rls}.sql`; `npm run test:rls`.
- [x] Zależności: **`npm audit` 0 podatności** (next-intl v4 + @sentry/nextjs v10 + vitest 3 + overrides rollup/vite/esbuild/sharp/prismjs/postcss).
- [x] `next/font/local` (offline Inter), PWA (ikony/manifest/service worker), storage signed URLs + upload CV (0018, Invariant #10).

### Etap 8 — jakość
- [x] Testy: Vitest (matching, recipient-locale, i18n keys, error-keys), integracyjne RLS+seed w CI (`postgres:16`), Playwright (smoke/seo/flows)
- [~] Testy Playwright: języki/detal oferty/CTA/noindex paneli/cookies/SEO gotowe (`flows.spec`+smoke+seo, 12 pass); do rozbudowy: aplikowanie/propozycje pod realną sesją
- [~] Wydajność / Core Web Vitals / dostępność (audyt) — **dostępność (a11y) ZROBIONE:** bramka
  axe-core w CI (`tests/e2e/a11y.spec.ts`, uruchamiana w jobie `e2e`) blokuje przy naruszeniach
  WCAG 2.x A/AA o wadze critical/serious na kluczowych stronach publicznych (home, lista ofert,
  logowanie, rejestracja); domknięte realne naruszenia kontrastu (tokeny). **Do zrobienia:**
  Core Web Vitals / audyt wydajności (Lighthouse w CI).
- [x] Dokumentacja (architektura, setup, checklisty) — podstawa
- [x] Dane seed pełne — 10 firm / 50 ofert / 40 kandydatów / 48 aplikacji / 80 dopasowań; ładuje się bez błędów (guard CI `test:seed`)

---

## 12. Komendy

```bash
npm install            # instalacja
npm run dev            # dev server (http://localhost:3000/pl)
npm run build          # build produkcyjny
npm run start          # serwer produkcyjny
npm run lint           # ESLint
npm run typecheck      # tsc --noEmit
npm run test           # Vitest (unit)
npm run test:e2e       # Playwright
npm run verify         # lint + typecheck + test (uruchamiaj przed commitem)
npm run db:reset       # (supabase CLI) reset + migracje + seed [lokalnie]
```

---

## 13. Konwencje kodu

- Komponenty serwerowe domyślnie; `"use client"` tylko gdy potrzebne (interakcje/hooki).
- Walidacja I/O = Zod; typy z `z.infer`. Brak `any` (strict).
- Teksty przez `useTranslations`/`getTranslations` (next-intl) — nigdy literały w JSX.
- Dostęp do DB: przez klienty z `src/lib/supabase`. Operacje wrażliwe = Server Actions/route handlers.
- Błędy: rzucaj `AppError` z kodem (`src/lib/errors`); mapuj na komunikat tłumaczony.
- Nazwy plików: `kebab-case`; komponenty React: `PascalCase`.
- Każdy nowy przepływ krytyczny = test (unit i/lub e2e).

---

## 14. Uwaga o zakresie

Specyfikacja opisuje produkt wielkości pracy zespołu na tygodnie. Repo jest budowane
**etapami** (patrz roadmapa). Nie udawaj, że wszystko jest gotowe — aktualizuj sekcję
statusu zgodnie z rzeczywistością po każdej zmianie. Kluczowe procesy mają być **realne**
(prawdziwa DB, nie mock) — patrz sekcja 33 specyfikacji: bez mock API dla rejestracji,
logowania, profilu, ofert, aplikacji, propozycji, wiadomości, powiadomień, języków, cookies.
