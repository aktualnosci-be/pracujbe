import type { Locale } from '@/i18n/routing';
import type { TranslationFields } from '@/lib/translation/validate';

/**
 * Kontrakt dostawcy tłumaczeń (#32). Dostawca zwraca SUROWĄ odpowiedź (`unknown`) —
 * walidacja (`validate.ts`) jest po stronie workera i nie zależy od dostawcy. Żadna
 * implementacja nie dostaje połączenia z bazą ani narzędzi.
 */

export interface TranslationRequest {
  sourceLocale: Locale;
  targetLocale: Locale;
  fields: TranslationFields;
  /** Nazwy własne do zachowania dosłownie (np. nazwa firmy). */
  protectedTerms?: readonly string[];
}

export interface TranslationResponse {
  output: unknown;
  model: string;
  inputTokens: number;
  outputTokens: number;
}

export interface TranslationProvider {
  translate(request: TranslationRequest): Promise<TranslationResponse>;
}

/**
 * Powód błędu — trafia do `translation_jobs.last_error_code` (bez treści, bez komunikatu
 * dostawcy). `retryable` decyduje o ponowieniu z backoffem (429/5xx/timeout/połączenie);
 * odmowa, ucięta odpowiedź i zły JSON są trwałe dla tej samej treści.
 */
export type ProviderFailure =
  | 'refused'
  | 'incomplete'
  | 'invalid_json'
  | 'rate_limited'
  | 'timeout'
  | 'provider_unavailable'
  | 'bad_request'
  | 'provider_auth';

const RETRYABLE: ReadonlySet<ProviderFailure> = new Set(['rate_limited', 'timeout', 'provider_unavailable']);

export class TranslationProviderError extends Error {
  readonly retryable: boolean;

  constructor(
    readonly reason: ProviderFailure,
    readonly retryAfterSeconds: number | null = null,
  ) {
    super(reason);
    this.name = 'TranslationProviderError';
    this.retryable = RETRYABLE.has(reason);
  }
}

/**
 * Atrapa bez sieci (tylko poza `APP_MODE=production`, patrz `config.ts`): zwraca tekst źródła
 * z prefiksem języka. Liczby, kontakty i terminy zostają nietknięte; pola ze słowami zależnymi
 * od języka (negacja, brutto/netto, okres stawki) celowo NIE przejdą walidacji faktów.
 */
export class FixtureTranslationProvider implements TranslationProvider {
  async translate(request: TranslationRequest): Promise<TranslationResponse> {
    const output = Object.fromEntries(
      Object.entries(request.fields).map(([k, v]) => [k, `[${request.targetLocale}] ${v}`]),
    );
    return { output, model: 'fixture', inputTokens: 0, outputTokens: 0 };
  }
}
