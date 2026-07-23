# Konfiguracja domeny pracuj.be

Podłączenie domeny `pracuj.be` do Vercel: DNS, przypisanie domen (prod + staging), SSL,
przekierowanie `www`. E-mailowe rekordy DNS (SPF/DKIM/DMARC) opisuje
[`RESEND_SETUP.md`](./RESEND_SETUP.md). Wdrożenie: [`DEPLOYMENT.md`](./DEPLOYMENT.md).

---

## 1. Plan domen

| host | środowisko | cel |
|---|---|---|
| `pracuj.be` | Production (apex/root) | wersja kanoniczna |
| `www.pracuj.be` | Production | przekierowanie 308 → `pracuj.be` |
| `staging.pracuj.be` | Preview / branch `develop` | staging (noindex, chroniony) |
| `send.pracuj.be` (lub `mail.`) | — | subdomena wysyłkowa Resend (opcjonalnie) |

Kanoniczna jest wersja **bez `www`** (`pracuj.be`). Jeśli wolisz `www`, odwróć
przekierowanie — kluczowe, by istniała **jedna** wersja kanoniczna (SEO, cookies).

---

## 2. Dodanie domeny w Vercel

Vercel → Project `pracujbe` → **Settings → Domains → Add**:

1. Dodaj `pracuj.be` (apex) — ustaw jako **Primary / production domain**.
2. Dodaj `www.pracuj.be` — Vercel zaproponuje **Redirect to `pracuj.be` (308)**; zaakceptuj.
3. Dodaj `staging.pracuj.be` i przypisz do gałęzi `develop` (Settings → Domains →
   wybór brancha) lub do środowiska Preview.

Vercel wyświetli wymagane rekordy DNS dla każdej domeny.

---

## 3. Rekordy DNS (u operatora domeny)

U rejestratora / operatora DNS `pracuj.be` dodaj rekordy wskazane przez Vercel. Typowo:

| host | typ | wartość | uwaga |
|---|---|---|---|
| `pracuj.be` (apex/`@`) | `A` | `76.76.21.21` | IP podane przez Vercel dla apex |
| `pracuj.be` (apex/`@`) | `ALIAS`/`ANAME` | `cname.vercel-dns.com` | jeśli operator wspiera ALIAS na apex (preferowane) |
| `www` | `CNAME` | `cname.vercel-dns.com` | |
| `staging` | `CNAME` | `cname.vercel-dns.com` | |

Uwagi:
- **Apex (`pracuj.be`)** nie może być `CNAME` w klasycznym DNS. Użyj `A` (IP z panelu
  Vercel) albo `ALIAS`/`ANAME`, jeśli operator to obsługuje (Cloudflare: „CNAME
  flattening"). **Zawsze** użyj dokładnych wartości pokazanych przez Vercel — mogą się różnić.
- Jeśli używasz Cloudflare, na starcie ustaw rekordy jako **DNS only** (szara chmurka),
  aż SSL Vercel się wystawi; potem ewentualnie włącz proxy z trybem SSL „Full (strict)".
- Rekordy pocztowe (MX/SPF/DKIM/DMARC) — patrz [`RESEND_SETUP.md`](./RESEND_SETUP.md).
  Nie kolidują z rekordami web (inne hosty/typy).

---

## 4. Weryfikacja i SSL

1. Po dodaniu rekordów Vercel automatycznie zweryfikuje domenę (status **Valid
   Configuration**). Propagacja DNS: od kilku minut do kilku godzin.
2. **SSL** (Let's Encrypt) wystawiany automatycznie przez Vercel po weryfikacji — brak
   ręcznej konfiguracji certyfikatu.
3. **HTTPS wymuszony:** Vercel przekierowuje HTTP→HTTPS automatycznie. Włącz **HSTS**
   (nagłówek `Strict-Transport-Security`) dla produkcji.

Sprawdzenie:

```bash
dig +short pracuj.be
dig +short www.pracuj.be
curl -sI https://pracuj.be | grep -i -E "^(HTTP|strict-transport|location)"
curl -sI https://www.pracuj.be | grep -i -E "^(HTTP|location)"   # oczekiwane 308 → https://pracuj.be
```

---

## 5. Przekierowanie www

- Preferowane: **przekierowanie na poziomie Vercel** (308 z `www.pracuj.be` na
  `pracuj.be`) — konfigurowane przy dodawaniu domeny (§2). Zero kodu.
- Nie dubluj przekierowania w `next.config.mjs`/middleware (przekierowanie „/"→locale
  obsługuje już middleware next-intl; nie modyfikuj `src/middleware.ts`).
- Upewnij się, że `NEXT_PUBLIC_SITE_URL` = wersja kanoniczna (`https://pracuj.be`), by
  linki kanoniczne, sitemap i e-maile używały jednej domeny.

---

## 6. Po konfiguracji

- [ ] `https://pracuj.be` otwiera aplikację; przekierowuje `/` → `/{locale}`.
- [ ] `https://www.pracuj.be` → 308 → `https://pracuj.be`.
- [ ] `http://pracuj.be` → 301/308 → `https://…`.
- [ ] SSL ważny (kłódka), HSTS obecny.
- [ ] `staging.pracuj.be` działa, chroniony i `noindex` (patrz [`STAGING.md`](./STAGING.md)).
- [ ] Google Search Console: własność domeny zweryfikowana, sitemap zgłoszona.
- [ ] Rekordy pocztowe (Resend) zweryfikowane — [`RESEND_SETUP.md`](./RESEND_SETUP.md).

---

## 7. Powiązane

- [`DEPLOYMENT.md`](./DEPLOYMENT.md) · [`STAGING.md`](./STAGING.md) ·
  [`RESEND_SETUP.md`](./RESEND_SETUP.md) · [`LAUNCH_CHECKLIST.md`](./LAUNCH_CHECKLIST.md).
</content>
