# Plan migracji Pracuj.be z Vercel na Railway

**Repozytorium:** `aktualnosci-be/pracujbe`  
**Stack:** Next.js 15 / React 19 / Node 22 / Supabase / Resend / Stripe / Sentry  
**Cel:** Railway Pro jako hosting aplikacji i zadań cyklicznych, bez migracji Supabase  
**Status dokumentu:** plan implementacyjny do wykonania w repo

---

## 1. Decyzja architektoniczna

Pracuj.be nie wymaga przepisywania backendu ani bazy danych. Migracja ma dotyczyć **warstwy uruchomieniowej i deploymentu**, nie modelu danych.

### Zostaje bez zmian

- Next.js 15 App Router,
- React 19,
- Supabase PostgreSQL,
- Supabase Auth,
- Supabase Storage,
- Supabase RLS i RPC,
- kolejka e-mail w tabeli `email_deliveries`,
- Resend,
- Stripe,
- Sentry,
- obecne migracje Supabase,
- obecne mechanizmy idempotencji,
- obecny model aplikacji produkcyjnej i staging.

### Z Vercel na Railway przenosimy

- runtime Next.js,
- build i deployment,
- custom domain,
- healthcheck,
- automatyczne wdrożenia z GitHuba,
- cron przetwarzający kolejkę e-mail,
- cron maintenance,
- ewentualne przyszłe cron-y retencji/GC.

### Nie dodajemy na tym etapie

- Railway PostgreSQL,
- Redis,
- Railway Volume,
- Cloudflare R2,
- osobnego API,
- osobnego workera kolejki działającego 24/7,
- Dockera, jeżeli Railpack poprawnie buduje projekt.

Supabase pozostaje zewnętrznym backendem danych. Railway nie powinien dublować jego funkcji.

---

# 2. Docelowa architektura Railway

W jednym projekcie Railway utworzyć następujące usługi:

```text
Railway project: pracujbe
│
├── environment: production
│   ├── web
│   ├── cron-email
│   └── cron-maintenance
│
└── environment: staging
    ├── web
    ├── cron-email
    └── cron-maintenance
```

Docelowy przepływ:

```text
Internet
   │
   ▼
pracuj.be
   │
   ▼
Railway Edge / TLS
   │
   ▼
┌───────────────────────┐
│ web                   │
│ Next.js 15 / Node 22  │
└───────────┬───────────┘
            │
            ├──────────────► Supabase
            │                ├─ PostgreSQL
            │                ├─ Auth
            │                ├─ Storage
            │                └─ RLS / RPC
            │
            ├──────────────► Resend
            ├──────────────► Stripe
            └──────────────► Sentry

Railway cron-email
   │ prywatna sieć Railway
   └────────► web/api/email/process

Railway cron-maintenance
   │ prywatna sieć Railway
   └────────► web/api/maintenance
```

**Tylko `web` otrzymuje publiczną domenę.** `cron-email` i `cron-maintenance` nie powinny mieć public domains.

---

# 3. Najważniejsza zasada migracji

Nie robić „big rewrite”.

Migracja powinna zostać wykonana w dwóch warstwach:

1. **minimalna adaptacja kodu do hostingu niezależnego od Vercela,**
2. **konfiguracja Railway i dopiero później usunięcie Vercela.**

Przez cały okres migracji obecna wersja na Vercel ma pozostać możliwa do szybkiego przywrócenia.

---

# 4. Etap 0 — utworzyć branch migracyjny

Utworzyć osobną gałąź:

```bash
git checkout -b infra/railway
```

Nie mieszać migracji Railway z funkcjonalnymi zmianami aplikacji.

Przed rozpoczęciem zapisać jako punkt odniesienia:

```bash
npm ci
npm run lint
npm run typecheck
npm run test
npm run build
npm run test:e2e
```

Migracja jest zakończona dopiero wtedy, gdy ten sam zestaw testów przechodzi po zmianach.

---

# 5. Etap 1 — usunąć zależność logiki aplikacji od Vercela

## 5.1. `APP_MODE` ma być jedynym źródłem informacji o trybie aplikacji

Obecnie `src/lib/env.ts` zawiera fallback:

```ts
return process.env.VERCEL_ENV === 'production' ? 'production' : 'demo';
```

Po migracji usunąć zależność od `VERCEL_ENV`.

Docelowo:

```ts
get appMode(): 'production' | 'demo' {
  const mode = process.env.APP_MODE;
  return mode === 'production' ? 'production' : 'demo';
}
```

Nie próbować automatycznie zgadywać produkcji na podstawie Railway.

**Produkcja ma być jawna:**

```env
APP_MODE=production
```

To zachowuje obecny mechanizm fail-closed.

### Staging

Na Railway staging również zalecane:

```env
APP_MODE=production
NEXT_PUBLIC_SITE_URL=https://staging.pracuj.be
```

Dzięki temu staging:

