/**
 * Rejestr zewnętrznych usług, do których kod portalu wysyła lub może wysyłać dane (#485, #488,
 * #503, #504). Czyste dane, bez importów — czyta je też `scripts/privacy/data-map.mjs`.
 *
 * Zasada: wpisujemy wyłącznie to, co wynika z kodu i konfiguracji repozytorium. Rola prawna,
 * region przetwarzania, podstawa transferu, umowa (DPA) i retencja po stronie dostawcy NIE
 * wynikają z kodu — mają wartość `TO_CONFIRM`, dopóki właściciel/prawnik ich nie ustali
 * (dokumenty w `docs/legal-drafts/`). Nic stąd nie trafia do UI.
 */

export const TO_CONFIRM = 'DO UZUPEŁNIENIA' as const;
type ToConfirm = typeof TO_CONFIRM;

export type ProcessorId =
  | 'railway'
  | 'resend'
  | 'emaillabs'
  | 'discord-webhook'
  | 'cloudflare-turnstile'
  | 'cloudflare-r2'
  | 'openai'
  | 'stripe'
  | 'cloudflare-web-analytics'
  | 'vies';

export interface Processor {
  id: ProcessorId;
  /** Nazwa usługi (bez oceny, która osoba prawna jest stroną umowy). */
  name: string;
  /** Do czego kod portalu używa usługi. */
  purpose: string;
  /** Kategorie danych, które kod przekazuje usłudze (fakty z kodu). */
  dataCategories: string[];
  /** Czyje dane mogą się tam znaleźć. */
  dataSubjects: string[];
  /** Kiedy przepływ jest aktywny — warunek z kodu (zmienne środowiskowe, flagi, zgoda). */
  activation: string;
  /** Pliki, z których wynikają powyższe fakty. */
  codeRefs: string[];
  /** Uwagi techniczne z kodu (np. czego kod świadomie nie wysyła). */
  notes: string[];
  role: ToConfirm;
  region: ToConfirm;
  transferBasis: ToConfirm;
  contract: ToConfirm;
  providerRetention: ToConfirm;
}

const UNKNOWN = {
  role: TO_CONFIRM,
  region: TO_CONFIRM,
  transferBasis: TO_CONFIRM,
  contract: TO_CONFIRM,
  providerRetention: TO_CONFIRM,
} as const;

