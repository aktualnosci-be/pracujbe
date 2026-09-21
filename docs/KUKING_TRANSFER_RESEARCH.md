# Wzorce z Kuking przydatne w Pracuj.be

Stan analizy: 21 września 2026. Audytowany punkt repozytorium
`woogitsu/kuking.pl`: `6294fce1fbc06c5ddaa63a4d832a2ac89b605b94` (`main`).

## Cel i granice

Kuking i Pracuj.be mają inne produkty oraz stosy. Nie przenosimy kodu Laravel
do Next.js ani funkcji społeczności kulinarnej do portalu pracy. Wykorzystujemy
sprawdzone wzorce dotyczące poczty, moderacji, zgodności, eksploatacji i jakości.

Wnioski dotyczące DSA są kierunkiem produktu i architektury, a nie poradą
prawną. Przed uruchomieniem trzeba potwierdzić kwalifikację usługi, podmiotu i
ewentualne wyłączenia dla mikro- lub małego przedsiębiorcy z prawnikiem
znającym belgijskie i unijne prawo usług cyfrowych.

## Co Pracuj.be już ma

- Next.js 15, React 19, TypeScript, PostgreSQL i docelowe wdrożenie Railway.
- Własne role bazodanowe i RLS, Better Auth oraz prywatny transport plików.
- Kolejkę e-mail opartą na bazie: dzierżawy, `SKIP LOCKED`, próby, wygasanie
  tokenów, idempotencję i usuwanie tokenu po zakończeniu.
- Resend, React Email, cztery istniejące języki interfejsu i plan rozszerzenia
  do sześciu języków.
- Sentry, audyt działań administratora, podstawowy panel zgłoszeń i endpoint
  gotowości.

To oznacza, że nie trzeba przepisywać fundamentów. Trzeba domknąć ich obsługę
produkcyjną oraz rozbudować prosty model zgłoszeń.

## 1. Poczta: przenieść jakość operacyjną, nie nazwę dostawcy

### Wzorce z Kuking

- Adapter EmailLabs sprawdza semantykę odpowiedzi dostawcy, a nie tylko kod
  HTTP 2xx, redaguje błędy i nie zapisuje sekretów ani pełnej odpowiedzi.
- Wiadomości marketingowe mają jednorazowe wypisanie przez nagłówki
  `List-Unsubscribe` i `List-Unsubscribe-Post`, link w HTML oraz tekst zwykły.
- Osobne budżety chronią wiadomości transakcyjne przed wykorzystaniem limitu
  przez digest lub inne wysyłki masowe. Rezerwacja limitu jest atomowa.
- Błędy wysyłki są trwałym stanem, mają alarmy i można je ponowić; `/health`
  nie uznaje za sprawny transportu, który tylko zapisuje list do logu.
- Tracking jest świadomie kontrolowany. Wyłączenie śledzenia linków nie jest
  automatycznie dowodem wyłączenia piksela otwarć.

### Czego z Kuking nie kopiować

- Audytowany kod nie obsługuje jeszcze webhooków bounce, complaint ani
  suppression; ten brak trzeba uzupełnić także w Pracuj.be.
- Zgoda na digest jest sprawdzana przed zakolejkowaniem, lecz długie opóźnienie
  między kolejką a wysyłką tworzy okno po wypisaniu. Worker Pracuj.be powinien
  sprawdzać aktualną zgodę bezpośrednio przed emisją marketingową.
- Zwykły podpisany `GET` nie powinien zmieniać preferencji, bo skanery linków w
  skrzynkach mogą go wywołać. Jednoklikowe wypisanie realizuje standardowy
  `POST`; wejście przeglądarkowe pokazuje potwierdzenie.
- Ponawianie po timeout bez idempotencji dostawcy może wysłać dublet. Obecny
  `idempotencyKey` Resend w Pracuj.be należy zachować w każdym adapterze.

### Rekomendacja dla Pracuj.be

Pozostać przy Resend na start. Obecny outbox jest mocnym fundamentem. Dodać:

1. webhook dostawcy z weryfikacją podpisu i idempotentnym inboxem;
2. stany `delivered`, `bounced`, `complained`, `suppressed` obok technicznego
   `sent` oraz listę blokad dla adresów z trwałym odbiciem/skargą;
