# Resend — e-maile transakcyjne

Konfiguracja Resend do e-maili transakcyjnych Pracuj.be: konto, domena i DNS
(SPF/DKIM/DMARC), API key, `EMAIL_FROM`, test wysyłki oraz kolejka `email_deliveries`
z ponawianiem.

Reguła nadrzędna: **język e-maila = język odbiorcy** (`resolveRecipientLocale`,
Invariant #1). Architektura kolejki: [`ARCHITECTURE.md`](./ARCHITECTURE.md) §3.

---

## 1. Konto i API key

1. [resend.com](https://resend.com) → załóż konto (osobne środowiska? użyj jednego konta,
   różnych domen/kluczy dla prod i staging).
2. **API Keys → Create API Key.**
   - Nazwa: `pracujbe-prod` (oraz `pracujbe-staging`).
   - Permission: **Sending access** (nie potrzeba full access do wysyłki).
   - Skopiuj klucz `re_…` **od razu** (pokazany raz) → `RESEND_API_KEY`.

---

## 2. Domena i DNS (SPF / DKIM / DMARC)

Resend → **Domains → Add Domain** → `pracuj.be` (lub subdomena wysyłkowa, np.
`mail.pracuj.be` / `send.pracuj.be` — zalecane, izoluje reputację od poczty głównej).

Resend wygeneruje rekordy do dodania u operatora DNS (patrz [`DOMAIN_SETUP.md`](./DOMAIN_SETUP.md)):

| typ | nazwa (przykład) | cel | rola |
|---|---|---|---|
| `TXT` | `send.pracuj.be` | `v=spf1 include:amazonses.com ~all` | **SPF** — autoryzacja nadawcy |
| `TXT` / `CNAME` | `resend._domainkey…` | wartość z panelu Resend | **DKIM** — podpis kryptograficzny |
| `MX` | `send.pracuj.be` | `feedback-smtp.<region>.amazonses.com` | zwrotki (bounce/complaint) |
| `TXT` | `_dmarc.pracuj.be` | `v=DMARC1; p=none; rua=mailto:dmarc@pracuj.be` | **DMARC** — polityka i raporty |

Kroki:
1. Dodaj rekordy w DNS. Propagacja: do kilkudziesięciu minut.
2. Resend → **Verify**. Status musi być **Verified** dla wszystkich rekordów.
3. DMARC startowo `p=none` (monitoring); po potwierdzeniu poprawności SPF+DKIM zaostrz
   do `p=quarantine`, docelowo `p=reject`.

> Bez zweryfikowanej domeny Resend wysyła tylko z `onboarding@resend.dev` (testy).
> Produkcja wymaga własnej, zweryfikowanej domeny.

---

## 3. Zmienne środowiskowe

W `.env.local` / Vercel (patrz [`.env.example`](../.env.example)):

```bash
RESEND_API_KEY="re_…"                          # SEKRET, tylko serwer
EMAIL_FROM="Pracuj.be <no-reply@pracuj.be>"    # nadawca; domena musi być zweryfikowana
EMAIL_REPLY_TO="kontakt@pracuj.be"             # adres odpowiedzi
EMAIL_QUEUE_SECRET="…"                          # chroni endpoint przetwarzający kolejkę
```

- `EMAIL_FROM` musi być na **zweryfikowanej** domenie z §2.
- `EMAIL_QUEUE_SECRET` — silny losowy sekret; chroni `/api/email/dispatch` przed
  wywołaniem z zewnątrz (patrz §6).

---

## 4. Szablony (React Email)

Szablony w `src/emails/` (React Email), w czterech wariantach językowych renderowanych
wg `email_deliveries.locale`. Typy e-maili odpowiadają `notification_type` / procesom:

- `application_received` (→ pracodawca), `application_status_changed` (→ kandydat),
- `offer_received` (→ kandydat), `offer_status_changed` (→ pracodawca),
- `message_received`, `job_match`, `company_verified`, oraz Auth (confirm/reset —
  obsługiwane przez Supabase Auth, patrz [`SUPABASE_SETUP.md`](./SUPABASE_SETUP.md) §6).

Każdy tekst pochodzi z tłumaczeń — żadnych literałów UI (Invariant #2).

---

## 5. Test wysyłki

Szybki test poza aplikacją (podmień klucz i adres):

```bash
curl -X POST https://api.resend.com/emails \
  -H "Authorization: Bearer $RESEND_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "from": "Pracuj.be <no-reply@pracuj.be>",
    "to": ["ty@example.com"],
    "subject": "Test Pracuj.be",
    "html": "<p>Działa ✔</p>"
  }'
```

Sukces → JSON z `id`. Sprawdź w Resend → **Logs** status dostarczenia. Jeśli `from`
odrzucony — domena nie jest zweryfikowana (§2).

W aplikacji: wykonaj przepływ tworzący e-mail (np. aplikacja na ofertę na staging),
potem uruchom dispatcher (§6) i sprawdź `email_deliveries.status`.

---

## 6. Kolejka `email_deliveries` + ponawianie

E-mail **nigdy** nie jest wysyłany synchronicznie w transakcji biznesowej. Trafia do
kolejki (`email_deliveries`, status `queued`); osobny proces go wysyła. Awaria Resend
nie cofa operacji (aplikacja/propozycja pozostaje zapisana) — wysyłka jest ponawialna
(Invariant #3).

```
Server Action → enqueueEmail() → INSERT email_deliveries(status='queued', locale, …)
                                   ON CONFLICT (idempotency_key) DO NOTHING
        ▼
cron/worker → POST /api/email/dispatch   (nagłówek/param z EMAIL_QUEUE_SECRET)
        ├─ SELECT queued/failed (attempts < MAX) FOR UPDATE SKIP LOCKED LIMIT N
        ├─ render React Email w locale odbiorcy → Resend.emails.send
        │     sukces → status='sent',  provider_message_id, sent_at
        │     błąd   → status='failed', error_message, attempts++ (backoff)
        ▼
Webhook Resend → POST /api/webhooks/resend
        └─ delivered / opened / clicked / bounced / complained
           (match po provider_message_id — kolumna UNIQUE)
```

### Uruchamianie dispatchera (cron)

Opcje:
- **Vercel Cron** (`vercel.json` → `crons`) — wywołuje `/api/email/dispatch` co np. 1–5 min.
- Zewnętrzny cron / scheduler wołający ten sam endpoint.

Endpoint MUSI weryfikować `EMAIL_QUEUE_SECRET` (np. nagłówek `Authorization`), inaczej
zwraca 401. Używa **service role** (`@/lib/supabase/admin`) — `email_deliveries` nie ma
polityk RLS.

### Ponawianie i idempotencja

- **Retry:** rekordy `failed` z `attempts < MAX` (np. 5) wybierane w kolejnym przebiegu;
  backoff rosnący. Po wyczerpaniu prób zostają `failed` (do diagnostyki, nie znikają).
- **Idempotencja wysyłki:** `email_deliveries.idempotency_key` (partial UNIQUE) — np.
  `offer:<offer_id>` — gwarantuje, że retry operacji biznesowej nie zakolejkuje drugiego
  e-maila.
- **Deduplikacja webhooków:** `provider_message_id` UNIQUE.

### Webhook Resend

Resend → **Webhooks → Add Endpoint** → `https://pracuj.be/api/webhooks/resend`.
Zdarzenia: `email.delivered`, `email.opened`, `email.clicked`, `email.bounced`,
`email.complained`. Zweryfikuj podpis (signing secret z panelu). Bounce/complaint →
oznacz odbiorcę (rozważ wstrzymanie dalszych wysyłek marketingowych; transakcyjne
zgodnie z zasadami).

---

## 7. Diagnostyka

| objaw | przyczyna / działanie |
|---|---|
| `from` odrzucony | domena niezweryfikowana → §2, sprawdź status w Resend → Domains |
| e-maile w spamie | brak/niepoprawny DKIM lub DMARC → zweryfikuj rekordy, zaostrz DMARC stopniowo |
| `email_deliveries` rośnie w `queued` | dispatcher nie działa → sprawdź cron i `EMAIL_QUEUE_SECRET` |
| dużo `failed` | sprawdź `error_message`; limit API? błędny `RESEND_API_KEY`? |
| błędny język e-maila | sprawdź `email_deliveries.locale` i `preferred/account/signup_locale` odbiorcy |

---

## 8. Powiązane

- [`ARCHITECTURE.md`](./ARCHITECTURE.md) §3 — kolejka e-mail, §5 — język odbiorcy.
- [`DOMAIN_SETUP.md`](./DOMAIN_SETUP.md) — rekordy DNS.
- [`SECURITY_CHECKLIST.md`](./SECURITY_CHECKLIST.md) — ochrona endpointu kolejki, sekrety.
</content>
