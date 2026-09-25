# Lejek ofert — dokumentacja techniczna (#99, #499, #575)

Opis tego, co dzieje się z danymi, gdy strona oferty lub lista ofert zgłasza zdarzenie lejka.
Same fakty z kodu (stan na 2026-09-25). Ocena prawna (ePrivacy, RODO) jest w szkicu
[`docs/legal-drafts/eprivacy-lejek.md`](legal-drafts/eprivacy-lejek.md).

## 1. Zdarzenia i moment wysyłki

| Zdarzenie | Kiedy | Kod | Oferty w jednym żądaniu |
|---|---|---|---|
| `search_appearance` | lista `/oferty-pracy` pokazała stronę wyników | `JobFunnelBeacon` w `src/app/[locale]/(public)/oferty-pracy/page.tsx` | do 50 |
| `detail_view` | wyświetlenie szczegółu oferty | `JobFunnelBeacon` w `.../oferty-pracy/[slug]/page.tsx` | 1 |
| `apply_started` | otwarcie formularza „Aplikuj” | `reportApplyStarted` w `src/components/public/ApplyModal.tsx` | 1 |

- Wysyłka następuje po załadowaniu strony, gdy karta jest widoczna (`whenPageVisible`: nie w
  prerenderze ani w tle).
- Oferty demonstracyjne (`isDemo`) nie wysyłają zdarzeń.
- **Wysyłka tylko po zgodzie w kategorii analitycznej banera cookies** (decyzja właściciela
  z 25.09.2026, #575; `src/lib/job-funnel/client.ts`):
  - zgoda jest czytana z cookie `pracujbe_consent` tuż przed wysyłką (`sendFunnelEvent`), więc
    odmowa albo wycofanie w innej karcie i zapisana odmowa po restarcie przeglądarki blokują
    kolejne zdarzenia; zgoda ze starej wersji polityki = brak decyzji; sama zgoda marketingowa
    nie wystarcza; trasy prywatne (`allowsTrackingOnPath`) nigdy nie mierzą;
  - przed decyzją wyświetlenie (`detail_view`, `search_appearance`) czeka w pamięci karty
    (`whenFunnelConsent`) i wychodzi dopiero po zgodzie analitycznej udzielonej w tej karcie;
    odmowa lub zapis bez analityki czyści oczekujące zdarzenia, a zmiana strony
    (odmontowanie wyspy) je anuluje — przy opuszczeniu strony nic nie jest wysyłane;
  - `apply_started` bez zgody nie jest wysyłane ani kolejkowane.
- Dowód: `tests/unit/job-funnel-consent.test.tsx` (kontrola ujemna: bez bramki w
  `sendFunnelEvent` testy są czerwone) i `tests/e2e/job-funnel-no-storage.spec.ts` (4 języki:
  przed decyzją, po „Tylko niezbędne”, po wycofaniu w tej i w drugiej karcie, zmiana strony,
  odświeżenie, restart z zapisaną odmową = zero żądań; ze zgodą zdarzenia wychodzą).
- Panel `/employer/statystyki` informuje, że pojawienia, wyświetlenia i rozpoczęte aplikowanie
  pochodzą tylko od osób ze zgodą (`jobFunnel.consentNote`); wysłane aplikacje liczone są
  wszystkie (ze stanu `applications`).

## 2. Co wychodzi z przeglądarki

`fetch('/api/job-funnel', { method: 'POST', credentials: 'omit', cache: 'no-store', keepalive: true })`
(`src/lib/job-funnel/client.ts`).

Treść żądania (JSON, limit 4096 B po stronie serwera):

```json
{ "event": "detail_view", "nonce": "<losowy UUID v4>", "jobIds": ["<UUID oferty>"] }
```

- `nonce` = `crypto.randomUUID()` wygenerowany w przeglądarce raz na wyświetlenie danego zestawu
  ofert. Trzymany wyłącznie w pamięci karty (`useRef`, `Map` w module). Odświeżenie strony =
  nowy nonce. `apply_started` używa nonce bieżącego wyświetlenia szczegółu.
- `credentials: 'omit'`: przeglądarka nie dołącza cookies do żądania i ignoruje `Set-Cookie`
  w odpowiedzi.
- Przeglądarka dołącza zwykłe nagłówki żądania (m.in. `User-Agent`, `Sec-Fetch-*`,
  `Referer` — dla żądania z tej samej domeny przy `Referrer-Policy: strict-origin-when-cross-origin`
  z `next.config.mjs` jest to pełny adres strony, np. `/pl/oferty-pracy?city=...`) oraz adres IP połączenia.

## 3. Co zostaje w urządzeniu

Nic. Lejek nie zapisuje cookies, `localStorage`, `sessionStorage` ani IndexedDB i nie
odczytuje z nich niczego.

Dowód (po zgodzie): `tests/e2e/job-funnel-no-storage.spec.ts` (serwer fixture, w CI w jobie `e2e`):
- stan cookies/localStorage/sessionStorage/IndexedDB jest identyczny w chwili wysyłki
  zdarzenia i po nim, dla `search_appearance`, `detail_view` i `apply_started`;
- nonce nie występuje w żadnym z tych magazynów;
- żądanie lejka nie ma nagłówka `Cookie`, mimo że strona ma cookie (sonda testu);
- odpowiedź nie ma `Set-Cookie`;
- jedyne cookies strony to sonda testu, `pracujbe_consent` i `NEXT_LOCALE`.

Kontrola ujemna wykonana ręcznie przy tej zmianie: klient z `credentials: 'include'` i zapisem
nonce do `sessionStorage` daje czerwone oba testy zdarzeń. Test porównujący stan ma też własną
kontrolę ujemną (zapis do `localStorage` i `document.cookie` jest wykrywany).

Niezależnie od lejka odpowiedź strony (middleware next-intl) ustawia cookie sesyjne
`NEXT_LOCALE` (`Path=/; SameSite=Lax`, bez `Max-Age`). Lejek go nie czyta ani nie wysyła.

## 4. Co robi serwer (`src/app/api/job-funnel/route.ts`)

Kolejność: limit rozmiaru → parsowanie → walidacja (zdarzenie z listy, nonce i oferty jako UUID)
→ filtr botów/prefetch → limiter → zapis.

- **Filtr** (`request-filter.ts`): decyzja na podstawie `User-Agent`, nagłówków prefetch i
  `Sec-Fetch-Site`, podjęta w pamięci. Nagłówki nie są zapisywane ani logowane.
- **Limiter** (`rate-limit.ts`): 60 zdarzeń/min na adres. Klucz = HMAC-SHA256(adres IP) z losową
  solą generowaną przy starcie procesu, skrócony do 22 znaków; mapa w pamięci procesu, zerowana
  co 60 s, najwyżej 50 000 kluczy. Adres pochodzi z `x-real-ip` albo ostatniego wpisu
  `x-forwarded-for`. Nic nie trafia do bazy ani logów.
- **Odpowiedź**: 204 dla każdej poprawnej próby (także bota i duplikatu), 400/413/429 przy
  błędach; zawsze `Cache-Control: private, no-store`, nigdy `Set-Cookie`.
- **Błąd zapisu**: `captureError` (Sentry) z polami `area` i `event`; bez nonce, ofert, IP.

## 5. Co trafia do bazy (migracja `0089_job_funnel.sql`)

| Tabela | Kolumny | Retencja |
|---|---|---|
| `job_funnel_daily` | `job_id`, `day` (data w Europe/Brussels), `search_appearances`, `detail_views`, `apply_started`, `updated_at` | bieżący i 12 poprzednich miesięcy kalendarzowych (≤ 13), dzień w Europe/Brussels; wcześniej usuwane także kaskadowo z ofertą |
| `job_funnel_receipts` | `nonce`, `event`, `created_at` | najwyżej 48 h (absolutnie) |

- Liczone są tylko oferty publiczne firm `verified`.
- Brak kolumn: IP, User-Agent, cookie, identyfikator konta, tekst wyszukiwania, adres strony.
- Zapis: RPC `record_job_funnel_event` wyłącznie z transakcji endpointu (bramka
  `pracujbe.funnel_writer`). Tabele bez uprawnień dla `anon`/`authenticated`.
- Odczyt: `get_company_job_funnel` — recruiter+ firmy oferty; zwraca sumy dzienne oraz
  `applications_submitted` liczone ze stanu `applications`.
- **Terminy (migracja `0130`, #575):** `purge_job_funnel_data` (service_role, partie
  `SKIP LOCKED`, same liczniki) woła `/api/maintenance` co godzinę — receipts starsze niż
  48 h i agregaty sprzed `job_funnel_retention_cutoff(now())` (1. dzień miesiąca 12 miesięcy
  przed bieżącym) znikają niezależnie od ruchu. `record_job_funnel_event` sprząta receipts
  > 48 h przed zapisem, więc okno deduplikacji = termin przechowywania. Dowód: `rls.sql`
  sekcja FC575 (kontrola ujemna: bez zadania dane poza terminem zostają), `tests/unit/job-funnel-retention.test.ts`.

## 6. Poza kodem (do potwierdzenia)

- Logi dostępu Railway / proxy (czy i jak długo zapisują IP, User-Agent, ścieżkę żądania).
- Sentry: `sendDefaultPii: false` i `beforeSend: redactSentryEvent` (`sentry.*.config.ts`);
  do potwierdzenia, czy SDK dołącza adres żądania (`Referer`/URL) do zdarzenia błędu.
- Serwer nie zapisuje `Referer`, ale dociera on do procesu i do infrastruktury (logi).
