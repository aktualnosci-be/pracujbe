// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { ASSIST_SYSTEM_PROMPT, AssistorError, OpenAiJobAssistor } from '@/lib/ai-assist/assist';
import { ASSIST_JSON_SCHEMA } from '@/lib/ai-assist/schema';
import { JOB_EXTRACTION_JSON_SCHEMA } from '@/lib/ai-import/schema';
import { DEFAULT_AI_MODEL, isOpenAiConfigured, resolveAiModel } from '@/lib/ai/model-config';
import { AiProviderError, createStructuredResponse } from '@/lib/ai/openai';
import { CV_EXTRACTION_JSON_SCHEMA } from '@/lib/cv-import/proposals';

import { callParams, fakeOpenAiClient } from '../helpers/fake-openai';

/**
 * Wspólny klient OpenAI (decyzja właściciela 2026-09-26: wyłącznie GPT-6 Luna). Atrapa klienta —
 * żaden test nie wykonuje prawdziwego wywołania API.
 */

const REQUEST = {
  model: 'gpt-6-luna',
  instructions: 'SYSTEM RULES',
  input: [{ kind: 'text' as const, text: 'UNTRUSTED MATERIAL' }],
  schemaName: 'test_schema',
  schema: { type: 'object', additionalProperties: false, required: ['a'], properties: { a: { type: 'string' } } },
  maxOutputTokens: 1234,
};

afterEach(() => {
  delete process.env.AI_MODEL;
  delete process.env.OPENAI_API_KEY;
  vi.restoreAllMocks();
});

describe('konfiguracja modelu', () => {
  it('domyślnie gpt-6-luna; zmienna funkcji → AI_MODEL → domyślny, tylko poprawny identyfikator', () => {
    expect(DEFAULT_AI_MODEL).toBe('gpt-6-luna');
    expect(resolveAiModel(undefined)).toBe('gpt-6-luna');
    process.env.AI_MODEL = 'gpt-6-sol';
    expect(resolveAiModel(undefined)).toBe('gpt-6-sol');
    expect(resolveAiModel('gpt-6-luna-2026-09-22')).toBe('gpt-6-luna-2026-09-22');
    expect(resolveAiModel('x; drop')).toBe('gpt-6-sol');
    process.env.AI_MODEL = 'ZŁY MODEL';
    expect(resolveAiModel('')).toBe('gpt-6-luna');
  });

  it('klucz: pusty albo same spacje = brak dostawcy', () => {
    expect(isOpenAiConfigured()).toBe(false);
    process.env.OPENAI_API_KEY = '   ';
    expect(isOpenAiConfigured()).toBe(false);
    process.env.OPENAI_API_KEY = 'test-key-not-real';
    expect(isOpenAiConfigured()).toBe(true);
  });
});

describe('createStructuredResponse', () => {
  it('Responses API: instrukcje osobno, materiał w wiadomości user, strict JSON Schema, store=false, bez narzędzi', async () => {
    const { client, create } = fakeOpenAiClient({ text: '{"a":"ok"}' });
    await expect(createStructuredResponse(REQUEST, { client })).resolves.toEqual({ a: 'ok' });
    const params = callParams(create);
    expect(params).toMatchObject({
      model: 'gpt-6-luna',
      instructions: 'SYSTEM RULES',
      max_output_tokens: 1234,
      reasoning: { effort: 'low' },
      store: false,
      text: { format: { type: 'json_schema', name: 'test_schema', schema: REQUEST.schema, strict: true } },
    });
    expect(params.tools).toBeUndefined();
    expect(params.input).toEqual([{ role: 'user', content: [{ type: 'input_text', text: 'UNTRUSTED MATERIAL' }] }]);
    expect(JSON.stringify(params.input)).not.toContain('SYSTEM RULES');
  });

  it('zużycie zgłaszane także przy odmowie; bez usage nic nie jest zgłaszane', async () => {
    const onUsage = vi.fn();
    const refused = fakeOpenAiClient({ refusal: 'no', text: null, usage: { input_tokens: 40, output_tokens: 3 } });
    await expect(createStructuredResponse(REQUEST, { client: refused.client, onUsage })).rejects.toMatchObject({
      reason: 'refused',
    });
    expect(onUsage).toHaveBeenCalledWith({ inputTokens: 40, outputTokens: 3, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 });

    onUsage.mockClear();
    const noUsage = fakeOpenAiClient({ text: '{}', usage: null });
    await createStructuredResponse(REQUEST, { client: noUsage.client, onUsage });
    expect(onUsage).not.toHaveBeenCalled();
  });

  it('nic z treści ani komunikatu dostawcy nie trafia do logów', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
    const failing = fakeOpenAiClient(new Error('upstream: UNTRUSTED MATERIAL leaked'));
    const err = await createStructuredResponse(REQUEST, { client: failing.client }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AiProviderError);
    expect((err as Error).message).toBe('failed');
    const ok = fakeOpenAiClient({ text: '{"a":"UNTRUSTED MATERIAL"}' });
    await createStructuredResponse(REQUEST, { client: ok.client });
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });

  it('klucz API nie jest przekazywany w żądaniu (czyta go SDK na serwerze)', () => {
    const source = readFileSync(join(__dirname, '..', '..', 'src/lib/ai/openai.ts'), 'utf8');
    expect(source).toMatch(/^import 'server-only';/);
    expect(source).not.toMatch(/apiKey\s*:/);
    expect(source).not.toMatch(/NEXT_PUBLIC_/);
  });
});

