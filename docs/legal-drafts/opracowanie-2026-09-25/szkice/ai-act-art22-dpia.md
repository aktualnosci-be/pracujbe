> **PROJEKT — do weryfikacji prawnika, nieopublikowany.** Opracowanie zewnętrzne z 25.09.2026 (analiza, nie opinia kancelarii); nic z tego pliku nie jest w UI.

# AI Act, art. 22 RODO i ocena skutków — projekt decyzyjny

**25.09.2026 | Właściciel decyzji: {{OPERATOR_NAME}} | Zatwierdzenie: NIE | Wdrożenie: NIE**

Podstawy: [S01], [S08–S12], [S17–S19], [S29] w `zrodla.md`. Stan funkcji ustalono z `AI_JOB_IMPORT.md`, `PRODUCT_DECISIONS.md`, `GUEST_APPLY.md` oraz przekazanego szkicu, nie z uruchomienia aplikacji. Nie zatwierdzać zbiorczo „AI w portalu”: każda funkcja ma inny cel, zbiór danych i wpływ na osobę.

## 1. Rozstrzygnięcie dla startu

W modelu LAUNCH-1 import AI, przesyłanie obrazów, tłumaczenia AI, import CV i ranking kandydatów dla firm pozostają wyłączone. Nie należy wysyłać do API nawet danych demonstracyjnych, jeżeli zawierają rzeczywiste osoby. Deterministyczne wskazanie kandydatowi dopasowania oferty może działać dopiero po sprawdzeniu, że nie ogranicza listy dostępnych ofert, nie udaje decyzji rekrutera i jest rzetelnie wyjaśnione.

**Nie podpisuję potwierdzenia, że „brak AI wyklucza art. 22”.** Art. 22 dotyczy skutku i sposobu podjęcia decyzji, nie konkretnej technologii. Profilowanie jest pojęciem szerszym niż decyzja objęta art. 22. Wyliczenie oceny umiejętności lub preferencji może być profilowaniem również wtedy, gdy wynik nie przesądza o zatrudnieniu. [S01, S08]

## 2. Inwentaryzacja i kwalifikacja funkcji

| ID | Funkcja i stan opisany w paczce | Ocena i warunek |
|---|---|---|
| A1 | Import treści ogłoszenia przez Anthropic do szkicu; domyślnie OFF | Samo redakcyjne uporządkowanie ogłoszenia, bez selekcji osób i targetowania, zasadniczo poza celem załącznika III pkt 4 lit. a. Kontrola człowieka jest środkiem jakości, nie uniwersalnym zwolnieniem. |
| A1-IMG | Surowy zrzut ogłoszenia trafia do modelu przed redakcją odpowiedzi | OFF. Tekstowy filtr e-mail/telefon nie usuwa danych z obrazu. Najpierw lokalne wykrycie/redakcja, podgląd zakresu i osobna ocena dostawcy. |
| A2 | Tłumaczenia ogłoszeń/profili, opis PR #514 niepołączony | Nie przedstawiać jako wdrożone. Ogłoszenie i profil kandydata to różne ryzyka. Profil może ujawniać zdrowie, pochodzenie, przynależność związkową. |
| A3 | Import CV | Brak działającej funkcji w materiałach. OFF; osobna analiza art. 9/10, podstaw, odbiorców i ewentualnego wykorzystania wyniku do selekcji. |
| D1 | `scoreMatch`, ustalone reguły, wynik dla kandydata | Możliwe profilowanie RODO; reguły określone wyłącznie przez człowieka nie stają się AI przez nazwę „matching”. Brak dowodu decyzji art. 22, pod warunkiem rzeczywistego braku skutku wykluczającego. |
| D2 | „Top 5” kandydatów dla pracodawcy; dane demonstracyjne, brak potwierdzonego produkcyjnego wyliczania | OFF. Przed produkcją DPIA, ocena dyskryminacji i realnego wpływu rankingu na dostęp do pracy. Nie wystarczy przycisk „zatwierdź” przy automatycznej liście. |
| D3 | `applications.match_score`, zapis klienta jako 0, brak wykazanego produkcyjnego generatora | Nie opisywać użytkownikowi jako aktywnego scoringu; nie aktywować bez oceny celu i danych wejściowych. |
| D4–D5 | Statusy ręczne, pytania screeningowe bez wykazanego auto-odrzucania | Dopuszczalne przy rzetelnych pytaniach, prawidłowych uprawnieniach i braku ukrytego knockout. Szczególne ryzyko pytań o zdrowie, ciążę, religię, niekaralność. |
| D6 | Alerty wyszukiwania ofert | Dobrowolna funkcja użytkowa; nie zamieniać w automatyczny wybór osób ani marketing bez odrębnej analizy. |
| D7 | Automatyczne oznaczenie treści do moderacji, decyzja człowieka | DSA wymaga przejrzystości użytych narzędzi; odwołanie nie może być rozstrzygane wyłącznie automatycznie, gdy art. 20 ma zastosowanie. |

