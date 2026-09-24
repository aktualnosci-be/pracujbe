# Architektura — Pracuj.be

Dokument opisuje architekturę techniczną, kluczowe decyzje, przepływy krytyczne
(z diagramami tekstowymi), model danych oraz role i uprawnienia. Uzupełnia
[`CLAUDE.md`](../CLAUDE.md) (mapa/kontrakt projektu) o szczegóły „jak to działa i dlaczego".

---

## 1. Przegląd i decyzje architektoniczne

**Pracuj.be** to wielojęzyczna (PL/NL/FR/EN) platforma rekrutacyjna dla Belgii.
Kandydat tworzy prosty profil zawodowy zamiast CV; pracodawca publikuje oferty,
przegląda aplikacje i wysyła proaktywne propozycje pracy.

| Decyzja | Wybór | Uzasadnienie |
|---|---|---|
| Framework | Next.js 15 (App Router, RSC) | SSR/SSG dla SEO ofert, minimalny JS na stronach publicznych |
| Język | TypeScript `strict` + `noUncheckedIndexedAccess` | jedno źródło typów; wychwytywanie błędów w kompilacji |
| Baza / Auth / Storage | Supabase (Postgres + Auth + Storage + RLS) | RLS jako główna granica bezpieczeństwa danych |
| Walidacja | Zod (`z.infer`) | walidacja I/O + generowanie typów |
| UI | Tailwind + shadcn/ui (Radix) | dostępność, spójne tokeny kolorów |
| E-mail | Resend + React Email, przez kolejkę `email_deliveries` | wysyłka rozłączna z zapisem w DB, ponawialna |
| i18n | next-intl, routing z prefiksem `/{locale}` | teksty w `src/messages/*.json`, hreflang |
| Błędy | centralny `AppError` (`src/lib/errors`) + Sentry | użytkownik nie widzi technikaliów |
| Hosting | Railway (jedna produkcja z `main`) | natywna integracja GitHub z `Wait for CI` |
| CI/CD | GitHub Actions na **self-hosted** runnerach + Railway | CI w Actions, wdrożenie produkcji po zielonym CI |

**Zasada nadrzędna:** aplikacja MUSI się budować i renderować strony publiczne **bez
żadnych zmiennych środowiskowych**. Gdy `isSupabaseConfigured()` zwraca `false`, warstwa
danych (`@/lib/jobs`) czyta z `@/lib/data/demo`. Klienci Supabase czytają env leniwie
(dopiero przy użyciu), więc import modułu nigdy nie rzuca.

### Warstwy renderowania

```
┌─────────────────────────────────────────────────────────────────┐
│  Strony publiczne (/{locale}/…)   → SSR/SSG + ISR, indeksowane    │
│     oferty, kategorie, miasta, poradniki, strona główna          │
├─────────────────────────────────────────────────────────────────┤
│  Panele (candidate/*, employer/*, admin/*) → SSR + wyspy klienta │
│     NOINDEX, wymagana sesja, RLS + walidacja w Server Actions    │
├─────────────────────────────────────────────────────────────────┤
│  API routes (/api/*)  → webhooki (Resend, płatności), kolejka    │
│     e-mail (cron/worker), operacje serwerowe                     │
└─────────────────────────────────────────────────────────────────┘
```

### Trzej klienci Supabase (rozłączne zastosowania)

- `@/lib/supabase/server` — RSC, Server Actions, Route Handlers. Sesja użytkownika
  z cookies. Podlega RLS jako `authenticated`/`anon`.
- `@/lib/supabase/client` — komponenty klienckie (`"use client"`). Anon key. Podlega RLS.
- `@/lib/supabase/admin` — **service role**, omija RLS (`BYPASSRLS`). WYŁĄCZNIE kod
  serwerowy zaufany (webhooki, kolejka e-mail, admin). NIGDY nie importować w komponencie
  klienckim — inaczej klucz trafi do bundle'a (Invariant #6).

---

## 2. Przepływ: kandydat → oferta → pracodawca

