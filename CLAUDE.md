# CLAUDE.md — Pracuj.be

> **Przeznaczenie tego pliku.** To jest mapa i kontrakt projektu dla kolejnych modeli
> (Claude Code / inne LLM) oraz ludzi kontynuujących pracę. Zanim cokolwiek zmienisz —
> przeczytaj ten plik w całości. Opisuje: czym jest produkt, jak zbudowana jest aplikacja,
> jakie są niezmienne reguły (invariants), co jest już zrobione, a co pozostaje do zrobienia
> (roadmapa etapów 1–8 ze specyfikacji).

---

## 0. TL;DR dla modelu kontynuującego pracę

Railway jest jedynym docelowym hostingiem: jedna usługa `production` wdrażana
z `main`, z włączonym natywnym `Wait for CI`. Plan, issues i instrukcje są w
`docs/railway/README.md` oraz `docs/railway/STATUS.md`. `APP_MODE=production`
ustaw jawnie w Railway; `VERCEL_ENV` nie wybiera trybu aplikacji. Pozostałości
Vercela usuwaj dopiero razem z zastępującym je przepływem migracyjnym.
Blokery startu (kod vs właściciel/infra/prawnik, stan 26.09.2026: migracja 0137, brak
usług cron, tryb demo za bramką hasła): `docs/LAUNCH_CHECKLIST.md` §1.

