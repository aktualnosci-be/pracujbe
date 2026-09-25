# Mapa danych osobowych (generowana z repozytorium)

> **PROJEKT — do weryfikacji prawnika, nieopublikowany.**
> Plik generowany — nie edytuj ręcznie. Źródła: migracje produkcyjne, `src/lib/privacy/data-map.ts`,
> `src/lib/privacy/processors.ts`, `src/emails/wiring.ts`. Odśwież: `node scripts/privacy/data-map.mjs`.
> Mapa opisuje fakty z kodu. Role administratorów, podstawy prawne, regiony, transfery i umowy
> ustala właściciel z prawnikiem — pola „DO UZUPEŁNIENIA”. Nic z tego pliku nie trafia do UI.

Tabele w migracjach: 100; z danymi osobowymi: 64; bez danych osobowych: 36.

## 1. Czynności przetwarzania → tabele i usługi

| Czynność | Co robi kod | Tabele | Usługi zewnętrzne | Retencja/usuwanie w kodzie |
|---|---|---|---|---|
| Konto i uwierzytelnianie (`account`) | Rejestracja, logowanie, sesje Better Auth, profil konta i język komunikacji; e-maile konta. | `auth.accounts`, `auth.email_outbox`, `auth.sessions`, `auth.users`, `auth.verifications`, `public.age_policy`, `public.candidate_age_attestations`, `public.document_acceptances`, `public.profiles`, `public.retention_warnings` | Railway, Resend, EmailLabs, Cloudflare Turnstile | Sesje i weryfikacje mają expires_at; kandydat może usunąć konto (request_account_erasure). Wartości #574 (0127, harmonogram za RETENTION_MODE, domyślnie wyłączony): profil z deleted_at usuwany w 7 dni (deleted_profile), konto kandydata bez aktywności (last_seen_at z sesji) 730 dni z ostrzeżeniem 30 dni. |
| Profil zawodowy kandydata (`candidate-profile`) | Onboarding (6 kroków), umiejętności/języki/certyfikaty, widoczność profilu dla firm (is_searchable), zapisane oferty. | `public.candidate_age_attestations`, `public.candidate_certificates`, `public.candidate_languages`, `public.candidate_profiles`, `public.candidate_skills`, `public.candidate_visibility_events`, `public.saved_jobs` | Railway | Kod nie usuwa danych — do ustalenia |
| Pliki CV (`cv-files`) | Upload PDF/DOC/DOCX do prywatnego bucketa, dostęp przez krótkie podpisane URL-e, usuwanie przez właściciela. | `public.files`, `public.retention_warnings`, `public.storage_deletion_queue`, `public.storage_gc_sweeps` | Railway | Usunięcie na żądanie właściciela pliku (src/lib/actions/files.ts) i z kontem; obiekt przez storage_deletion_queue (≤ 72 h, dead-letter po 20 próbach). Wartości #574 (0127, harmonogram za RETENTION_MODE, domyślnie wyłączony): wiersz z deleted_at i obiekt usunięte w 7 dni (deleted_file), CV bez aktywności 365 dni z ostrzeżeniem 30 dni. |
| Aplikacje na oferty (`applications`) | Aplikowanie (idempotentne), zmiany statusu przez firmę, historia statusów, odpowiedzi na pytania screeningowe. | `public.application_screening_answers`, `public.application_status_history`, `public.applications` | Railway, Resend, EmailLabs | Wartości #574 (0127, harmonogram za RETENTION_MODE, domyślnie wyłączony): aplikacja w stanie końcowym (także hired) usuwana 180 dni od niezmiennego closed_at razem z rozmowami, powiadomieniami i e-mailami. |
| Aplikacja bez konta (`guest-applications`) | Formularz gościa, potwierdzenie e-mailem, aplikacja ze snapshotem zgody, e-mail o zmianie statusu (język formularza), przejęcie przez konto. | `public.application_screening_answers`, `public.applications`, `public.guest_application_requests` | Railway, Resend, EmailLabs, Cloudflare Turnstile | purge_guest_application_requests (/api/maintenance): niepotwierdzone 7 dni po ostatnim linku, duplikaty 7 dni po potwierdzeniu, token przejęcia zerowany po 30 dniach. Wartości #574 (0127, za RETENTION_MODE): niepotwierdzone 7 dni od pierwszego wysłania, potwierdzone 30 dni od potwierdzenia, IP/UA zgody 7 dni. |
| Dopasowanie i zapisane wyszukiwania (`matching-search`) | Deterministyczny scoring (src/lib/matching), materializacja matches, zapisane wyszukiwania i alerty e-mail. | `public.candidate_certificates`, `public.candidate_languages`, `public.candidate_profiles`, `public.candidate_skills`, `public.matches`, `public.saved_search_alerts`, `public.saved_searches` | Railway, Resend, EmailLabs | Kod nie usuwa danych — do ustalenia |
| Kontakt pracodawca–kandydat (`employer-contact`) | Propozycje pracy, rozmowy i wiadomości z załącznikami (PDF/DOC/DOCX/JPG/PNG w prywatnym buckecie), blokowanie firm przez kandydata. | `public.candidate_company_blocks`, `public.conversation_members`, `public.conversations`, `public.files`, `public.message_attachments`, `public.messages`, `public.offer_status_history`, `public.offers` | Railway, Resend, EmailLabs | Propozycje wygasają (expires_at), dane nie są usuwane. Niewysłane załączniki wiadomości usuwane po 24 h (purge_stale_message_attachments); załączniki znikają z wiadomością/rozmową (także z kontem), obiekt przez storage_deletion_queue. |
| Konta firm, zespół i weryfikacja (`companies`) | Zakładanie firmy, członkowie i zaproszenia, weryfikacja przez administratora, sprawdzenie VAT w VIES, oferty pracy. | `public.companies`, `public.company_invitations`, `public.company_members`, `public.company_vies_checks`, `public.employer_profiles`, `public.jobs`, `public.screening_question_reviews` | Railway, Resend, EmailLabs, VIES (Komisja Europejska) | Zaproszenia wygasają po 14 dniach (status), nie są usuwane. |
| E-maile i powiadomienia (`email-notifications`) | Kolejka email_deliveries, worker wysyłki, powiadomienia in-app, preferencje z dowodem zmiany zgody, wypisanie, budżet na odbiorcę, kampanie, blokady adresów po odbiciach/skargach. | `auth.email_outbox`, `public.breach_notice_recipients`, `public.breach_notices`, `public.email_campaign_recipients`, `public.email_consent_events`, `public.email_deliveries`, `public.email_recipient_windows`, `public.email_suppressions`, `public.notification_preferences`, `public.notifications`, `public.saved_search_alerts` | Railway, Resend, EmailLabs | email_send_windows czyszczone po 1 dniu; email_recipient_windows odbiorcy starsze niż 31 dni usuwane przy kolejkowaniu; kod nie usuwa email_deliveries ani email_consent_events (retencja odłożona — CLAUDE.md). |
| Zgody cookies i akceptacja dokumentów (`consents`) | Receipt zgody cookies (record_consent) i akceptacji regulaminu przy rejestracji — z IP i User-Agent. | `public.consents`, `public.document_acceptances`, `public.email_consent_events` | Railway | Kod nie usuwa danych — do ustalenia |
| Zgłoszenia treści (DSA) i moderacja (`dsa-moderation`) | Publiczny formularz zgłoszenia, sprawy z numerem i kodem dostępu, decyzje moderacyjne z uzasadnieniem, e-maile do stron; zgłoszenia wiadomości i rozmów przez ich strony (dowód z treścią tylko zgłoszonej wiadomości, wgląd tylko administratora). | `public.moderation_appeals`, `public.moderation_decisions`, `public.moderation_restorations`, `public.report_events`, `public.reports` | Railway, Resend, EmailLabs, Cloudflare Turnstile | Kod nie usuwa danych — do ustalenia |
| Formularz kontaktu (`support-contact`) | Publiczny formularz /kontakt (także bez konta): temat, treść, imię (opcjonalnie), e-mail, język formularza; potwierdzenie do nadawcy i powiadomienie adminów (w kolejce tylko numer i temat); obsługa w /admin/kontakt. | `public.contact_messages` | Railway, Resend, Cloudflare Turnstile | Kod nie usuwa danych — do ustalenia |
| Bezpieczeństwo, audyt i limity (`security-audit`) | Dziennik audytu (triggery), limiter zapytań, zdarzenia systemowe, inbox webhooków, raportowanie błędów. | `auth.sessions`, `public.age_policy`, `public.audit_logs`, `public.breach_incident_events`, `public.breach_incidents`, `public.breach_notice_recipients`, `public.breach_notices`, `public.rate_limits`, `public.system_events` | Railway, Discord (webhook kanału błędów), Cloudflare Turnstile | Funkcja processed_webhooks_gc (30 dni) istnieje, ale kod jej nie wywołuje; audit_logs i rate_limits bez usuwania w kodzie. |
| Import ogłoszenia przez AI (`ai-job-import`) | Pracodawca przesyła zrzut ekranu lub link; tekst jest minimalizowany przed wysyłką (zrzut — nie), wynik trafia do szkicu oferty (bez publikacji). Za flagą, domyślnie wyłączone. | — | Railway, Anthropic (Claude API) | Portal nie zapisuje przesłanego obrazu ani pobranej strony — tylko wynik w szkicu oferty. |
| Statystyki ofert (lejek) (`job-statistics`) | Zliczanie wyświetleń/wystąpień w wynikach per oferta i dzień, bez IP, cookies i identyfikatora osoby. | — | Railway | job_funnel_receipts (nonce deduplikacji) sprzątane po 2 dniach. |
| Analityka i marketing po zgodzie (`analytics-marketing`) | Skrypty GA i Meta Pixel ładowane dopiero po zgodzie w odpowiedniej kategorii; wycofanie usuwa cookies. | — | Google Analytics (gtag), Meta Pixel | Cookie zgody ważne 180 dni. |
| Prawa osób i retencja (`data-rights`) | Eksport danych kandydata (JSON), samoobsługowe usunięcie konta kandydata, okresy retencji jako dane, kolejka usuwania obiektów storage, rejestr usunięć do ponownego zastosowania po odtworzeniu kopii. | `public.data_rights_requests`, `public.erasure_tombstones`, `public.retention_policies`, `public.retention_warnings`, `public.storage_deletion_queue` | Railway | run_retention_purge (/api/maintenance): okresy z retention_policies (wartości #574, 0127); harmonogram WYŁĄCZONY do jawnego RETENTION_MODE=dry-run\|apply. Ślad wniosków 1095 dni; rejestr usunięć bez usuwania (minimum 400 dni do zmiany po RET-09/RET-10). |
| Kopie zapasowe bazy (`backups`) | scripts/db/backup.sh: zaszyfrowany (age) zrzut logiczny całej bazy; kopia i manifest wysyłane do prywatnego bucketu Cloudflare R2 (BACKUP_S3_*, #569). | `public.erasure_tombstones` | Railway, Cloudflare R2 (bucket kopii bazy) | BACKUP_RETENTION najnowszych kopii (domyślnie 14) lokalnie i w buckecie R2; opcjonalnie BACKUP_S3_MAX_AGE_DAYS (najnowsza kopia zostaje zawsze). |
| Płatności (wyłączone) (`billing-disabled`) | Martwy schemat po wyłączonym billingu (#51); brak aktywnego przepływu. | — | Stripe | Kod nie usuwa danych — do ustalenia |

## 2. Usługi zewnętrzne (subprocesorzy — kandydaci do weryfikacji)

### Railway (`railway`)

- **Cel w portalu:** Hosting aplikacji (usługa production z gałęzi main), baza PostgreSQL, zadania cron wywołujące /api/maintenance i /api/email/process, logi usługi.
- **Kategorie danych:** Wszystkie kategorie z tabel bazy (patrz mapa tabel); Logi aplikacji i żądań HTTP
- **Osoby:** Kandydaci, Aplikujący bez konta, Pracodawcy i członkowie firm, Zgłaszający treści, Administratorzy, Odwiedzający
- **Aktywacja:** Produkcja wdrażana na Railway (docs/railway/README.md); połączenia DB przez DATABASE_APP_URL / DATABASE_SERVICE_URL / DATABASE_AUTH_URL / DATABASE_OPS_URL.
- **Kod:** `docs/railway/README.md`, `docs/railway/OPERATIONS.md`, `src/lib/db/pool.ts`, `src/lib/db/portal.ts`, `scripts/railway-cron-call.mjs`
- **Uwaga:** Pliki CV w prywatnym buckecie S3 Railway (src/lib/storage/railway-bucket.ts, #26); pobranie tylko krótkim linkiem HMAC przez /api/files/cv.
- **Uwaga:** Limiter (src/lib/rate-limit.ts): przy loginie DATABASE_RATE_LIMIT_URL klucz HMAC akcji i adresu IP; przejściowa ścieżka przez pulę service zapisuje klucz z adresem IP bez haszowania.
- **Uwaga:** Kopie zapasowe: scripts/db/backup.sh szyfruje zrzut kluczem age w usłudze cron Railway (docker/backup/Dockerfile); przechowywane są poza Railwayem w buckecie Cloudflare R2 (#569).
- **Rola (procesor/administrator):** DO UZUPEŁNIENIA
- **Region przetwarzania:** DO UZUPEŁNIENIA
- **Podstawa transferu poza EOG:** DO UZUPEŁNIENIA
- **Umowa (DPA):** DO UZUPEŁNIENIA
- **Retencja u dostawcy:** DO UZUPEŁNIENIA

### Resend (`resend`)

- **Cel w portalu:** Wysyłka e-maili transakcyjnych z kolejki email_deliveries i e-maili konta; odbiór zdarzeń doręczenia (odbicia, skargi) przez webhook.
- **Kategorie danych:** Adres e-mail odbiorcy; Temat i treść HTML wyrenderowanego szablonu (pola payloadu — patrz sekcja e-maili w mapie); Nagłówki List-Unsubscribe z tokenem wypisania; Identyfikator wysyłki (idempotency key = id wiersza email_deliveries)
- **Osoby:** Kandydaci, Aplikujący bez konta, Pracodawcy i członkowie firm, Zgłaszający treści
- **Aktywacja:** EMAIL_PROVIDER=resend albo brak EMAIL_PROVIDER bez kompletu kluczy EmailLabs, przy RESEND_API_KEY; webhook wymaga RESEND_WEBHOOK_SECRET.
- **Kod:** `src/lib/email/transport/resend.ts`, `src/lib/email/outbox.ts`, `src/lib/auth/email-worker.ts`, `src/app/api/email/webhook/resend/route.ts`, `src/emails/wiring.ts`
- **Uwaga:** Wywołanie resend.emails.send przekazuje from, to, subject, html i opcjonalnie nagłówki wypisania; kod nie ustawia opcji śledzenia otwarć/kliknięć — stan tych ustawień na koncie do sprawdzenia.
- **Uwaga:** Payloady kolejki nie zawierają treści wiadomości czatu ani odpowiedzi screeningowych (sekcja e-maili w mapie jest generowana z migracji).
- **Uwaga:** Do szablonu trafiają tylko pola z listy src/lib/email/payload-fields.ts (#503); odbiorca firmowy jest ponownie sprawdzany przy odbiorze z kolejki (email_recipient_authorized).
- **Rola (procesor/administrator):** DO UZUPEŁNIENIA
- **Region przetwarzania:** DO UZUPEŁNIENIA
- **Podstawa transferu poza EOG:** DO UZUPEŁNIENIA
- **Umowa (DPA):** DO UZUPEŁNIENIA
- **Retencja u dostawcy:** DO UZUPEŁNIENIA

### EmailLabs (`emaillabs`)

- **Cel w portalu:** Wysyłka e-maili transakcyjnych z kolejki email_deliveries i e-maili konta (auth.email_outbox), gdy EMAIL_PROVIDER wybiera EmailLabs; odbiór raportów doręczeń (odbicia, opóźnienia) przez webhook.
- **Kategorie danych:** Adres e-mail odbiorcy; Temat, treść HTML i tekstowa wyrenderowanego szablonu (pola payloadu — patrz sekcja e-maili w mapie); Nagłówki List-Unsubscribe z tokenem wypisania; Identyfikator wiadomości (messageId = id wiersza kolejki + domena nadawcy); Linki z tokenem potwierdzenia adresu / resetu hasła w e-mailach konta
- **Osoby:** Kandydaci, Aplikujący bez konta, Pracodawcy i członkowie firm, Zgłaszający treści
- **Aktywacja:** EMAIL_PROVIDER=emaillabs albo brak EMAIL_PROVIDER przy komplecie EMAILLABS_APP_KEY, EMAILLABS_SECRET_KEY, EMAILLABS_SMTP_ACCOUNT; webhook wymaga EMAILLABS_WEBHOOK_SECRET.
- **Kod:** `src/lib/email/transport/emaillabs.ts`, `src/lib/email/outbox.ts`, `src/lib/auth/email-worker.ts`, `src/app/api/email/webhook/emaillabs/route.ts`
- **Uwaga:** Każde wywołanie wysyłki ma nagłówek X-TRACKING-OFF: 1 (bez przekierowań linków); open tracking jest ustawieniem konta SMTP — do wyłączenia w panelu (docs/EMAILLABS_SETUP.md).
- **Uwaga:** Przed wysyłką kod odpytuje statusy po messageId (deduplikacja ponowień) — klucz API potrzebuje prawa odczytu statusów.
- **Uwaga:** Webhook przekazuje adres odbiorcy i status doręczenia; kod zapisuje tylko status, czas i ewentualną blokadę adresu.
- **Rola (procesor/administrator):** DO UZUPEŁNIENIA
- **Region przetwarzania:** DO UZUPEŁNIENIA
- **Podstawa transferu poza EOG:** DO UZUPEŁNIENIA
- **Umowa (DPA):** DO UZUPEŁNIENIA
- **Retencja u dostawcy:** DO UZUPEŁNIENIA

### Discord (webhook kanału błędów) (`discord-webhook`)

- **Cel w portalu:** Powiadomienie zespołu o błędzie serwera (5xx, captureError) na kanale Discorda (#571).
- **Kategorie danych:** Dane techniczne bez danych osobowych: kod błędu z listy ErrorCodes, szablon trasy bez query/fragmentu, wersja wydania (SHA), środowisko, czas, liczba pominiętych powtórzeń
- **Osoby:** Brak (wiadomość nie zawiera danych osób; trasa i tekst przechodzą redakcję #502)
- **Aktywacja:** ERROR_WEBHOOK_URL (tylko serwer; https discord.com/discordapp.com); pusta zmienna = brak wysyłki.
- **Kod:** `src/lib/error-webhook/`, `src/lib/error-report.ts`, `src/instrumentation.ts`
- **Uwaga:** Wysyłka tylko z runtime serwera (reporter rejestrowany w instrumentation); w przeglądarce captureError to no-op.
- **Uwaga:** Wiadomość budowana od zera z bezpiecznych pól — bez treści wyjątku, cause, kontekstu, nagłówków i parametrów; limit 2000 znaków.
- **Uwaga:** Ten sam kod najwyżej raz na 10 min, przerwa po 429 wg retry_after, timeout 3 s; adres webhooka nie trafia do logów ani komunikatów.
- **Rola (procesor/administrator):** DO UZUPEŁNIENIA
- **Region przetwarzania:** DO UZUPEŁNIENIA
- **Podstawa transferu poza EOG:** DO UZUPEŁNIENIA
- **Umowa (DPA):** DO UZUPEŁNIENIA
- **Retencja u dostawcy:** DO UZUPEŁNIENIA

### Cloudflare R2 (bucket kopii bazy) (`cloudflare-r2`)

- **Cel w portalu:** Przechowywanie zaszyfrowanych kopii bazy poza Railwayem (#569); pliki CV zostają w buckecie Railway.
- **Kategorie danych:** Zaszyfrowany (age, klucz publiczny) zrzut całej bazy — wszystkie kategorie z mapy tabel; dostawca nie ma klucza prywatnego; Manifest kopii bez danych: rozmiary, SHA-256, liczby tabel i migracji, wersja serwera
- **Osoby:** Kandydaci, Aplikujący bez konta, Pracodawcy i członkowie firm, Zgłaszający treści, Administratorzy
- **Aktywacja:** BACKUP_S3_ENDPOINT + BACKUP_S3_BUCKET + klucz zapisu BACKUP_S3_ACCESS_KEY_ID/SECRET w zadaniu kopii; aplikacja tylko klucz odczytu BACKUP_S3_READ_* (czujka wieku kopii).
- **Kod:** `scripts/db/backup.sh`, `scripts/db/restore-backup.sh`, `scripts/db/lib/backup-s3.mjs`, `src/lib/ops/backup-freshness.ts`
- **Uwaga:** Bucket prywatny, bez domeny publicznej i bez r2.dev (ustawienie w panelu Cloudflare — docs/railway/OPERATIONS.md).
- **Uwaga:** Retencja w buckecie: BACKUP_RETENTION najnowszych kopii, opcjonalnie BACKUP_S3_MAX_AGE_DAYS; usuwa tylko obiekty o wzorcu nazwy kopii.
- **Uwaga:** Usługa web czyta wyłącznie listę obiektów (wiek ostatniej kopii w /api/health/ops) — klucz zapisu w usłudze web to alarm backup_misconfigured.
- **Rola (procesor/administrator):** DO UZUPEŁNIENIA
- **Region przetwarzania:** DO UZUPEŁNIENIA
- **Podstawa transferu poza EOG:** DO UZUPEŁNIENIA
- **Umowa (DPA):** DO UZUPEŁNIENIA
- **Retencja u dostawcy:** DO UZUPEŁNIENIA

### Cloudflare Turnstile (`cloudflare-turnstile`)

- **Cel w portalu:** Ochrona formularzy przed botami: logowanie, rejestracja, reset hasła, zgłoszenie treści, aplikowanie bez konta.
- **Kategorie danych:** Przeglądarka → challenges.cloudflare.com: skrypt widżetu dostawcy (zakres sygnałów zbieranych przez skrypt nie wynika z kodu portalu); Serwer → Siteverify: token odpowiedzi, sekret, losowy idempotency_key
- **Osoby:** Odwiedzający korzystający z chronionych formularzy
- **Aktywacja:** NEXT_PUBLIC_TURNSTILE_SITE_KEY + TURNSTILE_SECRET_KEY; bez kluczy poza produkcją wyłączone.
- **Kod:** `src/lib/turnstile/verify.ts`, `src/lib/turnstile/policy.ts`, `src/components/auth/TurnstileWidget.tsx`, `docs/TURNSTILE.md`
- **Uwaga:** Siteverify nie dostaje parametru remoteip ani treści pól formularza.
- **Uwaga:** Tryb widżetu, pre-clearance (cookie cf_clearance) i analityka konta są ustawieniami panelu Cloudflare, nie kodu.
- **Rola (procesor/administrator):** DO UZUPEŁNIENIA
- **Region przetwarzania:** DO UZUPEŁNIENIA
- **Podstawa transferu poza EOG:** DO UZUPEŁNIENIA
- **Umowa (DPA):** DO UZUPEŁNIENIA
- **Retencja u dostawcy:** DO UZUPEŁNIENIA

### Anthropic (Claude API) (`anthropic`)

- **Cel w portalu:** Import ogłoszenia o pracę do szkicu oferty (zrzut ekranu albo treść strony pobranej z linku).
- **Kategorie danych:** Tekst strony z ogłoszeniem po minimalizacji (bez e-maili, telefonów i numerów identyfikacyjnych) i sama nazwa hosta źródła; Albo obraz zrzutu ekranu (base64) — bez lokalnej redakcji; może zawierać dane osób z ogłoszenia
- **Osoby:** Osoby wymienione w importowanym ogłoszeniu, Pracodawca wykonujący import (pośrednio)
- **Aktywacja:** AI_JOB_IMPORT_ENABLED=1/true + ANTHROPIC_API_KEY; domyślnie wyłączone. Model: DEFAULT_JOB_IMPORT_MODEL albo AI_JOB_IMPORT_MODEL.
- **Kod:** `src/lib/ai-import/extract.ts`, `src/lib/ai-import/minimize.ts`, `src/lib/ai-import/run-import.ts`, `src/lib/ai-import/config.ts`, `docs/AI_JOB_IMPORT.md`
- **Uwaga:** Kod nie wysyła do modelu danych kandydatów, profili ani CV.
- **Uwaga:** Tekst: z JSON-LD zostają tylko dozwolone pola JobPosting; redakcja e-maili, telefonów, NISS/BIS, PESEL i numerów dokumentów przed wysyłką (minimize.ts). Numer identyfikacyjny w odpowiedzi modelu = odmowa importu.
- **Uwaga:** Kod nie ustawia parametru inference_geo ani innych ustawień regionu.
- **Rola (procesor/administrator):** DO UZUPEŁNIENIA
- **Region przetwarzania:** DO UZUPEŁNIENIA
- **Podstawa transferu poza EOG:** DO UZUPEŁNIENIA
- **Umowa (DPA):** DO UZUPEŁNIENIA
- **Retencja u dostawcy:** DO UZUPEŁNIENIA

### Stripe (`stripe`)

- **Cel w portalu:** Płatności — WYŁĄCZONE w bezpłatnym MVP (#51).
- **Kategorie danych:** Brak przepływu przy wyłączonej fladze (dane rozliczeniowe firmy, gdyby płatności wróciły)
- **Osoby:** Pracodawcy
- **Aktywacja:** Tylko BILLING_ENABLED=true; akcje checkoutu zawsze zwracają BILLING_UNAVAILABLE.
- **Kod:** `src/lib/billing/flag.ts`, `src/lib/stripe.ts`, `docs/PRODUCT_DECISIONS.md`
- **Uwaga:** Powrót płatności wymaga nowej decyzji i ponownej oceny dostawcy.
- **Rola (procesor/administrator):** DO UZUPEŁNIENIA
- **Region przetwarzania:** DO UZUPEŁNIENIA
- **Podstawa transferu poza EOG:** DO UZUPEŁNIENIA
- **Umowa (DPA):** DO UZUPEŁNIENIA
- **Retencja u dostawcy:** DO UZUPEŁNIENIA

### Google Analytics (gtag) (`google-analytics`)

- **Cel w portalu:** Analityka ruchu — wyłącznie po zgodzie w kategorii analytics.
- **Kategorie danych:** Wyświetlenia stron i identyfikatory cookies _ga* ustawiane przez skrypt dostawcy (pełny zakres określa dostawca)
- **Osoby:** Odwiedzający, którzy wyrazili zgodę
- **Aktywacja:** NEXT_PUBLIC_GA_MEASUREMENT_ID + zgoda analytics w banerze cookies.
- **Kod:** `src/components/cookies/Analytics.tsx`, `src/lib/consent-store.ts`
- **Uwaga:** gtag config z anonymize_ip: true; wycofanie zgody usuwa cookies _ga*.
- **Rola (procesor/administrator):** DO UZUPEŁNIENIA
- **Region przetwarzania:** DO UZUPEŁNIENIA
- **Podstawa transferu poza EOG:** DO UZUPEŁNIENIA
- **Umowa (DPA):** DO UZUPEŁNIENIA
- **Retencja u dostawcy:** DO UZUPEŁNIENIA

### Meta Pixel (`meta-pixel`)

- **Cel w portalu:** Marketing/remarketing — wyłącznie po zgodzie w kategorii marketing.
- **Kategorie danych:** Zdarzenie PageView i identyfikatory cookies _fbp/_fbc ustawiane przez skrypt dostawcy (pełny zakres określa dostawca)
- **Osoby:** Odwiedzający, którzy wyrazili zgodę
- **Aktywacja:** NEXT_PUBLIC_META_PIXEL_ID + zgoda marketing w banerze cookies.
- **Kod:** `src/components/cookies/Analytics.tsx`, `src/lib/consent-store.ts`
- **Uwaga:** Wycofanie zgody: fbq('consent','revoke') i usunięcie cookies _fbp/_fbc.
- **Rola (procesor/administrator):** DO UZUPEŁNIENIA
- **Region przetwarzania:** DO UZUPEŁNIENIA
- **Podstawa transferu poza EOG:** DO UZUPEŁNIENIA
- **Umowa (DPA):** DO UZUPEŁNIENIA
- **Retencja u dostawcy:** DO UZUPEŁNIENIA

### VIES (Komisja Europejska) (`vies`)

- **Cel w portalu:** Sprawdzenie numeru VAT firmy na żądanie administratora.
- **Kategorie danych:** Kod kraju i numer VAT firmy (u osoby prowadzącej działalność może identyfikować osobę)
- **Osoby:** Pracodawcy
- **Aktywacja:** Akcja administratora w /admin/firmy/[id].
- **Kod:** `src/lib/vies/client.ts`, `src/lib/vies/belgian-vat.ts`
- **Uwaga:** Zapisywane są tylko wyniki rozstrzygające (company_vies_checks).
- **Rola (procesor/administrator):** DO UZUPEŁNIENIA
- **Region przetwarzania:** DO UZUPEŁNIENIA
- **Podstawa transferu poza EOG:** DO UZUPEŁNIENIA
- **Umowa (DPA):** DO UZUPEŁNIENIA
- **Retencja u dostawcy:** DO UZUPEŁNIENIA

## 3. Tabele z danymi osobowymi

### `auth.accounts`

- **Migracja:** `database/auth/0057_better_auth_core.sql`
- **Czynności:** Konto i uwierzytelnianie
- **Osoby:** Kandydaci (konto), Pracodawcy i członkowie firm, Administratorzy portalu

| Kolumna | Kategoria | Wprowadzona w |
|---|---|---|
| `user_id` | Powiązanie z osobą (identyfikator konta/profilu) | `database/auth/0057_better_auth_core.sql` |
| `account_id` | Uwierzytelnianie (skrót hasła, tokeny, sesje, kody) | `database/auth/0057_better_auth_core.sql` |
| `access_token` | Uwierzytelnianie (skrót hasła, tokeny, sesje, kody) | `database/auth/0057_better_auth_core.sql` |
| `refresh_token` | Uwierzytelnianie (skrót hasła, tokeny, sesje, kody) | `database/auth/0057_better_auth_core.sql` |
| `id_token` | Uwierzytelnianie (skrót hasła, tokeny, sesje, kody) | `database/auth/0057_better_auth_core.sql` |
| `password` | Uwierzytelnianie (skrót hasła, tokeny, sesje, kody) | `database/auth/0057_better_auth_core.sql` |

### `auth.email_outbox`

- **Migracja:** `database/auth/0061_auth_email_outbox.sql`
- **Czynności:** Konto i uwierzytelnianie, E-maile i powiadomienia
- **Osoby:** Kandydaci (konto), Pracodawcy i członkowie firm, Administratorzy portalu
- **Uwaga:** Kolejka e-maili konta; w src/ nie ma jeszcze workera, który ją czyta.

| Kolumna | Kategoria | Wprowadzona w |
|---|---|---|
| `user_id` | Powiązanie z osobą (identyfikator konta/profilu) | `database/auth/0061_auth_email_outbox.sql` |
| `recipient_email` | Dane kontaktowe (e-mail, telefon) | `database/auth/0061_auth_email_outbox.sql` |
| `first_name` | Identyfikacja (imię, nazwisko, zdjęcie, rola) | `database/auth/0061_auth_email_outbox.sql` |
| `recipient_role` | Identyfikacja (imię, nazwisko, zdjęcie, rola) | `database/auth/0061_auth_email_outbox.sql` |
| `token` | Uwierzytelnianie (skrót hasła, tokeny, sesje, kody) | `database/auth/0061_auth_email_outbox.sql` |
| `locale` | Preferencje i ustawienia (język, powiadomienia, wyszukiwania, blokady) | `database/auth/0061_auth_email_outbox.sql` |

### `auth.sessions`

- **Migracja:** `database/auth/0057_better_auth_core.sql`
- **Czynności:** Konto i uwierzytelnianie, Bezpieczeństwo, audyt i limity
- **Osoby:** Kandydaci (konto), Pracodawcy i członkowie firm, Administratorzy portalu

| Kolumna | Kategoria | Wprowadzona w |
|---|---|---|
| `user_id` | Powiązanie z osobą (identyfikator konta/profilu) | `database/auth/0057_better_auth_core.sql` |
| `token` | Uwierzytelnianie (skrót hasła, tokeny, sesje, kody) | `database/auth/0057_better_auth_core.sql` |
| `ip_address` | Dane techniczne (IP, User-Agent, identyfikatory urządzeń, dzienniki) | `database/auth/0057_better_auth_core.sql` |
| `user_agent` | Dane techniczne (IP, User-Agent, identyfikatory urządzeń, dzienniki) | `database/auth/0057_better_auth_core.sql` |

### `auth.users`

- **Migracja:** `database/bootstrap/0001_roles_and_identity.sql`
- **Czynności:** Konto i uwierzytelnianie
- **Osoby:** Kandydaci (konto), Pracodawcy i członkowie firm, Administratorzy portalu

| Kolumna | Kategoria | Wprowadzona w |
|---|---|---|
| `email` | Dane kontaktowe (e-mail, telefon) | `database/bootstrap/0001_roles_and_identity.sql` |
| `name` | Identyfikacja (imię, nazwisko, zdjęcie, rola) | `database/auth/0057_better_auth_core.sql` |
| `raw_user_meta_data` | Identyfikacja (imię, nazwisko, zdjęcie, rola) | `database/bootstrap/0001_roles_and_identity.sql` |
| `image` | Identyfikacja (imię, nazwisko, zdjęcie, rola) | `database/auth/0057_better_auth_core.sql` |
| `email_verified` | Uwierzytelnianie (skrót hasła, tokeny, sesje, kody) | `database/auth/0057_better_auth_core.sql` |

### `auth.verifications`

- **Migracja:** `database/auth/0057_better_auth_core.sql`
- **Czynności:** Konto i uwierzytelnianie
- **Osoby:** Kandydaci (konto), Pracodawcy i członkowie firm, Administratorzy portalu
- **Uwaga:** Jednorazowe identyfikatory i wartości weryfikacji (np. potwierdzenie e-maila, reset hasła).

| Kolumna | Kategoria | Wprowadzona w |
|---|---|---|
| `identifier` | Uwierzytelnianie (skrót hasła, tokeny, sesje, kody) | `database/auth/0057_better_auth_core.sql` |
| `value` | Uwierzytelnianie (skrót hasła, tokeny, sesje, kody) | `database/auth/0057_better_auth_core.sql` |

### `public.age_policy`

- **Migracja:** `supabase/migrations/0126_candidate_age_policy.sql`
- **Czynności:** Konto i uwierzytelnianie, Bezpieczeństwo, audyt i limity
- **Osoby:** Administratorzy portalu
- **Uwaga:** Próg konta kandydata jako dane (0126, #492/#576: 16 albo 18); zmienia go administrator z uzasadnieniem i audytem.

| Kolumna | Kategoria | Wprowadzona w |
|---|---|---|
| `updated_by` | Powiązanie z osobą (identyfikator konta/profilu) | `supabase/migrations/0126_candidate_age_policy.sql` |

### `public.application_screening_answers`

- **Migracja:** `supabase/migrations/0093_screening_questions.sql`
- **Czynności:** Aplikacje na oferty, Aplikacja bez konta
- **Osoby:** Kandydaci (konto), Aplikujący bez konta
- **Uwaga:** Niezmienny snapshot pytania i odpowiedzi; widoczny dla kandydata i recruiter+ firmy.

| Kolumna | Kategoria | Wprowadzona w |
|---|---|---|
| `answer_boolean` | Proces rekrutacyjny (statusy, dopasowanie, odpowiedzi screeningowe) | `supabase/migrations/0093_screening_questions.sql` |
| `answer_date` | Proces rekrutacyjny (statusy, dopasowanie, odpowiedzi screeningowe) | `supabase/migrations/0093_screening_questions.sql` |
| `answer_text` | Proces rekrutacyjny (statusy, dopasowanie, odpowiedzi screeningowe) | `supabase/migrations/0093_screening_questions.sql` |

### `public.application_status_history`

- **Migracja:** `supabase/migrations/0005_processes.sql`
- **Czynności:** Aplikacje na oferty
- **Osoby:** Kandydaci (konto), Aplikujący bez konta, Pracodawcy i członkowie firm

| Kolumna | Kategoria | Wprowadzona w |
|---|---|---|
| `from_status` | Proces rekrutacyjny (statusy, dopasowanie, odpowiedzi screeningowe) | `supabase/migrations/0005_processes.sql` |
| `to_status` | Proces rekrutacyjny (statusy, dopasowanie, odpowiedzi screeningowe) | `supabase/migrations/0005_processes.sql` |
| `changed_by` | Powiązanie z osobą (identyfikator konta/profilu) | `supabase/migrations/0005_processes.sql` |
| `note` | Korespondencja i treści swobodne | `supabase/migrations/0005_processes.sql` |

### `public.applications`

- **Migracja:** `supabase/migrations/0005_processes.sql`
- **Czynności:** Aplikacje na oferty, Aplikacja bez konta
- **Osoby:** Kandydaci (konto), Aplikujący bez konta

| Kolumna | Kategoria | Wprowadzona w |
|---|---|---|
| `candidate_id` | Powiązanie z osobą (identyfikator konta/profilu) | `supabase/migrations/0005_processes.sql` |
| `status` | Proces rekrutacyjny (statusy, dopasowanie, odpowiedzi screeningowe) | `supabase/migrations/0005_processes.sql` |
| `message` | Korespondencja i treści swobodne | `supabase/migrations/0005_processes.sql` |
| `phone` | Dane kontaktowe (e-mail, telefon) | `supabase/migrations/0005_processes.sql` |
| `availability` | Profil zawodowy (doświadczenie, umiejętności, języki, certyfikaty, dostępność, lokalizacja) | `supabase/migrations/0005_processes.sql` |
| `locale` | Preferencje i ustawienia (język, powiadomienia, wyszukiwania, blokady) | `supabase/migrations/0005_processes.sql` |
| `match_score` | Proces rekrutacyjny (statusy, dopasowanie, odpowiedzi screeningowe) | `supabase/migrations/0005_processes.sql` |
| `viewed_at` | Proces rekrutacyjny (statusy, dopasowanie, odpowiedzi screeningowe) | `supabase/migrations/0005_processes.sql` |
| `submitted_at` | Proces rekrutacyjny (statusy, dopasowanie, odpowiedzi screeningowe) | `supabase/migrations/0005_processes.sql` |
| `guest_name` | Identyfikacja (imię, nazwisko, zdjęcie, rola) | `supabase/migrations/0095_guest_applications.sql` |
| `guest_email` | Dane kontaktowe (e-mail, telefon) | `supabase/migrations/0095_guest_applications.sql` |
| `claimed_at` | Proces rekrutacyjny (statusy, dopasowanie, odpowiedzi screeningowe) | `supabase/migrations/0095_guest_applications.sql` |

### `public.audit_logs`

- **Migracja:** `supabase/migrations/0007_misc.sql`
- **Czynności:** Bezpieczeństwo, audyt i limity
- **Osoby:** Kandydaci (konto), Pracodawcy i członkowie firm, Administratorzy portalu
- **Uwaga:** before_data/after_data mogą zawierać kopie pól audytowanych wierszy (aplikacje, propozycje, firmy).

| Kolumna | Kategoria | Wprowadzona w |
|---|---|---|
| `actor_id` | Powiązanie z osobą (identyfikator konta/profilu) | `supabase/migrations/0007_misc.sql` |
| `before_data` | Dane techniczne (IP, User-Agent, identyfikatory urządzeń, dzienniki) | `supabase/migrations/0007_misc.sql` |
| `after_data` | Dane techniczne (IP, User-Agent, identyfikatory urządzeń, dzienniki) | `supabase/migrations/0007_misc.sql` |
| `ip_address` | Dane techniczne (IP, User-Agent, identyfikatory urządzeń, dzienniki) | `supabase/migrations/0007_misc.sql` |
| `user_agent` | Dane techniczne (IP, User-Agent, identyfikatory urządzeń, dzienniki) | `supabase/migrations/0007_misc.sql` |

### `public.breach_incident_events`

- **Migracja:** `supabase/migrations/0106_breach_register.sql`
- **Czynności:** Bezpieczeństwo, audyt i limity
- **Osoby:** Administratorzy portalu
- **Uwaga:** Niezmienna historia zmian wpisu (pole: przed/po).

| Kolumna | Kategoria | Wprowadzona w |
|---|---|---|
| `actor_id` | Powiązanie z osobą (identyfikator konta/profilu) | `supabase/migrations/0106_breach_register.sql` |
| `changes` | Dane techniczne (IP, User-Agent, identyfikatory urządzeń, dzienniki) | `supabase/migrations/0106_breach_register.sql` |
| `note` | Korespondencja i treści swobodne | `supabase/migrations/0106_breach_register.sql` |

### `public.breach_incidents`

- **Migracja:** `supabase/migrations/0106_breach_register.sql`
- **Czynności:** Bezpieczeństwo, audyt i limity
- **Osoby:** Administratorzy portalu
- **Uwaga:** Opis zdarzenia i skali bez kopii danych osób (interfejs prosi o opis zakresu). Dostęp tylko admin (RPC, odczyt service-role).

| Kolumna | Kategoria | Wprowadzona w |
|---|---|---|
| `created_by` | Powiązanie z osobą (identyfikator konta/profilu) | `supabase/migrations/0106_breach_register.sql` |
| `description` | Korespondencja i treści swobodne | `supabase/migrations/0106_breach_register.sql` |
| `actions_taken` | Korespondencja i treści swobodne | `supabase/migrations/0106_breach_register.sql` |

### `public.breach_notice_recipients`

- **Migracja:** `supabase/migrations/0106_breach_register.sql`
- **Czynności:** Bezpieczeństwo, audyt i limity, E-maile i powiadomienia
- **Osoby:** Kandydaci (konto), Pracodawcy i członkowie firm
- **Uwaga:** Kto dostał zawiadomienie o naruszeniu (konto + język), bez adresu e-mail.

| Kolumna | Kategoria | Wprowadzona w |
|---|---|---|
| `profile_id` | Powiązanie z osobą (identyfikator konta/profilu) | `supabase/migrations/0106_breach_register.sql` |
| `locale` | Preferencje i ustawienia (język, powiadomienia, wyszukiwania, blokady) | `supabase/migrations/0106_breach_register.sql` |
| `queued` | Dane techniczne (IP, User-Agent, identyfikatory urządzeń, dzienniki) | `supabase/migrations/0106_breach_register.sql` |

### `public.breach_notices`

- **Migracja:** `supabase/migrations/0106_breach_register.sql`
- **Czynności:** Bezpieczeństwo, audyt i limity, E-maile i powiadomienia
- **Osoby:** Administratorzy portalu
- **Uwaga:** Treść zawiadomienia wpisana przez administratora (per język), bez listy adresów.

| Kolumna | Kategoria | Wprowadzona w |
|---|---|---|
| `created_by` | Powiązanie z osobą (identyfikator konta/profilu) | `supabase/migrations/0106_breach_register.sql` |
| `content` | Korespondencja i treści swobodne | `supabase/migrations/0106_breach_register.sql` |

### `public.candidate_age_attestations`

- **Migracja:** `supabase/migrations/0126_candidate_age_policy.sql`
- **Czynności:** Konto i uwierzytelnianie, Profil zawodowy kandydata
- **Osoby:** Kandydaci (konto)
- **Uwaga:** Potwierdzenie przedziału wieku 16–17 / 18+ (0126, #492/#576): dolna granica przedziału i czas, bez daty urodzenia; niezmienne.

| Kolumna | Kategoria | Wprowadzona w |
|---|---|---|
| `profile_id` | Powiązanie z osobą (identyfikator konta/profilu) | `supabase/migrations/0126_candidate_age_policy.sql` |
| `min_age` | Identyfikacja (imię, nazwisko, zdjęcie, rola) | `supabase/migrations/0126_candidate_age_policy.sql` |
| `source` | Dane techniczne (IP, User-Agent, identyfikatory urządzeń, dzienniki) | `supabase/migrations/0126_candidate_age_policy.sql` |
| `locale` | Preferencje i ustawienia (język, powiadomienia, wyszukiwania, blokady) | `supabase/migrations/0126_candidate_age_policy.sql` |
| `created_at` | Identyfikacja (imię, nazwisko, zdjęcie, rola) | `supabase/migrations/0126_candidate_age_policy.sql` |

### `public.candidate_certificates`

- **Migracja:** `supabase/migrations/0004_candidate_relations.sql`
- **Czynności:** Profil zawodowy kandydata, Dopasowanie i zapisane wyszukiwania
- **Osoby:** Kandydaci (konto)

| Kolumna | Kategoria | Wprowadzona w |
|---|---|---|
| `candidate_profile_id` | Powiązanie z osobą (identyfikator konta/profilu) | `supabase/migrations/0004_candidate_relations.sql` |
| `certificate_label` | Profil zawodowy (doświadczenie, umiejętności, języki, certyfikaty, dostępność, lokalizacja) | `supabase/migrations/0004_candidate_relations.sql` |
| `issued_at` | Profil zawodowy (doświadczenie, umiejętności, języki, certyfikaty, dostępność, lokalizacja) | `supabase/migrations/0004_candidate_relations.sql` |
| `expires_at` | Profil zawodowy (doświadczenie, umiejętności, języki, certyfikaty, dostępność, lokalizacja) | `supabase/migrations/0004_candidate_relations.sql` |

### `public.candidate_company_blocks`

- **Migracja:** `supabase/migrations/0078_candidate_company_blocks.sql`
- **Czynności:** Kontakt pracodawca–kandydat
- **Osoby:** Kandydaci (konto)
- **Uwaga:** Firma nie ma ścieżki odczytu blokad (0078).

| Kolumna | Kategoria | Wprowadzona w |
|---|---|---|
| `candidate_id` | Powiązanie z osobą (identyfikator konta/profilu) | `supabase/migrations/0078_candidate_company_blocks.sql` |
| `company_id` | Preferencje i ustawienia (język, powiadomienia, wyszukiwania, blokady) | `supabase/migrations/0078_candidate_company_blocks.sql` |

### `public.candidate_languages`

- **Migracja:** `supabase/migrations/0004_candidate_relations.sql`
- **Czynności:** Profil zawodowy kandydata, Dopasowanie i zapisane wyszukiwania
- **Osoby:** Kandydaci (konto)

| Kolumna | Kategoria | Wprowadzona w |
|---|---|---|
| `candidate_profile_id` | Powiązanie z osobą (identyfikator konta/profilu) | `supabase/migrations/0004_candidate_relations.sql` |
| `language_label` | Profil zawodowy (doświadczenie, umiejętności, języki, certyfikaty, dostępność, lokalizacja) | `supabase/migrations/0004_candidate_relations.sql` |
| `level` | Profil zawodowy (doświadczenie, umiejętności, języki, certyfikaty, dostępność, lokalizacja) | `supabase/migrations/0004_candidate_relations.sql` |

### `public.candidate_profiles`

- **Migracja:** `supabase/migrations/0002_core_tables.sql`
- **Czynności:** Profil zawodowy kandydata, Dopasowanie i zapisane wyszukiwania
- **Osoby:** Kandydaci (konto)

| Kolumna | Kategoria | Wprowadzona w |
|---|---|---|
| `profile_id` | Powiązanie z osobą (identyfikator konta/profilu) | `supabase/migrations/0002_core_tables.sql` |
| `headline` | Profil zawodowy (doświadczenie, umiejętności, języki, certyfikaty, dostępność, lokalizacja) | `supabase/migrations/0002_core_tables.sql` |
| `bio` | Korespondencja i treści swobodne | `supabase/migrations/0002_core_tables.sql` |
| `city` | Profil zawodowy (doświadczenie, umiejętności, języki, certyfikaty, dostępność, lokalizacja) | `supabase/migrations/0002_core_tables.sql` |
| `region` | Profil zawodowy (doświadczenie, umiejętności, języki, certyfikaty, dostępność, lokalizacja) | `supabase/migrations/0002_core_tables.sql` |
| `radius_km` | Profil zawodowy (doświadczenie, umiejętności, języki, certyfikaty, dostępność, lokalizacja) | `supabase/migrations/0002_core_tables.sql` |
| `has_driving_license` | Profil zawodowy (doświadczenie, umiejętności, języki, certyfikaty, dostępność, lokalizacja) | `supabase/migrations/0002_core_tables.sql` |
| `has_car` | Profil zawodowy (doświadczenie, umiejętności, języki, certyfikaty, dostępność, lokalizacja) | `supabase/migrations/0002_core_tables.sql` |
| `experience_years` | Profil zawodowy (doświadczenie, umiejętności, języki, certyfikaty, dostępność, lokalizacja) | `supabase/migrations/0002_core_tables.sql` |
| `availability` | Profil zawodowy (doświadczenie, umiejętności, języki, certyfikaty, dostępność, lokalizacja) | `supabase/migrations/0002_core_tables.sql` |
| `occupations` | Profil zawodowy (doświadczenie, umiejętności, języki, certyfikaty, dostępność, lokalizacja) | `supabase/migrations/0002_core_tables.sql` |
| `categories` | Profil zawodowy (doświadczenie, umiejętności, języki, certyfikaty, dostępność, lokalizacja) | `supabase/migrations/0002_core_tables.sql` |
| `preferred_contract_types` | Profil zawodowy (doświadczenie, umiejętności, języki, certyfikaty, dostępność, lokalizacja) | `supabase/migrations/0002_core_tables.sql` |
| `expected_salary_min` | Profil zawodowy (doświadczenie, umiejętności, języki, certyfikaty, dostępność, lokalizacja) | `supabase/migrations/0002_core_tables.sql` |
| `is_searchable` | Preferencje i ustawienia (język, powiadomienia, wyszukiwania, blokady) | `supabase/migrations/0002_core_tables.sql` |
| `searchable_changed_at` | Preferencje i ustawienia (język, powiadomienia, wyszukiwania, blokady) | `supabase/migrations/0100_candidate_visibility.sql` |

### `public.candidate_skills`

- **Migracja:** `supabase/migrations/0004_candidate_relations.sql`
- **Czynności:** Profil zawodowy kandydata, Dopasowanie i zapisane wyszukiwania
- **Osoby:** Kandydaci (konto)

| Kolumna | Kategoria | Wprowadzona w |
|---|---|---|
| `candidate_profile_id` | Powiązanie z osobą (identyfikator konta/profilu) | `supabase/migrations/0004_candidate_relations.sql` |
| `skill_label` | Profil zawodowy (doświadczenie, umiejętności, języki, certyfikaty, dostępność, lokalizacja) | `supabase/migrations/0004_candidate_relations.sql` |
| `years` | Profil zawodowy (doświadczenie, umiejętności, języki, certyfikaty, dostępność, lokalizacja) | `supabase/migrations/0004_candidate_relations.sql` |

### `public.candidate_visibility_events`

- **Migracja:** `supabase/migrations/0100_candidate_visibility.sql`
- **Czynności:** Profil zawodowy kandydata
- **Osoby:** Kandydaci (konto)
- **Uwaga:** Historia włączania/wyłączania widoczności profilu (0100); firma nie ma ścieżki odczytu.

| Kolumna | Kategoria | Wprowadzona w |
|---|---|---|
| `candidate_id` | Powiązanie z osobą (identyfikator konta/profilu) | `supabase/migrations/0100_candidate_visibility.sql` |
| `searchable` | Preferencje i ustawienia (język, powiadomienia, wyszukiwania, blokady) | `supabase/migrations/0100_candidate_visibility.sql` |
| `created_at` | Preferencje i ustawienia (język, powiadomienia, wyszukiwania, blokady) | `supabase/migrations/0100_candidate_visibility.sql` |

### `public.companies`

- **Migracja:** `supabase/migrations/0002_core_tables.sql`
- **Czynności:** Konta firm, zespół i weryfikacja
- **Osoby:** Pracodawcy i członkowie firm

| Kolumna | Kategoria | Wprowadzona w |
|---|---|---|
| `name` | Dane firmy mogące identyfikować osobę (np. jednoosobowa działalność) | `supabase/migrations/0002_core_tables.sql` |
| `vat_number` | Dane firmy mogące identyfikować osobę (np. jednoosobowa działalność) | `supabase/migrations/0002_core_tables.sql` |
| `registration_number` | Dane firmy mogące identyfikować osobę (np. jednoosobowa działalność) | `supabase/migrations/0002_core_tables.sql` |
| `website` | Dane firmy mogące identyfikować osobę (np. jednoosobowa działalność) | `supabase/migrations/0002_core_tables.sql` |
| `email` | Dane kontaktowe (e-mail, telefon) | `supabase/migrations/0002_core_tables.sql` |
| `phone` | Dane kontaktowe (e-mail, telefon) | `supabase/migrations/0002_core_tables.sql` |
| `address` | Dane firmy mogące identyfikować osobę (np. jednoosobowa działalność) | `supabase/migrations/0002_core_tables.sql` |
| `postal_code` | Dane firmy mogące identyfikować osobę (np. jednoosobowa działalność) | `supabase/migrations/0002_core_tables.sql` |
| `city` | Dane firmy mogące identyfikować osobę (np. jednoosobowa działalność) | `supabase/migrations/0002_core_tables.sql` |
| `verified_by` | Powiązanie z osobą (identyfikator konta/profilu) | `supabase/migrations/0002_core_tables.sql` |
| `status_reason` | Zgłoszenia treści i decyzje moderacyjne | `supabase/migrations/0084_admin_company_review.sql` |

### `public.company_invitations`

- **Migracja:** `supabase/migrations/0086_company_team.sql`
- **Czynności:** Konta firm, zespół i weryfikacja
- **Osoby:** Osoby zaproszone do zespołu firmy, Pracodawcy i członkowie firm
- **Uwaga:** Język zaproszenia wybiera zapraszający (adres bez konta, 0121); w bazie tylko hash tokenu linku rejestracji, usuwany po rozstrzygnięciu zaproszenia.

| Kolumna | Kategoria | Wprowadzona w |
|---|---|---|
| `email` | Dane kontaktowe (e-mail, telefon) | `supabase/migrations/0086_company_team.sql` |
| `role` | Identyfikacja (imię, nazwisko, zdjęcie, rola) | `supabase/migrations/0086_company_team.sql` |
| `invited_by` | Powiązanie z osobą (identyfikator konta/profilu) | `supabase/migrations/0086_company_team.sql` |
| `responded_by` | Powiązanie z osobą (identyfikator konta/profilu) | `supabase/migrations/0086_company_team.sql` |
| `locale` | Preferencje i ustawienia (język, powiadomienia, wyszukiwania, blokady) | `supabase/migrations/0121_team_invitation_signup.sql` |
| `signup_token_hash` | Uwierzytelnianie (skrót hasła, tokeny, sesje, kody) | `supabase/migrations/0121_team_invitation_signup.sql` |
| `signup_token_used_at` | Uwierzytelnianie (skrót hasła, tokeny, sesje, kody) | `supabase/migrations/0121_team_invitation_signup.sql` |

### `public.company_members`

- **Migracja:** `supabase/migrations/0002_core_tables.sql`
- **Czynności:** Konta firm, zespół i weryfikacja
- **Osoby:** Pracodawcy i członkowie firm

| Kolumna | Kategoria | Wprowadzona w |
|---|---|---|
| `profile_id` | Powiązanie z osobą (identyfikator konta/profilu) | `supabase/migrations/0002_core_tables.sql` |
| `role` | Identyfikacja (imię, nazwisko, zdjęcie, rola) | `supabase/migrations/0002_core_tables.sql` |
| `is_active` | Identyfikacja (imię, nazwisko, zdjęcie, rola) | `supabase/migrations/0002_core_tables.sql` |
| `invited_by` | Powiązanie z osobą (identyfikator konta/profilu) | `supabase/migrations/0002_core_tables.sql` |
| `joined_at` | Identyfikacja (imię, nazwisko, zdjęcie, rola) | `supabase/migrations/0002_core_tables.sql` |

### `public.company_vies_checks`

- **Migracja:** `supabase/migrations/0088_company_vies_checks.sql`
- **Czynności:** Konta firm, zespół i weryfikacja
- **Osoby:** Pracodawcy i członkowie firm

| Kolumna | Kategoria | Wprowadzona w |
|---|---|---|
| `vat_number` | Dane firmy mogące identyfikować osobę (np. jednoosobowa działalność) | `supabase/migrations/0088_company_vies_checks.sql` |
| `vies_name` | Dane firmy mogące identyfikować osobę (np. jednoosobowa działalność) | `supabase/migrations/0088_company_vies_checks.sql` |
| `checked_by` | Powiązanie z osobą (identyfikator konta/profilu) | `supabase/migrations/0088_company_vies_checks.sql` |

### `public.consents`

- **Migracja:** `supabase/migrations/0007_misc.sql`
- **Czynności:** Zgody cookies i akceptacja dokumentów
- **Osoby:** Kandydaci (konto), Pracodawcy i członkowie firm, Odwiedzający (bez konta)

| Kolumna | Kategoria | Wprowadzona w |
|---|---|---|
| `profile_id` | Powiązanie z osobą (identyfikator konta/profilu) | `supabase/migrations/0007_misc.sql` |
| `visitor_id` | Dane techniczne (IP, User-Agent, identyfikatory urządzeń, dzienniki) | `supabase/migrations/0007_misc.sql` |
| `category` | Dowody zgód i akceptacji dokumentów | `supabase/migrations/0007_misc.sql` |
| `granted` | Dowody zgód i akceptacji dokumentów | `supabase/migrations/0007_misc.sql` |
| `ip_address` | Dane techniczne (IP, User-Agent, identyfikatory urządzeń, dzienniki) | `supabase/migrations/0007_misc.sql` |
| `user_agent` | Dane techniczne (IP, User-Agent, identyfikatory urządzeń, dzienniki) | `supabase/migrations/0007_misc.sql` |

### `public.contact_messages`

- **Migracja:** `supabase/migrations/0125_contact_messages.sql`
- **Czynności:** Formularz kontaktu
- **Osoby:** Odwiedzający (bez konta), Kandydaci (konto), Pracodawcy i członkowie firm, Administratorzy portalu
- **Uwaga:** Wiadomości z formularza kontaktu (0125). Retencja i powiązanie z eksportem/usunięciem konta — do decyzji właściciela (#486).

| Kolumna | Kategoria | Wprowadzona w |
|---|---|---|
| `sender_id` | Powiązanie z osobą (identyfikator konta/profilu) | `supabase/migrations/0125_contact_messages.sql` |
| `sender_name` | Identyfikacja (imię, nazwisko, zdjęcie, rola) | `supabase/migrations/0125_contact_messages.sql` |
| `sender_email` | Dane kontaktowe (e-mail, telefon) | `supabase/migrations/0125_contact_messages.sql` |
| `topic` | Korespondencja i treści swobodne | `supabase/migrations/0125_contact_messages.sql` |
| `message` | Korespondencja i treści swobodne | `supabase/migrations/0125_contact_messages.sql` |
| `locale` | Preferencje i ustawienia (język, powiadomienia, wyszukiwania, blokady) | `supabase/migrations/0125_contact_messages.sql` |
| `handled_by` | Powiązanie z osobą (identyfikator konta/profilu) | `supabase/migrations/0125_contact_messages.sql` |

### `public.conversation_members`

- **Migracja:** `supabase/migrations/0006_messaging.sql`
- **Czynności:** Kontakt pracodawca–kandydat
- **Osoby:** Kandydaci (konto), Pracodawcy i członkowie firm

| Kolumna | Kategoria | Wprowadzona w |
|---|---|---|
| `profile_id` | Powiązanie z osobą (identyfikator konta/profilu) | `supabase/migrations/0006_messaging.sql` |
| `last_read_at` | Dane techniczne (IP, User-Agent, identyfikatory urządzeń, dzienniki) | `supabase/migrations/0006_messaging.sql` |

### `public.conversations`

- **Migracja:** `supabase/migrations/0006_messaging.sql`
- **Czynności:** Kontakt pracodawca–kandydat
- **Osoby:** Kandydaci (konto), Pracodawcy i członkowie firm

| Kolumna | Kategoria | Wprowadzona w |
|---|---|---|
| `subject` | Korespondencja i treści swobodne | `supabase/migrations/0006_messaging.sql` |
| `created_by` | Powiązanie z osobą (identyfikator konta/profilu) | `supabase/migrations/0006_messaging.sql` |

### `public.data_rights_requests`

- **Migracja:** `supabase/migrations/0105_data_retention_rights.sql`
- **Czynności:** Prawa osób i retencja
- **Osoby:** Kandydaci (konto)
- **Uwaga:** Ślad obsługi wniosku bez FK do profilu — przetrwa usunięcie konta.

| Kolumna | Kategoria | Wprowadzona w |
|---|---|---|
| `subject_id` | Powiązanie z osobą (identyfikator konta/profilu) | `supabase/migrations/0105_data_retention_rights.sql` |
| `details` | nie dotyczy: Same liczniki usuniętych obiektów (bez treści danych). | — |

### `public.document_acceptances`

- **Migracja:** `supabase/migrations/0054_document_acceptances.sql`
- **Czynności:** Zgody cookies i akceptacja dokumentów, Konto i uwierzytelnianie
- **Osoby:** Kandydaci (konto), Pracodawcy i członkowie firm

| Kolumna | Kategoria | Wprowadzona w |
|---|---|---|
| `profile_id` | Powiązanie z osobą (identyfikator konta/profilu) | `supabase/migrations/0054_document_acceptances.sql` |
| `kind` | Dowody zgód i akceptacji dokumentów | `supabase/migrations/0108_consent_separation.sql` |
| `source` | Dowody zgód i akceptacji dokumentów | `supabase/migrations/0108_consent_separation.sql` |
| `document_version` | Dowody zgód i akceptacji dokumentów | `supabase/migrations/0054_document_acceptances.sql` |
| `accepted_at` | Dowody zgód i akceptacji dokumentów | `supabase/migrations/0054_document_acceptances.sql` |
| `ip_address` | Dane techniczne (IP, User-Agent, identyfikatory urządzeń, dzienniki) | `supabase/migrations/0054_document_acceptances.sql` |
| `user_agent` | Dane techniczne (IP, User-Agent, identyfikatory urządzeń, dzienniki) | `supabase/migrations/0054_document_acceptances.sql` |

### `public.email_campaign_recipients`

- **Migracja:** `supabase/migrations/0101_email_consent_campaigns.sql`
- **Czynności:** E-maile i powiadomienia
- **Osoby:** Kandydaci (konto), Pracodawcy i członkowie firm
- **Uwaga:** Rezerwacja odbiorcy kampanii (rewizja + odbiorca), bez treści i adresu e-mail (0101).

| Kolumna | Kategoria | Wprowadzona w |
|---|---|---|
| `profile_id` | Powiązanie z osobą (identyfikator konta/profilu) | `supabase/migrations/0101_email_consent_campaigns.sql` |
| `status` | Dane techniczne (IP, User-Agent, identyfikatory urządzeń, dzienniki) | `supabase/migrations/0101_email_consent_campaigns.sql` |
| `reason` | Dane techniczne (IP, User-Agent, identyfikatory urządzeń, dzienniki) | `supabase/migrations/0101_email_consent_campaigns.sql` |
| `reserved_at` | Dane techniczne (IP, User-Agent, identyfikatory urządzeń, dzienniki) | `supabase/migrations/0101_email_consent_campaigns.sql` |

### `public.email_consent_events`

- **Migracja:** `supabase/migrations/0101_email_consent_campaigns.sql`
- **Czynności:** E-maile i powiadomienia, Zgody cookies i akceptacja dokumentów
- **Osoby:** Kandydaci (konto), Pracodawcy i członkowie firm
- **Uwaga:** Niezmienny dowód każdej zmiany zgody e-mail (0101), zapisywany triggerem na notification_preferences.

| Kolumna | Kategoria | Wprowadzona w |
|---|---|---|
| `profile_id` | Powiązanie z osobą (identyfikator konta/profilu) | `supabase/migrations/0101_email_consent_campaigns.sql` |
| `category` | Dowody zgód i akceptacji dokumentów | `supabase/migrations/0101_email_consent_campaigns.sql` |
| `granted` | Dowody zgód i akceptacji dokumentów | `supabase/migrations/0101_email_consent_campaigns.sql` |
| `source` | Dowody zgód i akceptacji dokumentów | `supabase/migrations/0101_email_consent_campaigns.sql` |
| `locale` | Preferencje i ustawienia (język, powiadomienia, wyszukiwania, blokady) | `supabase/migrations/0101_email_consent_campaigns.sql` |
| `wording_version` | Dowody zgód i akceptacji dokumentów | `supabase/migrations/0101_email_consent_campaigns.sql` |
| `created_at` | Dowody zgód i akceptacji dokumentów | `supabase/migrations/0101_email_consent_campaigns.sql` |

### `public.email_deliveries`

- **Migracja:** `supabase/migrations/0006_messaging.sql`
- **Czynności:** E-maile i powiadomienia
- **Osoby:** Kandydaci (konto), Aplikujący bez konta, Pracodawcy i członkowie firm, Zgłaszający treści (z kontem lub bez), Osoby zaproszone do zespołu firmy
- **Uwaga:** Pola payloadu dla każdego szablonu — sekcja „Treść e-maili” (generowana z migracji).

| Kolumna | Kategoria | Wprowadzona w |
|---|---|---|
| `profile_id` | Powiązanie z osobą (identyfikator konta/profilu) | `supabase/migrations/0006_messaging.sql` |
| `to_email` | Dane kontaktowe (e-mail, telefon) | `supabase/migrations/0006_messaging.sql` |
| `locale` | Preferencje i ustawienia (język, powiadomienia, wyszukiwania, blokady) | `supabase/migrations/0006_messaging.sql` |
| `subject` | Korespondencja i treści swobodne | `supabase/migrations/0006_messaging.sql` |
| `payload` | Korespondencja i treści swobodne | `supabase/migrations/0012_rpc_flows.sql` |
| `status` | Dane techniczne (IP, User-Agent, identyfikatory urządzeń, dzienniki) | `supabase/migrations/0006_messaging.sql` |
| `error_message` | Dane techniczne (IP, User-Agent, identyfikatory urządzeń, dzienniki) | `supabase/migrations/0006_messaging.sql` |
| `provider_message_id` | Dane techniczne (IP, User-Agent, identyfikatory urządzeń, dzienniki) | `supabase/migrations/0006_messaging.sql` |
| `bounce_type` | Dane techniczne (IP, User-Agent, identyfikatory urządzeń, dzienniki) | `supabase/migrations/0098_email_delivery_events.sql` |

### `public.email_recipient_windows`

- **Migracja:** `supabase/migrations/0101_email_consent_campaigns.sql`
- **Czynności:** E-maile i powiadomienia
- **Osoby:** Kandydaci (konto), Pracodawcy i członkowie firm
- **Uwaga:** Licznik budżetu wysyłki na odbiorcę (0101).

| Kolumna | Kategoria | Wprowadzona w |
|---|---|---|
| `profile_id` | Powiązanie z osobą (identyfikator konta/profilu) | `supabase/migrations/0101_email_consent_campaigns.sql` |
| `used` | Dane techniczne (IP, User-Agent, identyfikatory urządzeń, dzienniki) | `supabase/migrations/0101_email_consent_campaigns.sql` |
| `window_start` | Dane techniczne (IP, User-Agent, identyfikatory urządzeń, dzienniki) | `supabase/migrations/0101_email_consent_campaigns.sql` |

### `public.email_suppressions`

- **Migracja:** `supabase/migrations/0098_email_delivery_events.sql`
- **Czynności:** E-maile i powiadomienia
- **Osoby:** Kandydaci (konto), Aplikujący bez konta, Pracodawcy i członkowie firm, Zgłaszający treści (z kontem lub bez), Osoby zaproszone do zespołu firmy

| Kolumna | Kategoria | Wprowadzona w |
|---|---|---|
| `email` | Dane kontaktowe (e-mail, telefon) | `supabase/migrations/0098_email_delivery_events.sql` |
| `reason` | Dane techniczne (IP, User-Agent, identyfikatory urządzeń, dzienniki) | `supabase/migrations/0098_email_delivery_events.sql` |
| `lifted_by` | Powiązanie z osobą (identyfikator konta/profilu) | `supabase/migrations/0098_email_delivery_events.sql` |
| `lift_reason` | Zgłoszenia treści i decyzje moderacyjne | `supabase/migrations/0098_email_delivery_events.sql` |

### `public.employer_profiles`

- **Migracja:** `supabase/migrations/0002_core_tables.sql`
- **Czynności:** Konta firm, zespół i weryfikacja
- **Osoby:** Pracodawcy i członkowie firm

| Kolumna | Kategoria | Wprowadzona w |
|---|---|---|
| `profile_id` | Powiązanie z osobą (identyfikator konta/profilu) | `supabase/migrations/0002_core_tables.sql` |
| `job_title` | Profil zawodowy (doświadczenie, umiejętności, języki, certyfikaty, dostępność, lokalizacja) | `supabase/migrations/0002_core_tables.sql` |
| `phone` | Dane kontaktowe (e-mail, telefon) | `supabase/migrations/0002_core_tables.sql` |

### `public.erasure_tombstones`

- **Migracja:** `supabase/migrations/0105_data_retention_rights.sql`
- **Czynności:** Prawa osób i retencja, Kopie zapasowe bazy
- **Osoby:** Kandydaci (konto)
- **Uwaga:** Tylko UUID usuniętej osoby — do ponownego usunięcia po odtworzeniu kopii.

| Kolumna | Kategoria | Wprowadzona w |
|---|---|---|
| `subject_id` | Powiązanie z osobą (identyfikator konta/profilu) | `supabase/migrations/0105_data_retention_rights.sql` |

### `public.files`

- **Migracja:** `supabase/migrations/0007_misc.sql`
- **Czynności:** Pliki CV, Kontakt pracodawca–kandydat
- **Osoby:** Kandydaci (konto), Pracodawcy i członkowie firm
- **Uwaga:** Treść pliku leży w prywatnym buckecie Railway, w tabeli są metadane. entity_type: candidate_cv (CV) albo message_attachment (załącznik rozmowy, entity_id = rozmowa).

| Kolumna | Kategoria | Wprowadzona w |
|---|---|---|
| `owner_id` | Powiązanie z osobą (identyfikator konta/profilu) | `supabase/migrations/0007_misc.sql` |
| `bucket` | Pliki (CV) i ich metadane | `supabase/migrations/0007_misc.sql` |
| `path` | Pliki (CV) i ich metadane | `supabase/migrations/0007_misc.sql` |
| `file_name` | Pliki (CV) i ich metadane | `supabase/migrations/0007_misc.sql` |
| `mime_type` | Pliki (CV) i ich metadane | `supabase/migrations/0007_misc.sql` |
| `size_bytes` | Pliki (CV) i ich metadane | `supabase/migrations/0007_misc.sql` |
| `checksum_sha256` | Pliki (CV) i ich metadane | `database/auth/0060_file_checksum.sql` |
| `scan_status` | Pliki (CV) i ich metadane | `supabase/migrations/0044_file_scan_status.sql` |

### `public.guest_application_requests`

- **Migracja:** `supabase/migrations/0095_guest_applications.sql`
- **Czynności:** Aplikacja bez konta
- **Osoby:** Aplikujący bez konta

| Kolumna | Kategoria | Wprowadzona w |
|---|---|---|
| `email` | Dane kontaktowe (e-mail, telefon) | `supabase/migrations/0095_guest_applications.sql` |
| `full_name` | Identyfikacja (imię, nazwisko, zdjęcie, rola) | `supabase/migrations/0095_guest_applications.sql` |
| `phone` | Dane kontaktowe (e-mail, telefon) | `supabase/migrations/0095_guest_applications.sql` |
| `availability` | Profil zawodowy (doświadczenie, umiejętności, języki, certyfikaty, dostępność, lokalizacja) | `supabase/migrations/0095_guest_applications.sql` |
| `message` | Korespondencja i treści swobodne | `supabase/migrations/0095_guest_applications.sql` |
| `screening_answers` | Proces rekrutacyjny (statusy, dopasowanie, odpowiedzi screeningowe) | `supabase/migrations/0095_guest_applications.sql` |
| `locale` | Preferencje i ustawienia (język, powiadomienia, wyszukiwania, blokady) | `supabase/migrations/0095_guest_applications.sql` |
| `confirm_token_hash` | Uwierzytelnianie (skrót hasła, tokeny, sesje, kody) | `supabase/migrations/0095_guest_applications.sql` |
| `confirm_nonce` | Uwierzytelnianie (skrót hasła, tokeny, sesje, kody) | `supabase/migrations/0095_guest_applications.sql` |
| `claim_token_hash` | Uwierzytelnianie (skrót hasła, tokeny, sesje, kody) | `supabase/migrations/0095_guest_applications.sql` |
| `claim_nonce` | Uwierzytelnianie (skrót hasła, tokeny, sesje, kody) | `supabase/migrations/0095_guest_applications.sql` |
| `claimed_by` | Powiązanie z osobą (identyfikator konta/profilu) | `supabase/migrations/0095_guest_applications.sql` |
| `consent_document_version` | Dowody zgód i akceptacji dokumentów | `supabase/migrations/0095_guest_applications.sql` |
| `consent_accepted_at` | Dowody zgód i akceptacji dokumentów | `supabase/migrations/0095_guest_applications.sql` |
| `consent_ip` | Dane techniczne (IP, User-Agent, identyfikatory urządzeń, dzienniki) | `supabase/migrations/0095_guest_applications.sql` |
| `consent_user_agent` | Dane techniczne (IP, User-Agent, identyfikatory urządzeń, dzienniki) | `supabase/migrations/0095_guest_applications.sql` |
| `age_attested_min` | Identyfikacja (imię, nazwisko, zdjęcie, rola) | `supabase/migrations/0126_candidate_age_policy.sql` |
| `age_attested_at` | Identyfikacja (imię, nazwisko, zdjęcie, rola) | `supabase/migrations/0126_candidate_age_policy.sql` |

### `public.jobs`

- **Migracja:** `supabase/migrations/0003_jobs.sql`
- **Czynności:** Konta firm, zespół i weryfikacja
- **Osoby:** Pracodawcy i członkowie firm
- **Uwaga:** Treść oferty to dane firmy; kontaktowy e-mail i autor mogą identyfikować rekrutera.

| Kolumna | Kategoria | Wprowadzona w |
|---|---|---|
| `created_by` | Powiązanie z osobą (identyfikator konta/profilu) | `supabase/migrations/0003_jobs.sql` |
| `contact_email` | Dane kontaktowe (e-mail, telefon) | `supabase/migrations/0003_jobs.sql` |
| `address` | Dane firmy mogące identyfikować osobę (np. jednoosobowa działalność) | `supabase/migrations/0003_jobs.sql` |

### `public.matches`

- **Migracja:** `supabase/migrations/0005_processes.sql`
- **Czynności:** Dopasowanie i zapisane wyszukiwania
- **Osoby:** Kandydaci (konto)

| Kolumna | Kategoria | Wprowadzona w |
|---|---|---|
| `candidate_id` | Powiązanie z osobą (identyfikator konta/profilu) | `supabase/migrations/0005_processes.sql` |
| `score` | Proces rekrutacyjny (statusy, dopasowanie, odpowiedzi screeningowe) | `supabase/migrations/0005_processes.sql` |
| `matched` | Proces rekrutacyjny (statusy, dopasowanie, odpowiedzi screeningowe) | `supabase/migrations/0005_processes.sql` |
| `missing` | Proces rekrutacyjny (statusy, dopasowanie, odpowiedzi screeningowe) | `supabase/migrations/0005_processes.sql` |
| `strengths` | Proces rekrutacyjny (statusy, dopasowanie, odpowiedzi screeningowe) | `supabase/migrations/0005_processes.sql` |
| `mandatory_met` | Proces rekrutacyjny (statusy, dopasowanie, odpowiedzi screeningowe) | `supabase/migrations/0005_processes.sql` |

### `public.message_attachments`

- **Migracja:** `supabase/migrations/0119_message_attachments.sql`
- **Czynności:** Kontakt pracodawca–kandydat
- **Osoby:** Kandydaci (konto), Pracodawcy i członkowie firm
- **Uwaga:** Powiązanie pliku (public.files) z rozmową i wiadomością; treść i nazwa pliku w public.files/buckecie.

| Kolumna | Kategoria | Wprowadzona w |
|---|---|---|
| `uploader_id` | Powiązanie z osobą (identyfikator konta/profilu) | `supabase/migrations/0119_message_attachments.sql` |
| `file_id` | Powiązanie z osobą (identyfikator konta/profilu) | `supabase/migrations/0119_message_attachments.sql` |
| `message_id` | Powiązanie z osobą (identyfikator konta/profilu) | `supabase/migrations/0119_message_attachments.sql` |
| `client_upload_id` | nie dotyczy: Losowy klucz idempotencji uploadu. | — |
| `position` | nie dotyczy: Kolejność pliku w wiadomości. | — |
| `linked_at` | nie dotyczy: Czas wysłania z wiadomością. | — |

### `public.messages`

- **Migracja:** `supabase/migrations/0006_messaging.sql`
- **Czynności:** Kontakt pracodawca–kandydat
- **Osoby:** Kandydaci (konto), Pracodawcy i członkowie firm

| Kolumna | Kategoria | Wprowadzona w |
|---|---|---|
| `sender_id` | Powiązanie z osobą (identyfikator konta/profilu) | `supabase/migrations/0006_messaging.sql` |
| `body` | Korespondencja i treści swobodne | `supabase/migrations/0006_messaging.sql` |
| `read_at` | Dane techniczne (IP, User-Agent, identyfikatory urządzeń, dzienniki) | `supabase/migrations/0006_messaging.sql` |

### `public.moderation_appeals`

- **Migracja:** `supabase/migrations/0104_dsa_appeals.sql`
- **Czynności:** Zgłoszenia treści (DSA) i moderacja
- **Osoby:** Pracodawcy i członkowie firm, Zgłaszający treści (z kontem lub bez), Administratorzy portalu
- **Uwaga:** Uzasadnienia odwołania i rozpatrzenia są anonimizowane przez dsa_retention_run po końcu drogi odwołania i okresie retencji (#43).

| Kolumna | Kategoria | Wprowadzona w |
|---|---|---|
| `appellant_id` | Powiązanie z osobą (identyfikator konta/profilu) | `supabase/migrations/0104_dsa_appeals.sql` |
| `appellant_locale` | Preferencje i ustawienia (język, powiadomienia, wyszukiwania, blokady) | `supabase/migrations/0104_dsa_appeals.sql` |
| `grounds` | Korespondencja i treści swobodne | `supabase/migrations/0104_dsa_appeals.sql` |
| `outcome_reasoning` | Zgłoszenia treści i decyzje moderacyjne | `supabase/migrations/0104_dsa_appeals.sql` |
| `decided_by` | Powiązanie z osobą (identyfikator konta/profilu) | `supabase/migrations/0104_dsa_appeals.sql` |

### `public.moderation_decisions`

- **Migracja:** `supabase/migrations/0099_dsa_moderation.sql`
- **Czynności:** Zgłoszenia treści (DSA) i moderacja
- **Osoby:** Pracodawcy i członkowie firm, Administratorzy portalu

| Kolumna | Kategoria | Wprowadzona w |
|---|---|---|
| `facts` | Zgłoszenia treści i decyzje moderacyjne | `supabase/migrations/0099_dsa_moderation.sql` |
| `ground_reference` | Zgłoszenia treści i decyzje moderacyjne | `supabase/migrations/0099_dsa_moderation.sql` |
| `decided_by` | Powiązanie z osobą (identyfikator konta/profilu) | `supabase/migrations/0099_dsa_moderation.sql` |

### `public.moderation_restorations`

- **Migracja:** `supabase/migrations/0099_dsa_moderation.sql`
- **Czynności:** Zgłoszenia treści (DSA) i moderacja
- **Osoby:** Pracodawcy i członkowie firm, Administratorzy portalu

| Kolumna | Kategoria | Wprowadzona w |
|---|---|---|
| `reason` | Zgłoszenia treści i decyzje moderacyjne | `supabase/migrations/0099_dsa_moderation.sql` |
| `restored_by` | Powiązanie z osobą (identyfikator konta/profilu) | `supabase/migrations/0099_dsa_moderation.sql` |

### `public.notification_preferences`

- **Migracja:** `supabase/migrations/0006_messaging.sql`
- **Czynności:** E-maile i powiadomienia
- **Osoby:** Kandydaci (konto), Pracodawcy i członkowie firm

| Kolumna | Kategoria | Wprowadzona w |
|---|---|---|
| `profile_id` | Powiązanie z osobą (identyfikator konta/profilu) | `supabase/migrations/0006_messaging.sql` |
| `email_applications` | Preferencje i ustawienia (język, powiadomienia, wyszukiwania, blokady) | `supabase/migrations/0006_messaging.sql` |
| `email_offers` | Preferencje i ustawienia (język, powiadomienia, wyszukiwania, blokady) | `supabase/migrations/0006_messaging.sql` |
| `email_messages` | Preferencje i ustawienia (język, powiadomienia, wyszukiwania, blokady) | `supabase/migrations/0006_messaging.sql` |
| `email_job_matches` | Preferencje i ustawienia (język, powiadomienia, wyszukiwania, blokady) | `supabase/migrations/0006_messaging.sql` |
| `email_marketing` | Preferencje i ustawienia (język, powiadomienia, wyszukiwania, blokady) | `supabase/migrations/0006_messaging.sql` |
| `push_enabled` | Preferencje i ustawienia (język, powiadomienia, wyszukiwania, blokady) | `supabase/migrations/0006_messaging.sql` |
| `in_app_enabled` | Preferencje i ustawienia (język, powiadomienia, wyszukiwania, blokady) | `supabase/migrations/0006_messaging.sql` |

### `public.notifications`

- **Migracja:** `supabase/migrations/0006_messaging.sql`
- **Czynności:** E-maile i powiadomienia
- **Osoby:** Kandydaci (konto), Pracodawcy i członkowie firm

| Kolumna | Kategoria | Wprowadzona w |
|---|---|---|
| `profile_id` | Powiązanie z osobą (identyfikator konta/profilu) | `supabase/migrations/0006_messaging.sql` |
| `title` | Korespondencja i treści swobodne | `supabase/migrations/0006_messaging.sql` |
| `body` | Korespondencja i treści swobodne | `supabase/migrations/0006_messaging.sql` |
| `data` | Korespondencja i treści swobodne | `supabase/migrations/0006_messaging.sql` |
| `read_at` | Dane techniczne (IP, User-Agent, identyfikatory urządzeń, dzienniki) | `supabase/migrations/0006_messaging.sql` |

### `public.offer_status_history`

- **Migracja:** `supabase/migrations/0005_processes.sql`
- **Czynności:** Kontakt pracodawca–kandydat
- **Osoby:** Kandydaci (konto), Pracodawcy i członkowie firm

| Kolumna | Kategoria | Wprowadzona w |
|---|---|---|
| `from_status` | Proces rekrutacyjny (statusy, dopasowanie, odpowiedzi screeningowe) | `supabase/migrations/0005_processes.sql` |
| `to_status` | Proces rekrutacyjny (statusy, dopasowanie, odpowiedzi screeningowe) | `supabase/migrations/0005_processes.sql` |
| `changed_by` | Powiązanie z osobą (identyfikator konta/profilu) | `supabase/migrations/0005_processes.sql` |
| `note` | Korespondencja i treści swobodne | `supabase/migrations/0005_processes.sql` |

### `public.offers`

- **Migracja:** `supabase/migrations/0005_processes.sql`
- **Czynności:** Kontakt pracodawca–kandydat
- **Osoby:** Kandydaci (konto), Pracodawcy i członkowie firm

| Kolumna | Kategoria | Wprowadzona w |
|---|---|---|
| `candidate_id` | Powiązanie z osobą (identyfikator konta/profilu) | `supabase/migrations/0005_processes.sql` |
| `sender_id` | Powiązanie z osobą (identyfikator konta/profilu) | `supabase/migrations/0005_processes.sql` |
| `status` | Proces rekrutacyjny (statusy, dopasowanie, odpowiedzi screeningowe) | `supabase/migrations/0005_processes.sql` |
| `message` | Korespondencja i treści swobodne | `supabase/migrations/0005_processes.sql` |
| `locale` | Preferencje i ustawienia (język, powiadomienia, wyszukiwania, blokady) | `supabase/migrations/0005_processes.sql` |

### `public.profiles`

- **Migracja:** `supabase/migrations/0002_core_tables.sql`
- **Czynności:** Konto i uwierzytelnianie
- **Osoby:** Kandydaci (konto), Pracodawcy i członkowie firm, Administratorzy portalu

| Kolumna | Kategoria | Wprowadzona w |
|---|---|---|
| `role` | Identyfikacja (imię, nazwisko, zdjęcie, rola) | `supabase/migrations/0002_core_tables.sql` |
| `email` | Dane kontaktowe (e-mail, telefon) | `supabase/migrations/0002_core_tables.sql` |
| `first_name` | Identyfikacja (imię, nazwisko, zdjęcie, rola) | `supabase/migrations/0002_core_tables.sql` |
| `last_name` | Identyfikacja (imię, nazwisko, zdjęcie, rola) | `supabase/migrations/0002_core_tables.sql` |
| `phone` | Dane kontaktowe (e-mail, telefon) | `supabase/migrations/0002_core_tables.sql` |
| `avatar_url` | Identyfikacja (imię, nazwisko, zdjęcie, rola) | `supabase/migrations/0002_core_tables.sql` |
| `preferred_locale` | Preferencje i ustawienia (język, powiadomienia, wyszukiwania, blokady) | `supabase/migrations/0002_core_tables.sql` |
| `account_locale` | Preferencje i ustawienia (język, powiadomienia, wyszukiwania, blokady) | `supabase/migrations/0002_core_tables.sql` |
| `signup_locale` | Preferencje i ustawienia (język, powiadomienia, wyszukiwania, blokady) | `supabase/migrations/0002_core_tables.sql` |
| `last_seen_at` | Dane techniczne (IP, User-Agent, identyfikatory urządzeń, dzienniki) | `supabase/migrations/0002_core_tables.sql` |

### `public.rate_limits`

- **Migracja:** `supabase/migrations/0015_rate_limiting.sql`
- **Czynności:** Bezpieczeństwo, audyt i limity
- **Osoby:** Kandydaci (konto), Pracodawcy i członkowie firm, Odwiedzający (bez konta)
- **Uwaga:** Klucz = akcja + adres IP (+ identyfikator) bez haszowania (src/lib/rate-limit.ts, pula service); wariant HMAC src/lib/db/rate-limit.ts niepodłączony.

| Kolumna | Kategoria | Wprowadzona w |
|---|---|---|
| `key` | Dane techniczne (IP, User-Agent, identyfikatory urządzeń, dzienniki) | `supabase/migrations/0015_rate_limiting.sql` |

### `public.report_events`

- **Migracja:** `supabase/migrations/0094_dsa_notices.sql`
- **Czynności:** Zgłoszenia treści (DSA) i moderacja
- **Osoby:** Zgłaszający treści (z kontem lub bez), Administratorzy portalu

| Kolumna | Kategoria | Wprowadzona w |
|---|---|---|
| `actor_id` | Powiązanie z osobą (identyfikator konta/profilu) | `supabase/migrations/0094_dsa_notices.sql` |

### `public.reports`

- **Migracja:** `supabase/migrations/0007_misc.sql`
- **Czynności:** Zgłoszenia treści (DSA) i moderacja
- **Osoby:** Zgłaszający treści (z kontem lub bez), Pracodawcy i członkowie firm, Kandydaci (konto)

| Kolumna | Kategoria | Wprowadzona w |
|---|---|---|
| `conversation_id` | Powiązanie z osobą (identyfikator konta/profilu) | `supabase/migrations/0116_message_reports.sql` |
| `reporter_id` | Powiązanie z osobą (identyfikator konta/profilu) | `supabase/migrations/0007_misc.sql` |
| `reason` | Zgłoszenia treści i decyzje moderacyjne | `supabase/migrations/0007_misc.sql` |
| `details` | Korespondencja i treści swobodne | `supabase/migrations/0007_misc.sql` |
| `resolved_by` | Powiązanie z osobą (identyfikator konta/profilu) | `supabase/migrations/0007_misc.sql` |
| `access_code_hash` | Uwierzytelnianie (skrót hasła, tokeny, sesje, kody) | `supabase/migrations/0094_dsa_notices.sql` |
| `content_url` | Zgłoszenia treści i decyzje moderacyjne | `supabase/migrations/0094_dsa_notices.sql` |
| `reporter_name` | Identyfikacja (imię, nazwisko, zdjęcie, rola) | `supabase/migrations/0094_dsa_notices.sql` |
| `reporter_email` | Dane kontaktowe (e-mail, telefon) | `supabase/migrations/0094_dsa_notices.sql` |
| `reporter_locale` | Preferencje i ustawienia (język, powiadomienia, wyszukiwania, blokady) | `supabase/migrations/0094_dsa_notices.sql` |
| `good_faith_at` | Dowody zgód i akceptacji dokumentów | `supabase/migrations/0094_dsa_notices.sql` |
| `target_snapshot` | Korespondencja i treści swobodne | `supabase/migrations/0094_dsa_notices.sql` |

### `public.retention_policies`

- **Migracja:** `supabase/migrations/0105_data_retention_rights.sql`
- **Czynności:** Prawa osób i retencja
- **Osoby:** Administratorzy portalu
- **Uwaga:** Konfiguracja okresów retencji; jedyną daną osobową jest identyfikator admina, który zmienił okres.

| Kolumna | Kategoria | Wprowadzona w |
|---|---|---|
| `updated_by` | Powiązanie z osobą (identyfikator konta/profilu) | `supabase/migrations/0105_data_retention_rights.sql` |

### `public.retention_warnings`

- **Migracja:** `supabase/migrations/0127_retention_values.sql`
- **Czynności:** Prawa osób i retencja, Konto i uwierzytelnianie, Pliki CV
- **Osoby:** Kandydaci (konto)
- **Uwaga:** Ostrzeżenie przed usunięciem z powodu braku aktywności (#574): aktywność, czas ostrzeżenia i termin; znika z kontem.

| Kolumna | Kategoria | Wprowadzona w |
|---|---|---|
| `profile_id` | Powiązanie z osobą (identyfikator konta/profilu) | `supabase/migrations/0127_retention_values.sql` |
| `policy_key` | nie dotyczy: Kategoria retencji. | — |

### `public.saved_jobs`

- **Migracja:** `supabase/migrations/0004_candidate_relations.sql`
- **Czynności:** Profil zawodowy kandydata
- **Osoby:** Kandydaci (konto)

| Kolumna | Kategoria | Wprowadzona w |
|---|---|---|
| `candidate_id` | Powiązanie z osobą (identyfikator konta/profilu) | `supabase/migrations/0004_candidate_relations.sql` |
| `job_id` | Preferencje i ustawienia (język, powiadomienia, wyszukiwania, blokady) | `supabase/migrations/0004_candidate_relations.sql` |

### `public.saved_search_alerts`

- **Migracja:** `supabase/migrations/0092_saved_search_alerts.sql`
- **Czynności:** Dopasowanie i zapisane wyszukiwania, E-maile i powiadomienia
- **Osoby:** Kandydaci (konto)

| Kolumna | Kategoria | Wprowadzona w |
|---|---|---|
| `profile_id` | Powiązanie z osobą (identyfikator konta/profilu) | `supabase/migrations/0092_saved_search_alerts.sql` |
| `job_id` | Preferencje i ustawienia (język, powiadomienia, wyszukiwania, blokady) | `supabase/migrations/0092_saved_search_alerts.sql` |

### `public.saved_searches`

- **Migracja:** `supabase/migrations/0092_saved_search_alerts.sql`
- **Czynności:** Dopasowanie i zapisane wyszukiwania
- **Osoby:** Kandydaci (konto)

| Kolumna | Kategoria | Wprowadzona w |
|---|---|---|
| `profile_id` | Powiązanie z osobą (identyfikator konta/profilu) | `supabase/migrations/0092_saved_search_alerts.sql` |
| `name` | Preferencje i ustawienia (język, powiadomienia, wyszukiwania, blokady) | `supabase/migrations/0092_saved_search_alerts.sql` |
| `filters` | Preferencje i ustawienia (język, powiadomienia, wyszukiwania, blokady) | `supabase/migrations/0092_saved_search_alerts.sql` |
| `query` | Preferencje i ustawienia (język, powiadomienia, wyszukiwania, blokady) | `supabase/migrations/0092_saved_search_alerts.sql` |
| `locale` | Preferencje i ustawienia (język, powiadomienia, wyszukiwania, blokady) | `supabase/migrations/0092_saved_search_alerts.sql` |
| `filters_hash` | nie dotyczy: Skrót filtrów do deduplikacji wyszukiwań — nie identyfikuje osoby poza wierszem. | — |

### `public.screening_question_reviews`

- **Migracja:** `supabase/migrations/0103_screening_question_review.sql`
- **Czynności:** Konta firm, zespół i weryfikacja
- **Osoby:** Pracodawcy i członkowie firm, Administratorzy portalu
- **Uwaga:** Przegląd pytania oznaczonego przez detektor (#497, 0103): kopia treści pytania firmy, kto zapisał pytanie i kto zdecydował, uzasadnienie admina. Bez odpowiedzi kandydatów.

| Kolumna | Kategoria | Wprowadzona w |
|---|---|---|
| `requested_by` | Powiązanie z osobą (identyfikator konta/profilu) | `supabase/migrations/0103_screening_question_review.sql` |
| `decided_by` | Powiązanie z osobą (identyfikator konta/profilu) | `supabase/migrations/0103_screening_question_review.sql` |
| `decision_reason` | Zgłoszenia treści i decyzje moderacyjne | `supabase/migrations/0103_screening_question_review.sql` |

### `public.storage_deletion_queue`

- **Migracja:** `supabase/migrations/0105_data_retention_rights.sql`
- **Czynności:** Prawa osób i retencja, Pliki CV
- **Osoby:** Kandydaci (konto)
- **Uwaga:** Klucz obiektu do usunięcia (zawiera UUID właściciela); wiersz znika po usunięciu obiektu.

| Kolumna | Kategoria | Wprowadzona w |
|---|---|---|
| `path` | Pliki (CV) i ich metadane | `supabase/migrations/0105_data_retention_rights.sql` |
| `bucket` | nie dotyczy: Nazwa bucketa. | — |

### `public.storage_gc_sweeps`

- **Migracja:** `supabase/migrations/0117_storage_gc.sql`
- **Czynności:** Pliki CV
- **Osoby:** Kandydaci (konto)
- **Uwaga:** Przebieg GC bucketu CV (#17): same liczniki; kursor = ostatni sprawdzony klucz (UUID właściciela), czyszczony po zakończeniu przebiegu, historia 90 dni.

| Kolumna | Kategoria | Wprowadzona w |
|---|---|---|
| `cursor_key` | Pliki (CV) i ich metadane | `supabase/migrations/0117_storage_gc.sql` |
| `bucket` | nie dotyczy: Nazwa bucketa. | — |
| `dry_run` | nie dotyczy: Tryb przebiegu GC. | — |
| `locked_until` | nie dotyczy: Dzierżawa przebiegu. | — |
| `pages` | nie dotyczy: Licznik stron. | — |
| `objects_scanned` | nie dotyczy: Licznik obiektów. | — |
| `orphan_objects` | nie dotyczy: Licznik sierot. | — |
| `orphan_queued` | nie dotyczy: Licznik sierot w kolejce. | — |
| `missing_objects` | nie dotyczy: Licznik wierszy bez obiektu. | — |
| `started_at` | nie dotyczy: Czas startu przebiegu. | — |
| `finished_at` | nie dotyczy: Czas końca przebiegu. | — |

### `public.system_events`

- **Migracja:** `supabase/migrations/0007_misc.sql`
- **Czynności:** Bezpieczeństwo, audyt i limity
- **Osoby:** —
- **Uwaga:** Zdarzenia techniczne; context (jsonb) nie ma schematu — zawartość zależy od wywołującego.

| Kolumna | Kategoria | Wprowadzona w |
|---|---|---|
| `message` | Dane techniczne (IP, User-Agent, identyfikatory urządzeń, dzienniki) | `supabase/migrations/0007_misc.sql` |
| `context` | Dane techniczne (IP, User-Agent, identyfikatory urządzeń, dzienniki) | `supabase/migrations/0007_misc.sql` |

## 4. Treść e-maili (payload kolejki → dostawca poczty)

Klucze z `jsonb_build_object` w aktualnych definicjach funkcji SQL. Worker dokłada imię odbiorcy
z `profiles`, link do panelu i stopkę wypisania (`src/lib/email/delivery-data.ts`,
`src/lib/email/guest-delivery.ts`). E-maile konta (`src/lib/email/auth-email.ts`):
`accountConfirmation`, `passwordReset` — zawierają link z tokenem.

Minimalizacja (#503): do szablonu — a więc do dostawcy poczty — trafiają tylko pola z listy
`src/lib/email/payload-fields.ts`; resztę payloadu worker odrzuca przed renderem (zostaje w bazie).
Wiersz dla odbiorcy firmowego wychodzi tylko, gdy przy odbiorze z kolejki nadal ma uprawnienie
(`email_recipient_authorized` w `claim_email_batch`).

| Szablon | Pola payloadu | Odrzucane przez workera | Funkcje SQL |
|---|---|---|---|
| `appealReceived` | `appealReference`, `appealTarget`, `appellantRole`, `caseNumber`, `companyName`, `decisionReference`, `recipientName` | `appealTarget`, `companyName` | `submit_moderation_appeal`, `submit_report_appeal`, `submit_report_restoration_appeal` |
| `appealReversed` | `appealReference`, `appealTarget`, `appellantRole`, `caseNumber`, `companyName`, `decisionReference`, `reasoning`, `recipientName` | `appealTarget`, `companyName` | `admin_decide_appeal` |
| `appealUpheld` | `appealReference`, `appealTarget`, `appellantRole`, `caseNumber`, `companyName`, `decisionReference`, `reasoning`, `recipientName` | `appealTarget`, `companyName` | `admin_decide_appeal` |
| `applicationViewed` | `companyName`, `jobTitle` | — | `transition_application` |
| `breachNotice` | `incidentReference`, `noticeSubject`, `noticeText`, `panel` | — | `admin_notify_breach_subjects` |
| `companyRejected` | `companyName`, `reason` | — | `admin_set_company_status` |
| `companySuspended` | `companyName`, `reason` | — | `admin_set_company_status` |
| `companyVerified` | `companyName`, `reason` | `reason` | `admin_set_company_status` |
| `contactMessageAdmin` | `reference`, `topic` | — | `submit_contact_message` |
| `guestApplicationConfirm` | `companyName`, `jobSlug`, `jobTitle`, `nonce`, `recipientName` | `jobSlug`, `nonce` | `submit_guest_application_core` |
| `guestApplicationSent` | `companyName`, `jobTitle`, `nonce`, `recipientName` | `nonce` | `confirm_guest_application` |
| `guestStatusChanged` | `companyName`, `jobTitle`, `recipientName`, `status` | — | `transition_application` |
| `inactiveAccountWarning` | `deletionDate` | — | `retention_purge_batch` |
| `inactiveCvWarning` | `deletionDate` | — | `retention_purge_batch` |
| `jobMatch` | `count`, `jobs`, `query`, `searchName` | `query` | `process_saved_search_alerts` |
| `jobOffer` | `companyName`, `currency`, `expiresAt`, `jobTitle`, `salaryMax`, `salaryMin`, `salaryPeriod` | — | `send_offer` |
| `jobPublished` | `jobTitle` | — | `publish_job` |
| `moderationCompanySuspended` | `automatedDetection`, `companyName`, `decisionReference`, `facts`, `groundReference`, `groundType`, `jobTitle` | `jobTitle` | `admin_decide_appeal`, `admin_decide_report` |
| `moderationJobRemoved` | `automatedDetection`, `companyName`, `decisionReference`, `facts`, `groundReference`, `groundType`, `jobTitle` | — | `admin_decide_appeal`, `admin_decide_report` |
| `moderationRestored` | `companyName`, `decisionReference`, `jobTitle`, `reason` | — | `moderation_restore_core` |
| `newApplication` | `candidateName`, `jobTitle` | — | `apply_to_job`, `confirm_guest_application` |
| `newMessage` | `conversationId`, `panel`, `senderName` | — | `send_message` |
| `offerAccepted` | `candidateName`, `jobTitle` | — | `respond_to_offer` |
| `offerDeclined` | `candidateName`, `jobTitle` | — | `respond_to_offer` |
| `reportDecisionActioned` | `caseNumber`, `recipientName`, `targetType` | — | `admin_decide_report` |
| `reportDecisionNoAction` | `caseNumber`, `recipientName`, `targetType` | — | `admin_decide_report` |
| `reportReceived` | `accessCode`, `caseNumber`, `recipientName`, `targetType` | — | `submit_content_report` |
| `reportRestored` | `caseNumber`, `recipientName` | — | `admin_restore_moderation` |
| `statusChanged` | `companyName`, `jobTitle`, `status` | — | `transition_application` |
| `supportContact` | `recipientName`, `reference`, `topic` | — | `submit_contact_message` |
| `teamInvitation` | `companyName`, `inviterName`, `panel` | — | `invite_company_member` |
| `teamInvitationSignup` | `companyName`, `inviterName`, `nonce` | `nonce` | `invite_company_member` |

## 5. Tabele bez danych osobowych

| Tabela | Uzasadnienie |
|---|---|
| `public.ai_budget_limits` | Słownik/konfiguracja (globalne limity kosztów AI, #36) — bez danych osobowych. |
| `public.ai_usage_ledger` | Liczniki wywołań modeli AI (funkcja, model, wynik, tokeny, koszt, doba) — bez treści i identyfikatorów osób/firm (#36). |
| `public.categories` | Słownik/konfiguracja (kategorie) — bez danych osobowych. |
| `public.certificates` | Słownik/konfiguracja (certyfikaty) — bez danych osobowych. |
| `public.checkout_intents` | Martwy schemat billingu. |
| `public.consent_versions` | Słownik/konfiguracja (wersje dokumentów zgód) — bez danych osobowych. |
| `public.discount_codes` | Słownik/konfiguracja (kody rabatowe) — bez danych osobowych. |
| `public.discount_redemptions` | Martwy schemat billingu. |
| `public.dsa_retention_runs` | Wyłącznie liczniki przebiegów retencji (bez danych osobowych). |
| `public.email_campaigns` | Treść i status kampanii (per język) — bez danych odbiorców. |
| `public.email_recipient_budget_config` | Słownik/konfiguracja (limity wysyłki na odbiorcę) — bez danych osobowych. |
| `public.email_send_budget_config` | Słownik/konfiguracja (budżet wysyłki e-mail) — bez danych osobowych. |
| `public.email_send_windows` | Słownik/konfiguracja (liczniki okien wysyłki) — bez danych osobowych. |
| `public.esco_snapshots` | Słownik/konfiguracja (metadane importu ESCO) — bez danych osobowych. |
| `public.invoices` | Martwy schemat billingu. |
| `public.job_certificates` | Treść ogłoszenia (dane firmy). |
| `public.job_funnel_daily` | Liczniki per oferta i dzień — bez IP, cookies i identyfikatora osoby. |
| `public.job_funnel_receipts` | Losowy nonce jednego załadowania strony — nie identyfikuje osoby. |
| `public.job_languages` | Treść ogłoszenia (dane firmy). |
| `public.job_requirements` | Treść ogłoszenia (dane firmy). |
| `public.job_screening_questions` | Treść pytań ustalonych przez firmę; odpowiedzi — application_screening_answers. |
| `public.job_skills` | Treść ogłoszenia (dane firmy). |
| `public.job_translations` | Treść ogłoszenia (dane firmy). |
| `public.languages` | Słownik/konfiguracja (języki) — bez danych osobowych. |
| `public.location_aliases` | Słownik/konfiguracja (nazwy miejscowości PL/NL/FR/EN) — bez danych osobowych. |
| `public.locations` | Słownik/konfiguracja (miejscowości) — bez danych osobowych. |
| `public.occupation_labels` | Słownik/konfiguracja (etykiety zawodów ESCO) — bez danych osobowych. |
| `public.occupation_skills` | Słownik/konfiguracja (relacje ESCO) — bez danych osobowych. |
| `public.occupations` | Słownik/konfiguracja (zawody) — bez danych osobowych. |
| `public.payments` | Martwy schemat billingu. |
| `public.plan_entitlements` | Słownik/konfiguracja (limity planów) — bez danych osobowych. |
| `public.processed_webhooks` | Identyfikatory zdarzeń webhooków do deduplikacji — bez danych osobowych. |
| `public.skill_labels` | Słownik/konfiguracja (etykiety umiejętności ESCO) — bez danych osobowych. |
| `public.skills` | Słownik/konfiguracja (umiejętności) — bez danych osobowych. |
| `public.subscriptions` | Martwy schemat billingu; provider_customer_id identyfikuje firmę u dostawcy płatności. |
| `public.supported_locales` | Słownik/konfiguracja (obsługiwane języki) — bez danych osobowych. |
