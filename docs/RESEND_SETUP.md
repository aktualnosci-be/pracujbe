# Resend — e-maile transakcyjne

> **Dostawca domyślny produkcji to EmailLabs** ([`EMAILLABS_SETUP.md`](./EMAILLABS_SETUP.md)).
> Resend zostaje działającą alternatywą: `EMAIL_PROVIDER=resend` + `RESEND_API_KEY`. Wybór
> dostawcy, idempotencja, ACK i kody błędów: `src/lib/email/transport/`. Kolejka, wypisanie,
> budżety i blokady opisane niżej działają tak samo dla obu dostawców.

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
EMAIL_UNSUBSCRIBE_SECRET="…"                    # podpis HMAC linków wypisania (≥ 32 znaki)
RESEND_WEBHOOK_SECRET="whsec_…"                 # signing secret webhooka doręczeń (§6)
EMAIL_SENDER_IDENTITY="…"                       # nazwa podmiotu-nadawcy (stopka, #45)
EMAIL_SENDER_POSTAL_ADDRESS="…"                 # adres pocztowy nadawcy (stopka, #45)
```

- `EMAIL_FROM` musi być na **zweryfikowanej** domenie z §2.
- `EMAIL_QUEUE_SECRET` — silny losowy sekret; chroni `/api/email/process` przed
  wywołaniem z zewnątrz (patrz §6).
- `EMAIL_UNSUBSCRIBE_SECRET` — silny losowy sekret (np. `openssl rand -base64 48`). Bez niego
  e-maile transakcyjne wychodzą bez linku wypisania, a marketingowe nie wychodzą wcale.
  Zmiana sekretu unieważnia linki w wysłanych wiadomościach (strona kieruje wtedy do ustawień).
- `EMAIL_SENDER_IDENTITY` / `EMAIL_SENDER_POSTAL_ADDRESS` — prawdziwa nazwa i adres pocztowy
  podmiotu wysyłającego (jedna linia, ≤ 300 znaków). Pokazywane w stopce każdego maila, gdy są
  ustawione. Newsletter wymaga ich oraz jawnego `EMAIL_FROM` — bez kompletu worker nie wysyła
  (wiersz wraca do ponowienia, błąd w Sentry). Kod nie ma wartości domyślnych.

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
Webhook Resend (#44) → POST /api/email/webhook/resend → record_email_event
           delivered / bounced / complained (match po provider_message_id — kolumna UNIQUE);
           trwałe odbicie / skarga → email_suppressions
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

### Wiadomości kont — kolejka `auth.email_outbox` (#78)

Ten sam przebieg crona (`POST /api/email/process`) obsługuje też potwierdzenie adresu i reset
hasła z kolejki Better Auth (`database/auth/0061_auth_email_outbox.sql`). Worker
`src/lib/auth/email-worker.ts` łączy się osobnym loginem `pracujbe_auth_mail_runtime`
(`DATABASE_AUTH_MAIL_URL`, tylko funkcje `claim/complete/fail/expire`) i dla każdego zlecenia:

```
auth.expire_emails() → auth.claim_emails() [queued → leased, FOR UPDATE SKIP LOCKED]
  → prepareAuthEmail (kanoniczny origin HTTPS, język ODBIORCY ze snapshotu kolejki)
  → renderEmail(accountConfirmation | passwordReset) → Resend (Idempotency-Key = UUID zlecenia)
      przyjęte + identyfikator → auth.complete_email [leased → sent, provider_message_id, token usunięty]
      odrzucone (4xx)          → auth.fail_email('delivery_failed')
      limit / 5xx / sieć       → auth.fail_email('provider_unavailable')   (ponowienie z backoffem)
      błąd renderu             → auth.fail_email('render_failed')