3. alarm najstarszej wiadomości, liczby prób i przyrostu błędów;
4. atomowe pule dla poczty auth, transakcyjnej i newslettera;
5. standard wypisywania, centrum preferencji i dowód zgody;
6. test produkcyjny potwierdzający brak śledzenia, jeżeli taką politykę
   przyjmiemy; sama konfiguracja SDK nie wystarcza;
7. interfejs dostawcy, aby EmailLabs lub SES można było dodać bez zmiany logiki
   kolejki. Migracja z Resend ma sens dopiero po pomiarze ceny i doręczalności.

## 2. DSA i moderacja ofert

Publiczne oferty oraz profile firm są treścią dostarczaną przez użytkowników.
Kuking implementuje pełny cykl, którego w Pracuj.be jeszcze nie ma:

```text
zgłoszenie konkretnej treści
→ numer sprawy i potwierdzenie
→ kolejka z terminem
→ decyzja z podstawą prawną lub regulaminową
→ powiadomienie autora i zgłaszającego
→ odwołanie rozpatrywane przez człowieka
→ zachowany audyt i kontrolowana retencja
→ zagregowany raport przejrzystości
```

Formularz powinien działać także bez konta, wskazywać dokładną treść i miejsce,
pozwalać uzasadnić nielegalność oraz składać oświadczenie w dobrej wierze.
Nie może ujawniać treści prywatnej ani danych zgłaszającego drugiej stronie.

Decyzja moderacyjna powinna przechowywać rodzaj ograniczenia, zasięg, fakty,
podstawę regulaminową lub prawną, informację o użyciu automatyzacji i dostępne
środki odwoławcze. Egzekucja decyzji i jej zapis muszą być jedną operacją
domenową; sam wpis „rozstrzygnięte” bez rzeczywistego ukrycia oferty jest
niebezpieczny.

Trzeba dodatkowo objąć tym procesem oszustwa rekrutacyjne, podszywanie się pod
firmę, dyskryminujące oferty, handel danymi kandydatów, nielegalne warunki pracy
i fałszywe informacje o wynagrodzeniu. Automaty może jedynie priorytetyzować i
flagować; o sankcji decyduje człowiek.

Nie należy kopiować otwartych luk z audytowanego repo: ponowne zastosowanie
moderacji po skutecznym odwołaniu zgłaszającego musi być pełną operacją
domenową, a dokumentacja DPA, kopii zapasowych i zakresu eksportu wymaga
niezależnego odbioru przed produkcją.

## 3. RODO, retencja i bezpieczeństwo danych kandydatów

Z Kuking warto przenieść jawne harmonogramy retencji dla każdej kategorii oraz
regułę, że rollback nie może po cichu zmienić znaczenia zgody, widoczności lub
żądania usunięcia.

Dla Pracuj.be potrzebna jest macierz obejmująca konta, profile, CV, aplikacje,
wiadomości, zgłoszenia, odwołania, logi audytowe, tokeny i dane pocztowe. Każdy
okres ma właściciela, podstawę, automatyczne czyszczenie, raport wyniku i tryb
`dry-run`. Retencja sprawy moderacyjnej nie może usunąć dowodów przed końcem
okresu odwoławczego.

Eksport i usunięcie konta muszą być odporne na wznowienia, awarie oraz wyścigi.
Historia wykonania zadania nie może zostać usunięta zanim operator potwierdzi,
że powstał kompletny eksport lub że żądanie usunięcia zakończyło się poprawnie.

## 4. Eksploatacja i jakość

Najbardziej przenośne praktyki z Kuking:

- osobne pojęcia gotowości wdrożenia, ciągłego uptime i zdrowia zależności;
- alarmy kolejki na podstawie wieku najstarszej pracy, nie tylko liczby rekordów;
- pomiar wykorzystania puli połączeń PostgreSQL i pozostawienie rezerwy;
- CSP z raportowaniem, redakcją URL i danych użytkownika oraz limitem żądań;
- ścisła `Referrer-Policy`, szczególnie na stronach z tokenami;
- testy zabraniające nieoczekiwanych wywołań HTTP;
- test ujemny dla każdej istotnej ochrony: celowo zepsuć warunek i wykazać,
  że test rzeczywiście robi się czerwony;
- procedura rollbacku mówi prawdę: cofnięcie kodu nie cofa migracji danych;
- okresowe zadania mają blokadę przed równoległym wykonaniem i raport wyniku.

## 5. Technologie, które warto zachować lub rozważyć

