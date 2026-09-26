/**
 * Blokada wychodzących połączeń sieciowych w testach Vitest (#47, „blokada HTTP w testach”).
 *
 * Instalowana globalnie w `tests/setup.ts` (setupFiles obu projektów: `unit` i `chromium`).
 * Test, który próbuje połączyć się z hostem spoza allow-listy, dostaje czytelny
 * `NetworkBlockedError` zamiast cichego żądania do internetu (albo timeoutu w CI).
 *
 * Dwie warstwy:
 * 1. `net.Socket.prototype.connect` — jedyny wspólny punkt TCP w Node: `http`/`https`,
 *    `tls.connect`, `undici` (także wbudowany `fetch`), `pg`, SDK dostawców. Gniazda Unix/IPC
 *    (`path`) przepuszczamy. Gdy połączenie ma własny `lookup` (atrapa DNS, np. `jobs.test` →
 *    127.0.0.1 w teście safe-fetch), rozstrzyga adres po rozwiązaniu: tylko loopback.
 * 2. `globalThis.fetch` — ten sam błąd już przed otwarciem gniazda (bez opakowania „fetch
 *    failed”), żeby komunikat był od razu widoczny w teście.
 *
 * Allow-lista: localhost / 127.0.0.0/8 / ::1 (atrapy HTTP, serwery testowe, PostgreSQL, Chromium
 * przez CDP) + hosty z `TEST_NETWORK_ALLOW` (przecinki). Chromium uruchamiany przez Playwright to
 * osobny proces — blokada go nie obejmuje (strony renderuje z `setContent`/lokalnych plików).
 */
import net from 'node:net';

export class NetworkBlockedError extends Error {
  readonly code = 'TEST_NETWORK_BLOCKED';
  constructor(readonly host: string, readonly via: string) {
    super(
      `[network-guard] Test próbował połączyć się z „${host}” (${via}). ` +
        'Testy jednostkowe nie mogą wychodzić do sieci — użyj atrapy (vi.stubGlobal("fetch", …), ' +
        'serwer na 127.0.0.1) albo dodaj host do TEST_NETWORK_ALLOW dla świadomego testu na żywo.',
    );
    this.name = 'NetworkBlockedError';
  }
}

const LOOPBACK_NAMES = new Set(['localhost', '::1', '0:0:0:0:0:0:0:1', '::ffff:127.0.0.1']);

function normalizeHost(host: string): string {
  let h = host.trim().toLowerCase();
  if (h.startsWith('[') && h.endsWith(']')) h = h.slice(1, -1);
  if (h.endsWith('.')) h = h.slice(0, -1);
  return h;
}

/** Hosty dopuszczone jawnie przez `TEST_NETWORK_ALLOW` (np. `ec.europa.eu` dla VIES live smoke). */
export function extraAllowedHosts(env: NodeJS.ProcessEnv = process.env): string[] {
  return (env.TEST_NETWORK_ALLOW ?? '')
    .split(',')
    .map(normalizeHost)
    .filter(Boolean);
}

export function isAllowedHost(host: string, extra: readonly string[] = extraAllowedHosts()): boolean {
  const h = normalizeHost(host);
  if (LOOPBACK_NAMES.has(h) || h.endsWith('.localhost')) return true;
  if (net.isIPv4(h) && h.startsWith('127.')) return true;
  return extra.includes(h);
}

type ConnectFn = (...args: unknown[]) => net.Socket;

let originalConnect: ConnectFn | null = null;
let originalFetch: typeof globalThis.fetch | null = null;
let guardedFetch: typeof globalThis.fetch | null = null;

/**
 * Host docelowy z argumentów `Socket#connect`. `null` = gniazdo Unix/IPC (dozwolone).
 * `net.connect()` przekazuje znormalizowaną tablicę `[options, cb]`.
 */
