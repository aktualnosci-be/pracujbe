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
| muted | `#64748B` | tekst drugorzędny |
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
> (`docs/REMEDIATION-2026-07-23.md`). Zamknięte P0-01..04, P1-01/02/05/06/07/10/11/12/14
> (migracja `0011_security_hardening.sql` zweryfikowana testami adwersaryjnymi na PostgreSQL 16;
> lint/typecheck/test/build zielone). **Otwarte przed produkcją (NO-GO do czasu domknięcia):**
> widoki publiczne firm/ofert (P1-03/04), outbox e-mail (P1-13), revoke trackerów + serwerowy log
> zgód (P1-08/09), pełna CSP (P2-01), testy integracyjne RLS w CI. Statusy poniżej rozdzielają
> `schema/scaffold` od `backend flow` i `tested` — nie oznaczaj funkcji jako gotowej bez działającego przepływu.

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

### Redesign wg makiet (PRIORYTET po fazie fundamentu) — `docs/DESIGN_SCREENS.md`
- [ ] Paleta granatowa: `globals.css` + `tailwind.config.ts` (`--primary` #0F2A47 vs `--accent` #2563EB), `manifest.ts` theme_color
- [ ] Komponenty z makiet: JobRow(hover), FilterSidebar+FilterSheet, SalaryRange, StatusPill, StatCard, MatchBar, Stepper, DashboardSidebar+BottomTabBar, ApplyModal, NotificationsDropdown, Toast, CookieSettingsDialog, PricingPackageCard, RecruitmentFunnel
- [ ] Odwzorowanie 7 ekranów 1:1 (home, lista, detal+modal, panel kandydata, panel pracodawcy, onboarding, stany)

### Etap 2 — strony publiczne
- [x] Strona główna (hero + sekcje) SSR
- [~] Lista ofert + filtry (podstawa; brak pełnych filtrów i infinite scroll)
- [~] Szczegóły oferty + JobPosting JSON-LD (podstawa)
- [ ] Strony: kategorie/miasta/regiony/zawody/typy umów/bez języka/z zakwaterowaniem/od zaraz/branże
- [x] SEO: sitemap.ts, robots.ts, metadata + hreflang (podstawa)
- [ ] Poradniki (blog) + Article JSON-LD

### Etap 3 — kandydat
- [ ] Rejestracja / logowanie / reset / potwierdzenie e-mail (Supabase Auth)
- [ ] Onboarding kandydata (6 kroków, zapis per krok)
- [ ] Panel kandydata (podsumowanie, oferty, aplikacje, propozycje, wiadomości, profil, ustawienia)

### Etap 4 — pracodawca
- [ ] Konto firmy + weryfikacja
- [ ] Panel pracodawcy
- [ ] Kreator oferty (9 kroków, autozapis draftu)

### Etap 5 — procesy
- [~] Matching (logika + test jednostkowy) — rdzeń gotowy, integracja z UI do zrobienia
- [ ] Aplikacje (idempotentne) + statusy + historia
- [ ] Propozycje pracy (idempotentne, kolejka e-mail) + statusy
- [ ] Wiadomości (konwersacje, załączniki, przeczytania, zgłoszenia)

### Etap 6 — komunikacja
- [~] Wybór języka odbiorcy (fallback) — util + test gotowe
- [ ] Kolejka e-mail + worker + ponawianie
- [ ] Szablony React Email PL/NL/FR/EN (wszystkie typy z sekcji 22)
- [ ] Powiadomienia in-app + preferencje

### Etap 7 — admin / prywatność / płatności
- [~] Cookies: baner + kategorie + centrum ustawień + zapis zgód (podstawa)
- [ ] Panel administratora (pełny)
- [ ] Audit logs (zapisy przy operacjach wrażliwych)
- [ ] Płatności / subskrypcje / faktury / kody rabatowe

### Etap 8 — jakość
- [~] Testy: Vitest (matching, recipient-locale, i18n keys), Playwright (smoke) — podstawa
- [ ] Testy Playwright: języki, propozycje, aplikowanie, cookies, bezpieczeństwo, SEO
- [ ] Wydajność / Core Web Vitals / dostępność (audyt)
- [x] Dokumentacja (architektura, setup, checklisty) — podstawa
- [ ] Dane seed pełne (10 firm / 50 ofert / 40 kandydatów) — podstawa w seed.sql

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
