import 'server-only';

import { lookup as dnsLookup } from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import { BlockList, isIP, type LookupFunction } from 'node:net';
import zlib from 'node:zlib';

/**
 * Serwerowe pobieranie strony ogłoszenia (#465) odporne na SSRF.
 *
 * Zasady:
 *   - tylko `http:`/`https:`, bez danych logowania w adresie, tylko porty 80/443;
 *   - nazwa hosta rozwiązywana PRZED połączeniem; jeśli KTÓRYKOLWIEK adres jest prywatny,
 *     pętlą zwrotną, link-local (w tym metadane chmury 169.254.169.254 / fd00:ec2::254),
 *     multicast lub zarezerwowany — odmowa;
 *   - połączenie jest przypięte do sprawdzonego adresu (własny `lookup`), więc DNS rebinding
 *     między sprawdzeniem a połączeniem nic nie zmienia;
 *   - przekierowania ręcznie (maks. 3), każde sprawdzane od nowa jak pierwszy adres;
 *   - twardy limit czasu całości i rozmiaru ciała (także po dekompresji);
 *   - żaden skrypt nie jest wykonywany: HTML zamieniamy na tekst (`htmlToText`).
 *
 * Wynik to NIEZAUFANE dane — trafiają do modelu jako treść do analizy, nigdy jako instrukcje.
 */

export const FETCH_TIMEOUT_MS = 8_000;
export const MAX_HTML_BYTES = 2 * 1024 * 1024; // 2 MB
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5 MB (jak upload)
export const MAX_REDIRECTS = 3;
export const MAX_PAGE_TEXT_CHARS = 40_000;
export const MAX_URL_LENGTH = 2048;

export type SafeFetchProblem =
  | 'invalidUrl'
  | 'blockedAddress'
  | 'tooManyRedirects'
  | 'timeout'
  | 'tooLarge'
  | 'unsupportedType'
  | 'httpError'
  | 'network';

export class SafeFetchError extends Error {
  constructor(readonly problem: SafeFetchProblem) {
    super(problem);
    this.name = 'SafeFetchError';
  }
}

export type SafeFetchResult =
  | { kind: 'text'; url: string; text: string }
  | { kind: 'image'; url: string; mediaType: 'image/png' | 'image/jpeg' | 'image/webp'; bytes: Buffer };

/* ---------------------------------------------------------------------------
 * Klasyfikacja adresów
 * ------------------------------------------------------------------------- */

// Osobne listy: BlockList dopasowuje adres IPv4 także do reguł IPv4-mapped IPv6 (::ffff:0:0/96),
// więc jedna wspólna lista blokowałaby każdy publiczny IPv4.
const BLOCKED_V4 = new BlockList();
const BLOCKED_V6 = new BlockList();
for (const [net, prefix] of [
  ['0.0.0.0', 8], // „ta sieć"
  ['10.0.0.0', 8], // prywatna
  ['100.64.0.0', 10], // CGNAT
  ['127.0.0.0', 8], // pętla zwrotna
  ['169.254.0.0', 16], // link-local, metadane chmury
  ['172.16.0.0', 12], // prywatna
  ['192.0.0.0', 24], // IETF
  ['192.0.2.0', 24], // TEST-NET-1
  ['192.88.99.0', 24], // 6to4 relay
  ['192.168.0.0', 16], // prywatna
  ['198.18.0.0', 15], // benchmark
  ['198.51.100.0', 24], // TEST-NET-2
  ['203.0.113.0', 24], // TEST-NET-3
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // zarezerwowana + broadcast
] as const) {
  BLOCKED_V4.addSubnet(net, prefix, 'ipv4');
}
for (const [net, prefix] of [
  ['::', 128], // nieokreślony
  ['::1', 128], // pętla zwrotna
  ['::', 96], // IPv4-compatible (przestarzałe)
  ['::ffff:0:0', 96], // IPv4-mapped — omija filtry IPv4
  ['64:ff9b::', 96], // NAT64 — osadzony IPv4
  ['64:ff9b:1::', 48], // NAT64 lokalny
  ['100::', 64], // discard
  ['2001::', 23], // IETF (Teredo, ORCHID, …)
  ['2001:db8::', 32], // dokumentacja
  ['2002::', 16], // 6to4 — osadzony IPv4
  ['fc00::', 7], // unique local (w tym fd00:ec2::254)
  ['fe80::', 10], // link-local
  ['fec0::', 10], // site-local (przestarzałe)
  ['ff00::', 8], // multicast
] as const) {
  BLOCKED_V6.addSubnet(net, prefix, 'ipv6');
}

