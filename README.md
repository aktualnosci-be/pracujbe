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
PostgreSQL Railway (RLS) · Better Auth · prywatny bucket Railway (CV) · Zod · React Hook Form ·
EmailLabs/Resend + React Email · webhook błędów (Discord) · Vitest + Playwright · Railway.
Supabase usunięte z runtime (#27); katalog `supabase/` zawiera już tylko migracje SQL i testy RLS
(nazwa historyczna).

**CI działa na GitHub-hosted runnerach (`ubuntu-latest`), a produkcję z `main` wdraża Railway po zielonym CI** —
patrz [`docs/DEPLOYMENT.md`](./docs/DEPLOYMENT.md).

Kod działa na PostgreSQL Railway, Better Auth i buckecie Railway; stan przełączenia produkcji
i otwarte kroki właściciela: [`docs/railway/STATUS.md`](./docs/railway/STATUS.md). Skonfigurowana
ścieżka wdrożenia nie oznacza jeszcze gotowości produkcyjnej portalu.

## Szybki start

```bash
# 1. Zależności
npm install

# 2. Zmienne środowiskowe
cp .env.example .env.local
#   bez zmiennych bazy działa tryb demo; pełna lista: .env.example,
#   docs/railway/KONFIGURACJA_PRODUKCJI.md, docs/EMAILLABS_SETUP.md, docs/RESEND_SETUP.md

# 3. Baza (opcjonalnie, lokalny PostgreSQL 16)
#   npm run test:rls             # migracje od zera + testy RLS na lokalnym PostgreSQL
#   migracje na wskazanej bazie: npm run db:migrate:production (docs/railway/MIGRACJE_POSTGRESQL.md)

# 4. Dev
npm run dev                       # http://localhost:3000  (przekierowuje na /pl)
```

Bez skonfigurowanej bazy (`DATABASE_*`) aplikacja nadal się buduje i renderuje strony publiczne
z danymi demonstracyjnymi (fallback) — dzięki temu CI/build przechodzi bez sekretów. W trybie
`APP_MODE=production` brak konfiguracji daje 503, nie tryb demo.

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
`src/app/[locale]` (strony) · `src/lib` (db, auth, files, i18n, matching, email, errors) ·
`src/messages` (tłumaczenia) · `src/emails` (React Email) · `supabase/migrations` (SQL; nazwa katalogu historyczna) ·
`tests` (unit + e2e) · `docs` (setup + checklisty).

## Dokumentacja

- [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) — architektura i decyzje
- [`docs/DEPLOYMENT.md`](./docs/DEPLOYMENT.md) · [`docs/railway/README.md`](./docs/railway/README.md) · [`docs/railway/STATUS.md`](./docs/railway/STATUS.md)
- [`docs/railway/WARSTWA_DANYCH.md`](./docs/railway/WARSTWA_DANYCH.md) · [`docs/railway/MIGRACJE_POSTGRESQL.md`](./docs/railway/MIGRACJE_POSTGRESQL.md)
- [`docs/EMAILLABS_SETUP.md`](./docs/EMAILLABS_SETUP.md) · [`docs/RESEND_SETUP.md`](./docs/RESEND_SETUP.md)
- [`docs/SECURITY_CHECKLIST.md`](./docs/SECURITY_CHECKLIST.md) · [`docs/PERFORMANCE_CHECKLIST.md`](./docs/PERFORMANCE_CHECKLIST.md) · [`docs/LAUNCH_CHECKLIST.md`](./docs/LAUNCH_CHECKLIST.md)
- Archiwalne: [`docs/SUPABASE_SETUP.md`](./docs/SUPABASE_SETUP.md) (stan sprzed #27), [`docs/SELF_HOSTED_RUNNERS.md`](./docs/SELF_HOSTED_RUNNERS.md) (CI przed 2026-09-23)

## Licencja

Prywatny projekt Pracuj.be. Wszelkie prawa zastrzeżone.