export function connectTarget(args: unknown[]): string | null {
  let first = args[0];
  if (Array.isArray(first)) first = first[0];
  if (first && typeof first === 'object') {
    const o = first as { path?: unknown; host?: unknown; hostname?: unknown };
    if (typeof o.path === 'string' && o.path) return null;
    const host = typeof o.host === 'string' && o.host ? o.host : o.hostname;
    return typeof host === 'string' && host ? host : 'localhost';
  }
  if (typeof first === 'string' && !/^\d+$/.test(first)) return null; // ścieżka gniazda
  const second = args[1];
  return typeof second === 'string' && second ? second : 'localhost';
}

function fetchTarget(input: unknown): string | null {
  try {
    const raw =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : input && typeof input === 'object' && 'url' in input
            ? String((input as { url: unknown }).url)
            : null;
    if (!raw) return null;
    const url = new URL(raw);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null; // data:, blob:
    return url.hostname;
  } catch {
    return null; // względny URL itp. — rozstrzygnie warstwa gniazda
  }
}

type LookupCallback = (err: Error | null, address?: unknown, family?: number) => void;
type LookupFn = (hostname: string, options: unknown, callback: LookupCallback) => void;

function connectOptions(args: unknown[]): { lookup?: unknown } | null {
  let first = args[0];
  if (Array.isArray(first)) first = first[0];
  return first && typeof first === 'object' ? (first as { lookup?: unknown }) : null;
}

function guardLookup(host: string, lookup: LookupFn): LookupFn {
  return (hostname, options, callback) => {
    lookup(hostname, options, (err, address, family) => {
      if (err) return callback(err, address, family);
      const list = Array.isArray(address)
        ? (address as { address: string }[]).map((a) => a.address)
        : [String(address)];
      const outside = list.find((a) => !isAllowedHost(a, []));
      if (outside !== undefined || list.length === 0) {
        return callback(new NetworkBlockedError(`${host} → ${outside ?? '?'}`, 'net.Socket#connect (lookup)'));
      }
      callback(null, address, family);
    });
  };
}

export function installNetworkGuard(): void {
  if (originalConnect) return;
  const proto = net.Socket.prototype as unknown as { connect: ConnectFn };
  const connect = proto.connect;
  originalConnect = connect;
  proto.connect = function guardedConnect(this: net.Socket, ...args: unknown[]) {
    const host = connectTarget(args);
    if (host !== null && !isAllowedHost(host)) {
      const opts = connectOptions(args);
      // Własny `lookup` (np. przypięty DNS w safe-fetch) — rozstrzyga adres, z którym faktycznie
      // łączy się gniazdo: dopuszczamy tylko loopback.
      if (!opts || typeof opts.lookup !== 'function') {
        throw new NetworkBlockedError(host, 'net.Socket#connect');
      }
      opts.lookup = guardLookup(host, opts.lookup as LookupFn);
    }
    return connect.apply(this, args);
  };

  if (typeof globalThis.fetch === 'function') {
    const realFetch = globalThis.fetch;
    originalFetch = realFetch;
    guardedFetch = function fetch(input: Parameters<typeof globalThis.fetch>[0], init?: RequestInit) {
      const host = fetchTarget(input);
      if (host !== null && !isAllowedHost(host)) {
        return Promise.reject(new NetworkBlockedError(host, 'fetch'));
      }
      return realFetch(input, init);
    } as typeof globalThis.fetch;
    globalThis.fetch = guardedFetch;
  }
}

/** Zdejmuje blokadę — tylko dla kontroli ujemnej w teście strażnika. */
export function uninstallNetworkGuard(): void {
  if (originalConnect) {
    (net.Socket.prototype as unknown as { connect: ConnectFn }).connect = originalConnect;
    originalConnect = null;
  }
  if (originalFetch) {
    if (globalThis.fetch === guardedFetch) globalThis.fetch = originalFetch;
    originalFetch = null;
    guardedFetch = null;
  }
}

export function isNetworkGuardInstalled(): boolean {
  return originalConnect !== null;
}
