> **PROJEKT — do weryfikacji prawnika, nieopublikowany.** Opracowanie zewnętrzne z 25.09.2026 (analiza, nie opinia kancelarii); nic z tego pliku nie jest w UI.

# Polityka retencji i realizacji praw

Wersja 1.0, 25.09.2026. **Rekomendowane decyzje administratora, nie wartości wdrożone.** Podstawa: [S01: art. 5, 12–22, 25, 32; S31]. Właściciel: `{{PRIVACY_OWNER}}`; zastępca: `{{PRIVACY_DEPUTY}}`.

## 1. Reguły nadrzędne

Dane usuwa się po ustaniu celu, nie po upływie najdłuższego możliwego przedawnienia dowolnego roszczenia. Okresy niżej służą proponowanemu bezpłatnemu modelowi LAUNCH-1. Nie są powszechnymi ustawowymi terminami przechowywania CV. Administrator dokumentuje ich przyjęcie i ponownie ocenia po 6 miesiącach realnego działania.

Wyraźne żądanie usunięcia, sprostowania lub ograniczenia rozpatruje się indywidualnie i bez zbędnej zwłoki. Okres technicznego sprzątania nie jest obowiązkowym oczekiwaniem na realizację prawa. Usunięcie konta nie może milcząco niszczyć danych objętych udokumentowanym ograniczeniem lub koniecznych do konkretnego roszczenia; zachowuje się tylko wyodrębniony, minimalny zbiór, a nie całe aktywne konto.

Przy każdym okresie wskazać: zdarzenie początkowe, maksymalny termin faktycznego usunięcia, osobę odpowiedzialną i wynik zadania. Osiągnięcie limitu partii 200 lub 20 prób usuwania nie stanowi realizacji retencji.

## 2. Tabela okresów docelowych

