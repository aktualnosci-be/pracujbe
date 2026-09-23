# Pracuj.be

Nowoczesna, wielojęzyczna platforma rekrutacyjna dla Belgii.
**„Znajdź pracę w Belgii szybko i bez zbędnych formalności."**

Kandydat tworzy prosty **profil zawodowy zamiast CV**; pracodawca publikuje oferty i wysyła
propozycje pracy. Interfejs w **PL / NL / FR / EN**.

> 📘 **Kontynuujesz pracę nad projektem (człowiek lub model)?** Zacznij od [`CLAUDE.md`](./CLAUDE.md) —
> to mapa i kontrakt projektu: architektura, niezmienne reguły, status i roadmapa etapów 1–8.

---

## Stack

Next.js 15 (App Router, React Server Components) · TypeScript `strict` · Tailwind CSS + shadcn/ui ·
Supabase (przejściowo) · PostgreSQL Railway · Zod · React Hook Form · Resend + React Email ·
Sentry · Vitest + Playwright · Railway.

**CI działa na GitHub-hosted runnerach (`ubuntu-latest`), a produkcję z `main` wdraża Railway po zielonym CI** —
patrz [`docs/DEPLOYMENT.md`](./docs/DEPLOYMENT.md).

Migracja backendu, bazy, logowania i prywatnych plików do Railway nadal trwa.
Skonfigurowana ścieżka wdrożenia nie oznacza jeszcze gotowości produkcyjnej portalu.

## Szybki start

```bash
# 1. Zależności
npm install

# 2. Zmienne środowiskowe
cp .env.example .env.local
#   uzupełnij klucze Supabase / Resend / Sentry (patrz docs/SUPABASE_SETUP.md, docs/RESEND_SETUP.md)

# 3. Baza (lokalnie, wymaga Supabase CLI)
#   supabase start
#   supabase db reset            # zastosuje migracje z supabase/migrations + seed.sql

# 4. Dev
npm run dev                       # http://localhost:3000  (przekierowuje na /pl)
```

Bez skonfigurowanego Supabase aplikacja nadal się buduje i renderuje strony publiczne
z danymi demonstracyjnymi (fallback) — dzięki temu CI/build przechodzi bez sekretów.

## Skrypty

| komenda | opis |
|---|---|
| `npm run dev` | serwer deweloperski |
| `npm run build` | build produkcyjny |
| `npm run start` | serwer produkcyjny |
| `npm run lint` | ESLint |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run test` | testy jednostkowe (Vitest) |
| `npm run test:e2e` | testy e2e (Playwright) |
| `npm run verify` | lint + typecheck + test — **uruchom przed commitem** |

## Struktura

Patrz [`CLAUDE.md` → „Struktura katalogów"](./CLAUDE.md). Skrótowo:
`src/app/[locale]` (strony) · `src/lib` (supabase, i18n, matching, email, errors) ·
`src/messages` (tłumaczenia) · `src/emails` (React Email) · `supabase/migrations` (SQL) ·
`tests` (unit + e2e) · `docs` (setup + checklisty).

## Dokumentacja

- [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) — architektura i decyzje
- [`docs/SELF_HOSTED_RUNNERS.md`](./docs/SELF_HOSTED_RUNNERS.md) — konfiguracja runnerów CI
- [`docs/SUPABASE_SETUP.md`](./docs/SUPABASE_SETUP.md) · [`docs/RESEND_SETUP.md`](./docs/RESEND_SETUP.md)
- [`docs/DEPLOYMENT.md`](./docs/DEPLOYMENT.md) · [`docs/railway/README.md`](./docs/railway/README.md)
- [`docs/SECURITY_CHECKLIST.md`](./docs/SECURITY_CHECKLIST.md) · [`docs/PERFORMANCE_CHECKLIST.md`](./docs/PERFORMANCE_CHECKLIST.md) · [`docs/LAUNCH_CHECKLIST.md`](./docs/LAUNCH_CHECKLIST.md)

## Licencja

Prywatny projekt Pracuj.be. Wszelkie prawa zastrzeżone.