- korzysta z prawdziwego staging Supabase,
- fail-closed działa tak samo jak produkcja,
- brakujące sekrety powodują błąd zamiast cichego przejścia na dane demo,
- `isProductionDeployment()` nadal rozpozna `staging.pracuj.be` jako środowisko niepubliczne i utrzyma `noindex`.

Tryb `demo` pozostawić dla lokalnego developmentu i świadomych środowisk demo.

---

## 5.2. `next.config.mjs`

Usunąć z wykrywania produkcji:

```js
process.env.VERCEL_ENV === 'production'
```

Zostawić jawne:

```js
const isProdMode = process.env.APP_MODE === 'production';
```

### Jednocześnie naprawić limit uploadu CV

Repo deklaruje:

```ts
const MAX_BYTES = 5 * 1024 * 1024;
```

ale upload jest wykonywany przez Server Action. Next.js domyślnie ogranicza body Server Action do **1 MB**.

Na Railway nie ma potrzeby utrzymywania Vercelowego limitu request payload, więc dla obecnego mechanizmu uploadu ustawić:

```js
experimental: {
  optimizePackageImports: ['lucide-react'],
  serverActions: {
    bodySizeLimit: '6mb',
  },
},
```

6 MB daje niewielki zapas dla pliku limitowanego przez aplikację do 5 MB.

Nie zwiększać limitu bez ograniczenia aplikacyjnego `MAX_BYTES`.

### Opcjonalny etap późniejszy

Docelowo można przejść na direct upload browser → Supabase Storage z signed upload URL. Nie jest to jednak wymagane do migracji na Railway i nie należy blokować nim wdrożenia.

---

# 6. Etap 2 — cron-y Railway zamiast `vercel.json`

Obecnie:

```json
{
  "crons": [
    { "path": "/api/email/process", "schedule": "*/5 * * * *" },
    { "path": "/api/maintenance", "schedule": "0 * * * *" }
  ]
}
```

Railway cron jobs uruchamiają **komendę**, nie cykliczny request HTTP zarządzany jak Vercel Cron.

Najmniej inwazyjne rozwiązanie to pozostawić obecną logikę Route Handlerów i dodać mały skrypt Node, który wywołuje je przez prywatną sieć Railway.

## 6.1. Dodać `scripts/railway-cron-call.mjs`

Przykładowy docelowy mechanizm:

```js
const url = process.env.CRON_TARGET_URL;
const secret = process.env.CRON_AUTH_SECRET;

if (!url || !secret) {
  console.error('Missing CRON_TARGET_URL or CRON_AUTH_SECRET');
  process.exit(2);
}

const controller = new AbortController();
const timer = setTimeout(() => controller.abort(), 120_000);

try {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${secret}`,
      'user-agent': 'pracujbe-railway-cron/1.0',
    },
    signal: controller.signal,
  });

  const body = await response.text();

  if (!response.ok) {
    console.error(`Cron failed: HTTP ${response.status}`);
    console.error(body.slice(0, 2000));
    process.exit(1);
  }

  console.log(`Cron completed: HTTP ${response.status}`);
  console.log(body.slice(0, 2000));
} catch (error) {
  console.error('Cron request failed', error);
  process.exit(1);
} finally {
  clearTimeout(timer);
}
```

Ważne:

- skrypt musi kończyć proces po wykonaniu,
- błędna odpowiedź HTTP musi kończyć się kodem `1`,
- nie logować sekretów,
- dodać timeout,
- nie używać publicznej domeny, jeśli dostępna jest prywatna sieć Railway.

---

## 6.2. `cron-email`

Konfiguracja:

```text
Schedule: */5 * * * *
Start command: node scripts/railway-cron-call.mjs
Restart policy: NEVER
Public domain: brak
```

Zmienne:

```env
CRON_TARGET_URL=http://${{web.RAILWAY_PRIVATE_DOMAIN}}:${{web.PORT}}/api/email/process
CRON_AUTH_SECRET=${{shared.EMAIL_QUEUE_SECRET}}
```

Railway cron ma minimalną częstotliwość 5 minut, więc obecny harmonogram pasuje bez zmian.

---

## 6.3. `cron-maintenance`

Konfiguracja:

```text
Schedule: 0 * * * *
Start command: node scripts/railway-cron-call.mjs
Restart policy: NEVER
Public domain: brak
```

Zmienne:

```env
CRON_TARGET_URL=http://${{web.RAILWAY_PRIVATE_DOMAIN}}:${{web.PORT}}/api/maintenance
CRON_AUTH_SECRET=${{shared.MAINTENANCE_SECRET}}
```

Railway interpretuje harmonogram cron w UTC. W tym przypadku nie wpływa to istotnie na działanie, ponieważ zadanie jest godzinowe.

---

# 7. Uporządkować autoryzację cronów

Po uruchomieniu Railway nie jest potrzebny `CRON_SECRET` specyficzny dla Vercel.

## `src/app/api/email/process/route.ts`

Docelowo akceptować tylko:

```env
EMAIL_QUEUE_SECRET
```

Usunąć z kodu:

```ts
process.env.CRON_SECRET
```

oraz komentarze o Vercel Cron.

## `src/app/api/maintenance/route.ts`

Docelowo akceptować tylko:

```env
MAINTENANCE_SECRET
```

Usunąć `CRON_SECRET`.

### Dlaczego osobne sekrety

Nie używać jednego sekretu do wszystkich zadań.

- przejęcie `EMAIL_QUEUE_SECRET` nie powinno automatycznie umożliwiać uruchamiania maintenance,
- przejęcie `MAINTENANCE_SECRET` nie powinno umożliwiać sterowania kolejką e-mail.

---

# 8. Uzupełnić `.env.example`

W kodzie używane są zmienne, których obecnie brakuje w `.env.example`.

Dodać co najmniej:

```env
# Railway / runtime
APP_MODE=""