Gdy zamierzony cel systemu obejmuje rekrutację, selekcję, filtrowanie aplikacji, ocenę kandydatów lub kierowanie ogłoszeń do osób, sprawdzić załącznik III pkt 4. Nie wolno sprowadzać tej analizy wyłącznie do nazwy modelu. Przy powołaniu się na wyjątek art. 6 ust. 3 udokumentować brak znaczącego ryzyka i spełnienie ustawowych przesłanek. W obrębie systemów z załącznika III profilowanie osób nie pozwala korzystać z tego wyjątku. Właściwe wymagania rejestracyjne należy ocenić w aktualnym, zmienionym reżimie; uproszczenie nie jest zniesieniem wszystkich obowiązków. [S09–S11]

## 3. Aktualny harmonogram i role AI Act

Nie kopiować harmonogramu z pierwszego wydania AI Act. Rozporządzenie 2026/1744 i aktualna informacja Komisji przesuwają stosowanie obowiązków dotyczących systemów wysokiego ryzyka z załącznika III na **2 grudnia 2027 r.**, a systemów powiązanych z produktami z załącznika I na **2 sierpnia 2028 r.** Art. 50 wymaga osobnego sprawdzenia i zasadniczo jest stosowany od 2 sierpnia 2026 r. Aktualizacja kompetencji AI w art. 4 pozostawia działania wspierające ich rozwój; nie należy powielać starego brzmienia bez uwzględnienia zmiany. [S10–S12]

Własny interfejs oparty na cudzym API może stanowić system AI wprowadzany pod nazwą Pracuj.be: operator może być jego dostawcą, a nie wyłącznie podmiotem stosującym. Anthropic jest dostawcą komponentu/modelu, a role RODO ustala się odrębnie. Zmiana zamierzonego celu na ocenę kandydatów może zmienić kwalifikację. Nie dopuszczać interpretacji, że przyszła data części AI Act odracza RODO, bezpieczeństwo lub zakaz dyskryminacji.

Art. 50 ocenić oddzielnie dla bezpośredniej interakcji z botem, treści syntetycznych i publikacji. Nie każdy poprawiony przez człowieka tekst ogłoszenia wymaga identycznego oznaczenia, ale nie wolno obiecywać „napisane i zweryfikowane przez pracodawcę”, jeżeli faktycznie publikacja jest automatyczna. Przed włączeniem sporządzić krótką kartę: podstawa obowiązku/wyjątku, kto oznacza, gdzie użytkownik widzi informację, dowód kontroli redakcyjnej.

## 4. Test art. 22 — do wykonania na rzeczywistym przepływie

Sprawdzić łącznie: czy występuje decyzja dotycząca osoby; czy opiera się wyłącznie na przetwarzaniu automatycznym; czy wywołuje skutek prawny lub podobnie istotny. Przeanalizować także decyzję pracodawcy opartą na wyniku portalu. Wyrok SCHUFA pokazuje znaczenie faktycznie decydującej roli scoringu, mimo że dotyczył innego sektora. [S08]

Znacząca interwencja człowieka oznacza osobę uprawnioną do zmiany wyniku, mającą dostęp do danych i kandydatów poza listą, czas na ocenę, wiedzę o ograniczeniach i udokumentowaną możliwość odmiennej decyzji. Sam przycisk zatwierdzenia, rutynowe przyjmowanie pierwszych pięciu osób lub brak dostępu do pozostałych nie wystarczają.

W LAUNCH-1 zakazuje się automatycznego odrzucenia, ukrycia aplikacji z powodu progu, automatycznego zatrudnienia i oceny emocji. Nie wdrażać art. 22 na podstawie ogólnej zgody na regulamin. Ewentualny wyjątek wymaga osobnej przesłanki, gwarancji i oceny szczególnych kategorii danych; „wygoda rekrutera” nie wykazuje niezbędności do umowy.

## 5. Projekt DPIA: system kandydatów i przyszły ranking

**Status:** dokument przygotowawczy; nie jest zakończoną ani zatwierdzoną DPIA. Brakuje liczby i geograficznego rozkładu osób, częstotliwości ocen, realnej listy pól, testów uprawnień i skuteczności zabezpieczeń. Właściciel: {{PRIVACY_OWNER}}; konsultacja DPO, jeśli został wyznaczony; decyzja: {{OPERATOR_NAME}}.

**Cel:** umożliwienie dobrowolnego złożenia aplikacji i kontaktu. Dla przyszłego rankingu cel dodatkowy to wspomaganie znalezienia odpowiednich osób — nie wynika on automatycznie z niezbędności prowadzenia konta.

**Zakres i przepływ:** kandydat/gość → konto lub bufor potwierdzenia → aplikacja → uprawnieni członkowie firmy; portal → hosting/poczta/ochrona antybot; prywatny CV odrębnie; kopie i ślady usunięć objęte retencją. Nie przenosić całej aplikacji do e-maila. Wyłączenie firmy z dostępu musi działać również przy wysyłce oczekujących powiadomień.

