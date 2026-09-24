# Lejek ofert — dokumentacja techniczna (#99, #499)

Opis tego, co dzieje się z danymi, gdy strona oferty lub lista ofert zgłasza zdarzenie lejka.
Same fakty z kodu (stan na 2026-09-24). Ocena prawna (ePrivacy, RODO) jest w szkicu
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
- **Wysyłka nie zależy od wyboru w banerze cookies.** Ani `JobFunnelBeacon`, ani
  `reportApplyStarted` nie czytają zgody (`src/lib/consent*.ts`). Zdarzenia idą także przed
  decyzją, po odmowie i po wycofaniu zgody.

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

Dowód: `tests/e2e/job-funnel-no-storage.spec.ts` (serwer fixture, w CI w jobie `e2e`):
- stan cookies/localStorage/sessionStorage/IndexedDB jest identyczny w chwili wysyłki
  zdarzenia i po nim, dla `search_appearance`, `detail_view` i `apply_started`;
- nonce nie występuje w żadnym z tych magazynów;
- żądanie lejka nie ma nagłówka `Cookie`, mimo że strona ma cookie (sonda testu);
- odpowiedź nie ma `Set-Cookie`;
- zgoda nie była udzielona (baner widoczny, brak cookie `pracujbe_consent`).

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
| `job_funnel_daily` | `job_id`, `day` (data w Europe/Brussels), `search_appearances`, `detail_views`, `apply_started`, `updated_at` | bez limitu (usuwane kaskadowo z ofertą) |
| `job_funnel_receipts` | `nonce`, `event`, `created_at` | co najmniej 2 dni; kasowanie tylko przy kolejnym zapisie, najwyżej 200 wierszy starszych niż 2 dni na zapis |

- Liczone są tylko oferty publiczne firm `verified`.
- Brak kolumn: IP, User-Agent, cookie, identyfikator konta, tekst wyszukiwania, adres strony.
- Zapis: RPC `record_job_funnel_event` wyłącznie z transakcji endpointu (bramka
  `pracujbe.funnel_writer`). Tabele bez uprawnień dla `anon`/`authenticated`.
- Odczyt: `get_company_job_funnel` — recruiter+ firmy oferty; zwraca sumy dzienne oraz
  `applications_submitted` liczone ze stanu `applications`.
- **Retencja receipts nie ma twardego terminu.** Przy braku ruchu stare wiersze zostają do
  następnego zdarzenia. Twardy termin wymaga zadania w `/api/maintenance` (osobna zmiana).

## 6. Poza kodem (do potwierdzenia)

- Logi dostępu Railway / proxy (czy i jak długo zapisują IP, User-Agent, ścieżkę żądania).
- Sentry: `sendDefaultPii: false` i `beforeSend: redactSentryEvent` (`sentry.*.config.ts`);
  do potwierdzenia, czy SDK dołącza adres żądania (`Referer`/URL) do zdarzenia błędu.
- Serwer nie zapisuje `Referer`, ale dociera on do procesu i do infrastruktury (logi).
