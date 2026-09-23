import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { CV_MAX_BYTES, checkCvFile } from '@/lib/validation/cv-file';

/** #362 — wspólne reguły pliku CV (przeglądarka + serwer) i ich relacja do limitu ciała akcji. */
describe('checkCvFile', () => {
  const pdf = 'application/pdf';

  it('przepuszcza PDF/DOC/DOCX do 5 MB włącznie', () => {
    expect(checkCvFile({ size: CV_MAX_BYTES, type: pdf })).toBeNull();
    expect(checkCvFile({ size: 10, type: 'application/msword' })).toBeNull();
    expect(
      checkCvFile({
        size: 10,
        type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      }),
    ).toBeNull();
  });

  it('rozróżnia pusty, za duży i zły format', () => {
    expect(checkCvFile({ size: 0, type: pdf })).toBe('empty');
    expect(checkCvFile({ size: CV_MAX_BYTES + 1, type: pdf })).toBe('tooLarge');
    expect(checkCvFile({ size: 10, type: 'image/png' })).toBe('type');
    expect(checkCvFile({ size: 10, type: '' })).toBe('type');
  });

  it('limit pliku leży poniżej limitu ciała Server Actions', () => {
    const config = readFileSync('next.config.mjs', 'utf8');
    const mb = Number(/bodySizeLimit:\s*'(\d+)mb'/.exec(config)?.[1]);
    expect(mb * 1024 * 1024).toBeGreaterThan(CV_MAX_BYTES);
  });
});
