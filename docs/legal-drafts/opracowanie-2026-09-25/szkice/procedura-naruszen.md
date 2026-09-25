> **PROJEKT — do weryfikacji prawnika, nieopublikowany.** Opracowanie zewnętrzne z 25.09.2026 (analiza, nie opinia kancelarii); nic z tego pliku nie jest w UI.

# Procedura naruszeń ochrony danych osobowych

**Projekt operacyjny | 25.09.2026 | Do przyjęcia przez {{OPERATOR_NAME}}**

Podstawy: art. 4 pkt 12, 28 ust. 3 lit. f, 32–34 RODO [S01]; procedura APD/GBA [S22]. Każde naruszenie dokumentujemy, również gdy nie zgłaszamy go organowi. Rejestr incydentów nie powinien sam stać się kopią ujawnionych CV.

## 1. Obsada i kanały — rzeczywiste osoby przed startem

| Funkcja | Dane do wpisania | Odpowiedzialność |
|---|---|---|
| Kierujący incydentem | {{INCIDENT_LEAD}}, {{INCIDENT_PHONE}} | Koordynacja, ocena priorytetu, decyzja operacyjna i eskalacja. |
| Prywatność | {{PRIVACY_OWNER}}, {{PRIVACY_EMAIL}} | Test ryzyka, właściwość organu, projekty zawiadomień i rejestr. |
| Zastępca | {{PRIVACY_DEPUTY}}, {{INCIDENT_BACKUP_CONTACT}} | Zastępuje niedostępne osoby; zapewnia ciągłość także poza dniami roboczymi. |
| Technika | {{TECH_CONTACT}} | Izolacja, zabezpieczenie minimalnych dowodów, rotacja sekretów, odtworzenie. |
| Uprawniony reprezentant | {{AUTHORIZED_SIGNATORY}} | Złożenie zawiadomienia i kontakt z organem; brak jego dostępności nie może blokować ustawowego terminu. |
| Awaryjny kanał | {{OUT_OF_BAND_CONTACT}} | Niezależny od poczty, hostingu i kont objętych incydentem. |

Nie wpisywać fikcyjnego „dyżuru 24/7”. Przed uruchomieniem ustalić, kto odbiera alarm w nocy i w weekend, oraz przeprowadzić próbę kontaktu. Hasła i tokeny do portali zgłoszeniowych przechowywać w uprawnionym menedżerze sekretów, nie w tym dokumencie.

## 2. Rozpoznanie i zabezpieczenie

Naruszenie obejmuje nie tylko wyciek, ale także utratę, zniszczenie, niedozwoloną zmianę i nieuprawniony dostęp. Przykłady: CV dostępne dla obcej firmy, publiczny bucket, wysłanie wiadomości byłemu rekruterowi, błędny eksport, przejęcie konta, nieodwracalna utrata aplikacji, przywrócenie usuniętych danych.

Wewnętrznie zaleca się: w pierwszej godzinie przyjęcie i triage, w ciągu czterech godzin wstępne ograniczenie zdarzenia, przed upływem 24 godzin pierwsza ocena ryzyka, a do 48 godzin gotowy projekt zgłoszenia. Są to cele operacyjne, nie nowe terminy prawne ani powód do zwlekania z czynnością pilną.

Zachować czas pierwszego sygnału, czas uzyskania rozsądnej pewności naruszenia oraz uzasadnienie momentu stwierdzenia. Zablokować wadliwą ścieżkę dostępu, wycofać linki/sesje/klucze, zatrzymać kolejkę błędnych powiadomień. Zabezpieczać logi z łańcuchem dostępu, nie pobierać masowo wszystkich CV „na dowód”. Ochrona dowodów nie uzasadnia pozostawienia wycieku otwartego.

## 3. Ocena obowiązków

Do właściwego organu zgłaszamy bez zbędnej zwłoki i, w miarę możliwości, **nie później niż 72 godziny od stwierdzenia**, chyba że jest mało prawdopodobne, by naruszenie powodowało ryzyko dla praw lub wolności osób. Weekend nie zatrzymuje biegu. Brak pełnej listy osób nie uzasadnia oczekiwania: można złożyć zgłoszenie etapowe i niezwłocznie uzupełniać. Spóźnienie wymaga wyjaśnienia. [S01: art. 33]

Osobę zawiadamiamy **bez zbędnej zwłoki przy wysokim ryzyku**. Nie mylić tego testu z niższym progiem zgłoszenia do organu. Rozważyć realne konsekwencje: kradzież tożsamości, phishing, ujawnienie sytuacji zatrudnieniowej obecnemu pracodawcy, zdrowia lub niepełnosprawności, nękanie, oszustwo, utrata szansy pracy. Sam fakt, że plik CV był „tylko przez kilka minut” dostępny, nie dowodzi braku ryzyka. Szyfrowanie pomaga tylko wtedy, gdy dane faktycznie są nieczytelne dla nieuprawnionego odbiorcy i klucz nie wyciekł. [S01: art. 34]

