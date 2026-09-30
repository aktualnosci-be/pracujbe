import 'server-only';

/**
 * Zaufany adres IP klienta zza reverse proxy (utwardzenie #588/#602).
 *
 * Model zaufania: proces Node nie przyjmuje ruchu bezpośrednio z internetu — jedyna ścieżka
 * prowadzi przez brzeg Railway (domyślnie) albo przez Cloudflare przed Railway (jawnie
 * skonfigurowane). Zaufana warstwa proxy USTAWIA jeden konkretny nagłówek na podstawie
 * własnego, kontrolowanego połączenia TCP — klient nie ma jak go nadpisać.
 *
 * `X-Forwarded-For` celowo NIE jest tu źródłem: to nagłówek DOPISYWANY do łańcucha, który
 * klient wysyła jako pierwszy, więc bez jawnie skonfigurowanej liczby zaufanych hopów nie da
 * się bezpiecznie wskazać, który segment pochodzi od proxy, a który od żądającego. Zamiast
 * zgadywać — czytamy wyłącznie jeden, jawnie wskazany nagłówek; jego brak daje `null`
 * (receipt/log zostaje bez IP, zamiast przyjmować niezaufaną wartość).
 */

export type TrustedProxyHeaderName = 'x-real-ip' | 'cf-connecting-ip';

const KNOWN_HEADERS: ReadonlySet<string> = new Set(['x-real-ip', 'cf-connecting-ip']);

/** Nazwa zaufanego nagłówka proxy: `x-real-ip` (Railway, domyślnie) albo `cf-connecting-ip`
 * (Cloudflare proxying przed Railway) przez `TRUSTED_PROXY_HEADER`. Nieznana/pusta wartość
 * wraca do domyślnej — nie wyłącza odczytu IP przez literówkę w konfiguracji. */
export function trustedProxyHeaderName(): TrustedProxyHeaderName {
  const raw = process.env.TRUSTED_PROXY_HEADER?.trim().toLowerCase();
  return raw && KNOWN_HEADERS.has(raw) ? (raw as TrustedProxyHeaderName) : 'x-real-ip';
}

/** Górny limit długości — obrona w głąb (adres wraca do bazy jako `inet`/`text`), nie walidacja formatu. */
const MAX_IP_LENGTH = 64;

/**
 * Opublikowane zakresy adresów brzegu Cloudflare (https://www.cloudflare.com/ips/, stan
 * 2026-09). `CF-Connecting-IP` przyjmujemy wyłącznie od połączenia z tych zakresów (#1090):
 * żądanie wysłane z pominięciem Cloudflare (np. na domenę Railway) może nieść dowolny
 * `CF-Connecting-IP`, ale jego rzeczywisty peer (X-Real-IP brzegu Railway) nie należy do
 * Cloudflare. Nowy zakres Cloudflare = aktualizacja listy (bez niej ruch z tego zakresu liczy
 * się pod adresem brzegu — bezpieczny kierunek błędu).
 */
export const CLOUDFLARE_IP_RANGES: readonly string[] = [
  '173.245.48.0/20', '103.21.244.0/22', '103.22.200.0/22', '103.31.4.0/22', '141.101.64.0/18',
  '108.162.192.0/18', '190.93.240.0/20', '188.114.96.0/20', '197.234.240.0/22', '198.41.128.0/17',
  '162.158.0.0/15', '104.16.0.0/13', '104.24.0.0/14', '172.64.0.0/13', '131.0.72.0/22',
  '2400:cb00::/32', '2606:4700::/32', '2803:f800::/32', '2405:b500::/32', '2405:8100::/32',
  '2a06:98c0::/29', '2c0f:f248::/32',
];

type ParsedIp = { v: 4 | 6; value: bigint };

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

function parseIp(value: string): ParsedIp | null {
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

/** Czy peer połączenia (adres widziany przez brzeg Railway) jest brzegiem Cloudflare. */
export function isCloudflareEdgeIp(ip: string): boolean {
  return CLOUDFLARE_IP_RANGES.some((cidr) => ipInCidr(ip, cidr));
}

function headerIp(headers: Headers, name: string): string | null {
  const value = headers.get(name)?.trim();
  if (!value || value.length > MAX_IP_LENGTH) return null;
  return value;
}

/**
 * Adres klienta z JEDYNEGO, jawnie skonfigurowanego, zaufanego nagłówka proxy. `null`, gdy
 * nagłówek jest pusty/nieustawiony — NIGDY nie sięgamy po `X-Forwarded-For` jako zastępstwo.
 *
 * Tryb Cloudflare (`cf-connecting-ip`, #1090): `CF-Connecting-IP` liczy się tylko wtedy, gdy
 * żądanie faktycznie przeszło przez Cloudflare, czyli gdy peer z `X-Real-IP` (ustawia go brzeg
 * Railway z połączenia TCP) należy do zakresów Cloudflare. Żądanie z pominięciem Cloudflare
 * dostaje adres peera (prawdziwego nadawcę), a nie wartość, którą sam wpisał. Połączenie
 * z Cloudflare bez `CF-Connecting-IP` oraz brak peera → `null` (adresu brzegu nie
 * przypisujemy klientowi).
 */
export function trustedClientIp(headers: Headers): string | null {
  const name = trustedProxyHeaderName();
  if (name !== 'cf-connecting-ip') return headerIp(headers, name);
  const peer = headerIp(headers, 'x-real-ip');
  if (!peer) return null;
  if (!isCloudflareEdgeIp(peer)) return peer;
  return headerIp(headers, 'cf-connecting-ip');
}
