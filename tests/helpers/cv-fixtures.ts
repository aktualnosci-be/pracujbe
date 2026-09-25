import { deflateRawSync } from 'node:zlib';

/**
 * Syntetyczne CV do testów importu (#487, #498). Wszystkie osoby i numery są fikcyjne.
 * `REFEREES` = dane dwóch referentów i przełożonego — NIE mogą trafić do payloadu modelu
 * ani do propozycji.
 */
export const REFEREES = {
  name1: 'Marek Zieliński',
  email1: 'marek.zielinski@logistyka-test.be',
  phone1: '+32 478 11 22 33',
  name2: 'Anna De Smet',
  email2: 'anna.desmet@warehouse-test.be',
  phone2: '0479 44 55 66',
  supervisor: 'Pieter Janssens',
} as const;

export const CANDIDATE_CONTACT = {
  email: 'kandydat.testowy@example.be',
  phone: '+32 470 98 76 54',
} as const;

export const CV_WITH_REFEREES = [
  'Tomasz Testowy',
  `${CANDIDATE_CONTACT.email} | ${CANDIDATE_CONTACT.phone}`,
  'Antwerpia',
  '',
  'Profil',
  'Magazynier z 5 lat doświadczenia w logistyce.',
  '',
  'Doświadczenie zawodowe',
  '2020–2025 Magazynier, Logistyka Test NV, Antwerpia',
  'Obsługa wózka widłowego, kompletacja zamówień przy użyciu skanera.',
  `Przełożony: ${REFEREES.supervisor}`,
  '2018–2020 Kierowca, Transport Test BV',
  '',
  'Języki',
  'polski – ojczysty, niderlandzki – komunikatywny',
  '',
  'Certyfikaty',
  'VCA Basis, prawo jazdy kat. B',
  '',
  'Referencje',
  `${REFEREES.name1}, kierownik magazynu`,
  `${REFEREES.email1}, tel. ${REFEREES.phone1}`,
  `${REFEREES.name2}, HR`,
  `${REFEREES.email2}, ${REFEREES.phone2}`,
  '',
  'Zainteresowania',
  'Rower, wędkarstwo',
].join('\n');

/* ---------------------------------------------------------------------------
 * Pliki: minimalny DOCX (ZIP z `word/document.xml`) i PDF z warstwą tekstu
 * ------------------------------------------------------------------------- */

function crc32(buf: Buffer): number {
  let c = ~0;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
  }
  return ~c >>> 0;
}

/** ZIP (deflate) z podanymi wpisami. */
export function buildZip(entries: Record<string, string | Buffer>): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, content] of Object.entries(entries)) {
    const data = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8');
    const compressed = deflateRawSync(data);
    const nameBuf = Buffer.from(name, 'utf8');
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(crc32(data), 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    locals.push(local, nameBuf, compressed);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(crc32(data), 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuf);
    offset += 30 + nameBuf.length + compressed.length;
  }
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  const count = Object.keys(entries).length;
  eocd.writeUInt16LE(count, 8);
  eocd.writeUInt16LE(count, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, eocd]);
}

const escapeXml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** DOCX: każda linia tekstu = akapit; nagłówek dokumentu (`header1.xml`) z osobnym tekstem. */
export function buildDocx(text: string, headerText = ''): Buffer {
  const paragraphs = text
    .split('\n')
    .map((line) => `<w:p><w:r><w:t xml:space="preserve">${escapeXml(line)}</w:t></w:r></w:p>`)
    .join('');
  return buildZip({
    '[Content_Types].xml': '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>',
    'word/document.xml': `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paragraphs}</w:body></w:document>`,
    'word/header1.xml': `<w:hdr xmlns:w="x"><w:p><w:r><w:t>${escapeXml(headerText)}</w:t></w:r></w:p></w:hdr>`,
  });
}

/** PDF 1.4 z czcionką Helvetica (WinAnsi) — każda linia jako osobny wiersz tekstu. */
export function buildPdf(lines: string[]): Buffer {
  const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
  const content = ['BT', '/F1 11 Tf', '14 TL', '50 780 Td', ...lines.map((l) => `(${esc(l)}) Tj T*`), 'ET'].join('\n');
  const contentBuf = Buffer.from(content, 'latin1');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${contentBuf.length} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
  ];
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((obj, i) => {
    offsets.push(Buffer.byteLength(out, 'latin1'));
    out += `${i + 1} 0 obj\n${obj}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out, 'latin1');
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  out += offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('');
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

export const DOCX_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
export const PDF_TYPE = 'application/pdf';
