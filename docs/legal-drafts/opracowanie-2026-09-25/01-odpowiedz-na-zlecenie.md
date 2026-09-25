> **PROJEKT — do weryfikacji prawnika, nieopublikowany.** Opracowanie zewnętrzne z 25.09.2026 (analiza, nie opinia kancelarii); nic z tego pliku nie jest w UI.

# Odpowiedź na zlecenie A–G

Data: 25.09.2026. Odwołania [Sxx] prowadzą do `zrodla.md`; odwołania do dokumentacji oznaczają konkretny plik dostarczonej paczki, a nie niezależnie sprawdzony kod.

## A. Operator, role i DPO

Administratorem nie jest marka ani sam adres internetowy, lecz osoba lub podmiot faktycznie określający cele i istotne sposoby przetwarzania. Należy ustalić firmę, formę prawną, adres, rejestr i numer, VAT, działający kontakt, miejsce podejmowania decyzji oraz osoby uprawnione. Nie przypisuję portalu do konkretnej działalności ani osoby bez potwierdzenia, kto faktycznie prowadzi Pracuj.be. [S01, S29]

W opisanym modelu portal sam określa zasady kont, przechowywania profilu, dobrowolnej wyszukiwalności, komunikacji, bezpieczeństwa, moderacji i realizacji praw. Dla tych operacji jest administratorem. Firma rekrutująca samodzielnie wybiera cel rekrutacji, stanowisko, kryteria i dalsze wykorzystanie danych: jest odrębnym administratorem danych kandydatów otrzymanych i wykorzystywanych w jej procesie. Nie oznacza to, że portal automatycznie przestaje odpowiadać za własną infrastrukturę aplikacji. [S01, S29]

Dostęp do tej samej bazy nie wystarcza do współadministracji. Jeżeli portal i firma wspólnie ustalą istotne cele i sposoby pozyskania lub selekcji, potrzebne będą uzgodnienia art. 26 i udostępnienie osobie ich zasadniczej treści. Jeżeli portal oferuje wydzielony moduł ATS, przetwarza dane wyłącznie na udokumentowane polecenie pracodawcy i nie wykorzystuje ich do własnych celów, ten moduł może wymagać powierzenia art. 28. Nazwanie całej usługi „procesorem” w regulaminie nie rozwiązuje rzeczywistego podziału. Projekt uzgodnień odrębnych administratorów jest w `szkice/role-portal-pracodawca.md`. [S29]

Rejestr art. 30 jest potrzebny także małej firmie, ponieważ obsługa profili i rekrutacji jest stałą, a nie okazjonalną działalnością. DPO wymaga odrębnego testu art. 37: działalność organu publicznego; podstawowa działalność obejmująca regularne i systematyczne monitorowanie na dużą skalę; podstawowa działalność obejmująca na dużą skalę dane art. 9 lub 10. Na podstawie samego demo nie ma dowodu spełnienia tych przesłanek. Zalecam osobę odpowiedzialną za prywatność, formalny protokół oceny DPO i ponowny przegląd przed rankingiem kandydatów lub istotnym wzrostem skali. Osoby decydującej o celach przetwarzania nie należy bez analizy konfliktu interesów wyznaczać na DPO. [S01]

Właściwość APD/GBA nie wynika automatycznie z użytkowników w Belgii. Dla transgranicznego przetwarzania trzeba ustalić rzeczywiste główne miejsce prowadzenia działalności i kompetencje decyzyjne. Możliwy jest Prezes UODO, APD/GBA albo inny organ właściwy. Osoba zachowuje prawo skargi do organu w państwie zwykłego pobytu, pracy lub domniemanego naruszenia. [S01: art. 4 pkt 16, 55–56, 77]

## B. Dostawcy i transfery

Zestawienie dostawców jest decyzją warunkową, nie akceptacją zakupową. Dla usług podstawowych potrzebne są: właściwa strona umowy, wersja przyjętego DPA, usługi objęte umową, region danych podstawowych, kopii i logów, lista dalszych podmiotów, dostęp wsparcia, mechanizm transferu, okresy i procedura usunięcia. Przy SCC trzeba ocenić konkretny transfer i środki dodatkowe; DPF wolno stosować tylko po potwierdzeniu aktualnego wpisu właściwej osoby prawnej i zakresu danych. Niepotrzebnie przesłane dane nie stają się potrzebne dzięki SCC. [S01: art. 28, 44–49]

