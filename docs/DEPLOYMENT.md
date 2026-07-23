# Wdrożenie (Vercel)

Jak wdrożyć Pracuj.be na Vercel: import repo, zmienne środowiskowe per środowisko, build,
powiązanie z `.github/workflows/deploy.yml` (self-hosted) oraz migracje przy wdrożeniu.

Środowiska: **production** (`main` → `pracuj.be`) i **staging/preview** (`develop` →
[`STAGING.md`](./STAGING.md)). Domena: [`DOMAIN_SETUP.md`](./DOMAIN_SETUP.md).

---

## 1. Model wdrożeń

```
push na `develop`  ──► deploy.yml (self-hosted) ──► Vercel PREVIEW  (staging, noindex)
push na `main`     ──► deploy.yml (self-hosted) ──► Vercel PRODUCTION (pracuj.be)
Pull Request       ──► ci.yml (lint/typecheck/unit/e2e/build), bez deployu prod
```

- **CI** (`.github/workflows/ci.yml`): install → lint → typecheck → unit → build + e2e.
  Build przechodzi **bez sekretów** (strony publiczne mają fallback demo).
- **Deploy** (`.github/workflows/deploy.yml`): `vercel pull` → `vercel build` →
  `vercel deploy --prebuilt`; wariant `--prod` dla `main`, preview dla pozostałych.
- Oba workflowy działają na **self-hosted runnerach** (`runs-on: [self-hosted, linux, x64]`).
  Nie zmieniaj na `ubuntu-latest` (patrz [`SELF_HOSTED_RUNNERS.md`](./SELF_HOSTED_RUNNERS.md)).

---

## 2. Import repozytorium do Vercel

