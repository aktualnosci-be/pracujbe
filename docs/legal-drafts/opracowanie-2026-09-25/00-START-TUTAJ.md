> **PROJEKT — do weryfikacji prawnika, nieopublikowany.** Opracowanie zewnętrzne z 25.09.2026 (analiza, nie opinia kancelarii); nic z tego pliku nie jest w UI.

# Pracuj.be — analiza prawna i pakiet wdrożeniowy

**Data analizy: 25 września 2026 r. | Wersja: 1.0 | Zakres: UE, Belgia, Polska**

## Wynik

**Rekomendacja: nie otwierać jeszcze portalu dla zewnętrznych użytkowników i rzeczywistych CV.** Samo uzupełnienie regulaminu nie usuwa opisanych niżej problemów. Można kontynuować demo z danymi syntetycznymi. Dokumenty stanowią analizę i projekty do przyjęcia przez operatora, nie formalną opinię adwokata ani radcy prawnego ani potwierdzenie zgodności produkcji.

Przeanalizowano 16 plików przekazanej paczki. Nie udostępniono kodu wykonywalnego, wdrożenia, podpisanych umów, ustawień kont dostawców ani danych podmiotu. Wnioski o działaniu programu odnoszą się do opisów w załączniku; nie są wynikiem testów aplikacji. Oryginały zachowano oddzielnie w `materialy-zrodlowe/` wraz z sumami kontrolnymi.

Do czytania i edycji w Wordzie: `Pracuj_be_analiza_i_decyzje_2026-09-25.docx` (analiza główna, 8 stron). Pełne projekty i specyfikacje znajdują się w osobnych plikach pakietu.

## Jak wykorzystać pakiet

1. Właściciel uzupełnia `wdrozenie/dane-operatora.json`, zatwierdza model usługi i okresy retencji oraz dostarcza dowody umów i regionów. Brakujących nazwisk, numerów rejestrowych i podpisów nie wolno zastępować przypuszczeniami.
2. Programista realizuje `wdrozenie/checklista-odbioru.md`. `wdrozenie/retention-proposal.json` jest specyfikacją, a nie migracją ani plikiem gotowym do automatycznego importu. Samo wpisanie wartości w tabeli nie tworzy brakujących zadań.
3. Osoba odpowiedzialna za publikację porównuje model LAUNCH-1 z rzeczywistym wdrożeniem, usuwa metadane redakcyjne i rozwiązuje wszystkie znaczniki `{{...}}`. Dopiero wtedy publikuje dokumenty z `publiczne/` w PL/NL/FR/EN i archiwizuje ich przyjęte wersje.

## Przyjęty do projektów model LAUNCH-1

Portal pozostaje bezpłatny. Obsługuje ogłoszenia, konta, aplikacje i wiadomości; nie zatrudnia kandydatów i nie gwarantuje zatrudnienia. Pracodawcy otrzymują dane konkretnej aplikacji oraz dane profilu w zakresie przyznanego dostępu. Plik CV pozostaje prywatnym plikiem kandydata: w dostarczonym opisie nie ma działającej ścieżki pobrania go przez pracodawcę. Zmiana tego modelu wymaga osobnej informacji i testów uprawnień.

Wyszukiwalność profilu jest oddzielną, dobrowolną funkcją, domyślnie wyłączoną; w proponowanym wariancie startowym dostępną tylko pełnoletnim. Samodzielna rejestracja od 16 lat jest **propozycją polityki produktu**, nie ustawowym wiekiem dopuszczalności pracy. Młodsi mają kanał kontaktu z udziałem opiekuna; wdrożenie ograniczenia wymaga oceny proporcjonalności w świetle zasad pośrednictwa i niedyskryminacji.

AI, import obrazów do AI, import CV, tłumaczenie profili, ranking kandydatów dla pracodawcy, Sentry, Google Analytics, Meta Pixel i płatności pozostają wyłączone. Pomiar lejka jest wyłączony do wdrożenia zgody i testów; później działa wyłącznie po zgodzie. Newsletter ma gotową treść zgody, lecz wysyłka jest zablokowana do uruchomienia osobnego procesu. Dokumenty publiczne opisują stan **po wykonaniu tych warunków**, a nie aktualne demo.

## Najważniejsze decyzje

| Zagadnienie | Rozstrzygnięcie / zalecenie |
|---|---|
| Administrator | Rzeczywisty operator; dane pozostają do uzupełnienia przez właściciela. Domena .be nie ustala siedziby ani właściwości APD. |
| Portal i pracodawcy | Co do zasady odrębni administratorzy w opisanym modelu; osobna ocena usług wykonywanych wyłącznie na polecenie firmy oraz wspólnie ustalanej selekcji. |
| DPO | Nie ma podstaw do automatycznego powołania tylko dlatego, że portal zawiera CV. Potrzebna udokumentowana ocena skali, monitorowania i danych wrażliwych. |
| Lejek bez cookies | Nie zatwierdzam obecnego działania mimo odmowy zgody. RAM i nonce nie wyłączają ePrivacy. |
| Matching bez AI | Nie wyłącza profilowania ani art. 22 RODO. Obecny opis nie dowodzi automatycznego odrzucania, ale przyszły ranking wymaga osobnej oceny. |
| Retencja | Konkretne okresy w załączonej polityce; nie stanowią uniwersalnych terminów ustawowych. Usunąć bezterminowe ustawienia i brakujące zadania. |
| Tombstones ≥400 dni | Wymóg kodu, nie prawa. Docelowo 30 dni przy zweryfikowanych kopiach maksymalnie 14-dniowych i bezpiecznym odtworzeniu; najpierw zmiana blokady i inwentaryzacja kopii. |
| DSA | Hosting i najprawdopodobniej platforma internetowa. Wyłączenia dla mikro/małych firm wymagają dowodu spełnienia kryteriów. |
| Dostawcy | Publiczny DPA nie dowodzi umowy konkretnego klienta. Region europejski nie oznacza braku transferów. |
| Pośrednictwo | Sprawdzić wymogi regionalne Belgii oraz polski KRAZ. Bezpłatność i określenie „portal” nie przesądzają wyłączenia. |

## Zawartość

`01-odpowiedz-na-zlecenie.md` odpowiada na punkty A–G i dodaje analizę jurysdykcji. `szkice/` zawiera sześć zastępujących projektów, procedurę DSA i uzgodnienia z pracodawcą. `wdrozenie/` zawiera wartości, blokady, korekty mapy i testy odbiorowe. `publiczne/` zawiera siedem tekstów w każdym z czterech języków. `wzory/` zawiera zawiadomienia o naruszeniu. `zrodla.md` pozwala zweryfikować podstawy prawne i aktualne dokumenty dostawców.

**Status wykonania:** analiza i redakcja dokumentów wykonane; tożsamość operatora, akceptacja decyzji, zawarcie umów, konfiguracja, testy i publikacja nie zostały wykonane w ramach tej analizy. Żaden plik nie jest oznaczony jako zatwierdzony przez właściciela.