Railway wskazuje procedurę wykonania DPA przez klienta i spółkę; sam link nie jest dowodem zakończenia tej procedury. Resend podaje automatyczne objęcie zarejestrowanych kont DPA oraz możliwość pobrania kopii z panelu. Są to różne modele kontraktowe. Resend podaje przechowywanie danych w USA także przy wyborze regionu wysyłki; twierdzenie „cała poczta zostaje w UE” byłoby nieprawdziwe. Cloudflare Turnstile opisuje dwie role: procesor na potrzeby ochrony witryny i własny administrator przy rozwoju wykrywania botów. Trzeba odróżnić te cele także w informacji dla osób. [S13–S16]

Nie usuwam Supabase z analizy: dokumentacja nadal opisuje użycie lub fallback tego dostawcy, a zakończenie migracji nie jest wykazane. Anthropic, Sentry i dodatkowe trackery pozostają wyłączone. Specjalnie nie uznaję ogólnej redakcji tekstu za zabezpieczenie obrazów: zrzut jest przekazywany przed sprawdzeniem odpowiedzi. W DPA Railway i Anthropic kategorie szczególne opisano jako „None”; Sentry zawiera zakaz ich przesyłania. Ryzyko treści zdrowotnych lub związkowych w CV trzeba rozwiązać technicznie i kontraktowo, nie tylko zakazem w regulaminie. [S13, S17, S21]

## C. Retencja i prawa

Przyjmuję politykę minimalnego przechowywania dla bezpłatnego MVP, z konkretnymi wartościami w `szkice/retencja-i-prawa-kandydata.md`. Są to proponowane okresy administratora, oparte na celach i ryzykach, a nie twierdzenie o powszechnym „belgijskim terminie CV”. Nie wolno przechowywać całej rekrutacji tyle, ile wynosi najdłuższe możliwe przedawnienie jakiegokolwiek roszczenia. Spór uzasadnia indywidualny, ograniczony zbiór dowodowy z terminem przeglądu. [S01: art. 5 ust. 1 lit. c, e; art. 17 ust. 3]

Proponuję: 365 dni braku rzeczywistej aktywności dla CV, 730 dni dla konta, 180 dni od zamknięcia procesu dla aplikacji i wiadomości, 30 dni dla minimalnego potwierdzenia gościa, maksymalnie 14 dni kalendarzowych dla kopii. Zwykłe sprzątanie danych oznaczonych do usunięcia skrócić z 30 do 7 dni; wyraźne żądanie usunięcia obsługiwać bez nieuzasadnionej zwłoki, bez narzuconego okna na cofnięcie. Docelowy wewnętrzny termin fizycznego usunięcia obiektów online: 72 godziny, z alarmem po 24 godzinach. Te terminy muszą zostać potwierdzone testami przed publikacją.

Blokady techniczne są istotne: `last_seen_at` nie jest aktualizowane przy logowaniu; `confirmed_guest_request` ma ustawienie, ale brak zadania; `closed_application` nie obejmuje zatrudnienia i używa `updated_at`; prace w partiach po 200 mogą tworzyć zaległości; 20 nieudanych prób storage nie może pozostawić pliku na zawsze. „14 najnowszych kopii” nie oznacza zawsze „14 dni”. Wymuszone przez kod 400 dni dla tombstones nie jest minimum ustawowym. Docelowe 30 dni przy 14-dniowych kopiach wymaga zmiany walidacji i wykazania, że starsze kopie rzeczywiście nie istnieją. Do tego czasu nie włączać automatycznego usuwania tombstones; pilnie ograniczyć stan zastany, zamiast uznawać bezterminowość za politykę.

Nowszy `DATA_RETENTION.md` opisuje eksport JSON i usuwanie konta kandydata; starszy rejestr temu przeczy. W zrewidowanym rejestrze oznaczam funkcje jako opisane w migracji 0105, wymagające potwierdzenia wdrożenia. Nie deklaruję braku funkcji ani ich potwierdzonego działania na produkcji. Eksport musi być zrozumiały, zawierać również właściwe dane pochodne i informację o przetwarzaniu; art. 15 i 20 nie mają identycznego zakresu. Konieczny jest kanał ręczny także dla gości, członków firm i administratorów. [S01, S31]