/** Czy adres IP jest niedozwolony jako cel pobrania (prywatny/wewnętrzny/zarezerwowany). */
export function isBlockedAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return BLOCKED_V4.check(address, 'ipv4');
  if (family === 6) return BLOCKED_V6.check(address, 'ipv6');
  return true; // nie-IP = nie wiemy, dokąd prowadzi
}

/** Nazwy, których nie rozwiązujemy wcale (lokalne/wewnętrzne strefy). */
const BLOCKED_HOST_RE = /(^|\.)(localhost|local|internal|intranet|home|lan|corp|localdomain|home\.arpa)$/i;

/* ---------------------------------------------------------------------------
 * Walidacja adresu URL
 * ------------------------------------------------------------------------- */

export interface SafeFetchDeps {
  /** Rozwiązywanie nazw (testy wstrzykują atrapę; domyślnie systemowy DNS). */
  resolve?: (hostname: string) => Promise<string[]>;
  /** Klasyfikacja adresu (testy mogą dopuścić lokalny serwer testowy). */
  isBlocked?: (address: string) => boolean;
  /** Dozwolone porty (domyślnie 80/443). */
  allowedPorts?: readonly number[];
  timeoutMs?: number;
}

const DEFAULT_PORTS = [80, 443] as const;

/** Parsuje i wstępnie sprawdza adres (schemat, dane logowania, port, nazwa hosta). */
export function parsePublicUrl(raw: string, allowedPorts: readonly number[] = DEFAULT_PORTS): URL {
  if (typeof raw !== 'string') throw new SafeFetchError('invalidUrl');
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > MAX_URL_LENGTH) throw new SafeFetchError('invalidUrl');
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new SafeFetchError('invalidUrl');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new SafeFetchError('invalidUrl');
  if (url.username || url.password) throw new SafeFetchError('invalidUrl');
  const port = url.port ? Number(url.port) : url.protocol === 'https:' ? 443 : 80;
  if (!allowedPorts.includes(port)) throw new SafeFetchError('blockedAddress');
  const host = hostnameOf(url);
  if (!host || BLOCKED_HOST_RE.test(host) || (!host.includes('.') && !isIP(host))) {
    throw new SafeFetchError('blockedAddress');
  }
  return url;
}

/** Nazwa hosta bez nawiasów IPv6 i końcowej kropki. */
function hostnameOf(url: URL): string {
  return url.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase();
}

async function defaultResolve(hostname: string): Promise<string[]> {
  const records = await dnsLookup(hostname, { all: true, verbatim: true });
  return records.map((r) => r.address);
}

/** Rozwiązuje host i zwraca pierwszy adres, jeśli WSZYSTKIE są publiczne. */
async function resolvePublicAddress(
  url: URL,
  resolve: (hostname: string) => Promise<string[]>,
  isBlocked: (address: string) => boolean,
): Promise<string> {
  const host = hostnameOf(url);
  let addresses: string[];
  if (isIP(host)) {
    addresses = [host];
  } else {
    try {
      addresses = await resolve(host);
    } catch {
      throw new SafeFetchError('network');
    }
  }
  if (addresses.length === 0 || addresses.some((a) => isBlocked(a))) {
    throw new SafeFetchError('blockedAddress');
  }
  return addresses[0]!;
}

/* ---------------------------------------------------------------------------
 * Pobieranie
 * ------------------------------------------------------------------------- */

interface RawResponse {
  status: number;
  location?: string;
  contentType: string;
  contentEncoding: string;
  body: Buffer;
}

