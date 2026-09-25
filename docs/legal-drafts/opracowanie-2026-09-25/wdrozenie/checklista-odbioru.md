> **PROJEKT — do weryfikacji prawnika, nieopublikowany.** Opracowanie zewnętrzne z 25.09.2026 (analiza, nie opinia kancelarii); nic z tego pliku nie jest w UI.

# Odbiór przed otwarciem Pracuj.be

**25.09.2026 | Wszystkie testy: NIEWYKONANE w ramach tego opracowania.**

P0 blokuje dostęp osób zewnętrznych do odpowiedniej funkcji. P0-F oznacza możliwość pozostawienia całej funkcji wyłączonej zamiast jej wdrożenia. Wdrożenie samego dokumentu albo konfiguracji nie zamyka testu. W protokole wpisać commit, środowisko, datę, wykonawcę, przypadek, oczekiwany i rzeczywisty wynik oraz bezpieczny odnośnik do dowodu. Nie umieszczać rzeczywistych CV w publicznym repozytorium testów.

## A. Tożsamość i model prawny

| ID | Priorytet | Kryterium i wymagany dowód |
|---|---|---|
| LEG-01 | P0 | Potwierdzone dane podmiotu, rejestr, VAT lub zgodna z prawdą informacja o jego braku, adres, telefon, kontakt i reprezentacja. Ustalone miejsce decyzji i właściwość organu; domena .be nie jest dowodem siedziby. |
| LEG-02 | P0 | Opis terytorium i funkcji pośrednictwa, ocena KRAZ art. 305/306 oraz Flandrii/Brukseli/Walonii; wymagane rejestracje uzyskane albo udokumentowane wyłączenie. Nie wystarcza tekst „nie jesteśmy agencją”. |
| LEG-03 | P0 | Przyjęte role portal–firma; widoczna informacja firmy przed aplikacją; członek firmy ma umocowanie i akceptuje właściwe warunki. Osobne moduły ATS/wspólnej selekcji nie są uruchamiane bez oceny. |
| LEG-04 | P0 | Protokół oceny DPO, osoba prywatności i zastępca; ROPA obejmuje gości, firmy, osoby zgłaszające DSA i kontakty, nie tylko kandydatów. |
| LEG-05 | P0 | Protokół wielkości przedsiębiorstwa wraz z podmiotami powiązanymi; jednoznaczne zastosowanie art. 15/19 DSA; brak fałszywej deklaracji zwolnienia. |

## B. Konta, widoczność i aplikacje

| ID | Priorytet | Test odbiorowy |
|---|---|---|
| DATA-01 | P0 | Nowy kandydat niewyszukiwalny; osobne świadome włączenie tylko dla dorosłego; wyłączenie skuteczne w API, cache i indeksie. Konto 16–17 ma ograniczenia LAUNCH-1. Brak nadmiernego zbierania danych wieku. |
| DATA-02 | P0 | Firma A nie odczyta aplikacji, wiadomości, profilu ani linku storage firmy B; test IDOR/RLS po zgadnięciu ID i użyciu API poza UI. |
| DATA-03 | P0 | Cofnięcie członkostwa/roli firmy uniemożliwia dalszy odczyt i wysyłkę oczekującego e-maila do byłego członka. Sprawdzić stan przy dostarczeniu, nie tylko przy enqueue; issue #503. |
| DATA-04 | P0 | CV prywatne: właściciel może pobrać, pracodawca i anonimowy użytkownik nie. Link wygasa po 60 s, nie trafia do logów ani e-maili. UI wyraźnie mówi, że plik nie jest załączany. Walidacja typu/magic/rozmiaru i izolacja potencjalnie złośliwych plików; brak dowodu skanowania nie jest zaliczeniem. |
| DATA-05 | P0 | Gość: GET linku nie potwierdza/nie wykonuje zmiany, POST potwierdza dopiero ważny token; przed potwierdzeniem firma nie widzi danych. Potwierdzenie 48 h, claim 30 dni i jednorazowość, właściwy zweryfikowany e-mail. |
| DATA-06 | P0 | Nowe wysłanie linku nie przesuwa bez końca absolutnego 7-dniowego limitu od pierwszej prośby. Po przeniesieniu do aplikacji bufor nie duplikuje telefonu, wiadomości i odpowiedzi. |
| DATA-07 | P0 | Formularz nie wymaga marketingu ani ogólnej „zgody RODO”. Kandydat widzi odbiorcę, rzeczywisty zestaw pól i informację firmy. Zgoda wyszukiwalności nie obejmuje innych celów. |
| DATA-08 | P0 | Przegląd wolnych pól i pytań: brak rutynowego żądania dokumentu, zdrowia, wyroków; ścieżka ograniczenia/usunięcia przypadkowych danych szczególnych. Umowy dostawców zgodne z realnymi kategoriami. |