Termin odpowiedzi wynosi miesiąc kalendarzowy, z dopuszczalnym przedłużeniem o dwa miesiące pod warunkami art. 12 ust. 3; informację o przedłużeniu przekazuje się w pierwszym miesiącu. Limit 10 pobrań dziennie nie może automatycznie rozstrzygać o odmowie prawa dostępu. Przy usunięciu lub sprostowaniu należy rozważyć zawiadomienie odbiorców zgodnie z art. 19; wyłączenie kopii pracodawcy spod technicznej kaskady nie zwalnia z tego obowiązku. [S01, S31]

## D. DSA

Gospodarcza usługa przechowująca i publicznie udostępniająca ogłoszenia firm będzie co do zasady hostingiem i platformą internetową. Nieodpłatność dla odbiorcy sama nie przesądza wyłączenia. Ponieważ typowa umowa o pracę nie jest zakupem towaru lub usługi konsumenckiej od sprzedawcy, nie należy automatycznie stosować całego reżimu platform umożliwiających konsumentom zawieranie umów na odległość z przedsiębiorcami. Sprawdzenie firm pozostaje bardzo ważnym środkiem przeciwdziałania oszustwom. [S02]

Art. 19 zwalnia mikro- i małe przedsiębiorstwa z sekcji 3 rozdziału III, z wyjątkiem art. 24 ust. 3, z zastrzeżeniem reguł dotyczących VLOP. Ocena wymaga uwzględnienia przedsiębiorstw partnerskich i powiązanych; nie wystarczy liczba osób pracujących przy samym portalu. Art. 15 ust. 2 zawiera odrębne wyłączenie raportu dla mikro/małych firm. Obowiązki podstawowe, w tym art. 11–12, 14, 16–18, nadal pozostają. W razie braku dokumentacji wielkości nie ogłaszać zwolnienia. [S02]

Przyjmuję sześć **miesięcy kalendarzowych** na odwołanie. Jest to minimum art. 20, gdy ma zastosowanie; mały operator może wprowadzić taką procedurę dobrowolnie i wtedy powinien dotrzymywać własnego regulaminu. 7 dni na zwykłe zgłoszenie i 14 dni na zwykłe odwołanie traktuję jako cele operacyjne, a nie ustawowe okresy dozwolonej bezczynności. Oczywiście bezprawne treści, zagrożenie życia, handel ludźmi i oszustwa wymagają priorytetu; art. 18 wymaga odpowiedniego zawiadomienia organów bez zwłoki. [S02]

Retencję sprawy proponuję przez okres obsługi i dostępnego odwołania, a następnie 365 dni od końca drogi wewnętrznej. To własna polityka, nie termin wpisany w DSA. Art. 24 ust. 5 nie uzasadnia wysyłania pełnej dokumentacji do publicznej bazy: w zakresie zastosowania obowiązku przekazuje się wymagane uzasadnienie bez danych osobowych. Roczny raport i baza decyzji są różnymi obowiązkami. Szczegółowa procedura i wzory: `szkice/dsa-moderacja.md`. [S02, S32]

## E. Naruszenia

Wprowadzić dyżur właściciela procesu i zastępcy, awaryjny kontakt poza usługą dotkniętą incydentem, rejestr wszystkich naruszeń oraz test scenariusza wycieku CV. Pierwsze 72 godziny liczy się od stwierdzenia naruszenia w rozumieniu RODO, a nie od końca śledztwa czy zgody zarządu. Zgłoszenie do organu jest wymagane, chyba że mało prawdopodobne jest ryzyko dla praw lub wolności; zawiadomienie osoby wymaga wysokiego ryzyka i powinno nastąpić bez zbędnej zwłoki. Możliwe jest etapowe uzupełnianie zgłoszenia. [S01: art. 33–34]

APD wymaga obecnie użycia portalu oraz języka francuskiego, niderlandzkiego lub niemieckiego. Sama polska albo angielska wiadomość do ogólnej skrzynki nie zastępuje poprawnego zgłoszenia. Przygotowano francuski wzór art. 33 i cztery wersje wiadomości do osób. Trzeba najpierw potwierdzić właściwość organu. Kod wymagający czterech tłumaczeń przed jakąkolwiek wysyłką musi mieć tryb awaryjny: oczekiwanie na tłumaczenie nie usprawiedliwia spóźnionego zawiadomienia. [S22]

## F. AI, art. 22, DPIA i ePrivacy