1. [vercel.com](https://vercel.com) → **Add New… → Project** → import `aktualnosci-be/pracujbe`.
2. Framework preset: **Next.js** (wykrywany automatycznie).
3. Build & Output (domyślne dla Next.js):
   - Build command: `next build` (lub `npm run build`).
   - Install command: `npm ci`.
   - Node: 22 (z `.nvmrc`; ustaw w Project Settings → Node.js Version, jeśli trzeba).
4. Po utworzeniu projektu odczytaj **Project ID** i **Org ID** (Settings → General) —
   potrzebne dla CI (§5).

> Deploy właściwy prowadzi `deploy.yml` przez Vercel CLI (`--prebuilt`). Auto-deploy
> z Git w Vercel możesz zostawić lub wyłączyć — jeśli zostawisz, unikaj podwójnych
> deployów (jedno źródło prawdy: workflow LUB integracja Git, nie oba dla tych samych gałęzi).

---

## 3. Zmienne środowiskowe per środowisko

Vercel → **Settings → Environment Variables**. Ustaw osobno dla **Production** i
**Preview** (staging). Zmienne `NEXT_PUBLIC_*` są wstrzykiwane do bundle'a w czasie
builda — **nie umieszczaj tam sekretów**.

| zmienna | Production | Preview (staging) | typ |
|---|---|---|---|
| `NEXT_PUBLIC_SITE_URL` | `https://pracuj.be` | `https://staging.pracuj.be` | public |
| `NEXT_PUBLIC_DEFAULT_LOCALE` | `pl` | `pl` | public |
| `NEXT_PUBLIC_SUPABASE_URL` | projekt PROD | projekt STAGING | public |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | PROD | STAGING | public |
| `SUPABASE_SERVICE_ROLE_KEY` | PROD | STAGING | **sekret** |
| `RESEND_API_KEY` | PROD | STAGING | **sekret** |
| `EMAIL_FROM` | `Pracuj.be <no-reply@pracuj.be>` | np. `Pracuj.be [staging] <…>` | zwykła |
| `EMAIL_REPLY_TO` | `kontakt@pracuj.be` | j.w. | zwykła |
| `EMAIL_QUEUE_SECRET` | silny sekret | inny sekret | **sekret** |
| `NEXT_PUBLIC_SENTRY_DSN` | DSN | DSN | public |
| `SENTRY_ORG` / `SENTRY_PROJECT` | ustaw | ustaw | zwykła |
| `SENTRY_AUTH_TOKEN` | tylko build/CI | j.w. | **sekret** |
| `NEXT_PUBLIC_GA_MEASUREMENT_ID` | prod GA | puste/test | public |
| `NEXT_PUBLIC_CONSENT_POLICY_VERSION` | np. `1.0` | `1.0` | public |

Zasady:
- **Osobne projekty Supabase i klucze** dla prod i staging — nigdy współdzielone.
- Sekrety trzymaj tylko w Vercel (i w GitHub Secrets dla CI) — nie w repo.
- Po zmianie zmiennych zredeployuj (build wczytuje env w momencie builda).

---

## 4. Build i tryb bez env

`next build` MUSI przechodzić bez zmiennych Supabase/Resend — strony publiczne używają
fallbacku demo (`@/lib/data/demo`), a klienci Supabase czytają env leniwie. To gwarantuje,
że CI i preview budują się nawet bez pełnej konfiguracji. Konfiguracja `next.config.mjs`
(obrazy AVIF/WebP, `optimizePackageImports`, brak `poweredByHeader`) jest gotowa — nie modyfikuj.

---

## 5. Sekrety CI/CD (GitHub Actions)

`deploy.yml` używa Vercel CLI. Ustaw w **GitHub → Settings → Secrets and variables →
Actions** (repo lub organizacja):

| sekret | opis |
|---|---|
| `VERCEL_TOKEN` | token API Vercel (Account → Tokens) |
| `VERCEL_ORG_ID` | Org ID z Vercel |
| `VERCEL_PROJECT_ID` | Project ID z Vercel |
| `SENTRY_AUTH_TOKEN` | (opcjonalnie) upload source maps przy buildzie |

`deploy.yml` mapuje środowisko GitHub: `main` → `production`, pozostałe → `staging`
(sekcja `environment:`). Możesz dodać **required reviewers** dla environment `production`
(GitHub → Settings → Environments) jako bramkę ręcznej akceptacji przed deployem prod.

---

## 6. Migracje przy wdrożeniu

Migracje bazy są **niezależne** od deployu aplikacji i wykonywane **przyrostowo** przez
Supabase CLI (`supabase db push`) — patrz [`SUPABASE_SETUP.md`](./SUPABASE_SETUP.md) §4.

Kolejność bezpiecznego wdrożenia zmian wymagających migracji:

```
1. Napisz migrację (idempotentną, wstecznie zgodną gdy to możliwe).
2. Zastosuj na STAGING:  supabase link (staging) → supabase db push  → test e2e.
3. Zastosuj na PROD:     supabase link (prod)    → supabase db push.
4. Deploy aplikacji (push na main → deploy.yml).
```

Zasady:
- **Zero-downtime:** preferuj migracje wstecznie zgodne (dodawaj kolumny nullable/z defaultem,
  usuwaj dopiero po wdrożeniu kodu, który przestał ich używać). Rozdzielaj „expand" i „contract".
- **NIGDY `supabase db reset` na produkcji** (destrukcyjny). Tylko `db push`.
- Migracje możesz stosować ręcznie (operator) lub w osobnym, chronionym kroku CI z
  `SUPABASE_DB_URL`/service credentials jako sekretem — nie w publicznym buildzie.
- **Seed off na produkcji** — `seed.sql` tylko lokalnie/staging.

---

## 7. Po deployu — weryfikacja

- Strona główna i lista ofert renderują się (SSR) w każdym języku (`/pl`, `/nl`, `/fr`, `/en`).
- Panele (`/candidate`, `/employer`, `/admin`) mają `noindex` i wymagają sesji.
- Rejestracja/logowanie działają na prawdziwej bazie (Supabase Auth).
- Aplikacja na ofertę → wpis w `applications` + rekord `email_deliveries(queued)`.
- Dispatcher kolejki wysyła e-mail (sprawdź `status='sent'`).
- Sentry odbiera zdarzenia (wywołaj celowy błąd testowy na staging).
- Pełna lista: [`LAUNCH_CHECKLIST.md`](./LAUNCH_CHECKLIST.md).

---

## 8. Rollback

- **Aplikacja:** Vercel → Deployments → wybierz poprzedni udany deploy → **Promote to
  Production** (natychmiastowy rollback). Albo `git revert` + push na `main`.
- **Baza:** migracje są przyrostowe — przygotuj migrację odwracającą zmianę (down),
  jeśli konieczne. Backup/PITR (Supabase Pro) jako ostateczność.

---

## 9. Powiązane

- [`STAGING.md`](./STAGING.md) · [`DOMAIN_SETUP.md`](./DOMAIN_SETUP.md) ·
  [`SELF_HOSTED_RUNNERS.md`](./SELF_HOSTED_RUNNERS.md).
- [`SUPABASE_SETUP.md`](./SUPABASE_SETUP.md) · [`RESEND_SETUP.md`](./RESEND_SETUP.md).
</content>
