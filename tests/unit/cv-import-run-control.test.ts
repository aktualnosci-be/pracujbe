// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import { FixtureCvExtractor } from '@/lib/cv-import/extract';
import { proposeFromCv } from '@/lib/cv-import/run';
import { CV_WITH_REFEREES, REFEREES } from '../helpers/cv-fixtures';

/**
 * Kontrola ujemna do `cv-import-run.test.ts` (#498): gdy minimalizacja jest wyłączona
 * (tu: podmieniona na przepuszczenie tekstu), ta sama asercja na payloadzie modelu MUSI
 * wykryć dane referentów. Dowodzi, że zielony wynik głównego testu zależy od redakcji,
 * a nie od przypadku.
 */

vi.mock('@/lib/cv-import/minimize', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/cv-import/minimize')>();
  return {
    ...real,
    minimizeCvText: (text: string) => ({
      ok: true,
      text,
      counts: { referenceSections: 0, personalSections: 0, thirdPartyLines: 0, personalLines: 0, specialCategoryLines: 0, contacts: 0 },
    }),
  };
});

describe('kontrola ujemna: bez minimalizacji referenci trafiają do modelu', () => {
  it('payload zawiera e-mail i telefon referenta', async () => {
    const calls: string[] = [];
    const fixture = new FixtureCvExtractor();
    await proposeFromCv(CV_WITH_REFEREES, {
      extract: async (text) => {
        calls.push(text);
        return fixture.extract(text);
      },
    });
    expect(calls[0]).toContain(REFEREES.email1);
    expect(calls[0]).toContain(REFEREES.phone2);
  });
});