| Dane | Rekomendacja | Początek / wykonanie / uzasadnienie |
|---|---|---|
| Samoobsługowe usunięcie konta | Odcięcie widoczności i sesji natychmiast; obiekty online do 72 h | Bez przymusowego okna na cofnięcie. 72 h to wewnętrzny limit operacyjny, nie termin z RODO. Alarm po 24 h. Kopie według odrębnej reguły. |
| Plik oznaczony jako usunięty, poza żądaniem natychmiastowym | 7 dni zamiast 30 | `deleted_at`; brak widoczności od oznaczenia; kolejka musi usunąć obiekt w tym łącznym okresie, nie dopiero rozpocząć próby w dniu 7. |
| Profil oznaczony administracyjnie do usunięcia | 7 dni zamiast 30 | `deleted_at`; jeżeli to czasowe zawieszenie, stosować osobny status i indywidualne zasady, nie pozorne usunięcie. |
| CV nieaktywnego kandydata | 365 dni | `last_meaningful_activity_at`; zawiadomienie 30 dni przed terminem. Włączenie dopiero po poprawie `last_seen_at`. Oznaczyć wcześniej, jeśli potrzebne na fizyczne usunięcie do dnia 365. |
| Konto i profil nieaktywny | 730 dni | Rzeczywiste logowanie lub świadome użycie funkcji konta, nie cron, e-mail/piksel ani sama zmiana techniczna. Uprzedzenie 30 dni wcześniej; brak zadania w dostarczonym opisie — należy je stworzyć. |
| Wyszukiwalność | Do wycofania; ukrycie po 180 dniach bez aktywności | Oddzielna funkcja pełnoletniego, domyślnie OFF. Ukrycie nie niszczy już przekazanej aplikacji i nie stanowi obowiązkowego usunięcia konta. |
| Aplikacje zamknięte, także zatrudnienie | 180 dni | `closed_at`: ostateczne odrzucenie, wycofanie, zakończenie po ofercie lub zatrudnienie. Nie `updated_at`. Okres pozwala wrócić do przebiegu procesu, bez stałej bazy dawnych rekrutacji. |
| Aplikacje bez zakończenia | Przegląd po 180 dniach; wezwanie do ustalenia statusu, co do zasady zamknięcie po dalszych 30 dniach | Wyjątek wymaga aktywnego procesu i zapisanej przyczyny oraz daty kolejnego przeglądu; brak wiadomości technicznie nie uzasadnia wiecznego „otwarte”. |
| Propozycje i wiadomości procesu | 180 dni od zamknięcia procesu | Usuwanie z obu widoków, powiadomień, historycznych payloadów i indeksów; legal hold tylko indywidualny. |
| Rozmowa niezwiązana z procesem | 180 dni od ostatniej merytorycznej wiadomości | Otworzenie, powiadomienie i zmiana metadanych nie resetują licznika. |
| Gość — link potwierdzenia | 48 godzin ważności | Wygaśnięcie egzekwowane przy każdym użyciu tokenu; GET nie potwierdza zgłoszenia. |
| Gość — niepotwierdzone dane i duplikaty | Maks. 7 dni od pierwszego zgłoszenia | Ponowna wysyłka linku nie może przedłużać przechowywania bez końca. Przedłużenie wymaga nowego rzeczywistego zgłoszenia i świeżych informacji. |
| Gość — minimalny ślad potwierdzenia | 30 dni od potwierdzenia | Identyfikator aplikacji, adres dla przejęcia, czas, wersja informacji i żądania. Telefon, wiadomość i odpowiedzi usunąć z bufora po przeniesieniu. Pole „zgoda” przemianować, jeśli dokumentuje usługę, nie consent. |
| Gość — token przejęcia | Do 30 dni od potwierdzenia; wcześniej po wykorzystaniu | Tylko hash. Usunięcie śladu nie usuwa przedwcześnie samej aplikacji, która podlega okresowi procesu. |
| IP/UA dowodu gościa | Do 7 dni, chyba że konkretny incydent wymaga zabezpieczenia | Antyfraud, nie wieloletni dowód „zgody”. Minimalny dowód żądania nie wymaga pełnego UA. |
| Logi surowego IP/UA | Do 30 dni | Rozdzielić dostęp, błędy i działania administracyjne; wyłączyć query string z sekretami i treściami. |
| Audyt zminimalizowany | Do 365 dni | Cel bezpieczeństwa i rozliczalności; bez kopii pełnych pól osobowych. Null FK i skasowane IP nie oznaczają anonimizacji. |
| Ochrona tempa żądań | Okno limitu + maks. 24 h | Termin według `expires_at`; harmonogram niezależny od kolejnego żądania. |
| Payload e-mail / kolejka | Do 30 dni po końcowym statusie | Sekrety uwierzytelnienia po użyciu/wygaśnięciu; usuwać zbędne imię, nazwisko i szczegóły procesu. |
| Metadane dostarczenia / powiadomienia | Do 90 dni | Wysyłka nie może zostawić rekrutacyjnych danych bez limitu w pomocniczej tabeli. |
| Zaproszenie do firmy | Ważność 14 dni, usunięcie do 7 dni po wygaśnięciu | Wcześniej po skutecznym wykorzystaniu, jeśli nie jest potrzebny minimalny dowód uprawnienia. |
| Dowód zgód, akceptacji i praw | Do 1095 dni po wycofaniu/ustaniu celu/zamknięciu wniosku | Tylko identyfikacja, wersja, czas, zakres i rezultat; przegląd roczny. Pełną korespondencję pozostawić jedynie w zakresie potrzebnym dla sprawy. |
| Minimalna lista wypisów/sprzeciwów | Przez okres konieczny do respektowania sprzeciwu w istniejącym systemie wysyłki | Izolowana lista, preferencyjnie bez odwracalnej postaci adresu, bez używania marketingowego; coroczny przegląd i usunięcie po zakończeniu potrzeby. Nowa ważna zgoda może zmienić status. |
| Akta DSA | Obsługa + 6 miesięcy kalendarzowych na odwołanie, potem 365 dni | Liczyć od późniejszego z upływu okna odwołania lub zakończenia wniesionego w terminie odwołania. Nowe automatyczne odczytanie nie resetuje terminu. |
| Lejek receipts | Maks. 48 h | Warunkowo po zgodzie; niezależne zadanie TTL, bez czekania na następny beacon i bez zaległości. |
| Zagregowane statystyki ofert | Do 13 miesięcy kalendarzowych | Agregacja nie jest automatycznie anonimowością; ocena małych grup, łączenia i różnicowania. |
| Kopie zapasowe | Maks. 14 dni kalendarzowych | Nie tylko 14 sztuk; obejmuje obiekty, eksporty, kopie dostawcy, awaryjne i migracyjne. |
| Tombstone usunięcia | Docelowo 30 dni od usunięcia | Tylko gdy żaden backup zawierający osobę nie jest starszy niż 14 dni, a restore zawsze stosuje kompletny rejestr. Jeśli dowód wskazuje dłuższe kopie: najpierw zmienić kopie i analizę, nie kasować ochrony restore. |
| Dowody konkretnego sporu | Indywidualnie | Konkretny przepis/roszczenie, zakres, dostęp, data kontroli, termin końcowy; nie automatyczna wieloletnia retencja wszystkich kandydatów. |

