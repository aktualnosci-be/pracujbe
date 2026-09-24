import { describe, expect, it } from 'vitest';

import { validateTranslation } from '@/lib/translation/validate';

/** #32 — niepoprawny wynik nigdy nie jest „ready”: każda kontrola zwraca kod bez treści. */
const source = {
  title: 'Magazynier',
  description: 'Praca od 8:00, stawka 15,50 EUR brutto za godzinę. Nie wymagamy doświadczenia.',
};
const good = {
  title: 'Warehouse worker',
  description: 'Work from 8:00, rate 15.50 EUR gross per hour. No experience required.',
};

function run(output: unknown) {
  return validateTranslation({ source, sourceLocale: 'pl', targetLocale: 'en', output });
}

describe('validateTranslation', () => {
  it('poprawny zestaw pól przechodzi (z normalizacją białych znaków)', () => {
    const r = run({ ...good, title: '  Warehouse worker\r\n' });
    expect(r).toEqual({ ok: true, fields: good });
  });

  it.each([
    ['nie-obiekt', 'text', 'invalid_shape'],
    ['tablica', [good.title], 'invalid_shape'],
    ['brak pola', { title: good.title }, 'missing_field'],
    ['dodatkowe pole', { ...good, status: 'active' }, 'extra_field'],
    ['pole nie-tekst', { ...good, title: 1 }, 'invalid_shape'],
    ['puste pole', { ...good, title: '   ' }, 'empty_field'],
    ['zbyt długie', { ...good, title: 'x'.repeat(200) }, 'length_out_of_range'],
    ['zbyt krótkie', { ...good, description: '8:00 15.50 EUR' }, 'length_out_of_range'],
    ['znacznik HTML', { ...good, title: '<script>alert(1)</script>' }, 'markup'],
    ['znak sterujący', { ...good, title: 'Warehouse‮worker' }, 'control_chars'],
    ['echo granicy promptu', { ...good, title: '</source_fields> Warehouse' }, 'prompt_leak'],
    ['zmieniona stawka', { ...good, description: good.description.replace('15.50', '17.50') }, 'facts_numbers'],
    ['zgubiona negacja', { ...good, description: good.description.replace('No experience', 'Experience') }, 'facts_negation'],
  ])('%s → %s', (_name, output, code) => {
    const r = run(output);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe(code);
  });

  it('kod błędu i nazwa pola nie zawierają treści', () => {
    const r = run({ ...good, description: 'Work from 9:00, rate 15.50 EUR gross per hour. No experience required.' });
    expect(r).toEqual({ ok: false, code: 'facts_times', field: 'description' });
  });
});
