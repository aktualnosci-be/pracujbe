# Kontrakt adaptera prywatnych plików — część #26

Stan zweryfikowany 21 września 2026: zaimplementowano `src/lib/storage/railway-bucket.ts` i testy transportu w `tests/unit/railway-bucket.test.ts`; przypięto SDK S3 w manifestach. Nie skonfigurowano bucketa i nie wykonano żądań do Railway. Adapter pozostaje niepodłączony do akcji i tras. Uwierzytelnienie i repozytorium metadanych z #24/#25 muszą być gotowe przed podpięciem endpointów. Kierunek storage: Railway Buckets, zgodnie z STORAGE_REPLACEMENT_REVIEW.md; jedna produkcja, pusta instalacja.

## Dokładny kontrakt zastępowanych funkcji

| Funkcja                                                      | Wejście i wynik                                                                                | Obecne zachowanie istotne dla migracji                                                                                                                                                     |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `getSignedFileUrl` (`src/lib/storage.ts`)                    | `(path: string, bucket = 'candidate-files', ttlSeconds = 60): Promise<string \| null>`         | Klient Supabase pod sesją wystawia URL; brak konfiguracji/błąd/odmowa → null. Przechwytuje wyjątki i raportuje je do Sentry. Autoryzacja opiera się na Storage RLS, nie na samym helperze. |
| `removeFile` (ten sam plik)                                  | `(path: string, bucket = 'candidate-files'): Promise<boolean>`                                 | Remove pod sesją; błąd → false; brak konfiguracji → true. Nie usuwa metadanych.                                                                                                            |
| `uploadCandidateCv` (`src/lib/actions/files.ts`)             | `(formData: FormData): Promise<{ok:true,id:string,path:string} \| {ok:false,error:ErrorCode}>` | Limit 20/h, PDF/DOC/DOCX, 1–5 MiB, sygnatura/heurystyka DOCX, sesja, upload UUID, INSERT files; INSERT failure powoduje próbę remove. Bez konfiguracji zwraca fikcyjny sukces demo.        |
| `deleteCandidateFile` (ten sam plik)                         | `(fileId: string): Promise<{ok:true} \| {ok:false,error:ErrorCode}>`                           | SELECT metadanych pod RLS, DELETE rekordu, potem remove obiektu; błąd remove nie zmienia sukcesu. Nie sprawdza liczby faktycznie usuniętych rekordów.                                      |
| `getCandidateFiles` (`src/lib/data/candidate.ts`)            | `(): Promise<{id:string,fileName:string,url:string\|null}[]>`                                  | Własne nieusunięte `candidate_cv`; po jednym wywołaniu signed URL na rekord. Nie filtruje scan_status. Błąd/brak konfiguracji → pusta lista, co ukrywa awarię.                             |
| `resolveInvoicePdfUrl` (`src/lib/data/billing.ts`, prywatna) | `(supabase, pdfFileId): Promise<string\|null>`                                                 | Czyta bucket/path rekordu files pod sesją, następnie wspólny helper z TTL 300 s. Wywoływana dla faktur aktywnej firmy; lista faktur przechodzi przez RLS.                                  |

`CvUpload` odświeża router po sukcesie; pola `path` wyniku uploadu nie używa. Item.url jest teraz bezpośrednim href nowej karty. Niewielka zmiana UI może zastąpić go przyciskiem wystawiającym podpis przy kliknięciu, bez przebudowy całego panelu. Nie mapować nowego adaptera na stare `path,bucket` przekazane przez klienta; nowe wejście publiczne to wyłącznie ID rekordu.

## Biblioteka: przypięta wersja SDK

W `package.json` i `package-lock.json` przypięto **`@aws-sdk/client-s3@3.1137.0`** dla PUT/DELETE/GET. Wersjonowany manifest pakietu deklaruje `engines.node >=20.0.0`; projekt wymaga Node 22+. Testy wykonują rzeczywiste podpisywanie żądań i deserializację odpowiedzi tej wersji SDK z wstrzykniętym transportem HTTP. To nie zastępuje testu z Railway ani audytu lockfile.