# Internal jobs
EMAIL_QUEUE_SECRET=""
MAINTENANCE_SECRET=""

# Monitoring / health endpoint
HEALTH_CHECK_SECRET=""
```

Usunąć dokumentacyjne odniesienia do `VERCEL_ENV` i `CRON_SECRET`.

Nie dodawać do `.env.example` Railway-generated values typu `RAILWAY_PRIVATE_DOMAIN` — są dostarczane przez platformę.

---

# 9. Railway `web` service

## Source

GitHub repository:

```text
aktualnosci-be/pracujbe
```

## Runtime

Projekt już wymaga:

```json
"engines": {
  "node": ">=22"
}
```

oraz `.nvmrc`:

```text
22
```

Nie zmieniać Node podczas migracji.

## Builder

Na pierwszym etapie użyć **Railpack**.

Nie dodawać Dockerfile bez konkretnej potrzeby.

## Build command

```bash
npm run build
```

Railpack sam wykonuje instalację zależności na podstawie lockfile.

## Start command

```bash
npm run start
```

czyli:

```bash
next start
```

Next powinien nasłuchiwać na `PORT` dostarczonym przez Railway.

## Healthcheck

```text
/api/health
```

Obecny endpoint jest bardzo dobrze dopasowany do Railway: przy niepełnej konfiguracji produkcyjnej zwraca `503`, więc Railway nie przełączy ruchu na wadliwy deployment.

Ustawić:

```text
Healthcheck path: /api/health
Healthcheck timeout: 300 s
Restart policy: ON_FAILURE
```

Railway healthcheck sprawdza gotowość podczas wdrożenia; nie traktować go jako ciągłego uptime monitoringu.

## Region

Wybrać region Railway **EU West** możliwie blisko Belgii i projektu Supabase.

Na początku:

```text
Replicas: 1
```

Nie skalować poziomo bez potrzeby.

---

# 10. Zmienne środowiskowe Railway

## 10.1. Shared variables

Sekrety wspólne dla usług, które ich rzeczywiście potrzebują, mogą być Railway Shared Variables.

Przykład produkcji:

```env
NEXT_PUBLIC_SITE_URL=https://pracuj.be
NEXT_PUBLIC_DEFAULT_LOCALE=pl
APP_MODE=production

NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
SUPABASE_DB_URL=...

RESEND_API_KEY=...
EMAIL_FROM=Pracuj.be <no-reply@pracuj.be>
EMAIL_REPLY_TO=kontakt@pracuj.be

EMAIL_QUEUE_SECRET=...
MAINTENANCE_SECRET=...
HEALTH_CHECK_SECRET=...

NEXT_PUBLIC_SENTRY_DSN=...
SENTRY_ORG=...
SENTRY_PROJECT=...
SENTRY_AUTH_TOKEN=...

STRIPE_SECRET_KEY=...
STRIPE_WEBHOOK_SECRET=...

