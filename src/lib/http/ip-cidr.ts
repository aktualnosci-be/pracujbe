/**
 * Parsowanie adresów IPv4/IPv6 i sprawdzanie przynależności do zakresu CIDR (#1090). Czyste
 * funkcje bez zależności — używane przez `trusted-ip.ts` i walidację pobranych zakresów
 * Cloudflare (`cloudflare-ranges.ts`).
 */
export type ParsedIp = { v: 4 | 6; value: bigint };

function parseIpv4(value: string): bigint | null {
  const parts = value.split('.');
  if (parts.length !== 4) return null;
  let out = 0n;
  for (const part of parts) {
    if (!/^[0-9]{1,3}$/.test(part)) return null;
    const n = Number(part);
    if (n > 255) return null;
    out = (out << 8n) | BigInt(n);
  }
  return out;
}

function parseIpv6(value: string): bigint | null {
  let text = value;
  // Końcówka w zapisie IPv4 (np. `::ffff:1.2.3.4`) = dwie grupy szesnastkowe.
  if (text.includes('.')) {
    const cut = text.lastIndexOf(':');
    const v4 = cut >= 0 ? parseIpv4(text.slice(cut + 1)) : null;
    if (v4 === null) return null;
    text = `${text.slice(0, cut + 1)}${(v4 >> 16n).toString(16)}:${(v4 & 0xffffn).toString(16)}`;
  }
  if (!/^[0-9a-f:]+$/i.test(text)) return null;
  const halves = text.split('::');
  if (halves.length > 2) return null;
  const group = (g: string): bigint | null => (/^[0-9a-f]{1,4}$/i.test(g) ? BigInt(parseInt(g, 16)) : null);
  const split = (part: string | undefined): (bigint | null)[] => (part ? part.split(':').map(group) : []);
  const left = split(halves[0]);
  const right = split(halves[1]);
  if (left.includes(null) || right.includes(null)) return null;
  const known = left.length + right.length;
  if (halves.length === 1 ? known !== 8 : known > 7) return null;
  const groups = [...(left as bigint[]), ...Array<bigint>(8 - known).fill(0n), ...(right as bigint[])];
  return groups.reduce((acc, g) => (acc << 16n) | g, 0n);
}

export function parseIp(value: string): ParsedIp | null {
  const v4 = parseIpv4(value);
  if (v4 !== null) return { v: 4, value: v4 };
  const v6 = parseIpv6(value);
  if (v6 === null) return null;
  // IPv4 zapisany jako IPv6 (`::ffff:a.b.c.d`) porównujemy jak IPv4.
  if (v6 >> 32n === 0xffffn) return { v: 4, value: v6 & 0xffffffffn };
  return { v: 6, value: v6 };
}

/** Czy adres należy do zakresu CIDR (`adres/prefiks`). Zły zapis = `false`. */
export function ipInCidr(ip: string, cidr: string): boolean {
  const [base, bitsText] = cidr.split('/');
  const addr = parseIp(ip.trim());
  const net = base ? parseIp(base) : null;
  if (!addr || !net || addr.v !== net.v || !bitsText || !/^[0-9]{1,3}$/.test(bitsText)) return false;
  const width = addr.v === 4 ? 32n : 128n;
  const bits = BigInt(Number(bitsText));
  if (bits > width) return false;
  const shift = width - bits;
  return addr.value >> shift === net.value >> shift;
}


/** Poprawny zapis zakresu CIDR (`adres/prefiks`, prefiks w granicach rodziny). */
export function isValidCidr(cidr: string): boolean {
  const [base, bitsText, extra] = cidr.split('/');
  if (extra !== undefined || !base || !bitsText || !/^[0-9]{1,3}$/.test(bitsText)) return false;
  const net = parseIp(base);
  if (!net) return false;
  return Number(bitsText) <= (net.v === 4 ? 32 : 128);
}