## C. Retencja i prawa — nie zamykać #486 wyłącznie setterem

| ID | Priorytet | Test odbiorowy |
|---|---|---|
| RET-01 | P0 | Eksport i usunięcie z DATA_RETENTION faktycznie wdrożone w docelowym środowisku; rozstrzygnięta sprzeczność ze starym ROPA. Eksport zrozumiały i obejmuje właściwe dane pochodne, nie wyłącznie profil. |
| RET-02 | P0 | Działający ręczny kanał art. 15–22 dla gościa, firmy, moderatora i zgłaszającego. Limit eksportów technicznych nie jest odmową prawa. Miesiąc kalendarzowy, nie zawsze 30 dni; prawidłowe przedłużenie. |
| RET-03 | P0 | Usunięcie: aktualne uwierzytelnienie/step-up, odcięcie sesji i dostępu, brak niechcianego okresu karencji; storage fizycznie ≤72 h i alarm po24 h. Dla danych innej osoby/obrony roszczeń indywidualna ocena, nie automatyczne kasowanie wszystkiego bez reguły. |
| RET-04 | P0 | Kolejka storage: niepowodzenie 20 prób tworzy alarm i obsługiwany dead-letter, nie „sukces” z pozostawionym CV. Test restartu, limitu i awarii dostawcy. Zwykłe 7 dni obejmuje koniec fizycznego usunięcia. |
| RET-05 | P0 | Faktyczna aktywność aktualizuje last_seen_at; logowanie, istotne działania i skrypt tła odróżnione. Ostrzeżenie 30 dni; CV365, konto730, hide180. Brak aktywności nie jest utożsamiany z brakiem telemetrycznej zgody. |
| RET-06 | P0 | Zamknięte aplikacje obejmują hired i inne końcowe statusy; niezmienny closed_at, bez resetu przez powiadomienie/odczyt. Retencja180; ponowne otwarcie tylko rzeczywiste i audytowane. Przegląd starych otwartych spraw. |
| RET-07 | P0 | Istnieje realny job confirmed_guest_request, nie tylko klucz konfiguracji. Minimalny bufor30, pending7, IP/UA7; test duplikatów i ponawiania. |
| RET-08 | P0 | Harmonogram produkcyjny jest włączony, autoryzowany i monitorowany. Test co najmniej 601 rekordów i kilku partii po200; zaległości są opróżniane przed granicą, a nie raz na tydzień. |
| RET-09 | P0 | Katalog wszystkich kopii, snapshotów, eksportów, obiektów i logów; dowód maks.14 dni kalendarzowych. „14 najnowszych kopii” bez kalendarza nie zalicza testu. |
| RET-10 | P0 | Odtworzenie z najstarszej kopii: replay pełnego aktualnego rejestru usunięć oraz wycofań zgód przed odblokowaniem API, storage, indeksów i wysyłki. Test usunięcia tuż przed awarią oraz utraty codziennego eksportu tombstones. |
| RET-11 | P0 | Dopiero po RET-09/10 zmiana technicznego minimum400 i tombstone30. Nie usuwać tombstones według projektu przy niezbadanych starszych kopiach. Każdy wyjątek kopii zmienia analizę limitu. |
| RET-12 | P0 | Dane w audytach, JSON snapshots, DSA, e-mailach i wolnym tekście przeglądnięte. Null FK/HMAC/usunięcie IP nie oznacza anonimizacji. Art.19: przekazanie odpowiednich żądań odbiorcom i informacja kandydata. |
| RET-13 | P0 | Dowody zgód i praw po minimalizacji ≤1095 dni; logi30/audyt365; oddzielne czyszczenie auth.email_outbox. Tokeny nieważne po użyciu/wygaśnięciu, retencja treści nie wydłuża ważności sekretu. |

## D. Analityka, poczta i dostawcy