function requestOnce(url: URL, address: string, signal: AbortSignal, maxBytes: number): Promise<RawResponse> {
  const family = isIP(address) === 6 ? 6 : 4;
  // Przypięcie połączenia do sprawdzonego adresu — bez ponownego zapytania DNS.
  const pinnedLookup: LookupFunction = (_hostname, options, callback) => {
    if (options && typeof options === 'object' && 'all' in options && options.all) {
      (callback as unknown as (err: null, addresses: { address: string; family: number }[]) => void)(
        null,
        [{ address, family }],
      );
      return;
    }
    callback(null, address, family);
  };
  const lib = url.protocol === 'https:' ? https : http;

  return new Promise<RawResponse>((resolve, reject) => {
    const req = lib.request(
      url,
      {
        method: 'GET',
        lookup: pinnedLookup,
        signal,
        headers: {
          'user-agent': 'PracujBeJobImport/1.0 (+https://pracuj.be)',
          accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,image/png,image/jpeg,image/webp;q=0.8',
          'accept-encoding': 'gzip, deflate, br',
        },
      },
      (res) => {
        const status = res.statusCode ?? 0;
        const header = (name: string): string => {
          const v = res.headers[name];
          return (Array.isArray(v) ? v[0] : v) ?? '';
        };
        if (status >= 300 && status < 400) {
          res.resume();
          resolve({ status, location: header('location'), contentType: '', contentEncoding: '', body: Buffer.alloc(0) });
          return;
        }
        const declared = Number(header('content-length'));
        if (Number.isFinite(declared) && declared > maxBytes) {
          res.destroy();
          reject(new SafeFetchError('tooLarge'));
          return;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        res.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > maxBytes) {
            res.destroy();
            reject(new SafeFetchError('tooLarge'));
            return;
          }
          chunks.push(chunk);
        });
        res.on('end', () =>
          resolve({
            status,
            contentType: header('content-type').toLowerCase(),
            contentEncoding: header('content-encoding').toLowerCase(),
            body: Buffer.concat(chunks),
          }),
        );
        res.on('error', (e) => reject(e));
      },
    );
    req.on('error', (e) => reject(e));
    req.end();
  });
}

/** Dekompresja z limitem rozmiaru wyniku (ochrona przed „bombą" gzip). */
function decode(body: Buffer, encoding: string, maxBytes: number): Buffer {
  const opts = { maxOutputLength: maxBytes };
  try {
    if (!encoding || encoding === 'identity') return body;
    if (encoding === 'gzip' || encoding === 'x-gzip') return zlib.gunzipSync(body, opts);
    if (encoding === 'deflate') return zlib.inflateSync(body, opts);
    if (encoding === 'br') return zlib.brotliDecompressSync(body, opts);
  } catch (e) {
    if (e instanceof RangeError || (e as { code?: string }).code === 'ERR_BUFFER_TOO_LARGE') {
      throw new SafeFetchError('tooLarge');
    }
    throw new SafeFetchError('network');
  }
  throw new SafeFetchError('unsupportedType');
}

function charsetOf(contentType: string): string {
  const m = /charset\s*=\s*"?([\w-]+)/i.exec(contentType);
  return m?.[1]?.toLowerCase() ?? 'utf-8';
}

function decodeText(bytes: Buffer, contentType: string): string {
  try {
    return new TextDecoder(charsetOf(contentType), { fatal: false }).decode(bytes);
  } catch {
    return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  }
}

const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);

/**
 * Pobiera publiczny adres ogłoszenia. Rzuca `SafeFetchError` z powodem odmowy/awarii.
 * Zwraca tekst strony (HTML → tekst, bez wykonywania skryptów) albo obraz.
 */
