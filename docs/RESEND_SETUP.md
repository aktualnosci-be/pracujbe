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

W `.env.local` / zmiennych usługi Railway (patrz [`.env.example`](../.env.example)):

```bash
RESEND_API_KEY="re_…"                          # SEKRET, tylko serwer
EMAIL_FROM="Pracuj.be <no-reply@pracuj.be>"    # nadawca; domena musi być zweryfikowana
EMAIL_REPLY_TO="kontakt@pracuj.be"             # adres odpowiedzi
EMAIL_QUEUE_SECRET="…"                          # chroni endpoint przetwarzający kolejkę
```

- `EMAIL_FROM` musi być na **zweryfikowanej** domenie z §2.
- `EMAIL_QUEUE_SECRET` — silny losowy sekret; chroni `/api/email/process` przed
  wywołaniem z zewnątrz (patrz §6).

---

## 4. Szablony (React Email)

Szablony w `src/emails/` (React Email), w czterech wariantach językowych renderowanych
wg `email_deliveries.locale` (język ODBIORCY, Invariant #1). Który szablon wysyła które
zdarzenie, opisuje rejestr [`src/emails/wiring.ts`](../src/emails/wiring.ts), pilnowany
testem `tests/unit/email-wiring.test.ts`:

| szablon | zdarzenie (RPC) | odbiorca |
|---|---|---|
| `newApplication` | `apply_to_job` | aktywni recruiter+ firmy |
| `applicationViewed` | `transition_application` → `viewed` | kandydat |
| `statusChanged` | `transition_application` → pozostałe statusy | kandydat |
| `jobOffer` | `send_offer` | kandydat |
| `offerAccepted` / `offerDeclined` | `respond_to_offer` | nadawca propozycji lub recruiter+ |
| `newMessage` | `send_message` | druga strona rozmowy |
| `jobPublished` | `publish_job` | osoba publikująca |

E-maile konta (`accountConfirmation`, `passwordReset`, `magicLink`, `emailChange`, `invite`)
wysyła warstwa Auth (`src/lib/email/auth-email.ts`), poza tą kolejką.

**Świadomie nieużywane** (szablon i tłumaczenia są, zdarzenia w produkcie brak — nic ich
nie wysyła): `welcome`, `contactInvitation`, `jobExpiring`, `payment`, `invoice`,
`supportContact`. Powody są w `UNWIRED_EMAIL_TYPES`. Podpięcie typu wymaga przeniesienia
go do właściwej grupy w rejestrze — inaczej test nie przejdzie.

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
potem uruchom worker (§6) i sprawdź `email_deliveries.status`.

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
cron Railway → POST /api/email/process   (Authorization: Bearer EMAIL_QUEUE_SECRET)
        ├─ SELECT queued/failed (attempts < MAX) FOR UPDATE SKIP LOCKED LIMIT N
        ├─ render React Email w locale odbiorcy → Resend.emails.send
        │     sukces → status='sent',  provider_message_id, sent_at
        │     błąd   → status='failed', error_message, attempts++ (backoff)
        ▼
(planowane, P1-19) Webhook Resend → bounced / complained
           (match po provider_message_id — kolumna UNIQUE)
```

### Uruchamianie workera (cron Railway)

Handler: `src/app/api/email/process/route.ts` (`GET` i `POST /api/email/process`).
Harmonogram prowadzi osobna usługa cron w Railway, uruchamiająca
`node scripts/railway-cron-call.mjs` co 5 minut (UTC, restart NEVER):

- `CRON_TARGET_URL` — prywatny adres usługi web w tym samym środowisku + `/api/email/process`,
- `CRON_AUTH_SECRET` — ta sama wartość co `EMAIL_QUEUE_SECRET` w usłudze web.

Szczegóły konfiguracji: [`docs/railway/README.md`](./railway/README.md) (sekcja „Cron”).
Najpierw uruchom zadanie ręcznie i sprawdź `email_deliveries.status`.

Endpoint weryfikuje `Authorization: Bearer <EMAIL_QUEUE_SECRET>` (lub `CRON_SECRET`),
inaczej zwraca 401. Gdy worker nie może wysyłać (brak konfiguracji w produkcji, błąd
pobrania kolejki), zwraca 503, więc cron nie raportuje fałszywego sukcesu. Używa
**service role** — `email_deliveries` nie ma polityk RLS.

`vercel.json` jest długiem migracyjnym i nie jest docelowym harmonogramem; nie uruchamiaj
jednocześnie harmonogramów Vercel i Railway.

### Ponawianie i idempotencja

- **Retry:** rekordy `failed` z `attempts < MAX` (np. 5) wybierane w kolejnym przebiegu;
  backoff rosnący. Po wyczerpaniu prób zostają `failed` (do diagnostyki, nie znikają).
- **Idempotencja wysyłki:** `email_deliveries.idempotency_key` (partial UNIQUE) gwarantuje,
  że retry operacji biznesowej nie zakolejkuje drugiego e-maila. Klucz identyfikuje
  zdarzenie, nie jego rodzaj: zmiana statusu aplikacji używa
  `appstatus-<application_id>-<id wiersza application_status_history>` (0074), więc
  powrót do wcześniejszego statusu (np. interview → shortlisted → interview) wysyła
  kolejny e-mail, a ponowienie tego samego żądania — nie. Publikacja: `jobpub-<job_id>`.
- **Deduplikacja webhooków:** `provider_message_id` UNIQUE.

### Webhook Resend (planowany, P1-19 — endpoint jeszcze nie istnieje)

Docelowo: Resend → **Webhooks → Add Endpoint** → `https://pracuj.be/api/webhooks/resend`.
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
| `email_deliveries` rośnie w `queued` | worker nie działa → sprawdź cron Railway (`CRON_TARGET_URL` = `…/api/email/process`) i `EMAIL_QUEUE_SECRET` |
| dużo `failed` | sprawdź `error_message`; limit API? błędny `RESEND_API_KEY`? |
| błędny język e-maila | sprawdź `email_deliveries.locale` i `preferred/account/signup_locale` odbiorcy |

---

## 8. Powiązane

- [`ARCHITECTURE.md`](./ARCHITECTURE.md) §3 — kolejka e-mail, §5 — język odbiorcy.
- [`DOMAIN_SETUP.md`](./DOMAIN_SETUP.md) — rekordy DNS.
- [`SECURITY_CHECKLIST.md`](./SECURITY_CHECKLIST.md) — ochrona endpointu kolejki, sekrety.
</content>