## 3. Konieczne zmiany programu

`deleted_file` i `deleted_profile`: zmienić wartość oraz semantykę sprzątania tak, żeby 7 dni oznaczało koniec, a nie początek niezawodnościowej kolejki. Natychmiastowe żądanie kandydata ma osobną ścieżkę i nie oczekuje 7 dni.

`closed_application`: objąć wszystkie terminalne wyniki, dodać trwałe `closed_at`, obsłużyć ponowne otwarcie tylko na podstawie rzeczywistej decyzji, nie technicznego update. Usuwać oferty, wiadomości, załączniki, indeksy, powiadomienia, kopie tekstu i zewnętrzne payloady w odpowiednim zakresie. Uwzględnić aplikacje gości po ustawieniu FK na null.

`inactive_candidate_cv`: przed włączeniem uzupełnić wiarygodną aktywność. Wykonać próbę na koncie utworzonym rok wcześniej, które zalogowało się wczoraj. Ma przetrwać. Wprowadzić niezależną retencję profilu oraz brak odświeżania przez monitoring i e-maile.

`confirmed_guest_request`: samo `admin_set_retention_policy` nie działa jako purge — stworzyć zadanie. Skrócenie bufora nie może złamać tokenu przejęcia ani usunąć danych aplikacji przed okresem procesu.

`erasure_tombstone`: zmienić walidację `>=400`. Nie obniżać terminu przed inwentaryzacją najstarszego odtwarzalnego backupu i testem. UUID jest danymi pseudonimowymi, dopóki może być skojarzone ze zbiorem, szczególnie kopią. Bezterminowość nie jest zaakceptowaną docelową polityką.

Cron: potwierdzić działanie na docelowym backendzie; przy zaległościach procesować dodatkowe partie z bezpiecznymi limitami. Raportować najstarszy przeterminowany rekord, nie tylko liczbę skasowanych. Dead-letter po 20 próbach ma dyżurnego, alarm i ręczne rozwiązanie, nie status „sukces”. Test awarii storage ma potwierdzić wznowienie i dotrzymanie limitu.

## 4. Obsługa praw — procedura operacyjna

Przyjmować wnioski na `{{PRIVACY_EMAIL}}` oraz przez dostępne funkcje konta. Gość i rekruter nie muszą zakładać konta kandydata. Wniosek otrzymany innym właściwym kanałem organizacji przekazać do właściciela procesu zamiast odsyłać z formalną odmową. [S31]

