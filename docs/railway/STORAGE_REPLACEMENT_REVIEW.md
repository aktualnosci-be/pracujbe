# Zastąpienie Supabase Storage — prywatne CV w Railway Buckets

Data przeglądu i aktualizacji: 21 września 2026. Zakres: odczyt kodu i dokumentacji dostawcy; bez wdrożenia, utworzenia zasobów ani testów produkcyjnych. Obowiązują CLAUDE.md i DECYZJE.md: pusta instalacja, jedna produkcja z main, wymiana Supabase etapami. Ten dokument proponuje rozwiązanie issue #26, nie stwierdza jego wdrożenia. Wymóg „wszystko na Railway” nie narzuca filesystemu.

## Aktualna rekomendacja: Railway Buckets, bez wolumenu przy web

Rekomenduję natywny prywatny Railway Bucket zgodny z S3. Jest dostępny jako zasób projektu; nie trzeba uruchamiać własnego MinIO ani zewnętrznego konta storage. Dane są niezależne od kontenera web, więc nie wprowadzamy związanych z montowaniem wolumenu ograniczeń replik i przerw podczas redeploy. To wniosek architektoniczny, nie obietnica całkowitego braku przerw w aplikacji. Wariant Volume poniżej pozostaje analizą alternatywy, nie planem domyślnym.