1. **Stack:** Next.js 15 (App Router, React Server Components) · TypeScript `strict` · Tailwind + shadcn/ui · PostgreSQL Railway · Better Auth · Zod · React Hook Form · Resend + React Email · webhook błędów Discord · Vitest + Playwright · Railway.
2. **CI działa na GitHub-hosted runnerach (`ubuntu-latest`, pula minut Actions — decyzja właściciela 2026-09-23); wdrożenie prowadzi natywna integracja Railway** (patrz `.github/workflows/*`, `docs/DEPLOYMENT.md` i sekcja „CI/CD" niżej). Oszczędzaj minuty: nie wypychaj pustych commitów ani zbędnych przebiegów.
3. **Niezmienne reguły (NIGDY nie łam):** patrz sekcja „Invariants". Najważniejsze: język e-maili = język odbiorcy; wysyłka propozycji idempotentna; brak service-role key w przeglądarce; brak trackingu przed zgodą; RLS na wszystkim; żadnych tekstów UI na sztywno.
4. **Gdzie co jest:** patrz „Struktura katalogów".
5. **Co dalej:** patrz „Roadmapa / status" — sekcja z checkboxami. Wybierz kolejny niezaznaczony punkt.
6. **Zawsze uruchom przed commitem:** `npm run verify` (lint + typecheck + unit). E2E gdy dotykasz przepływów.
7. **Praca wieloma sesjami:** prace idą równolegle w wielu sesjach Claude Code, a jedna
   sesja-integrator scala PR-y, prowadzi kolejkę migracji i rutyny. Podręcznik (role,
   stałe decyzje właściciela, procedura scalania, kolejka migracji, szablon sesji,
   Railway): `.claude/skills/integration-loop/SKILL.md`. Sesja potomna: nie scalaj,
   migracja na numerze tymczasowym, ostateczny nada integrator.

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

> AKTUALIZACJA 2026-09-21: nowym źródłem wyglądu jest docs/design/people-passport/README.md i zatwierdzony prototyp. Biel, czerwień, czerń i logo .be na czerwonym kafelku zastępują historyczną paletę. Wdrożenie etapowe: issues #2–#7; historyczne checklisty nie oznaczają ukończenia nowego stylu.

Źródło wyglądu: `docs/design/people-passport/README.md` i prototyp w tym katalogu. Starsze makiety w `docs/design/screens/` mają wartość historyczną.

**Zasady:** białe tło, oszczędna czerwień, czarny tekst, zaokrąglone elementy i fotografie ludzi w pracy. Bez ciężkich gradientów i nadmiaru dekoracji. Karty ofert mają układ paszportu z czytelnymi polami; przy braku wynagrodzenia pozostałe pola wykorzystują miejsce.

**Paleta:** tokeny w `src/app/globals.css`, mapowane przez Tailwind. Kolor marki: czerwień około `#D92932`, tekst około `#151515`, tło `#FFFFFF`. Kolory semantyczne sukcesu, ostrzeżeń i błędów zachowują swoje znaczenie. Nie wpisuj hexów w komponentach. Kontrast WCAG 2.2 AA obowiązkowy.

**Typografia:** lokalny DM Sans jak w prototypie (`next/font/local`, podzbiór ~42 KB z polskimi znakami, osie wght 400–800 i opsz; sekcje `.pp-*` mają `font-optical-sizing: none` = opsz 9, czyli plik, który prototyp dostaje z Google Fonts; SIL OFL 1.1 — `assets/fonts/DMSans-OFL.txt`, przepis `scripts/subset-font.py`). Zmiana fontu wymaga sprawdzenia czytelności, budżetu fontów i CLS (`perf-budget-static.mjs`, `perf-lab.mjs`).

**Kalka prototypu (#5/#7, decyzja właściciela 2026-09-24: „kalka jeden do jednego”):** nagłówek, hero, wyszukiwarka, „Najnowsze oferty”, karta-paszport, „W czym jesteś dobry?” i dolny pasek stopki mają reguły przepisane dosłownie z `docs/design/people-passport/prototype` (style.css → directions.css → people.css → conditions.css → extended.css) jako klasy `.pp-*` w `src/app/globals.css`; kolory tylko jako tokeny `--pp-*` w `:root`. Progi `@container` prototypu (1050/950/850/760/600/500 px) są media queries. Siatka ofert = to, co prototyp renderuje: 2 kolumny, 1 ≤ 950 px (conditions.css nadpisuje 3 kolumny z people.css); lista z filtrami 1 kolumna. Odstępstwa (tylko wymogi repo): #777 → #767676 (AA), fokus widoczny, stany demo i statusy karty w wierszu firmy, przycisk menu ≤ 850 px, sekcje aplikacji spoza prototypu pod „W czym jesteś dobry?”. Zmieniając te widoki, porównuj zrzuty 1280/390 px z prototypem (nakładka); nie owijaj kart ramką `divide-y` (podwójne krawędzie).

**Weryfikacja (#7):** matryca zgodności z prototypem `docs/design/people-passport/MATRIX.md` (każdy ekran prototypu i trasa aplikacji, 1280/390 px, % pikseli > 40/255 + style kluczowych elementów), pomiar do powtórzenia `node scripts/design/compare-prototype.mjs` (poza CI, aplikacja w trybie demo). Lista ofert: nagłówek `.pp-list-header` + wyszukiwarka `.pp-search` jak na stronie głównej; strony treściowe: H1 `.pp-page-title`; podstrony paneli: `H1_EXTENDED` (40/30 px). Stara paleta (granat #0F2A47/#2563EB) i Inter usunięte — strażnik `tests/unit/legacy-palette.test.ts` z kontrolą ujemną.

**Logo:** komponent `src/components/brand/Logo.tsx` — czarne „pracuj” i białe „.be” na czerwonym, zaokrąglonym kafelku. Favicon, ikony PWA i `og.png` (#7) = ten sam znak z konturów DM Sans 800 (`scripts/brand-glyphs.py` → `assets/brand/logo-glyphs.json` → `scripts/generate-icons.mjs`; opis `public/ICONS_README.md`, strażnik `brand-assets.test.ts`).

**E-maile (#7):** layout `src/emails/_components.tsx` = kalka `prototype/materials/newsletter.html` (tło #f4f4f4, biała kolumna 600 px, logo jak w nagłówku, H1 36 px, akapity 16 px/1,7 #666, przycisk z promieniem 11 px, sekcje „paszportu” z linią #e5e5e5, stopka #f8f8f8). Kolory wyłącznie z `emailPalette` (test `email-palette.test.tsx` odrzuca inne, z kontrolą ujemną). Odstępstwa klienta pocztowego: style inline + tabele, bez webfontów (`'DM Sans', Arial, sans-serif`), #777 → #767676, tekst stopki #6b6b6b (AA na #f8f8f8); bez nadtytułu „PRACA W BELGII” i czerwonej drugiej linii nagłówka (treść maili bez zmian). Typografię pól paszportu porównuje z prototypem test `email-passport-prototype.test.tsx` (z kontrolą ujemną).

---

## 3. Architektura techniczna

- **Framework:** Next.js 15, App Router, React 19, React Server Components domyślnie.
  Klienckie komponenty (`"use client"`) tylko gdy naprawdę potrzebne (formularze, interakcje).
- **Rendering:** publiczne strony SSR/SSG (oferty statycznie generowane/rewalidowane), panele SSR + wyspy klienckie.
- **Język/typy:** TypeScript `strict: true`. Walidacja I/O przez **Zod** (jedno źródło typów: `z.infer`).
- **UI:** Tailwind CSS + **shadcn/ui** (dostępne komponenty Radix). Komponenty w `src/components/ui`.
- **Dane (#25):** PostgreSQL Railway bez PostgREST — `src/lib/db/portal.ts` (`getPortalIdentity` z sesji Better Auth,
  `withPortalTransaction` = RLS jako użytkownik, `withServiceRole` = osobna pula `DATABASE_SERVICE_URL` tylko dla
  workera/webhooków/crona/odczytów admina), zapytania `src/lib/db/sql.ts`. Konwencje: `docs/railway/WARSTWA_DANYCH.md`.
  Testy: atrapa `tests/helpers/fake-db.ts`, PG16 `tests/integration/portal-*.test.ts`.
- **Auth/Storage:** konta i sesje **Better Auth** na PostgreSQL Railway (#24, `src/lib/auth/*`), pliki CV w prywatnym
  buckecie Railway (#26, `src/lib/files/*`). **Supabase usunięte (#27)** — brak SDK, zmiennych i hooka GoTrue; strażnik
  `tests/unit/no-supabase-runtime.test.ts` (z kontrolą ujemną) odrzuca import `@supabase/*`, zmienne i hosty Supabase
  w `src/`. Katalog `supabase/` to wyłącznie migracje SQL i testy RLS (nazwa historyczna).
- **Bezpieczeństwo danych:** **Row Level Security** na każdej tabeli. Operacje wrażliwe = Server Actions/Route Handlers.
- **Formularze:** React Hook Form + Zod resolver. Server Actions do zapisu.
- **E-mail:** **Resend** + **React Email** (szablony w `src/emails`), wysyłka przez kolejkę (`email_deliveries`).
- **Błędy/monitoring:** webhook Discorda `ERROR_WEBHOOK_URL` (#571, `src/lib/error-webhook`, tylko serwer; Sentry usunięte). Centralny system błędów `src/lib/errors`, `captureError` w `src/lib/error-report.ts`.
- **Testy:** **Vitest** (unit/integration) + **Playwright** (e2e). Patrz `tests/`.
- **Hosting:** **Railway**, jedna produkcja z `main`; natywne `Wait for CI` blokuje wdrożenie do zielonego CI. Migracje SQL są wersjonowane w repozytorium.
- **i18n:** `next-intl`, routing z prefiksem locale (`/pl`, `/nl`, `/fr`, `/en`), teksty w `src/messages/*.json`.

---

## 4. Struktura katalogów

```
pracujbe/
├─ CLAUDE.md                      # ten plik — mapa/kontrakt projektu
├─ README.md                      # szybki start + skrypty
├─ .github/workflows/             # CI na ubuntu-latest (GitHub-hosted)
│  └─ ci.yml                      # lint · typecheck · unit · e2e · build
├─ docs/                          # dokumentacja rozszerzona
│  ├─ ARCHITECTURE.md             # architektura, dostęp do danych, role
│  ├─ DEPLOYMENT.md · DOMAIN_SETUP.md
│  ├─ railway/                    # PostgreSQL, Better Auth, bucket, migracje, STATUS.md, OPERATIONS.md
│  ├─ DATABASE.md · DATA_RETENTION.md · GUEST_APPLY.md · JOB_FUNNEL.md · TELEMETRY_PRIVACY.md
│  ├─ EMAILLABS_SETUP.md · RESEND_SETUP.md · TURNSTILE.md · CSP_NONCE_ANALYSIS.md
│  ├─ AI_*.md · ESCO.md · PRODUCT_DECISIONS.md · RELEASE_1_0.md
│  ├─ SECURITY_CHECKLIST.md · PERFORMANCE_CHECKLIST.md · LAUNCH_CHECKLIST.md
│  ├─ design/people-passport/     # źródło wyglądu (prototyp, MATRIX.md)
│  ├─ legal-drafts/               # PROJEKTY dokumentów prawnych (nieopublikowane)
│  ├─ STAGING.md                  # staging wycofany (decyzja 2026-09-21)
│  └─ ARCHIWALNE: SUPABASE_SETUP.md (stan sprzed #27), SELF_HOSTED_RUNNERS.md (CI przed 2026-09-23),
│     audit/, REMEDIATION-2026-07-23*.md, DESIGN_SCREENS.md
├─ database/
│  ├─ bootstrap/                  # role i tożsamość (stały bootstrap)
│  └─ auth/                       # schemat Better Auth (`auth.*`)
├─ supabase/                      # nazwa historyczna — tylko SQL, bez Supabase w runtime (#27)
│  ├─ migrations/                 # *.sql wersjonowane (kolejność wg prefiksu, przeplatane z database/)
│  ├─ tests/                      # rls.sql, role-guard.sql (npm run test:rls)
│  ├─ rollback/                   # ręczne skrypty wycofania (np. 0097 ESCO)
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

## 5. Model danych (PostgreSQL Railway)

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
6. **Uprawnienia service_role tylko na serwerze.** Pula `withServiceRole` (`DATABASE_SERVICE_URL`, `src/lib/db/portal.ts`, `server-only`) nie może trafić do bundle klienta.
7. **Zero trackingu przed zgodą.** Beacon Cloudflare Web Analytics (#570 — zamiast Google Analytics i Meta Pixel, usunięte) ładuje się dopiero po zgodzie w kategorii `analytics` (kategorii `marketing` nie ma).
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

## 10. CI/CD — GitHub-hosted (WAŻNE)

CI chodzi na **GitHub-hosted runnerach `ubuntu-latest`** (decyzja właściciela z 2026-09-23;
wcześniej jeden współdzielony self-hosted runner serializował wszystkie przebiegi — #50).
Minuty Actions są płatne z ograniczonej puli, więc workflow jest zbudowany oszczędnie.
Wdrożenie obsługuje natywna integracja Railway. Zobacz:
- `.github/workflows/ci.yml` — `runs-on: ubuntu-latest`; `install` → `lint`/`typecheck`/`unit`/`migrations`,
  równolegle `sca` i `rls`; `build` po zielonym lint+typecheck+unit; `e2e` po `build`.
- `docs/DEPLOYMENT.md` — jedna produkcja Railway z `main`, z włączonym `Wait for CI`.
- `scripts/check-ci-workflows.mjs` — strażnik uruchamiany w jobie `lint`.

**Reguły CI:**
- Nazwy jobów (checków) są stałe — wymagają ich scalanie i Railway `Wait for CI`.
- Każdy job ma `timeout-minutes`. Nowy push do PR anuluje trwający przebieg tego PR;
  przebiegi `main` nigdy nie są anulowane (Railway potrzebuje wyniku każdego SHA).
- Nie wypychaj pustych commitów ani push-ów „na odświeżenie”; ponawiaj tylko uzasadnione joby.
- Powrót na self-hosted tylko na wyraźną prośbę właściciela (`docs/SELF_HOSTED_RUNNERS.md` — archiwalnie).

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
> 05/06(część)/07). **FUN-08 (billing) — HISTORYCZNE, WYŁĄCZONE (#51):** dawny Stripe
> checkout/webhook nie działa w bezpłatnym MVP (patrz Etap 7, „Płatności”). **P1 wymagające infra/treści (otwarte):** CI-01/02/07
> (separacja runnerów + twarda bramka RLS/Storage — infra), FUN-09 (realna treść prawna — noindex
> safe default zrobiony). **P2/P3 — ZROBIONE:** SEC-16 (0035, in_app opt-out trigger),
> SEC-15 (outbox: sprawdzanie błędów zapisu po wysyłce + log do reconciliacji), SEC-14 (0036,
> `processed_webhooks` dedup po event.id/webhook-id + limit rozmiaru body dla Stripe/email-hook;
> dowód rls.sql T). **C3 (0037) — ZROBIONE:** propozycje (enforce_offer_integrity
> INSERT → can_manage_jobs) i zmiany statusu aplikacji (transition_application → is_job_manager)
> wymagają recruiter+; respond_to_offer (kandydat) bez zmian. Dowód: rls.sql sekcja U.
> **CI-08 (SCA) — ZROBIONE:** osobny job `sca` (`scripts/sca-audit.sh`, `npm audit
> --package-lock-only`) na self-hosted runnerze blokuje CI przy PRAWDZIWYCH podatnościach
> high/critical (obecnie 0). Audyt z lockfile = deterministyczne drzewo (omija błąd „Invalid
> package tree" przy artefakcie node_modules); skrypt parsuje JSON i blokuje tylko na realnych
> podatnościach — niestabilny/wygaszany endpoint audytu npm (400/5xx) nie wywala CI. **QA-01 (a11y w CI) —
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

> 🔒 **Audyt gotowości produkcyjnej 2026-07-24** (`audyt_produkcja_pracujbe.md`, NO-GO: 4×P0,
> 25×P1, 22×P2, 5×P3; teza „krytyczne procesy zwracają sukces mimo niespójnego zapisu").
> Remediacja falami, każda weryfikowana adwersaryjnie na PG16 (sekcje rls.sql V–X) + tsc/lint/
> vitest/build/E2E:
> **P0 (0038 + webhook-inbox.ts) — WSZYSTKIE ZAMKNIĘTE:** P0-01/02 — inbox webhooków ze stanem
> (processing→completed); duplikatem do pominięcia jest tylko `completed`, więc awaria w trakcie
> pozwala na reprocessing (koniec trwałej utraty płatności/e-maili Auth). P0-03 — Stripe sync
> sprawdza KAŻDY błąd DB i propaguje (500→retry); płatność idempotentna per faktura (koniec
> dubletów invoice.paid+payment_succeeded). P0-04 — nieskonfigurowany webhook w produkcji → 503
> (nie „ciche" 200 gubiące płatności). Testy: webhook-inbox (6).
> **P1 — ZAMKNIĘTE (autonomiczne, DB+app, dowód rls.sql V–X):** P1-01 (0039: odczyt applications/
> offers/matches/rozmów tylko recruiter+ — koniec wycieku PII do zwykłego membera; apply_to_job
> powiadamia tylko recruiter+), P1-02 (get_conversation_summaries gejtowane bieżącym dostępem —
> b. członek nie widzi podglądu), P1-03 (0040: edycja firmy tylko owner/admin), P1-04 (rola
> candidate egzekwowana w ensure_candidate_profile/apply_to_job; layout odsyła admina), P1-05
> (transition_application: macierz przejść + FOR UPDATE + CAS — koniec hired→rejected itp.),
> P1-06 (withdraw tylko ze stanów aktywnych), P1-07 (onboarding sprawdza wynik finish_onboarding),
> P1-08 (onboarding wczytuje relacje — koniec kasowania skills/languages/certs przy wznowieniu),
> P1-10 (kreator edytuje tylko draft — JOB_NOT_DRAFT), P1-17 (worker e-mail 503 przy realnym
> problemie + idempotency key Resend), P1-18 (readiness: service-role + https URL; /api/health
> checks), P1-19 (jedno źródło środowiska isProductionDeployment — spójne HSTS/noindex/robots/
> sitemap), P1-23 (0041: idempotencja aktywnej pary + wygaśnięcie + CAS propozycji). P2-19 (UUID
> w respondToOffer), P3-03 (X-Frame-Options DENY).
> **P1 — DOMKNIĘTE w kolejnej fali (0042–0044 + strony paneli):** P1-11 (0042: publikacja wymaga
> opisu+obowiązków; widełki już CHECK-iem), P1-13 (realne strony paneli: kandydat aplikacje/
> oferty-polecane/zapisane/propozycje/profil + getSavedJobs/getMyOffers; pracodawca oferty/
> kandydaci/aplikacje/statystyki; /help→/pomoc), P1-14 (usunięte nieaktywne UI z dashboardu —
> checkboxy/bulk/menu-TODO → podgląd read-only), P1-16 (0042: companies.provider_customer_id +
> reużycie klienta + idempotency key + guard aktywnej subskrypcji + locale URL), P1-22 (0044:
> głębsza walidacja OOXML DOCX + flaga scan_status/kwarantanna; kolejność delete DB→Storage;
> **AV = świadomie odłożone, usługa zewn.**), P1-24 (0043: RPC-only record_consent — niezmienny
> receipt visitor/wersja/IP/UA; **treść prawna nadal placeholder+noindex, do zatwierdzenia**).
> P1-15 (0045: tabela discount_redemptions + reserve/finalize/release; startCheckout rezerwuje
> i ZATRZYMUJE na nieprawidłowym kodzie; webhook finalizuje; dowód rls.sql sekcja Z).
> P1-12 (0046: get_public_jobs/_count z KOMPLETEM filtrów sidebara + sort w SQL; strona liczy
> wyniki/licznik/paginację w SQL — koniec liczenia nad wycinkiem 200; facety = podpowiedź nad
> próbką; dowód rls.sql sekcja AA), P1-09 (0047: atomowe RPC replace relacji kreatora —
> set_job_requirements/skills/languages/certificates; koniec opróżniania relacji przy częściowej
> awarii; dowód sekcja BB; pełne per-krok owinięcie update+relacje = drobny follow-up).
> Dowód całości: rls.sql sekcje P/Y/Z/AA/BB. **WSZYSTKIE autonomiczne P1 ZAMKNIĘTE.**
> **P1 NIE-AUTONOMICZNE (pozostają — wymagają Ciebie/infry/zewn.):** P1-20/21/25 (twarda bramka
> RLS + migracje/rollback w deployu + ephemeral runners = infra), P1-22-AV (skan antywirusowy =
> usługa zewn.; walidacja+kwarantanna gotowe), P1-24-treść (realna treść prawna = prawnik;
> techniczny receipt gotowy).
> **P1 NIE-AUTONOMICZNE:** P1-20/21/25 (twarda bramka RLS + migracje/rollback w deployu +
> ephemeral runners = infra), P1-22-AV (skan antywirusowy = usługa zewn.), P1-24-treść (realna
> treść prawna = prawnik).
>
> 🔒 **Audyt niezależny 2026-07-24 (AUDIT_REPORT, NO-GO: 2×P0, 25×P1, 14×P2, 4×P3, 4×P4).**
> Remediacja falami (migracje `0048`–`0051`), każda zweryfikowana adwersaryjnie na PG16 (rls.sql
> sekcje CC–EE + D4b) + tsc/lint/vitest/build:
> **P0 — OBA ZAMKNIĘTE:** P0-01 (checkout w produkcji wymaga STRIPE_WEBHOOK_SECRET —
> `isBillingProviderReady`, inaczej `BILLING_UNAVAILABLE`; koniec pobrania płatności bez
> synchronizacji subskrypcji). P0-02 (`0050`: `checkout_intents` + partial-unique 'pending' per
> firma + `begin_checkout` z advisory lock i kontrolą aktywnej sub → stabilny intent_id = klucz
> idempotencji Stripe; webhook domyka `complete_checkout`; dwa równoległe checkouty nie tworzą
> dwóch subskrypcji — `CHECKOUT_IN_PROGRESS`; dowód sekcja DD).
> **P1 autonomiczne — ZAMKNIĘTE:** P1-07 (loader onboardingu: jawny wynik demo/ok/error — błąd
> odczytu → retry, NIGDY pusty edytor kasujący dane replace-all), P1-08 (`0051`: umiejętność
> realnie przechodzi mandatory↔optional — usuwamy etykietę z drugiego zakresu przed insertem;
> dowód EE), P1-09 (koniec danych demo jako realnych: realna nazwa użytkownika lub neutralna
> etykieta „Twoje konto"; realne imię w powitaniu pracodawcy; liczniki kategorii/miast REALNE
> `get_public_jobs_count` spójne z filtrem linku, albo pomijane w demo), P1-11 (`0048`: wygasłe
> oferty znikają z `job_is_public`/`get_public_jobs`/`_count`/`get_public_job` — filtr
> `expires_at`; dowód CC), P1-13 (sitemap ofert stronicowany do 5000), P1-22 (błąd
> `finalize_discount` w webhooku → 500/retry zamiast cichego połknięcia).
> **P2/P3 autonomiczne — ZAMKNIĘTE:** P2-03 (`0049`: send_offer domyślny expires_at
> `least(job, now()+30d)`; dowód D4b), P2-05 (twardy limit body webhooków przy STREAMINGU —
> `readTextWithLimit`, nie tylko po Content-Length), P3-01 (/api/health publicznie tylko `status`;
> szczegóły za `HEALTH_CHECK_SECRET`/poza produkcją), P3-02 (allowlista next/image + CSP img-src
> zawężone do hosta Supabase), P3-03 (usunięto sztuczny `lastModified=now` ze stron statycznych),
> P3-04 (billing nie połyka błędów DB — INTERNAL vs NOT_FOUND).
> **P1 NIE-AUTONOMICZNE / duże funkcje (OTWARTE — wymagają Ciebie/produktu/infry/prawnika):**
> P1-01 (entitlements planów — brak warstwy policy/limitów), P1-02 (dostęp firmy do CV = model
> grantów + AV, usługa zewn.), P1-03 (pipeline materializacji `matches`), P1-04 (edycja/wznowienie
> draftu + cykl życia oferty), P1-05/P1-06 (paginacja + widoki szczegółu aplikacji/kandydata — strona kandydata zrobiona: szczegół
> zgłoszenia `/candidate/aplikacje/[id]`, historia stronicowana; panel pracodawcy w #684),
> P1-10 (kanoniczny model miast — dopasowanie nazw i18n do `jobs.city`), P1-14 (realne statystyki/lejek), P1-15 (treść prawna = prawnik), P1-16
> (receipt akceptacji regulaminu przy rejestracji), P1-17 (eksport/usunięcie konta GDPR — część
> techniczna dla kandydata zrobiona w #486, patrz Etap 7),
> P1-18 (moderacja zgłoszeń end-to-end — decyzja z egzekucją #42 zrobiona, odwołania #43 otwarte), P1-19 (webhook Resend bounce/complaint = zewn.),
> P1-20 (harmonogram workera e-mail = cron/infra), P1-21 (reconciliacja faktur + PDF),
> P1-23/24/25 (twarde bramki CI RLS/E2E + migracje w deployu + ephemeral runners = infra),
> P2-06 i P4-* (atomowy lease inboxa, alerty/CWV; P2-13 zarządzanie zespołem zamknięte w #403); P2-04 (paginacja
> admina) zamknięte w #418.
> P1-12 (JSON-LD `validThrough` z `expires_at`, `baseSalary.value.unitText` z `salary_period`) —
> zamknięte: `get_public_job` zwraca obie kolumny od 0114, JSON-LD #313/#22; dowód `rls.sql` sekcja JP12
> (kontrola ujemna: definicja bez `expires_at`) i `jobs-postgres.test` (wiersz → JSON-LD).

### Etap 1 — fundament
- [x] Architektura, stack, konfiguracja projektu (Next 15, TS strict, Tailwind)
- [x] System wizualny: tokeny kolorów, typografia (DM Sans od #5/#7; wcześniej Inter), globals.css
- [x] i18n: routing `[locale]`, next-intl, pliki `pl/nl/fr/en`, middleware
- [x] Model danych: migracje SQL (schemat + enumy + indeksy)
- [x] RLS: polityki bazowe
- [x] Role i routing paneli (candidate/employer/admin, noindex)
- [x] CI (`ci.yml`, od 2026-09-23 na `ubuntu-latest`) + natywne wdrożenie Railway z `main`
- [x] Centralny system błędów + kody + kanał błędów (webhook Discorda od #571; wcześniej Sentry)
- [x] shadcn/ui — zestaw komponentów w `src/components/ui` (API shadcn, styl „Ludzie i praca”, tokeny,
  bez hexów): button, input, textarea, label, checkbox (Radix), select (własny, API Radix Select),
  card, badge (`success` = `success-text` na `success/10`, AA), toast, light-dialog (#393) +
  confirm-dialog, stepper, status-pill, match-bar, stat-card oraz **skeleton**, **table**
  (domyślne klasy = `TH`/`TD`/`TD_WRAP` z `panel-styles.ts`, `TableRowHeader` = `<th scope="row">`),
  **pagination** (nav + lista, bez `Slot` — zostaje serwerowy) i **alert** (baza `NOTICE`, warianty
  note/error/success, `error` = `role="alert"`). Podmienione ręczne odpowiedniki bez zmiany wyglądu:
  tabele `/admin/uzytkownicy` i `/admin/firmy`, `AdminPager`, szkielet `MessagesLoading`, błędy
  zespołu (`TeamMembers`/`TeamInvite`/`MyTeamInvitations`), `RecruiterOnlyNote`. Test `ui-kit`
  (klasy identyczne z kalką, kontrole ujemne) + strażnik: surowy `<table>` tylko w `ui/table.tsx`.
  Świadomie BEZ nowych pakietów Radix (budżet JS #395, INP #393): natywne `<select>`/radio w formularzach
  GET i server actions (działają bez JS, strony admina serwerowe), własne menu z pełnym ARIA
  (`ApplicationActions` #341, `ApplicationStatusMenu`, `LocaleSwitcher` na stronach publicznych),
  dialogi na `LightDialog`; tabs/tooltip/dropdown-menu dodawać dopiero z realnym użyciem (tooltip na
  dotyku = ryzyko a11y). Publiczne `Pagination` (lista ofert) zostaje osobne.

### Redesign wg makiet — HISTORYCZNE (`docs/DESIGN_SCREENS.md`), zastąpione „Ludzie i praca”
> Obowiązujący wygląd = kalka prototypu `docs/design/people-passport/prototype` („04 Ludzie i praca”,
> sekcja 2): biel, czerwień `#D92932`, czerń `#151515`, DM Sans. Granatowa paleta (#0F2A47/#2563EB)
> i Inter zostały usunięte z kodu (strażnik `tests/unit/legacy-palette.test.ts` z kontrolą ujemną).
> Matryca zgodności ekranów z prototypem (1280/390 px, nakładka zrzutów + style kluczowych
> elementów): `docs/design/people-passport/MATRIX.md`, pomiar `node scripts/design/compare-prototype.mjs`
> (poza CI). Poniższe punkty opisują strukturę komponentów z dawnych makiet — wygląd każdego z nich
> jest już w stylu paszportu (#2–#7).
- [x] ~~Paleta granatowa~~ → tokeny „Ludzie i praca” w `globals.css` (`--primary` #D92932, `--pp-*` prototypu) + `tailwind.config.ts`, `manifest.ts` theme_color #D92932
- [x] Komponenty z makiet: JobCard(wiersz+hover), FilterSidebar+FilterSheet, StatusPill, StatCard, MatchBar, Stepper, DashboardShell(sidebar+bottom tab bar), NotificationsDropdown, Toast, ApplyModal, RecruitmentFunnel, PricingPackageCard
- [x] Odwzorowanie 7 ekranów (home, lista+filtry, detal+modal, panel kandydata, onboarding, panel pracodawcy, stany cookies) — **UI gotowe**; panele na danych DEMO (podpięcie realnych danych = warstwa backendu, niżej)
- [x] Restrukturyzacja layoutów: root=(html/body/providery/cookies), `(public)/layout`=Header+Footer, `(auth)/layout` minimalny, panele=własny layout (DashboardShell, noindex)

### Etap 2 — strony publiczne
- [x] Strona główna (hero + sekcje) SSR — redesign wg makiety 01
  Hero (#166) wg `people.js`: teza w trzech wierszach, czerwona akcja „Przeglądaj oferty” +
  link do `/rejestracja`, podpis „ilustracyjne” na zdjęciu; E2E `home-hero.spec` (4 języki,
  320/1440 px, axe, kontrola ujemna).
- [x] Lista ofert + filtry (FilterSidebar/FilterSheet, chipy, sort, paginacja) — wg makiety 02; infinite scroll opcjonalnie później
  Wynagrodzenie (#188, 0080): suwak = EUR brutto/mies.; filtr, sort „najwyższe wynagrodzenie”,
  licznik i facety porównują ekwiwalent miesięczny (month bez zmian, year ÷ 12). Stawek
  godzinowych nie przeliczamy (godziny pracy to wolny tekst) — jak oferty bez kwoty nie odpadają
  z filtra i są na końcu sortowania; opis `filters.salaryPeriodNote` pod suwakiem. Lustro TS dla
  demo: `src/lib/salary-compare.ts`. Dowód: `rls.sql` sekcja SAL, `salary-compare.test.ts`.
  Jednostka filtra (0091): przełącznik „Miesięcznie / Za godzinę” (URL `salaryUnit=hour`,
  RPC `p_salary_unit`, widełki 10–40 EUR/godz.). Godzinowo porównujemy tylko stawki godzinowe;
  miesięcznych/rocznych nie przeliczamy na godziny (nieporównywalne → nie odpadają, sort na
  końcu). Jednostka steruje też sortem po wynagrodzeniu; zmiana jednostki zeruje widełki.
  Dowód: `rls.sql` sekcja SP188.
  Zapis kwot (#22): jedno źródło `src/lib/salary.ts` (`normalizeSalary` + `formatSalaryRange`)
  dla karty, szczegółu, podobnych ofert, JobPosting JSON-LD i e-maili (worker formatuje z kwot
  w payloadzie w locale odbiorcy, etykiety `jobs.passport.*` przez `src/lib/salary-labels.ts`).
  Grosze = dwa miejsca dla obu granic, jedna granica = „od”/„do”, min = max = jedna kwota,
  brak kwoty = brak pola, okres tylko z danych. Testy: `salary.test.ts`, E2E `job-detail-salary`.
  E-mail propozycji (0113): `send_offer` kolejkuje kwoty oferty (`salaryMin`/`salaryMax`/
  `salaryPeriod`/`currency`), tekst składa worker w locale odbiorcy (`email-payload-followups.test`).
- [x] Szczegóły oferty + JobPosting JSON-LD + ApplyModal — wg makiety 03
  Tryb demo (#297, Invariant #12): oferty z `src/lib/data/demo.ts` mają `isDemo` (`src/lib/jobs.ts`,
  `isShowingDemoJobs()`); strona główna, lista, landing kategorii/miasta i szczegół pokazują baner
  `DemoJobsNotice`, karty etykietę „przykładowa”, bez odznaki „Zweryfikowana firma”; szczegół demo
  = noindex, bez JobPosting i „Wyślij wiadomość”, ApplyModal z komunikatem zamiast formularza.
  Formularz aplikowania i JobPosting testuje serwer fixture (tryb `full` nie oznacza ofert jako demo).
- [x] Landing pages: `/praca` (hub) + `/praca/kategoria/[category]` + `/praca/miasto/[city]` (filtrowane przez getJobs, generateStaticParams, metadata+hreflang, BreadcrumbList JSON-LD, indeksowalne)
- [x] SEO: sitemap.ts (pusty na non-prod), robots.ts, metadata + hreflang, X-Robots-Tag
  Dane strukturalne (#313) w `src/lib/seo/structured-data.ts`: JobPosting bez wymyślonego
  `validThrough` (tylko realne `expires_at`), pełny opis HTML (opis, obowiązki, wymagania, warunki,
  godziny, zmiany; escapowany); Article z `image`, `dateModified` (`guides.ts` `updatedAt`) i logo
  wydawcy. Obraz marki `/og.png` przez `brandShareImageUrl` na wszystkich publicznych stronach z
  własnym `openGraph` (#116/#182; strażnik `tests/unit/structured-data.test.ts`).
  `hiringOrganization.sameAs`/`logo` (migracja `0114`): `get_public_job` zwraca `company_website`/
  `company_logo_url` tylko dla firmy `verified` i tylko jako bezwzględny https (`public_https_url`),
  JSON-LD waliduje je drugi raz (`publicHttpsUrl`). Dowód: `rls.sql` sekcja OL112 (kontrole ujemne:
  bez walidacji / bez bramki weryfikacji link wycieka).
  Edycja strony i logo firmy (#112, migracja `0141`): `/employer/firma` ma osobny formularz
  (`CompanyLinksForm` + akcja `updateCompanyLinks`) — owner/admin firmy (jak nazwa/VAT, 0040)
  ustawia i czyści oba adresy; CHECK na `companies.website`/`logo_url` (`companies_website_https`/
  `companies_logo_url_https`, ta sama reguła co `public_https_url`) waliduje w bazie niezależnie
  od Zod (lustro `src/lib/company-links.ts`). W przeciwieństwie do nazwy/VAT zmiana NIE cofa
  weryfikacji (`protect_company_verification` reaguje tylko na `name`/`vat_number`); audyt
  `company.links_changed`. Podgląd logo przez `next/image` tylko gdy adres wskazuje na własny
  host (jedyny dozwolony w `images.remotePatterns`/CSP `img-src`) — inaczej sam link, bez
  rozszerzania CSP. Dowód: `rls.sql` sekcja CL141 (member/recruiter bez dostępu, http:// i adres
  nad limitem długości odrzucone, zmiana linków nie cofa `verified`, zmiana nazwy nadal cofa).
- [x] Poradniki (blog) + Article JSON-LD — `/poradniki` + `/poradniki/[slug]` (6 poradników w `src/lib/guides/guides.ts`)
- [x] Strona dla pracodawców `/dla-pracodawcow` (#339) — indeksowalna (sitemap, canonical, hreflang,
  BreadcrumbList), treść `employers.*` w PL/NL/FR/EN wyłącznie z faktów produktu (konto + firma,
  weryfikacja przez administratora, kreator ze szkicem, zgłoszenia/wiadomości/propozycje, e-maile
  w języku odbiorcy, bezpłatny etap z `docs/PRODUCT_DECISIONS.md`); bez cen i liczb (strażnik
  `tests/unit/employers-page.test.ts`). „Dla pracodawców” w nawigacji i stopce prowadzi tutaj;
  „Dodaj ofertę” i CTA strony — do `/rejestracja-pracodawca`. W bramce a11y (#221).
- [x] Profil publiczny firmy `/pracodawcy/<slug>` (#591, migracja `0140`): zastępuje CTA
  „Dowiedz się więcej o firmie”, które prowadziło do wyszukiwarki po nazwie firmy
  (`?keyword=<nazwa>` — mogło zwrócić oferty innej firmy albo nic). Adres jest stabilny:
  `companies.slug` (unikalny, ustawiany raz przy zakładaniu firmy, NIE zmienia się przy zmianie
  wyświetlanej nazwy — `src/lib/actions/company.ts`). `get_public_company`/`get_public_company_jobs`
  (nowe RPC) i `get_public_job`/`get_public_jobs` (+ `company_slug`) zwracają WYŁĄCZNIE
  zweryfikowaną, nieusuniętą firmę; zła firma/zły slug = brak wiersza → strona 404 (Invariant #8).
  CTA na szczególe oferty (`job.companySlug`) jest ukryte, gdy profil nie istnieje (demo/bezpiecznik),
  zamiast linkować donikąd. Strona indeksowalna (canonical, hreflang), sitemap dodaje jeden wpis na
  firmę zebrany PRZY OKAZJI iteracji po ofertach (bez osobnego zapytania). Dowód: `rls.sql` sekcja
  CP591; unit `company-profile`, `jobs-postgres` (#591), `sitemap-robots` (#591, z kontrolą ujemną).
  SEO i kandydat (#591, bez migracji): nazwa firmy na karcie oferty (`JobCard`, link nad nakładką
  tytułu) i w nagłówku szczegółu linkuje do profilu, gdy `companySlug` istnieje (tylko `verified`);
  profil ma Organization JSON-LD (`buildOrganizationJsonLd`: nazwa, adres profilu, opis, adres
  pocztowy; `sameAs`/`logo` tylko https — edycja w panelu to #632); profil bez aktywnych ofert =
  `noindex, follow` bez canonical/hreflang (jak pusty landing #299), sitemap zbiera profile tylko
  z aktywnych ofert. Serwer fixture E2E ma profile firm zweryfikowanych i jedną firmę bez ofert
  (`src/lib/company-fixture.ts`). Dowód: unit `company-profile-seo` (kontrole ujemne), E2E
  `company-profile` (linki, JSON-LD, noindex, 404 niezweryfikowanej, axe 320/1280 px w 4 językach).
- [x] Pomoc i Kontakt (#61, część techniczna, migracja `0125`): `/pomoc` = pytania i odpowiedzi
  wyłącznie z faktów produktu (`help.*`, PL/NL/FR/EN, natywne `<details>`, bez terminów i cen),
  `/kontakt` = formularz (`ContactForm`, kalka `.paper.demo-form`): temat ze słownika, treść
  20–5000, imię opcjonalne, e-mail. Akcja `submitContactMessage`: limiter `contact` (fail-safe) →
  Turnstile `contact` (fail-closed) → Zod (`src/lib/validation/contact.ts`; NISS/PESEL/numer
  dokumentu → błąd przy polu, #495) → RPC `submit_contact_message` (tylko service_role:
  idempotencja, 3 wiadomości/adres/24 h, numer `KON-XXXX-XXXX`). W tej samej transakcji
  potwierdzenie `supportContact` do nadawcy w języku formularza i `contactMessageAdmin` do
  każdego aktywnego admina w JEGO języku (Invariant #1); w kolejce tylko numer i temat — treść
  i adres czyta admin w `/admin/kontakt` (filtr nowe/obsłużone, `admin_set_contact_message_status`
  z CAS i audytem). Obie strony indeksowalne (canonical, hreflang, sitemap), stopka „Pytania
  i odpowiedzi” → `/pomoc`. Dowód: `rls.sql` sekcja CT61; unit `contact-form`, `contact-emails`,
  `help-contact-pages`; E2E `help-contact` (4 języki, axe 320 px), `contact-form` (fixture).
  **Otwarte (właściciel):** treść Polityki prywatności (placeholder + noindex zostaje), retencja
  `contact_messages` i ich miejsce w eksporcie/usunięciu konta (#486), linki Pomoc/Prywatność
  w stopce e-maili (#6). Dawna atrapa `/faq` usunięta — middleware daje 308 na `/{locale}/pomoc`
  (test `faq-redirect`).

### Etap 3 — kandydat
- [x] Rejestracja / logowanie / reset / potwierdzenie e-mail — Better Auth + PostgreSQL Railway (#24, bez Supabase Auth). Akcje `src/lib/actions/auth.ts` przez `auth.api` (limiter PostgreSQL, Turnstile, Zod; rola z aktywnego profilu, awaria → sesja cofnięta). Zgoda na regulamin sprawdzana w akcji; receipty i preferowany język zapisuje trigger 0059 w transakcji konta. `/api/auth/[...all]` wystawia tylko `GET /get-session` (`src/lib/auth/http-allowlist.ts`). Linki z e-maili: `/{locale}/potwierdz-email#token=` (przycisk → `confirmEmail`, bootstrap firmy) i `/{locale}/ustaw-nowe-haslo#token=` — token we fragmencie (#505), język odbiorcy z kolejki 0061, worker w `/api/email/process` (`DATABASE_AUTH_MAIL_URL`). Guardy paneli na `getCurrentIdentity()` (`src/lib/auth/current.ts` — kontrakt tożsamości dla #25/#26): `/candidate` (sesja + employer→/employer, admin→/admin), `/employer` (sesja + aktywne `company_members`; pracodawca bez firmy → formularz firmy, inni → /rejestracja-pracodawca), `/admin` (sesja + rola=admin, else `notFound`), wszystkie `force-dynamic` + noindex. Gotowość produkcji (#429) = PostgreSQL + Better Auth + limiter, `/api/health` z `SELECT 1` (`docs/railway/STATUS.md`). Dowód: `tests/integration/auth-actions.test.ts` (PG16), unit `auth-*`, E2E `auth-link-token`. IP/user-agent w receipcie akceptacji (migracja `0132`): akcja rejestracji przekazuje zaufany adres (`trustedClientIp`, nigdy `X-Forwarded-For`) i user-agent (≤ 512) w metadanych; trigger zapisuje je w `document_acceptances` i usuwa z `auth.users` w tej samej transakcji; po 7 dniach zeruje je `acceptance_ip_user_agent` (`retention_purge_receipts_batch` w `run_retention_purge`, za `RETENTION_MODE`); receipt niezmienny poza wyzerowaniem IP/UA. Dowód: `rls.sql` sekcja RIP (kontrole ujemne), `signup-receipts` (PG16), `auth-register-terms`. Budżet wysyłki puli `auth` w workerze (migracja `0137`): `processAuthEmailBatch` po renderze pobiera budżet okna dostawcy przez `auth.take_send_budget` (nakładka na `take_email_send_budget`, tylko szablony `accountConfirmation`/`passwordReset`, EXECUTE tylko `pracujbe_auth_mail`); odmowa = to i pozostałe pobrane zlecenia wracają do kolejki bez zużycia próby (`auth.defer_email`: `attempts` cofnięte, `next_attempt_at` = następne okno, tylko ważna dzierżawa), licznik `deferred`; awaria poboru = fail-open (list konta wychodzi, błąd w kanale). Dowód: unit `auth-email-worker` (kontrola ujemna na starym workerze), integracja `auth-email-outbox` (PG16, kontrola ujemna bez migracji). Domyślna nazwa
  firmy w formularzu po nieudanym bootstrapie (#365, `src/lib/auth/signup-company-name.ts`): metadane
  rejestracji (`raw_user_meta_data.company_name`) czytane pod WŁASNYM `identity.id` (Better Auth
  `internalAdapter.findUserById`, nigdy z URL/formularza) wypełniają `CompanyOnboarding` w
  `/employer/firma` i w layoucie panelu; błąd odczytu → formularz pusty (nie blokuje zakładania
  firmy).
  Rozdzielenie zgód (#493, migracja `0108`): rejestracja kandydata/pracodawcy
  i krok 6 onboardingu mają osobne, niezaznaczone pola — akceptacja regulaminu (wymagana),
  potwierdzenie zapoznania się z informacją o prywatności (wymagane, NIE zgoda) i zgoda
  opcjonalna na e-maile marketingowe (tylko rejestracja; odmowa nie blokuje konta, wycofanie
  w ustawieniach powiadomień). `record_signup_consents` (service_role; Better Auth: marker v2
  w `auth.record_signup_receipts`) zapisuje każdy element osobno: `document_acceptances.kind`
  (`terms_acceptance`/`privacy_notice_ack`, dawne wiersze = `legacy_combined`, nie zgoda),
  zgoda na marketing jako zdarzenie dziennika #513 `email_consent_events` (źródło `signup`,
  język, wersja treści `sha256:` z `src/lib/signup-consents.ts`; odmowa = brak zdarzenia). Receipty niezmienne (trigger; usuwa je tylko kaskada usunięcia konta).
  Aplikowanie: pole „zapoznałem się z informacją o prywatności” zamiast „zgody”. Dowód:
  `rls.sql` sekcja CS493 (z kontrolą ujemną), `signup-consents.test`, E2E `consent-separation`.
  Szkic brzmień: `docs/legal-drafts/zgody-i-akceptacje.md` (PROJEKT, nieopublikowany).
  **Otwarte:** treść prawna (#61), podstawy (#485/#487).
- [x] Onboarding kandydata (6 kroków) — UI + realny zapis per krok do DB (`saveOnboardingStep`, RHF + stan zapisu)
  Pusta nazwa/imię/nazwisko → „wymagane” (także formularz firmy, #367); pozycje list (zawody 80,
  umiejętności 120, certyfikaty 160 = `CANDIDATE_ITEM_LIMITS`, zgodne z `left()` w 0028) —
  za długa nie trafia na listę (#364). Kod błędu serwera w komunikacie; `ONBOARDING_INCOMPLETE`
  przenosi do pierwszego brakującego kroku (#363).
  Jeden krok = jedno żądanie = jedna transakcja (#142, 0082): krok 3 (doświadczenie +
  umiejętności) i krok 5 (języki + certyfikaty) przez `save_candidate_onboarding_step3/5`
  (wewnątrz te same `set_candidate_*` — limity, dedup, replace-all). Błąd dowolnej części cofa
  cały krok. Krok 6 z „Zakończ”: dane kroku zapisane jednym upsertem, `finish_onboarding` tylko
  sprawdza kompletność, receipt best-effort. Dowód: `rls.sql` sekcja OB142 (wstrzyknięty błąd
  drugiej części + kontrola ujemna starej ścieżki).
- [x] Panel kandydata — realne dane pod sesją (RLS) + akcje (zapis oferty, wycofanie aplikacji, odpowiedź na propozycję), noindex; fallback demo bez env

Historia własnych aplikacji w panelu jest stronicowana po 10 rekordów stabilnym kursorem
`submitted_at` + `id`; starsze zgłoszenia pozostają dostępne przez „Pokaż więcej”.
Granica strony (#180): 10 zgłoszeń = koniec listy, 11. na kolejnej stronie (test
`candidate-applications-pagination`).
Szczegół zgłoszenia `/candidate/aplikacje/[id]` (audyt P1-05/P1-06, strona kandydata; bez
migracji): karta listy linkuje „Szczegóły zgłoszenia” (nazwa z tytułem oferty, także gdy oferta
nie ma już publicznego adresu). `getMyApplicationDetail` pod sesją/RLS z jawnym
`candidate_id = me` (RLS 0039 wpuszcza też rekrutera firmy — kontrola ujemna w
`portal-candidate.test.ts`): dane wysłane do firmy (wiadomość, telefon, dostępność), odpowiedzi
ze snapshotu #101, historia statusów bez notatek firmy (`note`), stronicowana po 50 kursorem
`created_at` + `id` (`ApplicationHistoryList` z prop `loadMore` →
`loadMoreMyApplicationHistory`, własność sprawdzana ponownie), link do powiązanej rozmowy,
wycofanie (`ApplicationActions`). Cudze/usunięte/nieistniejące = 404, awaria = komunikat
z ponowieniem, demo oznaczone. Testy: unit `candidate-application-detail`,
`candidate-applications-list`; E2E `candidate-application-detail` (4 języki), `panel-a11y`.
Metadane ofert (#184, 0113): `get_applied_jobs_display(p_locale, p_job_ids)` filtruje oferty
bieżącej strony WEWNĄTRZ funkcji (SECURITY DEFINER nie jest inline'owana), więc baza nie liczy
całej historii; ≤ 100 identyfikatorów, tylko własne aplikacje. Ten sam filtr dla propozycji
i ostatniej aktywnej propozycji. Dowód: `rls.sql` sekcja PL109.
Paszport tożsamości nad siatką `/candidate/profil` (#172, `CandidateIdentity`): imię, pierwszy
zawód, miasto, znana dostępność; bez zdjęcia i inicjałów, po błędzie odczytu tylko komunikat.
Kolejne strony są odczytywane pod bieżącą sesją/RLS; błąd i ponowienie nie kasują
już wczytanych kart. Jest to część etapu wyglądu #5, nie dowód ukończenia całego etapu.

Wygląd panelu kandydata, onboardingu, wiadomości, powiadomień, toastu i aplikowania = kalka
prototypu „04 Ludzie i praca” (#5/#6): klasy `panel-styles.ts` (wspólne z pracodawcą/adminem)
+ `src/components/candidate/candidate-styles.ts`; odstępstwa w `docs/design/people-passport/README.md`.
Kompletność profilu (pulpit + profil) = 6 kroków kreatora onboardingu, jedno źródło
`src/lib/profile-completeness.ts` (`PROFILE_SECTIONS`/`computeProfileChecklist`); kompletny
kreator = 100% (#315). Flaga `profile_completed` w DB (`finish_onboarding`) ma własne kryteria.
Baner nowej propozycji prowadzi do `/candidate/propozycje#offer-{id}` (#324); „Najnowsze
wiadomości” linkują do `?c={id}` (#340); menu „…” aplikacji ma pełny wzorzec ARIA menu (#341).

Blokada firmy przez kandydata (#97, migracja `0078`): tabela `candidate_company_blocks`
(RPC-only `set_company_block`, odczyt `get_my_company_blocks`/`get_job_company_block`, firma nie
ma ścieżki odczytu). Egzekwowanie w bazie: `company_can_view_candidate` (profil/PII),
wyszukiwanie (`candidate_profiles_select_employer`, `candidate_profile_is_searchable`), `matches`,
triggery BEFORE INSERT na `offers`/`conversations`/`messages` (neutralny błąd jak brak relacji),
polecane (`get_public_jobs_by_ids` pod sesją). Historia aplikacji/rozmów zostaje. UI: sekcja
„Zablokowane firmy” w `/candidate/ustawienia` + kontrolka na szczególe oferty. Dowód: `rls.sql`
sekcja BL. Lista wyników (`0090`): `get_public_jobs`/`_count`/`get_public_job_filter_facets`
pomijają oferty firm zablokowanych przez wywołującego (gość/pracodawca bez zmian, więc strony
ISR zostają wspólne); `/oferty-pracy` przekazuje UUID kandydata ze zweryfikowanej sesji
(`src/lib/auth/candidate-viewer.ts` → `readPortalIdentity`), publiczny URL oferty bez zmian.
Dowód: `rls.sql` sekcja BL97 (kontrola ujemna: bez `0090` pada BL97-1). **Otwarte:** działa,
gdy sesje Better Auth są spięte z trasami (#24) — bez runtime auth lista zostaje listą gościa.
Historia propozycji bierze dane oferty z `get_offered_jobs_display` (0090), więc blokada nie
kasuje tytułu propozycji bez aplikacji (BL97-6).

Widoczność profilu dla firm (#494, migracja `0100`): przełącznik
„Pozwól zweryfikowanym pracodawcom znaleźć mój profil” w `/candidate/ustawienia`
(`ProfileVisibilitySettings`, akcja `setProfileVisibilityAction` → `set_candidate_searchable`
pod sesją; stan UI = ponowny odczyt z bazy, bez optymistycznej zmiany). Domyślnie wyłączone
(także po `finish_onboarding`); włączenie tylko dla ukończonego profilu, wyłączenie zawsze.
Znacznik `candidate_profiles.searchable_changed_at` + historia `candidate_visibility_events`
(tylko przy realnej zmianie, RPC-only, odczyt własny). Po włączeniu zweryfikowana firma widzi
dane zawodowe profilu i relacje; imię/kontakt (`profiles`) i CV — nie. Wyłączenie działa od razu
dla wyszukiwania i `matches` (polityka wymaga widoczności kandydata, także po znanym ID);
relacja z aplikacji/propozycji (`company_can_view_candidate`) zostaje — zatrzymuje ją blokada
firmy. Dowód: `rls.sql` sekcja VIS494 (kontrole ujemne: polityka `matches` z 0078, guard z 0029);
unit `profile-visibility`; E2E `candidate-profile-visibility.spec`. **Otwarte:** propozycja
od firmy odsłania jej imię i kontakt z konta (`company_can_view_candidate` po `offers`) —
decyzja produktowo-prawna (#485/#34).

Polityka wieku kandydatów (#492, #576, migracja `0126`). Decyzja właściciela 25.09.2026
(LAUNCH-1): konto kandydata od 16 lat, widoczność profilu dla firm (#494) tylko 18+, młodsi bez
konta. Próg konta jako dane (`age_policy`: 16 albo 18, domyślnie 16, `confirmed=true`; zmiana
tylko `admin_set_candidate_min_age` z uzasadnieniem i audytem `age_policy.updated`). Minimalizacja:
potwierdzenie PRZEDZIAŁU „16–17” / „18 lub więcej” bez daty urodzenia (`candidate_age_attestations.min_age`
= 16 albo 18, niezmienne, RPC-only; po ukończeniu 18 lat nowe potwierdzenie 18+). Deklaracja:
rejestracja kandydata (`AgeDeclarationField` — radiogroup obok zgód #493; Better Auth przez trigger
`auth.record_signup_receipts` w transakcji konta; poniżej progu → `AGE_ATTESTATION_REQUIRED`; RPC
service_role `record_candidate_age_attestation` dla kont spoza formularza), formularz gościa
(`p_age_attested_min` → wrapper `submit_guest_application`), sekcja „Wiek” w `/candidate/ustawienia`
(`attest_candidate_age`; konto 16–17 widzi ograniczenie i potwierdza 18+). Egzekwowanie w bazie
triggerami: aplikacja i przejęcie aplikacji gościa, propozycja (neutralny błąd), zgłoszenie gościa;
włączenie widoczności (`set_candidate_searchable` i każda inna ścieżka) tylko przy 18+
(`candidate_is_adult`, `AGE_ADULT_REQUIRED` → UI: wyłączony przełącznik z wyjaśnieniem
`profileVisibility.requiresAdult`); migracja jednorazowo ukrywa profile bez 18+. Lejek ofert
(#99) dla 16–17 = brak zgody: znacznik urządzenia `pracujbe.funnel.minor` (panel kandydata po
odczycie z bazy — `FunnelMinorMarker`; rejestracja/gość po wyborze 16–17) → `sendFunnelEvent` nic
nie wysyła; potwierdzenie 18+ zdejmuje znacznik. Formularze pokazują przedziały od
`candidate_min_age()` (błąd odczytu → tylko 18+). Dowód: `rls.sql` sekcja AGE492 (kontrole ujemne:
bez triggera aplikacja/gość bez deklaracji przechodzą, konto 16–17 staje się wyszukiwalne — AGE11n);
unit `age-policy` (lejek z kontrolą ujemną), `profile-visibility`, `guest-apply-form`; E2E
`auth-age-declaration`, `guest-apply`, `job-funnel-minor-marker` (PRIV-01: przy znaczniku zero żądań
`/api/job-funnel` mimo zgody — strony, „Aplikuj”, zamknięcie karty, druga karta, znacznik zapisany w
drugiej karcie; kontrole ujemne bez znacznika i z inną wartością, mutacja bramki = czerwony). Szkic (nieopublikowany): `docs/legal-drafts/kandydaci-niepelnoletni.md`.
UI zmiany progu w panelu admina (#492): `/admin/ustawienia` — bieżący próg, status zatwierdzenia
i ostatnia zmiana z dziennika (`getAgePolicySettings`, odczyt service-rolem po `requireAdmin`),
formularz wyboru 16/18 + uzasadnienie (zawsze wymagane, jak przy statusie firmy) + dialog
potwierdzenia (`AgePolicyForm`, `AdminConfirmDialog`), zapis przez `setCandidateMinAge`
(`admin_set_candidate_min_age` pod sesją admina). Bez treści prawnej — same etykiety funkcji.
**Otwarte (właściciel/prawnik):** treść informacji o wieku (`07-wiek.md`) po akceptacji, kontakt
osób poniżej 16 lat z udziałem opiekuna, oznaczenie ofert dla młodocianych, procedura dla
wykrytego konta poniżej progu.

Zapisane wyszukiwania i alerty (#100, migracja `0092`): „Zapisz wyszukiwanie” na
`/oferty-pracy` (przy co najmniej jednym filtrze; strona nie czyta sesji — akcja
`saveSearchAction`) zapisuje KANONICZNE filtry v1 = dokładnie argumenty `get_public_jobs`
wysłane przez listę (`src/lib/job-list-query.ts`, jedno źródło z listą; aliasy miast
rozwinięte, bez `date`). RPC-only: `save_saved_search` (kandydat, identyczne filtry → ten sam
wiersz, limit 20), `set_saved_search_alerts` (włączenie przesuwa `alerts_since`/watermark —
bez zaległych ofert), `delete_saved_search`; odczyt własnych pod RLS. Worker
`process_saved_search_alerts` (service_role, `/api/maintenance` co godzinę, `SKIP LOCKED`)
woła `get_public_jobs` z filtrami i `p_since` = watermark − 1 h, pomija firmy zablokowane,
rejestruje parę w `saved_search_alerts` (PK = brak ponownej wysyłki), tworzy jedno in-app
(`job_match`, `entity_type='saved_search'`) i jeden e-mail `jobMatch` (digest ≤ 5 ofert,
język odbiorcy, opt-out `email_job_matches`); digest najwyżej raz na dobę/tydzień. Panel:
`/candidate/wyszukiwania` (alert, częstotliwość, usunięcie). Dowód: `rls.sql` sekcja SS100;
unit `saved-search-alerts`; E2E `saved-search.spec`.
Dokończenie (migracja `0124`): zmiana nazwy w `/candidate/wyszukiwania`
(RPC `rename_saved_search`: tylko własne, 1–80 znaków, bez znaków sterujących; cudze = `NOT_FOUND`).
E-mail `jobMatch` ma link „Wyłącz tylko ten alert” → `/{locale}/wypisz-alert#t=` (noindex,
token HMAC `src/lib/email/saved-search-alert-token.ts`: UUID konta + wyszukiwania, osobna
domena podpisu, sekret `EMAIL_UNSUBSCRIBE_SECRET`, bez e-maila w URL; zapis po kliknięciu przez
`saved_search_alert_unsubscribe`, tylko service_role, tylko właściciel z tokenu). Link liczy
worker (payload go nie podmieni). Kolejka: `email_delivery_suppression_reason` (blokada adresu,
zgoda kategorii, uprawnienie odbiorcy firmowego z 0122 — kontrola `ES503-2b/2c`, wyłączony/usunięty alert, kampania) w `claim_email_batch` i w
`email_delivery_send_check` — worker woła ją tuż przed budżetem i `send` (#466 pkt 8), wiersz
niedozwolony jest wygaszany (`suppressed_alert_disabled` / `suppressed_opt_out`…). Dowód:
`rls.sql` sekcja SS108 (kontrole ujemne), unit `saved-search-followups`,
`saved-search-rename-ui`, E2E `saved-search.spec` (`/wypisz-alert`).
Nagłówek one-click digestu alertu (`List-Unsubscribe` + `List-Unsubscribe-Post`, RFC 8058)
wskazuje `POST /api/email/unsubscribe-alert?t=&l=` z tym samym tokenem alertu co `/wypisz-alert`
(`alertOffHeadersFor` w `outbox.ts`) — wyłącza tylko ten alert (`saved_search_alert_unsubscribe`,
service_role, idempotentnie), GET = 303 na stronę potwierdzenia; inne maile i `jobMatch` bez
wyszukiwania zachowują nagłówek kategorii, stopka nadal ma wypisanie z kategorii. Dowód: unit
`saved-search-followups` (kontrola ujemna: token kategorii w nagłówku/trasie), E2E `saved-search.spec`.
Bez limitu 100 ofert na przebieg (migracja `0138`): worker bierze nowe oferty z
`saved_search_matching_jobs` — kolejne strony `get_public_jobs` po 100 w jednym zapytaniu (jeden
snapshot); remis `published_at` rozstrzyga `id` w `get_public_jobs` (0136, #594), więc strony
są bez dziur i dubli. Digest nadal ≤ 5 ofert (`count` = wszystkie nowe), najwyżej raz
na dobę/tydzień, para (wyszukiwanie, oferta) raz. Dowód: `rls.sql` sekcja SC100 (105 ofert z remisem;
kontrola ujemna: jedna strona jak w 0092 gubi ofertę 101). **Otwarte:** górna granica 10 100 ofert
na wyszukiwanie w jednym przebiegu (limit offsetu listy 10 000).

Import CV przez AI (#487, #498, migracja `0115` — numer tymczasowy, za flagą `AI_CV_IMPORT_ENABLED`, domyślnie
wyłączony, osobno od importu ogłoszeń): `/candidate/profil/import-cv` (404 bez flagi, link w
profilu tylko z flagą). PDF/DOCX → tekst lokalnie (`src/lib/cv-import/text.ts`: pdf.js 5 bez
`eval`, DOCX tylko `word/document.xml` z limitem dekompresji) → minimalizacja
(`minimize.ts`: NISS/BIS/dokument → odmowa; sekcje referencji i danych osobowych, linie o
osobach trzecich, dane osobowe, kategorie art. 9/10, kontakty i linki usunięte; kontakt poza
nagłówkiem dokumentu → bezpieczne zatrzymanie) → PODGLĄD tekstu dla kandydata → po
potwierdzeniu ponowna redakcja na serwerze i model OpenAI (structured output, tylko zawody/
umiejętności/języki/certyfikaty/lata) → PROPOZYCJE ze źródłem i niepewnością, domyślnie
niezaznaczone → zapis wyłącznie zaznaczonych RPC `apply_candidate_cv_proposals` (dopisanie,
`FOR UPDATE`, limity kreatora, brak zatwierdzenia = `VALIDATION_FAILED`). Pliku, tekstu ani
propozycji nie zapisujemy; CV nie trafia do firm, wynik nie wpływa na `scoreMatch`. Limit 5/h
i 10/dobę na konto (fail-closed). Dowód: `rls.sql` sekcja CV487 (kontrola ujemna replace-all);
unit `cv-import-*` (payload modelu bez referentów + kontrola ujemna bez minimalizacji); E2E
`cv-import.spec` (atrapa). Opis: `docs/AI_CV_IMPORT.md`. **Otwarte:** decyzje prawne w szkicu
`docs/legal-drafts/cv-ai-osoby-trzecie.md` (#485/#486/#488/#61) przed włączeniem, AV i izolacja
parsera, edycja wartości propozycji.

Historia propozycji kandydata (`/candidate/propozycje`) jest stronicowana tak samo: po 10
rekordów kursorem `created_at` + `id` (`getMyOffersPage` + `loadMoreProposals`), bez limitu 20 (#245).

### Etap 4 — pracodawca
- [x] Konto firmy + weryfikacja — `/employer/firma` (create przez `create_company_with_owner`, edycja, baner statusu) + weryfikacja przez admina (`admin_set_company_status`, 0019)
  Bootstrap po rejestracji (#28): callback Auth (`bootstrapCompany` w `actions/auth.ts`) woła
  wyłącznie `create_first_company` — blokada profilu i ponowne sprawdzenie członkostwa w jednej
  transakcji; dwa równoczesne callbacki = jedna firma, jeden owner. Bez migracji. Dowód: `rls.sql`
  sekcja CO28 (dblink, kontrola ujemna bez `FOR UPDATE` tworzy duplikat), `company-bootstrap-callback.test`.
- [x] Panel pracodawcy — realne dane pod sesją (RLS) + akcje (zmiana statusu aplikacji, wysyłka propozycji), noindex; fallback demo bez env
  Lejek (#302): kohorta aplikacji z 30 dni (`submitted_at`) liczona zapytaniami `count` (head,
  `!inner` na historii = jedna aplikacja raz); „Wyświetlenia” = suma `detail_views` z lejka ofert
  (#99), „brak danych” tylko bez uprawnień rekrutera — bez fałszywej konwersji 0%. Kafelki/lejek/kolumny zawijają się przy
  200% tekstu (#318). Przełącznik firmy: nazwa w etykiecie, `aria-current`, komunikat błędu (#322).
  Realne statystyki (audyt P1-14, bez migracji): liczniki rekrutacyjne (nowe zgłoszenia,
  dopasowani, do odpowiedzi, liczniki przy ofertach, lejek, top dopasowani) tylko dla recruiter+
  aktywnej firmy — zwykły `member` widzi „brak danych” (`null` → `StatValue`: „—” + tekst dla
  czytnika) i wyjaśnienie zamiast zer z RLS; lejek `denied`, top dopasowani `denied`/`unverified`/
  `error` (`getTopMatchedCandidatesLoad`). Dopasowani = DISTINCT kandydaci (nie wiersze `matches`),
  dopiero po weryfikacji firmy; „do odpowiedzi” = rozmowy AKTYWNEJ firmy, w których ostatnia
  nieusunięta wiadomość jest spoza firmy (dawniej nieprzeczytane powiadomienia użytkownika ze
  wszystkich firm). Wspólne `EmployerOverviewStats`/`EmployerFunnelSection` na pulpicie
  i `/employer/statystyki`. Dowód: `portal-employer` (PG16: member, firma niezweryfikowana, cudza
  firma, powiadomienia ≠ licznik), unit `employer-stats-load`, `employer-candidates-load`,
  `employer-offers-preview` (kontrole ujemne).
  Wygląd panelu i kreatora oferty = kalka prototypu „04 Ludzie i praca” (#5/#6): klasy w
  `src/components/dashboard/panel-styles.ts` (wspólne z adminem), sidebar `.side-item`, opis
  odstępstw w `docs/design/people-passport/README.md`.
  Pulpit: karty ofert w stylu paszportu (#171), jawny błąd najnowszych zgłoszeń z ponowieniem
  (#157), „Zobacz wszystkie” → `/employer/aplikacje` (#164); bramka axe 320/1280 px i 200% tekstu
  w 4 językach — `tests/e2e/employer-dashboard-a11y.spec.ts`.
  Lejek ofert bez śledzenia (#99, migracja `0089`): `job_funnel_daily` = oferta × dzień (Europe/Brussels)
  × `search_appearances`/`detail_views`/`apply_started`; brak IP, cookies, tekstu wyszukiwania,
  identyfikatora osoby. `applications_submitted` liczy przy odczycie `get_company_job_funnel` ze stanu
  `applications` (status ≠ draft) — deterministyczne. Strony ofert zostają ISR: wyspa
  `JobFunnelBeacon` po załadowaniu (widoczna strona, `credentials: 'omit'`) woła `/api/job-funnel`
  (`src/lib/job-funnel/*`: walidacja, reguła botów/prefetch `request-filter.ts`, limiter w pamięci
  po HMAC adresu). Deduplikacja: losowy nonce jednego załadowania widoku (`job_funnel_receipts`,
  ≤ 48 h, #575) — retry nie dubluje, odświeżenie = nowe wyświetlenie. RPC zapisu tylko przez
  endpoint (bramka `pracujbe.funnel_writer`), tylko oferty publiczne firm `verified`. Panel
  `/employer/statystyki?dni=7|30|90`: zakres dat, definicje metryk, karty per oferta zawijane przy 200% tekstu (recruiter+).
  Dowód: `rls.sql` sekcja FN99, unit `job-funnel*`, E2E `public-cache-headers` (cache nienaruszony)
  i `e2e-real` (licznik rośnie, bot pominięty, mutacja `funnel-no-dedup` = czerwony).
  Tylko po zgodzie (#575, decyzja właściciela 25.09, migracja `0128` — numer tymczasowy): lejek
  wysyła zdarzenie WYŁĄCZNIE przy zgodzie w kategorii `analytics` banera (`funnelConsentState`
  w `src/lib/job-funnel/client.ts`, cookie czytane tuż przed wysyłką — działa też po wycofaniu
  w innej karcie i po restarcie). Wyświetlenie sprzed decyzji czeka w pamięci karty i wychodzi
  po zgodzie; odmowa/wycofanie czyści kolejkę, zmiana strony ją anuluje; `apply_started` bez
  zgody nie jest kolejkowane. Terminy absolutne: `purge_job_funnel_data` w `/api/maintenance` —
  receipts ≤ 48 h, agregaty = bieżący + 12 poprzednich miesięcy kalendarzowych (Europe/Brussels).
  Panel statystyk: informacja `jobFunnel.consentNote` (dane tylko od osób ze zgodą). Dowód:
  unit `job-funnel-consent` (kontrola ujemna bez bramki), `job-funnel-retention`, `rls.sql`
  sekcja FC575, E2E `job-funnel-no-storage` (4 języki: przed decyzją, po odmowie, po wycofaniu
  w tej i drugiej karcie, zmiana strony, restart = zero żądań). E2E `e2e-real` (licznik) wymaga
  teraz zgody w teście.
- [x] Kreator oferty (9 kroków, autozapis draftu, publikacja z kontrolą `verified`) — `src/lib/actions/jobs.ts` + `JobWizard`
  Krok 9: „Zapisz i wyjdź” zapisuje szkic bez zgody na publikację (`step9DraftSchema`, także
  w `updateJobDraft`); zgodę wymaga tylko „Opublikuj” (`step9Schema`) (#193). Pozycje list mają
  limity `JOB_ITEM_LIMITS` równe obcięciom w RPC relacji (test porównuje z migracjami) — za długa
  pozycja nie trafia na listę (#364, część kreatora). Błędy pól: `aria-invalid` + `aria-describedby`
  + fokus na pierwszym błędzie; puste pole → komunikat „wymagane” (#160, #367 część kreatora).
  Po „Dalej”/„Wstecz” fokus na nagłówku nowego kroku + ogłoszenie „Krok N z 9”, jeden region
  statusu zapisu (#402). Błąd zapisu pokazuje komunikat z kodu serwera (`toUserMessageKey`);
  `JOB_NOT_DRAFT` → link do listy ofert zamiast ponawiania (#363).
  Zapis kroku (#192, migracja `0083`): `updateJobDraft` woła jedno RPC `save_job_draft`
  (kolumny `jobs` z listy dozwolonych + tłumaczenie + relacje replace-all w jednej transakcji,
  tylko szkic, recruiter+) — błąd w części kroku nie zostawia częściowego zapisu. Treść kroku
  buduje `src/lib/job-draft-content.ts`. Dowód: `rls.sql` sekcja WZ192.
- [x] Edycja opublikowanej oferty (#325, migracja `0077`): „Edytuj” na liście ofert dla
  aktywnej/wstrzymanej oferty otwiera kreator w trybie edycji — kroki tylko walidowane, „Zapisz
  zmiany” wysyła całość jednym RPC `update_published_job` (recruiter+, firma `verified`,
  kompletność jak `publish_job`, CAS po `updated_at` → `JOB_EDIT_CONFLICT`, audyt). Status, slug,
  `published_at` i zgłoszenia bez zmian; zamknięta/wygasła → najpierw „Otwórz ponownie”
  (`JOB_NOT_EDITABLE`). Baza blokuje bezpośredni zapis treści i relacji oferty innej niż szkic
  (strażniki + `set_job_*` tylko dla szkicu). „Zobacz ofertę” dla aktywnej. Dowód: `rls.sql`
  sekcja RR.
  Powiadomienie o zmianie warunków (migracja `0144`): gdy `update_published_job` zmienia
  wynagrodzenie (kwoty, okres, waluta), miasto (porównanie przez `search_fold`), typ umowy albo
  godziny pracy — lista pól w jednym miejscu, `job_material_terms(jobs)` — trigger AFTER UPDATE
  na `jobs` tworzy powiadomienie in-app. Trigger reaguje WYŁĄCZNIE na zapis z tego RPC (lokalny
  znacznik `pracujbe.job_terms_notify` = id oferty, ustawiany tuż przed UPDATE i czyszczony po
  nim; bezpośredni UPDATE service_role/migracji i zmiany statusu nie powiadamiają); ta sama
  transakcja, odrzucona rewizja nie zostawia powiadomienia. Odbiorcy: kandydaci z AKTYWNĄ
  aplikacją (submitted/viewed/shortlisted/interview/offer_sent/offer_accepted; bez gości, szkiców
  i stanów końcowych; preferencja `in_app_enabled` jak zawsze). `system`, `entity_type=
  'job_terms'`, `data` = rodzaj, slug, nazwy pól (bez kwot). Tytuł
  `notifications.itemJobTermsChanged` w języku panelu odbiorcy (Invariant #1), link do
  `/candidate/aplikacje` (oferta wstrzymana/zamknięta/wygasła nie ma publicznej strony). Bez
  e-maila (bezpieczny wariant). Dowód: `rls.sql` sekcja JT144 (kontrole ujemne: pole spoza listy,
  brak filtra stanu aplikacji, bramka znacznika, surowe porównanie miasta), unit
  `job-terms-notification`.
  **Otwarte (decyzja produktowa):** e-mail o zmianie warunków, wskazanie w powiadomieniu, co się
  zmieniło.
- [x] Status weryfikacji firmy w panelu (#399/#400/#365/#368/#401, migracja `0072`): baner statusu
  na pulpicie (checklista „Pierwsze kroki”) i nad kreatorem (szkic teraz, publikacja po
  weryfikacji); zweryfikowana firma bez baneru. Odrzucona firma: „Wyślij ponownie do weryfikacji”
  (`request_company_reverification`, rejected→pending, owner/admin, audyt). Zmiana nazwy/VAT
  zweryfikowanej firmy wraca do `pending` (trigger `protect_company_verification`) z komunikatem
  w formularzu. Pracodawca bez firmy widzi w panelu formularz zakładania firmy
  (`create_first_company`: firma + VAT + owner w jednej transakcji, idempotentnie), a
  `/rejestracja-pracodawca` z sesją pracodawcy → panel. Chrome panelu: `getEmployerShellData`
  zwraca `demo`/`ok`/`error`; firma demonstracyjna tylko w trybie demo. Dowód: `rls.sql` sekcja MM.
  Powód odrzucenia/zawieszenia (#310, `0084`): `companies.status_reason` w banerze `/employer/firma`.
  Czas weryfikacji (decyzja właściciela 26.09.2026): baner dla `unverified`/`pending` we wszystkich
  wariantach (pulpit, kreator, `/employer/firma`) dodaje `company.bannerEta` („Zwykle do 2 dni
  roboczych”) — bez innych obietnic; test `company-status-banner-reason` (kontrola ujemna).
- [x] Import ogłoszenia przez AI (#465, za flagą, domyślnie wyłączony): krok „Zaimportuj
  z ogłoszenia” nad kreatorem nowej oferty — zrzut ekranu (PNG/JPG/WebP ≤ 5 MB, magic bytes)
  albo link (pobranie serwerowe odporne na SSRF: `src/lib/ai-import/safe-fetch.ts`). Model
  OpenAI (`gpt-6-luna`, strict structured output, `src/lib/ai-import/extract.ts`) → mapowanie tymi samymi
  schematami kroków (`map.ts`), pola niepewne na liście „do sprawdzenia” w kroku; poprawne kroki
  do szkicu jednym `save_job_draft`, nigdy publikacja. Akcja `importJobListing`: recruiter+
  aktywnej firmy, limit per firma 10/h i 30/dobę (fail-closed). Podejrzenie prompt injection =
  wszystko do sprawdzenia, bez zapisu. Env: `AI_JOB_IMPORT_ENABLED`, `OPENAI_API_KEY`,
  opcjonalnie `AI_JOB_IMPORT_MODEL`/`AI_MODEL`; atrapa `AI_JOB_IMPORT_PROVIDER=fixture` tylko poza
  produkcją (E2E `job-import.spec`). Research, koszty, prywatność: `docs/AI_JOB_IMPORT.md`.
  Dostawca AI (decyzja właściciela 2026-09-26): wyłącznie OpenAI „GPT-6 Luna” (`gpt-6-luna`,
  0,10/0,50 USD za 1 mln tokenów wejścia/wyjścia) — jeden klient `src/lib/ai/openai.ts`
  (Responses API, `strict` JSON Schema, `store: false`, timeout 60 s, bez logowania treści),
  model z `src/lib/ai/model-config.ts` (`AI_*_MODEL` → `AI_MODEL` → `gpt-6-luna`), klucz
  `OPENAI_API_KEY` tylko na serwerze; SDK Anthropic usunięte. Strażnik `ai-inventory`: SDK
  `openai` importuje tylko ten plik, import klienta = wywołanie modelu, `@anthropic-ai/*`
  w `src/`/`scripts/` = czerwony (kontrole ujemne); test `ai-openai-client`.
  Globalny budżet AI (#36, migracja `0120`, `docs/AI_BUDGET.md`): każde wywołanie modelu przez
  `withAiBudget` (`src/lib/ai/budget.ts`) — rezerwacja górnej granicy kosztu PRZED API
  (`ai_budget_reserve`, blokada doradcza, limit doby i miesiąca w Europe/Brussels), rozliczenie
  tokenami z `usage` (`ai_budget_settle`; bez `usage` = pełna rezerwacja). Fail-closed: limit
  przekroczony/0/brak, brak bazy zadań albo błąd = brak wywołania, `AI_BUDGET_EXCEEDED`. Limity
  startowe 10 USD/dobę i 100 USD/miesiąc (`ai_budget_limits`, zmiana tylko w bazie). Rejestr
  `ai_usage_ledger` bez treści i identyfikatorów osób/firm. Raport tylko do odczytu
  `/admin/koszty-ai`; czujki `ai_budget_*` w `/api/health/ops`. Strażnik: funkcja `behind_flag`
  w inwentarzu musi mieć `costBudgeted: true` — import ogłoszeń, asystent treści, import CV
  (#487, `src/lib/cv-import/cost.ts`) i tłumaczenia (#514, `estimateTranslationCost`). Dowód: `rls.sql` sekcja AIB36 (kontrola ujemna), unit `ai-budget`,
  `ai-budget-report`. **Otwarte:** DPA/retencja dostawcy (decyzja właściciela), limity per firma
  poza limiterem importu.
  Porzucone rezerwacje (#609, migracja `0134`): jeśli proces pada między rezerwacją a
  rozliczeniem, rezerwacja nie może blokować limitu bezterminowo. `/api/maintenance` woła co
  godzinę `ai_budget_release_stale_reservations` (service_role, idempotentne, `FOR UPDATE SKIP
  LOCKED`) — rezerwacja starsza niż 60 minut i wciąż `reserved` jest rozliczana jako
  `outcome='failed'`, koszt 0 (ślad w rejestrze zostaje, limit doby/miesiąca wraca do użycia).
  TTL dłuższy niż próg ostrzeżenia `staleReservations` (15 min) w `ai_budget_status`, więc
  trwające jeszcze wywołanie nie jest zwalniane przedwcześnie. Dowód: `rls.sql` sekcja AIB609.
  Minimalizacja (#500): przed modelem tylko `<main>`/`<article>` i `JobPosting` z listy pól
  (`src/lib/ai-import/minimize.ts`), e-maile/telefony/NISS/numery dokumentów zastąpione
  znacznikiem, w prompcie sam host; `contactEmail` poza schematem (ręcznie w kroku 9). Wyjście:
  pole z e-mailem/telefonem czyszczone, identyfikator → odmowa `JOB_IMPORT_SENSITIVE_DATA`.
  Zrzutu nie redagujemy lokalnie (brak OCR). Test: `ai-import-minimize`. **Otwarte (#500):**
  ocena prawna (art. 6/14, role), decyzja o imporcie obrazu.
- [x] Asystent redagowania treści oferty (#37, część pracodawcy; za flagą `AI_JOB_ASSIST_ENABLED`,
  domyślnie wyłączony; `docs/AI_JOB_ASSIST.md`): panel na krokach 5–6 kreatora
  (`JobAssistPanel`) → akcja `suggestJobText` (recruiter+ aktywnej firmy, limit per firma 20/h
  i 60/dobę fail-closed, globalny budżet AI #36 przez `src/lib/ai-assist/budget.ts`) → model
  OpenAI (`gpt-6-luna`, `AI_JOB_ASSIST_MODEL`/`AI_MODEL`, strict structured output) → propozycja brzmienia opisu,
  obowiązków i wymagań w języku oferty. Wejście ścisłe (tylko tekst oferty — bez danych
  kandydatów), e-maile/telefony/identyfikatory usuwane przed wysłaniem, polecenia dla AI
  (wzorce PL/NL/FR/EN + flaga modelu) = brak propozycji; propozycja z nową liczbą/linkiem albo
  danymi kontaktowymi nie jest pokazywana. Pole zmienia się tylko po „Użyj propozycji”, obok
  zawsze tekst rekrutera i „Przywróć mój tekst”; akcja niczego nie zapisuje i nie publikuje.
  Informacja o AI przed pierwszym użyciem. Atrapa `AI_JOB_ASSIST_PROVIDER=fixture` tylko poza
  produkcją. Testy: `job-assist-guard`, `job-assist-action`, `ai-inventory`, E2E `job-assist`.
  **Otwarte:** część dla kandydata (#37), ocena prawna art. 50 AI Act,
  fakty słowne (bez liczb) wykrywa tylko przegląd rekrutera.
- [x] Wygaszanie ofert (#72, migracja `0085`): `expire_due_jobs()` (service_role, `SKIP LOCKED`,
  zwraca liczbę) zmienia tylko `active` z `expires_at <= now()` na `expired`; woła je
  `/api/maintenance` (cron Railway co godzinę, `docs/railway/README.md`). Panel nie czeka na cron:
  licznik aktywnych filtruje datę, lista pokazuje aktywną po terminie jako `expired`
  (`src/lib/job-expiry.ts`) z akcją „Otwórz ponownie”, kreator jej nie edytuje. `publish_job` z
  minioną datą i `resume` wstrzymanej po terminie → `JOB_EXPIRED` (bez cichego czyszczenia daty);
  `reopen` usuwa minioną datę, także dla aktywnej/wstrzymanej po terminie. Dowód: `rls.sql` sekcja EX72.
- [x] Szczegół zgłoszenia `/employer/aplikacje/[id]` (#300) — wiadomość, telefon, dostępność, data, profil zawodowy (umiejętności/języki/certyfikaty/doświadczenie), dopasowanie, historia statusów, „Napisz wiadomość” (`openConversation`) i zmiana statusu (`ApplicationStatusMenu`); odczyt pod RLS recruiter+ aktywnej firmy (`getEmployerApplicationDetail`), jawne stany błąd/404; linki z listy i pulpitu
- [x] Zespół firmy i kolejna firma (#403, migracja `0086`): `/employer/zespol` — lista członków
  (owner/admin; RPC `get_company_team`), zmiana roli (`set_company_member_role`), odebranie/
  przywrócenie dostępu (`set_company_member_active`, z potwierdzeniem), zaproszenie po e-mailu
  (`invite_company_member`: rola admin/recruiter/member, ważne 14 dni, idempotentne, limit 50
  oczekujących) i cofnięcie (`revoke_company_invitation`). Hierarchia (`can_manage_company_role`,
  lustro UI `src/lib/team/permissions.ts`): owner zarządza każdym, admin tylko recruiter/member,
  nikt własnym członkostwem przez RPC; ostatni aktywny owner nietykalny (jawnie w RPC + trigger
  `enforce_owner_invariants` z tą samą hierarchią dla bezpośredniego DML). Bezpośredni INSERT do
  `company_members` odebrany — dołączenie tylko przez przyjęcie zaproszenia
  (`respond_to_company_invitation`: zweryfikowany e-mail sesji = adres zaproszenia, konto
  pracodawcy; przyjęcie przełącza aktywną firmę). Istniejące konto pracodawcy dostaje powiadomienie
  (`system`/`company_invitation` → `/employer/zespol`) i e-mail `teamInvitation` w języku odbiorcy;
  odpowiedź RPC nie zależy od istnienia konta. Zaproszenia widać też w widoku zakładania firmy
  (konto bez firmy). „Dodaj kolejną firmę” w przełączniku → `/employer/firma/nowa`
  (`create_additional_company`: owner, `unverified`, limit 5 firm z rolą owner, idempotentne
  ≤ 10 min, audyt). Rola `member`: zamiast „Dodaj ofertę”, edycji i cyklu życia ofert —
  wyjaśnienie (`RecruiterOnlyNote`). Każda zmiana → `audit_logs`. Dowód: `rls.sql` sekcja TM403;
  unit `team-actions`, `team-members-ui`; E2E `employer-team.spec`.
  Adres BEZ konta (migracja `0121`): zapraszający wybiera język zaproszenia (PL/NL/FR/EN,
  domyślnie język strony — decyzja: brak profilu odbiorcy = jedyny znany język, Invariant #1;
  konto z profilem dostaje e-mail w języku profilu), `company_invitations.locale`. E-mail
  `teamInvitationSignup` z linkiem `/{locale}/rejestracja-pracodawca#token=` — token =
  HMAC(`GUEST_APPLY_SECRET`, `team-invite:`+nonce) (`src/lib/team/invite-token.ts`), w bazie
  tylko hash (czyszczony po rozstrzygnięciu), nonce w payloadzie; odświeżenie zaproszenia
  wymienia token; najwyżej 3 linki na adres na dobę. Strona rejestracji (`EmployerSignupEntry`)
  czyta token z fragmentu, podgląd `team_invitation_signup_preview` (service_role) → formularz
  bez nazwy firmy, adres z zaproszenia; `registerInvitedEmployer` zużywa token
  (`consume_team_invitation_signup`, raz, tylko ten adres). Konto powstaje bez firmy, a
  zaproszenie czeka w panelu po weryfikacji adresu. Wynik RPC niezależny od konta. Dowód:
  `rls.sql` sekcja TI403 (kontrole ujemne), unit `team-invitation-signup-*`, E2E `employer-team`.
  Utwardzenie (#611/#610, migracja `0133`): limit „najwyżej 3 e-maile `teamInvitationSignup`
  na adres / 24 h” jest teraz atomowy — advisory lock kluczowany adresem serializuje odczyt
  licznika i wstawienie w `enqueue_team_invitation_signup_email` (jak `begin_checkout`, 0050),
  więc równoległe zaproszenia z różnych firm dla tego samego adresu nie omijają limitu.
  Doprecyzowany i przetestowany kontrakt stanu `used` w `team_invitation_signup_preview`
  (token zużyty, zaproszenie nadal `pending` — czeka w panelu). Dowód: `rls.sql` sekcje
  TI610 (sekwencja preview → consume → preview) i TI611 (dwie równoległe sesje przez dblink),
  unit `team-invitation-signup-preview`.

### Etap 5 — procesy
- [x] Matching (logika + test jednostkowy + integracja z UI) — deterministyczny `scoreMatch` (test), RPC `get_job_match_profile` (0024, tokeny wymagań oferty), loader `getMyJobMatch` (profil kandydata pod RLS + oferta przez RPC), wyspa kliencka `JobMatchCard` na detalu oferty (SSR/SEO bez zmian dla anonimów; kandydat widzi „Twoje dopasowanie" %, atuty, braki). i18n `match` (pl/nl/fr/en). Dowód RPC: `rls.sql` I10.
  Poziomy języków (#195, 0074): każdy wymagany język = 10/n pkt; poziom ≥ wymagany (lub oferta
  bez poziomu) → pełny udział, o jeden niżej → połowa, niżej lub nieznany → 0; luka w
  `languageGaps` (komunikat `match.languageLevel*`). Lokalizacja (#194): odległość haversine
  vs `radius_km` (w promieniu 15, poza 0, remote bez ograniczeń); współrzędne: słownik
  `locations` z bazy, potem kanoniczna lista ~46 belgijskich miast w kodzie z aliasami
  PL/NL/FR/EN (`src/lib/matching/belgian-cities.ts`, 10 miast = wartości z `0010`, strażnik
  w `matching-locations.test.ts`); miasto spoza obu → ten sam region = 10 bez etykiety
  „w promieniu”.
  Słownik w bazie (#194, migracja `0112`): 602 miejscowości = lista
  kanoniczna z kodu (jej współrzędne i aliasy mają pierwszeństwo) + wszystkie gminy Belgii
  i gminy zniesione przy fuzjach 2019/2025 z migawki Wikidata (CC0 1.0,
  `data/locations/`, bez API w runtime), `is_demo = false`. Kolumny `locations.kind`
  (`municipality`/`former_municipality`/`locality`) i `refnis` (kod NIS). Tabela
  `location_aliases` (nazwy PL/NL/FR/EN, `alias_key` = `cityKey`, unikalny; własna nazwa gminy
  wygrywa z egzonimem — „Saint-Nicolas” to gmina w prowincji Liège, nie Sint-Niklaas),
  odczyt publiczny, zapis service_role. Loader `getMyJobMatch` pyta tylko o klucze miasta
  kandydata i oferty. Migracja jest GENEROWANA (`node scripts/locations/build-migration.mjs`;
  odświeżenie migawki `node scripts/locations/fetch-wikidata.mjs`); test porównuje plik
  z generatorem, lustro TS z bazą (z kontrolą ujemną) i klucze z `cityKey`. Dowód: `rls.sql`
  sekcja LOC194 (kontrola ujemna bez polityki RLS), rollback `supabase/rollback/0112_…down.sql`,
  integracja `portal-candidate` (Puurs–Bornem tylko z bazy; mutacja bez słownika = czerwony).
  **Do zrobienia:** części gmin (deelgemeenten), geokodowanie miejscowości spoza słownika;
  zmiana listy w kodzie po wdrożeniu 0112 = nowa migracja (test wskazuje plik 0112).
  Polecane oferty (#196): `get_public_jobs_by_ids` dla najlepszych `matches`, bez limitu 100 najnowszych.
  Certyfikaty (#96, 0079): `candidate_certificates.expires_at` zapisywane przez
  `set_candidate_certificates(jsonb)` (krok 5 onboardingu: data „Ważny do” przy każdym certyfikacie,
  oznaczenie „Wygasł”); `scoreMatch(…, { today })` nie liczy certyfikatu z `expires_at` < dziś
  (dzień w Europe/Brussels, `referenceDate`), wygasły wymagany → `expiredCertificates` z wyjaśnieniem.
  Top dopasowani (#141, 0079): `get_company_top_matches` — najlepsze dopasowanie na kandydata
  (DISTINCT ON) przed limitem 5, pod RLS (recruiter+, widoczność kandydata, firma verified).
  Dowód: `rls.sql` sekcja MC.
  Odporność odczytu (#191/#197): `getSimilarJobs` i `getMyJobMatch` zwracają jawny wynik
  (`ok`/`error`, dopasowanie także `none`). Awaria podobnych ofert nie blokuje szczegółu
  i aplikowania; błąd któregokolwiek z pięciu odczytów dopasowania daje „nie udało się
  policzyć” z ponowieniem, nigdy procent z niepełnych danych.
- [~] Taksonomia ESCO v1.2.1 (#93, migracja `0097`, `docs/ESCO.md`): zawody/umiejętności z
  przypiętego snapshotu tylko w PL/NL/FR/EN (RO/UK z issue pominięte — decyzja właściciela).
  `esco_uri` = klucz, `occupation_labels`/`skill_labels` (preferred/alternative, FK do
  `supported_locales`), `occupation_skills` (essential/optional), `esco_snapshots` (pliki +
  SHA-256, atrybucja, raport). Import `npm run esco:import` (`scripts/esco/`): jedna transakcja
  jako service_role, upsert po URI, ponowny import = zero zmian, inne pliki tej wersji →
  `ESCO_CHECKSUM_MISMATCH`, wiersz ręczny z tym samym URI → `ESCO_MANUAL_CONFLICT` (skip/overwrite
  tylko jawnie). Fallback `occupation_label`/`skill_label`: język → en → name. Słowniki czytelne
  publicznie, zapis tylko service_role. Dowód: `rls.sql` ESCO93, unit `esco-snapshot`,
  `npm run test:esco`. Fragment testowy (API ESCO, `is_demo`) w `tests/fixtures/esco/`.
  **Do zrobienia (właściciel):** pobranie oficjalnych paczek CSV (formularz z linkiem e-mail),
  zatwierdzenie `data/esco/esco-v1.2.1.manifest.json`, pełny import; atrybucja w UI i matching
  na ESCO = osobne issues.
- [~] Tłumaczenia AI — rdzeń (#31, #32, migracja `0145`, `docs/AI_TRANSLATION.md`), tylko
  pl/nl/fr/en, domyślnie wyłączone (`AI_TRANSLATION_ENABLED`). Kolejka: niezmienne rewizje
  źródła (kanoniczne pola + SHA-256, ta sama treść = no-op), zadania per język docelowy i wersję
  pipeline (unikat = deduplikacja), `claim_translation_jobs` (SKIP LOCKED + lease, restart =
  przejęcie wygasłej dzierżawy), `complete_translation_job` (CAS po lease + kontrola bieżącej
  rewizji — wynik v1 po v2 = `superseded`), `fail_translation_job` (backoff/jitter/Retry-After),
  ukrycie/purge encji, korekta ręczna z autorem i wersją (AI jej nie nadpisuje). Wszystko RPC
  service_role, tabele deny. Adapter `src/lib/translation/`: interfejs dostawcy + OpenAI
  (`openai-provider.ts` na wspólnym kliencie `src/lib/ai/openai.ts`, `gpt-6-luna`, structured
  output `strict`, bez narzędzi, `store: false`, dane w `<source_fields>`), walidacja
  kształtu i niezmienności faktów pole po polu (`facts.ts`: liczby, kwoty, waluty, daty,
  godziny, e-maile/URL/telefony, jednostki, brutto/netto, okres stawki, kwalifikacje, nazwy
  własne, negacja) — niepoprawny wynik nigdy nie trafia do bazy; logi tylko kody. Worker
  `processTranslationBatch` (dostawca poza transakcją). Budżet AI (#36): adapter przez
  `withAiBudget` (rezerwacja przed API, rozliczenie tokenami, log użycia bez treści); odmowa
  budżetu → `defer_translation_job` (zadanie wraca po 1 h / 5 min bez zużycia próby). Dowód:
  `rls.sql` sekcja TR31 z kontrolami ujemnymi TR31-N i TR31-13N; unit `translation-*`.
  **Do zrobienia:** wpięcie profili (#34), benchmark i wybór modelu (#30), UI/SEO stanu tłumaczenia.
  Oferty (#33, migracja `0146`, zależy od #514): odroczone triggery na `jobs`/
  `job_translations`/`job_requirements`/`companies` → przy COMMIT `sync_job_translation_source`:
  oferta publiczna (active, niewygasła, firma verified, nie demo) = `record_translation_source`
  z polami w języku oferty (opis, listy, wymagania tekstowe `requirements_mandatory.N`/
  `_optional.N`), niepubliczna = ukrycie, usunięta = purge. Każda ścieżka zapisu (publish,
  edycja, pauza/wznowienie, wygaśnięcie, moderacja, status firmy) kolejkuje zatwierdzoną treść;
  rollback bez śladu, jedna transakcja = jedna rewizja, stawka/miasto bez rewizji (wspólne
  z `jobs`), limit pól rdzenia = `skipped` bez blokady publikacji. Worker `POST
  /api/translation/process` (`MAINTENANCE_SECRET`, `src/lib/translation/run.ts`, log użycia AI),
  bez flagi `skipped`. Wersja pipeline SQL = TS (`translation-job-sync.test`). Dowód: `rls.sql`
  sekcja TR33 (dwie sesje przez dblink, kontrola ujemna TR33-N); sekcja TR31 na własnych
  encjach. **Otwarte:** odczyt przekładów w widoku oferty/liście/JobPosting (UI/SEO), UI korekty
  ręcznej, `protectedTerms` (nazwa firmy), cron (właściciel).
- [x] Aplikacje — RPC `apply_to_job`/`transition_application` (idempotentne, historia auto, kolejka e-mail) + server actions + wpięcie do UI paneli/ApplyModal (zweryfikowane na PG)
  Dostępność w aplikacji (#190, 0074): osobna wartość `within_two_weeks` („w ciągu 2 tygodni”);
  profil kandydata zachowuje węższy zestaw `AVAILABILITY_VALUES`.
  Ponowna aplikacja (0071, #361): ten sam klucz idempotencji = retry → sukces; inny klucz przy
  istniejącej parze (także `withdrawn`) → `APPLICATION_ALREADY_EXISTS` („Już aplikowałeś…” + link do
  historii). ApplyModal: klucz w `useRef` na czas otwarcia, wyjątek sieci → komunikat `apply.errorNetwork`
  i ponowienie tym samym kluczem (#360); `UNAUTHENTICATED` (link logowania) odróżniony od
  `PERMISSION_DENIED` (konto nie-kandydata), własne komunikaty `RATE_LIMITED`/`JOB_NOT_ACTIVE`.
  Dowód: `rls.sql` B3b/B3c, J7d–J7f.
  Bez NISS/BIS i numerów dokumentów (#495): wiadomość do firmy i odpowiedzi na pytania
  (kandydat i gość) z numerem rejestru narodowego/BIS (mod 97), PESEL, kartą eID albo numerem
  po słowie kluczowym („paszport nr…”) → błąd przy polu, bez zapisu (`findPersonalIdentifierField`
  w akcjach + refine w Zod; detektor `src/lib/privacy/sensitive-data.ts`). Podpowiedź pod polem
  wiadomości. Test: `sensitive-data`, `apply-sensitive-id`. **Otwarte:** ocena prawna, treść
  poradnika i formularza CV (#495), import CV (#487), wiadomości w rozmowach.
  Pytania screeningowe (#101, migracja `0093`): recruiter+ ustala w kroku 7 kreatora do 10 pytań
  (`yes_no`/`single_choice`/`date`/`short_text`, „wymagane”, kolejność, treść w języku oferty +
  opcjonalne tłumaczenia) — zapis w tej samej transakcji co krok (`save_job_draft` →
  `set_job_screening_questions`, replace-all), WYŁĄCZNIE w szkicu (RPC + strażnik na tabeli; w
  edycji opublikowanej oferty tylko podgląd). Kandydat odpowiada w ApplyModal (widzi, że odpowiedzi
  idą do firmy i nie zmieniają dopasowania ani statusu); `apply_to_job(…, p_answers)` waliduje je
  w bazie (`SCREENING_ANSWER_REQUIRED: <id>` → błąd przy pytaniu) i zapisuje niezmienny snapshot
  pytania i odpowiedzi (`application_screening_answers`) w tej samej transakcji; retry z tym samym
  kluczem nie nadpisuje odpowiedzi. Odczyt odpowiedzi: kandydat i recruiter+ firmy oferty; widok
  w szczególe zgłoszenia. Bez reguł dyskwalifikujących i bez LLM (osobny etap). Dowód: `rls.sql`
  sekcja SQ101; unit `screening-questions`; E2E `job-wizard-screening`, `apply-screening` (fixture),
  `employer-application-screening`. Historia zgłoszeń kandydata: karta z zapisanymi
  odpowiedziami ma rozwijane „Moje odpowiedzi” (`ApplicationScreeningAnswers`; licznik z
  podzapytania strony, treść przy pierwszym rozwinięciu przez `loadApplicationScreeningAnswers`
  → `getMyApplicationScreeningAnswers` pod sesją/RLS, snapshot w języku widza z fallbackiem,
  błąd z ponowieniem). Dowód: `portal-candidate.test.ts` (PG16), unit
  `candidate-application-answers`, E2E `candidate-application-answers`, `panel-a11y`.
  Kontrola treści pytań przed publikacją (#497, migracja `0103`): detektor
  deterministyczny (wzorce PL/NL/FR/EN, bez AI) w bazie (`screening_fold`,
  `screening_risk_patterns`, `screening_question_risk`) sprawdza treść i KAŻDĄ opcję we
  WSZYSTKICH językach; lustro `src/lib/screening/risk.ts` (podpowiedź w kreatorze, test
  `screening-risk` porównuje wzorce 1:1 i pilnuje braku trafień na pytania o doświadczenie,
  prawo jazdy, dostępność, języki, VCA). Kategorie: wiek, płeć, ciąża/plany rodzinne, stan
  cywilny, religia, pochodzenie, zdrowie, orientacja, związki zawodowe, poglądy polityczne,
  karalność. Trafienie ≠ ocena prawna: przy zapisie kroku pytanie trafia do
  `screening_question_reviews` (jeden wiersz na ofertę × odcisk treści, audyt
  `screening_question.review_requested`), strażnik `enforce_screening_review` blokuje KAŻDĄ
  aktywację oferty (publikacja, wznowienie, ponowne otwarcie) do akceptacji bieżącej treści
  (`SCREENING_REVIEW_REQUIRED`/`SCREENING_QUESTION_REJECTED: <pozycja>` → komunikat przy pytaniu
  w kreatorze). Zmiana treści/tłumaczenia = nowy odcisk = nowa decyzja; akceptacja nie
  publikuje. Admin: `/admin/pytania` (treść we wszystkich językach, `admin_decide_screening_review`
  — odrzucenie z uzasadnieniem, STALE_STATE dla treści nieobecnej w ofercie, audyt
  `screening_question.reviewed`, powiadomienie in-app dla zapisującego). Dowód: `rls.sql` sekcja
  SR497 (kontrola ujemna: bez strażnika oferta się publikuje); unit `screening-risk`,
  `screening-review`, `screening-review-editor`; E2E `admin-screening-review`,
  `job-wizard-screening`. Teksty komunikatów do akceptacji właściciela. **Otwarte (#497):**
  katalog dopuszczalnych wzorców i wyjątków art. 9/10 (właściciel + prawnik), wstrzymanie
  zbierania odpowiedzi dla ofert JUŻ aktywnych z pytaniem odrzuconym po publikacji i los
  zapisanych odpowiedzi, zgłoszenie pytania przez kandydata (dziś ogólne zgłoszenie oferty DSA
  #41), e-mail o decyzji, informacja dla kandydata (#61), rejestr (#485), retencja (#486).
  Aplikacja bez konta (#98, migracja `0095`, `docs/GUEST_APPLY.md`): gość w ApplyModal
  (`GuestApplyForm`: imię i nazwisko, e-mail, zgoda; reszta opcjonalna) → Turnstile
  `guest_apply` + limity IP/adres → `submit_guest_application` (service_role, zgłoszenie
  `pending` ze snapshotem zgody, e-mail `guestApplicationConfirm` w języku formularza) →
  `/aplikacja/potwierdz` (przycisk, nie GET) → `confirm_guest_application` tworzy aplikację
  z `candidate_id NULL` i snapshotem, powiadamia firmę jak `apply_to_job`, wysyła
  `guestApplicationSent` z linkiem przejęcia → `/aplikacja/przejmij` →
  `claim_guest_application` (kandydat ze zweryfikowanym, tym samym e-mailem; token działa
  raz, ponowienie tego samego konta idempotentne). W bazie tylko hash tokenu; token =
  HMAC(`GUEST_APPLY_SECRET`, cel:nonce), link składa worker. Pracodawca widzi aplikację
  z oznaczeniem „Bez konta” (e-mail, telefon, status); rozmowa i propozycja dopiero po
  przejęciu. Pytania screeningowe (#101) obowiązują także gościa: `record_screening_answers`
  w trybie bez aplikacji waliduje odpowiedzi przy wysłaniu, potwierdzenie zapisuje je do
  `application_screening_answers` (GA98-13). Retencja w `/api/maintenance`: niepotwierdzone 7 dni po ostatnim linku,
  duplikaty 7 dni po potwierdzeniu (z e-mailami), token przejęcia zerowany po 30 dniach.
  Linki (#505): token we fragmencie `#token=` → POST do cookie HttpOnly ścieżki → czysty URL;
  stary format `?token=` odrzucany w middleware (303 bez cookie, „link nieprawidłowy”) —
  `guest-legacy-link.test` z kontrolą ujemną.
  Dowód: `rls.sql` sekcja GA98; unit `guest-apply-*`; E2E `guest-apply.spec` (fixture).
  Zmiana statusu (0122): `transition_application` → `enqueue_guest_status_email` →
  `guestStatusChanged` w języku formularza (`guest_application_requests.locale` — jawnie
  zapisany język odbiorcy bez profilu, Invariant #1), klucz = id wiersza historii, tylko
  potwierdzone zgłoszenie, nieusunięta aplikacja bez konta, adres bez blokady (#44); wiersz
  kolejki = encja aplikacji (retencja #486 usuwa go z aplikacją); payload: imię gościa, firma,
  tytuł, status; CTA lista ofert, bez tokenu i linku wypisania. Dowód: `rls.sql` sekcja GS98
  (kontrole ujemne), unit `guest-status-email`. **Otwarte:** okres retencji do potwierdzenia
  w polityce prywatności (#40).
- [x] Propozycje pracy — RPC `send_offer`/`respond_to_offer` (idempotentne, outbox, niezależne od e-maila) + server actions + wpięcie do UI paneli (zweryfikowane na PG)
  Granica wygaśnięcia (0075, #88): `respond_to_offer` odrzuca `expires_at <= now()` — jak odczyt
  i UI. Wyścig accept/decline w dwóch sesjach: jedna wygrywa, druga `VALIDATION_FAILED`, historia
  i alerty pojedyncze (`rls.sql` PP7–PP8).
- [~] Wiadomości — konwersacje/wątek/wysyłka/przeczytania, zgłoszenia i załączniki gotowe (RPC 0016 + UI `/…/wiadomosci`, zweryfikowane na PG16)
  Zgłoszenia (migracja `0116`): strona rozmowy zgłasza wiadomość drugiej
  strony („Zgłoś” pod dymkiem) albo całą rozmowę (nagłówek wątku) — `ReportContentButton`
  (powód ze słownika `MESSAGE_REPORT_CATEGORIES`, opis ≤ 1000, znacznik treści prawnej „do
  uzupełnienia”) → `reportConversationContent` (limiter 10/h na konto) → RPC pod sesją
  `report_conversation_content`: `reports.kind='message_report'` (cel `message` albo nowy
  `conversation`, `conversation_id`), dostęp jak `is_conversation_member` (obca rozmowa i
  wiadomość spoza niej = `NOT_FOUND`, własna strona = `VALIDATION_FAILED`), dowód budowany w
  bazie z treścią WYŁĄCZNIE zgłoszonej wiadomości (rozmowa: same metadane), widoczny tylko dla
  admina (`reports_select_own` pomija ten rodzaj; stan własnych zgłoszeń bez dowodu —
  `get_my_message_reports`), idempotencja po kluczu (`duplicate`), jedna otwarta sprawa na
  wiadomość i na rozmowę × zgłaszającego (`already_open`, indeksy częściowe + blokada), limit
  20/dobę w bazie, niezmienność każdej roli (`reports_message_report_immutable`). Admin:
  `/admin/zgloszenia?kind=message_report` (dowód, strony, data), rozstrzyga `admin_resolve_report`.
  Dowód: `rls.sql` sekcja MR (kontrole ujemne: obca rozmowa, powtórka, stara polityka),
  unit `message-reports`, `thread-message-list`, E2E `message-report.spec`. **Otwarte:**
  treść prawna i retencja dowodu (#40/#486 — dowód zostaje po usunięciu konta nadawcy),
  powiadomienie zgłaszającego o wyniku, zgłoszenie jako sprawa DSA.
  Załączniki (migracja `0119`): PDF/DOC/DOCX/JPG/PNG ≤ 5 MB, najwyżej 3 na
  wiadomość (`src/lib/validation/message-attachment.ts` — przeglądarka i akcja; magic bytes
  i OOXML w `src/lib/files/message-attachments.ts`). „Dołącz plik” wgrywa plik od razu
  (`uploadMessageAttachment`: `can_attach_in_conversation` → PUT do prywatnego bucketu pod
  `<rozmowa>/att-<uuid>` → `stage_message_attachment`, idempotentnie po `client_upload_id`),
  `send_message(…, p_attachment_ids)` łączy pliki z wiadomością w tej samej transakcji
  (`client_message_id` jak #147; pusta treść tylko z plikiem). Lista w wątku
  (`get_message_attachments`) i pobranie (`get_message_attachment_download`) tylko dla bieżących
  uczestników i wysłanych wiadomości; pobranie = link HMAC 60 s `/api/files/message/<id>?t=`
  (klucz pochodny od `FILE_DOWNLOAD_SECRET`, trasa ponownie sprawdza sesję, dostęp i
  `scan_status`; kwarantanna = brak pobrania). Blokada firmy (#97): strona firmowa nie wgrywa
  plików i nie widzi plików kandydata. Tabela `message_attachments` bez grantów (RPC-only),
  klient nie tworzy/zmienia wierszy `files` załączników (trigger). Usunięcie wiadomości/rozmowy
  (także konta #486) usuwa `files` → `storage_deletion_queue`; niewysłane pliki > 24 h sprząta
  `purge_stale_message_attachments` w `/api/maintenance`. Dowód: `rls.sql` sekcja MA (kontrola
  ujemna: bez strażnika `files` ścieżka zostaje podmieniona); unit `message-attachments-*`.
  Podgląd i e-mail (migracja `0135` — numer tymczasowy): JPG/PNG dopuszczone do pobrania mają
  miniaturę pod nazwą pliku (`MessageAttachmentList` → `AttachmentPreview`): link HMAC 60 s
  z `prepareMessageAttachmentDownload` wystawiany dopiero po wejściu w widok
  (IntersectionObserver), `<img loading="lazy">`, alt `messages.attachmentPreviewAlt` z nazwą;
  kwarantanna, inne typy i błąd linku/obrazu = brak miniatury (nazwa i pobranie zostają).
  `send_message` dokłada do payloadu `newMessage` tylko `attachmentCount` (bez nazw, #503;
  `payload-fields.ts`, mapa danych), strona firmowa zablokowana przez kandydata-nadawcę (#97)
  dostaje 0; e-mail pokazuje „Załączniki w wiadomości: N” (`newMessageAttachmentsLabel`, 1–3).
  Dowód: `rls.sql` sekcja MN135 (kontrola ujemna: bez warunku blokady MN135-4 czerwony), unit
  `message-attachment-preview` (kontrole ujemne: kwarantanna, pole spoza listy workera).
  **Otwarte:** AV (jak CV), podgląd w trybie demo (brak załączników demo).
  Wysyłka idempotentna (0075, #147): `send_message(conversation, body, client_message_id)` —
  `MessageComposer` trzyma jeden UUID na operację danej treści (`useRef`), ponowienie po
  zerwanym połączeniu = ta sama wiadomość bez drugiego powiadomienia/e-maila. Dowód: `rls.sql`
  sekcja PP (retry, dwie równoległe sesje przez dblink, rollback pierwszej próby).
  Odbiorcy powiadomień/e-maili firmowych (aplikacja, wiadomość, odpowiedź na propozycję) = aktywni
  recruiter+ z aktywnym profilem (`company_recipient_ok`, 0070); e-mail o wiadomości od firmy do
  kandydata podpisany nazwą firmy. Dowód: `rls.sql` sekcja LL.
  Nadawca w wątku (#355): profil niewidoczny pod RLS → nazwa firmy dla strony firmowej (strona
  ustalana z `company_members` pod RLS), inaczej etykieta `messages.sender*Fallback`; imienia
  rekrutera nie ujawniamy (0023). Demo wiadomości w języku strony (#359). Stan ładowania listy
  i wątku (#177): `wiadomosci/loading.tsx` + `ConversationOpenPending`, E2E `messages-loading.spec`.

### Etap 6 — komunikacja
- [x] Wybór języka odbiorcy (fallback) — util + test + `resolve_recipient_locale()` w DB (INVARIANT #1 egzekwowany przy kolejkowaniu)
- [~] Kolejka e-mail + worker + ponawianie — outbox (`email_deliveries`: attempts/next_attempt_at/payload), worker `src/lib/email/outbox.ts` + route `/api/email/process` (sekret) gotowe; realna wysyłka wymaga kluczy dostawcy
  Dostawca poczty (decyzja właściciela 25.09): **EmailLabs** domyślnie, Resend jako alternatywa —
  wspólny transport `src/lib/email/transport/` (wybór `EMAIL_PROVIDER=emaillabs|resend`; pusty =
  EmailLabs przy komplecie `EMAILLABS_APP_KEY`/`_SECRET_KEY`/`_SMTP_ACCOUNT`, inaczej Resend;
  jawny bez kluczy albo nieznana wartość = brak wysyłki, bez cichego przełączenia) w obu
  workerach (`email_deliveries` i `auth.email_outbox`). EmailLabs REST v2.1: `messageId` =
  UUID wiersza + domena nadawcy (= `provider_message_id`), deduplikacja ponowień przez
  `GET /v2.1/email?messageId` przed każdą wysyłką (brak Idempotency-Key u dostawcy), ACK tylko
  z tym identyfikatorem w odpowiedzi, `X-TRACKING-OFF: 1`, nagłówki wypisania bez zmian, kody
  `EMAIL_PROVIDER_*` zamiast komunikatu dostawcy. Webhook `POST /api/email/webhook/emaillabs`
  (SHA1 sekret|data|Request-Id + opcjonalny Basic auth, inbox `emaillabs:<Request-Id>`,
  hardbounce → blokada, softbounce/spambounce bez blokady, deferred → opóźnienie, ok →
  delivered). `/api/health`: `emailProvider`, `checks.emailProviderReady`/`emaillabsWebhook`.
  Opis i kroki panelu:
  `docs/EMAILLABS_SETUP.md`. Testy: `emaillabs-transport`, `emaillabs-webhook` (atrapa HTTP,
  kontrola ujemna deduplikacji). **Do zrobienia (właściciel):** domena/DKIM/SPF/DMARC, konto
  SMTP z wyłączonym open trackingiem, własnym wypisem i stopką, klucze API z prawem odczytu
  statusów, webhook, włączenie statusów „OK” u wsparcia, zmienne w Railway.
  Harmonogram: cron Railway (`scripts/railway-cron-call.mjs` → `/api/email/process`), opis w `docs/RESEND_SETUP.md` §6 (#296).
  Zastępczo (plan Railway bez usług cron): Cloudflare Worker z Cron Triggers `infra/cloudflare-cron/`
  (`*/5` → `/api/email/process`, co godzinę → `/api/maintenance`, sekrety jako Worker secrets,
  semantyka i kody jak caller Railway; niewdrożony — kroki właściciela w `docs/CLOUDFLARE_CRON.md`;
  test `cloudflare-cron-worker` z kontrolą bramki hasła).
  Wypisanie i budżety (#45, etap 1, migracja `0087`): token HMAC (`src/lib/email/unsubscribe-token.ts`,
  `EMAIL_UNSUBSCRIBE_SECRET`; UUID konta + kategoria + 180 dni, bez e-maila w URL), link w stopce
  → `/{locale}/wypisz` (noindex, zapis dopiero po kliknięciu), nagłówki `List-Unsubscribe` +
  `List-Unsubscribe-Post` → `POST /api/email/unsubscribe` (RFC 8058, idempotentne RPC
  `email_unsubscribe`, tylko service_role; GET = 303 bez zmian). Kategorie: `src/lib/email/categories.ts`
  = `email_preference_category`; marketing domyślnie wyłączony (`email_allowed`). `claim_email_batch`
  ponownie sprawdza zgodę i wygasza wiersz (`suppressed_at`). Atomowy budżet okna
  (`take_email_send_budget`, rezerwy auth/transakcyjna; odmowa = odłożenie bez `attempts`).
  Dowód: `rls.sql` sekcja UN45 (dblink, kontrole ujemne), `email-unsubscribe.test.ts`, E2E
  `email-unsubscribe.spec`.
  Etap 2 (#45, migracja `0101`): niezmienny dowód zgody
  `email_consent_events` (trigger na `notification_preferences` — każda ścieżka zapisu; źródło
  `settings`/`unsubscribe_page`/`one_click`/`direct`, język, wersja treści `sha256:` z etykiet
  formularza — `src/lib/email/consent-wording.ts`); ustawienia przez RPC
  `set_notification_preferences`, `/wypisz` także „ze wszystkich” (`email_unsubscribe_all`).
  Budżet na odbiorcę przy kolejkowaniu (`email_recipient_budget_config` `pool:`/`template:`,
  domyślnie newsletter 1/dobę, marketing 10/dobę; `INSERT … ON CONFLICT DO UPDATE WHERE used <
  limit`; ponad limit = ślad `suppressed_recipient_budget`; wygaszony list oddaje miejsce).
  `enqueue_email` → `enqueue_email_outcome` (wynik kolejkowania). Kampanie: `email_campaigns`
  (slug + rewizja, treść w każdym języku serwisu) + `email_campaign_recipients` (PK rewizja +
  odbiorca, status reserved/queued/accepted/delivered/skipped_consent/failed/cancelled, bez treści
  i adresu), `enqueue_campaign_batch`/`process_email_campaigns` (cron `/api/maintenance`),
  aktywacja nowej rewizji wygasza niewysłane listy starej, stara nie wraca (`STALE_STATE`),
  claim wygasza listy nieaktywnej rewizji. Worker: newsletter z payloadu kampanii
  (`newsletter-delivery.ts`), `text/plain` w każdym mailu (także hook Auth), marketing tylko z
  jawnym `EMAIL_FROM` + `EMAIL_SENDER_IDENTITY` + `EMAIL_SENDER_POSTAL_ADDRESS`
  (`src/lib/email/sender.ts`, stopka). Hook Auth pobiera budżet puli `auth` (odmowa → 503 +
  `Retry-After`, przed claimem inboxu; błąd bazy = fail-open). Tracking wyłączony; kontrola
  odebranej wiadomości `scripts/check-received-eml.mjs` (`docs/RESEND_SETUP.md`). Dowód:
  `rls.sql` sekcja CM45 (dblink, kontrole ujemne), unit `email-consent-campaigns`.
  **Do zrobienia (właściciel):** wartości `EMAIL_SENDER_*`, wyłączenie trackingu w Resend i
  kontrola odebranego `.eml` na produkcji; treść prawna zgody marketingowej (#40). **Otwarte:**
  tworzenie rewizji kampanii z panelu (dziś `create_email_campaign_revision`, service_role),
  prawdziwa pauza z wznowieniem (wymaga zmiany `claim_email_batch`), rejestracja z opt-in marketingu.
  Panel kampanii (#45, migracja `0111`): `/admin/kampanie` — rewizje
  (filtr statusu, slug, kursor) z liczbami odbiorców według statusu (bez adresów),
  `/admin/kampanie/[id]` — podgląd treści w każdym języku (walidacja jak worker,
  `src/lib/admin/campaigns.ts`), rewizje sluga, „Aktywuj rewizję”/„Zatrzymaj wysyłkę” z dialogiem
  (`admin_activate_email_campaign`/`admin_cancel_email_campaign`: is_admin, CAS
  `p_expected_status` → `STALE_STATE`, `INVALID_TRANSITION`, skutek = RPC z 0101, audyt
  `email_campaign.*` bez treści i odbiorców). Bez `EMAIL_FROM` + `EMAIL_SENDER_*` +
  `EMAIL_UNSUBSCRIBE_SECRET` (`campaignSendingReady`): jawny komunikat, akcja aktywacji odmawia
  przed bazą, `/api/maintenance` nie woła `process_email_campaigns`. Dowód: `rls.sql` sekcja
  AC45 (kontrola ujemna bez CAS), unit `admin-email-campaigns` (kontrole ujemne bramki nadawcy),
  E2E `admin-email-campaigns`, `admin-a11y`.
  Doręczenia i blokady (#44, migracja `0098`): webhook `POST /api/email/webhook/resend`
  (podpis Svix przez `verifyStandardWebhook`, ±300 s, limit body 256 kB, inbox
  `processed_webhooks` `resend:<svix-id>`, brak `RESEND_WEBHOOK_SECRET` → 503). Model zdarzeń
  niezależny od dostawcy: `src/lib/email/provider-events.ts`. RPC `record_email_event`
  (service_role): status tylko „w górę”, czasy zdarzeń; trwałe odbicie i skarga → aktywna
  blokada w `email_suppressions` (jedna na adres, historia zostaje). `enqueue_email` pomija
  zablokowany adres, `claim_email_batch` wygasza wcześniejsze wiersze (`suppressed_address`).
  E-maile Auth nie są blokowane (obowiązkowe). Panel `/admin/poczta`: lista, filtr, zdjęcie
  blokady z uzasadnieniem (`admin_lift_email_suppression`, audyt). Dowód: `rls.sql` sekcja
  ML44, `email-delivery-webhook.test.ts`, `admin-email-suppressions.test.ts`, E2E
  `admin-email-suppressions.spec`. Alarmy poczty (migracja `0118`):
  sekcja `mail` w `ops_metrics()` (kohorta wysyłki 24 h i 7 dób bazowych, trwałe odbicia,
  skargi, aktywne/nowe blokady — same liczby, rola `pracujbe_ops`), progi w
  `src/lib/ops/sensors.ts` (`mail_*`: odsetek > 5% odbić / 0,3% skarg, wzrost > 2× bazy,
  > 20 nowych blokad; próba ≥ 50 listów) → `/api/health/ops` 503/200; wiek kolejek =
  istniejące `email_queue_age`/`auth_email_queue_age`. Opis `docs/railway/OPERATIONS.md`;
  dowód `rls.sql` OPS44, `ops-metrics` (PG16), `ops-sensors`. **Do zrobienia (#44):**
  kalibracja progów na ruchu produkcyjnym, adapter drugiego dostawcy.
  Minimalizacja treści (#503, migracja `0123`): worker przekazuje do
  szablonu tylko pola z `src/lib/email/payload-fields.ts` (reszta payloadu zostaje w bazie);
  poza listą m.in. podgląd rozmowy (`newMessage.preview`) i wiadomość do propozycji
  (`jobOffer.message`; od 26.09.2026 tylko oczyszczony cytat `messageExcerpt`) — e-mail prowadzi do panelu. `claim_email_batch` ponownie sprawdza
  odbiorcę firmowego (`email_recipient_authorized`: aplikacja/propozycja/wiadomość →
  `company_recipient_ok`; brak obiektu = fail-closed) → `suppressed_recipient_unauthorized`.
  Mapa danych: kolumna „Odrzucane przez workera”. Dowód: `rls.sql` sekcja ES503 (kontrola
  ujemna), unit `email-payload-minimization` (kanarki w 4 językach, kontrola ujemna). Szkic:
  `docs/legal-drafts/poczta-transfer-resend.md`. **Otwarte (właściciel/prawnik):** DPA,
  podprocesorzy, transfer, retencja u dostawcy, tracking na koncie, nazwisko kandydata w
  e-mailu do firmy, bramka konfiguracji dla nieocenionego dostawcy.
- [~] Szablony React Email PL/NL/FR/EN — komplet typów w `src/emails`; pokrycie zdarzeniami w rejestrze
  `src/emails/wiring.ts` (test `email-wiring.test.ts`, #295): kolejka — newApplication, applicationViewed
  (`viewed`), statusChanged, jobOffer, offerAccepted/Declined, newMessage, jobPublished (`publish_job`,
  0073), companyVerified/Rejected/Suspended (`admin_set_company_status`, 0084), jobMatch
  (`process_saved_search_alerts`, 0092, #100), supportContact/contactMessageAdmin (`submit_contact_message`,
  0125, #61); Auth (kolejka Better Auth, #24) — accountConfirmation/passwordReset; magicLink/emailChange/invite wysyłał tylko GoTrue (#27). **Świadomie nieużywane** (brak
  zdarzenia): welcome, contactInvitation, jobExpiring (kreator nie ustawia `expires_at`), payment/invoice
  (#51). Klucz e-maila zmiany statusu = id wiersza historii (0073, #292) — powrót do
  statusu wysyła kolejny e-mail, retry nie. Dowód: `rls.sql` sekcja NN.
  Status aplikacji w mailu = etykieta `status.*` z `src/messages` (nie enum); neutralne warianty
  treści przy braku nazwy nadawcy (`EmailCopy.anonymous`); CTA do sekcji panelu w locale odbiorcy
  (`src/lib/email/delivery-data.ts`); imię odbiorcy w powitaniu (worker czyta `profiles`); e-maile
  Auth: język wg Invariantu #1 (`src/lib/email/auth-email.ts`) i osobne treści magic link/zmiana
  e-maila/zaproszenie. Payloady (0113): `jobOffer` niesie `expiresAt` (= `offers.expires_at`)
  i kwoty oferty (#293, #22), `newMessage` — `conversationId` (CTA do wątku, #290); dowód
  `rls.sql` sekcja PL109 (kontrole ujemne), `email-payload-followups.test`. Treść wiadomości
  rekrutera świadomie poza payloadem (tekst wolny = korespondencja, #503; worker odrzuca pole `message`) — kandydat czyta ją
  w panelu. Krótki cytat (decyzja właściciela 26.09.2026, bez migracji): worker czyta
  `offers.message` w chwili wysyłki i przekazuje do szablonu tylko `messageExcerpt`
  (`src/lib/email/message-excerpt.ts`: e-maile, telefony, NISS/BIS/PESEL, numery kart
  i dokumentów — detektory `src/lib/privacy/sensitive-data.ts` — oraz URL-e → `[…]`, potem
  obcięcie do 200 znaków; po redakcji coś wykryte albo `@` → brak cytatu). `delivery-data`
  oczyszcza pole ponownie, szablon nie przyjmuje pełnego `message`; podpis cytatu
  `jobOfferExcerptLabel` w języku odbiorcy. Błąd odczytu = e-mail bez cytatu. Testy:
  `email-message-excerpt` (kanarki, 4 języki, kontrola ujemna), `email-unsubscribe` (worker).
- [x] Powiadomienia in-app + preferencje — in-app (RPC 0016, dropdown+badge, „oznacz wszystkie") + ekran preferencji `/candidate/ustawienia` i `/employer/ustawienia` (upsert `notification_preferences` pod RLS)
  Pozycje dropdownu są linkami do obiektu (`resolveHref` wg `entity_type` i roli, rozmowa → `?c=`
  tylko dla UUID), otwarcie oznacza jedno powiadomienie; „Zobacz wszystkie” prowadzi do
  pełnej listy (#148).
  Pełna lista (#148): `/candidate/powiadomienia` i `/employer/powiadomienia` (noindex, guard
  layoutu) — `getNotificationsPage` pod sesją/RLS, po 20 kursorem `created_at` + `id`
  (`loadMoreNotifications`, kursor/locale/filtr walidowane), filtr `?nieprzeczytane=1`
  (nawigacja z `aria-current`), oznaczanie pojedynczo i wszystkich (`mark_notifications_read`,
  fokus na tytule/nagłówku, błąd z kodu), cele i tytuły z tych samych `resolveHref`/
  `titleKeyForType` co dropdown, data w Europe/Brussels + czas względny; kalka `panel-styles.ts`.
  Wczytane strony zostają po oznaczeniu i po błędzie kolejnej strony. Bez migracji (indeks
  `idx_notifications_profile`). Dowód: `portal-notifications.test.ts` (PG16: równy
  `created_at` na granicy strony, filtr, obcy kursor; mutacja kursora = czerwony), unit
  `notifications-page`, `notifications-list` (kontrola ujemna bez listy), E2E
  `notifications-list` (4 języki, obie role), `panel-a11y` (nowe trasy).
  Dzwonek (#353): nazwa z liczbą nieprzeczytanych (ICU `notifications.bellLabel`), panel = region
  nazwany tytułem, „Nieprzeczytane” dla czytnika; Escape zamyka i wraca fokusem na dzwonek, wyjście
  fokusem poza panel go zamyka. „Oznacz wszystkie” (#354): `aria-busy` + „Zapisywanie…”, jedno
  wywołanie naraz, błąd `role="alert"` bez refresh, sukces `role="status"` + fokus na tytule.
  Tryb demo (#359): layouty biorą demo z `getNotifications(locale, rola)` (czas przez Intl), bez
  literałów w `DashboardShell`. Ustawienia pracodawcy (#357): własne opisy (`settings.employer*`),
  bez przełącznika dopasowanych ofert, opis powiązany `aria-describedby`.

### Etap 7 — admin / prywatność / płatności
- [~] Cookies: baner + kategorie + centrum ustawień + zapis zgód (podstawa)
  Analityka (#570, decyzja właściciela 2026-09-25): Cloudflare Web Analytics (beacon
  bezcookie'owy, `NEXT_PUBLIC_CF_WEB_ANALYTICS_TOKEN`) zamiast Google Analytics i Meta Pixel —
  usunięte z kodu, CSP, `.env.example`, CI i dokumentacji. Ładowany wyłącznie po zgodzie
  w kategorii `analytics` (`src/components/cookies/Analytics.tsx`), CSP: `static.cloudflareinsights.com`
  (script-src) + `cloudflareinsights.com` (connect-src) — tylko gdy token jest ustawiony; bez
  tokenu (stan startowy, token doda właściciel) beacon się nie ładuje, a CSP nie ma tych hostów.
  Kategoria `marketing` usunięta (decyzja właściciela 25.09 — brak trackerów marketingowych):
  kategorie = necessary/preferences/analytics (`src/lib/consent-cookie.ts`, `CONSENT_CATEGORIES`),
  domyślna `CONSENT_POLICY_VERSION` = `2.0`, więc cookie sprzed zmiany (1.0, z marketingiem)
  jest nieaktualne i baner pyta ponownie. Log zgód: migracja `0130` (numer tymczasowy)
  — `record_consent` zapisuje 3 kategorie, akcja `recordConsent` odrzuca klucze spoza listy;
  wartość `marketing` zostaje w enumie dla historycznych wierszy. Nieużywane klucze
  `cookies.marketingName`/`marketingDesc` usunięte z `src/messages`. Dowód: E2E `cookie-consent-categories.spec`, `smoke.spec`,
  `one-time-link-tracking.spec`, `public-cache-headers.spec`; unit `consent-store.test`,
  `consent-action.test` (kategorie RPC = banera, kontrola ujemna 0043), `csp-report.test`
  (CSP z tokenem i bez), `privacy-data-map.test`; `rls.sql` Y2.
- [x] Panel administratora — `/admin/**` (guard role='admin'→notFound, noindex): dashboard, firmy
  (weryfikuj/odrzuć/zawieś), zgłoszenia (moderacja), użytkownicy; odczyt service-role, zapis przez RPC (0019)
  Każdy odczyt service-role w `src/lib/data/admin.ts` sam potwierdza rolę admina sesji
  (`requireAdmin` → `notFound()`), niezależnie od layoutu. `0076`: pola tożsamości i moderacji
  zgłoszeń ustala baza (trigger `reports_guard`, limity długości), helpery ról bez EXECUTE dla
  anon/PUBLIC (`is_job_company_member` zostaje — polityki anon). Dowód: `rls.sql` sekcja QQ.
  UX panelu (#415–#418, #420–#423): listy firm/zgłoszeń/użytkowników stronicowane kursorem
  (`created_at`+`id`, 50/stronę, `src/lib/admin/list-params.ts`) z wyszukiwaniem po stronie serwera
  (firmy: nazwa/VAT/KBO/e-mail; użytkownicy: imię/nazwisko/e-mail + filtr roli), parametry w URL.
  Zgłoszenia: filtr statusu (domyślnie otwarte + w analizie), cel z linkiem/podglądem wiadomości
  albo „obiekt usunięty”, powód ze słownika i18n; „Rozwiąż”/„Oddal zgłoszenie” z dialogiem
  potwierdzenia (`AdminConfirmDialog`). Fokus i toast po akcji w `AdminFeedbackProvider`
  (nagłówek wiersza albo strony, nigdy `<body>`). Daty w Europe/Brussels (`src/lib/datetime.ts`).
  Bez dzwonka powiadomień (`DashboardShell showNotifications={false}`). `0081`: macierz przejść
  w `admin_set_company_status`/`admin_resolve_report` + `p_expected_status` (`FOR UPDATE`,
  `STALE_STATE`), firma usunięta → `NOT_FOUND`, ponowne otwarcie zgłoszenia czyści
  `resolved_*`. Dowód: `rls.sql` sekcja ADM; E2E `admin-ux.spec`.
  Decyzja o firmie (#310, `0084`): szczegół `/admin/firmy/[id]` (`getCompanyDetail`: dane
  rejestrowe, uzasadnienie, członkowie z rolą/aktywnością, najnowsze 20 ofert + licznik), nazwa
  na liście = link. Odrzucenie/zawieszenie wymaga uzasadnienia (≤ 1000 znaków,
  `src/lib/admin/company-review.ts` = te same reguły co RPC), które trafia do
  `companies.status_reason`, `audit_logs.after_data.reason` (widoczne w dzienniku) oraz do
  KAŻDEGO aktywnego właściciela: powiadomienie in-app (`system` + `data.kind='company_status'`,
  weryfikacja = `company_verified`) i e-mail `companyVerified`/`companyRejected`/`companySuspended`
  przez `enqueue_email` (język właściciela, Invariant #1). Dowód: `rls.sql` sekcja AV310;
  unit `admin-company-review`; E2E `admin-company-review.spec`.
  Weryfikacja VAT w VIES (#92, `0088`): sekcja w `/admin/firmy/[id]` — lokalny pre-check
  numeru BE (`src/lib/vies/belgian-vat.ts`: normalizacja, 10 cyfr, suma mod 97; zły zapis nie
  trafia do VIES), adapter REST VIES (`src/lib/vies/client.ts`: timeout 4 s na próbę, 3 próby
  z backoffem i jitterem). Stany: `valid`, `invalid`, `unavailable`, `rate_limited` —
  `invalid` TYLKO przy jawnym `valid:false` w poprawnej odpowiedzi; 429/5xx/timeout/sieć/
  `actionSucceed:false`/kody concurrent-unavailable = brak możliwości weryfikacji, osobne
  teksty. Zapis wyłącznie wyników rozstrzygających (`company_vies_checks`, RPC
  `admin_record_vies_check`, audyt `company.vies_checked` z samym wynikiem); awaria nie
  nadpisuje wcześniejszego wyniku. Porównanie nazwy (`name-match.ts`) = sygnał do ręcznego
  sprawdzenia. Status firmy zmienia tylko admin. Dowód: `rls.sql` sekcja VI92, unit
  `vies-verification` (fixture'y, kontrola ujemna), E2E `admin-vies.spec`; live smoke opt-in
  `VIES_LIVE_SMOKE=1`. **Otwarte:** publiczna odznaka „zweryfikowano w VIES” dla kandydatów
  (decyzja produktowa), automatyczne sprawdzenie przy zakładaniu firmy.
- [~] Zgłoszenia treści DSA (#41, migracja `0094`) — przyjęcie sprawy, decyzja z egzekucją
  (#42) i odwołania z retencją i raportem (#43) gotowe; treść prawna i wartości terminów (#40) otwarte. Publiczny formularz `/zglos-tresc?oferta=<slug>[&cel=firma]`
  (linki „Zgłoś ofertę/firmę” na szczególe oferty, także bez konta): limiter → Turnstile `report`
  → Zod → RPC `submit_content_report` (EXECUTE tylko service_role, `reporterId` z sesji). Sprawa
  = `reports.kind='dsa_notice'`: numer `DSA-XXXX-…` (64 bity), kod dostępu z przeglądarki (w bazie
  SHA-256), idempotencja także przy wyścigu, tylko treść publiczna (prywatna = `NOT_FOUND`),
  dowód `target_snapshot` z bazy, niezmienność (trigger dla każdej roli), historia
  `report_events` (także ze zmian w `admin_resolve_report`), limit 5/adres/24 h + jedna otwarta
  sprawa na treść, e-mail `reportReceived` przez outbox w języku zgłaszającego. Status:
  `/zglos-tresc/sprawa` (numer + kod, z linku przez fragment `#`). Panel `/admin/zgloszenia`:
  filtr rodzaju, numer, termin, dowód, kontakt, historia. Dowód: `rls.sql` sekcja DSA41; unit
  `content-report-actions`, `report-received-email`; E2E `content-report`, `content-report-form`
  (fixture). **Do uzupełnienia przez właściciela:** treść prawna (znacznik na stronie
  formularza), katalog kategorii, termin 7 dni i wymagane pola — wg mapy DSA (#40).
  Decyzja moderacyjna (#42, migracja `0099`): sprawę DSA zamyka tylko `admin_decide_report`,
  które w jednej transakcji zapisuje niezmienną decyzję (`moderation_decisions`: rodzaj
  `no_action`/`job_removed`/`company_suspended`, fakty, podstawa regulamin/prawo + wskazanie
  postanowienia, udział automatyzacji, numer `DEC-…`), wykonuje skutek (oferta `closed` /
  firma `suspended` + blokada `moderation_decision_id`, której nie zdejmie żadna zmiana statusu
  — `MODERATION_LOCKED`), zamyka sprawę, dopisuje historię i audyt `moderation.decided`,
  a potem kolejkuje e-maile. Właściciele firmy dostają uzasadnienie w swoim języku, zgłaszający
  sam wynik. Awaria dowolnej części cofa całość. Odroczony trigger odrzuca decyzję bez skutku.
  `admin_resolve_report` nie zamyka już sprawy DSA (regresja z kontrolą ujemną). CAS
  `expected_status` + `FOR UPDATE` (dwie decyzje → `STALE_STATE`). Przywrócenie:
  `admin_restore_moderation` (powód wymagany, blokada przechodzi na inną aktywną decyzję).
  Kolejka: `flag_report_for_review` (service_role — automat tylko flaguje i ustala priorytet).
  UI: dialog decyzji i cofnięcia w `/admin/zgloszenia` (`ModerationDecisionActions`),
  uzasadnienie w `/employer/firma` (`get_company_moderation_decisions`), wynik w
  `/zglos-tresc/sprawa`. Dowód: `rls.sql` sekcja MOD42; unit `moderation-decision*`; E2E
  `admin-ux` (#42). Kolejka według priorytetu: `/admin/zgloszenia?sort=priority|newest`
  (domyślnie `priority` dla `kind=dsa_notice`, `newest` dla reszty) — `review_priority` ↓,
  termin `due_at` ↑ (bez terminu na końcu), `created_at` ↓, `id` ↓; kursor `p1|priorytet|termin|
  created_at|id` (`encode/decodeAdminPriorityCursor`, kursor „najnowsze” = pierwsza strona),
  filtr `?flagged=1` (priorytet > 0 albo opis flagi z `flag_report_for_review`), parametry
  zachowywane we wszystkich linkach listy. Bez migracji (indeks z 0099). Dowód: integracja
  `portal-admin-dsa-queue` (PG16, remisy priorytetu/terminu/czasu; mutacja kursora = czerwony),
  unit `admin-list-params`, E2E `admin-ux`, `admin-a11y`. **Otwarte:** znacznik treści prawnej
  o środkach odwoławczych w panelu firmy.
  Odwołania, terminy, retencja, raport (#43, migracja `0104`): tabela
  `moderation_appeals` (jedno na decyzję, `APL-…`, niezmienne). Autor (owner/admin firmy)
  odwołuje się od ograniczenia w `/employer/firma` (`submit_moderation_appeal` pod sesją),
  zgłaszający od braku działań na `/zglos-tresc/sprawa` (numer + kod, `submit_report_appeal`
  service_role za limiterem); cudza decyzja = `NOT_FOUND`, strony nie widzą swoich danych.
  Termin liczony od POINFORMOWANIA (`moderation_informed_at`: wysłany e-mail o decyzji albo
  odczyt powiadomienia; odbicie się nie liczy; bez poinformowania termin nie biegnie).
  `admin_decide_appeal` w `/admin/odwolania`: autor decyzji nie rozpatruje, gdy jest inny admin
  (`REVIEWER_CONFLICT`, inaczej `same_reviewer`); uwzględnienie odwołania autora cofa
  ograniczenie (`moderation_restore_core`, wspólny z `admin_restore_moderation`), zgłaszającego
  — nowa decyzja z `appeal_id` i egzekucją (sprawa dismissed → resolved tylko tą ścieżką);
  historia, audyt, e-maile `appealReceived/Upheld/Reversed` w języku odbiorcy; awaria cofa
  całość. Retencja: `dsa_retention_report()` (podgląd) i `dsa_retention_run(dry_run)`
  (service_role, `dsa_retention_runs`) anonimizują sprawy dopiero po końcu drogi odwołania
  i okresie retencji — wiersze i liczby zostają. Raport: `dsa_transparency_report` + eksport
  `dsa_statements_export` (bez danych osobowych i faktów) w `/admin/raport-dsa` i
  `GET /api/admin/dsa-report` (CSV/JSON). Opis: `docs/DATABASE.md`. Dowód: `rls.sql` sekcja
  APL43 (kontrole ujemne: jedyny admin, naiwna retencja, flaga bez odwołania); unit
  `moderation-appeals`; E2E `content-report-form` (odwołanie zgłaszającego, fixture),
  `admin-a11y` (nowe trasy). **Do zatwierdzenia przez właściciela (#40):** okno odwołania
  6 mies., termin rozpatrzenia 14 dni, retencja 12 mies., zakres publikacji i przekazywania do
  bazy DSA, treść prawna o procedurze. Harmonogram czyszczenia: `/api/maintenance` woła
  `dsa_retention_run` tylko za flagą `DSA_RETENTION_MODE` (`dry-run`/`apply`, domyślnie
  wyłączone, liczniki w odpowiedzi; `src/lib/admin/dsa-retention-mode.ts`). Odwołanie
  zgłaszającego od cofnięcia ograniczenia (migracja `0109`): ręczne cofnięcie
  wysyła `reportRestored` w języku zgłaszającego, termin od wysłania, formularz na
  `/zglos-tresc/sprawa` (znacznik treści prawnej), `submit_report_restoration_appeal`,
  rozpatruje inny admin niż cofający, uwzględnienie = nowa decyzja; od cofnięcia po odwołaniu
  autora — brak drogi. Dowód: `rls.sql` sekcja RA43. **Otwarte:** włączenie `apply` (po #40),
  retencja `audit_logs` z uzasadnieniami.
- [~] Rejestr naruszeń RODO (#490, migracja `0106`): `/admin/naruszenia`
  (tylko admin). Wpis = incydent bezpieczeństwa albo naruszenie danych osobowych: czas
  stwierdzenia (termin 72 h liczony od niego — `breachDeadline` w `src/lib/admin/breach.ts`),
  opis, kategorie danych, liczba osób, ocena ryzyka, decyzje art. 33/34 z uzasadnieniem, daty
  zgłoszeń, przyczyny opóźnienia po 72 h, działania, zamknięcie. Reguły (sprzeczność decyzji
  z ryzykiem, wymagane uzasadnienia) w `breach_incident_validate` + CHECK-i i w lustrze TS
  `breachFormErrors`. Zapis wyłącznie RPC `admin_*_breach_*` (is_admin, CAS `version` →
  `STALE_STATE`, idempotentne `client_key`, audyt bez treści). Historia `breach_incident_events`
  i wpisy niezmienne dla każdej roli (trigger; bez DELETE/TRUNCATE). Eksport JSON/CSV
  `POST /api/admin/breaches/[id]/export` (RPC zapisuje eksport w historii; `GET` = 405, wyłącznie
  odczyt nie mutuje — #603). Zawiadomienie osób:
  `admin_notify_breach_subjects` → outbox `breachNotice` — treść wpisuje admin dla każdego
  języka odbiorców; brak wersji w języku któregoś odbiorcy = nic nie wychodzi (Invariant #1).
  Dowód: `rls.sql` sekcja BR490 (kontrole ujemne), unit `breach-register`, E2E `admin-breaches`.
  Szkic procedury (nieopublikowany): `docs/legal-drafts/procedura-naruszen.md`. **Do zrobienia
  (właściciel/prawnik):** role i kontakty dyżuru, organ i portal, treść zawiadomień, tabletop,
  zatwierdzenie procedury; okres przechowywania wpisów.
- [~] Mapa danych osobowych (#485/#488/#503/#504, część techniczna): `node scripts/privacy/data-map.mjs`
  generuje `docs/legal-drafts/data-map.generated.md` z migracji produkcyjnych (parser
  `scripts/privacy/schema.mjs`), klasyfikacji `src/lib/privacy/data-map.ts` (każda tabela, kategorie,
  czynności) i usług `src/lib/privacy/processors.ts` (rola/region/transfer/DPA = „DO UZUPEŁNIENIA”);
  sekcja e-maili = klucze payloadu z aktualnych funkcji SQL (`email-payloads.mjs`). Test
  `privacy-data-map.test.ts`: tabela bez wpisu albo kolumna wyglądająca na PII (np. `email`) bez
  klasyfikacji = czerwony, plik nieaktualny = czerwony, payload z CV/odpowiedziami/treścią wiadomości
  = czerwony (kontrole ujemne). Szkice `docs/legal-drafts/rejestr-czynnosci.md` i
  `dostawcy-i-transfery.md` — PROJEKT, nieopublikowany, nic w UI. **Do ustalenia (właściciel +
  prawnik):** administrator, role portal/pracodawca, podstawy, retencja, DPA i transfery.
- [x] Audit logs — triggery AFTER (0017) na applications/offers/companies + `write_audit`; actor=auth.uid()
  Podgląd w panelu (#417): `/admin/dziennik` (tylko odczyt, `listAuditLogs` → `requireAdmin`) —
  data w Europe/Brussels, aktor (nazwa albo „System”), akcja i statusy jako etykiety i18n,
  obiekt z linkiem; filtry typu obiektu, akcji, aktora, zakresu dat i `id` (skrót „Historia
  statusów” w wierszu firmy), stronicowanie kursorem.
- [~] Retencja i prawa kandydata (#486, migracja `0105`, `docs/DATA_RETENTION.md`):
  okresy jako dane (`retention_policies`, null = kategoria wyłączona; zmiana tylko
  `admin_set_retention_policy` z audytem, rejestr usunięć ≥ 400 dni). `/api/maintenance` woła
  `run_retention_purge` (partie, SKIP LOCKED, liczniki) i worker kolejki storage
  (`src/lib/storage-deletion.ts`; `storage_deletion_queue` wypełnia trigger AFTER DELETE na `files`,
  backoff, brak ścieżek w logach). Domyślnie włączone tylko sprzątanie danych już oznaczonych
  (`deleted_file`, `deleted_profile` — 30 dni); reszta czeka na decyzję administratora danych.
  `confirmed_guest_request` = tylko wartość do decyzji właściciela (bez zadania, ślad gościa zostaje
  także przy `closed_application`); tokeny gościa czyści `purge_guest_application_requests` (#522).
  Eksport JSON (`POST /api/account/export`, Origin tej witryny, `no-store` → `export_my_data`:
  dane podane, proces, zapisane `matches`, rozmowy z `fromMe` bez tożsamości rekrutera, limit
  10/dobę, ślad `data_rights_requests` + audyt). Usunięcie konta (`request_account_erasure`,
  potwierdzenie adresem konta): jedna transakcja `erase_candidate_subject` — proces widoczny
  dla firm, powiadomienia/e-maile o nim, pliki → kolejka, `auth.users` (kaskada), tombstone;
  sprawy DSA zostają bez powiązania (`reports_guard`/`report_events_append_only` przepuszczają
  tylko FK → null). Tombstone po restore: `scripts/db/export-erasure-tombstones.sh` +
  `RESTORE_TOMBSTONES_FILE` w `restore-backup.sh` (`apply_erasure_tombstones`). UI: sekcja
  „Twoje dane i konto” w `/candidate/ustawienia` (`AccountDataSettings`, klucze `accountData.*`
  — tylko etykiety funkcji). Dowód: `rls.sql` sekcja DR486 (kontrole ujemne 5/5b/7f/9),
  `npm run test:backup` (scenariusz #486), unit `account-data`, `storage-deletion`, E2E
  `candidate-account-data`. Szkic dla prawnika (PROJEKT, nieopublikowany):
  `docs/legal-drafts/retencja-i-prawa-kandydata.md`. **Otwarte:** zatwierdzone okresy i treść
  dla kandydatów (#61), cron `/api/maintenance` i eksport rejestru usunięć (#13),
  sprostowanie/ograniczenie/sprzeciw, eksport i usunięcie konta pracodawcy,
  potwierdzenie linkiem e-mail.
  Wartości z opracowania 2026-09-25 (#574, migracja `0127` — numer tymczasowy): okresy w
  `retention_policies` (pliki/profile oznaczone 7 dni łącznie z obiektem, aplikacje i ich
  rozmowy 180 dni od niezmiennego `applications.closed_at` — każdy stan końcowy, także `hired`;
  CV 365 i konto 730 dni bez aktywności z ostrzeżeniem 30 dni — e-maile `inactiveCvWarning`/
  `inactiveAccountWarning` w języku odbiorcy, `retention_warnings`; ukrycie profilu 180; gość
  30/7, IP/UA 7; wnioski 1095; wartości bez zadania: zgody 1095, audyt 365, logi 30, kopie 14,
  kolumna `enforcement`). `last_seen_at` z triggera na `auth.sessions` (logowanie/odświeżenie,
  raz na godzinę). **Harmonogram WYŁĄCZONY:** `/api/maintenance` woła `run_retention_purge`
  tylko przy `RETENTION_MODE=dry-run|apply` (`src/lib/retention/mode.ts`; dry-run = podtransakcja
  wycofana, apply = kolejne partie po 200 dopóki `fullBatches` > 0, najwyżej 10). Kolejka
  storage: dead-letter po 20 próbach, `requeue_storage_dead_letters`, `ops_metrics().storageDeletion`
  + czujki `storage_deletion_age` (> 24 h) i `storage_deletion_dead_letter`. Dowód: `rls.sql`
  sekcja RV574 (kontrole ujemne), unit `guest-apply-maintenance`, `ops-sensors`,
  `retention-warning-email`. **Otwarte (#574):** włączenie `RETENTION_MODE` (właściciel), minimum
  rejestru usunięć po RET-09/RET-10, zadania dla zgód/audytu/`auth.email_outbox`/e-maili,
  kopie liczone w dniach (`backup.sh`), konto pracodawcy, język gościa na aplikacji (#546).
- [x] Płatności — **WYŁĄCZONE w bezpłatnym MVP (#51, `docs/PRODUCT_DECISIONS.md`).** Stan aktywny:
  portal bez cennika, pakietów, CTA zakupu i limitów planu; billing niedostępny. Jedna jawna flaga
  `BILLING_ENABLED` (`src/lib/billing/flag.ts`), domyślnie wyłączona — włącza ją tylko dokładne
  `true`. Bez flagi: `getStripe()` = null, `isStripeConfigured`/`isBillingProviderReady`/
  `isBillingProviderConfigured`/`readinessChecks().stripe` = false mimo sekretów, webhook
  `/api/stripe/webhook` = 404 bez czytania treści. Niezależnie od flagi: akcje `startCheckout`/
  `applyDiscount`/`cancelSubscription` zawsze zwracają `BILLING_UNAVAILABLE` (komunikat
  `errors.billingDisabled` — portal jest bezpłatny), webhook z flagą = 410, `/employer/platnosci`
  → przekierowanie na `/employer`, brak trasy cennika (404), brak linków w nawigacji/stopce/sitemap.
  `ENTITLEMENT_LIMIT` → `errors.activeJobLimit` (bez wzmianki o planie). Dawne klucze sprzedaży
  (`billing.*`, `pricing.*`, `dashboard.*Package`, `footer.pricing`) zostały w `src/messages` bez
  użycia. Tabele finansowe (`subscriptions/payments/invoices/discount_codes/checkout_intents`) =
  martwy schemat do cleanupu po migracji Railway, nie wdrożona funkcja. Powrót monetyzacji =
  nowa decyzja właściciela + osobny projekt (sama flaga nie uruchamia sprzedaży). Dowód:
  `billing-disabled.test` (z kontrolą ujemną: flaga + sekrety + bezpośrednie wywołanie checkoutu),
  `free-mvp-ui.test`, `sitemap-robots.test`, E2E `free-mvp-no-sales.spec` (4 języki).

### Etap 7 — hardening operacyjny (bezpieczeństwo/CI)
- [~] CSP (P2-01, #585) — `next.config.mjs` (default/object/frame-ancestors/base/form-action +
  zawężone connect/img/font, Cloudflare Web Analytics od #570 (zamiast GA/Meta, usunięte); bez
  Sentry od #571). Analiza: `docs/CSP_NONCE_ANALYSIS.md` — inwentarz inline skryptów/stylów z
  buildu (pomiar Report-Only `scripts/security/csp-inline-inventory.mjs`, poza CI; test
  `csp-inline-inventory`): blokują chunki i ładunek RSC Next.js (nonce tylko per żądanie — koniec
  ISR, hash niemożliwy), skrypt banera zgód (hash albo nonce), atrybuty `style` (next/image, paski
  postępu) i `<noscript><style>`; JSON-LD i skrypty wstawiane dynamicznie (beacon CF, Turnstile)
  nie blokują. **Próba usunięcia `'unsafe-inline'` ze `script-src` zweryfikowana i COFNIĘTA** po
  realnym buildzie (`next build` + `next start`, Chromium): bez niego skrypty RSC są blokowane
  i hydracja każdej strony się psuje. Enforced `script-src` ZOSTAJE z `'unsafe-inline'` (bez
  regresji); produkcja dostaje RÓWNOLEGŁY `Content-Security-Policy-Report-Only` z tą samą
  dyrektywą, ale hashem (bez `unsafe-inline`) dla skryptu banera zgód w `<head>` (jedno źródło
  treści: `src/lib/security/csp-inline-scripts.mjs`; beacon CF jest zewnętrzny, bez treści
  inline) — obserwowalny krok, nie pełne zamknięcie #585. Report-Only raportuje do osobnej grupy
  `csp-report-only` (`/api/csp-report?policy=report-only`) z własnymi limitami (10 żądań/min
  z adresu, 60 wpisów/min na proces; wpis `disposition=report` zawsze w tym budżecie), więc
  szum skryptów RSC nie wypiera raportów egzekwowanej polityki (test `csp-report`). Dowód:
  `tests/unit/csp-inline-scripts.test.ts` (enforced bez regresji, Report-Only z hashem i kontrolą
  ujemną). **Otwarte (decyzja właściciela):** warianty A–D z analizy (nonce + rezygnacja z ISR
  na stronach publicznych = regres wydajności, sprzeczne z #298/#395).
- [x] Rate limiting aplikacyjny — RPC `rate_limit_hit` (`0015`) wpięty w auth/apply/wiadomości.
  Odporność osobnej bazy limitera (#608): `checkDatabaseRateLimit` (`src/lib/db/rate-limit.ts`)
  zwraca `boolean` wyłącznie dla rzeczywistej odpowiedzi RPC (`allowed`/`limited`); błędna
  konfiguracja wywołania i każda awaria (połączenie/transakcja/`SET LOCAL ROLE`/RPC/COMMIT)
  rzuca `RateLimitUnavailableError` zamiast być cicho zamienianą na „przekroczono limit”.
  `checkRateLimit` (`src/lib/rate-limit.ts`) łapie ten wyjątek i stosuje politykę per akcję
  (wzorem `src/lib/turnstile/policy.ts`): `FAIL_SAFE_ACTIONS` (auth, płatne API, publiczne
  formularze wysyłające e-maile) blokuje; pozostałe akcje przechodzą (fail-open) — awaria/
  rotacja loginu osobnej bazy limitera nie odcina już zwykłych akcji (wiadomości, ustawienia,
  edycja firmy) dla wszystkich użytkowników. Testy: `rate-limit-postgres` (jednostkowy,
  atrapa rzuca), `rate-limit` integracyjny (PG16 w Dockerze: pula zwykłej roli, odebrane
  `EXECUTE`, zamknięta pula i błędne parametry → wyjątek, nie `false`).
- [~] AI Act / art. 22 / DPIA i ePrivacy lejka (#489, #499) — część techniczna: inwentarz
  funkcji AI jako dane (`src/lib/ai/inventory.ts`; strażnik `ai-inventory.test` skanuje
  `src/`+`scripts/`, wywołanie modelu bez wpisu = czerwony test, kontrola ujemna; pliki
  matchingu/statusu/screeningu nie mogą wołać modelu), log użycia AI bez treści/PII
  (`src/lib/ai/usage-log.ts`, wpięty w import ogłoszeń), dokumentacja lejka `docs/JOB_FUNNEL.md`
  i E2E `job-funnel-no-storage` (fixture: bez zgody zero żądań; po zgodzie zero cookies/storage
  i żądanie bez `Cookie`). Wariant zgody lejka rozstrzygnięty (#575: tylko po zgodzie analitycznej).
  Szkice NIEOPUBLIKOWANE: `docs/legal-drafts/ai-act-art22-dpia.md`, `eprivacy-lejek.md`.
  **Otwarte (decyzja prawnika/właściciela):** klasyfikacja, DPIA tak/nie (tłumaczenia #514 są
  już w logu użycia i inwentarzu).
- [x] Cloudflare Turnstile (#46) — logowanie/rejestracja/reset: siteverify w Server Actions
  (`src/lib/turnstile/verify.ts`: akcja, hostname, jednorazowość, timeout 5 s), polityka awarii
  per przepływ (`policy.ts`: login fail-open, reszta fail-closed), widżet `TurnstileWidget`.
  Bez kluczy poza produkcją = wyłączony; w produkcji brak kluczy = fail-closed rejestracji/resetu.
  CSP: `challenges.cloudflare.com` (script/frame). Opis: `docs/TURNSTILE.md`. Polityka `report`
  chroni formularz zgłoszenia treści (#41), polityka `contact` — formularz kontaktu (#61).
- [~] Operacje #47 (część kodowa, migracja `0096`): czujki `GET /api/health/ops` — tylko z
  `HEALTH_CHECK_SECRET` (inaczej 404), same liczby z `ops_metrics()` (rola `pracujbe_ops` bez praw
  do tabel; login `DATABASE_OPS_URL`, pula `ops` w `pool.ts`, fallback service-role), progi w
  `src/lib/ops/sensors.ts` (wiek kolejek e-mail/auth, porzucone dzierżawy, zawieszone webhooki,
  opóźnienie maintenance, 80% połączeń) → 503 `alert` / 200 = recovery. Kopia zaszyfrowana `age`
  z manifestem i retencją (`scripts/db/backup.sh`) + odtworzenie z porównaniem sum
  (`restore-backup.sh`), test `npm run test:backup` (PG16, 8 kontroli ujemnych; nie w CI).
  Kopia poza Railwayem (#569): `backup.sh` z `BACKUP_S3_*` wysyła artefakt, potem manifest do
  prywatnego bucketu Cloudflare R2 (API S3, region `auto`; `scripts/db/lib/backup-s3.mjs` + czysta
  logika `backup-s3-core.mjs`; odmowa, gdy wskazuje bucket/klucz CV `AWS_*`) i przycina retencję
  w buckecie (`BACKUP_RETENTION`, opcjonalnie `BACKUP_S3_MAX_AGE_DAYS`; najnowsza kompletna
  zostaje). `restore-backup.sh` z `RESTORE_S3_OBJECT=latest` pobiera kluczem odczytu. Czujka
  `backup` w `/api/health/ops` (`src/lib/ops/backup-freshness.ts`, klucz odczytu
  `BACKUP_S3_READ_*`): każdy stan poza `ok` — też `unconfigured` i klucz zapisu w usłudze web
  (`misconfigured`) — to alarm `backup_*`. Obraz usługi cron `docker/backup/Dockerfile` (node 22,
  pg 18, `age`). Dowód: `backup-r2.test` (atrapa S3 `tests/helpers/fake-s3-server.mjs`, klucz
  odczytu nie zapisze), `backup-r2-image.test`, `ops-health-route.test`, scenariusz R2 w
  `npm run test:backup`. **Do zrobienia (właściciel):** bucket bez domeny publicznej i `r2.dev`,
  dwa tokeny, usługa `backup` w Railway, zmienne (`BACKUP_RESTORE.md`).
  `idx_jobs_city_trgm` + pomiar `npm run db:search-benchmark` (PG16/PG18). Dowód: `rls.sql`
  sekcja OPS47, `tests/integration/ops-metrics.test.ts`. Runbook i kroki właściciela:
  `docs/railway/OPERATIONS.md`. **Otwarte:** konfiguracja infrastruktury (sekret, login, uptime,
  cron kopii/odtworzenia), blokada HTTP w testach, odmiana i aliasy miast w SQL.
  Wyszukiwanie (migracja `0110`): `search_fold` = `lower(unaccent)` (IMMUTABLE) po obu stronach,
  wpis jako literał LIKE (`search_like_pattern` escapuje `\ % _`), prefiltry przez GIN na
  `search_fold(title/city)` (oferty + tłumaczenia), dokładny warunek na tytule w locale; parametry
  jak w `0091`. Demo: lustro `src/lib/search-fold.ts`. Pomiar przed/po: `docs/railway/OPERATIONS.md` §3.
  Dowód: `rls.sql` sekcja SU47 (kontrola ujemna: stary ILIKE). Raporty CSP: `report-uri`/`report-to`
  → `POST /api/csp-report` (tylko log: dyrektywa, origin zasobu, ścieżka bez query/ID; 16 KB, 20/min
  z adresu, 300 wpisów/min na proces; `src/lib/security/csp-report.ts`), `Referrer-Policy:
  strict-origin-when-cross-origin` globalnie — test `csp-report`.
  Cutover i rollback (#16/#18): runbook `docs/railway/CUTOVER_ROLLBACK.md` (kolejność: bazy →
  Better Auth → Resend/cron → `APP_MODE` na decyzję właściciela; rollback = wyzerowanie zmiennych
  w odwrotnej kolejności albo redeploy ostatniego dobrego wdrożenia, baza tylko do przodu;
  obserwacja 48 h) + smoke `node scripts/railway/prod-smoke.mjs` (poza CI; bramka hasła z env,
  4 języki + health, kod ≠ 0 przy błędzie; test `railway-prod-smoke` z atrapą serwera).
  **Otwarte:** wykonanie cutoveru i zapis wyników w `STATUS.md` (właściciel).
- [x] Telemetria bez danych kandydata (#502, część kodowa). Kanał błędów (#571, zamiast
  Sentry — `@sentry/nextjs`, `sentry.*.config.ts` i `sentry-egress` usunięte): webhook Discorda
  `ERROR_WEBHOOK_URL` (tylko serwer; postać natywna `…/api/webhooks/<id>/<token>` → `{content,
  allowed_mentions:{parse:[]}}`, z końcówką `/slack` → `{text}`; https i host `discord.com`/
  `discordapp.com`, inny adres = brak wysyłki). `src/lib/error-webhook/` (url, message, send)
  rejestrowany w `register()` (`src/instrumentation.ts`), `onRequestError` = szablon trasy;
  `captureError` (`src/lib/error-report.ts`, izomorficzny, w przeglądarce no-op) przekazuje
  tylko kod. Wiadomość: kod z `ErrorCodes` (inaczej `INTERNAL`), trasa przez `redactUrl` bez
  query/fragmentu, wydanie (`NEXT_PUBLIC_APP_VERSION`), środowisko, czas; limit 2000 znaków;
  ten sam kod raz na 10 min (licznik pominiętych), 429 → przerwa wg `retry_after`, timeout 3 s,
  awaria cicha bez adresu w logach. `/api/health` → `checks.errorWebhook`. CSP bez hosta Sentry.
  Logi serwera — wspólne reguły redakcji
  `src/lib/privacy/redact.ts` (e-mail, telefon, NISS/BIS, IBAN, tokeny/JWT, query i fragment URL,
  nazwy plików dokumentów, wiersze błędów Postgresa; pola wrażliwe po nazwie; `cause`)
  w `installConsoleRedaction()` (`register()`, poza `next dev`). Dowód: `privacy-redaction`,
  `error-webhook` (oba formaty, brak wysyłki bez zmiennej, payload bez PII z kontrolą ujemną,
  limit, deduplikacja, 429, timeout, strażnik bundla klienta). Opis: `docs/TELEMETRY_PRIVACY.md`.
  **Otwarte (właściciel):** wpisanie `ERROR_WEBHOOK_URL` w Railway, dostęp do kanału Discorda,
  logi Railway (retencja/dostęp), rejestr (#485). Błędy w przeglądarce nie są zgłaszane
  (brak endpointu klienta).
- [x] Warstwa danych paneli bez PostgREST (#25): loadery/akcje/layouty/onboarding/outbox na `withPortalTransaction`
  (sesja → `SET LOCAL ROLE` + `app.current_uid`, RLS w bazie) i `withServiceRole` (pula `service`, login
  `pracujbe_service_runtime`); gotowość produkcji = PostgreSQL WWW + service + Better Auth. Migracja `0107`
  (`claim_email_batch` dla `service_role`). Dowód: `tests/integration/portal-*.test.ts` (PG16). Nazwa firmy
  w wiadomościach kandydata (od 0014, migracja `0143`): `companies` jest czytelne pod RLS tylko dla
  członków firmy, więc kandydat sam nic nie odczyta — `get_conversation_summaries` (lista) i nowe
  `get_conversation_company_name` (wątek/starsze wiadomości) są SECURITY DEFINER, gejtowane tym samym
  `is_conversation_member` co 0039, i zwracają WYŁĄCZNIE `companies.name` (imienia/nazwiska rekrutera
  nadal nie ujawniają — decyzja 0023). Dowód: `rls.sql` sekcja CN143; unit
  `messages-data-result`/`conversation-thread-result`/`messages-sender-fallback`/`thread-pagination`.
  **Otwarte:** spięcie z trasami sesji (#24, zrobione w #532).
- [~] Usunięcie Supabase z runtime (#27, część kodowa): brak `@supabase/*` w `package.json`, usunięte `src/lib/supabase/*`,
  `src/lib/storage.ts` (PDF faktur — billing wyłączony #51, `pdfUrl` = null), hook GoTrue `/api/auth/email-hook` +
  `src/lib/email/auth-email.ts` (e-maile kont wysyła worker Better Auth), zmienne `NEXT_PUBLIC_SUPABASE_*`/`SUPABASE_*`/
  `SEND_EMAIL_HOOK_SECRET`, hosty `*.supabase.co` z CSP i `images.remotePatterns`. Kolejka usuwania obiektów bez bucketu →
  `STORAGE_UNCONFIGURED` (ponowienie), bez klienta Storage. Strażnik `no-supabase-runtime.test.ts`. **Otwarte (odbiór #27):**
  smoke produkcji na Railway (healthcheck, wersja w stopce, ścieżki użytkownika), domena `pracuj.be` w Cloudflare, nazwa
  katalogu `supabase/` (migracje — świadomie bez zmiany). Dokumentacja (odbiór #27, część dokumentacyjna): README,
  `docs/ARCHITECTURE.md`, checklisty bezpieczeństwa/uruchomienia/wydajności, `TURNSTILE.md`, `DATA_RETENTION.md`,
  `AUDIT_PROMPT.md` opisują stan Railway; `SUPABASE_SETUP.md`, raporty audytu/remediacji z 07.2026 i wzmianki
  w `SELF_HOSTED_RUNNERS.md` mają nagłówek „ARCHIWALNE — stan sprzed migracji na Railway (#27)”; mapa katalogów §4
  poprawiona; linki względne w `docs/` sprawdza `tests/unit/docs-links.test.ts`. Szkice prawne (`docs/legal-drafts/`)
  i dokumenty migracji (`docs/railway/`) wspominają Supabase celowo (dostawca historyczny / źródło migracji).
- [x] Integracyjne testy RLS/triggerów w CI — job `rls` (usługa `postgres:16`), `scripts/test-rls.sh`,
  `supabase/tests/{shim,rls}.sql`; `npm run test:rls`.
- [x] Zależności: **`npm audit` 0 podatności** (next-intl v4 + vitest 3 + overrides rollup/vite/esbuild/sharp/prismjs/postcss).
- [x] `next/font/local` (offline DM Sans; wcześniej Inter), PWA (ikony/manifest/service worker), storage signed URLs + upload CV (0018, Invariant #10).
  Pliki CV na Railway (#26): upload, pobranie, usunięcie i kwarantanna przez prywatny bucket S3
  Railway (`src/lib/files/*`, repozytorium `db/candidate-files.ts`, adapter `storage/railway-bucket.ts`),
  bez Supabase Storage. Pobranie = krótki (60 s) link HMAC `/api/files/cv/<id>?t=…` wystawiany
  przy kliknięciu; trasa ponownie sprawdza sesję Better Auth, własność i `scan_status`, strumieniuje
  z bucketu (bez adresu S3). Env: preset „AWS SDK” bucketu (`AWS_ENDPOINT_URL`, `AWS_DEFAULT_REGION`,
  `AWS_S3_BUCKET_NAME`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_S3_URL_STYLE`) +
  `FILE_DOWNLOAD_SECRET`; `/api/health` → `fileBucket`/`fileDownloadSecret`. Bez bucketu: demo =
  `DEMO_UNAVAILABLE`, produkcja = błąd. Opis: `docs/railway/STORAGE_ADAPTER_CONTRACT.md`.
  GC sierot (#17, migracja `0117`): dzienny przebieg w `/api/maintenance` (`src/lib/storage-gc.ts`,
  `list` w adapterze) — obiekt bez wiersza `files` po 24 h → `storage_deletion_queue`, wiersz bez
  obiektu → tylko licznik; partie z kursorem (`storage_gc_sweeps`), dry-run domyślnie
  (`STORAGE_GC_MODE=delete` = kasowanie), same liczniki w odpowiedzi. Opis: `docs/DATA_RETENTION.md` §3a.
  **Otwarte:** utworzenie bucketu (właściciel), zatwierdzenie trybu `delete` na produkcji, GC
  `email_deliveries`/`processed_webhooks`/`rate_limit` z #17, AV, PDF faktur (`storage.ts`, #27).
  Manifest PWA per język (#174): `/{locale}/manifest.webmanifest` z `lang`/`start_url`/opisem
  w danym języku (generator `src/lib/pwa/manifest.ts`, języki z `routing.locales`), nieobsługiwany
  → 404, stary `/manifest.webmanifest` = PL. Adres manifestu omija middleware (bramka hasła,
  next-intl) — strażnik `tests/unit/pwa-manifest-route.test.ts`, E2E `pwa-locale-manifest.spec`.
  Plik CV: wspólne reguły `src/lib/validation/cv-file.ts` (5 MB, PDF/DOC/DOCX) w przeglądarce i akcji;
  plik za duży/zły format odrzucony przed wysyłką (limit ciała akcji 6mb), akcja zwraca `reason`
  (`tooLarge`/`type`/`empty`) → komunikaty `files.error*` (#362).

### Etap 8 — jakość
- [x] Testy: Vitest (matching, recipient-locale, i18n keys, error-keys), integracyjne RLS+seed w CI (`postgres:16`), Playwright (smoke/seo/flows)
- [~] Testy Playwright: języki/detal oferty/CTA/noindex paneli/cookies/SEO gotowe (`flows.spec`+smoke+seo, 12 pass); do rozbudowy: aplikowanie/propozycje pod realną sesją
  Przepływ na PostgreSQL 16 (#351, #66 — częściowo): `npm run test:e2e:real`
  (`scripts/test-e2e-real.mjs` + `playwright.real-flow.config.ts`, spec `tests/e2e-real/`).
  Izolowana baza o jawnym hoście/porcie/nazwie (`E2E_PG*`, nazwa musi zawierać „e2e”), migracje
  produkcyjne, jednorazowe ograniczone loginy app/auth. Sesje Better Auth (rejestracja →
  weryfikacja → logowanie → cookie), tożsamość z cookie (`readPortalIdentity`) →
  `withUserTransaction` pod RLS. Kroki: onboarding 1–6 z błędem drugiej części kroku 5
  i `finish_onboarding`, aplikacja (podwójne kliknięcie), status, propozycja (retry), akceptacja,
  wiadomości w obie strony z licznikiem, `email_deliveries` fr/nl, obce konta bez dostępu.
  Przeglądarka widzi ofertę z bazy (`next dev` z `DATABASE_APP_URL`) i jej zniknięcie po
  zamknięciu. Kontrole ujemne: `E2E_REAL_MUTATION=rls-applications-off|finish-onboarding-noop|
  step5-swallow-error|recipient-locale-en|funnel-no-dedup|retry-new-key` — każda daje czerwony test.
  Onboarding (#66, `tests/e2e-real/candidate-onboarding.spec.ts`): kroki 1–6 osobno z odczytem
  po każdym (`support/onboarding.ts` = kontrakt `saveOnboardingStep` ze schematami kroków
  z produkcji + loader kreatora z relacjami), wznowienie („Dalej” z danymi z bazy nie gubi
  skills/languages/certificates, edycja usuwa pozycję), walidacja pól i odrzucenia w bazie bez
  zmiany stanu, równoległe zapisy kroków 3/5 i „Zakończ” bez duplikatów, `finish_onboarding`
  (niekompletny → `ONBOARDING_INCOMPLETE`), wyszukiwalność tylko po ukończeniu i opt-in
  (widok pracodawcy pod RLS). Mutacje: `searchable-without-complete|skills-append|
  completeness-guard-off|relations-dml-open`. Zestaw real-flow nie jest w CI (uruchamiany ręcznie).
  Kroki UI w przeglądarce (`tests/e2e-real/ui-flow.spec.ts`, helpery `support/ui.ts`): serwer
  `next dev` z Better Auth na ograniczonym loginie auth (`DATABASE_AUTH_URL`, origin jak w stosie
  testu). Rejestracja pracodawcy (nl) i kandydata (fr) formularzami → link potwierdzenia z
  `auth.email_outbox` (język odbiorcy) → przycisk „Potwierdź” → panel wg roli; logowanie
  formularzem (złe hasło bez sesji), panel bez sesji → logowanie. Kreator onboardingu 1–6
  (błąd pola, „Zakończ” → `profile_completed` w bazie), przełącznik widoczności profilu,
  ApplyModal (podwójne kliknięcie, ponowne wysłanie → „już aplikowałeś”), menu statusu w
  szczególe zgłoszenia, propozycja z `/employer/kandydaci`, akceptacja w
  `/candidate/propozycje`, wiadomości w obu panelach, obca firma → 404 szczegółu. Wyjątki bez
  ścieżki UI: weryfikacja firmy przez RPC admina, oferta przez RPC kreatora pod sesją
  z przeglądarki, wiersz `matches` wstawia operator (pipeline P1-03). Mutacje UI:
  `respond-offer-noop|transition-noop` (czerwone są też `finish-onboarding-noop` i
  `recipient-locale-en`; `rls-applications-off` łapie tylko critical-flow — panel sam filtruje
  po aktywnej firmie). Kreator oferty (`tests/e2e-real/job-wizard.spec.ts`): 9 kroków klikanych
  w przeglądarce (nl) pod sesją Better Auth; błąd pola w kroku 1 nie tworzy oferty, po każdym
  „Dalej” odczyt szkicu w bazie (kolumny `jobs`, tłumaczenie, wymagania, umiejętności, języki
  z poziomem, certyfikaty); publikacja przy firmie niezweryfikowanej = komunikat i nadal `draft`
  (bez e-maila `jobPublished`), po weryfikacji przez admina ta sama sesja publikuje (`active`,
  slug publiczny, e-mail w języku publikującego, strona oferty dla gościa). Mutacje:
  `wizard-draft-noop|publish-unverified`. **Otwarte:** wpięcie w CI (job z usługą `postgres:16`)
  — gotowy fragment `ci.yml` w opisie PR.
  Straże krytycznych przepływów bez realnej bazy: unit Server Actions (`critical-flow-actions`),
  worker outboxa w `email_deliveries.locale` (`email-outbox-locale`), zgody cookies
  (`consent-store`, `consent-action`), gałąź produkcyjna sitemap/robots (`sitemap-robots`);
  E2E noindex każdej strony paneli i auth z systemu plików (`panel-noindex`) i axe na wszystkich
  trasach publicznych, 4 języki, 320/1280 px, z banerem i po jego zamknięciu (`a11y-public-routes`).
  Panele (#373, `panel-a11y`): axe critical/serious + `target-size` na wszystkich 29 trasach
  kandydata i pracodawcy (PL/EN 1280 px, 4 języki 320 px), z banerem, z otwartym menu statusu,
  centrum powiadomień i kompozytorem; kontrola ujemna (przycisk bez nazwy → czerwony). Admin: `admin-a11y`.
  Zasada E2E: kontrolki po roli i nazwie z `src/messages` (`tests/e2e/fixtures/messages.ts`),
  bez `.first()`/`.nth()` na przyciskach o znaczeniu. Invariant #1 na ścieżce enqueue → worker →
  render (#348, `email-recipient-locale-e2e`): kontrakt najnowszych `resolve_recipient_locale`/
  `enqueue_email` z migracji (kolejność preferred → account → signup → `en`, locale z
  `p_profile_id`), zgodność z TS, nadawca i odbiorca w różnych językach, kontrola ujemna.
  Zgody cookies (#349/#570, `cookie-consent-categories.spec`, 4 języki): „Tylko niezbędne”,
  zgoda na analitykę → beacon Cloudflare Web Analytics (#570: zamiast Google Analytics i Meta
  Pixel — usunięte; bezcookie'owy, więc bez `_ga*`/`_fbp`/`_fbc` i bez `ga-disable`/
  `fbq('consent', …)`), same preferencje → beacon się nie ładuje, centrum zgód bez
  przełącznika „Marketing” (usunięty — decyzja właściciela 25.09), wycofanie ze stopki usuwa render beaconu natychmiast i po
  odświeżeniu zero żądań; stara wersja polityki (także cookie 1.0 z marketingiem) / uszkodzone cookie → baner z serwera
  nieukryty przed hydratacją; cookie na 180 dni; wywołanie `recordConsent` z kategoriami
  i źródłem (centrum = `cookie_settings`). Kontrakt parametrów `recordConsent` ↔
  `record_consent` z migracji (`consent-action.test`).
  Wersja polityki w receipcie (#349, migracja `0142`): `record_consent` przyjmuje opcjonalny
  `p_version` (= `ConsentRecord.v` z cookie klienta, `src/lib/consent.ts`) i zapisuje w
  receipcie DOKŁADNIE tę wersję dokumentu 'cookies', którą użytkownik faktycznie widział —
  ale TYLKO gdy istnieje jako OPUBLIKOWANY wiersz `consent_versions` (`published_at` ustawione
  i ≤ now(); nie musi być `is_current`, bo polityka mogła się zmienić już PO zgodzie). Wartość
  `NEXT_PUBLIC_CONSENT_POLICY_VERSION` musi być równa `consent_versions.version` dokumentu
  `cookies` (`docs/LAUNCH_CHECKLIST.md` §3). Nieznana/nieopublikowana/brak wersji → cichy fallback do bieżącej (jak
  przed 0142); best-effort, log zgód nie blokuje UX (Invariant #8). Kategorie jak w `0130`
  (bez `marketing`). Stara 5-argumentowa sygnatura RPC jest zastąpiona (jedyny wołający,
  `recordConsent`, zaktualizowany w tym samym PR). Dowód: `rls.sql` sekcja CVR142 (kontrole
  ujemne: nieistniejąca wersja nie trafia do receiptu, wersja nieopublikowana — przyszła lub szkic — też nie,
  authenticated nie dopisuje/nie nadpisuje receiptu cudzego konta).
  Invariant #1 na żywej bazie (#348): `rls.sql` sekcja LOC348 — `email_deliveries.locale` dla
  newApplication, applicationViewed, statusChanged, jobOffer (+ `offers.locale`), offerAccepted/
  Declined, newMessage (obie strony), companyVerified, teamInvitation; nadawca, odbiorca i oferta
  w różnych językach, fallback preferred → account → signup → `en`, komplet szablonów sekcji;
  kontrole ujemne (język sesji nadawcy, odwrócony fallback). Raport flaków z kilku lokalnych
  przebiegów (#375, poza CI): `npm run test:e2e:flaky -- --runs N` (`scripts/e2e-flaky-report.mjs`,
  opis `docs/E2E_FLAKY_REPORT.md`, test `flaky-aggregate`).
  Post 1080×1080 z prawdziwej oferty (#181): `scripts/export-job-post.mjs slug locale wyjście`
  — dane wyłącznie z `get_public_job` (`DATABASE_APP_URL`, `SET LOCAL ROLE anon`, odmowa loginu
  superusera; `scripts/lib/job-post-source.mjs`), bez JSON od operatora; renderer przyjmuje tylko
  obiekt ze źródła. Stawka tylko gdy podana, tytuł 2×77/3×60 px albo błąd przed zapisem.
  Instrukcja: `docs/design/people-passport/JOB-POST-EXPORT.md`, test `job-post-export`.
  Źródło danych (#186, migracja `0102`): `get_campaign_job` (anon) — tylko pola grafiki i tylko
  oferta `active`, nieusunięta, niewygasła, `is_demo = false` (oferta i firma), firma `verified`;
  inaczej jednakowy brak danych. Dowód: `rls.sql` sekcja CJ186 (każdy przypadek + kontrola ujemna
  po zdjęciu każdego filtra), rollback `supabase/rollback/0102_…down.sql` (test w `test-rls.sh`).
  Baner kampanii z oferty w panelu (#175): `/employer/oferty/[id]/baner` (noindex) + `GET
  /api/employer/jobs/[id]/banner` — formaty 1200×300, 300×250, 300×600, język PL/NL/FR/EN, SVG
  i PNG (kanwa w przeglądarce); dane z `get_managed_campaign_job` (recruiter+ firmy oferty albo
  admin, te same filtry), limit 60/h na konto, `private, no-store`, CSP `sandbox`, demo = 404.
  Znak jak `Logo.tsx`, tokeny `--pp-*`, osadzony DM Sans, pomiar tekstu tablicą szerokości
  (`src/lib/campaign-banner/`). Opis: `docs/design/people-passport/BANNER-EXPORT.md`. Testy:
  `campaign-banner*.test.ts` (Chromium: pomiar przeglądarki ≤ serwera), E2E `campaign-banner`.
  Link do baneru w panelu admina: `/admin/firmy/[id]` przy każdej AKTYWNEJ ofercie firmy linkuje
  do `GET /api/employer/jobs/[id]/banner` (endpoint dopuszcza admina, `/employer/oferty/[id]/baner`
  jest zablokowana layoutem panelu pracodawcy dla konta bez firmy) — otwiera się w nowej karcie.
  Eksport grafik poza CI (#378): `scripts/lib/launch-chromium.mjs` — `PLAYWRIGHT_CHROMIUM_PATH`
  (zła ścieżka = czytelny błąd), potem przeglądarka z `playwright install` (CI bez zmian), potem
  najnowsza rewizja w `PLAYWRIGHT_BROWSERS_PATH`. Story PNG porównywane pikselami
  (`tests/helpers/png-pixels.ts`), bo rewizje Chromium inaczej kodują IDAT.
  Zrzut bez flaka (main 514e917, „Unable to capture screenshot”): skrypty robią zrzut przez
  `scripts/lib/stable-screenshot.mjs` (fonty + dwie ramki ze stałym układem, najwyżej 3 próby
  tylko tego błędu, wpis na stderr); testy z Chromium w projekcie Vitest `chromium`
  (`CHROMIUM_TEST_FILES`, jeden plik naraz), strażnik `stable-screenshot.test.ts`.
- [~] Wydajność / Core Web Vitals / dostępność (audyt) — **dostępność (a11y) ZROBIONE:** bramka
  axe-core w CI (`tests/e2e/a11y.spec.ts`, uruchamiana w jobie `e2e`) blokuje przy naruszeniach
  WCAG 2.x A/AA o wadze critical/serious na kluczowych stronach publicznych (home, lista ofert,
  logowanie, rejestracja); domknięte realne naruszenia kontrastu (tokeny).
  Bramka wydajności w CI (#395): kroki „Performance budget (static)” w `build` (JS gzip
  kluczowych tras = layouty + strona, fonty woff2; `scripts/perf-budget-static.mjs`) i
  „Performance budget (lab CWV)” w `e2e` (LCP/CLS/TBT, mediana 3 prób, CPU 4×, 1,6 Mb/s,
  pierwsza wizyta i ze zgodą; `scripts/perf-lab.mjs`, ten sam build i Chromium). Budżety i
  progi w `perf-budgets.json`, opis w `docs/PERFORMANCE_CHECKLIST.md` §10; strażnik kroków
  w `check-ci-workflows.mjs`. INP-proxy w tym samym kroku: tapnięcie „Filtry”, zapis oferty
  (odpowiedź `getPublicSavedJobs` podmieniona na kandydata — CI bez sesji) i „Aplikuj teraz”,
  Event Timing (najdłuższy wpis interakcji), CPU 4×, mediana 3 prób vs `inpMs` (200 ms);
  kontrola ujemna `--inject-click-delay-ms 300` → czerwony.
  Dane polowe CWV — Cloudflare Web Analytics zamiast własnej zbiórki: beacon z #570/#635 (tylko
  po zgodzie `analytics`, tylko trasy publiczne, bez cookies) sam mierzy LCP/INP/CLS. Podgląd
  `/admin/wydajnosc?dni=7|28` (tylko admin, `requireAdmin`): p75 serwisu + 20 najczęstszych
  ścieżek z oceną słowną wg progów, boty pominięte, liczby próbkowane — odczyt z serwera przez
  GraphQL Analytics API (`src/lib/web-vitals/field-report.ts` czysty parser, `cloudflare-client.ts`
  server-only, token tylko w nagłówku, timeout 8 s, błąd = sam kod; env `CF_ANALYTICS_ACCOUNT_ID`,
  `CF_WEB_ANALYTICS_SITE_TAG`, `CF_ANALYTICS_API_TOKEN`). Bez konfiguracji: instrukcja (z bazą)
  albo raport przykładowy oznaczony demo (bez bazy). Bez migracji i bez endpointu `/api/web-vitals`.
  Testy: unit `web-vitals-field` (kontrole ujemne: brak konfiguracji = zero żądań, token poza
  treścią/adresem, z bazą nigdy demo), E2E `admin-web-vitals` (4 języki, brak żądań do Cloudflare
  z przeglądarki), `admin-a11y`; zgody beaconu — istniejące `cookie-consent-categories`. **Do
  zrobienia (właściciel):** token beaconu i token API w Railway; TTFB i próg alarmu w czujkach.
  Poprawki kodu z researchu wydajności: `JobCard` jako komponent serwerowy (#391; jedyna
  wyspa = przycisk zapisu z `jobId`; względna data na serwerze po dniu kalendarzowym w
  Brukseli — `src/lib/relative-date.ts`, zmienia się tylko o północy, zgodna z ISR), dialogi
  na `LightDialog*` bez przeliczania stylów całej strony przy otwarciu, z treścią montowaną
  w osobnym zadaniu po ramce z nakładką (#393; INP otwarcia < 100 ms przy CPU 4×,
  `dialog-open-inp.spec`), długi cache
  obrazów z optymalizatora i plików `public/` (#394). Font jako podzbiór łaciński (#388: Inter ~73 KB, od #5/#7 DM Sans ~42 KB; przepis
  `scripts/subset-font.py`, fonty zastępcze z metrykami w `globals.css`) i baner zgód
  w HTML z serwera, ukrywany przed malowaniem przy zapisanej zgodzie (`consent-boot.ts`, #389);
  „Przejdź do treści” renderuje `[locale]/layout` przed banerem, każdy układ ma `#main-content`.
  Zod poza JS stron publicznych (#390): helpery adresu `next` (`safeNextPath`, `loginHref`,
  `registerHref`, `relocalizeNextParam`) w `src/lib/auth/next-path.ts` bez Zoda; schematy
  zostają w `validation/auth`. Straże: graf importów `public-bundle-no-zod.test` i chunki
  z `ZodError` w `check-next-build.mjs` (layout `(public)`, home, lista ofert, poradnik).
  Strony publiczne statyczne/ISR (#298): layout `(public)` woła `setRequestLocale` i podaje
  `locale` jawnie do Header/Footer, a `[locale]/layout` do SkipLink (inaczej next-intl czyta `headers()` → SSR `no-store`).
  Oferty (home, `/praca`, landingi, szczegół) `revalidate = 60`, treść `3600` (layout). Przy
  `DATABASE_APP_URL` build nie czyta bazy: landingi przez `prerenderParamsAtBuild` (strony na pierwsze
  żądanie), odczyty ofert w `next build` zwracają pusty wynik (`isBuildPhase`), a layout `[locale]`
  ZAWSZE prerenderuje komplet języków — pusta lista dawała 500 DYNAMIC_SERVER_USAGE na logowaniu,
  rejestracji i liście ofert (strażnik `static-public-pages.test`);
  layout `(public)` odrzuca nieobsługiwany locale (`notFound`). Middleware: bramka hasła i
  odświeżone cookies sesji → `private, no-store`; alias miasta → 308 w middleware (redirect z ISR
  dublował `Location`). Własny `cacheHandler` (`src/lib/cache/isr-cache-handler.mjs`, `next.config.mjs`): LRU w pamięci
  (64 MB / 2000 wpisów), 404 losowych slugów tylko w puli pamięci (200 wpisów, TTL 60 s) — nigdy
  na dysku; wpisy runtime w `.next/cache/isr-handler` (256 MB / 5000 wpisów / 4 MB na wpis,
  najstarsze usuwane, indeks odbudowany po restarcie); strony z buildu czytane z `.next/server/app`
  bez nadpisywania; cache obrazów bez zmian. Testy: `isr-cache-handler.test` (mutacja detektora
  404 = czerwony), E2E `public-cache-headers` (40 losowych slugów = 0 plików; bez handlera +120). Straże: `static-public-pages.test`, `check-next-build.mjs`
  (prerender), E2E `public-cache-headers.spec`. Lista `/oferty-pracy` (filtry), auth, panele — per żądanie.
- [x] Dokumentacja (architektura, setup, checklisty) — podstawa
  Wydanie 1.0.0 (#103): kryteria, blokery i procedura (decyzja właściciela, zielone CI, SHA
  wdrożenia, tag `v1.0.0`, `CHANGELOG.md`) w `docs/RELEASE_1_0.md`. Build zostaje `0.YYYYMMDD.M+SHA`
  do jawnego `PRACUJBE_RELEASE_VERSION=1.0.0` (→ `1.0.0+SHA`); inna wartość przerywa build
  (`scripts/build-version.mjs`, `build-version.test.ts`).
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
npm run test:e2e:real  # Playwright + izolowany PostgreSQL 16 (E2E_PG*; przepływ kandydat ↔ pracodawca)
npm run verify         # lint + typecheck + test (uruchamiaj przed commitem)
npm run test:rls       # migracje od zera + testy RLS na lokalnym PostgreSQL 16
npm run db:migrate:production  # migracje na wskazanej bazie (MIGRATION_DATABASE_URL, MIGRATION_MODE)
```

---

## 13. Konwencje kodu

- Komponenty serwerowe domyślnie; `"use client"` tylko gdy potrzebne (interakcje/hooki).
- Walidacja I/O = Zod; typy z `z.infer`. Brak `any` (strict).
- Teksty przez `useTranslations`/`getTranslations` (next-intl) — nigdy literały w JSX.
- Dostęp do DB: `src/lib/db/portal.ts` + `src/lib/db/sql.ts` (#25); nazwy zapytań/funkcji tylko stałe, wartości w `$n`. Operacje wrażliwe = Server Actions/route handlers.
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
