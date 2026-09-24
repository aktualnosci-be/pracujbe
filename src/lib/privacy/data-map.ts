import type { ProcessorId } from './processors';

/**
 * Klasyfikacja danych osobowych w schemacie bazy (#485). Czyste dane — czyta je
 * `scripts/privacy/data-map.mjs` (generuje `docs/legal-drafts/data-map.generated.md`)
 * i test `tests/unit/privacy-data-map.test.ts`.
 *
 * Kontrakt pilnowany testem:
 *   1. KAŻDA tabela z migracji produkcyjnych ma wpis w `TABLE_CLASSIFICATION` (także tabela
 *      bez danych osobowych — wtedy `columns: {}` i `note` z uzasadnieniem).
 *   2. Każda kolumna, którą rozpoznaje `PERSONAL_COLUMN_PATTERNS`, jest w `columns`
 *      (dane osobowe) albo w `notPersonal` (z powodem). Nowa kolumna `email` bez wpisu = test
 *      czerwony.
 *   3. Wpisy nie wskazują nieistniejących tabel ani kolumn.
 *
 * Klasyfikacja opisuje fakty ze schematu. Podstawa prawna, retencja „docelowa” i role
 * administratorów NIE są tu rozstrzygane — patrz `docs/legal-drafts/rejestr-czynnosci.md`.
 */

export type DataCategory =
  | 'identity'
  | 'contact'
  | 'credentials'
  | 'professional'
  | 'recruitment'
  | 'correspondence'
  | 'file'
  | 'technical'
  | 'consent'
  | 'moderation'
  | 'company'
  | 'preferences'
  | 'reference';

export const DATA_CATEGORY_LABELS: Record<DataCategory, string> = {
  identity: 'Identyfikacja (imię, nazwisko, zdjęcie, rola)',
  contact: 'Dane kontaktowe (e-mail, telefon)',
  credentials: 'Uwierzytelnianie (skrót hasła, tokeny, sesje, kody)',
  professional: 'Profil zawodowy (doświadczenie, umiejętności, języki, certyfikaty, dostępność, lokalizacja)',
  recruitment: 'Proces rekrutacyjny (statusy, dopasowanie, odpowiedzi screeningowe)',
  correspondence: 'Korespondencja i treści swobodne',
  file: 'Pliki (CV) i ich metadane',
  technical: 'Dane techniczne (IP, User-Agent, identyfikatory urządzeń, dzienniki)',
  consent: 'Dowody zgód i akceptacji dokumentów',
  moderation: 'Zgłoszenia treści i decyzje moderacyjne',
  company: 'Dane firmy mogące identyfikować osobę (np. jednoosobowa działalność)',
  preferences: 'Preferencje i ustawienia (język, powiadomienia, wyszukiwania, blokady)',
  reference: 'Powiązanie z osobą (identyfikator konta/profilu)',
};

export type DataSubject =
  | 'candidate'
  | 'guest'
  | 'employer'
  | 'admin'
  | 'reporter'
  | 'visitor'
  | 'invitee';

export const DATA_SUBJECT_LABELS: Record<DataSubject, string> = {
  candidate: 'Kandydaci (konto)',
  guest: 'Aplikujący bez konta',
  employer: 'Pracodawcy i członkowie firm',
  admin: 'Administratorzy portalu',
  reporter: 'Zgłaszający treści (z kontem lub bez)',
  visitor: 'Odwiedzający (bez konta)',
  invitee: 'Osoby zaproszone do zespołu firmy',
};

export type ActivityId =
  | 'account'
  | 'candidate-profile'
  | 'cv-files'
  | 'applications'
  | 'guest-applications'
  | 'matching-search'
  | 'employer-contact'
  | 'companies'
  | 'email-notifications'
  | 'consents'
  | 'dsa-moderation'
  | 'security-audit'
  | 'ai-job-import'
  | 'job-statistics'
  | 'analytics-marketing'
  | 'backups'
  | 'billing-disabled';

export interface Activity {
  name: string;
  /** Co robi kod (fakty). Cel prawny i podstawę ustala właściciel/prawnik. */
  inCode: string;
  processors: ProcessorId[];
  /** Retencja lub usuwanie, które kod faktycznie wykonuje; `null` = kod nie usuwa danych. */
  retentionInCode: string | null;
}

