> **PROJEKT — do weryfikacji prawnika, nieopublikowany.** Opracowanie zewnętrzne z 25.09.2026 (analiza, nie opinia kancelarii); nic z tego pliku nie jest w UI.

# Dostawcy, powierzenie i transfery

Wersja 1.0, 25.09.2026. Rejestr oceny publicznych warunków i wymagań wobec operatora. **Nie potwierdzono umów ani ustawień konkretnego konta Pracuj.be. Żaden dostawca nie otrzymuje w tym pliku automatycznego statusu zatwierdzenia.** [S01: art. 28, 44–49]

## 1. Zasady kwalifikacji

Powierzenie dotyczy operacji wykonanych na polecenie administratora. Własne cele dostawcy — np. obsługa jego kont, rozliczenia lub wskazany rozwój produktu — mogą oznaczać odrębne administrowanie. Nie można oznaczyć całej firmy jedną rolą bez względu na cel. Wybór regionu obliczeń nie wyklucza globalnego wsparcia, kopii, telemetrii ani dalszych podmiotów. [S29]

Kolejność decyzji: najpierw konieczność danych i usługi; następnie dopuszczalność kategorii w DPA, regiony i dostęp; dopiero potem mechanizm transferu. DPF jest możliwy tylko dla właściwej aktualnie certyfikowanej osoby prawnej i zakresu danych. W tym badaniu nie potwierdzono takich wpisów, więc nie wpisywać „DPF zweryfikowany”. Dla SCC wybrać właściwy moduł, uzupełnić aneksy, wykonać konkretną ocenę transferu oraz sprawdzić środki dodatkowe; własne klucze są skuteczne wobec dostępu tylko w takim zakresie, w jakim usługodawca nie potrzebuje tekstu jawnego. [S01]

## 2. Rejestr usług

### Railway — hosting, PostgreSQL, obiekty

Publiczny DPA wskazuje Railway Corporation i wymaga zakończenia opisanej procedury wykonania dokumentu. Zakłada powierzenie danych klienta, SCC w odpowiednim zakresie i odrębne przetwarzanie niektórych danych konta/użycia. Aneks wskazuje brak planowanych kategorii szczególnych; trzeba uzgodnić ryzyko takich treści w CV. Nie znaleziono w dostarczonym materiale dowodu podpisania ani rzeczywistej lokalizacji zasobów Pracuj.be. [S13]

**Do zatwierdzenia:** podpisana/wykonana wersja, projekt i usługi objęte DPA, konkretna lokalizacja bazy i storage, regiony kopii i logów, dostęp administracyjny, dalsi procesorzy, transfer/TIA oraz terminy trwałego usunięcia. Wymagać potwierdzenia, czy przyjęta konfiguracja kontraktowo i technicznie obsługuje rzeczywistą zawartość CV. Stan: niezatwierdzone przed przyjęciem prawdziwych CV.

### Supabase — przejściowy backend/auth/storage

Opis techniczny wciąż odwołuje się do Supabase i fallbacku storage. Oficjalne materiały pozwalają wybrać konkretny region usług podstawowych, ale przestrzegają, że kopie, logi, edge i podwykonawcy wymagają odrębnej analizy. „Europe” nie znaczy zawsze „Unia Europejska”. [S20]

**Do zatwierdzenia:** właściwa strona DPA, aktywne projekty, wybrany region, tokeny i uprawnienia, retencja logów i backupów, transfery wsparcia oraz sposób wycofania usługi. Po migracji potrzebny dowód skasowania obiektów, kopii migracyjnych i nieużywanych sekretów. Do tego czasu uwzględniać rzeczywiste równoległe przetwarzanie.

### Resend — poczta

Publiczne dokumenty wskazują Plus Five Five, Inc., automatyczne włączenie DPA do relacji z zarejestrowanym klientem i możliwość pobrania kopii w panelu. Strona GDPR podaje przechowywanie w USA, standardową retencję danych wiadomości 30 dni dla opisanych planów oraz inne reguły dla Enterprise i zakończenia umowy. Nie traktować wyboru europejskiego regionu wysyłki jako rezydencji danych. [S14–S15]

**Do zatwierdzenia:** podmiot i konto, dowód właściwych warunków, plan, faktyczna retencja i usuwanie, SCC/TIA lub zweryfikowana właściwa decyzja adekwatności. Przesyłać adres i minimalne pola komunikatu; bez CV i treści rozmów. Przejrzeć podwykonawców, także obsługę nadużyć; nie włączać opcjonalnych narzędzi AI w panelu bez nowej oceny. Testować otrzymany plik `.eml`: brak śledzącego piksela i przepisywania odnośników, a nie tylko brak ustawienia tracking w kodzie.

### Cloudflare Turnstile — ochrona formularzy

Turnstile Privacy Addendum opisuje rolę procesora dla ochrony strony i administratora dla własnego doskonalenia wykrywania botów. Dostawca otrzymuje sygnały urządzenia; pominięcie `remoteip` w wywołaniu serwerowym nie oznacza, że Cloudflare nie widzi adresu w bezpośrednim połączeniu przeglądarki. [S16]

