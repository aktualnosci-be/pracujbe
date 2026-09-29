/**
 * Strażnik blokady sieci w testach (#47): globalny setup (`tests/setup.ts`) blokuje połączenia
 * poza localhost i allow-listą. Kontrola ujemna: po zdjęciu blokady to samo połączenie nie
 * kończy się `NetworkBlockedError` — czyli to strażnik, a nie środowisko, zatrzymuje żądanie.
 */
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';
import dns from 'node:dns';
import { posix, win32 } from 'node:path';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import {
  NetworkBlockedError,
  DNS_NETWORK_METHODS,
  connectTarget,
  installNetworkGuard,
  integrationAllowedHost,
  isAllowedHost,
  isNetworkGuardInstalled,
  testFileLabel,
  uninstallNetworkGuard,
} from '../helpers/network-guard';

// TEST-NET-1 (RFC 5737) — nie jest routowany, więc kontrola ujemna nie wysyła nic w internet.
const TEST_NET = '192.0.2.1';

afterEach(() => {
  installNetworkGuard();
});

/**
 * Zamknięcie atrapy bez czekania na gniazda keep-alive. `fetch` (undici) trzyma połączenie
 * otwarte po odpowiedzi, a samo `server.close()` czeka, aż klient je porzuci — pod obciążeniem
 * maszyny to potrafiło trwać sekundy. Zrywamy połączenia jawnie; asercje są już po odpowiedzi.
 */
async function closeServer(server: http.Server): Promise<void> {
  const closed = new Promise((r) => server.close(r));
  server.closeAllConnections();
  await closed;
}

