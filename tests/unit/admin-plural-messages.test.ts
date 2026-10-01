/**
 * #1093 (I18N-08): komunikaty panelu administratora z liczbą zmienną (dane z bazy, mogą wynosić 1)
 * używają reguł ICU plural — bez „1 spraw”, „1 listów”, „of 1 messages”. Wywołujący przekazują
 * liczbę (nie tekst sformatowany wcześniej), bo `plural` wymaga wartości liczbowej.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { createTranslator } from 'next-intl';
import { describe, expect, it } from 'vitest';

import en from '@/messages/en.json';
import fr from '@/messages/fr.json';
import nl from '@/messages/nl.json';
import pl from '@/messages/pl.json';

const MESSAGES = { pl, nl, fr, en } as const;
type Locale = keyof typeof MESSAGES;

function tr(locale: Locale) {
  return createTranslator({ locale, messages: MESSAGES[locale], namespace: 'admin' });
}

const CASES: Record<Locale, Array<[number, string]>> = {
  pl: [
    [1, 'próba (dry-run): 1 sprawa do anonimizacji'],
    [3, 'próba (dry-run): 3 sprawy do anonimizacji'],
    [5, 'próba (dry-run): 5 spraw do anonimizacji'],
  ],
  nl: [
    [1, 'proefrun: 1 dossier te anonimiseren'],
    [4, 'proefrun: 4 dossiers te anonimiseren'],
  ],
  fr: [
    [1, 'essai (dry-run) : 1 dossier à anonymiser'],
    [4, 'essai (dry-run) : 4 dossiers à anonymiser'],
  ],
  en: [
    [1, 'dry run: 1 case due'],
    [4, 'dry run: 4 cases due'],
  ],
};

const SAMPLE: Record<Locale, Array<[number, string]>> = {
  pl: [
    [1, '1 list w 24 h'],
    [2, '2 listy w 24 h'],
    [12, '12 listów w 24 h'],
    [22, '22 listy w 24 h'],
  ],
  nl: [
    [1, '1 e-mail in 24 uur'],
    [7, '7 e-mails in 24 uur'],
  ],
  fr: [
    [1, '1 e-mail en 24 h'],
    [7, '7 e-mails en 24 h'],
  ],
  en: [
    [1, '1 email in 24 h'],
    [7, '7 emails in 24 h'],
  ],
};

const QUEUED: Record<Locale, Array<[number, number, string]>> = {
  pl: [[1, 1, 'Zakolejkowano 1 z 1 wiadomości.']],
  nl: [
    [1, 1, '1 van 1 bericht in de wachtrij gezet.'],
    [2, 3, '2 van 3 berichten in de wachtrij gezet.'],
  ],
  fr: [
    [1, 1, '1 message sur 1 mis en file.'],
    [2, 3, '2 messages sur 3 mis en file.'],
  ],
  en: [
    [1, 1, 'Queued 1 of 1 message.'],
    [2, 3, 'Queued 2 of 3 messages.'],
  ],
};

describe('admin — liczba mnoga ICU (#1093)', () => {
  for (const locale of Object.keys(MESSAGES) as Locale[]) {
    it(`${locale}: przebieg retencji DSA (dry-run)`, () => {
      const t = tr(locale);
      for (const [cases, expected] of CASES[locale]) {
        expect(t('dsaRetentionRunDry', { cases })).toBe(expected);
      }
    });

    it(`${locale}: za mała próba poczty`, () => {
      const t = tr(locale);
      for (const [sent, expected] of SAMPLE[locale]) {
        expect(t('opsNoteSmallSample', { sent, min: '50' })).toContain(expected);
      }
    });

    it(`${locale}: zakolejkowane zawiadomienia o naruszeniu`, () => {
      const t = tr(locale);
      for (const [queued, recipients, expected] of QUEUED[locale]) {
        expect(t('breachNoticeQueued', { queued, recipients })).toBe(expected);
      }
    });
  }

  it('liczby formatowane zgodnie z językiem (separator tysięcy)', () => {
    expect(tr('pl')('opsNoteSmallSample', { sent: 1234, min: '50' })).toContain('1234 listy');
    expect(tr('en')('dsaRetentionRunDry', { cases: 1234 })).toBe('dry run: 1,234 cases due');
  });

  it('kontrola ujemna: dawne brzmienie bez plural daje błędną formę przy 1', () => {
    const legacyPl: Record<string, Record<string, string>> = {
      admin: { dsaRetentionRunDry: 'próba (dry-run): {cases} spraw do anonimizacji' },
    };
    const legacy = createTranslator({
      locale: 'pl',
      messages: legacyPl,
      namespace: 'admin',
    });
    expect(legacy('dsaRetentionRunDry', { cases: 1 })).toBe('próba (dry-run): 1 spraw do anonimizacji');
    const legacyEnMessages: Record<string, Record<string, string>> = {
      admin: { breachNoticeQueued: 'Queued {queued} of {recipients} messages.' },
    };
    const legacyEn = createTranslator({
      locale: 'en',
      messages: legacyEnMessages,
      namespace: 'admin',
    });
    expect(legacyEn('breachNoticeQueued', { queued: 1, recipients: 1 })).toBe('Queued 1 of 1 messages.');
  });

  it('wywołujący przekazują liczby, nie tekst sformatowany wcześniej', () => {
    const root = path.resolve(__dirname, '../..');
    const read = (file: string) => readFileSync(path.join(root, file), 'utf8');
    const ops = read('src/app/[locale]/admin/operacje/page.tsx');
    expect(ops).toContain("t('opsNoteSmallSample', { sent: note.sent,");
    expect(ops).not.toMatch(/sent: num\.format\(note\.sent\)/);
    const breach = read('src/components/admin/BreachNoticeForm.tsx');
    expect(breach).toContain('queued: res.queued ?? 0,');
    expect(breach).toContain('recipients: res.recipients ?? 0,');
    expect(breach).not.toMatch(/recipients: numberFormat\.format\(res\.recipients/);
    const dsa = read('src/app/[locale]/admin/raport-dsa/page.tsx');
    expect(dsa).toContain('{ cases: run.cases }');
  });
});
