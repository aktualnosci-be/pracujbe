# PROJEKT — do weryfikacji prawnika, nieopublikowany

> Szkic roboczy do issue #504 (P1, bramka prywatności ochrony formularzy). Nie jest opinią
> prawną ani decyzją. Fakty pochodzą z kodu repozytorium (stan na 2026-09-25) i z publicznej
> dokumentacji Cloudflare (odnośniki w sekcji 6); oceny prawne są sformułowane jako pytania.
> Treść banera cookies, polityki prywatności i UI nie jest tu zmieniana — to zadanie
> wyłącznie dokumentacyjne. Powiązane: [`dostawcy-i-transfery.md`](dostawcy-i-transfery.md)
> §4 (skrót tego samego tematu), [`data-map.generated.md`](data-map.generated.md),
> `src/lib/privacy/processors.ts` (wpis `cloudflare-turnstile`), `docs/TURNSTILE.md` (opis
> techniczny mechanizmu), #46 (wdrożenie), #485/#488 (mapa danych i dostawcy), #493/#499
> (inna technologia: lejek statystyk ofert).

| Pole | Wartość |
|---|---|
| Wersja | 0.1 (szkic) |
| Przepływ | Cloudflare Turnstile — logowanie, rejestracja, reset hasła, zgłoszenie treści (`/zglos-tresc`), aplikowanie bez konta (`/aplikuj` gość), kontakt (`/kontakt`) |
| Właściciel decyzji | _do uzupełnienia_ |
| Data decyzji | _do uzupełnienia_ |

## 1. Co robi kod (fakty)

### 1.1 Gdzie widżet jest osadzony

`TURNSTILE_ACTIONS` (`src/lib/turnstile/policy.ts`) wylicza sześć chronionych przepływów, każdy
z własną nazwą akcji zwracaną przez Siteverify:

| Przepływ (kod akcji) | Formularz | Polityka awarii dostawcy | Plik akcji |
|---|---|---|---|
| `login` | Logowanie | fail-open | `src/lib/actions/auth.ts` (`signIn`) |
| `register` | Rejestracja kandydata/pracodawcy | fail-closed | `src/lib/actions/auth.ts` |
| `password_reset` | Reset hasła | fail-closed | `src/lib/actions/auth.ts` |
| `contact` | Formularz kontaktu `/kontakt` | fail-closed | `src/lib/actions/contact.ts` |
| `report` | Zgłoszenie treści `/zglos-tresc` | fail-closed | `src/lib/actions/content-reports.ts` |
| `guest_apply` | Aplikacja bez konta (ApplyModal) | fail-closed | `src/lib/actions/guest-applications.ts` |

Aplikowanie z konta nie ma osobnego widżetu (kandydat jest już zalogowany — chroni go widżet
logowania/rejestracji, limiter i idempotencja aplikacji).

Widżet renderuje `src/components/auth/TurnstileWidget.tsx` w trybie **explicit** (`render=explicit`
w adresie skryptu `api.js`, wywołanie `turnstile.render(...)` z poziomu komponentu) — strona sama
decyduje, kiedy i gdzie widżet się pojawi; to jest inny wybór niż tryb *implicit* (skrypt sam
szuka znacznika `cf-turnstile` na stronie), nie wybór między *managed*/*non-interactive*/
*invisible*. **Ten tryb (managed / non-interactive / invisible) jest ustawieniem samego
sitekey w panelu Cloudflare (Turnstile → widżet), nie parametrem, który kod przekazuje przy
renderze — kod portalu go nie wybiera i nie wymusza.** Parametry przekazywane do `render()`:
`sitekey`, `action` (z tabeli wyżej), `language` (locale strony), `theme: 'light'`,
`size: 'flexible'`/`'compact'` (zależnie od szerokości kontenera). Bez
`NEXT_PUBLIC_TURNSTILE_SITE_KEY` komponent nic nie renderuje i nie ładuje skryptu (`isTurnstileWidgetEnabled()`).

### 1.2 Co wysyła przeglądarka i co wysyła serwer

- **Przeglądarka → `challenges.cloudflare.com`:** skrypt widżetu (`api.js`) ładowany z
  `https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit`, dozwolony w CSP
  (`next.config.mjs`: `script-src` i `frame-src` z hostem `challenges.cloudflare.com` — to jedyne
  dopuszczenie w CSP dla tego dostawcy). **Co dokładnie ten skrypt wysyła do Cloudflare (jakie
  sygnały przeglądarki, w jakiej formie, z jaką częstotliwością) nie wynika z kodu portalu** —
  to jest kod dostawcy uruchamiany w przeglądarce odwiedzającego, poza kontrolą repozytorium.
