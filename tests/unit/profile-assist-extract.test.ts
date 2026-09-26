// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';

import { ExtractorError } from '@/lib/ai-import/extract';
import {
  OpenAiProfileAssistor,
  PROFILE_ASSIST_MAX_TOKENS,
  PROFILE_ASSIST_SYSTEM_PROMPT,
} from '@/lib/profile-assist/extract';
import { PROFILE_ASSIST_JSON_SCHEMA } from '@/lib/profile-assist/schema';

import { callParams, fakeOpenAiClient } from '../helpers/fake-openai';

/**
 * #37 (część kandydata) — dostawca na wspólnym kliencie OpenAI (decyzja 2026-09-26). Atrapa
 * klienta: żaden test nie wykonuje prawdziwego wywołania API.
 */

afterEach(() => {
  delete process.env.AI_PROFILE_ASSIST_MODEL;
  delete process.env.AI_MODEL;
});

describe('OpenAiProfileAssistor', () => {
  it('instrukcje osobno, odpowiedzi w <answers>, strict schemat, limit wyjścia, zużycie zgłoszone', async () => {
    const { client, create } = fakeOpenAiClient({ text: '{"aboutWork":true}', usage: { input_tokens: 50, output_tokens: 7 } });
    const usages: unknown[] = [];
    const out = await new OpenAiProfileAssistor(client).extract('Q1: pracowałem w magazynie', { onUsage: (u) => usages.push(u) });
    expect(out).toEqual({ aboutWork: true });
    const params = callParams(create) as Record<string, any>;
    expect(params.model).toBe('gpt-6-luna');
    expect(params.instructions).toBe(PROFILE_ASSIST_SYSTEM_PROMPT);
    expect(params.store).toBe(false);
    expect(params.tools).toBeUndefined();
    expect(params.max_output_tokens).toBe(PROFILE_ASSIST_MAX_TOKENS);
    expect(params.text.format).toMatchObject({ type: 'json_schema', strict: true, schema: PROFILE_ASSIST_JSON_SCHEMA });
    const text = params.input[0].content[0].text as string;
    expect(text).toMatch(/^<answers>\nQ1: pracowałem w magazynie\n<\/answers>/);
    expect(PROFILE_ASSIST_SYSTEM_PROMPT).not.toContain('magazynie');
    expect(usages).toEqual([expect.objectContaining({ inputTokens: 50, outputTokens: 7 })]);
  });

  it('model z AI_PROFILE_ASSIST_MODEL', async () => {
    process.env.AI_PROFILE_ASSIST_MODEL = 'gpt-6-sol';
    const { client, create } = fakeOpenAiClient({ text: '{}' });
    await new OpenAiProfileAssistor(client).extract('x');
    expect(callParams(create).model).toBe('gpt-6-sol');
  });

  it.each([
    ['odmowa', { refusal: 'no' }, 'refused'],
    ['ucięta odpowiedź', { incompleteReason: 'max_output_tokens' as const }, 'failed'],
    ['zły JSON', { text: '{"a":' }, 'failed'],
  ])('%s → ExtractorError(%s)', async (_n, spec, reason) => {
    const { client } = fakeOpenAiClient(spec);
    const err = await new OpenAiProfileAssistor(client).extract('x').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ExtractorError);
    expect((err as ExtractorError).reason).toBe(reason);
  });

  it('błąd dostawcy nie przenosi komunikatu (kontrola ujemna: surowy błąd nie wychodzi)', async () => {
    const { client } = fakeOpenAiClient(new Error('pracowałem w magazynie leaked'));
    const err = (await new OpenAiProfileAssistor(client).extract('x').catch((e: unknown) => e)) as Error;
    expect(err).toBeInstanceOf(ExtractorError);
    expect(err.message).not.toContain('magazynie');
  });
});