Zarejestrować datę wpływu, rodzaj prawa i zakres. Zweryfikować osobę proporcjonalnie: aktywna sesja plus świeże uwierzytelnienie lub bezpieczny odnośnik do zweryfikowanego adresu w operacjach podwyższonego ryzyka. Samo przepisanie znanego adresu nie jest ponownym uwierzytelnieniem. Kopii dowodu nie żądać rutynowo. W razie uzasadnionych wątpliwości poprosić o minimalne dodatkowe informacje.

Odpowiedzieć bez zbędnej zwłoki, zasadniczo w miesiąc kalendarzowy. Ewentualne przedłużenie o dwa miesiące uzasadnić złożonością/liczbą wniosków i zawiadomić w pierwszym miesiącu. Brak funkcji UI, mały zespół albo limit eksportów nie zwalniają z terminu. Każda odmowa wymaga podstawy, uzasadnienia i informacji o skardze oraz sądzie. [S01]

**Dostęp:** udostępnić dane podane, obserwowane i dotyczące osoby dane pochodne, istotne kopie treści, odbiorców/źródła, cele, okresy oraz prawa. JSON uzupełnić słownikiem pól w języku osoby; CV udostępnić osobno bezpiecznym odnośnikiem. Przejrzeć logi, snapshoty, DSA i dane operatorów, nie tylko główne konto. Praw innych osób nie chroni się przez automatyczne pominięcie całej rozmowy; zastosować proporcjonalną redakcję.

**Przenoszenie:** dotyczy zakresu art. 20, w szczególności danych dostarczonych i przetwarzanych automatycznie na podstawie zgody/umowy, nie każdej wewnętrznej oceny administratora. To, że dany wynik nie podlega przenoszeniu, nie wyklucza dostępu do niego na podstawie art. 15.

**Sprostowanie:** poprawić źródło, przeliczyć lub oznaczyć nieaktualny wynik, uzupełnić stanowisko osoby przy spornych ocenach. **Ograniczenie:** wyłączyć dane z normalnego użycia, wyszukiwania, scoringu i kolejek wysyłki bez ich nieodwracalnego usuwania. **Sprzeciw:** marketing zatrzymać bez testu nadrzędnego interesu; dla lit. f przeprowadzić właściwą indywidualną ocenę.

**Usunięcie:** rozdzielić cofnięcie widoczności, wycofanie aplikacji, skasowanie pliku i konta. Przed kaskadą sprawdzić zakres żądania i konkretną potrzebę art. 17 ust. 3. Nie utrzymywać całego konta z powodu jednego zgłoszenia DSA. Odbiorców powiadomić w zakresie art. 19, chyba że wykaże się niemożliwość/niewspółmierny wysiłek; na żądanie wskazać odbiorców. Kopie niezależnego pracodawcy podlegają jego własnej podstawie i retencji, ale należy przekazać żądanie/komunikat zgodnie z właściwą rolą.

## 5. Backup i odtworzenie

Kopie są izolowane, szyfrowane i niedostępne do zwykłej rekrutacji. Nie wykorzystuje się ich do obchodzenia praw osób. Utrzymywać ewidencję wszystkich miejsc kopii i eksportów oraz ich dat fizycznego usunięcia. Backup 14-dniowy nie może pozostać na zawsze, gdy cron przestanie działać.

Przed przywróceniem ruchu: odtworzyć aktualny i kompletny rejestr usunięć z niezależnego kanału, zastosować go do bazy, obiektów, indeksów, kolejek e-mail i ograniczeń. Sprawdzić także cofnięte zgody, sprzeciwy i blokady. Brak albo zły rejestr ma blokować otwarcie systemu. Test powinien objąć usunięcie wykonane między ostatnim eksportem tombstones a awarią; sama kopia rejestru raz dziennie może taką lukę pozostawić.

## 6. Kryterium przyjęcia

Administrator przyjmuje okresy i ich uzasadnienia, programista wykazuje testy granic terminów, awarii i odtworzenia, a osoba publikująca sprawdza zgodność czterech wersji informacji. Do tego momentu tabela jest specyfikacją zmiany, nie oświadczeniem o skutecznej retencji.