describe('#47 blokada sieci w testach Vitest', () => {
  it('jest zainstalowana globalnie przez setupFiles', () => {
    expect(isNetworkGuardInstalled()).toBe(true);
  });

  it('fetch do internetu → czytelny NetworkBlockedError', async () => {
    await expect(fetch('https://example.com/api')).rejects.toBeInstanceOf(NetworkBlockedError);
    await expect(fetch(new URL('http://example.org/'))).rejects.toThrow(/example\.org.*TEST_NETWORK_ALLOW/s);
    await expect(fetch(new Request('https://api.openai.com/v1/responses'))).rejects.toThrow(
      NetworkBlockedError,
    );
  });

  it('http/https/tls/net do hosta zewnętrznego są blokowane na poziomie gniazda', () => {
    expect(() => https.get('https://example.com/')).toThrow(NetworkBlockedError);
    expect(() => http.get({ host: 'example.com', port: 80, path: '/' })).toThrow(NetworkBlockedError);
    expect(() => tls.connect({ host: 'example.com', port: 443 })).toThrow(NetworkBlockedError);
    expect(() => net.connect(443, TEST_NET)).toThrow(NetworkBlockedError);
    expect(() => new net.Socket().connect({ host: TEST_NET, port: 80 })).toThrow(/192\.0\.2\.1/);
  });

  it('localhost / 127.0.0.1 są dozwolone (atrapy HTTP, PostgreSQL)', async () => {
    const server = http.createServer((_req, res) => res.end('ok'));
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const { port } = server.address() as AddressInfo;
    try {
      expect(await (await fetch(`http://127.0.0.1:${port}/`)).text()).toBe('ok');
      expect(await (await fetch(`http://localhost:${port}/`)).text()).toBe('ok');
      const body = await new Promise<string>((resolve, reject) => {
        http
          .get({ host: '127.0.0.1', port, path: '/' }, (res) => {
            let data = '';
            res.on('data', (c) => (data += c));
            res.on('end', () => resolve(data));
          })
          .on('error', reject);
      });
      expect(body).toBe('ok');
    } finally {
      await closeServer(server);
    }
  });

  it('własny lookup (atrapa DNS): loopback przechodzi, adres publiczny → NetworkBlockedError', async () => {
    const server = http.createServer((_req, res) => res.end('pinned'));
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const { port } = server.address() as AddressInfo;
    const pinned =
      (address: string) =>
      (_h: string, opts: unknown, cb: (e: Error | null, a?: unknown, f?: number) => void) =>
        opts && typeof opts === 'object' && 'all' in opts && (opts as { all?: boolean }).all
          ? cb(null, [{ address, family: 4 }])
          : cb(null, address, 4);
    const get = (address: string) =>
      new Promise<string>((resolve, reject) => {
        http
          .get({ host: 'jobs.test', port, path: '/', agent: false, lookup: pinned(address) as never }, (res) => {
            let data = '';
            res.on('data', (c) => (data += c));
            res.on('end', () => resolve(data));
          })
          .on('error', reject);
      });
    try {
      expect(await get('127.0.0.1')).toBe('pinned');
      await expect(get(TEST_NET)).rejects.toBeInstanceOf(NetworkBlockedError);
    } finally {
      await closeServer(server);
    }
  });

  it('#772 literalny adres IP z własnym lookup też jest blokowany (Node nie woła lookup dla IP)', () => {
    let lookupCalls = 0;
    const lookup = (_h: string, _o: unknown, cb: (e: Error | null, a?: unknown, f?: number) => void) => {
      lookupCalls += 1;
      cb(null, '127.0.0.1', 4);
    };
    expect(() => net.connect({ host: TEST_NET, port: 9, lookup } as never)).toThrow(NetworkBlockedError);
    expect(() => net.connect({ host: '2001:db8::1', port: 9, lookup } as never)).toThrow(NetworkBlockedError);
    expect(() => net.connect({ host: '[2001:db8::1]', port: 9, lookup } as never)).toThrow(NetworkBlockedError);
    expect(() => http.get({ host: TEST_NET, port: 80, path: '/', lookup } as never)).toThrow(/192\.0\.2\.1/);
    expect(lookupCalls).toBe(0);
  });

  it('#772 literalne adresy loopback z własnym lookup nadal przechodzą', async () => {
    const server = http.createServer((_req, res) => res.end('loop'));
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const { port } = server.address() as AddressInfo;
    try {
      const body = await new Promise<string>((resolve, reject) => {
        http
          .get(
            {
              host: '127.0.0.1',
              port,
              path: '/',
              agent: false,
              lookup: ((_h: string, _o: unknown, cb: (e: Error | null, a?: unknown, f?: number) => void) =>
                cb(null, '127.0.0.1', 4)) as never,
            },
            (res) => {
              let data = '';
              res.on('data', (c) => (data += c));
              res.on('end', () => resolve(data));
            },
          )
          .on('error', reject);
      });
      expect(body).toBe('loop');
    } finally {
      await closeServer(server);
    }
  });

  it('#772 kontrola ujemna: bez strażnika literalny IP z własnym lookup nie jest zatrzymany', () => {
    uninstallNetworkGuard();
    let socket: net.Socket | undefined;
    const lookup = (_h: string, _o: unknown, cb: (e: Error | null, a?: unknown, f?: number) => void) =>
      cb(null, '127.0.0.1', 4);
    expect(() => {
      socket = net.connect({ host: TEST_NET, port: 9, lookup } as never);
    }).not.toThrow();
    socket?.on('error', () => {});
    socket?.destroy();
  });

  it('#812 zapytania node:dns (resolve*/reverse, promises, Resolver) do nazw spoza allow-listy → NetworkBlockedError', async () => {
    // Zapytanie nigdy nie wychodzi: strażnik odrzuca je przed wywołaniem c-ares.
    type AnyFn = (...a: unknown[]) => unknown;
    const method = (owner: object, name: string): AnyFn => (owner as Record<string, AnyFn>)[name]!;
    const resolver = new dns.Resolver();
    const promiseResolver = new dns.promises.Resolver();
    for (const name of DNS_NETWORK_METHODS) {
      const arg = name === 'reverse' ? TEST_NET : 'example.com';
      expect(() => method(dns, name)(arg, () => {}), `dns.${name}`).toThrow(NetworkBlockedError);
      expect(() => method(resolver, name)(arg, () => {}), `Resolver#${name}`).toThrow(NetworkBlockedError);
      await expect(method(dns.promises, name)(arg), `dns.promises.${name}`).rejects.toBeInstanceOf(
        NetworkBlockedError,
      );
      await expect(method(promiseResolver, name)(arg), `promises.Resolver#${name}`).rejects.toThrow(
        /example\.com|192\.0\.2\.1/,
      );
    }
    await expect(dns.promises.resolve4('example.com')).rejects.toThrow(/dns\.resolve4/);
    await expect(dns.promises.resolveMx('example.com')).rejects.toThrow(/TEST_NETWORK_ALLOW/);
  });

  it('#812 kontrola ujemna: bez strażnika Resolver przepuszcza zapytanie (na martwy serwer na loopbacku)', async () => {
    uninstallNetworkGuard();
    // Serwer DNS = zamknięty port na 127.0.0.1, więc nic nie wychodzi poza maszynę.
    const resolver = new dns.promises.Resolver({ timeout: 200, tries: 1 });
    resolver.setServers(['127.0.0.1:9']);
    const err = await resolver.resolve4('example.com').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(NetworkBlockedError);
    installNetworkGuard();
    const guarded = new dns.promises.Resolver({ timeout: 200, tries: 1 });
    guarded.setServers(['127.0.0.1:9']);
    await expect(guarded.resolve4('example.com')).rejects.toBeInstanceOf(NetworkBlockedError);
  });

  it('#812 nazwy z allow-listy (localhost) przechodzą do resolvera, a uninstall przywraca oryginalne funkcje', async () => {
    const originalResolve4 = dns.resolve4;
    const originalProtoResolve4 = dns.Resolver.prototype.resolve4;
    const resolver = new dns.promises.Resolver({ timeout: 200, tries: 1 });
    resolver.setServers(['127.0.0.1:9']); // martwy serwer na loopbacku — bez ruchu na zewnątrz
    const err = await resolver.resolve4('localhost').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(NetworkBlockedError);
    uninstallNetworkGuard();
    expect(dns.resolve4).not.toBe(originalResolve4);
    expect(dns.Resolver.prototype.resolve4).not.toBe(originalProtoResolve4);
    installNetworkGuard();
    // Ponowna instalacja nie owija dwa razy (idempotencja): po uninstall/install stan jest taki sam.
    expect(() => dns.resolve4('example.com', () => {})).toThrow(NetworkBlockedError);
  });

  it('allow-lista: loopback, TEST_NETWORK_ALLOW, gniazda Unix', () => {
    for (const h of ['localhost', '127.0.0.1', '127.1.2.3', '::1', '[::1]', 'app.localhost']) {
      expect(isAllowedHost(h, [])).toBe(true);
    }
    for (const h of ['example.com', '10.0.0.1', '192.168.1.10', 'localhost.evil.com', '128.0.0.1']) {
      expect(isAllowedHost(h, [])).toBe(false);
    }
    expect(isAllowedHost('ec.europa.eu', ['ec.europa.eu'])).toBe(true);
    expect(isAllowedHost('EC.europa.eu.', ['ec.europa.eu'])).toBe(true);
    expect(connectTarget([{ path: '/tmp/.s.PGSQL.5432' }])).toBeNull();
    expect(connectTarget([[{ host: 'example.com', port: 443 }, null]])).toBe('example.com');
    expect(connectTarget([5432])).toBe('localhost');
  });

  it('błąd wskazuje plik i nazwę testu, który próbował wyjść do sieci', async () => {
    const err = await fetch('https://example.com/').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(NetworkBlockedError);
    const blocked = err as NetworkBlockedError;
    expect(blocked.test).toBe(
      'tests/unit/network-guard.test.ts › #47 blokada sieci w testach Vitest > błąd wskazuje plik i nazwę testu, który próbował wyjść do sieci',
    );
    expect(blocked.message).toContain('network-guard.test.ts');
    expect(blocked.message).toContain('example.com');
    let socketErr: unknown;
    try {
      net.connect(443, TEST_NET);
    } catch (e) {
      socketErr = e;
    }
    expect((socketErr as NetworkBlockedError).message).toMatch(/błąd wskazuje plik.*192\.0\.2\.1/s);
    // Poza kontekstem testu (brak stanu expect) komunikat nadal jest poprawny, bez etykiety.
    expect(new NetworkBlockedError('example.com', 'fetch', null).message).toMatch(/^\[network-guard\] Test próbował/);
  });

  it('#885 etykieta pliku testu używa / także dla ścieżek Windows (bez runnera Windows)', () => {
    const wanted = 'tests/unit/network-guard.test.ts';
    expect(testFileLabel('C:\\repo\\tests\\unit\\network-guard.test.ts', 'C:\\repo', win32)).toBe(wanted);
    expect(testFileLabel('C:/repo/tests/unit/network-guard.test.ts', 'C:/repo', win32)).toBe(wanted);
    expect(testFileLabel('/repo/tests/unit/network-guard.test.ts', '/repo', posix)).toBe(wanted);
    // Kontrola ujemna: surowe path.win32.relative daje backslashe — to je błąd z #885.
    expect(win32.relative('C:/repo', 'C:/repo/tests/unit/network-guard.test.ts')).not.toBe(wanted);
  });

  it('integracja: host z INTEGRATION_PG_ADMIN_URL trafia na allow-listę, reszta nie', () => {
    expect(integrationAllowedHost('postgresql://postgres@127.0.0.1:55432/postgres')).toBe('127.0.0.1');
    expect(integrationAllowedHost('postgresql://u:p@DB.Internal.:5432/x')).toBe('db.internal');
    expect(integrationAllowedHost(undefined)).toBeNull();
    expect(integrationAllowedHost('nie-url')).toBeNull();
    expect(isAllowedHost('db.internal', ['db.internal'])).toBe(true);
    expect(isAllowedHost('example.com', ['db.internal'])).toBe(false);
  });

  it('kontrola ujemna: bez strażnika to samo połączenie nie kończy się NetworkBlockedError', () => {
    uninstallNetworkGuard();
    expect(isNetworkGuardInstalled()).toBe(false);
    let socket: net.Socket | undefined;
    expect(() => {
      socket = net.connect({ host: TEST_NET, port: 9 });
    }).not.toThrow();
    socket?.on('error', () => {});
    socket?.destroy();
    installNetworkGuard();
    expect(() => net.connect({ host: TEST_NET, port: 9 })).toThrow(NetworkBlockedError);
  });
});
