# PROJEKT — do weryfikacji prawnika, nieopublikowany

> Dokument roboczy dla #487 i #498. Nie jest opinią prawną, polityką prywatności ani treścią
> dla użytkowników. Opisuje, co robi kod, i zbiera pytania do prawnika. Nic z tego dokumentu
> nie trafia do UI. Do czasu decyzji import CV przez AI pozostaje wyłączony
> (`AI_CV_IMPORT_ENABLED` nieustawione).

## 1. Zakres techniczny (stan kodu)

Opis techniczny: `docs/AI_CV_IMPORT.md`.

- Kandydat sam uruchamia import w panelu. Najpierw widzi tekst, który zostałby wysłany, dopiero
  potem potwierdza wysyłkę do dostawcy AI.
- Plik i tekst są przetwarzane wyłącznie w pamięci żądania. Nie są zapisywane, logowane ani
  dodawane do dokumentów kandydata. Przepływ nie udostępnia CV firmom.
- Przed wysyłką kod usuwa: sekcje referencji, linie o osobach trzecich (referent, osoba
  kontaktowa, przełożony z imieniem i nazwiskiem), dane osobowe kandydata (data urodzenia,
  adres, stan cywilny, obywatelstwo…), e-maile, telefony, linki oraz linie z informacjami
  o zdrowiu, religii, poglądach, związkach zawodowych, pochodzeniu, orientacji i karalności.
- Numer NISS/BIS, PESEL albo numer dokumentu → odmowa importu całego pliku.
- Kontakt znaleziony poza nagłówkiem dokumentu albo kilka adresów e-mail → import zatrzymany
  (nie da się wiarygodnie oddzielić danych osób trzecich).
- Model zwraca wyłącznie propozycje: zawody, umiejętności, języki, certyfikaty, lata
  doświadczenia. Każdą kandydat zatwierdza osobno. Nic nie trafia do profilu bez zatwierdzenia.
- Wynik nie jest używany do oceny, rankingu, screeningu ani dopasowania.
- Brak automatycznego kontaktu z referentami, brak ekstrakcji ich danych do profilu, brak
  indeksowania danych referentów.

## 2. Pytania do prawnika — import CV (#487)

1. Podstawa prawna (art. 6 RODO) dla wysłania zminimalizowanego tekstu CV do dostawcy AI na
   wyraźne żądanie kandydata. Czy przycisk „Wyślij do analizy” wystarcza jako element
   realizacji żądania, czy potrzebna jest odrębna zgoda z zapisem dowodu?
2. Rola Pracuj.be i dostawcy (administrator / podmiot przetwarzający), umowa powierzenia,
   transfer poza EOG i retencja po stronie dostawcy (#488).
3. Art. 9 i 10 RODO: czy usuwanie linii ze słowami kluczowymi (zdrowie, religia, karalność…)
   przed wysyłką jest wystarczające, czy import należy całkowicie zablokować, gdy takie linie
   wystąpią? Kod dziś je usuwa i pokazuje kandydatowi liczbę usuniętych linii.
4. Treść informacji dla kandydata (art. 13) w PL/NL/FR/EN — obecne teksty w UI są neutralne
   i techniczne (`src/messages/*.json`, przestrzeń `cvImport`); do zatwierdzenia z #61.
5. Czy wynik propozycji (bez zapisu) wymaga wpisu w rejestrze czynności (#485) osobno od
   ręcznego profilu?
6. AI Act: potwierdzenie, że przy obecnym użyciu (propozycje dla samego kandydata, bez oceny)
   funkcja nie jest systemem z załącznika III pkt 4(a).

## 3. Pytania do prawnika — osoby trzecie w CV (#498)

1. Art. 14 RODO wobec referentów, których dane są w pliku CV przechowywanym prywatnie
   (pasywne przechowywanie) — czy i kiedy trzeba ich informować, czy ma zastosowanie wyjątek
   z art. 14 ust. 5, jak udokumentować uzasadnienie.
2. Czy usunięcie danych referentów przed wysyłką do AI (bez ich przetworzenia przez dostawcę)
   zamyka temat art. 14 dla samego importu?
3. Wskazówka dla kandydata przy uploadzie CV („nie dodawaj danych kontaktowych innych osób,
   jeśli nie są potrzebne”) — brzmienie i miejsce (#61).
4. Kanał realizacji praw referenta (dostęp, sprostowanie, usunięcie) przy CV przechowywanym
   przez kandydata (#486).
5. Warunki ewentualnego ręcznego sprawdzania referencji przez pracodawcę według APD — produkt
   dziś tego nie oferuje; opis potrzebny tylko, jeśli funkcja powstanie.

## 4. Czego kod NIE rozstrzyga

- Kod nie decyduje o podstawie prawnej ani o treści informacji dla użytkowników.
- Heurystyki redakcji działają na tekście i mogą nie wykryć danych zapisanych nietypowo
  (np. imię referenta bez żadnego kontaktu i bez słowa kluczowego). Dlatego kandydat widzi
  podgląd przed wysyłką i może zrezygnować.
- Skan antywirusowy i izolacja parsera w osobnym procesie są otwarte (usługa zewnętrzna).

## 5. Warunki włączenia (propozycja)

1. Zatwierdzone odpowiedzi na pytania z sekcji 2 i 3.
2. Umowa z dostawcą AI i ocena transferu.
3. Zatwierdzone teksty UI w czterech językach.
4. Decyzja właściciela i ustawienie `AI_CV_IMPORT_ENABLED=1`.
