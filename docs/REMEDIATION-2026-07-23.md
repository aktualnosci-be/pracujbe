# Remediacja audytu z 2026-07-23

> **ARCHIWALNE — stan sprzed migracji na Railway (#27).** Zapis remediacji z lipca 2026 na stosie Supabase; bieżąca architektura: [`ARCHITECTURE.md`](./ARCHITECTURE.md), [`railway/README.md`](./railway/README.md).

Odpowiedź na `docs/audit/audyt-2026-07-23.md`. Status: **fixed** = naprawione i zweryfikowane,
**partial** = częściowo (reszta w roadmapie), **deferred** = świadomie odłożone (budowa funkcji, nie luka).

## Weryfikacja wykonana lokalnie (czego audytor nie mógł zrobić)

Audytor nie miał dostępu do `npm`/Postgresa. Tutaj **uruchomiono realnie**:

- `npm run lint` → **0 błędów**; `npm run typecheck` → **0 błędów**; `npm run test` → **16/16**; `npm run build` → **OK** (pl/nl/fr/en).
- **Wszystkie migracje 0001–0011 aplikują się czysto od zera** na PostgreSQL 16 (z minimalnymi shimami Supabase: `auth.uid()`, role `anon`/`authenticated`).
- **Testy adwersaryjne RLS** (rola `authenticated`, symulowany atakujący) — patrz „Dowód" przy P0/P1 niżej.

## P0 — krytyczne

| ID | Ustalenie | Status | Co zrobiono |
|---|---|---|---|
| P0-01 | Przejęcie dowolnej firmy + samo-weryfikacja | **fixed** | `0011`: zdjęty otwarty INSERT `companies`; `company_members` INSERT tylko dla `is_company_admin`; trigger `protect_company_verification` (status/verified_* nietykalne dla klienta); RPC `create_company_with_owner` (status wymuszony `unverified`). Test: atakujący nie dołącza do firmy; członek nie zmienia statusu. |
| P0-02 | Publiczne profile kandydatów (default) | **fixed** (widok kolumnowy: partial) | `0011`: `is_searchable default false`; publiczny SELECT wymaga `profile_completed=true`; istniejące niekompletne wyłączone. Test: nowy profil niewidoczny dla anon. TODO(roadmap): dedykowany widok bez kolumn prywatnych. |
| P0-03 | Fałszowanie aplikacji | **fixed** | `0011`: trigger `enforce_application_integrity` wymusza `candidate_id=auth.uid()`, `company_id` z oferty, status ∈ {draft,submitted}; niezmienne FK; kandydat może tylko `withdrawn`. Auto-historia + zakaz ręcznego insertu historii. Test: `hired`/podmiana `candidate_id` zablokowane; `withdrawn` dozwolone. |
| P0-04 | Propozycje bez autoryzacji/idempotencji | **fixed** (pełny outbox: deferred) | `0011`: trigger `enforce_offer_integrity` — verified company + active job + członkostwo + `sender_id`/`company_id` wyliczone; kandydat tylko accept/decline; `UNIQUE(idempotency_key)` blokuje duplikat; auto-historia. Test: nie-członek zablokowany, pola wyliczane, duplikat odrzucony. TODO(roadmap): Server Action `sendOffer` + kolejka e-mail. |
| P0-05 | „Wadliwy root layout / build" | **not-a-defect** | To udokumentowany wzorzec next-intl (root przepuszcza `children`, `<html lang>` w `[locale]/layout`). `npm run build` **przechodzi** — potwierdzone. Bez zmian. |

## P1 — wysokie

| ID | Ustalenie | Status | Co zrobiono |
|---|---|---|---|
| P1-01 | Callback Auth łapany przez middleware | **fixed** | `src/middleware.ts`: `auth` dodane do wykluczeń matchera. |
| P1-02 | Eskalacja `profiles.role` | **fixed** | `0011`: trigger `protect_profiles_privileged` blokuje zmianę `role/is_active/deleted_at/signup_locale` przez użytkownika. Test: eskalacja do `admin` zablokowana. |
| P1-05 | Ciche demo maskujące awarie | **fixed** | `src/lib/jobs.ts`: przy skonfigurowanej bazie błąd → `captureError` (Sentry) + `AppError('INTERNAL')` (kontrolowany błąd), zamiast fikcyjnych ofert. Demo tylko gdy brak konfiguracji. |
| P1-07 | Fałszowanie matchingu | **fixed** | `0011`: zdjęte polityki `matches_insert_own`/`matches_update_own` (zapis tylko backend). Test: zapis przez klienta zablokowany. |
| P1-10 | CTA prowadzą do 404 | **fixed** (główne) | `Header`/`MobileNav`/`Footer`/detal: `/jobs→/oferty-pracy`, `/login→/logowanie`, `/post-job→/rejestracja-pracodawca`; niezbudowane pozycje nawigacji usunięte. TODO(roadmap): strony treściowe/legal + centralna mapa `pathnames`. |
| P1-11 | Deploy bez bramki jakości | **fixed** | `deploy.yml`: `workflow_run` po CI, `conclusion == 'success'`, checkout dokładnego `head_sha`. |
| P1-12 | Staging bez pełnego noindex | **fixed** | `sitemap.ts` pusty w non-prod; `next.config.mjs` `X-Robots-Tag: noindex` dla non-prod (obok `robots.ts`). |
| P1-14 | Wstrzykiwanie uczestników rozmów | **fixed** | `0011`: `conversation_members` INSERT tylko `profile_id=auth.uid()`. Test: dopisanie cudzego profilu zablokowane. |
| P1-03 | Publiczne pełne kolumny firm/ofert | **partial/deferred** | Ryzyko realne. TODO(roadmap): widoki `public_companies`/`public_jobs` + revoke SELECT z tabel bazowych. (Nie blokuje: dane wrażliwe firm nie są jeszcze wprowadzane.) |
| P1-04 | Warstwa odczytu ofert niezgodna ze schematem | **deferred** | Dotyczy trybu z realną bazą (dziś fallback demo). TODO(roadmap): widok/RPC `public_jobs` z relacjami + walidacja Zod. |
| P1-06 | Historia statusów jako ślad audytowy | **fixed** | `0011`: auto-historia w triggerze (`log_application_status`/`log_offer_status`), zakaz ręcznego insertu historii przez klienta. |
| P1-08 / P1-09 | Cookies: revoke trackerów / serwerowy dowód zgody | **deferred** | TODO(roadmap): Consent Mode + `ga-disable`/`fbq revoke` przy wycofaniu; Server Action zapisu zgód zgodna ze schematem `consents`. |
| P1-13 | Platforma e-mail to scaffold | **deferred** | TODO(roadmap): outbox (`enqueueEmail`, worker, retry, `attempts`/`last_error`), integracja Resend, testy 4 locale. |

## P2/P3 — wybrane

| ID | Status | Uwaga |
|---|---|---|
| P2-01 nagłówki bezpieczeństwa | **partial** | Dodane `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`, HSTS(prod). TODO: pełna CSP (nonce/allowlist). |
| P2-03 sitemap/canonical | **partial** | Sitemap ograniczony do tras 200; canonical filtrów — TODO. |
| P2-06 paleta granatowa | **partial** | Tokeny: `--primary #0F2A47`, dodany `--accent #2563EB`, `manifest theme_color`. Pełny redesign 7 ekranów — roadmap. |
| P2-08 pin Vercel CLI | **fixed** | `deploy.yml`: `vercel@56.5.0`. |
| P3-02 `server-only` w admin.ts | **fixed** | Dodano `import 'server-only'` + zależność. |
| P3-04 nieaktualna roadmapa | **fixed** | `CLAUDE.md` §11 zaktualizowana (schema/scaffold/backend/tested rozdzielone). |

## Świadomie odłożone (budowa funkcji, nie luki) — w roadmapie

Panele kandydata/pracodawcy, onboarding, kreator ofert, wiadomości UI, powiadomienia,
admin, płatności, Storage signed URLs, pełny outbox e-mail, redesign 7 ekranów, testy
integracyjne RLS w CI (na osobnym Supabase), Lighthouse/CWV, PWA (ikony/SW).

## Jak zweryfikowano poprawki bezpieczeństwa

`supabase/migrations/0011_security_hardening.sql` zastosowano na realnym PostgreSQL 16
i przeprowadzono testy adwersaryjne jako rola `authenticated` (symulowany `auth.uid()`
atakującego). Wszystkie próby nadużyć (P0-01..04, P1-02/07/14) zostały **zablokowane**,
a legalne operacje (wycofanie aplikacji, akceptacja propozycji, bootstrap firmy przez RPC,
idempotencja, auto-historia) — **przeszły**.
