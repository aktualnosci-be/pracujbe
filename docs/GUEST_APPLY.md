# Aplikacja bez konta (#98)

Gość może raz zaaplikować na ofertę bez zakładania konta. Aplikacja trafia do pracodawcy
dopiero po potwierdzeniu adresu e-mail. Później gość może przypisać ją do konta kandydata
założonego na ten sam adres.

Migracja: `supabase/migrations/0095_guest_applications.sql`. Dowód: `supabase/tests/rls.sql`,
sekcja GA98 (z kontrolami ujemnymi).

## Przepływ

1. **Formularz** (`GuestApplyForm` w `ApplyModal`, tylko dla gościa): imię i nazwisko,
   e-mail i zgoda (ten sam tekst co przy zwykłej aplikacji). Telefon, dostępność i wiadomość
   są opcjonalne. Pytania screeningowe oferty (#101) są te same co w zwykłej aplikacji
   (`ScreeningQuestionsFields`); odpowiedź na pytanie wymagane jest obowiązkowa także dla
   gościa. Action `submitGuestApplication` sprawdza kolejno: limit per IP (`guest-apply`,
   10/h, przy błędzie limitera blokuje), Turnstile (`guest_apply`, przy awarii dostawcy
   blokuje), walidację Zod i limit per adres (`guest-apply-email`, 5/h; klucz to hash adresu).
2. **Zgłoszenie**: RPC `submit_guest_application` (tylko service_role) zapisuje wiersz
   `guest_application_requests` w stanie `pending` ze snapshotem zgody: aktualną wersję
   polityki prywatności z `consent_versions` (jeśli jest opublikowana), język, IP, UA i czas.
   Odpowiedzi na pytania sprawdza `record_screening_answers` w trybie bez aplikacji — te same
   reguły co `apply_to_job` (`SCREENING_ANSWER_REQUIRED: <id>` → błąd przy pytaniu).
   Kolejkuje też e-mail `guestApplicationConfirm`. Firma nic jeszcze nie widzi.
   Odpowiedź jest zawsze neutralna („sprawdź skrzynkę”), więc nie zdradza, czy adres już
   aplikował albo ma konto.
3. **Potwierdzenie**: link prowadzi do `/{locale}/aplikacja/potwierdz#token=…` (format linków
   niżej). Samo otwarcie
   strony (GET) niczego nie zmienia. Adres potwierdza dopiero kliknięcie przycisku (POST), bo
   skanery linków w poczcie otwierają linki za użytkownika. RPC `confirm_guest_application`:
   - tworzy `applications` z `candidate_id = NULL` oraz `guest_name`, `guest_email`,
     `phone`, `availability`, `message` i `guest_request_id`;
   - powiadamia aktywnych recruiter+ firmy (in-app i `newApplication` w języku odbiorcy,
     tak samo jak `apply_to_job`);
   - kolejkuje do gościa `guestApplicationSent` z linkiem przejęcia (ważnym 30 dni);
   - zapisuje odpowiedzi screeningowe do `application_screening_answers` (snapshot jak przy
     zwykłej aplikacji);
   - kasuje telefon, wiadomość i odpowiedzi w zgłoszeniu, bo od teraz są tylko w aplikacji.
   Wyniki: `confirmed`, `already_confirmed` (ponowne kliknięcie niczego nie zmienia),
   `duplicate` (adres już aplikował na tę ofertę jako gość albo z konta), `expired` (48 h),
   `job_closed`, `invalid`.
4. **Przejęcie**: `/{locale}/aplikacja/przejmij#token=…`. Bez sesji strona pokazuje
   logowanie i rejestrację z powrotem na czysty adres strony (token czeka w cookie HttpOnly,
   nie trafia do `?next=`). RPC
   `claim_guest_application` (authenticated) wymaga konta kandydata, **zweryfikowanego** e-maila
   sesji (`current_verified_email`, 0086) równego adresowi zgłoszenia i ważnego tokenu:
   - token przejmuje dokładnie jedno konto; ponowienie przez to samo konto zwraca tę samą
     aplikację, każde inne dostaje `NOT_FOUND`;
   - obca sesja (inny adres) dostaje `NOT_FOUND`, taką samą odpowiedź jak przy braku tokenu;
   - gdy kandydat ma już aplikację z konta na tę ofertę → `APPLICATION_ALREADY_EXISTS`;
   - ustawia `candidate_id` i `claimed_at`. Historia statusów zostaje, profil kandydata
     nie jest publikowany (`is_searchable` bez zmian). Zapis trafia do `audit_logs`
     (`application.guest_claimed`).


## Format linków (#505)

- Token jest we fragmencie (`#token=`), więc przeglądarka nie wysyła go w żądaniu. Strona
  (`GuestLinkIntake`) usuwa fragment z adresu i historii, wysyła token przez POST (Server
  Action `stageGuestLink`) do cookie HttpOnly przypisanego do ścieżki (`pb_guest_confirm`
  48 h, `pb_guest_claim` 30 dni) i przeładowuje czysty adres.
- Trasy mają `Cache-Control: private, no-store`, `Referrer-Policy: no-referrer`, `noindex`
  (middleware + metadata) i nie ładują GA/Meta nawet po zgodzie (`route-policy.ts`).
- Stary format `?token=` (linki wysłane przed #506) jest **odrzucany**: middleware przekierowuje
  303 na czysty adres bez zapisywania tokenu, a strona pokazuje „link nieprawidłowy” z prośbą
  o ponowne wysłanie aplikacji. Wybraliśmy odrzucenie zamiast wymiany, bo token z query jest już
  w logach pierwszego żądania i nie powinien dawać uprawnień. Test: `guest-legacy-link.test.ts`
  (z kontrolą ujemną), E2E `guest-apply.spec`.
## Pracodawca

Aplikacja gościa jest na liście, na pulpicie i w szczególe jak zwykła, z oznaczeniem
„Bez konta” (`dashboard.employerApplicationGuestBadge`). Szczegół pokazuje e-mail (`mailto:`)
i telefon. Zmiana statusu działa, a historia się zapisuje. Gość nie ma profilu, więc nie
dostaje powiadomienia in-app, ale od `0122` dostaje e-mail `guestStatusChanged` (niżej,
„E-mail o zmianie statusu”). Rozmowy w
serwisie wymagają konta: przycisk „Napisz wiadomość” jest ukryty, a trigger
`trg_conversations_guest_guard` odrzuca rozmowę z aplikacji gościa (`GUEST_APPLICATION`).
Propozycje (`send_offer`) wymagają `candidate_id`, więc dla gościa są dostępne dopiero po
przejęciu aplikacji.

## E-mail o zmianie statusu (0122)

`transition_application` dla aplikacji gościa woła `enqueue_guest_status_email`, który
kolejkuje `guestStatusChanged` tylko, gdy:

- aplikacja istnieje, nie jest usunięta, nadal nie ma konta (`candidate_id is null`);
- zgłoszenie gościa istnieje, ma stan `confirmed` i wskazuje tę aplikację (gdy ślad
  zgłoszenia usunie retencja, e-maila nie ma);
- adres nie ma aktywnej blokady (#44, `email_address_suppressed`); `claim_email_batch`
  sprawdza blokadę ponownie przed wysyłką.

Klucz idempotencji to `appstatus-<aplikacja>-<id wiersza historii>` (jak u kandydata):
ponowienie tej samej zmiany nie tworzy drugiego e-maila, powrót do statusu tworzy nowy
wiersz historii i nowy e-mail. Wiersz kolejki ma `entity_type = 'application'`, więc
retencja zamkniętych aplikacji (#486) usuwa go razem z aplikacją. Payload: imię i nazwisko
gościa, nazwa firmy, tytuł oferty i status (etykieta w języku odbiorcy). Innych danych firmy
nie ma. CTA prowadzi do listy ofert. E-mail nie ma tokenu, więc linki potwierdzenia i
przejęcia się nie zmieniają. Nie ma też linku wypisania (brak konta, z którym wiąże się
token wypisania, #45). Po przejęciu aplikacji przez konto działa zwykła ścieżka kandydata
(`statusChanged`/`applicationViewed` w języku z profilu). Dowód: `supabase/tests/rls.sql`,
sekcja GS98 (z kontrolami ujemnymi), `tests/unit/guest-status-email.test.ts`.

## Tokeny

W bazie jest tylko `sha256(token)` (hex) i losowy `nonce`. Token to
`HMAC-SHA256(GUEST_APPLY_SECRET, "<cel>:<nonce>")` w base64url (43 znaki), gdzie cel to
`confirm` albo `claim`. Liczą go Server Action (przy zapisie) i worker e-mail
(`src/lib/email/guest-delivery.ts`, przy budowaniu linku). Payload `email_deliveries`
zawiera wyłącznie `nonce`, więc odczyt bazy nie wystarczy do odtworzenia linku. Strony
linków mają `noindex` i `referrer: no-referrer`.

`GUEST_APPLY_SECRET` (co najmniej 32 znaki) musi być ustawiony w produkcji. Bez niego
formularz zwraca `GUEST_APPLY_UNAVAILABLE`, a worker nie wysyła maili z martwym linkiem
(błąd → ponowienie). Poza produkcją działa sekret deweloperski. Zmiana sekretu unieważnia
linki, które już wysłano.

## Język e-maili (Invariant #1)

Gość nie ma profilu (`preferred/account/signup_locale`), więc jego język to język formularza
(`guest_application_requests.locale`), ustawiany przez `enqueue_guest_email` i
`enqueue_guest_status_email` (0122). E-maile do
firmy idą przez `enqueue_email`, czyli w języku odbiorcy.

## Idempotencja

- `idempotency_key` zgłoszenia (UUID z formularza, trzymany w `useRef`): ponowienie
  zwraca to samo zgłoszenie bez drugiego e-maila.
- Na parę (oferta, e-mail) przypada jedno oczekujące zgłoszenie (indeks częściowy). Nowe
  wysłanie zastępuje dane i token poprzedniego i wysyła nowy link.
- Na parę (oferta, e-mail) przypada jedna aplikacja gościa (`uq_applications_guest_email_job`,
  także po przejęciu).
- Potwierdzenie i przejęcie są idempotentne (patrz wyżej).

## Retencja

`purge_guest_application_requests()` (service_role) jest wywoływane co godzinę przez
`/api/maintenance` (cron Railway, `docs/railway/README.md`). Odpowiedź zawiera tylko licznik
`purgedGuestRequests`:

- zgłoszenia `pending` są usuwane **7 dni po wydaniu ostatniego linku**, a `duplicate`
  7 dni po potwierdzeniu. Razem z nimi znikają ich wiersze `email_deliveries`. Link
  potwierdzenia jest ważny 48 h, a pozostałe dni pozwalają pokazać „link wygasł” zamiast
  „nieprawidłowy”. Ponowne wysłanie formularza odsuwa termin;
- zgłoszenia `confirmed` zostają jako snapshot zgody powiązany z aplikacją. Po wygaśnięciu
  okna przejęcia (30 dni) token przejęcia jest zerowany;
- aplikacja gościa podlega tym samym zasadom co zwykła aplikacja.

Okresy 7 i 30 dni to decyzja techniczna. Wiążący okres przechowywania określa polityka
prywatności (#40), która nie jest jeszcze gotowa.

## Rollback

Najpierw wyłącz kod (formularz gościa i strony linków), potem w nowej migracji:

```sql
delete from public.applications where candidate_id is null;
drop trigger if exists trg_conversations_guest_guard on public.conversations;
drop function if exists public.guard_conversation_guest_application();
drop function if exists public.submit_guest_application(uuid, text, text, text, text, text, text, text, text, text, text, text, jsonb);
drop function if exists public.confirm_guest_application(text, text, text);
drop function if exists public.claim_guest_application(text);
drop function if exists public.purge_guest_application_requests();
drop function if exists public.enqueue_guest_email(public.citext, text, text, uuid, text, jsonb);
drop index if exists public.uq_applications_guest_email_job;
alter table public.applications
  drop constraint if exists applications_candidate_or_guest_chk,
  drop column if exists guest_name,
  drop column if exists guest_email,
  drop column if exists guest_request_id,
  drop column if exists claimed_at,
  alter column candidate_id set not null;
drop table if exists public.guest_application_requests;
```

Najpierw cofnij `0122`: odtwórz `transition_application` z `0095` i usuń
`enqueue_guest_status_email(uuid, text, text, jsonb)`.

Na koniec odtwórz `enforce_application_integrity` z `0020`, `transition_application` z
`0073` i `record_screening_answers` z `0093`. Zwykłe aplikacje zostają. Przejęte aplikacje gościa (z `candidate_id`) też zostają,
bez snapshotu gościa.