Railway potwierdza prywatne buckety, operacje Put/Get/Head/Delete/List/Copy i presigned URLs. Sekrety oraz region/endpoint/bucket przekazuje się jako referencje zmiennych. Region wybiera się przy utworzeniu. Dokumentacja wymienia brak versioningu, object lock, lifecycle i automatycznych backupów. FAQ potwierdza szyfrowanie at rest, mimo że lista zgodności mówi o braku server-side encryption — nie utożsamiać braku obsługi opcji API SSE z przechowywaniem jawnych danych. Przed wymaganiem własnych kluczy KMS potrzebne jest potwierdzenie dostawcy. [Railway Buckets](https://docs.railway.com/storage-buckets), [pełna dokumentacja z FAQ](https://docs.railway.com/storage-buckets.md).

### Koszt i dostępność

| Element | Railway Bucket | Volume przy web |
|---|---|---|
| Przechowywanie | 0,015 USD/GB-miesiąc | 0,15 USD/GB-miesiąc |
| Przykład 10 GB przez miesiąc | 0,15 USD | 1,50 USD |
| Pobranie bezpośrednie | Presigned URL: egress bucketa bez opłaty | Odpowiedź web zużywa płatny egress usługi |
| Upload przez backend | Płatny egress usługi do bucketa | Lokalny zapis; bez przesyłania do bucketa |
| Repliki web | Storage nie wymaga wspólnego mountu | Brak replik z wolumenem |
| Kopie | Własna procedura; brak automatycznych snapshotów bucketów | Dostępne backupy wolumenu |

Stawki nie obejmują abonamentu, CPU/RAM, backupów ani transferu web; service egress wynosi 0,05 USD/GB. Bucket jest dostępny po publicznym HTTPS, nie przez prywatną sieć Railway. Upload web→bucket i pobieranie proxy web→użytkownik naliczają egress usługi. Hobby ma łącznie 1 TB limitu bucketów; Pro według dokumentacji nie ma limitu pojemności. Limited Trial nie udostępnia bucketów; Free/Trial mają własne limity. Hard Usage Limit może zablokować zarówno zapis, jak i odczyt. Nie sprawdzano uprawnień aktualnego konta ani nie zamawiano zasobu. [Billing bucketów](https://docs.railway.com/storage-buckets/billing), [cennik Railway](https://docs.railway.com/pricing/plans), [ograniczenia Volume](https://docs.railway.com/volumes/reference).

### Plan adaptera S3 i zachowanie autoryzacji

1. Dodać jeden adapter `server-only` z operacjami `putPrivateObject`, `readPrivateObject`, `deletePrivateObject`, `headPrivateObject` i opcjonalnie `presignPrivateGet`. Użyć oficjalnego AWS SDK S3 oraz presignera tylko gdy wymagany, bez własnej implementacji podpisów S3. Jawne ustawienia ze zmiennych referencyjnych Railway: faktyczny `BUCKET` (nie nazwa wyświetlana), `ENDPOINT`, `REGION`, `ACCESS_KEY_ID`, `SECRET_ACCESS_KEY`; wartości serwerowe, nigdy `NEXT_PUBLIC_*`. Styl adresowania sprawdzić w Credentials, nie wymuszać na ślepo path-style. SDK nie zastępuje autoryzacji użytkownika.
2. Zachować upload przez obecną akcję serwerową jako najkrótszą bezpieczną zmianę: sesja kandydata → limity → rzeczywista walidacja bajtów → `PutObject` pod losowym, niezmiennym kluczem → INSERT metadanych przez RLS → sukces. Przy błędzie bazy `DeleteObject` i retry sprzątania; brak konfiguracji to błąd, nigdy demo-sukces. Nie traktować ETag jako gwarantowanego SHA-256: wyliczyć checksum samodzielnie. Plik maksymalnie 5 MiB nie wymaga multipart S3.
3. Domyślnie zachować silniejszy kontrakt pobrania opisany niżej: podpisana trasa aplikacji + aktualna sesja + ponowny RLS/stan, następnie serwerowe `GetObject` i strumień do klienta. Daje natychmiastowe odcięcie dostępu po usunięciu metadanych lub wylogowaniu, kosztem service egress. Nie montuje wolumenu i działa przy wielu instancjach. `no-store`, attachment i redakcja logów pozostają obowiązkowe.
4. Railway obsługuje także prostszy ekonomicznie wariant: po autoryzacji przekierowanie na S3 presigned GET z TTL 60 s. To jednak **bearer URL**: posiadacz może pobrać obiekt do wygaśnięcia, bez ponownego sprawdzania sesji. Logout lub DELETE samych metadanych nie unieważnia istniejącego URL; potrzebne usunięcie obiektu lub upływ TTL. To odpowiada obecnemu mechanizmowi Supabase, lecz osłabia proponowany kontrakt proxy. Nie mieszać tych wariantów w testach: rekomendacja bazowa to proxy dla prywatnych CV, presigned GET dopiero jako jawnie zaakceptowany kompromis. Podpisanego URL nigdy nie zapisywać w bazie ani logach.
5. Bezpośredni upload przeglądarka→bucket przez presigned POST pozostawić jako optymalizację. Wymaga ścisłego klucza, limitu długości, CORS dla konkretnego originu oraz kwarantanny i walidacji serwerowej po uploadzie. Nigdy nie oznaczać obiektu gotowym na podstawie samego komunikatu klienta. Obecne ≤5 MiB nie uzasadnia dokładania tego przepływu do pierwszej implementacji.
6. DELETE: transakcyjny `DELETE … RETURNING` własnych metadanych, potem `DeleteObject`; niezależny retry/GC dla awarii. GC może działać z osobnego zadania z ograniczonymi poświadczeniami, nie potrzebuje mountu web. Ponieważ lifecycle nie jest dostępny, nie wpisywać fikcyjnych automatycznych reguł retencji. Lista kluczy, ochrona świeżych uploadów i porównanie metadanych pozostają konieczne. Faktury korzystające ze wspólnego helpera zachowują odrębne zasady dostępu.

Oficjalny przewodnik potwierdza presigned download/upload i backend proxy oraz wskazuje różnice transferu. Powyższy wybór proxy i limity są decyzją projektową dla CV. [Uploading & Serving Files](https://docs.railway.com/storage-buckets/uploading-serving), [wersja Markdown](https://docs.railway.com/storage-buckets/uploading-serving.md).

### Backup i testy specyficzne dla Buckets

Trwałość obiektowa nie zastępuje kopii. Zaplanować aplikacyjny eksport manifestu metadanych + checksum oraz kopię obiektów do osobnego bucketa backupowego, z oddzielnymi poświadczeniami i retencją; wszystko nadal może znajdować się na Railway. Nie daje to niezależności od awarii/usunięcia całego konta — odnotować tę granicę. Brak versioningu/lock oznacza, że trzeba samodzielnie zachowywać datowane kopie i chronić uprawnienia. Koszt drugiej kopii i procedurę odtworzenia zatwierdzić przed płatnym uruchomieniem. Kopię usuniętego CV usuwa się po jawnej retencji; test odtworzenia uzgadnia rekordy DB i obiekty, zamiast zakładać atomowy backup obu.

Do kryteriów poniżej dopisać: brak dostępu do surowego obiektu bez autoryzacji; S3 timeout/403/404/5xx; przerwane PutObject; niepewny wynik zapisu i idempotentne sprzątanie; odczyt z drugiej instancji po uploadzie pierwszej; restart bez lokalnego pliku; zgodność endpointu i stylu adresowania z Railway; checksum po backup/restore. Dla proxy sprawdzić wygaśnięcie sesji i skasowanie metadanych. Jeżeli osobno zaakceptowany będzie direct presign, test ma udokumentować jego dozwolone 60-sekundowe okno bearer, a nie oczekiwać niemożliwego natychmiastowego unieważnienia samym logoutem.

Nie tworzyć bucketa ani nie dodawać SDK w ramach tego przeglądu. Następny etap: zaakceptować wariant pobrania i budżet backupu, następnie implementować adapter/testy po #24/#25. Poniższa analiza filesystemu służy porównaniu i nie uzasadnia już tworzenia wolumenu web.

## Obecne przepływy i granice dostępu

| Operacja | Aktualny kod | Co rzeczywiście robi |
|---|---|---|
| Wybór i upload | `src/components/candidate/CvUpload.tsx`, `src/lib/actions/files.ts:62` | FormData → Server Action; blokada przycisku; limit upload 20/h; walidacja; `auth.getUser()`; obiekt w prywatnym `candidate-files`; metadane w `files`. |
| Klucz obiektu | `src/lib/actions/files.ts:84` | `<user UUID>/cv-<losowy UUID>.<ext>`; oryginalna nazwa wyłącznie w metadanych, obcięta do 200 znaków. |
| Lista i pobranie | `src/lib/data/candidate.ts:getCandidateFiles`, `src/lib/storage.ts:getSignedFileUrl` | Lista własnych `candidate_cv`, bez `deleted_at`; podpisany URL generowany już podczas pobrania listy, TTL 60 s; UI otwiera go w nowej karcie. |
| Usunięcie | `src/lib/actions/files.ts:120`, `src/lib/storage.ts:removeFile` | Pobranie metadanych pod RLS → DELETE metadanych → usunięcie obiektu. Błąd storage po DELETE jest logowany; użytkownik dostaje sukces, obiekt może zostać sierotą. |
| Polityki | `supabase/migrations/0009_rls.sql:825`, `0018_storage.sql` | Metadane czyta właściciel lub każdy przy `visibility=public`; zapis/DELETE metadanych tylko właściciel. Storage ogranicza operacje do folderu UUID sesji w `candidate-files`. |
| Inny konsument helpera | `src/lib/data/billing.ts:resolveInvoicePdfUrl` | Faktury także wywołują `getSignedFileUrl`, TTL 300 s. Zamiana helpera globalnie wymaga osobnego adaptera i autoryzacji faktur; nie przypisywać im zasad CV. |

Obecna akcja sprawdza zalogowanie, ale sama nie wymaga roli `candidate`. Pracodawca z sesją również spełnia warunek właściciela folderu. Nowy upload CV powinien jawnie wymagać konta kandydata. Nie ma udowodnionej ścieżki pobierania CV przez rekrutera: sam dostęp do profilu nie upoważnia do prywatnego pliku; takiej funkcji nie dodawać przy wymianie backendu.

Stan `scan_status` istnieje od migracji 0044, lecz aktualny loader go nie wybiera ani nie filtruje. Upload zapisuje `skipped`; AV nie działa. Walidacja DOCX szuka jedynie ciągów `[Content_Types].xml` i `word/` w bajtach — to nie jest parser archiwum ani dowód bezpieczeństwa dokumentu. Brak konfiguracji Supabase daje uploadowi fikcyjny sukces; produkcyjny adapter wolumenu musi zamiast tego jawnie odmówić zapisu. Obecne URL wygasają po minucie od renderu listy: docelowo wystawiać je dopiero po kliknięciu.

## Alternatywa: Volume dla jednej instancji (niezalecana domyślnie)

1. Jeden Railway Volume podpięty do `web`, np. `/data`, katalog wyłącznie prywatny `/data/candidate-files`. Konfiguracja `PRIVATE_FILES_ROOT`; bez fallbacku do `public/`, katalogu aplikacji lub `/tmp`. Oddzielny wolumen PostgreSQL pozostaje przy jego usłudze.
2. Moduł `server-only` obsługuje `put/read/remove` przez Node filesystem. Klient przesyła wyłącznie plik lub ID metadanych, nigdy dowolną ścieżkę/bucket. Klucz buduje serwer z UUID właściciela i losowego ID. Rozwiązywanie ścieżki sprawdza granicę katalogu i odrzuca dowiązania; nie podąża za symlinkami. Katalog i pliki otrzymują restrykcyjne prawa. Przed otwarciem uploadów zweryfikować UID procesu i dostęp do faktycznie zamontowanego katalogu.
3. Uwierzytelnienie z #24, metadane przez transakcję RLS z #25. Zapis wymusza `owner_id` z sesji, `visibility=private`, `entity_type=candidate_cv`, logiczny bucket `candidate-files`. Nie ufać polom pochodzącym z formularza. Odczyt CV dodatkowo wymaga własności nawet wtedy, gdy błędne metadane mają `visibility=public`.
4. Wystawienie podpisanego URL: autoryzowany POST/Server Action z ID pliku, odczyt własnego, aktywnego rekordu, kontrola `scan_status`. HMAC-SHA256 z osobnym sekretem obejmuje wersję podpisu, ID pliku, ID uprawnionego użytkownika i czas wygaśnięcia; TTL maksymalnie 60 s ustalony na serwerze. Nie umieszczać ścieżki, nazwy CV ani e-maila w tokenie.
5. Route Handler pobrania wymaga zarówno poprawnego podpisu, jak i aktualnej sesji tego samego użytkownika; ponownie sprawdza rekord/własność/stan. Usunięcie rekordu od razu unieważnia także wcześniej wystawione URL. Podpis nie zastępuje autoryzacji. Bez osobnego publicznego serwera plików i bez CDN cache. `Cache-Control: private, no-store`, `Content-Disposition: attachment` z bezpiecznym kodowaniem nazwy, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`.
6. Nie logować nazw, ścieżek, treści, tokenów ani pełnego URL pobrania. Redagować query string również w monitoringu i dostępie HTTP. Ograniczyć równoległe odczyty i uploady; dostęp do DB zakończyć przed długim strumieniowaniem pliku.

## Zapis, usuwanie i odzyskiwanie po awarii

Filesystem i PostgreSQL nie mają wspólnej transakcji. Kolejność musi świadomie tolerować awarię w każdym miejscu:

- Upload: zweryfikowana sesja i limit → walidacja → zapis losowego pliku tymczasowego na tym samym wolumenie z wyłącznością tworzenia → zamknięcie/synchronizacja → atomowa zmiana nazwy na docelową → transakcyjny INSERT metadanych. Sukces dopiero po COMMIT. Przy błędzie INSERT usunąć plik; awaria procesu może pozostawić sierotę, lecz nie rekord dostępny bez obiektu.
- Delete: odczytać i usunąć własny rekord przez `DELETE … RETURNING`, COMMIT, dopiero potem `unlink`. Brak pliku traktować idempotentnie. Nie kasować obiektu na podstawie samego SELECT przed sprawdzeniem wyniku DELETE. Po awarii unlink dostęp już jest odcięty; sprzątanie musi mieć retry.
- GC: okresowo porównać wyłącznie serwerowe klucze z metadanymi, usunąć stare tymczasowe pliki i sieroty po okresie ochronnym, np. 24 h. Nigdy nie usuwać świeżego uploadu między rename a COMMIT. GC uruchamia proces posiadający ten wolumen; osobny cron Railway nie otrzyma automatycznie filesystemu `web`. Można wywołać istniejącą autoryzowaną ścieżkę maintenance w web, z osobnym zakresem operacji i ograniczoną partią.
- Ograniczyć zużycie miejsca: propozycja początkowa 5 aktywnych CV / 25 MiB na konto; jest to nowy limit produktu do zatwierdzenia przed implementacją. Egzekwować w transakcji z blokadą konta, aby dwa uploady nie ominęły limitu. Ustalić także budżet całego wolumenu i próg zatrzymania nowych uploadów, zostawiając miejsce na usuwanie i działanie aplikacji.

## Limity i walidacja

Zachować dokładny limit pliku `5 * 1024 * 1024` bajtów; obecny opis „5 MB” oznacza w kodzie 5 MiB. Server Actions mają limit żądania 6 MB dla multipart. Sprawdzać rzeczywistą liczbę bajtów, nie sam nagłówek Content-Length, odrzucać pusty plik. Utrzymać 20 prób/h oraz ochronę CSRF/origin i blokadę wielokrotnego wysłania; nie dopuszczać nieograniczonego buforowania równoległych żądań.

Obecne formaty: PDF, DOC, DOCX. Kontrola MIME i sygnatur pozostaje, ale trzeba zastąpić sprawdzanie DOCX parserem katalogu ZIP/OOXML: wymagane wpisy, limit liczby wpisów i rozmiaru po rozpakowaniu, odrzucenie traversal/plików zaszyfrowanych i archiwów z makrami. Nie wypakowywać dokumentu do filesystemu. PDF/DOC także nie stają się bezpieczne przez magic bytes. Nie deklarować AV; `pending` i `infected` nie mogą być pobierane, `clean` oznacza faktycznie wykonany skan, a `skipped` pozostaje nazwanym trybem bez AV dopuszczonym dotychczasowym zakresem. Przed uruchomieniem dla rekruterów potrzebna jest osobna decyzja o skanowaniu.

## Ograniczenia Railway zweryfikowane w oficjalnej dokumentacji

- Usługa może mieć jeden wolumen; usługa z wolumenem nie obsługuje replik. Redeploy powoduje krótką przerwę także przy healthchecku, bo kolejne wdrożenia nie mogą równocześnie montować tego samego wolumenu. To koszt minimalnego rozwiązania; jeśli wymagane są repliki lub ciągła dostępność, wrócić do decyzji o obiektowym storage. [Railway Volumes reference](https://docs.railway.com/volumes/reference)
- Wolumen pojawia się przy starcie, nie podczas builda ani pre-deploy. Inicjalizacja i test praw zapisu muszą działać w starcie/runtime. Railway opisuje montowanie jako root i możliwe problemy procesu non-root; dobrać jawnie użytkownika i uprawnienia, nie zakładać praw zapisu z lokalnego dev. [Using Volumes](https://docs.railway.com/volumes)

## Trwałość i backup

Wolumen przeżywa restart/redeploy; efemeryczny filesystem aplikacji nie jest magazynem CV. To nie zastępuje backupu. Propozycja przed pierwszym realnym uploadem: codzienne kopie wolumenu i PostgreSQL oraz kopia przed operacją destrukcyjną. Jawnie zapisać właściciela procedury i zaakceptowany RPO/RTO; dzienny harmonogram sam w sobie nie gwarantuje braku utraty ostatnich uploadów.

Railway obsługuje ręczne i automatyczne kopie wolumenów. Dokumentacja podaje retencję: codzienne 6 dni, tygodniowe 27 dni, miesięczne 89 dni. Odtworzenie pozostaje w tym samym projekcie i środowisku; wyczyszczenie wolumenu usuwa jego kopie. Ręczne backupy mają opisany limit danych 50% pojemności wolumenu. Parametry ponownie sprawdzić przy konfiguracji usługi. [Railway Backups](https://docs.railway.com/volumes/backups)

Kopia bazy i plików nie jest automatycznie spójnym snapshotem. Najprostsza procedura odtworzenia: wstrzymanie operacji plikowych → wybór zgodnej pary kopii → odtworzenie → porównanie wszystkich aktywnych rekordów z kluczami, rozmiarem i SHA-256 → raport braków, bez automatycznego niszczenia danych → otwarcie dostępu. Dodać checksum do metadanych nową migracją, nie przepisywać historii. Test odzyskiwania wykonuje się na izolowanych zasobach, bez nadpisywania produkcji. Osobna szyfrowana kopia poza projektem ogranicza skutki jego utraty, ale wymaga zatwierdzenia miejsca, kosztu i retencji. Usunięcie CV może pozostawiać je w kopiach do końca jawnej retencji — uwzględnić w procedurach prywatności.

## Kryteria odbioru implementacji

1. Prawdziwe upload/download/delete bez SDK Supabase; kandydat widzi tylko własne CV, anonim i drugi użytkownik dostają odmowę także przy znanym UUID, cudzym podpisie i podmienionym kluczu. Brak dostępu pracodawcy bez osobnej polityki.
2. Poprawny podpis + własna aktywna sesja działa; zmiana ID/expiry/user/signature, wygaśnięcie, logout, usunięcie pliku i `pending`/`infected` odmawiają. URL wystawiany po kliknięciu, więc długie pozostawienie listy nie psuje pobrania.
3. Format/rozmiar: zero bajtów, 5 MiB, 5 MiB + 1, fałszywy MIME, zwykły ZIP z podszytymi napisami, zip bomb, traversal, symlink, duplikat klucza, nazwa z CRLF; nic poza katalogiem root nie jest czytane/zapisywane/usuwane.
4. Wstrzyknięte awarie zapisu, rename, INSERT, COMMIT i unlink; brak fałszywego sukcesu uploadu, brak publicznego osieroconego obiektu, powtarzalne sprzątanie. Dwa jednoczesne uploady nie obchodzą limitów; pełny dysk i brak mountu dają bezpieczny błąd.
5. Restart i redeploy z zachowanym wolumenem zachowują bajty; kontrolowany backup/restore odtwarza metadane i SHA-256. Odnotować zmierzony czas przerwy i przywrócenia.
6. Cztery języki, zachowanie UI przy błędzie, brak sekretów/PII w logach, brak cache plików w CDN. Faktury nadal mają własną kontrolę dostępu i nie przechodzą przypadkiem przez zasady CV.

Kolejność prac dla rekomendowanych Buckets: ukończyć sesje #24 i adapter RLS #25 → adapter S3 i autoryzowane pobranie z testami → metadane/checksum i GC → podpiąć akcje/UI → izolowany odbiór restartu/odzyskiwania → zatwierdzona konfiguracja produkcyjnego bucketa. Wariant filesystem wymaga osobnego wyboru Volume i akceptacji jego ograniczeń. Nie oznaczać #26 jako ukończonego na podstawie samego dokumentu lub testów shimu: migracja 0018 bez Supabase Storage jest no-op.
