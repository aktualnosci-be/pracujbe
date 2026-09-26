/**
 * Inwentarz funkcji AI (#489) — jedno źródło prawdy o tym, gdzie repozytorium woła model
 * językowy i jaką rolę ma w tym człowiek. Dane, nie konfiguracja: nic tu nie włącza funkcji.
 *
 * Strażnik `tests/unit/ai-inventory.test.ts` skanuje `src/` i `scripts/` i odrzuca każde
 * wywołanie modelu (import SDK dostawcy AI albo adres jego API) w pliku, którego nie ma
 * w `callSites` żadnej pozycji. Nowa funkcja AI = nowa pozycja tutaj + wiersz w szkicu
 * `docs/legal-drafts/ai-act-art22-dpia.md`.
 *
 * Opisy są faktami z kodu (stan na dzień wpisu). Kwalifikacja prawna (AI Act, art. 22 RODO,
 * DPIA) nie należy do tego pliku — to pytania do prawnika w szkicu.
 */

export type AiFeatureStatus =
  /** Kod na `main`, funkcja za flagą środowiskową (domyślnie wyłączona). */
  | 'behind_flag'
  /** Kod w otwartym PR — plik może jeszcze nie istnieć na tej gałęzi. */
  | 'in_progress';

export type AiInputSubject =
  /** Treść ogłoszenia osoby trzeciej (zrzut ekranu, tekst strony). */
  | 'third_party_listing'
  /** Treść oferty napisana przez pracodawcę. */
  | 'job_offer_text'
  /** Pola profilu kandydata napisane przez kandydata. */
  | 'candidate_profile_text'
  /** Tekst CV kandydata wgrany przez kandydata, po lokalnej minimalizacji (#487, #498). */
  | 'candidate_cv_text';

export interface AiFeature {
  /** Stały identyfikator — trafia do logu użycia (`src/lib/ai/usage-log.ts`). */
  id: AiFeatureId;
  issues: readonly string[];
  status: AiFeatureStatus;
  /** Pliki (ścieżki od katalogu repo), w których pada wywołanie modelu. */
  callSites: readonly string[];
  /** Zmienna, bez której funkcja nie działa (domyślnie wyłączona). */
  enableFlag: string;
  /**
   * Dostawca modelu. Decyzja właściciela 2026-09-26: funkcje AI używają wyłącznie OpenAI
   * (GPT-6 Luna) przez wspólnego klienta `src/lib/ai/openai.ts`.
   */
  provider: 'openai';
  inputs: readonly AiInputSubject[];
  /** Co model zwraca i gdzie to trafia. */
  output: string;
  /**
   * Czy wynik modelu przechodzi przez człowieka, zanim cokolwiek zostanie opublikowane lub
   * wpłynie na osobę. `true` tylko gdy kod tego wymaga (nie „dobra praktyka”).
   */
  humanInTheLoop: boolean;
  /** Gdzie w kodzie jest punkt decyzji człowieka. */
  humanStep: string;
  /** Czy wynik modelu jest używany do oceny, rankingu, filtrowania lub decyzji o osobie. */
  decidesAboutPerson: false;
  /** Pisze log użycia bez treści i PII (`recordAiUsage`). */
  usageLogged: boolean;
  /**
   * Każde wywołanie przechodzi przez globalny budżet kosztów (#36, `withAiBudget` w
   * `src/lib/ai/budget.ts`): rezerwacja przed API, odmowa po przekroczeniu limitu. Wymagane
   * (`true`) dla funkcji ze statusem `behind_flag` — pilnuje `ai-inventory.test.ts`.
   */
  costBudgeted: boolean;
}

export const AI_FEATURE_IDS = ['job_listing_import', 'content_translation', 'job_offer_assist', 'cv_profile_import'] as const;
export type AiFeatureId = (typeof AI_FEATURE_IDS)[number];

