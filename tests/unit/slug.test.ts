import { describe, expect, it } from 'vitest';

import { asciiSlugBase } from '@/lib/slug';

/** #1108: sluga oferty/firmy nie gubią liter bez rozkładu Unicode (ł, ø, ß, æ, œ…). */
describe('asciiSlugBase', () => {
  it('litery z akcentami i bez rozkładu dają czytelny slug', () => {
    expect(asciiSlugBase('Łódź Magazynier', 60)).toBe('lodz-magazynier');
    expect(asciiSlugBase('Straße Bäcker Œuvre', 60)).toBe('strasse-backer-oeuvre');
    expect(asciiSlugBase('Ærøskøbing Møller', 60)).toBe('aeroskobing-moller');
    expect(asciiSlugBase('Đorđe Þór', 60)).toBe('dorde-thor');
    expect(asciiSlugBase('Café Élan – Brussel', 60)).toBe('cafe-elan-brussel');
  });

  it('wielkie litery (Ł, Ø, ẞ) i limit długości bez końcowego łącznika', () => {
    expect(asciiSlugBase('ŁUKASZ ØSTERGAARD', 60)).toBe('lukasz-ostergaard');
    expect(asciiSlugBase('Kierowca ciężarówki C+E Antwerpia', 15)).toBe('kierowca-ciezar');
    expect(asciiSlugBase('ab cd', 3)).toBe('ab');
  });

  it('brak liter łacińskich = pusty slug (wywołujący ma zastępnik)', () => {
    expect(asciiSlugBase('日本語 — ???', 60)).toBe('');
  });

  it('kontrola ujemna: sam NFKD (stan sprzed naprawy) gubi ł/ø/ß/æ/œ', () => {
    const legacy = (s: string) =>
      s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    expect(legacy('Łódź')).toBe('odz');
    expect(asciiSlugBase('Łódź', 60)).not.toBe(legacy('Łódź'));
    expect(legacy('Straße')).toBe('stra-e');
  });
});
