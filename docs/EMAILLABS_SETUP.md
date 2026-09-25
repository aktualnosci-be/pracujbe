# EmailLabs — wysyłka poczty Pracuj.be

EmailLabs (Vercom) jest domyślnym dostawcą poczty produkcji (decyzja właściciela z 25.09).
Resend zostaje działającą alternatywą ([`RESEND_SETUP.md`](./RESEND_SETUP.md)). Zmiana
dostawcy nie wymaga zmian w kodzie ani migracji.

Kod:

- `src/lib/email/transport/`: wspólny transport i wybór dostawcy (`EMAIL_PROVIDER`).
- `emaillabs.ts`: adapter REST API v2.1.
- Oba workery korzystają z tego samego transportu:
  - kolejka domenowa `email_deliveries` (`src/lib/email/outbox.ts`);
  - poczta kont `auth.email_outbox` (`src/lib/auth/email-worker.ts`).

  Oba uruchamia cron `/api/email/process`.
- `src/app/api/email/webhook/emaillabs/route.ts`: raporty doręczeń. Mapuje je na ten sam
  model zdarzeń co Resend (`src/lib/email/provider-events.ts`, `record_email_event`,
  `email_suppressions`).

Reguła nadrzędna bez zmian: **język e-maila = język odbiorcy** (Invariant #1). Transport
dostaje gotową wiadomość wyrenderowaną w języku z wiersza kolejki.

---

## 1. Co właściciel ustawia w panelu EmailLabs

Kolejność ma znaczenie. Bez domeny (krok 1.1) EmailLabs wyśle list z domeny sandboxowej
albo go odrzuci.

### 1.1. Domena nadawcy: SPF, DKIM, DMARC

1. **E-mail → Bezpieczeństwo nadawcy → Autoryzacja nadawców**: dodaj domenę z `EMAIL_FROM`
   (np. `pracuj.be`) i wygeneruj rekordy DNS.
2. Dodaj rekordy u operatora DNS domeny:
   - SPF (`include:` EmailLabs w istniejącym rekordzie TXT; jeden rekord SPF na domenę),
   - DKIM (TXT/CNAME wskazany przez panel),
   - DMARC (`_dmarc`, na start `p=none` z adresem raportów, po kilku tygodniach
     `quarantine`).
3. Kliknij weryfikację w panelu i poczekaj na zielony status wszystkich rekordów.
4. Opcjonalnie **Ograniczenie autoryzacji do określonych SMTP**: przypisz domenę tylko do konta
   SMTP portalu.

Instrukcje dostawcy: <https://docs.emaillabs.io/e-mail/bezpieczenstwo-nadawcy/autoryzacja-nadawcow>.

### 1.2. Konto SMTP portalu

Konta SMTP to **E-mail API → Ustawienia → Konta SMTP**. Użyj osobnego konta dla portalu. Jego
nazwa ma postać `1.<nazwa>.smtp` i trafia do `EMAILLABS_SMTP_ACCOUNT`.

W ustawieniach tego konta:

| Ustawienie | Wartość | Dlaczego |
|---|---|---|
| **Open Tracking** | **wyłączone** | Decyzja #45: bez pikseli otwarć. API nie ma przełącznika dla open trackingu. |
| **Link Tracking** | wyłączone | Kod i tak wysyła `X-TRACKING-OFF: 1` w każdym liście. Wyłącz też w panelu. |
| **Google Analytics**, **Deep linki** | wyłączone | Doklejają parametry i przekierowania do linków. |
| **Unsubscribe → List-unsubscribe** | **wyłączone** | Portal wysyła własne `List-Unsubscribe` + `List-Unsubscribe-Post` (#45, RFC 8058) tylko w mailach z kategorią zgody. Włączona funkcja EmailLabs dopisałaby wypis także do maili konta (potwierdzenie adresu, reset hasła). Kliknięcie takiego wypisu blokuje adres na czarnej liście EmailLabs (status `dropped`), więc kolejne maile konta by nie docierały. |
| **Unsubscribe → strona z wypisem / przekierowanie** | wyłączone | Wypis prowadzi `/{locale}/wypisz`. |
| **Stopka** | wyłączona | Stopkę (dane nadawcy, wypis) renderuje szablon w języku odbiorcy. Stopka panelu byłaby w jednym języku. |
| **Nagłówki (precedence)** | „Brak typu” | Maile portalu są transakcyjne. Newsletter ma własne nagłówki wypisania. |
| **Blokada skrzynek tymczasowych** | wg decyzji | Blokuje rejestrację z adresów jednorazowych (zablokowane listy mają status `dropped`). |

Uwaga o czarnej liście EmailLabs (**Ustawienia → Czarna lista**): EmailLabs sam blokuje adresy
po odbiciach. Liczbę odbić i ważność wpisu ustawia się w panelu. Portal ma własną blokadę
(`email_suppressions`, `/admin/poczta`), ale mail zatrzymany przez EmailLabs (`dropped`) nie
dociera do odbiorcy mimo naszej decyzji. Przy zdejmowaniu blokady w `/admin/poczta` sprawdź też
czarną listę w panelu EmailLabs.

### 1.3. Klucze API

**Konto → Ustawienia → API → Generuj klucz API**. Panel pokazuje dwie wartości:

- `Application-Key` → `EMAILLABS_APP_KEY`,
- `Authorization` (128 znaków, widoczny tylko raz) → `EMAILLABS_SECRET_KEY`.

Uprawnienia klucza (**Nadawanie uprawnień**):

- wysyłka e-maili (`POST /v2.1/email`);
- **odczyt statusów e-maili** (`GET /v2.1/email`). Adapter odczytuje status przed każdą
  wysyłką, bo tak działa deduplikacja (pkt 3). Bez tego prawa worker nic nie wyśle i zgłosi
  `EMAIL_PROVIDER_UNAVAILABLE`.

Opcjonalnie: **Ograniczenie dostępu do wybranych adresów IP**. Railway nie daje stałego IP
wyjściowego bez dodatkowej usługi, więc zostaw to wyłączone albo ustaw IP egress, jeśli
zostanie skonfigurowane.

### 1.4. Webhook raportów doręczeń

**Konto → Ustawienia → Webhooki → kanał „E-maile transakcyjne — raporty doręczeń”**:

1. **URL**: `https://pracuj.be/api/email/webhook/emaillabs`. Drugi URL zostaw pusty albo
   wpisz ten sam.
2. **Tryb autentykacji**: Basic auth jest zalecany. Wpisz login i hasło, a potem te same
   wartości w `EMAILLABS_WEBHOOK_BASIC_USER` i `EMAILLABS_WEBHOOK_BASIC_PASSWORD`.
3. **Generuj SecretKey** → `EMAILLABS_WEBHOOK_SECRET`. Wymagany: bez niego endpoint
   odpowiada 503.
4. Najpierw ustaw zmienne w Railway i poczekaj na wdrożenie. Dopiero potem kliknij **Test**
   w panelu (EmailLabs zapisze konfigurację dopiero po teście z odpowiedzią `200`).
5. **Zapisz**.
6. Status `ok` (doręczono) jest domyślnie wyłączony. Aby portal widział `delivered`, poproś
   wsparcie EmailLabs o włączenie statusów „OK” w Event API. Bez tego portal widzi odbicia
   i opóźnienia; `delivered` zostaje puste.

---

## 2. Zmienne w Railway (usługa web)

| Zmienna | Wartość |
|---|---|
| `EMAIL_PROVIDER` | `emaillabs` |
| `EMAILLABS_APP_KEY` | `Application-Key` z pkt 1.3 |
| `EMAILLABS_SECRET_KEY` | `Authorization` z pkt 1.3 |
| `EMAILLABS_SMTP_ACCOUNT` | nazwa konta SMTP, np. `1.pracujbe.smtp` |
| `EMAILLABS_WEBHOOK_SECRET` | SecretKey z pkt 1.4 |
| `EMAILLABS_WEBHOOK_BASIC_USER`, `EMAILLABS_WEBHOOK_BASIC_PASSWORD` | login i hasło Basic auth z pkt 1.4 (oba albo żadne) |
| `EMAIL_FROM` | bez zmian, np. `Pracuj.be <no-reply@pracuj.be>`. Domena musi być zautoryzowana w pkt 1.1. |

Bez zmian zostają: `EMAIL_QUEUE_SECRET`, `EMAIL_UNSUBSCRIBE_SECRET`, `EMAIL_SENDER_*`,
`DATABASE_AUTH_MAIL_URL`, cron `/api/email/process`.

Kontrola po wdrożeniu (`HEALTH_CHECK_SECRET`):

```bash
curl -s -H "x-health-token: $HEALTH_CHECK_SECRET" https://pracuj.be/api/health
# emailProvider: "emaillabs", checks.emailProviderReady: true, checks.emaillabsWebhook: true
```

**Rollback na Resend:** ustaw `EMAIL_PROVIDER=resend` (z `RESEND_API_KEY`) i wykonaj redeploy.
Wiersze kolejki czekają w bazie, niczego nie trzeba przenosić. Jawna wartość bez kluczy
wybranego dostawcy blokuje wysyłkę (`ok: false`, 503 cronu). Kod nie przełącza się po cichu
na drugiego dostawcę.

---

## 3. Gwarancje transportu (co robi kod)

| Gwarancja | Resend | EmailLabs |
|---|---|---|
| Idempotencja ponowień | nagłówek `Idempotency-Key` = UUID wiersza | EmailLabs nie ma odpowiednika. Kod sam nadaje `messageId` = `<UUID wiersza>@<domena From>`. **Przed każdą wysyłką** sprawdza `GET /v2.1/email?messageId=…`. Jeśli list już istnieje (odpowiedź zginęła albo nie zapisał się ACK), potwierdza go bez ponownej wysyłki. Błąd sprawdzenia to `provider_unavailable` (ponowienie później zamiast ryzyka duplikatu). |
| ACK | tylko z `id` z odpowiedzi | tylko przy HTTP 200 z naszym `messageId` w `data[].to[]` |
| `provider_message_id` | `id` Resend | nadany `messageId`. Ten sam wraca w webhookach (`to.messageId`). |
| `text/plain` + HTML | tak | `content.text` + `content.html` |
| `List-Unsubscribe` / `-Post` | nagłówki | `headers` (EmailLabs nie nadpisuje własnego linku, a funkcja panelu jest wyłączona — pkt 1.2) |
| Tracking | wyłączony na koncie | `X-TRACKING-OFF: 1` w każdym liście + wyłączenie w panelu (pkt 1.2) |
| Kody błędów | `EMAIL_PROVIDER_UNAVAILABLE` / `EMAIL_PROVIDER_REJECTED` | HTTP 429, 5xx, 401/403, timeout, sieć → `UNAVAILABLE`; 400, 207, 404 → `REJECTED`. Komunikat dostawcy nie trafia do bazy ani do Sentry. |
| Temat | bez limitu | API przyjmuje ≤ 128 znaków. Dłuższy temat jest skracany z „…”. |

Retry i backoff, budżety wysyłki (`take_email_send_budget`), ponowna kontrola zgody przy
claimie i blokady adresów działają bez zmian, niezależnie od dostawcy.

Ograniczenie deduplikacji: sprawdzenie widzi list, gdy EmailLabs zarejestrował go w raportach.
Opóźnienie jest znacznie krótsze niż dzierżawa wiersza (300 s), po której wiersz wraca do
kolejki. Nie ma więc sytuacji, w której ponowienie następuje sekundy po przyjęciu listu.

---

## 4. Webhook — weryfikacja i mapowanie

EmailLabs podpisuje każde żądanie nagłówkami `X-Webhook-Date`, `Request-Id` i
`X-Webhook-Checksum` = `SHA1(SecretKey|X-Webhook-Date|Request-Id)`. Suma **nie obejmuje
treści**, dlatego:

- `Request-Id` jest kluczem inboxu `processed_webhooks` (`emaillabs:<Request-Id>`): ta sama
  paczka nie zostanie zapisana drugi raz,
- przy ustawionych zmiennych Basic auth wymagany jest też nagłówek `Authorization` (zalecane),
- świeżość `X-Webhook-Date` nie jest sprawdzana, bo dokumentacja nie podaje formatu ani
  strefy czasowej. Przed powtórzeniem chroni inbox.

Kolejność: brak sekretu albo bazy → 503, zła suma lub Basic auth → 401, body > 1 MB → 413,
nie-JSON → 400. Zdarzenia spoza modelu i uszkodzone są pomijane, bo EmailLabs zaleca nie
odrzucać paczki. Wszystkie zdarzenia paczki zapisują się w jednej transakcji
(`record_email_event`). Błąd → 500 i EmailLabs ponawia (zapis jest idempotentny). Sukces →
`200 ok`. EmailLabs czeka na odpowiedź 500 ms.

| Status EmailLabs | Model portalu | Blokada adresu |
|---|---|---|
| `ok` | `delivered` | — |
| `hardbounce` | `bounced` (trwałe) | **tak** (`email_suppressions`, `hard_bounce`) |
| `softbounce` | `bounced` (przejściowe) | nie |
| `spambounce` | `bounced` (nieokreślone) | nie. Serwer odbiorcy odrzucił treść jako spam; to nie jest skarga odbiorcy. |
| `deferred` | `delivery_delayed` | — |
| `injected`, `dropped`, inne | pomijane | — |

EmailLabs nie przekazuje w tym webhooku skarg odbiorców (FBL). Zdarzenie `complained` z tego
źródła nie powstaje, a blokadę adresu daje tylko trwałe odbicie.

---

## 5. Test po konfiguracji

1. `/api/health` z tokenem → `emailProvider: "emaillabs"`, `emailProviderReady: true`.
2. Załóż konto testowe na własny adres. Mail potwierdzenia powinien przyjść z domeny portalu,
   z poprawnym DKIM/SPF (sprawdź nagłówek `Authentication-Results`).
3. Pobierz oryginał wiadomości z powiadomieniem (`.eml`) i uruchom
   `node scripts/check-received-eml.mjs wiadomosc.eml`
   ([`RESEND_SETUP.md`](./RESEND_SETUP.md), „Tracking otwarć i kliknięć”). Obcy host w linkach
   albo piksel oznacza, że tracking jest nadal włączony w panelu.
4. Wyślij list na adres, który nie istnieje. Po raporcie `hardbounce` adres pojawi się
   w `/admin/poczta`.

Testy automatyczne działają bez sieci (atrapa HTTP): `tests/unit/emaillabs-transport.test.ts`
i `tests/unit/emaillabs-webhook.test.ts`.

Źródła: dokumentacja EmailLabs (<https://docs.emaillabs.io>), specyfikacja API
(<https://apidocs.emaillabs.io>, `POST/GET /v2.1/email`, sekcja „Incoming webhooks”).