- **Serwer → Siteverify** (`src/lib/turnstile/verify.ts`, `verifyTurnstileToken`): `POST
  https://challenges.cloudflare.com/turnstile/v0/siteverify` z ciałem `secret`, `response`
  (token z widżetu) i losowym `idempotency_key` (UUID wygenerowany na każde wywołanie, do
  bezpiecznego ponowienia samego zapytania sieciowego, nie tego samego tokenu — token jest
  jednorazowy). **Serwer świadomie NIE wysyła parametru `remoteip`** — kod nie odczytuje ani
  nie przekazuje adresu IP klienta do Siteverify. Serwer nie wysyła też treści żadnego pola
  formularza (imienia, e-maila, treści CV, treści zgłoszenia, treści wiadomości aplikacji) —
  jedynym polem formularza, które trafia do Cloudflare, jest sam token widżetu.
- **Weryfikacja odpowiedzi:** kod sprawdza `success`, `action` (musi zgadzać się z akcją
  z tabeli 1.1 — token wydany dla innego formularza jest odrzucany) i `hostname` (musi być na
  liście `TURNSTILE_ALLOWED_HOSTNAMES` albo równy hostowi `NEXT_PUBLIC_SITE_URL` — token z obcej
  domeny jest odrzucany). Kod odczytuje z odpowiedzi Siteverify tylko `success`, `action`,
  `hostname` i `error-codes` — nic więcej z tego, co Cloudflare mogłoby zwrócić, nie jest
  odczytywane ani zapisywane.

### 1.3 Co portal zapisuje i loguje

- Portal **nie zapisuje** tokenu Turnstile ani odpowiedzi Siteverify w bazie danych.
- Do kanału błędów (webhook Discorda, `captureError`) trafia wpis tylko przy `unavailable`
  (awaria dostawcy/konfiguracji): przepływ, powód (`timeout`/`network`/`bad_response`/
  `provider_error`/`unconfigured`), kody błędów Cloudflare (`error-codes`, same identyfikatory
  tekstowe, np. `internal-error`) i czy zdecydowano fail-open czy fail-closed. **Nigdy token ani
  IP** (komentarz w kodzie i test `turnstile-verify.test.ts`/`error-webhook.test.ts`). Odrzucone
  tokeny (zwykły ruch botów) nie są w ogóle zgłaszane, żeby nie zalewać kanału błędów.
- Portal nie ustawia żadnego własnego cookie powiązanego z Turnstile. Czy widżet lub skrypt
  Cloudflare ustawia cookie `cf_clearance` (patrz 1.4) nie wynika z kodu portalu — to zależy od
  ustawienia *pre-clearance* na koncie Cloudflare.

### 1.4 Pre-clearance i `cf_clearance` — czego kod NIE robi

Kod portalu nie odwołuje się nigdzie do cookie `cf_clearance`, nie czyta go i nie zależy od
niego. Według publicznej dokumentacji Cloudflare (sekcja 6), *pre-clearance* to opcjonalne
ustawienie widżetu w panelu Cloudflare: domyślnie widżet Turnstile wydaje tylko token
(jak opisano w 1.2); dopiero włączenie pre-clearance dla danego sitekey powoduje, że widżet
dodatkowo wystawia cookie `cf_clearance`, które zwalnia kolejne wyzwania WAF na danej strefie.
**Czy pre-clearance jest włączone dla sitekey użytego w produkcji, nie wynika z kodu — to
ustawienie w panelu Cloudflare, do sprawdzenia i zaprotokołowania (zadanie 1 issue, tabela w
sekcji 4).**

### 1.5 Awaria / zablokowany skrypt