export const AI_FEATURES: readonly AiFeature[] = [
  {
    id: 'job_listing_import',
    issues: ['#465', '#469'],
    status: 'behind_flag',
    callSites: ['src/lib/ai/openai.ts', 'src/lib/ai-import/extract.ts'],
    enableFlag: 'AI_JOB_IMPORT_ENABLED',
    provider: 'openai',
    inputs: ['third_party_listing'],
    output:
      'Pola kreatora oferty (JSON ze schematu) + lista pól do sprawdzenia; zapis wyłącznie do szkicu oferty przez save_job_draft.',
    humanInTheLoop: true,
    humanStep:
      'Szkic w kreatorze (src/lib/actions/job-import.ts nie woła publish_job); publikację wykonuje rekruter przyciskiem „Opublikuj” (publish_job).',
    decidesAboutPerson: false,
    usageLogged: true,
    costBudgeted: true,
  },
  {
    id: 'content_translation',
    issues: ['#31', '#32', '#514'],
    status: 'behind_flag',
    callSites: ['src/lib/ai/openai.ts', 'src/lib/translation/openai-provider.ts'],
    enableFlag: 'AI_TRANSLATION_ENABLED',
    provider: 'openai',
    inputs: ['job_offer_text', 'candidate_profile_text'],
    output:
      'Tłumaczenie pól tekstowych na inne języki portalu; przed zapisem walidacja faktów (liczby, kwoty, certyfikaty).',
    humanInTheLoop: false,
    humanStep:
      'Walidacja automatyczna i korekta ręczna po fakcie (PR #514) — do potwierdzenia po scaleniu, czy tłumaczenie jest publikowane bez przeglądu.',
    decidesAboutPerson: false,
    usageLogged: true,
    // `withAiBudget` w src/lib/translation/openai-provider.ts (#36): rezerwacja przed
    // wywołaniem modelu; odmowa budżetu = odroczenie zadania bez zużycia próby.
    costBudgeted: true,
  },
  {
    id: 'job_offer_assist',
    issues: ['#37'],
    status: 'behind_flag',
    callSites: ['src/lib/ai/openai.ts', 'src/lib/ai-assist/assist.ts'],
    enableFlag: 'AI_JOB_ASSIST_ENABLED',
    provider: 'openai',
    inputs: ['job_offer_text'],
    output:
      'Propozycja nowego brzmienia opisu, obowiązków i wymagań oferty (JSON ze schematu) w języku oferty; propozycje z nowymi liczbami/linkami albo danymi kontaktowymi są odrzucane przez serwer.',
    humanInTheLoop: true,
    humanStep:
      'Propozycja trafia wyłącznie do panelu w kreatorze (src/components/employer/JobAssistPanel.tsx); pole zmienia się dopiero po kliknięciu „Użyj propozycji”, a zapis robi rekruter przyciskiem „Dalej”/„Zapisz”. Akcja src/lib/actions/job-assist.ts nie zapisuje do bazy i nie woła publish_job.',
    decidesAboutPerson: false,
    usageLogged: true,
    // Bramka `src/lib/ai-assist/budget.ts` = rezerwacja w globalnym budżecie (#36).
    costBudgeted: true,
  },
  {
    id: 'cv_profile_import',
    issues: ['#487', '#498'],
    status: 'behind_flag',
    callSites: ['src/lib/ai/openai.ts', 'src/lib/cv-import/extract.ts'],
    enableFlag: 'AI_CV_IMPORT_ENABLED',
    provider: 'openai',
    inputs: ['candidate_cv_text'],
    output:
      'Propozycje pól profilu (zawody, umiejętności, języki, certyfikaty, lata doświadczenia) ze źródłem i niepewnością; nic nie jest zapisywane bez zatwierdzenia.',
    humanInTheLoop: true,
    humanStep:
      'Kandydat widzi tekst przed wysłaniem i zaznacza każdą propozycję osobno (CvImportPanel); zapis tylko zaznaczonych przez applyCvProposals → apply_candidate_cv_proposals.',
    decidesAboutPerson: false,
    usageLogged: true,
    // `withAiBudget` w src/lib/actions/cv-import.ts (#36): rezerwacja przed wywołaniem modelu.
    costBudgeted: true,
  },
];

/**
 * Funkcje, które dotyczą kandydatów i mogłyby wyglądać na zautomatyzowane decyzje, ale NIE
 * używają modelu. Strażnik sprawdza, że żaden z tych plików nie woła modelu — gdyby zaczął,
 * test wymusi dopisanie funkcji do `AI_FEATURES` i ponowną ocenę w szkicu DPIA.
 */
export interface DeterministicFeature {
  id: string;
  files: readonly string[];
  /** Fakt z kodu: co liczy i kto podejmuje decyzję. */
  fact: string;
}