Import tekstu ogłoszenia do szkicu, bez oceny kandydatów i z rzeczywistą kontrolą redakcyjną, co do zasady nie ma celu rekrutacyjnej selekcji z załącznika III pkt 4 lit. a. Nie jest jednak prawidłowa ogólna reguła „jest człowiek, więc AI nie jest wysokiego ryzyka”. Trzeba oddzielić generowanie szkicu od targetowania ogłoszeń, filtrowania i oceny osób. W razie zastosowania wyjątku art. 6 ust. 3 potrzebna jest jego udokumentowana podstawa oraz właściwe obowiązki rejestracyjne; integrator sprzedający lub udostępniający własny system może być dostawcą, nie tylko podmiotem stosującym API. [S09–S12]

Weryfikacja aktualizacji prawa ma tu znaczenie: rozporządzenie 2026/1744 zmieniło AI Act. Komisja potwierdza termin 2 grudnia 2027 r. dla obowiązków dotyczących systemów wysokiego ryzyka z załącznika III, a nie automatycznie 2 sierpnia 2026 r. Przepisy art. 50 wymagają odrębnej oceny i zasadniczo stosuje się je od 2 sierpnia 2026 r. Zmieniony art. 4 nadal wymaga działań wspierających rozwój kompetencji AI, lecz nie należy bez sprawdzenia kopiować starej formuły o zapewnieniu określonego „wystarczającego poziomu”. Odsunięcie części AI Act nie odracza RODO ani zakazu dyskryminacji. [S10–S12]

Deterministyczny matching może być profilowaniem w rozumieniu RODO. Art. 22 nie zależy od używania AI. Dla aktualnie opisanego D1, prezentującego dopasowanie ofert kandydatowi, brak podstaw do stwierdzenia znaczącej decyzji wyłącznie automatycznej, o ile nie ogranicza realnie dostępu do pracy. D2 — prezentowanie firmie tylko „najlepszej piątki” — jest istotnie bardziej ryzykowne. Pozorny udział rekrutera nie usuwa art. 22, jeśli wynik faktycznie przesądza o losie osoby. Orzeczenie SCHUFA potwierdza znaczenie rzeczywistej roli scoringu, choć dotyczyło kredytu, a nie rekrutacji. D2 pozostawić wyłączone do DPIA, badania wpływu i zaprojektowania realnej kontroli człowieka. [S01, S08]

DPIA nie jest automatycznie wymagana dla każdego pojedynczego importu ogłoszenia. Natomiast ranking kandydatów, dane osób poszukujących pracy, nowe technologie, potencjalne dane szczególne i skala mogą łącznie powodować wysokie ryzyko. Pakiet zawiera rozbudowany projekt oceny z rejestrem ryzyk, ale brak danych o skali, wyników testów i podpisu administratora nie pozwala oznaczyć jej jako zakończonej. Gdy po środkach zaradczych pozostaje wysokie ryzyko, należy ocenić konsultację z organem z art. 36. [S01]

Lejek korzysta ze skryptu na urządzeniu i nonce w RAM. Wytyczne EROD wprost obejmują RAM i informacje lokalnie generowane, następnie udostępniane serwerowi. Brak cookies, brak trwałego userID i `credentials: omit` nie tworzą generalnego wyjątku. Cel statystyczny pracodawcy nie jest oczywiście konieczny do przeglądania oferty przez kandydata. Dlatego rekomenduję uprzednią zgodę analityczną albo wyłączenie lejka. Odrębnym wariantem może być zagregowana analiza wyłącznie niezbędnych żądań serwerowych, bez dodatkowego odczytu urządzenia, po nowej analizie technicznej. [S03–S05]

## G. Dokumenty publiczne i wersje językowe

Przygotowano odrębnie regulamin, politykę prywatności, politykę cookies, informację dla kandydata, zgodę marketingową, formularz i opis DSA oraz informację o wieku w PL/NL/FR/EN. Nie zastępują one wdrożenia opisanych mechanizmów. Nie należy publikować twierdzenia o prywatnym CV, braku AI, ograniczonej retencji lub zgodzie na analitykę, dopóki test wdrożenia nie potwierdzi każdego z nich. Podmiot, adresy kontaktowe, odnośniki i aktywni dostawcy są polami wdrożeniowymi; nie mogą zostać na publicznej stronie jako znaczniki.

