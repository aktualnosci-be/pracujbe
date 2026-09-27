import { afterEach, describe, expect, it } from 'vitest';

import { TRANSLATION_PIPELINE_VERSION } from '@/lib/translation/pipeline';
import { isTranslationEnabled, translationModel, translationProvider } from '@/lib/translation/config';

/** #32 — domyślnie wyłączone; atrapa nigdy w produkcji; wersja pipeline zgodna z CHECK w 0145. */
const KEYS = ['AI_TRANSLATION_ENABLED', 'AI_TRANSLATION_PROVIDER', 'AI_TRANSLATION_MODEL', 'AI_MODEL', 'OPENAI_API_KEY', 'APP_MODE'];
const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe('konfiguracja tłumaczeń', () => {
  it('bez flagi wyłączone, nawet z kluczem', () => {
    delete process.env.AI_TRANSLATION_ENABLED;
    process.env.OPENAI_API_KEY = 'test-key';
    expect(isTranslationEnabled()).toBe(false);
  });

  it('flaga + klucz OpenAI = openai; flaga bez klucza = wyłączone', () => {
    process.env.AI_TRANSLATION_ENABLED = 'true';
    process.env.OPENAI_API_KEY = 'test-key';
    expect(translationProvider()).toBe('openai');
    delete process.env.OPENAI_API_KEY;
    expect(translationProvider()).toBeNull();
  });

  it('atrapa tylko poza trybem produkcyjnym', () => {
    process.env.AI_TRANSLATION_ENABLED = '1';
    process.env.AI_TRANSLATION_PROVIDER = 'fixture';
    delete process.env.APP_MODE;
    expect(translationProvider()).toBe('fixture');
    process.env.APP_MODE = 'production';
    expect(translationProvider()).toBeNull();
  });

  it('niepoprawny model z env → domyślny gpt-6-luna; poprawny = nadpisanie', () => {
    delete process.env.AI_MODEL;
    process.env.AI_TRANSLATION_MODEL = 'bad model; drop';
    expect(translationModel()).toBe('gpt-6-luna');
    process.env.AI_TRANSLATION_MODEL = 'gpt-6-sol';
    expect(translationModel()).toBe('gpt-6-sol');
  });

  it('wersja pipeline pasuje do CHECK translation_jobs_pipeline', () => {
    expect(TRANSLATION_PIPELINE_VERSION).toMatch(/^[a-z0-9][a-z0-9.+_-]{0,63}$/);
  });
});