SEND_EMAIL_HOOK_SECRET=...
```

Nie kopiować ślepo wszystkich zmiennych do usług cron.

### `web`

Dostaje kompletną konfigurację aplikacji.

### `cron-email`

Powinien dostać tylko:

```env
CRON_TARGET_URL=...
CRON_AUTH_SECRET=...
```

### `cron-maintenance`

Powinien dostać tylko:

```env
CRON_TARGET_URL=...
CRON_AUTH_SECRET=...
```

To ogranicza blast radius w przypadku kompromitacji usługi cron.

## 10.2. Sealed variables

Sekrety produkcyjne oznaczyć w Railway jako **sealed** tam, gdzie nie ma potrzeby ich późniejszego odczytu z panelu/API.

Co najmniej:

- `SUPABASE_SERVICE_ROLE_KEY`,
- `RESEND_API_KEY`,
- `EMAIL_QUEUE_SECRET`,
- `MAINTENANCE_SECRET`,
- `HEALTH_CHECK_SECRET`,
- `STRIPE_SECRET_KEY`,
- `STRIPE_WEBHOOK_SECRET`,
- `SEND_EMAIL_HOOK_SECRET`,
- `SENTRY_AUTH_TOKEN`.

---

# 11. Staging na Railway

Utworzyć trwałe Railway environment:

```text
staging
```

Nie używać produkcyjnych danych i sekretów.

## Branch

```text
develop → Railway staging
main    → Railway production
```

## Supabase

Staging pozostaje na osobnym projekcie Supabase.

```env
NEXT_PUBLIC_SUPABASE_URL=<staging>
NEXT_PUBLIC_SUPABASE_ANON_KEY=<staging>
SUPABASE_SERVICE_ROLE_KEY=<staging>
```

## URL

```env
NEXT_PUBLIC_SITE_URL=https://staging.pracuj.be
APP_MODE=production
```

## Ochrona staging

Vercel Password Protection znika.

Zastąpić jednym z dwóch rozwiązań:

1. **Cloudflare Access** przed `staging.pracuj.be` — preferowane, jeśli DNS jest na Cloudflare,
2. Basic Auth w middleware — fallback.

Staging ma nadal zwracać:

```text
X-Robots-Tag: noindex, nofollow, noarchive
```

oraz blokować indeksowanie w `robots.txt`.

---

# 12. CI/CD — zachować GitHub Actions, usunąć Vercel CLI

Obecny `.github/workflows/ci.yml` zostawić.

Jest wartościowy i powinien nadal wykonywać:

- lint,
- typecheck,
- unit tests,
- SCA,
- build,
- RLS integration,
- E2E.

## Zalecany model deployu

Nie przepisywać `deploy.yml` na ręczne `railway up`, jeżeli nie ma takiej potrzeby.

Lepszy model:

```text
git push
   │
   ▼
GitHub Actions CI
   │
   ▼
CI green
   │
   ▼
Railway Wait for CI
   │
   ▼