```

- Bez identyfikatora dostawcy nie ma ACK. Gdy dostawca przyjął list, a `complete_email`
  zwróci `false` (dzierżawę przejął inny worker), wynik liczy się jako `stale`, nie `sent`;
  gdy zapis ACK się nie powiedzie — `ackErrors` i odpowiedź 503. W obu przypadkach worker
  nie woła `fail_email`: dzierżawa wygasa, a ponowienie z tym samym kluczem nie wysyła drugiego listu.
- Do Sentry i logów trafia tylko ustalony kod (`EMAIL_PROVIDER_*`), nigdy komunikat
  dostawcy, token ani adres.
- Odpowiedź endpointu ma pole `auth` (`processed/sent/failed/expired/stale/ackErrors`); 503,
  gdy którakolwiek kolejka zgłosi problem (np. konta PostgreSQL skonfigurowane, a brak
  `DATABASE_AUTH_MAIL_URL`/kluczy dostawcy z `EMAIL_PROVIDER`/`BETTER_AUTH_URL` w produkcji).
- Nie uruchamiaj drugiego workera tej samej kolejki. **Rollback:** wyłączyć cron (albo zdjąć
  `DATABASE_AUTH_MAIL_URL`); zlecenia `queued`/`failed` zostają w PostgreSQL do wznowienia.
  Stara kolejka `email_deliveries` działa bez zmian.

### Ponawianie i idempotencja

- **Retry:** rekordy `failed` z `attempts < MAX` (np. 5) wybierane w kolejnym przebiegu;
  backoff rosnący. Po wyczerpaniu prób zostają `failed` (do diagnostyki, nie znikają).
- **Idempotencja wysyłki:** `email_deliveries.idempotency_key` (partial UNIQUE) gwarantuje,
  że retry operacji biznesowej nie zakolejkuje drugiego e-maila. Klucz identyfikuje
  zdarzenie, nie jego rodzaj: zmiana statusu aplikacji używa
  `appstatus-<application_id>-<id wiersza application_status_history>` (0073), więc
  powrót do wcześniejszego statusu (np. interview → shortlisted → interview) wysyła
  kolejny e-mail, a ponowienie tego samego żądania — nie. Publikacja: `jobpub-<job_id>`.
- **Deduplikacja webhooków:** `provider_message_id` UNIQUE.

### Wypisanie i budżety wysyłki (#45, migracja `0087`)

- Każdy mail z kategorią preferencji (zgłoszenia, propozycje, wiadomości, dopasowania,
  marketing) ma w stopce link `/{locale}/wypisz?t=…` oraz nagłówki `List-Unsubscribe`
  (`/api/email/unsubscribe?t=…`) i `List-Unsubscribe-Post: List-Unsubscribe=One-Click`
  (RFC 8058). Token: HMAC-SHA256, UUID konta + kategoria + termin (180 dni), bez adresu e-mail.
- `POST /api/email/unsubscribe` wypisuje bez logowania, idempotentnie. `GET` nigdy nie zmienia
  preferencji (skanery linków) — przekierowuje na stronę z przyciskiem potwierdzenia.
- `claim_email_batch` ponownie sprawdza zgodę: wiersz osoby wypisanej po zakolejkowaniu
  dostaje `status='failed'`, `suppressed_at`, `error_message='suppressed_opt_out'` i nie wychodzi.
- Budżet: `email_send_budget_config` (domyślnie okno 60 s, limit 100, rezerwa auth 20,
  rezerwa transakcyjna 30). Marketing kończy się przy 50 w oknie, transakcyjne przy 80,
  auth może użyć całego limitu. Dopasuj limit do planu Resend (zmiana wiersza przez
  migrację lub service role). Odmowa odkłada wiersz do następnego okna bez zwiększania
  `attempts`. Hook e-maili Auth pobiera budżet puli `auth` przed wysyłką: odmowa (okno
  dostawcy pełne) = 503 + `Retry-After`, GoTrue ponawia; błąd bazy nie blokuje e-maila Auth.

### Dowód zgody, budżet odbiorcy i kampanie (#45, etap 2, migracja `0101`)

- **Dowód zgody** — `email_consent_events` (niezmienna): każda zmiana `email_*` w
  `notification_preferences` zapisuje kategorię, zgodę/wycofanie, źródło (`settings`,
  `unsubscribe_page`, `one_click`, `direct`), język i dla zgody wersję pokazanej treści
  (`sha256:` z etykiet formularza w danym języku i roli, `src/lib/email/consent-wording.ts`).
  Zapis ustawień idzie przez RPC `set_notification_preferences`; użytkownik widzi tylko swoje
  wpisy.
- **Centrum preferencji** — wszystkie kategorie po zalogowaniu (`/candidate/ustawienia`,
  `/employer/ustawienia`); strona `/wypisz` z linku pozwala wypisać się z kategorii z linku
  albo ze wszystkich kategorii naraz (bez logowania, token z linku). Włączenie zgody tylko
  po zalogowaniu.
- **Budżet odbiorcy przy kolejkowaniu** — `email_recipient_budget_config` (`pool:<pula>` albo
  `template:<typ>`, okno, limit). Domyślnie newsletter 1/dobę, pula marketingowa 10/dobę,
  transakcyjne bez limitu (dodaj wiersz, jeśli potrzeba). Ponad limit: wiersz
  `failed` + `suppressed_recipient_budget` (ślad, bez wysyłki). List wygaszony przed wysyłką
  oddaje miejsce.
- **Kampanie (newsletter)** — rewizja = wiersz `email_campaigns` (slug + numer, treść dla
  każdego języka serwisu: `{"<język>": {"jobs": [1–3 oferty]}}`). Operator (service role):
  `select public.create_email_campaign_revision('<slug>', '<treść>'::jsonb)` →
  `select public.activate_email_campaign('<id>')`. Cron `/api/maintenance` woła
  `process_email_campaigns`: rezerwacja `rewizja + odbiorca` (PK) przed kolejkowaniem, zgoda
  sprawdzana teraz, list w języku odbiorcy. Status odbiorcy w `email_campaign_recipients`
  (`reserved/queued/accepted/delivered/skipped_consent/failed/cancelled`, bez treści i adresu).
  Nowa rewizja wygasza niewysłane listy poprzedniej i pomija osoby, które ją dostały lub mają
  ją w drodze; stara rewizja nie wraca (`STALE_STATE`). `cancel_email_campaign` zatrzymuje
  niewysłane listy. Kampania bez nowych odbiorców przechodzi w `completed`.
- **text/plain** — każdy mail z kolejki i z hooka Auth ma wersję tekstową (multipart/alternative).

### Tracking otwarć i kliknięć (#45) — wyłączony

Decyzja: bez pikseli otwarć i bez przepisywania linków. Kod nie dodaje ani jednego, a w Resend
(**Domains → domena → Configuration**) *Open tracking* i *Click tracking* muszą być wyłączone.
Potwierdzenie na **odebranej** wiadomości (nie w konfiguracji SDK):

1. Wyślij newsletter/powiadomienie na własną skrzynkę, pobierz oryginał (`.eml`).
2. `NEXT_PUBLIC_SITE_URL=https://pracuj.be EMAIL_SENDER_IDENTITY="…" EMAIL_SENDER_POSTAL_ADDRESS="…"
   node scripts/check-received-eml.mjs wiadomosc.eml --marketing`
3. Wynik `received message OK` = HTML i `text/plain`, nadawca i adres w obu wersjach,
   `List-Unsubscribe` + `List-Unsubscribe-Post`, wszystkie linki i obrazy tylko do hostów
   serwisu (`EML_ALLOWED_HOSTS` dla dodatkowych, np. CDN). Każdy obcy host (piksel,
   przekierowanie dostawcy) = błąd.

### Webhook doręczeń Resend (#44, migracja `0098`)

Endpoint: `POST /api/email/webhook/resend`. Kroki dla właściciela (jednorazowo):

1. Resend → **Webhooks → Add Endpoint** → URL `https://<domena produkcyjna>/api/email/webhook/resend`.
2. Zaznacz zdarzenia: `email.delivered`, `email.delivery_delayed`, `email.bounced`,
   `email.complained` (inne są przyjmowane i pomijane — nie udają doręczenia).