Gdy skrypt `challenges.cloudflare.com` się nie załaduje (np. rozszerzenie blokujące, sieć firmowa,
awaria), `TurnstileWidget` po 15 sekundach przechodzi w stan `failed`: pokazuje komunikat
(`auth.botCheckLoadFailed`) i przycisk „Załaduj ponownie” (`botCheckRetry`), w regionie
`aria-live`. Przycisk wysyłki formularza nie jest zablokowany na stałe — próba wysłania bez
tokenu daje jasny komunikat przy widżecie (`botCheckRequired`), nie martwy przycisk. To jest
ścieżka dla urządzenia, które faktycznie ładuje skrypt, ale ładowanie się nie udaje (timeout,
błąd sieci). Osobny przypadek to urządzenie/sieć, które **trwale blokuje** `challenges.cloudflare.com`
(np. filtr treści, DNS sinkhole, restrykcyjna sieć firmowa) — w tym przypadku formularz zawsze
kończy w stanie `failed`, a dla przepływów fail-closed (rejestracja, reset hasła, kontakt,
zgłoszenie, aplikacja bez konta) wysyłka jest odrzucana kodem `BOT_CHECK_UNAVAILABLE` niezależnie
od liczby prób „Załaduj ponownie” — **kod nie ma dziś ścieżki zastępczej** (np. bez-JS-owego
wyzwania alternatywnego) dla takiego użytkownika. To jest przedmiot zadania 5 issue (patrz 4.5).

## 2. Role Cloudflare wg jego własnego Turnstile Privacy Addendum (publiczna dokumentacja, nie fakt z kodu)

Wg treści dostępnej publicznie pod adresem z sekcji 6 (do zweryfikowania na dzień decyzji —
addenda dostawców się zmieniają):

- Cloudflare wylicza sygnały zbierane przez Turnstile: **adres IP klienta, TLS fingerprint,
  nagłówek User-Agent oraz sitekey i powiązany origin**. Deklaruje, że nie ma możliwości
  bezpośredniej identyfikacji osoby fizycznej wyłącznie na podstawie tych sygnałów (w tym
  samego adresu IP).
- Cloudflare opisuje **dwie role**:
  1. **Podmiot przetwarzający** — gdy chroni witrynę operatora (portalu) zgodnie z jego
     instrukcjami (to jest przypadek pracuj.be jako klienta usługi);
  2. **Niezależny administrator** — gdy te same sygnały wykorzystuje do **własnego celu**:
     ulepszania skuteczności wykrywania botów przez Turnstile, na podstawie własnego,
     zadeklarowanego uzasadnionego interesu Cloudflare.
- Publicznie dostępna treść addendum, którą sprawdzono do tego szkicu, **nie zawiera** informacji
  o mechanizmie transferu międzynarodowego (SCC/moduły, Data Privacy Framework) ani o okresie
  retencji tych sygnałów przez Cloudflare — oba punkty wymagają sprawdzenia w aktualnych
  warunkach konta/DPA Cloudflare obowiązujących portal, nie samego tekstu addendum ogólnego.