Railway autodeploy
```

Railway wspiera **Wait for CI** dla usługi połączonej z repozytorium GitHub.

### Production

```text
Source branch: main
Wait for CI: ON
Autodeploy: ON
```

### Staging

```text
Source branch: develop
Wait for CI: ON
Autodeploy: ON
```

## `.github/workflows/deploy.yml`

Po potwierdzeniu działania Railway:

- usunąć workflow Vercel deploy,
- usunąć GitHub Secrets:
  - `VERCEL_TOKEN`,
  - `VERCEL_ORG_ID`,
  - `VERCEL_PROJECT_ID`.

Nie usuwać ich przed zakończeniem okresu rollbacku.

---

# 13. Railway Infrastructure as Code

Nie dodawać nowego `railway.json` / `railway.toml` jako docelowego rozwiązania.

Railway oznaczył Config as Code jako deprecated i ma zakończyć jego obsługę 1 grudnia 2026 r.

Docelowo użyć nowego Railway IaC:

```text
.railway/railway.ts
```

## Zalecana kolejność

Najpierw skonfigurować usługi w Railway UI i doprowadzić staging do stanu działającego.

Następnie:

```bash
railway login
railway link
railway config init
railway config pull
railway config plan
```

`config pull` powinien wygenerować bazę `.railway/railway.ts` zgodną z rzeczywistą konfiguracją projektu.

Dopiero po sprawdzeniu wygenerowanego pliku commitować IaC do repo.

To jest bezpieczniejsze niż ręczne zgadywanie całej konfiguracji przed pierwszym poprawnym deploymentem.

## Cel IaC

Kod powinien finalnie odzwierciedlać:

- `web`,
- `cron-email`,
- `cron-maintenance`,
- branch/environment mapping,
- build/start commands,
- cron schedules,
- healthcheck,
- restart policies,
- domeny,
- niesekretne variables/reference variables.

Sekrety powinny pozostać w Railway jako `preserve()` / sealed variables, nie w repo.

---

# 14. Domena `pracuj.be`

Domena produkcyjna:

```text
pracuj.be
```

ma wskazywać wyłącznie na `web` w environment `production`.

Staging:

```text
staging.pracuj.be
```

ma wskazywać na `web` w environment `staging`.

## `www.pracuj.be`

Kanoniczna wersja pozostaje:

```text
https://pracuj.be
```

Jeżeli DNS jest na Cloudflare, najlepiej zrobić redirect:

```text
www.pracuj.be/* → https://pracuj.be/$1
```

na poziomie Cloudflare Redirect Rules.

Alternatywnie wdrożyć redirect hosta w aplikacji.

Nie utrzymywać dwóch indeksowalnych wersji hosta.

---

# 15. Prywatna komunikacja cron → web

Nie wywoływać cronów przez:

```text
https://pracuj.be/api/...
```

jeżeli usługi znajdują się w tym samym Railway environment.

Użyć private networking:

```text
http://${{web.RAILWAY_PRIVATE_DOMAIN}}:${{web.PORT}}
```

Zalety:

- ruch nie wychodzi do publicznego Internetu,
- brak publicznego egress między usługami,
- mniejsza powierzchnia ataku,
- staging automatycznie trafia do staging `web`, a production do production `web`, ponieważ private network jest izolowana per environment.

Publiczne endpointy `/api/email/process` i `/api/maintenance` nadal muszą zachować token auth, ponieważ istnieją w publicznej aplikacji Next.js.

---

# 16. Retencja i brakujący cron — poprawić przy migracji

W `docs/LAUNCH_CHECKLIST.md` istnieje wymaganie:

```text
email_deliveries_gc(90)
```

ale obecny `vercel.json` nie zawiera osobnego zadania retencji.

Migracja jest dobrym momentem na zamknięcie tej luki.

W migracjach istnieją także RPC:

- `email_deliveries_gc(...)`,
- `processed_webhooks_gc(...)`,
- `rate_limit_gc(...)`.

### Zalecenie

Nie tworzyć trzech osobnych cronów.

Rozszerzyć obecny mechanizm maintenance o bezpieczne, idempotentne zadania GC i uruchamiać je np. raz dziennie albo rozdzielić:

```text
cron-maintenance-hourly  → obecne release stale reservations/checkouts
cron-maintenance-daily   → retention / GC
```

Jeżeli dodawany jest daily cron:

```text
Schedule: 30 2 * * *
```

Railway interpretuje to jako UTC.

Przed dodaniem RPC do maintenance sprawdzić ich koszt i indeksy na tabelach.

---

# 17. Niespójność dokumentacji e-mail — poprawić

Dokumentacja repo nadal w kilku miejscach używa:

```text
/api/email/dispatch
```

podczas gdy rzeczywisty kod używa:

```text
/api/email/process
```

Przy migracji ujednolicić całość do jednej nazwy.

**Nie tworzyć aliasu tylko po to, aby zachować błędną dokumentację.**

Źródłem prawdy ma być istniejący działający endpoint:

```text
/api/email/process
```

---

# 18. Pliki repo wymagające zmian

Minimalny zestaw:

```text
.env.example
next.config.mjs
src/lib/env.ts
src/app/api/email/process/route.ts
src/app/api/maintenance/route.ts
scripts/railway-cron-call.mjs
.github/workflows/deploy.yml
vercel.json
```

Dokumentacja:

```text
docs/ARCHITECTURE.md
docs/DEPLOYMENT.md
docs/DOMAIN_SETUP.md
docs/STAGING.md
docs/LAUNCH_CHECKLIST.md
docs/SECURITY_CHECKLIST.md
docs/PERFORMANCE_CHECKLIST.md
docs/SELF_HOSTED_RUNNERS.md
docs/RESEND_SETUP.md
README.md
CLAUDE.md             # jeżeli zawiera obowiązujące instrukcje deploymentu
```

Opcjonalnie:

```text
.railway/railway.ts
.railway/README.md
```

po wykonaniu `railway config pull`.

---

# 19. Co zrobić z `vercel.json`

Po uruchomieniu cronów Railway:

```text
DELETE vercel.json
```

Nie zostawiać martwego pliku, ponieważ sugerowałby, że harmonogram Vercel jest nadal źródłem prawdy.

Usunięcie wykonać dopiero po potwierdzeniu działania Railway cronów na staging.

---

# 20. Co zrobić z `_vercel` w middleware

Obecnie matcher zawiera:

```ts
'/((?!api|auth|_next|_vercel|.*\\..*).*)'
```

`_vercel` po migracji staje się martwym wyjątkiem.

Nie blokuje działania Railway, więc nie jest to P0.

W cleanupie można zmienić na:

```ts
'/((?!api|auth|_next|.*\\..*).*)'
```

Po zmianie uruchomić E2E dla:

- auth callback,
- locale redirect,
- assets,
- service worker,
- `robots.txt`,
- `sitemap.xml`.

---

# 21. Sentry

Sentry pozostaje bez zmian funkcjonalnych.

Na Railway `SENTRY_AUTH_TOKEN`, `SENTRY_ORG` i `SENTRY_PROJECT` muszą być dostępne podczas builda, jeżeli build uploaduje sourcemapy.

Po pierwszym deploymentcie sprawdzić:

- event z client runtime,
- event z server runtime,
- source maps,
- environment/tag deploymentu.

Jeżeli kod Sentry automatycznie identyfikuje Vercel environment, zastąpić go `RAILWAY_ENVIRONMENT_NAME` lub własnym `APP_ENV`, ale tylko jeśli faktycznie taki kod istnieje.

---

# 22. Stripe

Nie zmieniać logiki Stripe.

Po migracji zweryfikować endpoint:

```text
https://pracuj.be/api/stripe/webhook
```

Ponieważ URL domeny się nie zmienia, konfiguracja Stripe może pozostać ta sama.

W czasie DNS cutover webhook może trafić do Vercel albo Railway. Obie wersje muszą więc przez okres propagacji działać na **tym samym commitcie** i tej samej produkcyjnej bazie Supabase.

Obecna idempotencja webhooków musi pozostać aktywna.

---

# 23. Supabase Auth

Nie zmieniać domeny publicznej aplikacji, więc docelowe callback URL pozostają:

```text
https://pracuj.be/...
```

Staging:

```text
https://staging.pracuj.be/...
```

Po migracji zweryfikować:

- signup,
- email confirmation,
- login,
- logout,
- password reset,
- OAuth, jeżeli jest używany,
- Send Email Hook.

Nie dodawać `*.up.railway.app` do produkcyjnej allowlisty Supabase poza okresem testów i tylko jeśli jest naprawdę potrzebne.

---

# 24. Brak Railway Volume

Aplikacja nie powinna przechowywać trwałych danych na filesystemie kontenera.

CV i pliki pozostają w Supabase Storage.

Dlatego:

```text
Railway Volume: NIE DODAWAĆ
```

Filesystem Railway traktować jako efemeryczny.

To upraszcza:

- deploymenty,
- rollback,
- przyszłe skalowanie poziome.

---

# 25. Brak Railway PostgreSQL

Nie tworzyć Railway Postgres dla tej aplikacji.

Powody:

- baza już jest w Supabase,
- Auth zależy od Supabase,
- RLS jest integralną częścią architektury,
- Storage policies są integralną częścią architektury,
- RPC są już wdrożone,
- migracja DB nie daje obecnie korzyści.

Docelowo:

```text
Railway = compute / deploy / cron
Supabase = DB / Auth / Storage / RLS
```

---

# 26. Brak Redis na pierwszym etapie

Nie dodawać Redis tylko dlatego, że Railway go oferuje.

Obecny outbox e-mail:

- jest bazodanowy,
- ma retry,
- ma idempotencję,
- ma mechanizm claim,
- nie wymaga Redis.

Redis rozważyć dopiero przy realnej potrzebie:

- dużo background jobs,
- realtime queue o małym opóźnieniu,
- długie zadania,
- niezależni workerzy,
- duża skala.

---

# 27. Deployment staging — kolejność

1. Wprowadzić zmiany kodowe na `infra/railway`.
2. `npm run verify`.
3. `npm run build`.
4. E2E.
5. Merge do `develop`.
6. Utworzyć Railway project `pracujbe`.
7. Utworzyć environment `staging`.
8. Dodać service `web` z brancha `develop`.
9. Ustawić staging variables.
10. Ustawić `/api/health` jako healthcheck.
11. Wygenerować tymczasową domenę Railway.
12. Sprawdzić `/api/health`.
13. Podłączyć `staging.pracuj.be`.
14. Dodać `cron-email`, ale najpierw uruchomić manualnie.
15. Sprawdzić `email_deliveries queued → sent`.
16. Włączyć schedule `*/5 * * * *`.
17. Dodać `cron-maintenance`.
18. Uruchomić manualnie.
19. Włączyć schedule `0 * * * *`.
20. Przejść pełny staging checklist.
21. Dopiero wtedy przejść do produkcji.

---

# 28. Testy staging wymagane przed produkcją

## Deployment

- [ ] build Railway kończy się sukcesem,
- [ ] `npm run start` uruchamia Next.js,
- [ ] aplikacja nasłuchuje na Railway `PORT`,
- [ ] `/api/health` zwraca 200,
- [ ] deployment z błędnymi core env nie przechodzi healthcheck.

## Auth

- [ ] rejestracja,
- [ ] potwierdzenie e-mail,
- [ ] logowanie,
- [ ] logout,
- [ ] reset hasła,
- [ ] callback nie wpada w middleware loop.

## Kandydat

- [ ] onboarding,
- [ ] zapis profilu,
- [ ] upload PDF 1–5 MB,
- [ ] upload DOCX 1–5 MB,
- [ ] odrzucenie >5 MB,
- [ ] pobieranie przez signed URL,
- [ ] usuwanie CV.

## Pracodawca

- [ ] utworzenie firmy,
- [ ] publikacja oferty,
- [ ] aplikacje,
- [ ] statusy,
- [ ] propozycje,
- [ ] idempotencja.

## Email

- [ ] rekord trafia do `email_deliveries`,
- [ ] Railway `cron-email` uruchamia endpoint,
- [ ] `queued → sent`,
- [ ] błąd Resend → retry/backoff,
- [ ] brak podwójnych e-maili,
- [ ] locale odbiorcy poprawny.

## Maintenance

- [ ] Railway cron ma 200,
- [ ] stale reservations są zwalniane,
- [ ] stale checkout intents są zwalniane,
- [ ] błędny sekret daje 401,
- [ ] brak service role w produkcyjnym trybie daje 503.

## Stripe

- [ ] checkout test mode,
- [ ] webhook,
- [ ] update DB,
- [ ] powtórzony webhook nie duplikuje operacji.

## SEO/security

- [ ] staging ma globalny noindex,
- [ ] produkcja nie ma globalnego noindex,
- [ ] CSP,
- [ ] HSTS produkcja,
- [ ] `X-Frame-Options`,
- [ ] `nosniff`,
- [ ] robots,
- [ ] sitemap.

---

# 29. Production cutover bez przestoju

Migrację domeny wykonać dopiero po pełnym teście staging.

## Przygotowanie

1. Railway production `web` wdrożyć z **tym samym commitem**, który aktualnie działa na Vercel.
2. Ustawić produkcyjne Railway env.
3. `APP_MODE=production`.
4. Podłączyć produkcyjny Supabase.
5. Railway cron-y pozostawić **wyłączone**.
6. Przetestować produkcyjną instancję Railway przez jej tymczasowy domain.
7. Nie wykonywać destrukcyjnych testów na produkcji.

## Cutover

Kolejność:

```text
1. upewnić się, że Vercel i Railway mają ten sam commit
2. wyłączyć Vercel Cron
3. włączyć Railway cron-email
4. włączyć Railway cron-maintenance
5. przepiąć DNS pracuj.be na Railway
6. obserwować health/logi/Sentry
7. pozostawić Vercel gotowy do rollbacku
```

Podczas propagacji część ruchu może trafić na Vercel, a część na Railway.

Jest to akceptowalne, ponieważ oba deploymenty:

- używają tego samego Supabase,
- używają tego samego Storage,
- używają tego samego Auth,
- są stateless,
- powinny działać z tym samym kodem.

**Nie pozostawiać równocześnie aktywnych cronów na obu platformach.**

---

# 30. Rollback

Rollback ma być możliwy bez zmian w bazie.

Jeżeli po cutover pojawi się problem:

```text
1. wyłączyć Railway cron-email i cron-maintenance
2. ponownie włączyć Vercel Cron
3. przywrócić DNS na Vercel
4. nie cofać migracji Supabase, jeżeli nie było zmian schematu
5. zebrać Railway logs + Sentry
```

Vercel usunąć dopiero po ustalonym okresie stabilności, np. kilku dniach bez incydentów.

---

# 31. Monitoring po cutover

Przez pierwsze 48 godzin obserwować:

- Railway CPU,
- Railway RAM,
- restart count,
- deployment errors,
- response latency,
- Sentry server errors,
- Sentry client errors,
- liczbę `email_deliveries.status='queued'`,
- liczbę `email_deliveries.status='failed'`,
- Stripe webhook failures,
- Resend bounce/complaint,
- Supabase DB connections,
- auth failures,
- upload CV.

Railway `/api/health` jest deployment readiness checkiem, a nie pełnym ciągłym monitoringiem. Sentry i zewnętrzny uptime check pozostają potrzebne.

---

# 32. Skalowanie później

Na start:

```text
web replicas = 1
```

Przy zwiększeniu do wielu replik trzeba ponownie sprawdzić:

- zachowanie Next.js cache/revalidation między instancjami,
- operacje wymagające lokalnego stanu,
- websockety/realtime, jeśli zostaną dodane,
- background jobs,
- rate limiting.

Obecny DB-backed rate limiting i DB-backed outbox są dobrym fundamentem pod skalowanie, ponieważ nie polegają na pamięci pojedynczego procesu Next.js.

---

# 33. Priorytety implementacyjne

## P0 — wymagane przed pierwszym Railway staging

- [ ] usunąć runtime dependency od `VERCEL_ENV`,
- [ ] ustawić jawny `APP_MODE`,
- [ ] naprawić Server Action body limit dla CV,
- [ ] dodać Railway cron caller,
- [ ] dodać `MAINTENANCE_SECRET` do env docs,
- [ ] dodać `HEALTH_CHECK_SECRET` do env docs,
- [ ] skonfigurować Railway `web`,
- [ ] skonfigurować healthcheck,
- [ ] skonfigurować staging variables,
- [ ] uruchomić cron-email,
- [ ] uruchomić cron-maintenance.

## P1 — wymagane przed production cutover

- [ ] Wait for CI,
- [ ] branch mapping main/develop,
- [ ] staging protection,
- [ ] custom domains,
- [ ] full E2E staging,
- [ ] pełny test Stripe/Supabase Auth/Resend,
- [ ] dokumentacja Railway,
- [ ] usunięcie `CRON_SECRET`,
- [ ] usunięcie Vercel-specific deploy workflow po okresie rollbacku,
- [ ] wyeliminowanie `/api/email/dispatch` z dokumentacji.

## P2 — cleanup po stabilnym cutover

- [ ] delete `vercel.json`,
- [ ] usunąć `_vercel` z middleware matcher,
- [ ] usunąć pozostałe wzmianki o Vercel,
- [ ] usunąć Vercel GitHub secrets,
- [ ] skonfigurować `.railway/railway.ts`,
- [ ] dodać daily retention/GC,
- [ ] ewentualnie direct upload CV do Supabase,
- [ ] ewentualnie ulepszyć continuous uptime monitoring.

---

# 34. Kryteria zakończenia migracji

Migrację uznajemy za zakończoną dopiero, gdy wszystkie poniższe warunki są spełnione:

- [ ] `pracuj.be` działa z Railway,
- [ ] `www` przekierowuje na canonical host,
- [ ] `staging.pracuj.be` działa z Railway staging,
- [ ] staging i production mają osobne Supabase/secrets,
- [ ] Railway healthcheck działa,
- [ ] CI blokuje deployment przy błędzie,
- [ ] production deployuje się z `main`,
- [ ] staging deployuje się z `develop`,
- [ ] e-maile są przetwarzane przez Railway cron,
- [ ] maintenance jest przetwarzany przez Railway cron,
- [ ] tylko `web` ma public domain,
- [ ] cron-y korzystają z private networking,
- [ ] upload CV do 5 MB działa,
- [ ] Sentry odbiera błędy server/client,
- [ ] Stripe webhook działa,
- [ ] Supabase Auth callback działa,
- [ ] brak wzrostu `queued`/`failed` w outboxie,
- [ ] rollback został przetestowany proceduralnie,
- [ ] Vercel nie jest już aktywnym elementem architektury,
- [ ] dokumentacja nie wskazuje Vercela jako źródła prawdy.

---

# 35. Docelowy stan repo

Po migracji repo powinno komunikować jasno:

```text
Pracuj.be