```
KANDYDAT                          SYSTEM (DB + RLS + Server Actions)          PRACODAWCA
────────                          ──────────────────────────────────         ──────────
rejestracja ───────────────────► auth.users INSERT
                                    └─(trigger handle_new_user)──► profiles
                                                                    + notification_preferences
onboarding (6 kroków, zapis
  per krok) ───────────────────► candidate_profiles (+ skills/languages/
                                    certificates), profile_completed

przegląda oferty ◄────────────── jobs (status='active')  [SSR/ISR, publiczne]
scoreMatch (klient/serwer) ─────► matches (cache wyniku)

APLIKUJE (idempotentnie) ───────► applications
  idempotency_key                   UNIQUE(candidate_id, job_id)
                                    ON CONFLICT → APPLICATION_ALREADY_EXISTS
                                    status='submitted'
                                    + application_status_history (→submitted)
                                    + notifications(application_received) ──► powiadomienie in-app
                                    + enqueueEmail(→ pracodawca, locale PRACODAWCY) ──► e-mail
                                                                                       ►przegląda aplikację
                                                                          zmiana statusu ◄──┘
                                  applications.status ← (shortlisted/
                                    interview/rejected/…)
                                    + application_status_history
   powiadomienie ◄──────────────── + notifications(application_status_changed)
   e-mail (locale KANDYDATA) ◄──── + enqueueEmail(→ kandydat, locale KANDYDATA)

                                  ┌──────────── PROPOZYCJA (offers) ────────────┐
   propozycja ◄────────────────── offers.status='sent' (idempotentnie)  ◄─────wysyła propozycję
   powiadomienie + e-mail            + offer_status_history + enqueueEmail
     (locale KANDYDATA)
akceptuje / odrzuca ────────────► offers.status ∈ {accepted, declined}
                                    + offer_status_history
                                    + notifications(offer_status_changed) ──► powiadomienie
                                    + enqueueEmail(→ pracodawca, locale PRACODAWCY)
```