**To nie jest ocena prawna** — to streszczenie deklaracji dostawcy, potrzebne jako punkt
wyjścia do pytań w sekcji 3. W szczególności podwójna rola (procesor + niezależny administrator
dla tego samego zestawu sygnałów) jest tym, co issue #504 każe **rozdzielić** w rejestrze
czynności (#485), a nie automatycznie przypisywać Cloudflare rolę procesora dla całości.

## 3. Pytania do prawnika

### 3.1 RODO — role i podstawy (zadanie 2–3 issue)

1. Czy przypisanie Cloudflare roli **podmiotu przetwarzającego** dla celu „ochrona formularzy
   portalu przed botami” (sygnały z 1.2–1.3, wyłącznie na instrukcję portalu) jest poprawne, czy
   wymaga dodatkowych zastrzeżeń w rejestrze czynności (#485)?
2. Czy **niezależny cel Cloudflare** (ulepszanie własnego wykrywania botów, sekcja 2) powinien
   być odnotowany w rejestrze jako odrębne przetwarzanie, którego administratorem jest
   Cloudflare, a nie portal — i czy portal ma z tego tytułu obowiązek informacyjny wobec
   odwiedzających (art. 13/14), skoro to Cloudflare, nie portal, ustala cele i sposoby tego
   drugiego przetwarzania?
3. Jaka podstawa z art. 6 uzasadnia wysyłkę tokenu do Siteverify dla celu portalu (ochrona
   formularzy) — uzasadniony interes (bezpieczeństwo/zapobieganie nadużyciom), czy inna?
4. Czy fakt, że dla przepływów fail-closed (3.1 tabela w sekcji 1.1) **formularz jest
   niedostępny bez Cloudflare** (awaria dostawcy = brak możliwości zarejestrowania się, zresetowania
   hasła, zgłoszenia treści czy aplikowania bez konta), wymaga dodatkowej analizy proporcjonalności
   albo dostępności usługi (zadanie 3 issue, zdanie o „formularzach zablokowanych przy
   niedostępnym dostawcy”)?
5. Czy aktualne DPA i lista podprocesorów na koncie Cloudflare używanym przez portal (nie ogólna
   treść addendum) obejmują ten zakres przetwarzania w obu rolach z sekcji 2?

### 3.2 ePrivacy — art. 5(3) (zadanie 3 issue)

1. Czy załadowanie skryptu `api.js` i sam widżet (bez pre-clearance — 1.4) mieści się w wyjątku
   „ściśle niezbędne do świadczenia usługi wyraźnie żądanej przez użytkownika” (tu: rejestracja/
   logowanie/reset/zgłoszenie/aplikacja, które użytkownik sam inicjuje), bez potrzeby zgody z
   banera cookies — czy `policy.ts` słusznie traktuje to jako mechanizm niezależny od zgód
   (Invariant #7), czy wymaga to odrębnego udokumentowania w polityce cookies jako „niezbędne”
   niezależnie od zgody?
2. Jeżeli na produkcyjnym sitekey **jest włączone pre-clearance** (cookie `cf_clearance`,
   sekcja 1.4) — czy to zmienia ocenę z pytania 1 (cookie trwalszy niż pojedynczy token,
   działający między żądaniami/stronami)? Domyślna, oczekiwana odpowiedź kodu to **brak
   `cf_clearance`** (portal nic go nie ustawia ani nie wymaga) — wymaga to jednak potwierdzenia
   ustawieniem w panelu (zadanie 1 issue), nie założenia.
3. Czy sam fakt przesłania standardowych nagłówków przeglądarki (IP, User-Agent — wysyłanych
   przez przeglądarkę do `challenges.cloudflare.com` niezależnie od portalu, poza kontrolą kodu
   portalu) do trzeciej domeny wymaga wzmianki w informacji o cookies/podobnych technologiach,
   analogicznie do zewnętrznych skryptów płatności czy map — niezależnie od tego, czy sam
   Turnstile ustawia cookie w przeglądarce odwiedzającego?
4. Stwierdzenie dostawcy „strictly necessary” (jeśli takie pojawia się w jego materiałach) nie
   jest tu przyjmowane jako wystarczające — czy ocena portalu (fail-open dla logowania,
   fail-closed dla pozostałych — sekcja 1.1) prowadzi do tego samego wniosku dla **każdego**
   z sześciu przepływów osobno, czy niektóre (np. `contact`) wymagają innej kwalifikacji?

## 4. Zadania z issue #504 — status i co jeszcze potrzeba

### 4.1 Zadanie 1 — weryfikacja ustawień widżetu i test sieciowy

**Nie wykonane w tym PR** (poza zakresem zadania dokumentacyjnego — wymaga dostępu do panelu
Cloudflare produkcji i realnego ruchu sieciowego, którego ta sesja nie ma). Protokół do
uzupełnienia:

| Do sprawdzenia w panelu Cloudflare | Wynik | Data | Kto |
|---|---|---|---|
| Tryb widżetu (managed / non-interactive / invisible) dla sitekey produkcji | | | |
| Pre-clearance: włączone/wyłączone, poziom (interactive/managed/non-interactive) | | | |
| Ephemeral IDs (jeśli dostępne w planie) | | | |
| Analityka/raporty na koncie Turnstile | | | |
| Test sieciowy: nagranie żądań przeglądarki na `/logowanie`, `/rejestracja`,
  `/reset-hasla`, `/zglos-tresc`, aplikacji bez konta i `/kontakt` — potwierdzenie, że
  żadne żądanie do `challenges.cloudflare.com` nie niesie treści pól formularza ani CV | | | |

### 4.2 Zadanie 2 — role w rejestrze czynności (#485)

Ten szkic (sekcja 2–3.1) daje materiał do rozdzielenia ról; samo wpisanie do rejestru #485
i decyzja o dwóch celach są **do wykonania przez właściciela/prawnika** — nie w tym PR.
Wpis `cloudflare-turnstile` w `src/lib/privacy/processors.ts` (kod, patrz sekcja 5) ma pola
`role`/`region`/`transferBasis`/`contract`/`providerRetention` = „DO UZUPEŁNIENIA”; te pola
mają zostać uzupełnione dopiero po tej ocenie, nie automatycznie z addendum ogólnego.

### 4.3 Zadanie 3 — ocena art. 6 RODO i art. 5(3) ePrivacy

Pytania w sekcji 3; odpowiedzi do uzupełnienia po decyzji (tabela w sekcji 4.6).

### 4.4 Zadanie 4 — informacja w polityce prywatności

Nie wykonane w tym PR (świadomie — zadanie mówi wyłącznie o szkicu dokumentacji, bez zmian UI
i bez treści prawnych w aplikacji). Do przygotowania po decyzjach z sekcji 3: opis Cloudflare,
dwóch celów (procesor/niezależny administrator — sekcja 2), kategorii danych (sekcja 1.2),
odbiorcy/transferu (sekcja 3.1 pkt 5) i praw, w czterech językach portalu (`src/messages/*.json`
zgodnie z Invariantem #2 — bez tekstów na sztywno). Jeśli ostatecznie wybrany tryb widżetu to
*invisible* — Cloudflare wymaga dodatkowo podlinkowania Turnstile Privacy Addendum wprost
(nie tylko streszczenia) — do potwierdzenia przy wyborze trybu w zadaniu 1.

### 4.5 Zadanie 5 — wariant zastępczy przy zablokowanym skrypcie

Stan dziś opisany w 1.5: komunikat + „Załaduj ponownie”, bez ścieżki zastępczej dla trwałej
blokady `challenges.cloudflare.com` w przepływach fail-closed. Nie wprowadzamy w tym PR
mechanizmu zastępczego (zmiana UI/logiki wykracza poza zadanie dokumentacyjne) — zostaje jako
otwarty punkt: potrzebna decyzja produktowa (np. kontakt e-mail/telefon jako ścieżka ręczna dla
rejestracji/resetu/zgłoszenia, z inną ochroną przed nadużyciem) i sprawdzenie dostępności
(WCAG) tej ścieżki.

### 4.6 Kryteria odbioru issue — checklist

| Kryterium | Stan |
|---|---|
| Datowany protokół konfiguracji widżetu produkcyjnego + test sieciowy | do wykonania (4.1) |
| Role, podstawa, ePrivacy, DPA/transfer, retencja udokumentowane | pytania spisane (sekcja 3), odpowiedzi do uzupełnienia (tabela niżej) |
| Informacja o dwóch celach Cloudflare w polityce prywatności | do zrobienia po decyzjach (4.4) |
| Test potwierdza stan pre-clearance/cookie zgodny z decyzją | do wykonania (4.1); zmiana ustawienia w panelu wymaga ponownej oceny |
| Scenariusz awarii/blokowania skryptu ma dostępną ścieżkę pomocy | częściowe (1.5: komunikat + retry); ścieżka zastępcza dla trwałej blokady = otwarte (4.5) |

## 5. Wpis w mapie danych

`src/lib/privacy/processors.ts` miał już wpis `cloudflare-turnstile` (dodany przy #485/#503) —
w tym PR **nie zmieniono** jego treści poza tym, że mapa (`docs/legal-drafts/data-map.generated.md`)
została przegenerowana (`node scripts/privacy/data-map.mjs`) po innych zmianach w repozytorium;
pola `role`/`region`/`transferBasis`/`contract`/`providerRetention` zostają „DO UZUPEŁNIENIA” do
czasu odpowiedzi z sekcji 3–4.

## 6. Źródła pierwotne

- Cloudflare Turnstile Privacy Addendum — sygnały i podwójna rola:
  https://www.cloudflare.com/turnstile-privacy-policy/
- Cloudflare Turnstile — działanie widżetu: https://developers.cloudflare.com/turnstile/
- Cloudflare — opcjonalne pre-clearance / `cf_clearance`:
  https://developers.cloudflare.com/cloudflare-challenges/concepts/clearance/
- RODO art. 5, 6, 13, 28, 44–49: https://eur-lex.europa.eu/eli/reg/2016/679/oj
- Dyrektywa ePrivacy art. 5(3): https://eur-lex.europa.eu/eli/dir/2002/58/2009-12-19/eng

## 7. Do uzupełnienia po decyzji

| Pytanie | Odpowiedź | Uzasadnienie | Podpis / data |
|---|---|---|---|
| Tryb widżetu i pre-clearance na produkcji | | | |
| Rola Cloudflare — ochrona portalu | | | |
| Rola Cloudflare — ulepszanie własnego wykrywania botów | | | |
| Podstawa art. 6 dla wysyłki tokenu | | | |
| Art. 5(3) ePrivacy ma zastosowanie / wyjątek ścisłej konieczności | | | |
| DPA, podprocesorzy, region, mechanizm transferu | | | |
| Retencja sygnałów u Cloudflare | | | |
| Wariant zastępczy przy trwałej blokadzie skryptu | | | |
| Treść informacji w polityce prywatności (4 języki) | | | |