Obsługa zgłoszenia jest wykonywaniem żądanej usługi, a nie dobrowolnym marketingiem. Obowiązkowe zaznaczenie „zgadzam się na przetwarzanie danych w celu aplikowania” zastąpić jasnym poleceniem wysłania aplikacji i informacją o odbiorcy. Marketing wymaga osobnego, niezaznaczonego domyślnie wyboru; brak zgody nie blokuje aplikowania. Alert zamówiony przez użytkownika należy oddzielić od reklam i newslettera. [S01, S05–S07]

Wiek 13 lat w Belgii i zasadniczo 16 lat przy art. 8 RODO w Polsce dotyczy określonej zgody na usługi społeczeństwa informacyjnego, a nie ogólnej zdolności kontraktowej ani dopuszczalności zatrudnienia. Samo wpisanie „13+” na portalu pracy byłoby błędnym skrótem. Proponuję start od samodzielnych kont 16+, ograniczoną widoczność niepełnoletnich, brak ich marketingu i analityki oraz ścieżkę pomocy z opiekunem. Nie żądać rutynowo skanu dowodu. [S01, S28]

Bezpłatna usługa może podlegać części przepisów o usługach cyfrowych, jeśli dane są używane do celów innych niż wyłącznie dostarczenie usługi lub wykonanie prawa. Dlatego regulamin nie wyłącza ustawowych praw konsumenta i przewiduje również dobrowolne 14-dniowe odstąpienie. Nie wpisano wyłącznego sądu belgijskiego ani klauzuli odbierającej ochronę prawa miejsca zwykłego pobytu konsumenta. [S30, S33]

## H. Dodatkowa blokada: działalność pośrednictwa w zatrudnieniu

Nie utożsamiać kwalifikacji administratora RODO, hostingu DSA i agencji pośrednictwa. To trzy niezależne pytania. Uzasadniony wniosek „platforma DSA” nie oznacza „brak obowiązków pośrednictwa”.

**Flandria:** oficjalna informacja obejmuje witryny rozpowszechniające oferty i CV pojęciem prywatnego pośrednictwa. Zwykłe pośrednictwo co do zasady nie wymaga uznania przewidzianego dla pracy tymczasowej, ale podlega warunkom prowadzenia działalności, także w odniesieniu do podmiotów z zagranicy. Nie należy przekształcać tego w twierdzenie o braku regulacji. [S24]

**Bruksela:** dla prywatnych agencji aktywnych w regionie, także lokujących tam pracowników, przewidziano uprzednią deklarację/rejestrację w odpowiednim zakresie. **Walonia:** rejestracji podlegają określone usługi pośrednictwa, m.in. rekrutacja i selekcja. Dla konkretnego Pracuj.be trzeba opisać aktywne funkcje, a nie tylko nazwę działalności, i ustalić obowiązek przed świadczeniem tych usług. [S25–S26]

**Polska:** art. 305 ust. 2 pkt 1 lit. c ustawy z 20 marca 2025 r. wyraźnie obejmuje gospodarcze gromadzenie i udostępnianie informacji o wolnych i poszukiwanych miejscach pracy przez systemy teleinformatyczne. Nie można opierać projektu na dawnym przekonaniu, że internetowa tablica jest zawsze wyłączona z KRAZ. Art. 305 ust. 5 dotyczy również wymienionych przedsiębiorców zagranicznych świadczących usługi w Polsce; wyjątki art. 306 wymagają konkretnej podstawy. Polski język sam nie rozstrzyga miejsca świadczenia usługi, ale kierowanie jej do kandydatów w Polsce może być istotne. Przed startem ustalić: siedzibę operatora, targetowane państwa, sposób pozyskiwania kandydatów i ewentualne kierowanie do pracy za granicą. Gdy obowiązek wystąpi, dokonać właściwej rejestracji; samo dodanie klauzuli „nie jesteśmy agencją” nie wystarczy. [S27]

## Warunek zamknięcia zlecenia po stronie operatora

Do podpisania pozostają wyłącznie decyzje i potwierdzenia, których nie można zastąpić analizą: prawdziwa tożsamość operatora, właściwość i rejestracje, spełnienie kryteriów małego przedsiębiorstwa, umowy i regiony, osoby dyżurne, przyjęcie proponowanej polityki oraz protokół odbioru technicznego. Nie pozostawiono pustych pytań prawnych tam, gdzie można było udzielić rekomendacji na podstawie opisanego modelu.
