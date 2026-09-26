import type OpenAI from 'openai';
import { vi } from 'vitest';

import type { ResponsesClient } from '@/lib/ai/openai';

/**
 * Atrapa klienta OpenAI Responses API (testy nie wykonują prawdziwych wywołań). Buduje
 * odpowiedź w kształcie `OpenAI.Responses.Response` z tekstem, odmową albo przerwaniem.
 */
export interface FakeResponseSpec {
  /** Tekst `output_text` (domyślnie `{}`); `null` = brak wiadomości. */
  text?: string | null;
  refusal?: string;
  status?: OpenAI.Responses.ResponseStatus;
  incompleteReason?: 'max_output_tokens' | 'content_filter';
  /** `null` = odpowiedź bez `usage`. */
  usage?: Partial<{ input_tokens: number; output_tokens: number; cached_tokens: number; cache_write_tokens: number; reasoning_tokens: number }> | null;
}

export function fakeOpenAiResponse(spec: FakeResponseSpec = {}): OpenAI.Responses.Response {
  const content: unknown[] = [];
  if (spec.refusal !== undefined) content.push({ type: 'refusal', refusal: spec.refusal });
  if (spec.text !== null) content.push({ type: 'output_text', text: spec.text ?? '{}', annotations: [] });
  const u = spec.usage;
  return {
    id: 'resp_test',
    object: 'response',
    status: spec.status ?? (spec.incompleteReason ? 'incomplete' : 'completed'),
    incomplete_details: spec.incompleteReason ? { reason: spec.incompleteReason } : null,
    output: content.length
      ? [{ type: 'message', id: 'msg_test', role: 'assistant', status: 'completed', content }]
      : [],
    usage:
      u === null
        ? undefined
        : {
            input_tokens: u?.input_tokens ?? 0,
            output_tokens: u?.output_tokens ?? 0,
            total_tokens: (u?.input_tokens ?? 0) + (u?.output_tokens ?? 0),
            input_tokens_details: { cached_tokens: u?.cached_tokens ?? 0, cache_write_tokens: u?.cache_write_tokens ?? 0 },
            output_tokens_details: { reasoning_tokens: u?.reasoning_tokens ?? 0 },
          },
  } as unknown as OpenAI.Responses.Response;
}

export function fakeOpenAiClient(response: FakeResponseSpec | Error = {}) {
  const create = vi.fn(async (_params: OpenAI.Responses.ResponseCreateParamsNonStreaming) => {
    if (response instanceof Error) throw response;
    return fakeOpenAiResponse(response);
  });
  const client: ResponsesClient = { responses: { create } };
  return { client, create };
}

/** Parametry pierwszego (albo n-tego) wywołania `responses.create`. */
export function callParams(create: ReturnType<typeof fakeOpenAiClient>['create'], n = 0) {
  return create.mock.calls[n]![0] as OpenAI.Responses.ResponseCreateParamsNonStreaming;
}