/** Wspólne dla każdej czynności: hosting aplikacji i bazy. */
const HOSTING: ProcessorId[] = ['railway', 'supabase'];

export const ACTIVITIES: Record<ActivityId, Activity> = {
  account: {
    name: 'Konto i uwierzytelnianie',
    inCode: 'Rejestracja, logowanie, sesje Better Auth, profil konta i język komunikacji; e-maile konta.',
    processors: [...HOSTING, 'resend', 'cloudflare-turnstile'],
    retentionInCode: 'Sesje i weryfikacje mają expires_at; kod nie usuwa kont automatycznie (soft delete profiles.deleted_at).',
  },
  'candidate-profile': {
    name: 'Profil zawodowy kandydata',
    inCode: 'Onboarding (6 kroków), umiejętności/języki/certyfikaty, widoczność profilu dla firm (is_searchable), zapisane oferty.',
    processors: HOSTING,
    retentionInCode: null,
  },
  'cv-files': {
    name: 'Pliki CV',
    inCode: 'Upload PDF/DOC/DOCX do prywatnego bucketa, dostęp przez krótkie podpisane URL-e, usuwanie przez właściciela.',
    processors: HOSTING,
    retentionInCode: 'Usunięcie na żądanie właściciela pliku (src/lib/actions/files.ts); brak automatycznej retencji.',
  },
  applications: {
    name: 'Aplikacje na oferty',
    inCode: 'Aplikowanie (idempotentne), zmiany statusu przez firmę, historia statusów, odpowiedzi na pytania screeningowe.',
    processors: [...HOSTING, 'resend'],
    retentionInCode: null,
  },
  'guest-applications': {
    name: 'Aplikacja bez konta',
    inCode: 'Formularz gościa, potwierdzenie e-mailem, aplikacja ze snapshotem zgody, przejęcie przez konto.',
    processors: [...HOSTING, 'resend', 'cloudflare-turnstile'],
    retentionInCode:
      'purge_guest_application_requests (/api/maintenance): niepotwierdzone 7 dni po ostatnim linku, duplikaty 7 dni po potwierdzeniu, token przejęcia zerowany po 30 dniach.',
  },
  'matching-search': {
    name: 'Dopasowanie i zapisane wyszukiwania',
    inCode: 'Deterministyczny scoring (src/lib/matching), materializacja matches, zapisane wyszukiwania i alerty e-mail.',
    processors: [...HOSTING, 'resend'],
    retentionInCode: null,
  },
  'employer-contact': {
    name: 'Kontakt pracodawca–kandydat',
    inCode: 'Propozycje pracy, rozmowy i wiadomości, blokowanie firm przez kandydata.',
    processors: [...HOSTING, 'resend'],
    retentionInCode: 'Propozycje wygasają (expires_at), dane nie są usuwane.',
  },
  companies: {
    name: 'Konta firm, zespół i weryfikacja',
    inCode: 'Zakładanie firmy, członkowie i zaproszenia, weryfikacja przez administratora, sprawdzenie VAT w VIES, oferty pracy.',
    processors: [...HOSTING, 'resend', 'vies'],
    retentionInCode: 'Zaproszenia wygasają po 14 dniach (status), nie są usuwane.',
  },
  'email-notifications': {
    name: 'E-maile i powiadomienia',
    inCode: 'Kolejka email_deliveries, worker wysyłki, powiadomienia in-app, preferencje z dowodem zmiany zgody, wypisanie, budżet na odbiorcę, kampanie, blokady adresów po odbiciach/skargach.',
    processors: [...HOSTING, 'resend'],
    retentionInCode: 'email_send_windows czyszczone po 1 dniu; email_recipient_windows odbiorcy starsze niż 31 dni usuwane przy kolejkowaniu; kod nie usuwa email_deliveries ani email_consent_events (retencja odłożona — CLAUDE.md).',
  },
  consents: {
    name: 'Zgody cookies i akceptacja dokumentów',
    inCode: 'Receipt zgody cookies (record_consent) i akceptacji regulaminu przy rejestracji — z IP i User-Agent.',
    processors: HOSTING,
    retentionInCode: null,
  },
  'dsa-moderation': {
    name: 'Zgłoszenia treści (DSA) i moderacja',
    inCode: 'Publiczny formularz zgłoszenia, sprawy z numerem i kodem dostępu, decyzje moderacyjne z uzasadnieniem, e-maile do stron.',
    processors: [...HOSTING, 'resend', 'cloudflare-turnstile'],
    retentionInCode: null,
  },
  'security-audit': {
    name: 'Bezpieczeństwo, audyt i limity',
    inCode: 'Dziennik audytu (triggery), limiter zapytań, zdarzenia systemowe, inbox webhooków, raportowanie błędów.',
    processors: [...HOSTING, 'sentry', 'cloudflare-turnstile'],
    retentionInCode: 'Funkcja processed_webhooks_gc (30 dni) istnieje, ale kod jej nie wywołuje; audit_logs i rate_limits bez usuwania w kodzie.',
  },
  'ai-job-import': {
    name: 'Import ogłoszenia przez AI',
    inCode: 'Pracodawca przesyła zrzut ekranu lub link; tekst jest minimalizowany przed wysyłką (zrzut — nie), wynik trafia do szkicu oferty (bez publikacji). Za flagą, domyślnie wyłączone.',
    processors: [...HOSTING, 'anthropic'],
    retentionInCode: 'Portal nie zapisuje przesłanego obrazu ani pobranej strony — tylko wynik w szkicu oferty.',
  },
  'job-statistics': {
    name: 'Statystyki ofert (lejek)',
    inCode: 'Zliczanie wyświetleń/wystąpień w wynikach per oferta i dzień, bez IP, cookies i identyfikatora osoby.',
    processors: HOSTING,
    retentionInCode: 'job_funnel_receipts (nonce deduplikacji) sprzątane po 2 dniach.',
  },
  'analytics-marketing': {
    name: 'Analityka i marketing po zgodzie',
    inCode: 'Skrypty GA i Meta Pixel ładowane dopiero po zgodzie w odpowiedniej kategorii; wycofanie usuwa cookies.',
    processors: ['google-analytics', 'meta-pixel'],
    retentionInCode: 'Cookie zgody ważne 180 dni.',
  },
  backups: {
    name: 'Kopie zapasowe bazy',
    inCode: 'scripts/db/backup.sh: zaszyfrowany (age) zrzut logiczny całej bazy.',
    processors: ['railway'],
    retentionInCode: 'BACKUP_RETENTION najnowszych kopii (domyślnie 14).',
  },
  'billing-disabled': {
    name: 'Płatności (wyłączone)',
    inCode: 'Martwy schemat po wyłączonym billingu (#51); brak aktywnego przepływu.',
    processors: ['stripe'],
    retentionInCode: null,
  },
};

