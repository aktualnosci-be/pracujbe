# Środowisko staging

Staging to izolowana kopia produkcji do testów przed wdrożeniem. Musi być: (1) całkowicie
odseparowane danymi od produkcji, (2) **niewidoczne** dla wyszukiwarek, (3) chronione
dostępem. Wdrożenie: gałąź `develop` → Vercel Preview (patrz [`DEPLOYMENT.md`](./DEPLOYMENT.md)).

---

## 1. Zasady staging

| wymóg | realizacja |
|---|---|
| osobna baza | osobny projekt Supabase `pracujbe-staging` (własne klucze) |
| brak indeksowania | `noindex` globalnie + `robots.txt` disallow all |
| brak w sitemap | staging nie generuje/nie publikuje mapy dla wyszukiwarek |
| ochrona dostępu | Vercel Password Protection / Basic Auth (middleware) |
| osobne e-maile | osobny `RESEND_API_KEY`, rozpoznawalny `EMAIL_FROM` |
| dane demo dozwolone | seed `is_demo=true` OK na staging (nie na produkcji) |

---

## 2. Osobny projekt Supabase

- Utwórz `pracujbe-staging` (region EU) — [`SUPABASE_SETUP.md`](./SUPABASE_SETUP.md).
- Migracje: `supabase link` (staging) → `supabase db push`.
- Seed dozwolony: `supabase db reset` na staging jest OK (czysta baza + dane demo).
- Klucze staging trafiają do zmiennych **Preview** w Vercel (nie Production).
- **Nigdy** nie kieruj staging na bazę produkcyjną.

---

## 3. Wyłączenie indeksowania (noindex + robots)

Staging rozpoznawany po `NEXT_PUBLIC_SITE_URL` (np. `https://staging.pracuj.be`) lub
dedykowanej fladze środowiska. Na staging:

1. **Nagłówki/meta:** globalny `X-Robots-Tag: noindex, nofollow` (nagłówek odpowiedzi
   w middleware lub `headers()` w `next.config`) oraz `<meta name="robots" content="noindex">`.
2. **robots.txt** (`src/app/robots.ts`) — na staging zwraca:
   ```
   User-agent: *
   Disallow: /
   ```
3. **Sitemap** (`src/app/sitemap.ts`) — na staging pusta lub nieobsługiwana.

> Panele (`candidate/*`, `employer/*`, `admin/*`) mają `noindex` **zawsze**, na każdym
> środowisku (Invariant #9). Na staging `noindex` obejmuje **całą** aplikację.

---

## 4. Ochrona dostępu

Wybierz jedną (lub obie) metody:

- **Vercel Password Protection** (zalecane, najprostsze): Vercel → Project → Settings →
  **Deployment Protection** → włącz dla środowiska Preview (hasło lub Vercel Authentication /
  SSO). Zero kodu.
- **Basic Auth w middleware** (jeśli chcesz kontrolować w kodzie): sprawdzaj nagłówek
  `Authorization` na staging i zwracaj `401` z `WWW-Authenticate: Basic` gdy brak/zły
  login. Dane w zmiennych środowiskowych Preview (np. `STAGING_BASIC_AUTH_USER/PASS`).
  Uwaga: nie modyfikuj `src/middleware.ts` (plik i18n jest zablokowany) — dodaj logikę
  ochrony w dozwolonym miejscu lub przez Vercel Protection.

---

## 5. Zmienne środowiskowe (Preview)

Ustaw w Vercel jako **Preview** (patrz [`DEPLOYMENT.md`](./DEPLOYMENT.md) §3):

- `NEXT_PUBLIC_SITE_URL=https://staging.pracuj.be`
- klucze Supabase **staging**, `RESEND_API_KEY` **staging**,
- rozpoznawalny `EMAIL_FROM` (np. `Pracuj.be [STAGING] <no-reply@staging.pracuj.be>`),
- osobny `EMAIL_QUEUE_SECRET`.

E-maile na staging: albo osobna (sub)domena wysyłkowa, albo tryb testowy Resend —
by nie mieszać reputacji z produkcją i nie wysyłać do prawdziwych odbiorców przypadkiem.

---

## 6. Domena staging

- Subdomena `staging.pracuj.be` w Vercel → przypisana do środowiska Preview / brancha
  `develop` (patrz [`DOMAIN_SETUP.md`](./DOMAIN_SETUP.md)).
- SSL automatyczny (Vercel). Rekord DNS: `CNAME staging → cname.vercel-dns.com`.

---

## 7. Test na staging przed produkcją

Przed każdym wdrożeniem na produkcję przejdź na staging kluczowe przepływy:

- [ ] rejestracja + potwierdzenie e-mail (Supabase Auth) w każdym języku,
- [ ] aplikacja na ofertę (idempotentna) → e-mail do pracodawcy w **jego** języku,
- [ ] propozycja pracy (idempotentna) → e-mail do kandydata w **jego** języku,
- [ ] kolejka e-mail: `email_deliveries` przechodzi `queued → sent`,
- [ ] `noindex` na całej aplikacji (sprawdź nagłówek `X-Robots-Tag` i `robots.txt`),
- [ ] ochrona dostępu aktywna (hasło/basic auth),
- [ ] migracje zastosowane i zgodne z produkcją,
- [ ] Sentry na staging odbiera zdarzenia.

---

## 8. Powiązane

- [`DEPLOYMENT.md`](./DEPLOYMENT.md) · [`DOMAIN_SETUP.md`](./DOMAIN_SETUP.md) ·
  [`SUPABASE_SETUP.md`](./SUPABASE_SETUP.md) · [`LAUNCH_CHECKLIST.md`](./LAUNCH_CHECKLIST.md).
</content>