export const NON_AI_CANDIDATE_FEATURES: readonly DeterministicFeature[] = [
  {
    id: 'matching_score',
    files: ['src/lib/matching/score.ts', 'src/lib/data/matching.ts'],
    fact:
      'Wynik 0–100 z jawnych wag (CLAUDE.md §8), czysta funkcja bez I/O i losowości. Pokazywany kandydatowi na szczególe oferty; nie zmienia statusu aplikacji.',
  },
  {
    id: 'application_status',
    files: ['src/lib/actions/applications.ts'],
    fact:
      'Status aplikacji zmienia wyłącznie rekruter (transition_application, recruiter+). W bazie nie ma automatycznego odrzucenia.',
  },
  {
    id: 'screening_questions',
    files: ['src/lib/screening/questions.ts'],
    fact:
      'Odpowiedzi są zapisywane i pokazywane rekruterowi; bez reguł dyskwalifikujących, nie zmieniają dopasowania ani statusu.',
  },
  {
    id: 'saved_search_alerts',
    files: ['src/lib/job-list-query.ts'],
    fact: 'Alert = te same filtry co lista ofert (get_public_jobs); dotyczy ofert, nie ocenia kandydata.',
  },
];

/** Wszystkie pliki z wywołaniem modelu zadeklarowane w inwentarzu. */
export function declaredCallSites(): Set<string> {
  return new Set(AI_FEATURES.flatMap((f) => f.callSites));
}

/**
 * Wykrywanie wywołania modelu w treści pliku. Celowo szerokie (import SDK dowolnego znanego
 * dostawcy albo adres jego API) — fałszywy alarm kosztuje jeden wpis, przeoczenie kosztuje
 * niezgłoszoną funkcję AI.
 */
export const MODEL_CALL_PATTERNS: readonly RegExp[] = [
  /from\s+['"]@anthropic-ai\/[^'"]+['"]/,
  /require\(\s*['"]@anthropic-ai\/[^'"]+['"]\s*\)/,
  /import\(\s*['"]@anthropic-ai\/[^'"]+['"]\s*\)/,
  // SDK OpenAI (także podścieżki `openai/...`), import statyczny, `require` i dynamiczny.
  /from\s+['"]openai(?:\/[^'"]*)?['"]/,
  /require\(\s*['"]openai(?:\/[^'"]*)?['"]\s*\)/,
  /import\(\s*['"]openai(?:\/[^'"]*)?['"]\s*\)/,
  // Wspólny klient modelu — każdy plik, który go importuje, woła model.
  /from\s+['"](?:@\/lib\/ai|(?:\.{1,2}\/)+(?:ai\/)?)\/?openai['"]/,
  /import\(\s*['"](?:@\/lib\/ai|(?:\.{1,2}\/)+(?:ai\/)?)\/?openai['"]\s*\)/,
  /from\s+['"](@openai\/[^'"]+|@google\/gen(erative-)?ai|@google-cloud\/vertexai|@mistralai\/[^'"]+|cohere-ai|ollama|groq-sdk|@aws-sdk\/client-bedrock[^'"]*|@huggingface\/[^'"]+|ai|@ai-sdk\/[^'"]+|langchain|@langchain\/[^'"]+)['"]/,
  /api\.anthropic\.com|api\.openai\.com|generativelanguage\.googleapis\.com|api\.mistral\.ai|api\.cohere\.(ai|com)|bedrock-runtime\./,
];

/** Pakiety SDK modeli językowych — każdy w `package.json` musi mieć funkcję w inwentarzu. */
export const AI_SDK_PACKAGES: readonly RegExp[] = [
  /^@anthropic-ai\//,
  /^openai$/,
  /^@google\/gen(erative-)?ai$/,
  /^@mistralai\//,
  /^cohere-ai$/,
  /^ai$/,
  /^@ai-sdk\//,
  /^langchain$/,
  /^@langchain\//,
];

export function containsModelCall(source: string): boolean {
  return MODEL_CALL_PATTERNS.some((pattern) => pattern.test(source));
}

/** Pliki z wywołaniem modelu, których nie ma w inwentarzu (pusta lista = zgodnie). */
export function undeclaredCallSites(files: readonly { path: string; source: string }[]): string[] {
  const declared = declaredCallSites();
  return files
    .filter((file) => containsModelCall(file.source) && !declared.has(file.path))
    .map((file) => file.path)
    .sort();
}