| ID | Priorytet | Test odbiorowy |
|---|---|---|
| PRIV-01 | P0-F | Lejek OFF przed zgodą, po odmowie, po wycofaniu i dla znanego małoletniego. Test sieciowy: brak POST/Beacon w tych stanach, na zmianie strony, unload, w dwóch kartach oraz po restarcie. Nie wystarczy brak cookies. |
| PRIV-02 | P0-F | Po zgodzie poprawna kategoria i wersja; wycofanie czyści oczekujące zdarzenia, nie dopisuje wcześniejszych. Ustawienia równe wizualnie, zapis wyboru≤180dni. Spis rzeczywistych cookies, Storage, IndexedDB i RAM. |
| PRIV-03 | P0-F | Receipts mają absolutne TTL48h nawet przy braku ruchu i dużej kolejce. Dane agregowane≤13 miesięcy kalendarzowych; ochrona małych grup i brak łączenia z profilem. |
| VEND-01 | P0 | DPA i aneksy rzeczywiście wiążą konkretny podmiot; Railway procedura wykonania; Resend właściwa kopia konta. Pełny rejestr usług/regionów/backups/support/transferów; Supabase dopóki migracja nieudowodniona. |
| VEND-02 | P0 | SCC/TIA lub aktualny właściwy wpis DPF z zakresem; nie samo logo. Brak twierdzenia „e-mail tylko w UE”. Bezpieczeństwo/special categories u dostawców zgodne z realnym ryzykiem CV. |
| MAIL-01 | P0 | Otworzyć dostarczony plik .eml: brak niewskazanych pikseli i przekierowania śledzącego; ustawienia API/conta potwierdzone. Powiadomienia minimalne, bez treści CV i wiadomości. |
| MAIL-02 | P0-F | Newsletter OFF do double opt-in i testu rezygnacji: GET bez mutacji, POST rezygnuje bez loginu, rotacja kluczy nie unieważnia realnej możliwości rezygnacji. Weryfikacja zgody również w momencie wysyłki. |
| MAIL-03 | P0 | Wiadomości konieczne dla bezpieczeństwa i praw nie są tłumione przez marketing suppression; niedostarczalność ma alternatywną ścieżkę. Nie wysyłać do niewłaściwego odbiorcy ani przez BCC jako substytut autoryzacji. |

## E. DSA, incydenty, AI i publikacja

| ID | Priorytet | Test odbiorowy |
|---|---|---|
| DSA-01 | P0 | Art.11 i12 działające kontakty; notice bez konta, poprawny wyjątek danych zgłaszającego, alternatywa dla Turnstile; wszystkie cztery języki realnie obsługiwane. |
| DSA-02 | P0 | Art.16/17: potwierdzenie, decyzja zgłaszającego i uzasadnienie ograniczenia dla autora, konkretne fakty/podstawy i użycie automatyzacji. Doręczenie i ponowienie błędów. |
| DSA-03 | P0 | Sześć miesięcy kalendarzowych od powiadomienia, odwołanie bez konta po jego zamknięciu, ludzka weryfikacja, priorytet życia/bezpieczeństwa i art.18. Retencja365 po późniejszej właściwej dacie. |
| DSA-04 | P0 warunkowe | Gdy raport/baza obowiązkowe: właściwy schemat, harmonogram, odróżnienie braku danych od zera, walidacja usunięcia danych osobowych z publicznych uzasadnień; potwierdzenie przyjęcia eksportu. Przy zwolnieniu udokumentowany protokół. |
| INC-01 | P0 | Wyznaczony dyżur i zastępca; próba naruszenia CV; pomiar72h od stwierdzenia, osobny test wysokiego ryzyka dla osoby. Właściwy organ i dostęp do jego portalu. |
| INC-02 | P0 | Wzory4języki i tryb awaryjny niezależny od dostępności wszystkich tłumaczeń; wiadomości bez żądania haseł/dokumentów; rejestr dostarczeń i dalszych aktualizacji. |
| AI-01 | P0-F | Anthropic, import obrazów/CV, tłumaczenia, Sentry, GA, Meta, Stripe oraz ranking firm OFF. Brak przypadkowego wywołania przez fallback lub zadanie. D1 nie blokuje żadnych ofert; D3 zero nie udaje rzeczywistej oceny. |
| AI-02 | P0-F | Przed włączeniem nowej funkcji klasyfikacja AI Act według aktualnego prawa, realny model/retencja/umowa, DPIA gdy wymagana, test art.22 i dokładności17,50 bez zaokrąglenia do18. Brak surowego obrazu przed redakcją. |
| PUB-01 | P0 | 7 tekstów ×4języki zgodne z funkcjami i przyjętymi wartościami. Wartości {{...}} rozstrzygnięte, meta instrukcje usunięte, linki działają. Brak domyślnej zgody, brak fikcyjnego DPO i numeru rejestru. |
| PUB-02 | P0 | Regulamin możliwy do zapisania, potwierdzenie na trwałym nośniku, obsługa reklamacji i odstąpienia; zmiany wersjonowane. Dostępność stron prawnych oraz formularzy sprawdzona na telefonie i klawiaturą. |
| PUB-03 | P0 | Macierz faktów i dokumentów odzwierciedla aktualny deployment; właściciel zatwierdza politykę i protokół. Dopiero wtedy usuwa się bramkę demo; noindex nie jest zabezpieczeniem danych. |

## Protokół decyzji

Decyzja końcowa: **NIEUDZIELONA**. Wymagane podpisy/akceptacje rzeczywistych osób: reprezentant operatora, właściciel prywatności, osoba techniczna odpowiedzialna za deployment. Wynik „dopuszczenie z wyłączoną funkcją” wymaga dowodu jej wyłączenia także w API i zadaniach. Nie oznaczać opracowania AI jako akceptacji kancelarii.