**Reguły twarde tego przepływu:**
- Aplikacja jest **idempotentna** — `UNIQUE(candidate_id, job_id)` gwarantuje jedną
  aplikację; podwójne kliknięcie = ten sam wiersz (Invariant #4).
- Każda zmiana statusu tworzy wpis w `*_status_history` (audytowalność).
- Każde powiadomienie e-mail idzie przez kolejkę (nie blokuje transakcji) i **w języku
  odbiorcy** (patrz §5).

---

## 3. Przepływ: wysyłka e-mail (kolejka `email_deliveries`)

Zapis danych w DB jest **rozłączny** z wysyłką e-maila. E-mail zawsze trafia najpierw
do kolejki jako rekord `email_deliveries(status='queued')`; osobny proces (route handler
uruchamiany cronem/workerem) renderuje szablon i woła Resend. Błąd wysyłki **nie cofa**
operacji biznesowej — jest ponawialny.

```
Server Action / trigger biznesowy
        │
        ▼
enqueueEmail({ template, recipientProfileId, entityType, entityId,
               payload, idempotencyKey? })
        │
        ├─ wyznacz locale odbiorcy = resolveRecipientLocale(recipient)   (§5)
        ├─ INSERT email_deliveries (status='queued', locale, template,
        │     to_email, entity_type, entity_id, idempotency_key)
        │     ON CONFLICT (idempotency_key) DO NOTHING   ← brak duplikatu
        ▼
[ kolejka w DB ]
        │
        ▼  cron Railway: POST /api/email/process  (chroniony EMAIL_QUEUE_SECRET)
        │
        ├─ SELECT ... WHERE status IN ('queued','failed')
        │            AND attempts < MAX  ORDER BY queued_at  LIMIT N   (FOR UPDATE SKIP LOCKED)
        ├─ dla każdego: render React Email w email_deliveries.locale
        ├─ Resend.emails.send(...)
        │     ├─ sukces → status='sent', provider_message_id, sent_at
        │     └─ błąd   → status='failed', error_message, attempts++ (retry z backoffem)
        ▼
Webhook Resend (#44)  →  POST /api/email/webhook/resend  →  record_email_event (0098)
        ├─ aktualizacja status: delivered / bounced / complained (tylko „w górę”)
        │  (dopasowanie po provider_message_id — kolumna z UNIQUE indeksem)
        └─ trwałe odbicie / skarga → email_suppressions (enqueue/claim pomijają adres)
```

**Statusy** (`email_status`): `queued → sent → delivered → opened → clicked`; ścieżki błędu:
`failed`, `bounced`, `complained`. **Ponawianie:** rekordy `failed` z `attempts < MAX`
są wybierane przy kolejnym przebiegu; po wyczerpaniu prób zostają jako `failed`
(nie znikają — do diagnostyki). Tabela `email_deliveries` nie ma polityk RLS → dostęp
tylko przez service role.

---

## 4. Przepływ: wysyłka propozycji (idempotencja)

Propozycja pracy (`offers`) to najbardziej wrażliwy przepływ zapisu. Kolumna
`offers.idempotency_key` jest `text NOT NULL UNIQUE` — ten sam klucz zawsze daje ten sam
rekord. Kolejność w Server Action:

```
sendOffer(input, idempotencyKey)
  1. AUTORYZACJA        → is_company_member(company_id)          else PERMISSION_DENIED
  2. STATUS FIRMY       → company_is_verified(company_id)        else COMPANY_NOT_VERIFIED
  3. STATUS OFERTY      → jobs.status = 'active'                 else JOB_NOT_ACTIVE
  4. WALIDACJA KANDYDATA→ kandydat istnieje / is_searchable      else VALIDATION_FAILED
  5. TRANSAKCJA:
       INSERT INTO offers (..., idempotency_key, status='sent', sent_at=now())
         ON CONFLICT (idempotency_key) DO NOTHING
         RETURNING *
       ─ jeśli brak RETURNING (konflikt) → SELECT istniejący wiersz → zwróć go
                                            (żadnego duplikatu, żadnego 2. e-maila)
       ─ jeśli wstawiono nowy:
           INSERT offer_status_history (→ 'sent')
           INSERT notifications(offer_received, profile=kandydat)
           enqueueEmail({ template:'offer_received', recipient=kandydat,
                          idempotencyKey: 'offer:'+offer.id })
  6. COMMIT
```

- **Podwójne kliknięcie / retry** z tym samym `idempotency_key` → krok 5 nie tworzy
  nowego wiersza; e-mail również ma idempotency_key (`offer:<id>`) w `email_deliveries`,
  więc nie zostanie zakolejkowany drugi raz (Invariant #3).
- Zapis w DB jest źródłem prawdy; wysyłka e-maila jest asynchroniczna i ponawialna —
  awaria Resend nie unieważnia propozycji.

---

## 5. Obsługa języków (fallback odbiorcy)

**Invariant #1 — najważniejsza reguła produktu:** język każdej komunikacji (e-mail,
powiadomienie) = **język ODBIORCY**, nigdy nadawcy, sesji, przeglądarki nadawcy ani
domyślny serwera.

Implementacja: `@/lib/i18n/recipient-locale` → `resolveRecipientLocale(recipient)`.

```
resolveRecipientLocale({ preferred_locale, account_locale, signup_locale })
  = pierwsza wartość z listy należąca do ['pl','nl','fr','en']:
      preferred_locale  →  account_locale  →  signup_locale  →  'en'
```

- Wartości spoza `['pl','nl','fr','en']` są ignorowane (kolumny w DB mają CHECK,
  ale util i tak filtruje defensywnie).
- `preferred_locale` = świadomy wybór użytkownika; `account_locale` = język UI przy
  ostatniej zmianie ustawień; `signup_locale` = język w chwili rejestracji (niezmienny).
- Wyznaczony locale zapisywany jest w `email_deliveries.locale` — worker renderuje
  szablon React Email dokładnie w tym języku.

```
   pracodawca (UI: NL)  ── aplikuje kandydat (profil PL) ──►  e-mail do pracodawcy: NL
   pracodawca (UI: NL)  ── wysyła propozycję do kandydata ──► e-mail do kandydata:  PL
```

Test: `tests/unit/recipient-locale.test.ts`.

---

## 6. Matching (deterministyczny)

`@/lib/matching/score` → `scoreMatch(candidate, job): MatchResult`. **Bez
niekontrolowanego AI** przy decyzjach — czysta, testowalna funkcja. Suma 100 pkt:

| kryterium | pkt |
|---|---|
| zawód + kategoria | 20 |
| umiejętności | 20 |
| lokalizacja (promień) | 15 |
| doświadczenie | 10 |
| dostępność | 10 |
| język | 10 |
| certyfikaty | 5 |
| transport / prawo jazdy | 5 |
| warunki umowy | 5 |

Zwraca `score` (%), listy `matched`/`missing`/`strengths`, licznik wymagań obowiązkowych
(`mandatoryMet`/`mandatoryTotal`) i `summaryKey ∈ {good, partial, low}` (klucz do
tłumaczenia wyjaśnienia). Wyniki cache'owane w tabeli `matches` (`UNIQUE(candidate_id, job_id)`).

---

## 7. Model danych

UUID PK wszędzie, `created_at`/`updated_at` (trigger `set_updated_at`), soft-delete
(`deleted_at`) tam gdzie sensowne, FK z kontrolowanym `ON DELETE`, statusy jako enumy,
`is_demo` na danych treściowych (Invariant #12). DDL: `supabase/migrations/0001–0010`.

### Grupy tabel i relacje

```
auth.users (Supabase Auth)
   └─1:1─ profiles (role, *_locale)                        [trigger handle_new_user]
            ├─1:1─ candidate_profiles ──1:N─ candidate_skills / candidate_languages
            │                                / candidate_certificates
            ├─1:1─ employer_profiles ──N:1─ companies (primary_company_id)
            └─1:N─ company_members ──N:1─ companies (role: owner/admin/recruiter/member)

companies ──1:N─ jobs ──1:N─ job_translations (per locale)
                     ├─1:N─ job_requirements (mandatory/optional)
                     └─1:N─ job_skills ──N:1─ skills

Słowniki: categories · occupations · skills · languages · certificates · locations

Procesy:
   applications  (UNIQUE candidate_id,job_id) ──1:N─ application_status_history
   matches       (UNIQUE candidate_id,job_id)      [cache scoreMatch]
   offers        (idempotency_key UNIQUE NOT NULL) ──1:N─ offer_status_history
   saved_jobs    (UNIQUE candidate_id,job_id)

Komunikacja:
   conversations ──1:N─ conversation_members
                 └─1:N─ messages
   notifications · notification_preferences (1:1 profil) · email_deliveries

Pliki/zgody/zgłoszenia: files · consents · consent_versions · reports
Płatności:              subscriptions · invoices · payments · discount_codes
Audyt:                  audit_logs · system_events
```

### Kluczowe enumy statusów

| enum | wartości |
|---|---|
| `application_status` | draft, submitted, viewed, shortlisted, interview, offer_sent, offer_accepted, offer_declined, rejected, withdrawn, hired |
| `offer_status` | draft, sent, viewed, accepted, declined, expired, cancelled |
| `company_status` | unverified, pending, verified, rejected, suspended |
| `job_status` | draft, active, paused, closed, expired |
| `email_status` | queued, sent, delivered, opened, clicked, bounced, complained, failed |

### Idempotencja w schemacie

- `applications`: `UNIQUE(candidate_id, job_id)` + partial unique na `idempotency_key`.
- `offers`: `idempotency_key text NOT NULL UNIQUE`.
- `email_deliveries`: partial unique na `idempotency_key` oraz na `provider_message_id`.
- `saved_jobs`, `candidate_skills/languages/certificates`, `company_members` — unikaty
  chroniące przed duplikatami.

---

## 8. Role i uprawnienia (RLS + walidacja)

Egzekwowane **dwuwarstwowo**: Row Level Security w Postgres (granica twarda) + walidacja
w Server Actions (UX, komunikaty błędów). Domyślnie **deny** — tabela bez pasującej
polityki jest niedostępna dla `anon`/`authenticated`.

### Poziomy dostępu Supabase

| rola | opis | zakres |
|---|---|---|
| `anon` | niezalogowany | tylko dane publiczne (aktywne oferty, słowniki) |
| `authenticated` | zalogowany (`auth.uid()`) | własne dane + publiczne |
| `service_role` | backend (admin client) | omija RLS (`BYPASSRLS`) |

### Role aplikacyjne (`profiles.role`, enum `user_role`)

`candidate` · `employer` · `admin` · `moderator`. Role wewnątrz firmy w
`company_members.role` (enum `company_member_role`): `owner` · `admin` · `recruiter` · `member`.

### Zasady

- **Kandydat:** edytuje wyłącznie własne dane; widzi własne aplikacje/propozycje/wiadomości.
- **Pracodawca/członek firmy:** dostęp tylko do danych własnej firmy; wymaga aktywnego
  `company_members`. Firma A nie widzi danych firmy B.
- **Publikacja oferty** (`status='active'`) wymaga firmy `verified`.
- **Admin:** operacje wrażliwe przez kod serwerowy (service role); każda → `audit_logs`.

### Funkcje pomocnicze RLS (SECURITY DEFINER, omijają RLS — brak rekurencji polityk)

`is_company_member(company_id)` · `is_company_admin(company_id)` ·
`company_is_verified(company_id)` · `is_job_company_member(job_id)` ·
`job_is_public(job_id)` · `owns_candidate_profile(candidate_profile_id)`.
Wszystkie `stable` + `set search_path = public`.

### Tabele bez polityk (celowo — dostęp tylko service role)

`audit_logs`, `system_events`, `email_deliveries`, `discount_codes`. RLS włączone,
brak polityk = deny dla anon/authenticated; backend czyta przez service role.

---

## 9. i18n i SEO

- Routing z prefiksem locale: `/pl`, `/nl`, `/fr`, `/en` (next-intl + `src/middleware.ts`).
- Teksty wyłącznie w `src/messages/{pl,nl,fr,en}.json` (Invariant #2 — zero literałów w JSX).
- `hreflang` + kanoniczne linki per język; `sitemap.ts` (tylko publiczne), `robots.ts`.
- Panele (`candidate/*`, `employer/*`, `admin/*`) i staging: `noindex` + poza sitemap
  (Invariant #9).
- Oferty: `JobPosting` JSON-LD; poradniki: `Article` JSON-LD.

---

## 10. Obsługa błędów i monitoring

- Centralny `AppError` (`@/lib/errors`) z kodem (`ErrorCode`) i `userMessageKey`
  (klucz tłumaczenia). Kody: `AUTH_INVALID_CREDENTIALS`, `PERMISSION_DENIED`,
  `VALIDATION_FAILED`, `JOB_NOT_ACTIVE`, `APPLICATION_ALREADY_EXISTS`,
  `OFFER_ALREADY_EXISTS`, `OFFER_SEND_FAILED`, `EMAIL_DELIVERY_FAILED`, `RATE_LIMITED`,
  `COMPANY_NOT_VERIFIED`, `NOT_FOUND`, `INTERNAL`.
- Użytkownik **nigdy** nie widzi stack trace / SQL / surowej odpowiedzi dostawcy
  (Invariant #8) — tylko komunikat z klucza tłumaczenia.
- Sentry: client + server + edge (`@/lib/sentry`), source maps uploadowane w CI
  (`SENTRY_AUTH_TOKEN`).

---

## 11. Powiązane dokumenty

- [`SUPABASE_SETUP.md`](./SUPABASE_SETUP.md) — projekt, klucze, migracje, Storage, Auth, RLS.
- [`RESEND_SETUP.md`](./RESEND_SETUP.md) — domena/DNS, kolejka e-mail, ponawianie.
- [`DEPLOYMENT.md`](./DEPLOYMENT.md) · [`STAGING.md`](./STAGING.md) · [`DOMAIN_SETUP.md`](./DOMAIN_SETUP.md).
- [`SECURITY_CHECKLIST.md`](./SECURITY_CHECKLIST.md) · [`PERFORMANCE_CHECKLIST.md`](./PERFORMANCE_CHECKLIST.md) · [`LAUNCH_CHECKLIST.md`](./LAUNCH_CHECKLIST.md).
- [`SELF_HOSTED_RUNNERS.md`](./SELF_HOSTED_RUNNERS.md) — CI/CD.
</content>
</invoke>
