// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { docxXmlToText, extractCvText } from '@/lib/cv-import/text';
import { buildDocx, buildPdf, buildZip, DOCX_TYPE, PDF_TYPE } from '../helpers/cv-fixtures';

/**
 * #487 — lokalne wyciągnięcie tekstu z CV: PDF (pdf.js) i DOCX (własny odczyt ZIP, tylko
 * treść dokumentu, bez nagłówków/stopek), odrzucenie złego typu, DOC, skanu i „zip bomb”.
 */

const LINES = ['Tomasz Testowy', 'Doswiadczenie zawodowe', 'Magazynier 2020-2025, Logistyka Test NV', 'Obsluga wozka widlowego i skanera'];

describe('extractCvText', () => {
  it('PDF z warstwą tekstu → linie tekstu', async () => {
    const r = await extractCvText(new Uint8Array(buildPdf(LINES)), PDF_TYPE);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    for (const line of LINES) expect(r.text).toContain(line);
    expect(r.text.split('\n').length).toBeGreaterThanOrEqual(LINES.length);
  });

  it('DOCX → akapity jako linie; nagłówek dokumentu (dane kontaktowe) pominięty', async () => {
    const docx = buildDocx(LINES.join('\n'), 'naglowek-kontakt@example.be');
    const r = await extractCvText(new Uint8Array(docx), DOCX_TYPE);
    expect(r).toMatchObject({ ok: true });
    if (!r.ok) return;
    expect(r.text).toBe(LINES.join('\n'));
    expect(r.text).not.toContain('naglowek-kontakt');
  });

  it('encje XML, tabulatory i łamania linii', () => {
    const xml = '<w:p><w:r><w:t>A &amp; B</w:t><w:tab/><w:t xml:space="preserve">C&#243;</w:t><w:br/><w:t>D</w:t><w:t/></w:r></w:p>';
    expect(docxXmlToText(xml)).toBe('A & B\tCó\nD\n');
  });

  it('typ sprawdzany po sygnaturze, DOC nieobsługiwany, pusty i za duży plik odrzucone', async () => {
    expect(await extractCvText(new Uint8Array(buildDocx('x'.repeat(100))), PDF_TYPE)).toEqual({ ok: false, problem: 'type' });
    expect(await extractCvText(new Uint8Array([0x25, 0x50, 0x44, 0x46]), 'text/plain')).toEqual({ ok: false, problem: 'type' });
    const ole = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
    expect(await extractCvText(ole, 'application/msword')).toEqual({ ok: false, problem: 'unsupported' });
    expect(await extractCvText(new Uint8Array(), PDF_TYPE)).toEqual({ ok: false, problem: 'empty' });
    expect(await extractCvText(new Uint8Array(5 * 1024 * 1024 + 1), PDF_TYPE)).toEqual({ ok: false, problem: 'tooLarge' });
  });

  it('PDF bez tekstu (np. skan) → noText; uszkodzony PDF → unreadable', async () => {
    expect(await extractCvText(new Uint8Array(buildPdf([])), PDF_TYPE)).toEqual({ ok: false, problem: 'noText' });
    expect(await extractCvText(new Uint8Array(Buffer.from('%PDF-1.4 garbage')), PDF_TYPE)).toEqual({ ok: false, problem: 'unreadable' });
  });

  it('DOCX, którego treść po dekompresji przekracza limit („zip bomb”) → unreadable', async () => {
    const bomb = buildZip({ 'word/document.xml': Buffer.alloc(5 * 1024 * 1024, 0x20) });
    expect(await extractCvText(new Uint8Array(bomb), DOCX_TYPE)).toEqual({ ok: false, problem: 'unreadable' });
    // Kontrola ujemna: ten sam kontener poniżej limitu jest czytany.
    const small = buildZip({ 'word/document.xml': `<w:p><w:t>${'Magazynier '.repeat(10)}</w:t></w:p>` });
    expect(await extractCvText(new Uint8Array(small), DOCX_TYPE)).toMatchObject({ ok: true });
  });
});
