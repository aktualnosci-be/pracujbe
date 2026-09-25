// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { cvHeadingKind, isDisallowedProposalText, minimizeCvText } from '@/lib/cv-import/minimize';
import { CANDIDATE_CONTACT, CV_WITH_REFEREES, REFEREES } from '../helpers/cv-fixtures';
import { PII } from '../helpers/privacy-fixtures';

/**
 * #487/#498 — lokalna minimalizacja CV przed modelem: referenci i osoby trzecie usunięte,
 * NISS/BIS/dokumenty = odmowa, niepewna redakcja = bezpieczne zatrzymanie, kategorie
 * szczególne usunięte. Wynik zawiera tylko liczniki, bez wartości.
 */

function expectNoReferees(text: string): void {
  for (const [key, value] of Object.entries(REFEREES)) expect(text, `referent: ${key}`).not.toContain(value);
}

describe('minimizeCvText — osoby trzecie', () => {
  it('CV z dwoma referentami i przełożonym: ich dane znikają, treść zawodowa zostaje', () => {
    // Kontrola ujemna: surowy tekst zawiera dane referentów (inaczej test niczego by nie dowodził).
    expect(CV_WITH_REFEREES).toContain(REFEREES.email1);
    expect(CV_WITH_REFEREES).toContain(REFEREES.supervisor);

    const r = minimizeCvText(CV_WITH_REFEREES);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expectNoReferees(r.text);
    expect(r.text).not.toContain(CANDIDATE_CONTACT.email);
    expect(r.text).not.toContain(CANDIDATE_CONTACT.phone);
    expect(r.text).toContain('Obsługa wózka widłowego');
    expect(r.text).toContain('VCA Basis');
    expect(r.text).toContain('Zainteresowania'); // sekcja referencji kończy się na znanym nagłówku
    expect(r.counts.referenceSections).toBe(1);
    expect(r.counts.thirdPartyLines).toBe(1);
    expect(r.counts.contacts).toBe(2);
    // Liczniki bez wartości.
    expect(JSON.stringify(r.counts)).not.toMatch(/@|\d{6}/);
  });

  it('redakcja jest idempotentna (serwer ponownie redaguje tekst z podglądu)', () => {
    const first = minimizeCvText(CV_WITH_REFEREES);
    if (!first.ok) throw new Error('expected ok');
    const second = minimizeCvText(first.text);
    expect(second).toMatchObject({ ok: true, text: first.text });
  });

  it('linia „Referencje:” w treści usuwa etykietę i kolejne linie do pustej linii', () => {
    const cv = ['Jan Test', '', 'Doświadczenie', 'Magazynier 2019–2024', 'Referencje:', REFEREES.name1, 'Logistyka Test NV', '', 'Umiejętności', 'wózek widłowy'].join('\n');
    const r = minimizeCvText(cv);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.text).not.toContain(REFEREES.name1);
    expect(r.text).toContain('wózek widłowy');
  });

  it('nagłówki referencji rozpoznawane w PL/NL/FR/EN (także wielkimi literami i z dwukropkiem)', () => {
    for (const h of ['Referencje', 'REFERENCES:', 'Referenties', 'Références', 'Referees']) {
      expect(cvHeadingKind(h)).toBe('references');
    }
    expect(cvHeadingKind('Persoonlijke gegevens')).toBe('personal');
    expect(cvHeadingKind('Werkervaring')).toBe('other');
    expect(cvHeadingKind('Magazynier w firmie Logistyka Test NV z Antwerpii')).toBeNull();
  });

  it('kontakt poza nagłówkiem dokumentu = bezpieczne zatrzymanie (nie da się oddzielić osoby trzeciej)', () => {
    const cv = [
      'Jan Test',
      CANDIDATE_CONTACT.email,
      '',
      'Doświadczenie',
      'Magazynier 2019–2024, Logistyka Test NV',
      'Kompletacja zamówień',
      'Wózek widłowy',
      'Inwentaryzacja',
      'Załadunek ciężarówek',
      'Praca zmianowa',
      `W razie pytań: ${REFEREES.name2} ${REFEREES.phone2}`,
    ].join('\n');
    expect(minimizeCvText(cv)).toEqual({ ok: false, reason: 'uncertain' });
  });

  it('więcej niż jeden e-mail w dokumencie = bezpieczne zatrzymanie', () => {
    const cv = ['Jan Test', CANDIDATE_CONTACT.email, REFEREES.email1, '', 'Doświadczenie', 'Magazynier od 2019 roku w Antwerpii'].join('\n');
    expect(minimizeCvText(cv)).toEqual({ ok: false, reason: 'uncertain' });
  });
});

describe('minimizeCvText — identyfikatory, dane osobowe, kategorie szczególne', () => {
  it('NISS/BIS (także w sekcji danych osobowych) = odmowa całości', () => {
    const cv = ['Dane osobowe', `NISS: ${PII.niss}`, '', 'Doświadczenie', 'Magazynier od 2019 roku w Antwerpii'].join('\n');
    expect(minimizeCvText(cv)).toEqual({ ok: false, reason: 'identifier' });
    expect(minimizeCvText(`Magazynier. Paszport nr EA1234567 ważny`)).toEqual({ ok: false, reason: 'identifier' });
  });

  it('usuwa dane osobowe i kategorie szczególne (art. 9/10), zostawia resztę', () => {
    const cv = [
      'Jan Test',
      'Data urodzenia: 01.02.1990',
      'Stan cywilny: żonaty',
      'Obywatelstwo: polskie',
      '',
      'Doświadczenie',
      'Magazynier 2019–2024, Logistyka Test NV',
      'Orzeczenie o niepełnosprawności w stopniu lekkim',
      'Członek związku zawodowego',
      'Zaświadczenie o niekaralności',
      'Wyznanie: katolickie',
      'Obsługa wózka widłowego',
      'Profil LinkedIn: https://www.linkedin.com/in/jan-test',
    ].join('\n');
    const r = minimizeCvText(cv);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.text).not.toMatch(/1990|żonaty|polskie|niepełnospraw|związku|niekaraln|katolick|linkedin\.com|jan-test/i);
    expect(r.text).toContain('Obsługa wózka widłowego');
    expect(r.counts.personalLines).toBe(3);
    expect(r.counts.specialCategoryLines).toBe(4);
    expect(r.counts.contacts).toBe(1);
  });

  it('sekcja „Kontakt/Dane osobowe” usuwana w całości', () => {
    const cv = ['Kontakt', 'Rue Test 12, 2000 Antwerpen', CANDIDATE_CONTACT.phone, '', 'Werkervaring', 'Orderpicker 2019–2024 bij Logistiek Test NV'].join('\n');
    const r = minimizeCvText(cv);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.text).not.toContain('Rue Test');
    expect(r.text).toContain('Orderpicker');
    expect(r.counts.personalSections).toBe(1);
  });
});

describe('isDisallowedProposalText', () => {
  it('odrzuca kontakt, link, znacznik redakcji, osobę trzecią i kategorię szczególną', () => {
    for (const v of [REFEREES.email1, REFEREES.phone1, 'https://example.be', '[email removed]', 'Referencje: Marek', 'Przełożony: Pieter Janssens', 'Niepełnosprawność', PII.niss]) {
      expect(isDisallowedProposalText(v), v).toBe(true);
    }
    for (const v of ['Obsługa wózka widłowego', 'VCA Basis', 'Magazynier', 'Nederlands']) {
      expect(isDisallowedProposalText(v), v).toBe(false);
    }
  });
});