| Obszar       | Kuking                                      | Kierunek Pracuj.be                                                     |
| ------------ | ------------------------------------------- | ---------------------------------------------------------------------- |
| Architektura | modularny monolit Laravel                   | zachować modularny monolit Next.js                                     |
| Baza         | PostgreSQL 18                               | zachować PostgreSQL Railway                                            |
| Kolejki      | tabela i worker Laravel                     | zachować DB outbox/cron; bez Redisa bez pomiaru                        |
| Wyszukiwanie | `pg_trgm`, `unaccent`, GIN                  | wdrożyć po migracji danych; dobre dla wielojęzycznych nazw i literówek |
| Poczta       | EmailLabs API                               | Resend teraz, adapter dostawcy i benchmark EmailLabs/SES później       |
| Anty-bot     | Cloudflare Turnstile                        | dodać na rejestrację, reset, kontakt, aplikowanie i zgłoszenia         |
| Analityka    | własne zdarzenia + Cloudflare Web Analytics | ograniczyć cookies; rozważyć ten sam model prywatności                 |
| Pliki        | prywatny R2 i podpisane URL                 | obecny prywatny adapter Railway; R2, gdy potrzebne są repliki/CDN      |
| Monitoring   | webhook błędów + czujki                     | Sentry + alerty domenowe i zewnętrzny uptime                           |
| PWA          | manifest i ostrożny service worker          | obecny manifest/offline; nie cache'ować paneli i danych prywatnych     |

Nie warto teraz dodawać mikroserwisów, Kafki, GraphQL, Elasticsearch,
WebSocketów ani Redisa. Kuking potwierdza, że dojrzały portal można prowadzić
na PostgreSQL i kolejce bazodanowej, a cięższe elementy dodawać po pomiarze.

## Proponowana kolejność

Realizacja jest śledzona przez epic [#39](https://github.com/aktualnosci-be/pracujbe/issues/39)
i issues [#40](https://github.com/aktualnosci-be/pracujbe/issues/40)–[#47](https://github.com/aktualnosci-be/pracujbe/issues/47).

### P0 — przed szerokim otwarciem

1. Ustalić kwalifikację DSA i właściciela procesu prawnego.
2. Zbudować kompletne zgłoszenie nielegalnej treści oraz model sprawy.
3. Powiązać decyzję z rzeczywistym ukryciem/ograniczeniem oferty lub firmy.
4. Domknąć pocztę auth/transakcyjną: webhooki, odbicia, skargi i alerty.
5. Dodać Turnstile i limity do krytycznych publicznych formularzy.

### P1 — przed kampaniami i newsletterem

1. Odwołania, terminy i komunikacja obu stron.
2. Preferencje, wypisanie jednym kliknięciem i dowody zgód.
3. Macierz retencji, eksport oraz usunięcie konta.
4. Raport przejrzystości i przygotowanie eksportu wymaganych danych.
5. Czujki kolejki, połączeń, CSP i zewnętrzny uptime.

### P2 — po danych produkcyjnych

1. Benchmark Resend, EmailLabs i SES na realnej doręczalności i kosztach.
2. PostgreSQL `pg_trgm` + `unaccent` dla wyszukiwania ofert.
3. Cloudflare Web Analytics i własne, minimalne zdarzenia serwerowe.
4. Pomocnicze flagowanie ryzyka oszustwa przez AI z obowiązkową decyzją człowieka.

## Źródła wewnętrzne audytu Kuking

- `app/Poczta/TransportEmailLabs.php`
- `app/Domain/Security/DziennyBudzetListow.php`
- `app/Domain/Digest/OdnosnikWypisania.php`
- `app/Domain/Moderation/Actions/ZglosNielegalnaTresc.php`
- `app/Domain/Moderation/Actions/ResolveAppeal.php`
- `app/Domain/Compliance/PrzedawnioneSprawyModeracyjne.php`
- `docs/legal/MODERATION_PLAYBOOK.md`
- `app/Http/Controllers/HealthController.php`
- `app/Http/Controllers/CspReportController.php`
- `app/Domain/Polaczenia/StanPolaczenBazy.php`
- `database/migrations/2026_09_05_001300_fix_search_indexes.php`

## Źródła prawne i urzędowe

- Rozporządzenie (UE) 2022/2065, w szczególności art. 16, 17, 20, 24 i 15.
- Komisja Europejska: DSA notice-and-action mechanism.
- Komisja Europejska: DSA Transparency Database i wyjaśnienia statements of reasons.