describe('OpenAiJobAssistor (#37)', () => {
  const REQ = {
    locale: 'nl',
    title: 'Orderpicker',
    fields: { description: 'magazijn werk. goede sfeer' },
  } as Parameters<OpenAiJobAssistor['suggest']>[0];

  it('instrukcje tylko w instructions, tekst oferty w <offer_text>, strict schemat, zużycie = suma wejścia z cache', async () => {
    const { client, create } = fakeOpenAiClient({
      text: JSON.stringify({ suspiciousInstructions: false, wrongLanguage: false, description: 'X', responsibilities: [], requirementsMandatory: [] }),
      usage: { input_tokens: 900, cached_tokens: 100, output_tokens: 300 },
    });
    const out = await new OpenAiJobAssistor(client).suggest(REQ, ['description']);
    expect(out.usage).toEqual({ inputTokens: 900, outputTokens: 300 });
    const params = callParams(create);
    expect(params.instructions).toBe(ASSIST_SYSTEM_PROMPT);
    expect(params.max_output_tokens).toBe(6000);
    expect(params.text?.format).toMatchObject({ type: 'json_schema', name: 'job_offer_assist', strict: true, schema: ASSIST_JSON_SCHEMA });
    expect(JSON.stringify(params.input)).toContain('<offer_text>');
    expect(params.tools).toBeUndefined();
  });

  it('odmowa → AssistorError(refused); błąd API → failed', async () => {
    const refused = fakeOpenAiClient({ refusal: 'no', text: null });
    await expect(new OpenAiJobAssistor(refused.client).suggest(REQ, ['description'])).rejects.toMatchObject({ reason: 'refused' });
    const failing = fakeOpenAiClient(new Error('boom'));
    const err = await new OpenAiJobAssistor(failing.client).suggest(REQ, ['description']).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AssistorError);
    expect(err).toMatchObject({ reason: 'failed' });
  });
});

describe('schematy structured output spełniają tryb strict OpenAI', () => {
  /** Każdy obiekt: additionalProperties=false i każda właściwość w `required`. */
  function strictProblems(node: unknown, path = '$'): string[] {
    if (!node || typeof node !== 'object') return [];
    const n = node as Record<string, unknown>;
    const problems: string[] = [];
    if (n.type === 'object') {
      if (n.additionalProperties !== false) problems.push(`${path}: additionalProperties`);
      const req = new Set((n.required as string[]) ?? []);
      for (const [k, v] of Object.entries((n.properties as object) ?? {})) {
        if (!req.has(k)) problems.push(`${path}.${k}: nie jest wymagane`);
        problems.push(...strictProblems(v, `${path}.${k}`));
      }
    }
    if (n.type === 'array') problems.push(...strictProblems(n.items, `${path}[]`));
    return problems;
  }

  it.each([
    ['import ogłoszeń', JOB_EXTRACTION_JSON_SCHEMA],
    ['asystent treści', ASSIST_JSON_SCHEMA],
    ['import CV', CV_EXTRACTION_JSON_SCHEMA],
  ])('%s', (_name, schema) => {
    expect(strictProblems(schema)).toEqual([]);
  });

  it('kontrola ujemna: pole spoza required jest wykrywane', () => {
    expect(
      strictProblems({ type: 'object', additionalProperties: false, required: [], properties: { a: { type: 'string' } } }),
    ).toEqual(['$.a: nie jest wymagane']);
  });
});