Runtime / hosting       Railway
Deployment              Railway GitHub integration + Wait for CI
CI                      GitHub Actions / self-hosted runners
Production branch       main
Staging branch          develop
Database                 Supabase PostgreSQL
Auth                     Supabase Auth
Storage                  Supabase Storage
Cron                     Railway Cron Jobs
Email                    Resend
Payments                 Stripe
Monitoring               Sentry + Railway logs/metrics
Infrastructure config    .railway/railway.ts
```

Nie powinny pozostać dwie konkurujące instrukcje deploymentu.

---

# 36. Pliki/usługi, których NIE należy migrować bez osobnej decyzji

Nie wykonywać przy okazji tej migracji:

- migracji Supabase → Railway PostgreSQL,
- Supabase Storage → Railway Bucket/R2,
- Supabase Auth → własny auth,
- Resend → inny provider,
- Stripe → inny billing,
- przebudowy outboxa na Redis,
- upgrade Next.js 15 → kolejna major version,
- redesignu UI,
- refaktoru domen biznesowych.

Każda z tych zmian zwiększyłaby powierzchnię regresji i utrudniła ocenę, czy problem wynika z Railway czy ze zmiany aplikacji.

---

# 37. Sugerowany podział na commity

```text
1. chore(infra): remove Vercel runtime assumptions
2. fix(upload): allow 5 MB CV server actions on self-hosted runtime
3. feat(infra): add Railway cron caller
4. chore(env): add Railway/maintenance/health variables
5. docs(infra): replace Vercel deployment docs with Railway
6. ci(infra): switch deploy ownership to Railway Wait for CI
7. chore(infra): remove Vercel cron config
8. chore(infra): add Railway IaC snapshot
9. chore(infra): remove remaining Vercel-specific references
```

Nie robić jednego ogromnego commita obejmującego całą migrację.

---

# 38. Źródła techniczne zweryfikowane przy tworzeniu planu

- Railway — Cron Jobs: https://docs.railway.com/cron-jobs
- Railway — Healthchecks: https://docs.railway.com/deployments/healthchecks
- Railway — GitHub Autodeploys / Wait for CI: https://docs.railway.com/deployments/github-autodeploys
- Railway — Environments: https://docs.railway.com/environments
- Railway — Private networking / domains: https://docs.railway.com/networking/domains/working-with-domains
- Railway — Variables / reference variables / sealed variables: https://docs.railway.com/variables
- Railway — Infrastructure as Code: https://docs.railway.com/infrastructure-as-code
- Next.js — Server Actions bodySizeLimit: https://nextjs.org/docs/app/api-reference/config/next-config-js/serverActions

---

## Ostateczna rekomendacja

Dla obecnego repo Pracuj.be docelowa architektura powinna być:

```text
Railway Pro
├── web: Next.js
├── cron-email: co 5 min
└── cron-maintenance: co godzinę

Supabase
├── PostgreSQL
├── Auth
├── Storage
└── RLS / RPC

Resend + Stripe + Sentry
```

To daje korzyści Railway bez niepotrzebnego przepisywania działającej architektury aplikacji.
