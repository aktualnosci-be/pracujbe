> **PROJEKT — do weryfikacji prawnika, nieopublikowany.** Opracowanie zewnętrzne z 25.09.2026 (analiza, nie opinia kancelarii); nic z tego pliku nie jest w UI.

# Lejek ofert — RODO i ePrivacy

Wersja 1.0, 25.09.2026. Decyzja rekomendowana: **nie uruchamiać pomiaru przed zgodą; do czasu poprawki OFF.** Źródła: [S01, S03–S05].

## 1. Operacje opisane w JOB_FUNNEL.md

Skrypt przeglądarki wysyła `search_appearance`, `detail_view` i `apply_started` do `/api/job-funnel`. Dla szczegółu i początku aplikacji generuje UUID nonce w pamięci (`useRef`/Map). Żądanie `credentials: omit` nie wysyła cookies sesji, ale standardowe połączenie obejmuje dane sieciowe i nagłówki, w tym IP/UA oraz potencjalny Referrer. Nonce trafia do tabeli receipts. Dzienna tabela przechowuje liczniki oferty.

To nie jest system „bez identyfikatorów”: ma identyfikator deduplikacji. Nie jest też poprawne stwierdzenie „nic nie zapisuje w urządzeniu”, jeśli informacja jest celowo tworzona i przechowywana w RAM. Krótki czas i brak konta istotnie ograniczają ryzyko, ale nie znoszą samego zakresu przepisu.

## 2. Ocena art. 5 ust. 3 ePrivacy

EROD wskazuje brak minimalnego czasu przechowywania i obejmuje pamięć RAM. Wskazuje również, że wynik lokalnego przetwarzania przesłany serwerowi przez oprogramowanie dostarczone urządzeniu może być dostępem do przechowywanej informacji. Dlatego brak `localStorage`, cookies, userID i fingerprintu nie jest wystarczającym uzasadnieniem wyłączenia zgody. Nie każdy adres IP w każdej architekturze sam rozstrzyga ten przepis — tutaj istotna jest łączna konstrukcja skryptu, nonce i beaconów. [S03: pkt 35–40, 52–53]

Wyjątek konieczności dotyczy transmisji lub usługi wyraźnie żądanej przez użytkownika, a nie każdej funkcji przydatnej właścicielowi portalu albo pracodawcy. Zliczanie skuteczności ogłoszenia nie jest oczywiście konieczne do wyświetlenia oferty i wysłania aplikacji. Nie przedstawiono odrębnej, właściwej belgijskiej podstawy zwalniającej ten konkretny pomiar. W Polsce art. 399 PKE również nie daje ogólnego wyjątku „bez cookies”. [S04–S05]

**Wniosek:** uprzednia, dobrowolna zgoda dla analityki; odmowa nie może pogarszać dostępu do aplikacji. Alternatywa to brak lejka. Można zaprojektować statystyki wyłącznie serwerowe z koniecznych żądań usługi, bez nowego odczytu urządzenia, jednak wymaga to ponownego przejścia przez analizę celu, podstawy i logów. Nie zatwierdzam takiego nieopisanego jeszcze wariantu z góry.

## 3. Ocena RODO

Adres IP, kontekst żądania, nonce i możliwość ich łączenia należy traktować ostrożnie jako dane osobowe/pseudonimowe, dopóki nie wykazano skutecznej anonimizacji. Losowa sól HMAC zmniejsza możliwość łączenia limitera, lecz nie znosi danych przetwarzanych przed HMAC ani danych infrastruktury. Hash i null identyfikatora nie są synonimami anonimizacji. [S01]

Docelowo zgoda art. 6 ust. 1 lit. a dla pomiaru, a osobno lit. f dla ograniczonej ochrony endpointu. Nie używać bezpieczeństwa jako podstawy do marketingowego wykorzystania tych samych danych. Szczególne ryzyko stanowią małe liczby: pracodawca, który zna moment jedynej aplikacji, może skojarzyć zmianę licznika z osobą. Nie pokazywać drobnych przekrojów, dokładnych czasów ani metryk pozwalających wnioskować o cudzej aktywności. Proponowany próg 5 to środek redukcji ryzyka, nie prawna gwarancja anonimowości.

## 4. Specyfikacja zmiany

Przed zgodą nie montować ani nie uruchamiać kodu inicjującego pomiar, nonce i beacony. Sam brak zapisu cookies jest niewystarczający. Po odmowie i wycofaniu: natychmiast zatrzymać obserwatory i kolejki, anulować opóźnione wysyłki, wyczyścić pamięć pomiaru, nie wysłać zdarzenia przy unload i nie odtworzyć go po ponownym otwarciu zakładki. Nie wysyłać retrospektywnie aktywności sprzed zgody.

Pierwsza warstwa banera ma równorzędne „Akceptuję analitykę”, „Odrzucam analitykę” i „Ustawienia”; brak pre-check, wymuszania i ukrywania odmowy. Preferencja do 180 dni; równie łatwe wycofanie w stałym linku. Zmiana celu wymaga nowej informacji/zgody, a nie tylko nowej wersji dokumentu. Dla znanego konta niepełnoletniego proponuję brak pomiaru. [S01, S04]

Serwer akceptuje wyłącznie dopuszczone pola, nie loguje pełnego query string ani treści odsyłacza, nie łączy z `candidate_id`, e-mailem lub pełnym wynikiem aplikacji. Wyłączyć zbędny referrer pomiaru. Dzienniki reverse proxy i hostingu sprawdzić oddzielnie. Ochronę spamową utrzymać bez używania jej kluczy do analityki.

Receipts: absolutne 48 h, czyszczenie bez następnego zdarzenia; usunięcie rekordu zaległego po 2 dniach dopiero na następny POST nie jest gwarancją 48 h. Agregaty: maks. 13 miesięcy kalendarzowych; ograniczyć granularity i możliwość różnicowania. To, czy końcowy zbiór jest anonimowy, wymaga testu realnych możliwości identyfikacji.

## 5. Test odbiorowy

Sprawdzić log sieciowy bez zgody, po odmowie, po zgodzie, po wycofaniu, w drugiej zakładce, po zmianie trasy i zamknięciu strony. W pierwszych dwóch i po wycofaniu nie może wystąpić POST pomiarowy. Zgoda na marketing nie zastępuje analitycznej i odwrotnie. Test nie może liczyć tylko cookies; liczy żądania, payload i logi infrastruktury.

Test retencji: utworzyć receipts, przez ponad 48 h nie wysłać żadnego beaconu; rekord ma zostać usunięty. Wstawić więcej niż 200 starych rekordów i sprawdzić termin najstarszego. Test agregacji: pojedynczy kandydat, jedno zgłoszenie, rzadkie ogłoszenie i kolejne odczyty pracodawcy. Przed przyjęciem wyniku poprawić `data-map.ts`, `processors.ts`, dokumentację, baner i cztery wersje polityki.
