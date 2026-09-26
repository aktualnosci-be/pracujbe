# PROJEKT — do weryfikacji prawnika, nieopublikowany

> Szkic roboczy do issue #499. Nie jest opinią prawną ani decyzją. Fakty pochodzą z kodu
> (stan na 2026-09-24) i są opisane szczegółowo w [`docs/JOB_FUNNEL.md`](../JOB_FUNNEL.md).
> Oceny prawne są sformułowane jako pytania. Treść banera, polityki prywatności i opisu
> statystyk dla pracodawców nie jest tu zmieniana.

| Pole | Wartość |
|---|---|
| Wersja | 0.1 (szkic) |
| Przepływ | serwerowy lejek ofert (#99): `search_appearance`, `detail_view`, `apply_started` |
| Właściciel decyzji | _do uzupełnienia_ |
| Data decyzji | _do uzupełnienia_ |

## 1. Fakty z kodu (skrót)

1. Po załadowaniu listy ofert, szczegółu oferty i po otwarciu formularza „Aplikuj” skrypt
   w przeglądarce wysyła `POST /api/job-funnel` z treścią `{event, nonce, jobIds}`.
2. `nonce` to losowy UUID wygenerowany w przeglądarce (`crypto.randomUUID()`) raz na
   wyświetlenie. Istnieje tylko w pamięci karty; nie jest zapisywany ani odczytywany
   z urządzenia. Odświeżenie strony daje nowy nonce.
3. Lejek nie zapisuje i nie odczytuje cookies, localStorage, sessionStorage ani IndexedDB.
   Żądanie idzie z `credentials: 'omit'` (bez cookies), odpowiedź nie ustawia cookies.
   Dowód: test przeglądarkowy `tests/e2e/job-funnel-no-storage.spec.ts` (w CI, z kontrolą
   ujemną).
4. **Zdarzenia są wysyłane niezależnie od wyboru w banerze cookies** — przed decyzją, po
   odmowie i po wycofaniu zgody. Kod lejka nie czyta stanu zgody.
5. Przeglądarka dołącza do żądania standardowe dane: adres IP, `User-Agent`, nagłówki
   `Sec-Fetch-*`, `Referer` (adres strony, także z parametrami filtrów listy).
6. Serwer używa `User-Agent` i nagłówków prefetch tylko do odrzucenia botów (w pamięci),
   a IP tylko w limiterze: HMAC z losową solą procesu, mapa w pamięci zerowana co 60 s.
   Nic z tego nie trafia do bazy ani do logów aplikacji.
7. Baza zapisuje: sumy dzienne per oferta (`job_funnel_daily`) oraz `(nonce, event,
   created_at)` do deduplikacji (`job_funnel_receipts`). Brak IP, User-Agent, cookie,
   identyfikatora konta.
8. `job_funnel_receipts`: kasowanie wierszy starszych niż 2 dni odbywa się tylko przy
   kolejnym zapisie (najwyżej 200 na zapis) — **brak twardego terminu retencji**.
9. Niezależnie od lejka middleware next-intl ustawia sesyjne cookie `NEXT_LOCALE`
   (`Path=/; SameSite=Lax`). Lejek go nie używa.
10. Poza kodem, nieustalone: logi dostępu Railway/proxy (czy zapisują IP, User-Agent,
    ścieżkę i jak długo) (webhook błędów #571 nie dołącza danych żądania — tylko kod i szablon trasy).

## 2. Pytania do prawnika — art. 5 ust. 3 dyrektywy ePrivacy

1. Czy wygenerowanie `nonce` przez skrypt w przeglądarce i wysłanie go do serwera (fakty 1–2)
   jest „uzyskaniem dostępu do informacji przechowywanych w urządzeniu” w rozumieniu art. 5
   ust. 3, w świetle wytycznych EDPB 2/2023 (część 3.2, informacje generowane lokalnie)?
2. Czy samo wysłanie żądania przez skrypt (z IP, User-Agent, Referer — fakt 5) jest takim
   dostępem, skoro wysyła je przeglądarka przy każdym żądaniu, a skrypt decyduje tylko
   o jego wykonaniu?
3. Jeśli art. 5 ust. 3 ma zastosowanie: czy pomiar liczby wyświetleń ofert dla pracodawców
   jest „ściśle niezbędny” do świadczenia usługi wyraźnie żądanej przez użytkownika
   (odwiedzającego) — czy też jest to usługa dla innego odbiorcy (pracodawcy)?
4. Jak stanowisko belgijskiego APD o braku wyjątku dla cookies pomiaru oglądalności
   (first-party) przekłada się na ten mechanizm bez cookies i bez identyfikatora trwałego?
5. Czy zdarzenie `apply_started` (otwarcie formularza) należy oceniać inaczej niż
   `detail_view` i `search_appearance`?
6. Czy cookie `NEXT_LOCALE` (fakt 9) wymaga osobnej oceny (np. jako ściśle niezbędne dla
   wyboru języka)?

## 3. Pytania do prawnika — RODO

1. Czy którekolwiek z danych w bazie (fakt 7) są danymi osobowymi? Czy `nonce` razem
   z `created_at` pozwala wyróżnić osobę, jeśli dostępne są też logi infrastruktury (fakt 10)?
2. Czy przetwarzanie IP w limiterze w pamięci (fakt 6) wymaga podstawy prawnej i informacji
   w polityce prywatności? Czy ochrona endpointu przed nadużyciem jest celem odrębnym od
   pomiaru (issue #499 pkt 4)?
3. Jaka podstawa z art. 6 i jaki zakres obowiązku informacyjnego z art. 13 dotyczy tego
   przepływu, niezależnie od odpowiedzi na pytania z części 2?
4. Czy retencja `job_funnel_receipts` bez twardego terminu (fakt 8) jest akceptowalna, czy
   wymagany jest termin wymuszony zadaniem okresowym?
5. Czy logi Railway/proxy (fakt 10) wymagają osobnej umowy powierzenia, retencji lub
   minimalizacji?

## 4. Warianty techniczne (do wyboru po decyzji, bez zmian w tej wersji)

| Wariant | Co zmienia w kodzie | Skutek dla statystyk |
|---|---|---|
| Z zgodą | `JobFunnelBeacon` i `reportApplyStarted` wysyłają tylko przy zgodzie w kategorii analitycznej; brak wysyłki przed decyzją, po odmowie i po wycofaniu; test przeglądarkowy trzech ścieżek | liczby niepełne; opis w `/employer/statystyki` musi to mówić |
| Bez zgody | udokumentowany wyjątek i jego zakres; twardy termin retencji receipts (zadanie w `/api/maintenance`); potwierdzona retencja logów infrastruktury | liczby pełne (z wyłączeniem botów) |

W obu wariantach limiter (ochrona przed nadużyciem) może zostać niezależnie od decyzji
o pomiarze. W żadnym wariancie nie dodajemy identyfikatora kandydata, cookie ani fingerprintu
bez ponownej oceny.

## 5. Do uzupełnienia po decyzji

| Pytanie | Odpowiedź | Uzasadnienie | Podpis / data |
|---|---|---|---|
| Art. 5 ust. 3 ma zastosowanie? | | | |
| Wyjątek ścisłej konieczności? | | | |
| Podstawa RODO | | | |
| Retencja receipts | | | |
| Retencja logów infrastruktury | | | |
| Wybrany wariant (4) | | | |