Jeśli zostanie wybrany bezpośredni S3 presigned GET, uzupełnić o **`@aws-sdk/s3-request-presigner@3.1137.0`**; rejestr wskazuje również Node >=20. Dla rekomendowanego proxy z tokenem aplikacji ten drugi pakiet nie jest potrzebny. Nie dodawać pełnego `aws-sdk` v2 ani pakietu multipart `@aws-sdk/lib-storage` dla plików do 5 MiB.

Źródła wersji: [npm registry client-s3](https://registry.npmjs.org/@aws-sdk/client-s3/latest), [npm registry presigner](https://registry.npmjs.org/@aws-sdk/s3-request-presigner/latest). Wersjonowane manifesty do późniejszej weryfikacji: [client-s3 3.1137.0](https://registry.npmjs.org/@aws-sdk/client-s3/3.1137.0), [presigner 3.1137.0](https://registry.npmjs.org/@aws-sdk/s3-request-presigner/3.1137.0). [Oficjalne repo AWS SDK](https://github.com/aws/aws-sdk-js-v3/tree/main/clients/client-s3), [Railway: upload i pobieranie](https://docs.railway.com/storage-buckets/uploading-serving).

## Zaimplementowany interfejs infrastruktury

Moduł `server-only`; `createRailwayBucket` tworzy oficjalny `S3Client`, a `requestHandler` pozwala wstrzyknąć transport HTTP dla testów. Jeden bucket ustalony z serwerowej konfiguracji, bez dowolnego bucketu w metodach. Endpoint wymaga HTTPS, bez danych logowania w URL, ścieżki, query i fragmentu. `forcePathStyle` domyślnie wynosi `false`; właściwy styl, endpoint, region i nazwę bucketa trzeba potwierdzić w Credentials Railway. Sekrety nie trafiają do bundle klienta, argumentów publicznej akcji ani błędów. Metody nie znają ról biznesowych i same nie stanowią autoryzacji.

```ts
type StorageErrorCode =
  | "NOT_CONFIGURED"
  | "INVALID_INPUT"
  | "NOT_FOUND"
  | "CONFLICT"
  | "ACCESS_DENIED"
  | "UNAVAILABLE"
  | "TIMEOUT"
  | "CANCELLED";
type StorageResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: StorageErrorCode; retryable: boolean };

interface PrivateObjectStore {
  put(input: {
    key: string; // wygenerowany wyłącznie na serwerze, niezmienny UUID
    bytes: Uint8Array;
    contentType:
      | "application/pdf"
      | "application/msword"
      | "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    signal?: AbortSignal;
  }): Promise<
    StorageResult<{ key: string; sizeBytes: number; sha256: string }>
  >;

  delete(input: {
    key: string;
    signal?: AbortSignal;
  }): Promise<StorageResult<{ deleted: true }>>;

  openStream(input: { key: string; signal?: AbortSignal }): Promise<
    StorageResult<{
      body: ReadableStream<Uint8Array>;
      contentLength: number;
      contentType: string;
      close(): Promise<void>;
    }>
  >;
}
```

`createCandidateCvKey(ownerId, extension)` tworzy na serwerze klucz `<UUID właściciela>/cv-<losowy UUIDv4>.<pdf|doc|docx>` przez `randomUUID()`. Właściciel musi pochodzić z potwierdzonej sesji. Adapter akceptuje wyłącznie kanoniczne małe litery, wersję i wariant UUID; odrzuca dodatkowe segmenty, URL i znaki sterujące. Sprawdzenie formatu nie dowodzi własności ani pochodzenia klucza — trasa nie może przyjmować go od klienta.

`put` wymaga 1–5 242 880 rzeczywistych bajtów i MIME zgodnego z rozszerzeniem. Kopiuje przekazany bufor przed rozpoczęciem asynchronicznej operacji i wylicza SHA-256 tej kopii, niezależnie od ETag. Pełna walidacja treści PDF/DOC/DOCX pozostaje w usłudze domenowej. Zapis wysyła `If-None-Match: *`, bez ACL i bez automatycznego ponawiania. Błędy 409/412 zwracają `CONFLICT`; nie następuje ponowna próba bez warunku. Zwykły retry po niepewnym wyniku może więc zwrócić konflikt, nawet jeśli poprzednia próba zapisała identyczne bajty. Wywołujący musi najpierw uzgodnić stan obiektu i metadanych, zachowując ten sam klucz; nie traktować konfliktu jako sukcesu. Zachowanie warunku i kodów potwierdza [kontrakt AWS PutObject](https://docs.aws.amazon.com/AmazonS3/latest/API/API_PutObject.html); honorowanie warunku przez Railway nadal wymaga rzeczywistego testu przed wdrożeniem.

`delete`: brak obiektu to sukces idempotentny. `NoSuchBucket`, odmowa dostawcy i timeout nie są sukcesem. `openStream`: odmowa/404 przed nagłówkami zwraca typowany błąd. Adapter odrzuca brakującą, niecałkowitą, zerową lub większą niż 5 MiB długość oraz MIME niezgodny z kluczem. Następnie liczy rzeczywiste bajty; nadmiar lub ucięte body przerywa strumień. `close()`, anulowanie czytelnika i `AbortSignal` zwalniają odczyt. Domyślny timeout 30 s obejmuje też body. Błąd po rozpoczęciu strumienia ma tylko bezpieczny kod — nie próbujemy dopisywać JSON do CV. Wywołujący musi osobno porównać długość i MIME z autoryzowanymi metadanymi przed wysłaniem odpowiedzi. Nazwa pobieranego pliku pochodzi z tego rekordu DB, nigdy z klucza.

Brak ustawień jest `NOT_CONFIGURED`, nie no-op. `403` S3 oznacza błąd uprawnień infrastruktury, nie automatycznie „nie jesteś właścicielem”; właściciela sprawdza wcześniej aplikacja. SDK ma `maxAttempts: 1`; wyłącznie `UNAVAILABLE` i `TIMEOUT` sygnalizują możliwość kontrolowanego ponowienia przez wywołującego. Timeout PUT daje niepewność, czy obiekt istnieje: nie ogłaszać sukcesu, uzgodnić stan albo pozostawić do GC. Adapter sam niczego nie loguje. Ewentualny log wywołującego zawiera tylko nazwę operacji i kod klasyfikacji, bez surowego wyjątku SDK, URL, klucza, nagłówków, nazwy i danych użytkownika. Na granicy UI zmapować do istniejących tłumaczonych ErrorCode.

## Autoryzacja i stany — kontrakt do wdrożenia po #24/#25

| Podmiot/stan                                   | Upload własnego CV        | Pobranie                                                            | Usunięcie własnego CV                            |
| ---------------------------------------------- | ------------------------- | ------------------------------------------------------------------- | ------------------------------------------------ |
| Anonim                                         | Nie                       | Nie                                                                 | Nie                                              |
| Aktywny kandydat, własny aktywny rekord        | Tak po limitach           | Tylko `clean` lub świadomie dopuszczony `skipped`                   | Tak                                              |
| Kandydat, cudzy rekord                         | Nie                       | Nie                                                                 | Nie                                              |
| Pracodawca/rekruter/company member             | Nie w akcji CV            | Nie; brak zatwierdzonej polityki grantów do CV                      | Nie                                              |
| Admin/moderator                                | Nie przez zwykłą akcję CV | Bez automatycznego obejścia; osobny audytowany proces poza zakresem | Bez automatycznego obejścia                      |
| `service_role` / zadanie GC                    | Nie jako użytkownik       | Nie wystawia publicznych pobrań                                     | Tylko kontrolowane zadanie usuwania sierot/retry |
| Nieaktywne/usunięte konto albo usunięty rekord | Nie                       | Nie                                                                 | Według osobnego procesu usunięcia konta          |

`pending` i `infected` zawsze blokują pobranie; nieznany stan również. Właściciel może usunąć także plik w kwarantannie. `skipped` jest obecnym trybem bez AV, a nie synonimem clean; nie wolno automatycznie przepisywać go na clean. Dane `visibility=public` nie omijają reguł CV. Obecne role PostgreSQL anon/authenticated/service_role to role techniczne, nie role biznesowe z `profiles.role`.

Do SQL metadanych trafia tożsamość potwierdzonej sesji przez `withUserTransaction`, nigdy UUID z body jako dowód własności. Lista/GET kontroluje `owner_id`, `entity_type`, `deleted_at`, scan_status i stan konta. DELETE musi zwrócić faktycznie usunięty rekord przez `RETURNING`; dopiero potem wolno wykonać storage.delete. Krótki token z `private-download-token.ts` wiąże użytkownika, plik i expiry, lecz nie zastępuje tych zapytań. Wygenerowany podpis nie staje się sesją.

## Repozytorium metadanych i migracja 0060

`src/lib/db/candidate-files.ts` udostępnia `listOwnCandidateFiles(pool, trustedUserId)`, `getOwnDownloadableCv(pool, trustedUserId, fileId)`, `createOwnCandidateCv(pool, trustedUserId, input)` i `deleteOwnCandidateCv(pool, trustedUserId, fileId)`. Tożsamość musi pochodzić z potwierdzonej sesji; moduł nie weryfikuje cookie. Każda operacja używa `withUserTransaction`, wymaga aktywnego, nieusuniętego profilu `candidate` i krótkiej blokady profilu `FOR SHARE`. Jawne filtry własności, rodzaju `candidate_cv`, bucketa `candidate-files` i `deleted_at IS NULL` działają również przy błędnym `visibility=public`. Odczyt pobrania wymaga `clean` lub `skipped`; lista zwraca tylko `id,fileName,downloadable`. Nie jest pustą listą przy awarii lub odmowie konta.

Zapis nadaje UUID w bazie oraz stałe `owner_id` z sesji, `visibility=private` i `entity_type=candidate_cv`. Wymaga klucza UUIDv4 z prefiksem właściciela, poprawnej nazwy bez znaków sterujących, MIME, 1–5 MiB, jawnego `scanStatus` (`pending` lub `skipped`) i `checksumSha256` otrzymanego po walidacji bajtów przez usługę uploadu/adapter. Nie potwierdza prawdziwości hasha bez samych bajtów i nie pozwala deklarować `clean` bez skanera. DELETE jest jednym `DELETE ... RETURNING`; wynik wraca dopiero po COMMIT, a S3 usuwa później wywołujący. Rekord cudzy, usunięty lub niedostępny daje `null`; odmowa konta daje `AppError(PERMISSION_DENIED)`, wadliwe wejście `VALIDATION_FAILED`, awaria bazy bez szczegółów `INTERNAL`.

`database/auth/0060_file_checksum.sql` dodaje nullable `files.checksum_sha256` oraz CHECK: NULL albo dokładnie 64 małe znaki szesnastkowe. Istniejące CV/faktury zachowują NULL; repo nie wymyśla ich hashy, ale nowe CV muszą mieć checksumę. Rollback kodu pozostawia kolumnę nullable i CHECK — starszy kod nadal działa, a usunięcie kolumny niepotrzebnie zniszczyłoby zapisany dowód integralności.

## Najmniejsza przebudowa odczytów

1. Podłączyć gotowe repozytorium metadanych opisane wyżej. Lista nie wywołuje S3 dla każdego rekordu: zwraca `id,fileName,downloadable`, a błąd listy jest osobny od pustej listy. Nie wykonywać równoległych zapytań poza połączeniem transakcyjnym.
2. W `CvUpload` zastąpić href wystawiany przy renderze akcją „Pobierz”: ID → autoryzowane wystawienie tokenu → podpisany Route Handler. Rozwiązanie musi działać po długim otwarciu panelu oraz przy blokadzie popupów. Pozostałe upload/delete i router.refresh można zachować, podmieniając ich implementacje dopiero po gotowości sesji/repozytorium.
3. Route Handler w Node runtime ponownie sprawdza sesję/token/DB i korzysta z `openStream`; bez publicznego redirectu S3 w rekomendowanym trybie. Transakcja DB kończy się przed strumieniowaniem. Odpowiedź attachment/no-store/nosniff, sanitizacja nazwy i brak sekretów w logach.
4. Nie przepisywać globalnie `getSignedFileUrl` na sam presigner z kluczem administracyjnym — usunęłoby to dzisiejszą kontrolę Storage RLS. Billing nadal potrzebuje odrębnego repozytorium/polityki: uprawniona rola firmy, aktywne członkostwo, faktura tej firmy i jej konkretny pdf_file_id. Nie wystarczy, że caller zna bucket/path.
5. Do migracji faktur pozostawić dotychczasowy helper wyłącznie dla billing, a CV skierować przez nowy adapter. Pełne usunięcie Supabase Storage wymaga osobnego domknięcia billing; przy pustym portalu można jawnie pozostawić brak generowania PDF, ale nie tworzyć URL omijającego reguły ani oznaczać tego przepływu jako działającego.

## Weryfikacja i granice dowodu

64 testy `tests/unit/railway-bucket.test.ts` przechodzą przez rzeczywisty SDK z transportem bez sieci: generowanie i walidacja kluczy, konfiguracja, podpis i adresowanie PUT, niezmienność bufora, granice 0/5 MiB/5 MiB+1, MIME, warunek braku nadpisania, błędy XML dostawcy, brak ukrytych retry, idempotencja DELETE, konwersja body Node→Web, nadmiar/ucięcie bajtów, zamknięcie/anulowanie/timeout i sprzątanie zasobów. Nie ma mocka metod `S3Client.send` ani pozorowanych wyników sesji.

Wykonano dwie kontrole ujemne: dopuszczenie dodatkowego bajtu ponad limit i usunięcie `IfNoneMatch` osobno powodowały porażkę odpowiedniego testu. Przywrócono dokładne bajty oraz czas modyfikacji adaptera i ponownie uzyskano 64/64. Lint adaptera i testów przechodzi bez ostrzeżeń.

62 testy `tests/integration/candidate-files.test.ts` przeszły na osobnym PostgreSQL 16 z produkcyjnym loaderem migracji, ograniczonym loginem aplikacji i rzeczywistym RLS. Obejmują migrację istniejącej faktury, CHECK checksumy, własność mimo publicznej widoczności, role/aktywność konta, kwarantannę, walidację zapisu, dwa DELETE tego samego rekordu, błędy INSERT i odroczoną awarię COMMIT usunięcia. Usunięcie kontroli własności oraz filtra `scan_status` osobno oblało testy; po odtworzeniu kodu testy ponownie przeszły. Kontenery testowe usunięto i sprawdzono ich zniknięcie.

Nie podłączono jeszcze tras CV, akcji ani UI. Testy pełnej sesji/cookie i endpointów pozostają do wykonania przy integracji #24/#25. Nie sprawdzono rzeczywistej prywatności bucketa, zgodności Railway z warunkowym PUT i checksumami SDK, jego Credentials i adresowania, przerwanego transferu sieciowego, restartu, dwóch replik ani backup/restore. Nie ma jeszcze GC/retry sprzątania, nowej walidacji OOXML ani AV. Adapter nie wystawia żadnych URL. Odbiór Railway wymaga osobno zatwierdzonego prywatnego bucketa; test SDK z zastąpionym transportem nie dowodzi działania dostawcy. Issue #26 pozostaje otwarte.