export interface TableClassification {
  activities: ActivityId[];
  subjects: DataSubject[];
  /** Kolumny z danymi osobowymi → kategoria. Puste = tabela bez danych osobowych. */
  columns: Record<string, DataCategory>;
  /** Kolumny trafione heurystyką, które NIE są danymi osobowymi — z powodem. */
  notPersonal?: Record<string, string>;
  note?: string;
}

/**
 * Heurystyka nazw kolumn, które zwykle niosą dane osobowe. Trafiona kolumna musi mieć
 * klasyfikację. Heurystyka nie zastępuje przeglądu — kolumna o nietypowej nazwie trafia do
 * mapy dopiero z ręcznym wpisem; dlatego pkt 1 kontraktu wymaga wpisu dla każdej tabeli.
 */
export const PERSONAL_COLUMN_PATTERNS: readonly RegExp[] = [
  /(^|_)e?mail$/,
  /phone/,
  /^(first|last|full|guest|reporter|recipient|display|vies)_name$/,
  /(^|_)ip(_address)?$/,
  /user_agent$/,
  /(^|_)(token|password|secret)$|_hash$/,
  /avatar|(^|_)image$/,
  /^(profile|candidate|candidate_profile|user|owner|actor|sender|reporter)_id$/,
  /_by$/,
  /(^|_)(address|postal_code)$/,
  /^(message|body|bio|details|note|answer_text|screening_answers)$/,
  /birth|gender|nationality|niss|national_id|passport/,
  /(^|_)(cv|resume|file_name)$/,
  /(^|_)vat_number$/,
  /visitor_id$/,
];