Wyjątki od zawiadomienia osoby oceniać na podstawie art. 34 ust. 3 i dokumentować. Nie ogłaszać publicznie nazwisk poszkodowanych. W razie niewspółmiernego wysiłku indywidualnego kontaktu dobrać równie skuteczny komunikat publiczny; nie stosować wyjątku tylko dlatego, że wysyłka kosztuje.

## 4. Organ i kanał

Najpierw ustalić administratora i jego główne miejsce prowadzenia działalności; domena .be i język interfejsu nie przesądzają właściwości. Wątpliwości dotyczące organu eskalować od razu, nie czekać do godziny 71. Jeśli właściwy jest APD/GBA, korzystać z oficjalnego portalu dostępnego ze strony `https://www.autoriteprotectiondonnees.be/professionnel/actions/violation-de-donnees-personnelles`. APD wymaga języka FR/NL/DE; przygotowany wzór FR służy wypełnieniu aktualnego formularza, nie zastępuje go. Ogólny e-mail i tekst PL/EN nie stanowią odpowiednika poprawnego zgłoszenia. [S22]

Jeśli właściwy jest Prezes UODO lub inny organ, użyć jego aktualnego oficjalnego kanału i właściwego formularza. Kontakt i pełnomocnictwo potwierdzić w protokole przed uruchomieniem. Nie przesyłać naruszenia do BIPT zamiast APD: BIPT jest belgijskim koordynatorem DSA, nie organem ochrony danych. [S23]

## 5. Współpraca z pracodawcami i dostawcami

Procesor ma obowiązek zawiadomić administratora bez zbędnej zwłoki; uzgodniony techniczny cel dostawcy powinien pozwalać operatorowi dotrzymać własnego terminu. Przy własnym przetwarzaniu portal sam ocenia i wykonuje art. 33–34. Nie czeka na zgodę pracodawcy ani komunikat prasowy dostawcy.

Pracodawcę, którego dane lub aplikacje są objęte zdarzeniem, informujemy operacyjnie niezwłocznie, podając fakty konieczne do jego odrębnej oceny. Uzgodnić jednolity i niesprzeczny komunikat, lecz nie przerzucać odpowiedzialności za działania portalu na kandydata. Jeżeli portal jest procesorem w wydzielonym module, kontakt z organem w imieniu pracodawcy wymaga umocowania; nadal należy pomóc administratorowi i wykonywać własne obowiązki.

## 6. Wysyłka do osób

Szablony `wzory/naruszenie-art34-PL-NL-FR-EN.md` zawierają strukturę, nie opis rzeczywistego naruszenia. Wypełnić tylko zweryfikowane fakty; wskazać, co wiadomo, czego jeszcze nie wiadomo, co zrobiono i jakie działania są rzeczywiście pomocne. Nie żądać przesłania hasła, CV ani skanu dowodu w odpowiedzi na komunikat.

Wiadomość bezpieczeństwa nie jest newsletterem i nie wymaga zgody marketingowej. Blokada marketingowa nie może jej tłumić. Przy niedostarczalnym adresie rozważyć bezpieczny inny kanał. Kod wymagający wszystkich czterech tłumaczeń przed pierwszą wysyłką musi mieć ścieżkę awaryjną: wysłać pilnie zrozumiałą wersję osobie, a brakujące tłumaczenia uzupełnić. Nie wysyłać wszystkich wersji z pełną listą adresów w polu Do/DW.

## 7. Rejestr i zamknięcie

Pola rejestru: identyfikator, właściciel, momenty sygnału i stwierdzenia, źródło, systemy, kategorie danych/osób i przybliżone liczby, zakres ujawnienia, ocena prawdopodobieństwa i dotkliwości, decyzje art. 33/34 z uzasadnieniem, numer zgłoszenia, zawiadomienia i ich doręczenie, zastosowane środki, przyczyna, plan naprawy, data weryfikacji zamknięcia, przegląd retencji.

Minimalny rejestr dowodowy proponuje się zachować 1095 dni od zamknięcia; surowe dane incydentu usuwać wcześniej zgodnie z niezbędnością. Postępowanie organu lub konkretny spór może uzasadniać wydzielony legal hold z przeglądem, bez zamrożenia całego systemu. Po zdarzeniu przeprowadzić w ciągu 14 dni roboczych przegląd przyczyn i skuteczności środków; jest to cel własny, nie termin ustawowy.

## 8. Próba przed uruchomieniem

Przeprowadzić ćwiczenie: błędna RLS ujawnia 12 CV drugiej firmie, jedno zawiera informację zdrowotną, jeden kandydat jest niepełnoletni, poczta operatora nie działa. Oczekiwane dowody: kontakt z zastępcą, odcięcie dostępu, zachowanie minimalnych logów, rozróżnienie stwierdzenia od pełnej wiedzy, dwa testy ryzyka, projekt zgłoszenia w 48 godzinach, alternatywny kanał do osób, brak blokady przez zgody marketingowe. Ćwiczenie nie jest faktycznym zawiadomieniem organu.