export async function safeFetchListing(rawUrl: string, deps: SafeFetchDeps = {}): Promise<SafeFetchResult> {
  const resolve = deps.resolve ?? defaultResolve;
  const isBlocked = deps.isBlocked ?? isBlockedAddress;
  const ports = deps.allowedPorts ?? DEFAULT_PORTS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), deps.timeoutMs ?? FETCH_TIMEOUT_MS);

  try {
    let url = parsePublicUrl(rawUrl, ports);
    for (let hop = 0; ; hop += 1) {
      const address = await resolvePublicAddress(url, resolve, isBlocked);
      let res: RawResponse;
      try {
        res = await requestOnce(url, address, controller.signal, MAX_IMAGE_BYTES);
      } catch (e) {
        if (e instanceof SafeFetchError) throw e;
        if (controller.signal.aborted) throw new SafeFetchError('timeout');
        throw new SafeFetchError('network');
      }

      if (res.status >= 300 && res.status < 400) {
        if (hop >= MAX_REDIRECTS) throw new SafeFetchError('tooManyRedirects');
        if (!res.location) throw new SafeFetchError('httpError');
        let next: URL;
        try {
          next = new URL(res.location, url);
        } catch {
          throw new SafeFetchError('invalidUrl');
        }
        // Cel przekierowania przechodzi te same kontrole co adres wklejony przez użytkownika.
        url = parsePublicUrl(next.toString(), ports);
        continue;
      }
      if (res.status < 200 || res.status >= 300) throw new SafeFetchError('httpError');

      const mime = res.contentType.split(';')[0]!.trim();
      if (IMAGE_TYPES.has(mime)) {
        const bytes = decode(res.body, res.contentEncoding, MAX_IMAGE_BYTES);
        return { kind: 'image', url: url.toString(), mediaType: mime as 'image/png', bytes };
      }
      if (mime === 'text/html' || mime === 'application/xhtml+xml' || mime === 'text/plain' || mime === '') {
        const bytes = decode(res.body, res.contentEncoding, MAX_HTML_BYTES);
        if (bytes.length > MAX_HTML_BYTES) throw new SafeFetchError('tooLarge');
        const raw = decodeText(bytes, res.contentType);
        const text = mime === 'text/plain' ? normalizeWhitespace(raw) : htmlToText(raw);
        return { kind: 'text', url: url.toString(), text: text.slice(0, MAX_PAGE_TEXT_CHARS) };
      }
      throw new SafeFetchError('unsupportedType');
    }
  } finally {
    clearTimeout(timer);
  }
}

/* ---------------------------------------------------------------------------
 * HTML → tekst (bez DOM, bez wykonywania czegokolwiek)
 * ------------------------------------------------------------------------- */

const ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', euro: '€', ndash: '–', mdash: '—',
  hellip: '…', laquo: '«', raquo: '»', bull: '•', middot: '·', copy: '©', reg: '®',
};

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : ' ';
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

function normalizeWhitespace(s: string): string {
  return s
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ')
    .replace(/[ \t ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Zamienia HTML na czytelny tekst. Treść `<script>`/`<style>`/`<noscript>`/`<template>`/
 * `<iframe>`/`<svg>` jest usuwana w całości — z wyjątkiem danych strukturalnych
 * `application/ld+json` (np. JobPosting), które zachowujemy jako surowe dane. Komentarze HTML
 * (częste miejsce ukrytych „instrukcji") również usuwamy.
 */
export function htmlToText(html: string): string {
  const jsonLd: string[] = [];
  const withoutLd = html.replace(
    /<script\b[^>]*type\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script\s*>/gi,
    (_m, body: string) => {
      jsonLd.push(body.trim().slice(0, 8000));
      return ' ';
    },
  );
  const titleMatch = /<title\b[^>]*>([\s\S]*?)<\/title\s*>/i.exec(withoutLd);
  let s = withoutLd
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|template|iframe|svg|object|embed|head)\b[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<(br|hr)\b[^>]*>/gi, '\n')
    .replace(/<li\b[^>]*>/gi, '\n• ')
    .replace(/<\/?(p|div|section|article|header|footer|li|ul|ol|h[1-6]|tr|table|dd|dt|dl|main|aside|nav|blockquote)\b[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');
  s = normalizeWhitespace(decodeEntities(s));
  const title = titleMatch ? normalizeWhitespace(decodeEntities(titleMatch[1]!.replace(/<[^>]+>/g, ' '))) : '';
  const parts = [title ? `TITLE: ${title}` : '', s, ...jsonLd.map((j) => `STRUCTURED DATA (JSON-LD): ${j}`)];
  return parts.filter(Boolean).join('\n\n');
}
