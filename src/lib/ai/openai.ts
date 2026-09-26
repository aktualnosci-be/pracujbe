import 'server-only';

import OpenAI from 'openai';

import type { AiTokenUsage } from '@/lib/ai/pricing';

/**
 * Wspólny klient modelu OpenAI dla funkcji AI (decyzja właściciela 2026-09-26: wyłącznie
 * „GPT-6 Luna”, identyfikator API `gpt-6-luna`). Jedyny plik, który importuje SDK `openai` —
 * import ogłoszeń (#465), asystent treści (#37) i import CV (#487) wołają
 * {@link createStructuredResponse}.
 *
 * Zasady:
 *   - tylko serwer (`server-only`); klucz `OPENAI_API_KEY` czyta SDK ze środowiska serwera;
 *   - Responses API + structured output (`text.format` = `json_schema`, `strict: true`) —
 *     odpowiedź ograniczona schematem, model bez narzędzi;
 *   - `store: false` — odpowiedź nie jest przechowywana po stronie OpenAI do późniejszego
 *     pobrania (retencja dostawcy = osobna decyzja, docs/AI_BUDGET.md);
 *   - timeout 60 s i jedna ponowna próba (użytkownik czeka w UI);
 *   - bez logowania treści: błędy mapujemy na {@link AiProviderError} z samym powodem —
 *     treść wejścia, odpowiedź i komunikat dostawcy nie trafiają do logów ani do UI.
 */

export type AiProviderFailure = 'refused' | 'failed' | 'rateLimited';

export class AiProviderError extends Error {
  constructor(readonly reason: AiProviderFailure) {
    super(reason);
    this.name = 'AiProviderError';
  }
}

export type StructuredInputPart =
  | { kind: 'text'; text: string }
  | { kind: 'image'; mediaType: 'image/png' | 'image/jpeg' | 'image/webp'; base64: string };

export interface StructuredRequest {
  model: string;
  /** Instrukcje systemowe (jedyne miejsce na polecenia; materiał użytkownika idzie w `input`). */
  instructions: string;
  input: readonly StructuredInputPart[];
  schemaName: string;
  schema: Record<string, unknown>;
  /** Górna granica wyjścia (u OpenAI obejmuje też tokeny rozumowania). */
  maxOutputTokens: number;
}

/** Minimalny kontrakt klienta — testy podstawiają atrapę z tym samym kształtem. */
export interface ResponsesClient {
  responses: {
    create(params: OpenAI.Responses.ResponseCreateParamsNonStreaming): Promise<OpenAI.Responses.Response>;
  };
}

let defaultClient: ResponsesClient | null = null;

function client(): ResponsesClient {
  defaultClient ??= new OpenAI({ timeout: 60_000, maxRetries: 1 });
  return defaultClient;
}

/**
 * `usage` z Responses API → składowe cennika. `input_tokens` obejmuje tokeny z cache
 * (`cached_tokens`) i zapisane do cache (`cache_write_tokens`); po pełnej stawce liczymy
 * resztę. Tokeny rozumowania są częścią `output_tokens`.
 */
export function usageFromOpenAi(usage: OpenAI.Responses.ResponseUsage | null | undefined): AiTokenUsage | null {
  if (!usage) return null;
  const cached = usage.input_tokens_details?.cached_tokens ?? 0;
  const written = usage.input_tokens_details?.cache_write_tokens ?? 0;
  return {
    inputTokens: Math.max(0, usage.input_tokens - cached - written),
    outputTokens: usage.output_tokens,
    cacheReadInputTokens: cached,
    cacheCreationInputTokens: written,
  };
}

function toContent(part: StructuredInputPart): OpenAI.Responses.ResponseInputContent {
  if (part.kind === 'image') {
    return { type: 'input_image', detail: 'high', image_url: `data:${part.mediaType};base64,${part.base64}` };
  }
  return { type: 'input_text', text: part.text };
}

/**
 * Jedno wywołanie modelu ze structured output. Zwraca SUROWY (niezwalidowany) obiekt JSON —
 * walidacja po stronie wywołującego. Zużycie zgłasza przez `onUsage` także przy odmowie
 * i przerwaniu (tokeny są wtedy naliczone); bez `usage` nic nie zgłasza — budżet rozlicza
 * wtedy pełną kwotę rezerwacji.
 */
export async function createStructuredResponse(
  request: StructuredRequest,
  options: { onUsage?: (usage: AiTokenUsage) => void; client?: ResponsesClient } = {},
): Promise<unknown> {
  let response: OpenAI.Responses.Response;
  try {
    response = await (options.client ?? client()).responses.create({
      model: request.model,
      instructions: request.instructions,
      input: [{ role: 'user', content: request.input.map(toContent) }],
      max_output_tokens: request.maxOutputTokens,
      // Ekstrakcja/redakcja jednego dokumentu — niski effort wystarcza i obniża koszt/czas.
      reasoning: { effort: 'low' },
      store: false,
      text: {
        format: { type: 'json_schema', name: request.schemaName, schema: request.schema, strict: true },
      },
    });
  } catch (e) {
    if (e instanceof OpenAI.RateLimitError) throw new AiProviderError('rateLimited');
    throw new AiProviderError('failed');
  }

  const usage = usageFromOpenAi(response.usage);
  if (usage) options.onUsage?.(usage);

  const contents = response.output.flatMap((item) => (item.type === 'message' ? item.content : []));
  if (contents.some((c) => c.type === 'refusal')) throw new AiProviderError('refused');
  if (response.incomplete_details?.reason === 'content_filter') throw new AiProviderError('refused');
  if (response.status !== 'completed') throw new AiProviderError('failed');
  const text = contents
    .filter((c): c is OpenAI.Responses.ResponseOutputText => c.type === 'output_text')
    .map((c) => c.text)
    .join('');
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new AiProviderError('failed');
  }
}
