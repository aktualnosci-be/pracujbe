/**
 * Minimalny plik złożony OLE (Compound File Binary, wersja 3, sektory 512 B) do testów
 * wykrywania typu (`src/lib/files/file-type.ts`). Sektor 0 = FAT, sektor 1 = katalog
 * (korzeń + podane strumienie, bez danych). Wystarcza do sprawdzenia CLSID korzenia
 * i nazw strumieni — tak jak plik Word 97–2003 (`WordDocument`) albo pakiet instalatora.
 */

export const WORD_CLSID = '00020906-0000-0000-c000-000000000046';
/** Pakiet instalatora Windows. */
export const MSI_CLSID = '000c1084-0000-0000-c000-000000000046';

const SECTOR = 512;
const END_OF_CHAIN = 0xfffffffe;
const FREE = 0xffffffff;
const FAT_SECTOR = 0xfffffffd;

function writeClsid(buf: Buffer, offset: number, clsid: string): void {
  const [a, b, c, d, e] = clsid.split('-') as [string, string, string, string, string];
  buf.writeUInt32LE(parseInt(a, 16), offset);
  buf.writeUInt16LE(parseInt(b, 16), offset + 4);
  buf.writeUInt16LE(parseInt(c, 16), offset + 6);
  Buffer.from(d + e, 'hex').copy(buf, offset + 8);
}

function writeEntry(buf: Buffer, offset: number, name: string, type: number, clsid?: string): void {
  const encoded = Buffer.from(`${name}\u0000`, 'utf16le');
  encoded.copy(buf, offset);
  buf.writeUInt16LE(encoded.length, offset + 0x40);
  buf[offset + 0x42] = type;
  buf.writeUInt32LE(FREE, offset + 0x44); // lewy
  buf.writeUInt32LE(FREE, offset + 0x48); // prawy
  buf.writeUInt32LE(FREE, offset + 0x4c); // dziecko
  if (clsid) writeClsid(buf, offset + 0x50, clsid);
  buf.writeUInt32LE(END_OF_CHAIN, offset + 0x74);
}

export interface CfbOptions {
  rootClsid?: string;
  streams?: string[];
  /** Katalog wskazuje sam na siebie w FAT (uszkodzony łańcuch). */
  loopDirectory?: boolean;
}

export function buildCfb({ rootClsid = WORD_CLSID, streams = ['WordDocument'], loopDirectory = false }: CfbOptions = {}): Buffer {
  const header = Buffer.alloc(SECTOR);
  Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]).copy(header, 0);
  header.writeUInt16LE(0x3e, 0x18);
  header.writeUInt16LE(3, 0x1a);
  header.writeUInt16LE(0xfffe, 0x1c);
  header.writeUInt16LE(9, 0x1e);
  header.writeUInt16LE(6, 0x20);
  header.writeUInt32LE(1, 0x2c); // sektorów FAT
  header.writeUInt32LE(1, 0x30); // pierwszy sektor katalogu
  header.writeUInt32LE(4096, 0x38);
  header.writeUInt32LE(END_OF_CHAIN, 0x3c);
  header.writeUInt32LE(END_OF_CHAIN, 0x44);
  header.writeUInt32LE(0, 0x4c); // DIFAT[0] = sektor 0
  for (let i = 1; i < 109; i += 1) header.writeUInt32LE(FREE, 0x4c + i * 4);

  const fat = Buffer.alloc(SECTOR, 0xff);
  fat.writeUInt32LE(FAT_SECTOR, 0);
  fat.writeUInt32LE(loopDirectory ? 1 : END_OF_CHAIN, 4);

  const directory = Buffer.alloc(SECTOR);
  writeEntry(directory, 0, 'Root Entry', 5, rootClsid);
  streams.forEach((name, i) => writeEntry(directory, (i + 1) * 128, name, 2));
  return Buffer.concat([header, fat, directory]);
}
