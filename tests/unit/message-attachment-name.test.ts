import { describe, expect, it } from 'vitest';

import { containsPersonalIdentifier } from '@/lib/privacy/sensitive-data';
import {
  attachmentNameForScan,
  attachmentNameHasPersonalIdentifier,
  checkAttachmentFile,
} from '@/lib/validation/message-attachment';

/**
 * Nazwa pliku załącznika z numerem NISS/BIS, PESEL, eID albo numerem dokumentu jest
 * odrzucana przed wysyłką do bucketu (#495). Numery testowe = te same co `sensitive-data.test`
 * (poprawne sumy kontrolne, fikcyjne osoby).
 */

const png = (name: string) => ({ name, size: 10, type: 'image/png' });

describe('nazwa pliku załącznika — numery identyfikacyjne (#495)', () => {
  it.each([
    ['NISS z separatorami', 'NISS_85.07.30-033.28.pdf'],
    ['NISS bez separatorów', '85073003328.pdf'],
    ['numer BIS', 'bis_85473003317.png'],
    ['PESEL', 'skan_44051401359.jpg'],
    ['karta eID', 'eid_591-2345678-29.png'],
    ['paszport nr', 'paszport_nr_AB1234567.pdf'],
    ['paspoort (NL)', 'paspoort nummer 12345678.pdf'],
    ['passeport (FR)', 'passeport+n°+12345678.docx'],
    ['numer po słowie kluczowym bez sumy', 'rijksregisternummer 123456.pdf'],
  ])('odrzuca: %s', (_label, name) => {
    expect(attachmentNameHasPersonalIdentifier(name)).toBe(true);
    expect(checkAttachmentFile(png(name))).toBe('sensitiveId');
  });

  it.each([
    'zdjęcie.png',
    'CV_Jan_2026-09-01.pdf',
    'faktura_2026_0042.pdf',
    'certyfikat VCA 2024.pdf',
    'IMG_20260926_153012.jpg',
    'paszport.pdf',
    'prawo jazdy kat C.png',
    // 11 cyfr bez poprawnej sumy NISS/PESEL i bez słowa kluczowego.
    'zamowienie_12345678901.pdf',
  ])('przepuszcza zwykłą nazwę: %s', (name) => {
    expect(attachmentNameHasPersonalIdentifier(name)).toBe(false);
    expect(checkAttachmentFile(png(name))).toBeNull();
  });

  it('kolejność: pusty/za duży/zły typ mają pierwszeństwo, brak nazwy = bez kontroli nazwy', () => {
    expect(checkAttachmentFile({ name: 'NISS_85073003328.png', size: 0, type: 'image/png' })).toBe('empty');
    expect(checkAttachmentFile({ name: 'NISS_85073003328.gif', size: 10, type: 'image/gif' })).toBe('type');
    expect(checkAttachmentFile({ size: 10, type: 'image/png' })).toBeNull();
  });

  it('kontrola ujemna: bez zamiany separatorów nazwa z „_” przeszłaby detektor', () => {
    // Słowo kluczowe sklejone podkreśleniem z numerem nie jest osobnym tokenem.
    expect(attachmentNameForScan('paszport_nr_AB1234567.pdf')).toBe('paszport nr AB1234567');
    expect(attachmentNameHasPersonalIdentifier('paszport nr AB1234567')).toBe(true);
    expect(containsPersonalIdentifier('paszport_nr_AB1234567.pdf')).toBe(false);
    expect(containsPersonalIdentifier('rijksregisternummer_123456.pdf')).toBe(false);
    expect(attachmentNameHasPersonalIdentifier('rijksregisternummer_123456.pdf')).toBe(true);
  });
});