**Niezbędność i proporcjonalność:** nie wymagać zdjęcia, dokładnej daty urodzenia, stanu cywilnego, PESEL, dokumentu tożsamości ani informacji zdrowotnych dla standardowej aplikacji. Preferować jawne filtry wybrane przez kandydata zamiast nieprzejrzystej oceny jego „wartości”. Do porównania alternatywa: zwykła lista aplikacji i wyszukiwanie po kryteriach stanowiska, bez rankingu osób.

| Ryzyko | Potencjalny skutek | Ocena wstępna | Wymagane środki / dowód przed obniżeniem oceny |
|---|---|---|---|
| Błędne przypisanie umiejętności lub języka | Utrata szansy zatrudnienia | Wysokie | Edycja i prostowanie, źródło każdego pola, brak domyślania nieznanych wartości, test reprezentatywnych profili. |
| Ranking utrwalający dyskryminację | Wykluczenie grup i naruszenie godności | Wysokie | Zakaz niedozwolonych kryteriów/proxy, jawne kryteria zawodowe, kontrola człowieka, testy wpływu. Nie zbierać automatycznie danych art. 9 „do testu” bez podstawy. |
| Dostęp obcej firmy lub byłego rekrutera | Ujawnienie CV, kontaktów, historii | Wysokie | RLS i testy cross-tenant, domyślna prywatność, weryfikacja firmy, role, kontrola przy wysyłce, krótkie adresy podpisane. |
| Wysłanie obrazu lub profilu do AI | Nieodwracalne ujawnienie danych i transfer | Wysokie | OFF, następnie lokalna redakcja przed wysyłką, minimalizacja, umowa obejmująca rzeczywiste kategorie, ograniczony zakres. |
| Przywrócenie danych po usunięciu | Utrata kontroli nad danymi | Wysokie | Pełny katalog kopii, 14-dniowy limit kalendarzowy, replay aktualnych usunięć i wycofań przed otwarciem odtworzonej usługi. |
| Pozorne odwołanie od oceny | Utrwalenie niesprawiedliwej decyzji | Wysokie | Inny uprawniony oceniający, dostęp do całego kontekstu i możliwość zmiany; rejestr odwróconych decyzji. |
| Profilowanie osoby niepełnoletniej | Presja, niepożądany kontakt, dyskryminacja | Wysokie | Niewyszukiwalność profilu poniżej 18 lat, brak analityki/marketingu znanych małoletnich, zgłaszanie nadużyć, bez skanów tożsamości rutynowo. |
| Błędna stawka wynagrodzenia | Wprowadzenie kandydata w błąd | Istotne | Kwoty dziesiętne/grosze, waluta, brutto/netto, okres; 17,50 nie może zostać 18. Potwierdzenie pracodawcy. |
| Nieograniczona retencja i martwe zadania | Zwiększony zakres wycieku | Wysokie | Wykonane i monitorowane zadania, absolutne terminy, test >200 rekordów, alarm błędów i dead-letter. |

Nie przypisano pozornie precyzyjnych punktów ani „niskiego ryzyka resztkowego” bez wyników. Dla każdego wiersza zespół dokumentuje dowód skuteczności, prawdopodobieństwo, dotkliwość, ryzyko po środkach, osobę odpowiedzialną i datę przeglądu. Przed D2 uzyskać opinię przedstawicieli kandydatów/firm lub uzasadnić brak konsultacji. Jeśli po środkach utrzymuje się wysokie ryzyko, ocenić uprzednią konsultację z organem z art. 36; nie uruchamiać funkcji na samo oświadczenie o akceptacji ryzyka. [S01]

## 6. Warunki ponownego rozpatrzenia A1

Dopuszczenie wyłącznie po odrębnym protokole: realny model i endpoint potwierdzone w panelu; nazwa `claude-opus-5` z dokumentacji nie stanowi dowodu dostępności; podpisany/wiążący DPA właściwej strony; ustalona retencja konkretnej klasy modelu; brak szkolenia i wtórnego użycia potwierdzony warunkami właściwej usługi; transfer i subprocesorzy; redakcja przed wysłaniem; brak surowych screenshotów; test dokładności i limitów; jasny podgląd; kontrola człowieka przed publikacją; wyłączenie automatycznego pobierania z dowolnych URL i zabezpieczenie SSRF; logi bez promptu i danych osoby; wyłącznik awaryjny.

Nie przedstawiać 30 dni jako bezwyjątkowego limitu Anthropic. Oficjalne zasady różnicują usługę, model, wyjątki bezpieczeństwa i uzgodnienia kontraktowe. Ponownie przeprowadzić analizę przy zmianie modelu, promptu, rodzaju danych, sposobu publikacji lub odbiorcy wyniku. [S17–S19]