**Do zatwierdzenia:** właściwe warunki/DPA i transfery, dokładne tryby widgetu, cel i zakres sygnałów, retencja, pre-clearance i ewentualne cookies, połączenia sieciowe przed interakcją. Wyjątek „niezbędne” ocenić osobno dla funkcji, nie według nazwy produktu. Jeśli ubocznych celów nie da się odpowiednio rozdzielić i uzasadnić, zastąpić ochroną mniej ingerującą albo zastosować właściwy model zgody, zachowując dostęp do praw i DSA. Konieczny alternatywny kanał dla osoby, której widget nie działa.

### Anthropic — import ogłoszenia

DPA komercyjny włącza się do objętej nim umowy, wskazuje powierzenie i SCC oraz brak planowanych kategorii szczególnych. Aktualna informacja API podaje standardowe usuwanie wejść/wyjść do 30 dni z wyjątkami, w tym dla wybranych funkcji, bezpieczeństwa i prawa. Dla „Covered Models” istnieją szczególne wymogi retencji, także wobec wcześniej bezretencyjnych konfiguracji. Nie wolno pisać „API zawsze ZDR” ani „nigdy nie przechowuje danych”. [S17–S19]

**Decyzja:** OFF do ustalenia konta, dokładnego modelu, funkcji, geografii, warunków użycia danych, retencji i transferów. Tekst po minimalizacji może otrzymać osobne dopuszczenie. Zrzut ekranu pozostaje zablokowany do redakcji przed transmisją; filtr odpowiedzi jest za późny. Brak zgodności deklarowanych modeli w opisie z rzeczywistą konfiguracją również blokuje zatwierdzenie.

### Sentry — błędy

Publiczny DPA wskazuje zakaz przesyłania danych szczególnych. Samo filtrowanie części pól nie dowodzi braku takich danych w URL, błędzie, breadcrumb, załączniku czy stack trace. [S21]

**Decyzja:** OFF. Przed włączeniem: DPA, region organizacji i właściwa retencja konkretnego planu, transfery, test syntetycznych sekretów oraz nazwisk we wszystkich ścieżkach. Dopuszczać wyłącznie allowlistę kodów technicznych; bez Session Replay, profilowania wydajności, identyfikatorów użytkowników, body i pełnych adresów URL, dopóki nie uzasadniono każdego celu. Prawdziwe próbki kandydatów nie są materiałem testowym.

### Pozostałe zależności

Google Analytics, Meta Pixel i Stripe pozostają poza aktywnym modelem LAUNCH-1. Puste tabele lub flagi nie dowodzą przetwarzania, lecz aktywne skrypty nawet „testowe” mogą je tworzyć. Przed włączeniem potrzebna osobna kwalifikacja ról, informacja, właściwa zgoda i retencja. Nie wysyłać wydarzeń o aplikowaniu ani identyfikatorów kandydatów do reklamowego trackera w ramach tej rekomendacji.

VIES to weryfikacja wskazanego numeru VAT, nie usługodawca, któremu można automatycznie narzucić standardowy DPA hostingowy. Nie przesyłać danych kandydata; VAT i dane przedsiębiorcy jednoosobowego mogą być danymi osobowymi. Własna skrzynka obsługi, DNS/CDN, domena, miejsce backupów, administratorzy i wykonawcy IT także muszą znaleźć się w ewidencji, jeśli mają dostęp do danych. Nie zostały automatycznie zatwierdzone przez brak ich nazw w zleceniu.

## 3. Karta transferu — wymagany zakres dowodu

Dla każdego przepływu zapisać osobę prawną eksportera i importera, rolę, państwa przetwarzania i zdalnego dostępu, kategorie osób/danych, cel, częstotliwość, maksymalny czas oraz dalsze przekazania. Następnie wskazać podstawę: adekwatność w dokładnym zakresie lub SCC z właściwym modułem i uzupełnionymi aneksami. Przy SCC: zbadać prawo/praktykę dostępu państwowego, możliwość dostępu do tekstu jawnego, zawiadamianie i kwestionowanie żądań, minimalizację, szyfrowanie, klucze, dostęp serwisowy, audyt i kasowanie.

Wynik karty ma być jednym z trzech: dopuszczenie konkretnego przepływu z warunkami, wymagane dodatkowe środki albo brak zgody na przepływ. Pusta rubryka TIA nie oznacza „brak ryzyka”. Sam certyfikat bezpieczeństwa nie zastępuje art. 28 ani rozdziału V RODO. [S01]

## 4. Minimalne postanowienia i dokumenty umowne

Umowa musi odpowiadać art. 28 ust. 3: przedmiot, czas, cele i rodzaj operacji, kategorie danych/osób, instrukcje, poufność, bezpieczeństwo, dalsze powierzenie, pomoc w prawach/DPIA/naruszeniach, zwrot/usunięcie oraz dowody i audyty. Operator ustala procedurę reagowania na nowego podwykonawcę i krótkie terminy zawiadomień incydentowych, bez uznawania każdego kontraktowego limitu za bezpieczny dla jego własnych 72 godzin. [S01]

Archiwum umów powinno zawierać: plik przyjętej wersji, datę, identyfikator konta/projektu, osobę zatwierdzającą, listę procesorów z datą, konfigurację retencji i regionu, kartę transferu i test usunięcia. Coroczny przegląd oraz przegląd po każdej istotnej zmianie. Zmiany umów nie były dokonywane w ramach tego opracowania.