3. Skopiuj **Signing secret** (`whsec_…`) do zmiennej `RESEND_WEBHOOK_SECRET` usługi Railway
   `production`. Endpoint potrzebuje też klucza service-role (jak worker kolejki).
4. Resend → webhook → **Send test event** / ponowienie dostawy: odpowiedź `200`.

Zachowanie:

- Brak `RESEND_WEBHOOK_SECRET` (lub klucza service-role) → `503` bez czytania treści; Resend
  ponawia dostawę, żadne zdarzenie nie jest przyjmowane bez podpisu.
- Podpis Svix (`svix-id`, `svix-timestamp`, `svix-signature`; HMAC-SHA256, porównanie
  stałoczasowe), znacznik czasu ±300 s, limit body 256 kB (`413`). Zły podpis → `401`.
- Inbox `processed_webhooks` (`resend:<svix-id>`): powtórzone zdarzenie po `completed` jest
  pomijane; błąd zapisu → `500` i ponowienie przez Resend (zapis jest idempotentny).
- `record_email_event` aktualizuje `email_deliveries` po `provider_message_id`: status tylko
  „w górę” (`sent` < `delivered` < `bounced` < `complained`), czasy `delivered_at`/
  `bounced_at`/`complained_at`/`delayed_at`, `bounce_type`. `delivery_delayed` i odbicie
  przejściowe nie zmieniają statusu.
