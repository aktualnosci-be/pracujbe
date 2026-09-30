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
  | 'support-contact'
  | 'security-audit'
  | 'ai-job-import'
  | 'ai-translation'
  | 'job-statistics'
  | 'analytics-marketing'
  | 'backups'
  | 'data-rights';

export interface Activity {
  name: string;
  /** Co robi kod (fakty). Cel prawny i podstawę ustala właściciel/prawnik. */
  inCode: string;
  processors: ProcessorId[];
  /** Retencja lub usuwanie, które kod faktycznie wykonuje; `null` = kod nie usuwa danych. */
  retentionInCode: string | null;
}

/** Wspólne dla każdej czynności: hosting aplikacji i bazy. */
const HOSTING: ProcessorId[] = ['railway'];

export const ACTIVITIES: Record<ActivityId, Activity> = {
  account: {
    name: 'Konto i uwierzytelnianie',
    inCode: 'Rejestracja, logowanie, sesje Better Auth, profil konta i język komunikacji; e-maile konta.',
    processors: [...HOSTING, 'resend', 'emaillabs', 'cloudflare-turnstile'],
    retentionInCode:
      'Sesje i weryfikacje mają expires_at; kandydat może usunąć konto (request_account_erasure). Wartości #574 (0127, harmonogram za RETENTION_MODE, domyślnie wyłączony): profil z deleted_at usuwany w 7 dni (deleted_profile), konto kandydata bez aktywności (last_seen_at z sesji) 730 dni z ostrzeżeniem 30 dni.',
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
    retentionInCode:
      'Usunięcie na żądanie właściciela pliku (src/lib/actions/files.ts) i z kontem; obiekt przez storage_deletion_queue (≤ 72 h, dead-letter po 20 próbach). Wartości #574 (0127, harmonogram za RETENTION_MODE, domyślnie wyłączony): wiersz z deleted_at i obiekt usunięte w 7 dni (deleted_file), CV bez aktywności 365 dni z ostrzeżeniem 30 dni.',
  },
  applications: {
    name: 'Aplikacje na oferty',
    inCode: 'Aplikowanie (idempotentne), zmiany statusu przez firmę, historia statusów, odpowiedzi na pytania screeningowe.',
    processors: [...HOSTING, 'resend', 'emaillabs'],
    retentionInCode:
      'Wartości #574 (0127, harmonogram za RETENTION_MODE, domyślnie wyłączony): aplikacja w stanie końcowym (także hired) usuwana 180 dni od niezmiennego closed_at razem z rozmowami, powiadomieniami i e-mailami.',
  },
  'guest-applications': {
    name: 'Aplikacja bez konta',
    inCode: 'Formularz gościa, potwierdzenie e-mailem, aplikacja ze snapshotem zgody, e-mail o zmianie statusu (język formularza), przejęcie przez konto.',
    processors: [...HOSTING, 'resend', 'emaillabs', 'cloudflare-turnstile'],
    retentionInCode:
      'purge_guest_application_requests (/api/maintenance): niepotwierdzone 7 dni po ostatnim linku, duplikaty 7 dni po potwierdzeniu, token przejęcia zerowany po 30 dniach. Wartości #574 (0127, za RETENTION_MODE): niepotwierdzone 7 dni od pierwszego wysłania, potwierdzone 30 dni od potwierdzenia, IP/UA zgody 7 dni.',
  },
  'matching-search': {
    name: 'Dopasowanie i zapisane wyszukiwania',
    inCode: 'Deterministyczny scoring (src/lib/matching), materializacja matches, zapisane wyszukiwania i alerty e-mail.',
    processors: [...HOSTING, 'resend', 'emaillabs'],
    retentionInCode: null,
  },
  'employer-contact': {
    name: 'Kontakt pracodawca–kandydat',
    inCode: 'Propozycje pracy, rozmowy i wiadomości z załącznikami (PDF/DOC/DOCX/JPG/PNG w prywatnym buckecie), blokowanie firm przez kandydata.',
    processors: [...HOSTING, 'resend', 'emaillabs'],
    retentionInCode:
      'Propozycje wygasają (expires_at), dane nie są usuwane. Niewysłane załączniki wiadomości usuwane po 24 h (purge_stale_message_attachments); załączniki znikają z wiadomością/rozmową (także z kontem), obiekt przez storage_deletion_queue.',
  },
  companies: {
    name: 'Konta firm, zespół i weryfikacja',
    inCode: 'Zakładanie firmy, członkowie i zaproszenia, weryfikacja przez administratora, sprawdzenie VAT w VIES, oferty pracy.',
    processors: [...HOSTING, 'resend', 'emaillabs', 'vies'],
    retentionInCode: 'Zaproszenia wygasają po 14 dniach (status), nie są usuwane.',
  },
  'email-notifications': {
    name: 'E-maile i powiadomienia',
    inCode: 'Kolejka email_deliveries, worker wysyłki, powiadomienia in-app, preferencje z dowodem zmiany zgody, wypisanie, budżet na odbiorcę, kampanie, blokady adresów po odbiciach/skargach.',
    processors: [...HOSTING, 'resend', 'emaillabs'],
    retentionInCode: 'email_send_windows czyszczone po 1 dniu; email_recipient_windows odbiorcy starsze niż 31 dni usuwane przy kolejkowaniu; kod nie usuwa email_deliveries ani email_consent_events (retencja odłożona — CLAUDE.md).',
  },
  consents: {
    name: 'Zgody cookies i akceptacja dokumentów',
    inCode: 'Receipt zgody cookies (record_consent) i akceptacji regulaminu przy rejestracji — z IP i User-Agent.',
    processors: HOSTING,
    retentionInCode:
      'Receipt akceptacji przy rejestracji: IP (tylko zaufany nagłówek proxy) i User-Agent wyzerowane po 7 dniach ' +
      '(acceptance_ip_user_agent, 0132; harmonogram za RETENTION_MODE, domyślnie wyłączony), receipt zostaje; ' +
      'w metadanych konta tylko w transakcji rejestracji. Receipt cookies (consents) — do ustalenia.',
  },
  'dsa-moderation': {
    name: 'Zgłoszenia treści (DSA) i moderacja',
    inCode: 'Publiczny formularz zgłoszenia, sprawy z numerem i kodem dostępu, decyzje moderacyjne z uzasadnieniem, e-maile do stron; zgłoszenia wiadomości i rozmów przez ich strony (dowód z treścią tylko zgłoszonej wiadomości, wgląd tylko administratora).',
    processors: [...HOSTING, 'resend', 'emaillabs', 'cloudflare-turnstile'],
    retentionInCode: null,
  },
  'support-contact': {
    name: 'Formularz kontaktu',
    inCode:
      'Publiczny formularz /kontakt (także bez konta): temat, treść, imię (opcjonalnie), e-mail, język formularza; potwierdzenie do nadawcy i powiadomienie adminów (w kolejce tylko numer i temat); obsługa w /admin/kontakt.',
    processors: [...HOSTING, 'resend', 'cloudflare-turnstile'],
    retentionInCode: null,
  },
  'security-audit': {
    name: 'Bezpieczeństwo, audyt i limity',
    inCode: 'Dziennik audytu (triggery), limiter zapytań, zdarzenia systemowe, inbox webhooków, raportowanie błędów.',
    processors: [...HOSTING, 'discord-webhook', 'cloudflare-turnstile'],
    retentionInCode: '/api/maintenance (0163): rate_limit_gc — okna limitera starsze niż doba; processed_webhooks_gc — rozstrzygnięte wpisy inboxu webhooków starsze niż 30 dni. audit_logs bez usuwania w kodzie.',
  },
  'ai-job-import': {
    name: 'Import ogłoszenia przez AI',
    inCode: 'Pracodawca przesyła zrzut ekranu lub link; tekst jest minimalizowany przed wysyłką (zrzut — nie), wynik trafia do szkicu oferty (bez publikacji). Za flagą, domyślnie wyłączone.',
    processors: [...HOSTING, 'openai'],
    retentionInCode: 'Portal nie zapisuje przesłanego obrazu ani pobranej strony — tylko wynik w szkicu oferty.',
  },
  'ai-translation': {
    name: 'Tłumaczenia AI (rdzeń)',
    inCode: 'Kolejka tłumaczeń pól tekstowych ofert i profili (rewizje źródła, zadania per język, przekłady, korekty ręczne; 0145). Wpięcie ofert/profili dopiero w #33/#34; za flagą, domyślnie wyłączone.',
    processors: [...HOSTING, 'openai'],
    retentionInCode:
      'deactivate_translation_source(purge) usuwa rewizje, zadania i przekłady encji (wywołanie przy usunięciu konta/oferty — do wpięcia w #33/#34). Wynik odrzuconej rewizji nie jest przechowywany (poza propozycją przy korekcie ręcznej).',
  },
  'job-statistics': {
    name: 'Statystyki ofert (lejek)',
    inCode: 'Zliczanie wyświetleń/wystąpień w wynikach per oferta i dzień, bez IP, cookies i identyfikatora osoby. Zdarzenie wysyłane wyłącznie po zgodzie w kategorii analitycznej banera cookies (#575).',
    processors: HOSTING,
    retentionInCode: 'job_funnel_receipts (nonce deduplikacji) najwyżej 48 h, job_funnel_daily — bieżący i 12 poprzednich miesięcy kalendarzowych (purge_job_funnel_data w /api/maintenance).',
  },
  'analytics-marketing': {
    name: 'Analityka po zgodzie',
    inCode:
      'Beacon Cloudflare Web Analytics ładowany dopiero po zgodzie w kategorii analytics (#570: zamiast Google Analytics i Meta Pixel — usunięte); bezcookie\'owy.',
    processors: ['cloudflare-web-analytics'],
    retentionInCode: 'Cookie zgody ważne 180 dni.',
  },
  'data-rights': {
    name: 'Prawa osób i retencja',
    inCode:
      'Eksport danych kandydata (JSON), samoobsługowe usunięcie konta kandydata, okresy retencji jako dane, kolejka usuwania obiektów storage, rejestr usunięć do ponownego zastosowania po odtworzeniu kopii.',
    processors: HOSTING,
    retentionInCode:
      'run_retention_purge (/api/maintenance): okresy z retention_policies (wartości #574, 0127); harmonogram WYŁĄCZONY do jawnego RETENTION_MODE=dry-run|apply. Ślad wniosków 1095 dni; rejestr usunięć bez usuwania (minimum 400 dni do zmiany po RET-09/RET-10).',
  },
  backups: {
    name: 'Kopie zapasowe bazy',
    inCode:
      'scripts/db/backup.sh: zaszyfrowany (age) zrzut logiczny całej bazy; kopia i manifest wysyłane do prywatnego bucketu Cloudflare R2 (BACKUP_S3_*, #569).',
    processors: ['railway', 'cloudflare-r2'],
    retentionInCode:
      'BACKUP_RETENTION najnowszych kopii (domyślnie 14) lokalnie i w buckecie R2; opcjonalnie BACKUP_S3_MAX_AGE_DAYS (najnowsza kopia zostaje zawsze).',
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
    note:
      'Odbiorca „zweryfikowana firma” (wyszukiwanie profili, #494) tylko w trybie RECRUITMENT; w trybie ogłoszeniowym (decyzja produktowa, 0171/0173) firmy nie widzą profili, a włączenie widoczności jest odrzucane.',
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
    activities: ['cv-files', 'employer-contact'],
    subjects: ['candidate', 'employer'],
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
    note: 'Treść pliku leży w prywatnym buckecie Railway, w tabeli są metadane. entity_type: candidate_cv (CV) albo message_attachment (załącznik rozmowy, entity_id = rozmowa).',
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
  'public.match_recompute_queue': {
    activities: ['matching-search'],
    subjects: ['candidate'],
    columns: { subject_id: 'reference' },
    notPersonal: {
      kind: 'Rodzaj podmiotu (kandydat albo oferta).',
      version: 'Licznik zgłoszeń.',
      attempts: 'Licznik prób.',
      locked_until: 'Dzierżawa workera.',
    },
    note: 'Kolejka przeliczenia dopasowań (P1-03, 0147): sam UUID kandydata albo oferty; wiersz znika po przeliczeniu.',
  },
  'public.saved_searches': {
    activities: ['matching-search'],
    subjects: ['candidate'],
    columns: { profile_id: 'reference', name: 'preferences', filters: 'preferences', query: 'preferences', locale: 'preferences' },
    notPersonal: { filters_hash: 'Skrót filtrów do deduplikacji wyszukiwań — nie identyfikuje osoby poza wierszem.' },
  },
  'public.candidate_application_journal': {
    activities: ['candidate-profile', 'data-rights'],
    subjects: ['candidate'],
    columns: {
      profile_id: 'reference',
      job_title: 'professional',
      company_name: 'professional',
      source_url: 'preferences',
      location: 'professional',
      note: 'correspondence',
    },
    notPersonal: {
      client_key: 'Losowy klucz idempotencji operacji zapisu — nie identyfikuje osoby poza wierszem.',
      stage: 'Etap wybrany przez kandydata (planowana/wysłana/rozmowa/oferta/zamknięta) — notatka własna, nie status procesu.',
      applied_on: 'Data wpisana przez kandydata.',
      remind_on: 'Data przypomnienia wpisana przez kandydata.',
    },
    note: 'Prywatny dziennik aplikacji wysłanych poza portalem (#904, 0196): tylko właściciel (RLS, zapis wyłącznie RPC), bez ścieżki dla firm, bez powiązania z ofertą ani procesem; eksport w export_my_data, usunięcie kaskadą z kontem.',
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
  'public.message_attachments': {
    activities: ['employer-contact'],
    subjects: ['candidate', 'employer'],
    columns: { uploader_id: 'reference', file_id: 'reference', message_id: 'reference' },
    notPersonal: {
      client_upload_id: 'Losowy klucz idempotencji uploadu.',
      position: 'Kolejność pliku w wiadomości.',
      linked_at: 'Czas wysłania z wiadomością.',
    },
    note: 'Powiązanie pliku (public.files) z rozmową i wiadomością; treść i nazwa pliku w public.files/buckecie.',
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
      // 0167: deklaracja agencji pracy tymczasowej i ręczne sprawdzenie numeru przez admina.
      agency_recognition_number: 'company',
      agency_checked_by: 'reference',
      agency_check_note: 'moderation',
      // Publiczny profil firmy (#591): opis i logo mogą identyfikować osobę (jednoosobowa działalność).
      slug: 'company',
      description: 'company',
      logo_url: 'company',
      region: 'company',
      // 0156 (#729): propozycja nowej strony WWW/logo czeka na decyzję admina — niepubliczna do
      // zatwierdzenia; stan i historia decyzji to dane moderacji, uzasadnienie odrzucenia pisze admin.
      website_pending: 'company',
      logo_url_pending: 'company',
      links_review_status: 'moderation',
      links_pending_at: 'moderation',
      links_review_reason: 'moderation',
      links_reviewed_at: 'moderation',
      // 0198 (#868): propozycja opisu firmy czeka na decyzję admina (jak linki z 0156).
      description_pending: 'company',
      description_review_status: 'moderation',
      description_pending_at: 'moderation',
      description_review_reason: 'moderation',
      description_reviewed_at: 'moderation',
      verified_at: 'moderation',
    },
    notPersonal: {
      id: 'Identyfikator techniczny firmy.',
      status: 'Status weryfikacji firmy (słownik).',
      country: 'Kod kraju siedziby.',
      size_label: 'Przedział wielkości firmy (słownik).',
      industry: 'Branża (słownik).',
      is_demo: 'Znacznik danych demonstracyjnych.',
      created_at: 'Czas utworzenia wiersza.',
      updated_at: 'Czas ostatniej zmiany wiersza.',
      deleted_at: 'Znacznik miękkiego usunięcia.',
      moderation_decision_id: 'Powiązanie z decyzją moderacyjną (public.moderation_decisions), nie z osobą.',
      is_agency: 'Deklaracja agencji pracy tymczasowej (0167).',
      agency_check_status: 'Wynik ręcznego sprawdzenia numeru uznania (słownik, 0167).',
      agency_checked_at: 'Czas ręcznego sprawdzenia numeru uznania (0167).',
      description_locale: 'Język opisu firmy zadeklarowany przez firmę (#708, 0975) — kod języka serwisu.',
    },
    note:
      'Każda kolumna tabeli ma wpis w columns albo notPersonal (strażnik tests/unit/privacy-data-map.test.ts, #729). ' +
      'Propozycje strony WWW/logo i opisu (`*_pending`) oraz uzasadnienia odrzucenia (`links_review_reason`, `description_review_reason`) są czyszczone po ' +
      'wycofaniu propozycji albo zastępowane kolejną decyzją (0156, 0198); do czasu decyzji widzi je tylko owner/admin firmy ' +
      'i admin portalu. Retencja firm: DO USTALENIA (#486).',
  },
  'public.company_members': {
    activities: ['companies'],
    subjects: ['employer'],
    columns: { profile_id: 'reference', role: 'identity', is_active: 'identity', invited_by: 'reference', joined_at: 'identity' },
  },
  'public.company_invitations': {
    activities: ['companies'],
    subjects: ['invitee', 'employer'],
    columns: {
      email: 'contact',
      role: 'identity',
      invited_by: 'reference',
      responded_by: 'reference',
      locale: 'preferences',
      signup_token_hash: 'credentials',
      signup_token_used_at: 'credentials',
    },
    note: 'Język zaproszenia wybiera zapraszający (adres bez konta, 0121); w bazie tylko hash tokenu linku rejestracji, usuwany po rozstrzygnięciu zaproszenia.',
  },
  'public.company_message_templates': {
    activities: ['employer-contact'],
    subjects: ['employer'],
    columns: { created_by: 'reference' },
    notPersonal: {
      name: 'Nazwa szablonu odpowiedzi nadana przez firmę.',
    },
    note: 'Szablony odpowiedzi firmy (0170): odczyt recruiter+ firmy, zapis RPC; usuwane kaskadą z firmą.',
  },
  'public.company_message_template_variants': {
    activities: ['employer-contact'],
    subjects: ['employer'],
    columns: { body: 'correspondence' },
    notPersonal: {
      locale: 'Język wariantu szablonu (pl/nl/fr/en).',
    },
    note: 'Treść szablonu pisze rekruter (tekst wolny); numer rejestru/dokumentu odrzucany w akcji (#495). Kasowane z szablonem.',
  },
  'public.company_vies_checks': {
    activities: ['companies'],
    subjects: ['employer'],
    columns: { vat_number: 'company', vies_name: 'company', checked_by: 'reference' },
  },
  'public.company_vies_auto_queue': {
    activities: ['companies'],
    subjects: ['employer'],
    columns: { vat_number: 'company' },
    notPersonal: {
      attempts: 'Liczba prób automatycznego sprawdzenia VIES.',
      next_attempt_at: 'Termin kolejnej próby (backoff).',
      lease_until: 'Dzierżawa zadania workera.',
      last_outcome: 'Ostatni wynik nierozstrzygający (niedostępność / limit / błąd).',
    },
    note: 'Kolejka zadań (0191, #706/#879): tylko numer przedsiębiorstwa; wiersz znika po wyniku, usunięciu numeru albo firmy.',
  },
  'public.jobs': {
    activities: ['companies'],
    subjects: ['employer'],
    columns: {
      created_by: 'reference',
      contact_email: 'contact',
      address: 'company',
      // #1129 (0172): kanał aplikowania — publiczny w ofercie publicznej (get_public_job).
      apply_url: 'company',
      apply_email: 'contact',
      apply_phone: 'contact',
    },
    note: 'Treść oferty to dane firmy; kontaktowy e-mail i autor mogą identyfikować rekrutera. Kanał aplikowania (e-mail, telefon) jest publiczny w ofercie i może wskazywać osobę po stronie firmy.',
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
    notPersonal: {
      lock_token: 'Token dzierżawy workera (0129, #615) — losowy identyfikator do CAS, nie dane osobowe.',
    },
    note: 'Pola payloadu dla każdego szablonu — sekcja „Treść e-maili” (generowana z migracji).',
  },
  'public.email_suppressions': {
    activities: ['email-notifications'],
    subjects: ['candidate', 'guest', 'employer', 'reporter', 'invitee'],
    columns: { email: 'contact', reason: 'technical', lifted_by: 'reference', lift_reason: 'moderation' },
  },
  'public.email_pending_events': {
    activities: ['email-notifications'],
    subjects: ['candidate', 'guest', 'employer', 'reporter', 'invitee'],
    columns: {
      provider: 'technical',
      provider_message_id: 'technical',
      event: 'technical',
      occurred_at: 'technical',
      recipient: 'contact',
      bounce_type: 'technical',
      received_at: 'technical',
    },
    note: 'Zdarzenie doręczenia odebrane przed zapisem identyfikatora wiadomości (0195); przypisywane triggerem, czyszczone po 30 dniach.',
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
    note: 'Potwierdzenie przedziału wieku 16–17 / 18+ (0126, #492/#576): dolna granica przedziału i czas, bez daty urodzenia; niezmienne.',
  },
  'public.age_policy': {
    activities: ['account', 'security-audit'],
    subjects: ['admin'],
    columns: { updated_by: 'reference' },
    note: 'Próg konta kandydata jako dane (0126, #492/#576: 16 albo 18); zmienia go administrator z uzasadnieniem i audytem.',
  },
  'public.portal_legal_mode': {
    activities: ['security-audit'],
    subjects: ['admin'],
    columns: { changed_by: 'reference' },
    note: 'Tryb portalu jako dane (0171, #1140/#1143): CLASSIFIEDS_ONLY albo RECRUITMENT; zmiana tylko RPC service_role z uzasadnieniem i audytem.',
  },
  'public.document_acceptances': {
    activities: ['consents', 'account'],
    subjects: ['candidate', 'employer'],
    columns: {
      profile_id: 'reference',
      // #493 (0108): rodzaj elementu (regulamin / informacja o prywatności / dawny wspólny) i kanał.
      kind: 'consent',
      source: 'consent',
      document_version: 'consent',
      accepted_at: 'consent',
      ip_address: 'technical',
      user_agent: 'technical',
    },
  },

  // --- DSA i moderacja ------------------------------------------------------------------------
  'public.reports': {
    activities: ['dsa-moderation'],
    // Zgłoszenie wiadomości (0116): zgłaszający i nadawca to kandydat albo członek firmy.
    subjects: ['reporter', 'employer', 'candidate'],
    columns: {
      conversation_id: 'reference',
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
      // Dowód: stan oferty/firmy (DSA) albo treść zgłoszonej wiadomości i id nadawcy (0116).
      target_snapshot: 'correspondence',
    },
  },
  'public.contact_messages': {
    activities: ['support-contact'],
    subjects: ['visitor', 'candidate', 'employer', 'admin'],
    columns: {
      sender_id: 'reference',
      sender_name: 'identity',
      sender_email: 'contact',
      topic: 'correspondence',
      message: 'correspondence',
      locale: 'preferences',
      handled_by: 'reference',
    },
    note: 'Wiadomości z formularza kontaktu (0125). Retencja i powiązanie z eksportem/usunięciem konta — do decyzji właściciela (#486).',
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
  'public.moderation_appeals': {
    activities: ['dsa-moderation'],
    subjects: ['employer', 'reporter', 'admin'],
    columns: {
      appellant_id: 'reference',
      appellant_locale: 'preferences',
      grounds: 'correspondence',
      outcome_reasoning: 'moderation',
      decided_by: 'reference',
    },
    note: 'Uzasadnienia odwołania i rozpatrzenia są anonimizowane przez dsa_retention_run po końcu drogi odwołania i okresie retencji (#43).',
  },
  'public.moderation_informed': {
    activities: ['dsa-moderation'],
    subjects: [],
    columns: {},
    note: 'Niezmienny dowód poinformowania strony decyzji/cofnięcia (początek biegu terminu odwołania, 0188/#1045/#1063): identyfikatory decyzji, podstawa (e-mail wysłany / odczyt w panelu / reguła zastępcza) i czas — bez danych osobowych i bez treści.',
  },
  'public.ai_budget_limits': DICTIONARY('globalne limity kosztów AI, #36'),
  'public.ai_usage_ledger': {
    activities: ['ai-job-import'],
    subjects: [],
    columns: {},
    note: 'Liczniki wywołań modeli AI (funkcja, model, wynik, tokeny, koszt, doba) — bez treści i identyfikatorów osób/firm (#36).',
  },
  'public.dsa_retention_runs': {
    activities: ['dsa-moderation'],
    subjects: [],
    columns: {},
    note: 'Wyłącznie liczniki przebiegów retencji (bez danych osobowych).',
  },

  // --- Rejestr naruszeń (#490, 0106) --------------------------------------------------------
  'public.breach_incidents': {
    activities: ['security-audit'],
    subjects: ['admin'],
    columns: { created_by: 'reference', description: 'correspondence', actions_taken: 'correspondence' },
    note: 'Opis zdarzenia i skali bez kopii danych osób (interfejs prosi o opis zakresu). Dostęp tylko admin (RPC, odczyt service-role).',
  },
  'public.breach_incident_events': {
    activities: ['security-audit'],
    subjects: ['admin'],
    columns: { actor_id: 'reference', changes: 'technical', note: 'correspondence' },
    note: 'Niezmienna historia zmian wpisu (pole: przed/po).',
  },
  'public.breach_notices': {
    activities: ['security-audit', 'email-notifications'],
    subjects: ['admin'],
    columns: { created_by: 'reference', content: 'correspondence' },
    note: 'Treść zawiadomienia wpisana przez administratora (per język), bez listy adresów.',
  },
  'public.breach_notice_recipients': {
    activities: ['security-audit', 'email-notifications'],
    subjects: ['candidate', 'employer'],
    columns: { profile_id: 'reference', locale: 'preferences', queued: 'technical' },
    note: 'Kto dostał zawiadomienie o naruszeniu (konto + język), bez adresu e-mail.',
  },

  // --- Bezpieczeństwo i audyt ----------------------------------------------------------------
  'public.retention_policies': {
    activities: ['data-rights'],
    subjects: ['admin'],
    columns: { updated_by: 'reference' },
    note: 'Konfiguracja okresów retencji; jedyną daną osobową jest identyfikator admina, który zmienił okres.',
  },
  'public.data_rights_requests': {
    activities: ['data-rights'],
    subjects: ['candidate'],
    columns: { subject_id: 'reference' },
    notPersonal: { details: 'Same liczniki usuniętych obiektów (bez treści danych).' },
    note: 'Ślad obsługi wniosku bez FK do profilu — przetrwa usunięcie konta.',
  },
  'public.erasure_tombstones': {
    activities: ['data-rights', 'backups'],
    subjects: ['candidate'],
    columns: { subject_id: 'reference' },
    note: 'Tylko UUID usuniętej osoby — do ponownego usunięcia po odtworzeniu kopii.',
  },
  'public.storage_deletion_queue': {
    activities: ['data-rights', 'cv-files'],
    subjects: ['candidate'],
    columns: { path: 'file' },
    notPersonal: { bucket: 'Nazwa bucketa.' },
    note: 'Klucz obiektu do usunięcia (zawiera UUID właściciela); wiersz znika po usunięciu obiektu.',
  },
  'public.retention_warnings': {
    activities: ['data-rights', 'account', 'cv-files'],
    subjects: ['candidate'],
    columns: { profile_id: 'reference' },
    notPersonal: { policy_key: 'Kategoria retencji.' },
    note: 'Ostrzeżenie przed usunięciem z powodu braku aktywności (#574): aktywność, czas ostrzeżenia i termin; znika z kontem.',
  },
  'public.storage_gc_sweeps': {
    activities: ['cv-files'],
    subjects: ['candidate'],
    columns: { cursor_key: 'file' },
    notPersonal: {
      bucket: 'Nazwa bucketa.',
      dry_run: 'Tryb przebiegu GC.',
      locked_until: 'Dzierżawa przebiegu.',
      pages: 'Licznik stron.',
      objects_scanned: 'Licznik obiektów.',
      orphan_objects: 'Licznik sierot.',
      orphan_queued: 'Licznik sierot w kolejce.',
      missing_objects: 'Licznik wierszy bez obiektu.',
      started_at: 'Czas startu przebiegu.',
      finished_at: 'Czas końca przebiegu.',
    },
    note: 'Przebieg GC bucketu CV (#17): same liczniki; kursor = ostatni sprawdzony klucz (UUID właściciela), czyszczony po zakończeniu przebiegu, historia 90 dni.',
  },
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
    note: 'Klucz = akcja + adres IP (+ identyfikator) bez haszowania (src/lib/rate-limit.ts, pula service); wariant HMAC src/lib/db/rate-limit.ts niepodłączony.',
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
  'public.ops_job_runs': {
    activities: ['security-audit'],
    subjects: [],
    columns: {},
    note: 'Ostatni przebieg zadań utrzymaniowych (0180, #47): czas, wynik, czas trwania i stała nazwa zadania z błędem — jeden wiersz na zadanie, bez danych osobowych.',
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
  'public.translation_sources': {
    activities: ['ai-translation'],
    subjects: ['candidate', 'employer'],
    columns: { entity_id: 'reference' },
    note: 'Głowa encji tłumaczonej (oferta albo profil kandydata): bieżąca rewizja i aktywność.',
  },
  'public.translation_source_revisions': {
    activities: ['ai-translation'],
    subjects: ['candidate', 'employer'],
    columns: { entity_id: 'reference', fields: 'professional' },
    notPersonal: { content_hash: 'SHA-256 kanonicznej treści do wykrywania braku zmian, nie sekret.' },
    note: 'Niezmienne kopie pól źródła (treść oferty albo profilu — wolny tekst może zawierać dane osobowe).',
  },
  'public.translation_jobs': {
    activities: ['ai-translation'],
    subjects: ['candidate', 'employer'],
    columns: { entity_id: 'reference', result: 'professional', last_error_code: 'technical' },
    note: 'Zadania kolejki; `result` tylko jako propozycja przy zablokowanej korekcie ręcznej.',
  },
  'public.translation_documents': {
    activities: ['ai-translation'],
    subjects: ['candidate', 'employer'],
    columns: { entity_id: 'reference', fields: 'professional', manual_author: 'reference' },
    note: 'Aktualny przekład per język; korekta ręczna z autorem i wersją.',
  },
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
    note:
      'Treść pytań ustalonych przez firmę; odpowiedzi — application_screening_answers. W trybie ogłoszeniowym (decyzja produktowa, 0173) nowe pytania nie są zapisywane, a zapisane nie są pokazywane.',
  },
  'public.screening_question_reviews': {
    activities: ['companies'],
    subjects: ['employer', 'admin'],
    columns: { requested_by: 'reference', decided_by: 'reference', decision_reason: 'moderation' },
    note:
      'Przegląd pytania oznaczonego przez detektor (#497, 0103): kopia treści pytania firmy, kto zapisał pytanie i kto zdecydował, uzasadnienie admina. Bez odpowiedzi kandydatów.',
  },
  'public.job_content_reviews': {
    activities: ['companies'],
    subjects: ['employer', 'admin'],
    columns: {
      requested_by: 'reference',
      decided_by: 'reference',
      decision_reason: 'moderation',
      ai_reason: 'moderation',
    },
    note:
      'Przegląd treści oferty z sygnałem oszustwa (0167): migawka treści ogłoszenia firmy (content), kategorie sygnału reguł i AI, krótkie uzasadnienie AI bez danych kontaktowych, kto zapisał treść i kto zdecydował, uzasadnienie admina. Bez danych kandydatów.',
  },
  'public.job_duplications': {
    activities: ['companies'],
    subjects: ['employer'],
    columns: { created_by: 'reference' },
    note:
      'Klucz idempotencji „Kopiuj jako szkic” (0148): oferta źródłowa, nowy szkic, kto skopiował i losowy klucz operacji. Bez treści oferty.',
  },

  // --- Płatności: schemat billingu usunięty (#51, migracja 0177) — zostaje tylko katalog limitów ---
  'public.plan_entitlements': DICTIONARY('limity planów'),

  // --- Słowniki i konfiguracja --------------------------------------------------------------
  'public.categories': DICTIONARY('kategorie'),
  'public.certificates': DICTIONARY('certyfikaty'),
  'public.languages': DICTIONARY('języki'),
  'public.locations': DICTIONARY('miejscowości'),
  'public.location_aliases': DICTIONARY('nazwy miejscowości PL/NL/FR/EN'),
  'public.joint_committees': DICTIONARY('komisje parytetowe PC/CP (kod i nazwy PL/NL/FR/EN), 0169'),
  'public.language_aliases': DICTIONARY('nazwy języków PL/NL/FR/EN (0168)'),
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
