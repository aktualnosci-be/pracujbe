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
  | 'sentry'
  | 'cloudflare-turnstile'
  | 'anthropic'
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
      'Kopie zapasowe: scripts/db/backup.sh szyfruje zrzut kluczem age i zapisuje w BACKUP_DIR; miejsce przechowywania kopii nie wynika z repozytorium.',
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
    id: 'sentry',
    name: 'Sentry',
    purpose: 'Zgłaszanie błędów aplikacji (klient, serwer, edge).',
    dataCategories: ['Kod błędu z listy ErrorCodes, identyfikator i czas zdarzenia'],
    dataSubjects: ['Użytkownicy, u których wystąpił błąd (pośrednio)'],
    activation: 'NEXT_PUBLIC_SENTRY_DSN / SENTRY_DSN; bez DSN brak wysyłki.',
    codeRefs: ['sentry.client.config.ts', 'sentry.server.config.ts', 'sentry.edge.config.ts', 'src/lib/sentry-egress.ts'],
    notes: [
      'sendDefaultPii: false, Session Replay i tracing wyłączone (sample rate 0).',
      'beforeSend = redactSentryEvent: zdarzenie budowane od zera z bezpiecznych pól (bez URL, treści wyjątku, extras i załączników).',
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
    id: 'anthropic',
    name: 'Anthropic (Claude API)',
    purpose: 'Import ogłoszenia o pracę do szkicu oferty (zrzut ekranu albo treść strony pobranej z linku).',
    dataCategories: [
      'Tekst strony z ogłoszeniem po minimalizacji (bez e-maili, telefonów i numerów identyfikacyjnych) i sama nazwa hosta źródła',
      'Albo obraz zrzutu ekranu (base64) — bez lokalnej redakcji; może zawierać dane osób z ogłoszenia',
    ],
    dataSubjects: ['Osoby wymienione w importowanym ogłoszeniu', 'Pracodawca wykonujący import (pośrednio)'],
    activation: 'AI_JOB_IMPORT_ENABLED=1/true + ANTHROPIC_API_KEY; domyślnie wyłączone. Model: DEFAULT_JOB_IMPORT_MODEL albo AI_JOB_IMPORT_MODEL.',
    codeRefs: ['src/lib/ai-import/extract.ts', 'src/lib/ai-import/minimize.ts', 'src/lib/ai-import/run-import.ts', 'src/lib/ai-import/config.ts', 'docs/AI_JOB_IMPORT.md'],
    notes: [
      'Kod nie wysyła do modelu danych kandydatów, profili ani CV.',
      'Tekst: z JSON-LD zostają tylko dozwolone pola JobPosting; redakcja e-maili, telefonów, NISS/BIS, PESEL i numerów dokumentów przed wysyłką (minimize.ts). Numer identyfikacyjny w odpowiedzi modelu = odmowa importu.',
      'Kod nie ustawia parametru inference_geo ani innych ustawień regionu.',
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
    purpose: 'Statystyka odwiedzin (#570, zamiast Google Analytics i Meta Pixel) — wyłącznie po zgodzie w kategorii analytics.',
    dataCategories: [
      'Adres strony, referrer, dane techniczne przeglądarki i czasy ładowania zbierane przez skrypt beaconu (pełny zakres określa dostawca); adres IP połączenia',
    ],
    dataSubjects: ['Odwiedzający, którzy wyrazili zgodę'],
    activation: 'NEXT_PUBLIC_CF_ANALYTICS_TOKEN + zgoda analytics w banerze cookies; nigdy na trasach prywatnych (allowsTrackingOnPath).',
    codeRefs: ['src/components/cookies/Analytics.tsx', 'src/lib/analytics/cloudflare.ts', 'next.config.mjs'],
    notes: [
      'Beacon nie ustawia cookies ani localStorage (deklaracja dostawcy; kod portalu niczego nie zapisuje).',
      'Po wycofaniu zgody bramka blokuje wysyłki załadowanego skryptu (sendBeacon/fetch/XHR do cloudflareinsights.com i /cdn-cgi/rum).',
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