const DICTIONARY = (what: string): TableClassification => ({
  activities: [],
  subjects: [],
  columns: {},
  note: `Słownik/konfiguracja (${what}) — bez danych osobowych.`,
});

const BILLING = (note: string): TableClassification => ({
  activities: ['billing-disabled'],
  subjects: ['employer'],
  columns: {},
  note,
});

export const TABLE_CLASSIFICATION: Record<string, TableClassification> = {
  // --- Konto (Better Auth) -------------------------------------------------------------
  'auth.users': {
    activities: ['account'],
    subjects: ['candidate', 'employer', 'admin'],
    columns: {
      email: 'contact',
      name: 'identity',
      raw_user_meta_data: 'identity',
      image: 'identity',
      email_verified: 'credentials',
    },
  },
  'auth.accounts': {
    activities: ['account'],
    subjects: ['candidate', 'employer', 'admin'],
    columns: {
      user_id: 'reference',
      account_id: 'credentials',
      access_token: 'credentials',
      refresh_token: 'credentials',
      id_token: 'credentials',
      password: 'credentials',
    },
  },
  'auth.sessions': {
    activities: ['account', 'security-audit'],
    subjects: ['candidate', 'employer', 'admin'],
    columns: { user_id: 'reference', token: 'credentials', ip_address: 'technical', user_agent: 'technical' },
  },
  'auth.verifications': {
    activities: ['account'],
    subjects: ['candidate', 'employer', 'admin'],
    columns: { identifier: 'credentials', value: 'credentials' },
    note: 'Jednorazowe identyfikatory i wartości weryfikacji (np. potwierdzenie e-maila, reset hasła).',
  },
  'auth.email_outbox': {
    activities: ['account', 'email-notifications'],
    subjects: ['candidate', 'employer', 'admin'],
    columns: {
      user_id: 'reference',
      recipient_email: 'contact',
      first_name: 'identity',
      recipient_role: 'identity',
      token: 'credentials',
      locale: 'preferences',
    },
    note: 'Kolejka e-maili konta; w src/ nie ma jeszcze workera, który ją czyta.',
  },

  // --- Profil i konto aplikacji ----------------------------------------------------------
  'public.profiles': {
    activities: ['account'],
    subjects: ['candidate', 'employer', 'admin'],
    columns: {
      role: 'identity',
      email: 'contact',
      first_name: 'identity',
      last_name: 'identity',
      phone: 'contact',
      avatar_url: 'identity',
      preferred_locale: 'preferences',
      account_locale: 'preferences',
      signup_locale: 'preferences',
      last_seen_at: 'technical',
    },
  },
  'public.candidate_profiles': {
    activities: ['candidate-profile', 'matching-search'],
    subjects: ['candidate'],
    columns: {
      profile_id: 'reference',
      headline: 'professional',
      bio: 'correspondence',
      city: 'professional',
      region: 'professional',
      radius_km: 'professional',
      has_driving_license: 'professional',
      has_car: 'professional',
      experience_years: 'professional',
      availability: 'professional',
      occupations: 'professional',
      categories: 'professional',
      preferred_contract_types: 'professional',
      expected_salary_min: 'professional',
      is_searchable: 'preferences',
      searchable_changed_at: 'preferences',
    },
  },
  'public.candidate_visibility_events': {
    activities: ['candidate-profile'],
    subjects: ['candidate'],
    columns: { candidate_id: 'reference', searchable: 'preferences', created_at: 'preferences' },
    note: 'Historia włączania/wyłączania widoczności profilu (0100); firma nie ma ścieżki odczytu.',
  },
  'public.candidate_skills': {
    activities: ['candidate-profile', 'matching-search'],
    subjects: ['candidate'],
    columns: { candidate_profile_id: 'reference', skill_label: 'professional', years: 'professional' },
  },
  'public.candidate_languages': {
    activities: ['candidate-profile', 'matching-search'],
    subjects: ['candidate'],
    columns: { candidate_profile_id: 'reference', language_label: 'professional', level: 'professional' },
  },
  'public.candidate_certificates': {
    activities: ['candidate-profile', 'matching-search'],
    subjects: ['candidate'],
    columns: {
      candidate_profile_id: 'reference',
      certificate_label: 'professional',
      issued_at: 'professional',
      expires_at: 'professional',
    },
  },
  'public.candidate_company_blocks': {
    activities: ['employer-contact'],
    subjects: ['candidate'],
    columns: { candidate_id: 'reference', company_id: 'preferences' },
    note: 'Firma nie ma ścieżki odczytu blokad (0078).',
  },
  'public.saved_jobs': {
    activities: ['candidate-profile'],
    subjects: ['candidate'],
    columns: { candidate_id: 'reference', job_id: 'preferences' },
  },
  'public.employer_profiles': {
    activities: ['companies'],
    subjects: ['employer'],
    columns: { profile_id: 'reference', job_title: 'professional', phone: 'contact' },
  },
  'public.notification_preferences': {
    activities: ['email-notifications'],
    subjects: ['candidate', 'employer'],
    columns: {
      profile_id: 'reference',
      email_applications: 'preferences',
      email_offers: 'preferences',
      email_messages: 'preferences',
      email_job_matches: 'preferences',
      email_marketing: 'preferences',
      push_enabled: 'preferences',
      in_app_enabled: 'preferences',
    },
  },

  // --- Pliki ------------------------------------------------------------------------------
  'public.files': {
    activities: ['cv-files'],
    subjects: ['candidate'],
    columns: {
      owner_id: 'reference',
      bucket: 'file',
      path: 'file',
      file_name: 'file',
      mime_type: 'file',
      size_bytes: 'file',
      checksum_sha256: 'file',
      scan_status: 'file',
    },
    note: 'Treść pliku leży w buckecie (Supabase Storage), w tabeli są metadane.',
  },

  // --- Aplikacje ---------------------------------------------------------------------------
  'public.applications': {
    activities: ['applications', 'guest-applications'],
    subjects: ['candidate', 'guest'],
    columns: {
      candidate_id: 'reference',
      status: 'recruitment',
      message: 'correspondence',
      phone: 'contact',
      availability: 'professional',
      locale: 'preferences',
      match_score: 'recruitment',
      viewed_at: 'recruitment',
      submitted_at: 'recruitment',
      guest_name: 'identity',
      guest_email: 'contact',
      claimed_at: 'recruitment',
    },
  },
  'public.application_status_history': {
    activities: ['applications'],
    subjects: ['candidate', 'guest', 'employer'],
    columns: { from_status: 'recruitment', to_status: 'recruitment', changed_by: 'reference', note: 'correspondence' },
  },
  'public.application_screening_answers': {
    activities: ['applications', 'guest-applications'],
    subjects: ['candidate', 'guest'],
    columns: { answer_boolean: 'recruitment', answer_date: 'recruitment', answer_text: 'recruitment' },
    note: 'Niezmienny snapshot pytania i odpowiedzi; widoczny dla kandydata i recruiter+ firmy.',
  },
  'public.guest_application_requests': {
    activities: ['guest-applications'],
    subjects: ['guest'],
    columns: {
      email: 'contact',
      full_name: 'identity',
      phone: 'contact',
      availability: 'professional',
      message: 'correspondence',
      screening_answers: 'recruitment',
      locale: 'preferences',
      confirm_token_hash: 'credentials',
      confirm_nonce: 'credentials',
      claim_token_hash: 'credentials',
      claim_nonce: 'credentials',
      claimed_by: 'reference',
      consent_document_version: 'consent',
      consent_accepted_at: 'consent',
      consent_ip: 'technical',
      consent_user_agent: 'technical',
      age_attested_min: 'identity',
      age_attested_at: 'identity',
    },
  },

  // --- Dopasowanie i wyszukiwania ----------------------------------------------------------
  'public.matches': {
    activities: ['matching-search'],
    subjects: ['candidate'],
    columns: {
      candidate_id: 'reference',
      score: 'recruitment',
      matched: 'recruitment',
      missing: 'recruitment',
      strengths: 'recruitment',
      mandatory_met: 'recruitment',
    },
  },
  'public.saved_searches': {
    activities: ['matching-search'],
    subjects: ['candidate'],
    columns: { profile_id: 'reference', name: 'preferences', filters: 'preferences', query: 'preferences', locale: 'preferences' },
    notPersonal: { filters_hash: 'Skrót filtrów do deduplikacji wyszukiwań — nie identyfikuje osoby poza wierszem.' },
  },
  'public.saved_search_alerts': {
    activities: ['matching-search', 'email-notifications'],
    subjects: ['candidate'],
    columns: { profile_id: 'reference', job_id: 'preferences' },
  },

  // --- Kontakt pracodawca–kandydat ---------------------------------------------------------
  'public.offers': {
    activities: ['employer-contact'],
    subjects: ['candidate', 'employer'],
    columns: {
      candidate_id: 'reference',
      sender_id: 'reference',
      status: 'recruitment',
      message: 'correspondence',
      locale: 'preferences',
    },
  },
  'public.offer_status_history': {
    activities: ['employer-contact'],
    subjects: ['candidate', 'employer'],
    columns: { from_status: 'recruitment', to_status: 'recruitment', changed_by: 'reference', note: 'correspondence' },
  },
  'public.conversations': {
    activities: ['employer-contact'],
    subjects: ['candidate', 'employer'],
    columns: { subject: 'correspondence', created_by: 'reference' },
  },
  'public.conversation_members': {
    activities: ['employer-contact'],
    subjects: ['candidate', 'employer'],
    columns: { profile_id: 'reference', last_read_at: 'technical' },
  },
  'public.messages': {
    activities: ['employer-contact'],
    subjects: ['candidate', 'employer'],
    columns: { sender_id: 'reference', body: 'correspondence', read_at: 'technical' },
  },

  // --- Firmy -------------------------------------------------------------------------------
  'public.companies': {
    activities: ['companies'],
    subjects: ['employer'],
    columns: {
      name: 'company',
      vat_number: 'company',
      registration_number: 'company',
      website: 'company',
      email: 'contact',
      phone: 'contact',
      address: 'company',
      postal_code: 'company',
      city: 'company',
      verified_by: 'reference',
      status_reason: 'moderation',
    },
  },
  'public.company_members': {
    activities: ['companies'],
    subjects: ['employer'],
    columns: { profile_id: 'reference', role: 'identity', is_active: 'identity', invited_by: 'reference', joined_at: 'identity' },
  },
  'public.company_invitations': {
    activities: ['companies'],
    subjects: ['invitee', 'employer'],
    columns: { email: 'contact', role: 'identity', invited_by: 'reference', responded_by: 'reference' },
  },
  'public.company_vies_checks': {
    activities: ['companies'],
    subjects: ['employer'],
    columns: { vat_number: 'company', vies_name: 'company', checked_by: 'reference' },
  },
  'public.jobs': {
    activities: ['companies'],
    subjects: ['employer'],
    columns: { created_by: 'reference', contact_email: 'contact', address: 'company' },
    note: 'Treść oferty to dane firmy; kontaktowy e-mail i autor mogą identyfikować rekrutera.',
  },

  // --- E-maile i powiadomienia -------------------------------------------------------------
  'public.email_deliveries': {
    activities: ['email-notifications'],
    subjects: ['candidate', 'guest', 'employer', 'reporter', 'invitee'],
    columns: {
      profile_id: 'reference',
      to_email: 'contact',
      locale: 'preferences',
      subject: 'correspondence',
      payload: 'correspondence',
      status: 'technical',
      error_message: 'technical',
      provider_message_id: 'technical',
      bounce_type: 'technical',
    },
    note: 'Pola payloadu dla każdego szablonu — sekcja „Treść e-maili” (generowana z migracji).',
  },
  'public.email_suppressions': {
    activities: ['email-notifications'],
    subjects: ['candidate', 'guest', 'employer', 'reporter', 'invitee'],
    columns: { email: 'contact', reason: 'technical', lifted_by: 'reference', lift_reason: 'moderation' },
  },
  'public.email_consent_events': {
    activities: ['email-notifications', 'consents'],
    subjects: ['candidate', 'employer'],
    columns: {
      profile_id: 'reference',
      category: 'consent',
      granted: 'consent',
      source: 'consent',
      locale: 'preferences',
      wording_version: 'consent',
      created_at: 'consent',
    },
    note: 'Niezmienny dowód każdej zmiany zgody e-mail (0101), zapisywany triggerem na notification_preferences.',
  },
  'public.email_recipient_windows': {
    activities: ['email-notifications'],
    subjects: ['candidate', 'employer'],
    columns: { profile_id: 'reference', used: 'technical', window_start: 'technical' },
    note: 'Licznik budżetu wysyłki na odbiorcę (0101).',
  },
  'public.email_campaign_recipients': {
    activities: ['email-notifications'],
    subjects: ['candidate', 'employer'],
    columns: { profile_id: 'reference', status: 'technical', reason: 'technical', reserved_at: 'technical' },
    note: 'Rezerwacja odbiorcy kampanii (rewizja + odbiorca), bez treści i adresu e-mail (0101).',
  },
  'public.email_campaigns': {
    activities: ['email-notifications'],
    subjects: [],
    columns: {},
    note: 'Treść i status kampanii (per język) — bez danych odbiorców.',
  },
  'public.notifications': {
    activities: ['email-notifications'],
    subjects: ['candidate', 'employer'],
    columns: { profile_id: 'reference', title: 'correspondence', body: 'correspondence', data: 'correspondence', read_at: 'technical' },
  },

  // --- Zgody ---------------------------------------------------------------------------------
  'public.consents': {
    activities: ['consents'],
    subjects: ['candidate', 'employer', 'visitor'],
    columns: {
      profile_id: 'reference',
      visitor_id: 'technical',
      category: 'consent',
      granted: 'consent',
      ip_address: 'technical',
      user_agent: 'technical',
    },
  },
  'public.candidate_age_attestations': {
    activities: ['account', 'candidate-profile'],
    subjects: ['candidate'],
    columns: { profile_id: 'reference', min_age: 'identity', source: 'technical', locale: 'preferences', created_at: 'identity' },
    note: 'Oświadczenie „mam co najmniej N lat” (0110, #492): sam próg i czas, bez daty urodzenia; niezmienne.',
  },
  'public.age_policy': {
    activities: ['account', 'security-audit'],
    subjects: ['admin'],
    columns: { updated_by: 'reference' },
    note: 'Próg wieku kandydatów jako dane (0110, #492); zmienia go administrator z uzasadnieniem i audytem.',
  },
  'public.document_acceptances': {
    activities: ['consents', 'account'],
    subjects: ['candidate', 'employer'],
    columns: {
      profile_id: 'reference',
      document_version: 'consent',
      accepted_at: 'consent',
      ip_address: 'technical',
      user_agent: 'technical',
    },
  },

  // --- DSA i moderacja ------------------------------------------------------------------------
  'public.reports': {
    activities: ['dsa-moderation'],
    subjects: ['reporter', 'employer'],
    columns: {
      reporter_id: 'reference',
      reason: 'moderation',
      details: 'correspondence',
      resolved_by: 'reference',
      access_code_hash: 'credentials',
      content_url: 'moderation',
      reporter_name: 'identity',
      reporter_email: 'contact',
      reporter_locale: 'preferences',
      good_faith_at: 'consent',
      target_snapshot: 'moderation',
    },
  },
  'public.report_events': {
    activities: ['dsa-moderation'],
    subjects: ['reporter', 'admin'],
    columns: { actor_id: 'reference' },
  },
  'public.moderation_decisions': {
    activities: ['dsa-moderation'],
    subjects: ['employer', 'admin'],
    columns: { facts: 'moderation', ground_reference: 'moderation', decided_by: 'reference' },
  },
  'public.moderation_restorations': {
    activities: ['dsa-moderation'],
    subjects: ['employer', 'admin'],
    columns: { reason: 'moderation', restored_by: 'reference' },
  },

  // --- Bezpieczeństwo i audyt ----------------------------------------------------------------
  'public.audit_logs': {
    activities: ['security-audit'],
    subjects: ['candidate', 'employer', 'admin'],
    columns: {
      actor_id: 'reference',
      before_data: 'technical',
      after_data: 'technical',
      ip_address: 'technical',
      user_agent: 'technical',
    },
    note: 'before_data/after_data mogą zawierać kopie pól audytowanych wierszy (aplikacje, propozycje, firmy).',
  },
  'public.rate_limits': {
    activities: ['security-audit'],
    subjects: ['candidate', 'employer', 'visitor'],
    columns: { key: 'technical' },
    note: 'Klucz = akcja + adres IP (ścieżka Supabase, bez haszowania) albo HMAC (ścieżka PostgreSQL, src/lib/db/rate-limit.ts).',
  },
  'public.system_events': {
    activities: ['security-audit'],
    subjects: [],
    columns: { message: 'technical', context: 'technical' },
    note: 'Zdarzenia techniczne; context (jsonb) nie ma schematu — zawartość zależy od wywołującego.',
  },
  'public.processed_webhooks': {
    activities: ['security-audit'],
    subjects: [],
    columns: {},
    note: 'Identyfikatory zdarzeń webhooków do deduplikacji — bez danych osobowych.',
  },

  // --- Statystyki ofert (bez danych osobowych z założenia #99) --------------------------------
  'public.job_funnel_daily': {
    activities: ['job-statistics'],
    subjects: [],
    columns: {},
    note: 'Liczniki per oferta i dzień — bez IP, cookies i identyfikatora osoby.',
  },
  'public.job_funnel_receipts': {
    activities: ['job-statistics'],
    subjects: [],
    columns: {},
    note: 'Losowy nonce jednego załadowania strony — nie identyfikuje osoby.',
  },

  // --- Treść ofert --------------------------------------------------------------------------
  'public.job_translations': {
    activities: ['companies'],
    subjects: [],
    columns: {},
    note: 'Treść ogłoszenia (dane firmy).',
  },
  'public.job_requirements': { activities: ['companies'], subjects: [], columns: {}, note: 'Treść ogłoszenia (dane firmy).' },
  'public.job_skills': { activities: ['companies'], subjects: [], columns: {}, note: 'Treść ogłoszenia (dane firmy).' },
  'public.job_languages': { activities: ['companies'], subjects: [], columns: {}, note: 'Treść ogłoszenia (dane firmy).' },
  'public.job_certificates': { activities: ['companies'], subjects: [], columns: {}, note: 'Treść ogłoszenia (dane firmy).' },
  'public.job_screening_questions': {
    activities: ['companies'],
    subjects: [],
    columns: {},
    note: 'Treść pytań ustalonych przez firmę; odpowiedzi — application_screening_answers.',
  },
  'public.screening_question_reviews': {
    activities: ['companies'],
    subjects: ['employer', 'admin'],
    columns: { requested_by: 'reference', decided_by: 'reference', decision_reason: 'moderation' },
    note:
      'Przegląd pytania oznaczonego przez detektor (#497, 0103): kopia treści pytania firmy, kto zapisał pytanie i kto zdecydował, uzasadnienie admina. Bez odpowiedzi kandydatów.',
  },

  // --- Płatności (wyłączone, #51) --------------------------------------------------------------
  'public.subscriptions': BILLING('Martwy schemat billingu; provider_customer_id identyfikuje firmę u dostawcy płatności.'),
  'public.payments': BILLING('Martwy schemat billingu.'),
  'public.invoices': BILLING('Martwy schemat billingu.'),
  'public.checkout_intents': BILLING('Martwy schemat billingu.'),
  'public.discount_redemptions': BILLING('Martwy schemat billingu.'),
  'public.discount_codes': DICTIONARY('kody rabatowe'),
  'public.plan_entitlements': DICTIONARY('limity planów'),

  // --- Słowniki i konfiguracja --------------------------------------------------------------
  'public.categories': DICTIONARY('kategorie'),
  'public.certificates': DICTIONARY('certyfikaty'),
  'public.languages': DICTIONARY('języki'),
  'public.locations': DICTIONARY('miejscowości'),
  'public.occupations': DICTIONARY('zawody'),
  'public.skills': DICTIONARY('umiejętności'),
  'public.occupation_labels': DICTIONARY('etykiety zawodów ESCO'),
  'public.skill_labels': DICTIONARY('etykiety umiejętności ESCO'),
  'public.occupation_skills': DICTIONARY('relacje ESCO'),
  'public.esco_snapshots': DICTIONARY('metadane importu ESCO'),
  'public.supported_locales': DICTIONARY('obsługiwane języki'),
  'public.consent_versions': DICTIONARY('wersje dokumentów zgód'),
  'public.email_send_budget_config': DICTIONARY('budżet wysyłki e-mail'),
  'public.email_send_windows': DICTIONARY('liczniki okien wysyłki'),
  'public.email_recipient_budget_config': DICTIONARY('limity wysyłki na odbiorcę'),
};