export const PROCESSORS: readonly Processor[] = [
  {
    id: 'railway',
    name: 'Railway',
    purpose:
      'Hosting aplikacji (usługa production z gałęzi main), baza PostgreSQL, zadania cron wywołujące /api/maintenance i /api/email/process, logi usługi.',
    dataCategories: ['Wszystkie kategorie z tabel bazy (patrz mapa tabel)', 'Logi aplikacji i żądań HTTP'],
    dataSubjects: ['Kandydaci', 'Aplikujący bez konta', 'Pracodawcy i członkowie firm', 'Zgłaszający treści', 'Administratorzy', 'Odwiedzający'],
    activation: 'Produkcja wdrażana na Railway (docs/railway/README.md); połączenia DB przez DATABASE_APP_URL / DATABASE_SERVICE_URL / DATABASE_AUTH_URL / DATABASE_OPS_URL.',
    codeRefs: ['docs/railway/README.md', 'docs/railway/OPERATIONS.md', 'src/lib/db/pool.ts', 'src/lib/db/portal.ts', 'scripts/railway-cron-call.mjs'],
    notes: [
      'Pliki CV w prywatnym buckecie S3 Railway (src/lib/storage/railway-bucket.ts, #26); pobranie tylko krótkim linkiem HMAC przez /api/files/cv.',
      'Limiter (src/lib/rate-limit.ts): przy loginie DATABASE_RATE_LIMIT_URL klucz HMAC akcji i adresu IP; przejściowa ścieżka przez pulę service zapisuje klucz z adresem IP bez haszowania.',
      'Kopie zapasowe: scripts/db/backup.sh szyfruje zrzut kluczem age w usłudze cron Railway (docker/backup/Dockerfile); przechowywane są poza Railwayem w buckecie Cloudflare R2 (#569).',
    ],
    ...UNKNOWN,
  },
  {
    id: 'resend',
    name: 'Resend',
    purpose:
      'Wysyłka e-maili transakcyjnych z kolejki email_deliveries i e-maili konta; odbiór zdarzeń doręczenia (odbicia, skargi) przez webhook.',
    dataCategories: [
      'Adres e-mail odbiorcy',
      'Temat i treść HTML wyrenderowanego szablonu (pola payloadu — patrz sekcja e-maili w mapie)',
      'Nagłówki List-Unsubscribe z tokenem wypisania',
      'Identyfikator wysyłki (idempotency key = id wiersza email_deliveries)',
    ],
    dataSubjects: ['Kandydaci', 'Aplikujący bez konta', 'Pracodawcy i członkowie firm', 'Zgłaszający treści'],
    activation: 'EMAIL_PROVIDER=resend albo brak EMAIL_PROVIDER bez kompletu kluczy EmailLabs, przy RESEND_API_KEY; webhook wymaga RESEND_WEBHOOK_SECRET.',
    codeRefs: ['src/lib/email/transport/resend.ts', 'src/lib/email/outbox.ts', 'src/lib/auth/email-worker.ts', 'src/app/api/email/webhook/resend/route.ts', 'src/emails/wiring.ts'],
    notes: [
      'Wywołanie resend.emails.send przekazuje from, to, subject, html i opcjonalnie nagłówki wypisania; kod nie ustawia opcji śledzenia otwarć/kliknięć — stan tych ustawień na koncie do sprawdzenia.',
      'Payloady kolejki nie zawierają treści wiadomości czatu ani odpowiedzi screeningowych (sekcja e-maili w mapie jest generowana z migracji).',
      'Do szablonu trafiają tylko pola z listy src/lib/email/payload-fields.ts (#503); odbiorca firmowy jest ponownie sprawdzany przy odbiorze z kolejki (email_recipient_authorized).',
    ],
    ...UNKNOWN,
  },
  {
    id: 'emaillabs',
    name: 'EmailLabs',
    purpose:
      'Wysyłka e-maili transakcyjnych z kolejki email_deliveries i e-maili konta (auth.email_outbox), gdy EMAIL_PROVIDER wybiera EmailLabs; odbiór raportów doręczeń (odbicia, opóźnienia) przez webhook.',
    dataCategories: [
      'Adres e-mail odbiorcy',
      'Temat, treść HTML i tekstowa wyrenderowanego szablonu (pola payloadu — patrz sekcja e-maili w mapie)',
      'Nagłówki List-Unsubscribe z tokenem wypisania',
      'Identyfikator wiadomości (messageId = id wiersza kolejki + domena nadawcy)',
      'Linki z tokenem potwierdzenia adresu / resetu hasła w e-mailach konta',
    ],
    dataSubjects: ['Kandydaci', 'Aplikujący bez konta', 'Pracodawcy i członkowie firm', 'Zgłaszający treści'],
    activation:
      'EMAIL_PROVIDER=emaillabs albo brak EMAIL_PROVIDER przy komplecie EMAILLABS_APP_KEY, EMAILLABS_SECRET_KEY, EMAILLABS_SMTP_ACCOUNT; webhook wymaga EMAILLABS_WEBHOOK_SECRET.',
    codeRefs: [
      'src/lib/email/transport/emaillabs.ts',
      'src/lib/email/outbox.ts',
      'src/lib/auth/email-worker.ts',
      'src/app/api/email/webhook/emaillabs/route.ts',
    ],
    notes: [
      'Każde wywołanie wysyłki ma nagłówek X-TRACKING-OFF: 1 (bez przekierowań linków); open tracking jest ustawieniem konta SMTP — do wyłączenia w panelu (docs/EMAILLABS_SETUP.md).',
      'Przed wysyłką kod odpytuje statusy po messageId (deduplikacja ponowień) — klucz API potrzebuje prawa odczytu statusów.',
      'Webhook przekazuje adres odbiorcy i status doręczenia; kod zapisuje tylko status, czas i ewentualną blokadę adresu.',
    ],
    ...UNKNOWN,
  },
  {
    id: 'discord-webhook',
    name: 'Discord (webhook kanału błędów)',
    purpose: 'Powiadomienie zespołu o błędzie serwera (5xx, captureError) na kanale Discorda (#571).',
    dataCategories: [
      'Dane techniczne bez danych osobowych: kod błędu z listy ErrorCodes, szablon trasy bez query/fragmentu, wersja wydania (SHA), środowisko, czas, liczba pominiętych powtórzeń',
    ],
    dataSubjects: ['Brak (wiadomość nie zawiera danych osób; trasa i tekst przechodzą redakcję #502)'],
    activation: 'ERROR_WEBHOOK_URL (tylko serwer; https discord.com/discordapp.com); pusta zmienna = brak wysyłki.',
    codeRefs: ['src/lib/error-webhook/', 'src/lib/error-report.ts', 'src/instrumentation.ts'],
    notes: [
      'Wysyłka tylko z runtime serwera (reporter rejestrowany w instrumentation); w przeglądarce captureError to no-op.',
      'Wiadomość budowana od zera z bezpiecznych pól — bez treści wyjątku, cause, kontekstu, nagłówków i parametrów; limit 2000 znaków.',
      'Ten sam kod najwyżej raz na 10 min, przerwa po 429 wg retry_after, timeout 3 s; adres webhooka nie trafia do logów ani komunikatów.',
    ],
    ...UNKNOWN,
  },
  {
    id: 'cloudflare-r2',
    name: 'Cloudflare R2 (bucket kopii bazy)',
    purpose: 'Przechowywanie zaszyfrowanych kopii bazy poza Railwayem (#569); pliki CV zostają w buckecie Railway.',
    dataCategories: [
      'Zaszyfrowany (age, klucz publiczny) zrzut całej bazy — wszystkie kategorie z mapy tabel; dostawca nie ma klucza prywatnego',
      'Manifest kopii bez danych: rozmiary, SHA-256, liczby tabel i migracji, wersja serwera',
    ],
    dataSubjects: ['Kandydaci', 'Aplikujący bez konta', 'Pracodawcy i członkowie firm', 'Zgłaszający treści', 'Administratorzy'],
    activation:
      'BACKUP_S3_ENDPOINT + BACKUP_S3_BUCKET + klucz zapisu BACKUP_S3_ACCESS_KEY_ID/SECRET w zadaniu kopii; aplikacja tylko klucz odczytu BACKUP_S3_READ_* (czujka wieku kopii).',
    codeRefs: ['scripts/db/backup.sh', 'scripts/db/restore-backup.sh', 'scripts/db/lib/backup-s3.mjs', 'src/lib/ops/backup-freshness.ts'],
    notes: [
      'Bucket prywatny, bez domeny publicznej i bez r2.dev (ustawienie w panelu Cloudflare — docs/railway/OPERATIONS.md).',
      'Retencja w buckecie: BACKUP_RETENTION najnowszych kopii, opcjonalnie BACKUP_S3_MAX_AGE_DAYS; usuwa tylko obiekty o wzorcu nazwy kopii.',
      'Usługa web czyta wyłącznie listę obiektów (wiek ostatniej kopii w /api/health/ops) — klucz zapisu w usłudze web to alarm backup_misconfigured.',
    ],
    ...UNKNOWN,
  },
  {
    id: 'cloudflare-turnstile',
    name: 'Cloudflare Turnstile',
    purpose:
      'Ochrona formularzy przed botami: logowanie, rejestracja, reset hasła, zgłoszenie treści, aplikowanie bez konta.',
    dataCategories: [
      'Przeglądarka → challenges.cloudflare.com: skrypt widżetu dostawcy (zakres sygnałów zbieranych przez skrypt nie wynika z kodu portalu)',
      'Serwer → Siteverify: token odpowiedzi, sekret, losowy idempotency_key',
    ],
    dataSubjects: ['Odwiedzający korzystający z chronionych formularzy'],
    activation: 'NEXT_PUBLIC_TURNSTILE_SITE_KEY + TURNSTILE_SECRET_KEY; bez kluczy poza produkcją wyłączone.',
    codeRefs: ['src/lib/turnstile/verify.ts', 'src/lib/turnstile/policy.ts', 'src/components/auth/TurnstileWidget.tsx', 'docs/TURNSTILE.md'],
    notes: [
      'Siteverify nie dostaje parametru remoteip ani treści pól formularza.',
      'Tryb widżetu, pre-clearance (cookie cf_clearance) i analityka konta są ustawieniami panelu Cloudflare, nie kodu.',
    ],
    ...UNKNOWN,
  },
  {
    id: 'openai',
    name: 'OpenAI (Responses API, model GPT-6 Luna)',
    purpose:
      'Funkcje AI za flagami (decyzja właściciela 2026-09-26: wyłącznie model OpenAI „GPT-6 Luna”): import ogłoszenia o pracę do szkicu oferty, asystent redagowania treści oferty, import CV do propozycji pól profilu kandydata i tłumaczenie pól tekstowych ofert/profili (#31/#32).',
    dataCategories: [
      'Import ogłoszenia: tekst strony po minimalizacji (bez e-maili, telefonów i numerów identyfikacyjnych) i sama nazwa hosta źródła',
      'Import ogłoszenia: albo obraz zrzutu ekranu (base64) — bez lokalnej redakcji; może zawierać dane osób z ogłoszenia',
      'Asystent treści: tytuł, opis, obowiązki i wymagania oferty napisane przez pracodawcę (e-maile, telefony i identyfikatory usunięte przed wysyłką)',
      'Import CV: tekst CV kandydata po lokalnej minimalizacji (bez pliku, nazwy pliku, kontaktów, referencji i danych szczególnych)',
      'Tłumaczenia: pola tekstowe oferty albo profilu w języku źródła (treść jak w portalu, bez maskowania kontaktów — #33/#34)',
    ],
    dataSubjects: [
      'Osoby wymienione w importowanym ogłoszeniu',
      'Pracodawca wykonujący import lub redakcję (pośrednio)',
      'Kandydat importujący własne CV',
    ],
    activation:
      'OPENAI_API_KEY + osobna flaga funkcji: AI_JOB_IMPORT_ENABLED, AI_JOB_ASSIST_ENABLED, AI_CV_IMPORT_ENABLED, AI_TRANSLATION_ENABLED (każda domyślnie wyłączona). Model: gpt-6-luna albo AI_MODEL / AI_*_MODEL.',
    codeRefs: [
      'src/lib/ai/openai.ts',
      'src/lib/ai/model-config.ts',
      'src/lib/ai-import/extract.ts',
      'src/lib/ai-import/minimize.ts',
      'src/lib/ai-assist/assist.ts',
      'src/lib/translation/openai-provider.ts',
      'src/lib/ai-assist/guard.ts',
      'src/lib/cv-import/extract.ts',
      'src/lib/cv-import/minimize.ts',
      'docs/AI_JOB_IMPORT.md',
      'docs/AI_JOB_ASSIST.md',
      'docs/AI_CV_IMPORT.md',
    ],
    notes: [
      'Wszystkie wywołania idą przez jednego klienta (src/lib/ai/openai.ts): structured output (strict), bez narzędzi, store: false, bez logowania treści.',
      'Import ogłoszeń i asystent nie wysyłają danych kandydatów, profili ani CV; import CV wysyła wyłącznie zminimalizowany tekst CV samego kandydata.',
      'Tekst ogłoszenia: z JSON-LD zostają tylko dozwolone pola JobPosting; redakcja e-maili, telefonów, NISS/BIS, PESEL i numerów dokumentów przed wysyłką (minimize.ts). Numer identyfikacyjny w odpowiedzi modelu = odmowa importu.',
      'Kod nie ustawia regionu przetwarzania (data residency) ani projektu z ograniczoną retencją — do decyzji właściciela.',
    ],
    ...UNKNOWN,
  },
  {
    id: 'stripe',
    name: 'Stripe',
    purpose: 'Płatności — WYŁĄCZONE w bezpłatnym MVP (#51).',
    dataCategories: ['Brak przepływu przy wyłączonej fladze (dane rozliczeniowe firmy, gdyby płatności wróciły)'],
    dataSubjects: ['Pracodawcy'],
    activation: 'Tylko BILLING_ENABLED=true; akcje checkoutu zawsze zwracają BILLING_UNAVAILABLE.',
    codeRefs: ['src/lib/billing/flag.ts', 'src/lib/stripe.ts', 'docs/PRODUCT_DECISIONS.md'],
    notes: ['Powrót płatności wymaga nowej decyzji i ponownej oceny dostawcy.'],
    ...UNKNOWN,
  },
  {
    id: 'cloudflare-web-analytics',
    name: 'Cloudflare Web Analytics',
    purpose:
      'Analityka ruchu — wyłącznie po zgodzie w kategorii analytics (#570, decyzja właściciela 2026-09-25: zamiast Google Analytics i Meta Pixel — usunięte).',
    dataCategories: ['Wyświetlenia stron; beacon bezcookie\'owy — bez identyfikatorów i bez cookies trackera'],
    dataSubjects: ['Odwiedzający, którzy wyrazili zgodę'],
    activation: 'NEXT_PUBLIC_CF_WEB_ANALYTICS_TOKEN + zgoda analytics w banerze cookies.',
    codeRefs: ['src/components/cookies/Analytics.tsx', 'src/lib/consent-store.ts'],
    notes: [
      'Kategorii marketing nie ma w banerze ani w logu zgód (decyzja właściciela 2026-09-25; wersja polityki cookies 2.0, migracja 0130).',
      'Bez tokenu beacon się nie ładuje, a CSP nie dopuszcza hostów cloudflareinsights.com.',
    ],
    ...UNKNOWN,
  },
  {
    id: 'vies',
    name: 'VIES (Komisja Europejska)',
    purpose: 'Sprawdzenie numeru VAT firmy na żądanie administratora.',
    dataCategories: ['Kod kraju i numer VAT firmy (u osoby prowadzącej działalność może identyfikować osobę)'],
    dataSubjects: ['Pracodawcy'],
    activation: 'Akcja administratora w /admin/firmy/[id].',
    codeRefs: ['src/lib/vies/client.ts', 'src/lib/vies/belgian-vat.ts'],
    notes: ['Zapisywane są tylko wyniki rozstrzygające (company_vies_checks).'],
    ...UNKNOWN,
  },
];
