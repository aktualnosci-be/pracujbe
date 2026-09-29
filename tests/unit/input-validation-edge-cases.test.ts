import { describe, expect, it } from 'vitest';

import { redactSensitiveData, findSensitiveData } from '@/lib/privacy/sensitive-data';
import { step1Schema, step2Schema, step4Schema, step5Schema, step6Schema } from '@/lib/validation/candidate';
import { codePointLength, isPlausibleCalendarDate, truncateCodePoints } from '@/lib/validation/text';

/** #1108 — drobne poprawki walidacji wejścia. */

describe('wykrywanie e-maili bez złożoności kwadratowej', () => {
  function timed<T>(fn: () => T): { ms: number; value: T } {
    const t = Date.now();
    const value = fn();
    return { ms: Date.now() - t, value };
  }

  it('bardzo długi, jednolity ciąg znaków nie blokuje procesu', () => {
    // Przed zmianą 80 000 × „a” to kilka sekund (O(n²)); 200 000 znaków ma zająć ułamek sekundy.
    for (const text of ['a'.repeat(200_000), 'a.'.repeat(100_000), 'a@'.repeat(100_000), `a@${'b.'.repeat(100_000)}`]) {
      const { ms } = timed(() => findSensitiveData(text, ['email']));
      expect(ms, text.slice(0, 6)).toBeLessThan(500);
    }
  });

  it('zwykłe adresy nadal wykrywane i zamazywane', () => {
    const text = 'Pisz na jan.kowalski+praca@firma.be lub Ł.Nowak@sub.dom.example.com!';
    const found = findSensitiveData(text, ['email']).map((m) => text.slice(m.start, m.end));
    expect(found).toEqual(['jan.kowalski+praca@firma.be', 'Ł.Nowak@sub.dom.example.com']);
    expect(redactSensitiveData(text, ['email'])).not.toContain('@');
  });

  it('adres po długim ciągu poprzedzającym też jest wykrywany (kotwica na początku ciągu)', () => {
    const text = `${'x'.repeat(50_000)} kontakt: anna@firma.be`;
    const found = findSensitiveData(text, ['email']).map((m) => text.slice(m.start, m.end));
    expect(found).toEqual(['anna@firma.be']);
  });
});

describe('znak NUL w polach kandydata', () => {
  const nul = 'a\u0000b';

  it('odrzucony przy imieniu, mieście, pozycji listy, języku i opisie — przy polu', () => {
    const cases = [
      step1Schema.safeParse({ firstName: nul, lastName: 'Kowalski' }),
      step1Schema.safeParse({ firstName: 'Jan', lastName: nul }),
      step2Schema.safeParse({ occupations: [nul], categories: ['warehouse'] }),
      step4Schema.safeParse({ city: nul, radiusKm: 10 }),
      step5Schema.safeParse({ languages: [{ language: nul, level: 'basic' }] }),
      step6Schema.safeParse({
        availability: 'immediate',
        bio: nul,
        agreeTerms: true,
        privacyNoticeAck: true,
      }),
    ];
    for (const r of cases) {
      expect(r.success).toBe(false);
      if (!r.success) expect(r.error.issues.map((i) => i.message)).toContain('candidate.error.textInvalid');
    }
  });

  it('kontrola ujemna: tekst bez NUL przechodzi', () => {
    expect(step1Schema.safeParse({ firstName: 'Jan', lastName: 'Kowalski' }).success).toBe(true);
    expect(step2Schema.safeParse({ occupations: ['Magazynier'], categories: ['warehouse'] }).success).toBe(true);
  });
});

describe('daty z nieprawidłowym rokiem', () => {
  it('isPlausibleCalendarDate: istniejąca data z rokiem 1900–2100', () => {
    expect(isPlausibleCalendarDate('2026-09-29')).toBe(true);
    expect(isPlausibleCalendarDate('2028-02-29')).toBe(true);
    expect(isPlausibleCalendarDate('0000-01-01')).toBe(false);
    expect(isPlausibleCalendarDate('0001-01-01')).toBe(false);
    expect(isPlausibleCalendarDate('9999-12-31')).toBe(false);
    expect(isPlausibleCalendarDate('2026-02-30')).toBe(false);
    expect(isPlausibleCalendarDate('2026-13-01')).toBe(false);
    expect(isPlausibleCalendarDate('2026-9-1')).toBe(false);
  });

  it('data ważności certyfikatu: rok 0000 odrzucony komunikatem przy polu', () => {
    const base = { languages: [], certificates: ['VCA'] };
    const bad = step5Schema.safeParse({ ...base, certificateExpiry: { VCA: '0000-01-01' } });
    expect(bad.success).toBe(false);
    if (!bad.success) expect(bad.error.issues[0]?.message).toBe('candidate.error.certificateExpiryInvalid');
    expect(step5Schema.safeParse({ ...base, certificateExpiry: { VCA: '2027-05-01' } }).success).toBe(true);
  });
});

describe('punkty kodowe', () => {
  it('codePointLength / truncateCodePoints liczą jak char_length/left', () => {
    expect(codePointLength('a😀b')).toBe(3);
    expect('a😀b'.length).toBe(4);
    expect(truncateCodePoints('a😀bc', 2)).toBe('a😀');
    expect(truncateCodePoints('abc', 5)).toBe('abc');
  });
});