- **Trwałe odbicie** (`bounce.type = Permanent`) i **skarga** → blokada adresu w
  `email_suppressions` (także dla wiadomości spoza kolejki). `enqueue_email` nie kolejkuje na
  zablokowany adres, a `claim_email_batch` wygasza wiersze zakolejkowane wcześniej
  (`status='failed'`, `suppressed_at`, `error_message='suppressed_address'`).
- E-maile Auth (weryfikacja konta, reset hasła) są obowiązkowe i inicjowane przez użytkownika —
  blokada ich nie zatrzymuje.
- Zdjęcie blokady: panel admina **Blokady poczty** (`/admin/poczta`) → „Zdejmij blokadę” z
  uzasadnieniem (RPC `admin_lift_email_suppression`, wpis w dzienniku zdarzeń). Zdejmuj tylko,
  gdy odbiorca potwierdził, że adres działa i chce dostawać wiadomości. Kolejne trwałe odbicie
  lub skarga zakłada nową blokadę; historia zostaje.
- Logi zawierają tylko obszar i rodzaj zdarzenia — bez adresu, treści i sekretu.

**Poza zakresem (#44, kolejne kroki):** alarmy wieku kolejki i wzrostu bounce/complaint,
rozróżnienie stanów w `/api/health`, adapter innego dostawcy (EmailLabs/SES) — model zdarzeń
w `src/lib/email/provider-events.ts` jest już niezależny od dostawcy.

---

## 7. Diagnostyka

| objaw | przyczyna / działanie |
|---|---|
| `from` odrzucony | domena niezweryfikowana → §2, sprawdź status w Resend → Domains |
| e-maile w spamie | brak/niepoprawny DKIM lub DMARC → zweryfikuj rekordy, zaostrz DMARC stopniowo |
| `email_deliveries` rośnie w `queued` | worker nie działa → sprawdź cron Railway (`CRON_TARGET_URL` = `…/api/email/process`) i `EMAIL_QUEUE_SECRET` |
| dużo `failed` | sprawdź `error_message`; limit API? błędny `RESEND_API_KEY`? |
| e-maile do adresu nie wychodzą (`suppressed_address`) | trwałe odbicie lub skarga → `/admin/poczta`; zdejmij blokadę tylko po potwierdzeniu adresu |
| webhook Resend zwraca `503` | brak `RESEND_WEBHOOK_SECRET` lub klucza service-role w usłudze |
| webhook Resend zwraca `401` | sekret nie pasuje do endpointu w Resend albo zegar serwera odbiega o > 300 s |
| błędny język e-maila | sprawdź `email_deliveries.locale` i `preferred/account/signup_locale` odbiorcy |

---

## 8. Powiązane

- [`ARCHITECTURE.md`](./ARCHITECTURE.md) §3 — kolejka e-mail, §5 — język odbiorcy.
- [`DOMAIN_SETUP.md`](./DOMAIN_SETUP.md) — rekordy DNS.
- [`SECURITY_CHECKLIST.md`](./SECURITY_CHECKLIST.md) — ochrona endpointu kolejki, sekrety.
</content>
