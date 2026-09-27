/**
 * Strażnik blokady sieci w testach (#47): globalny setup (`tests/setup.ts`) blokuje połączenia
 * poza localhost i allow-listą. Kontrola ujemna: po zdjęciu blokady to samo połączenie nie
 * kończy się `NetworkBlockedError` — czyli to strażnik, a nie środowisko, zatrzymuje żądanie.
 */
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import {
  NetworkBlockedError,
  connectTarget,
  installNetworkGuard,
  isAllowedHost,
  isNetworkGuardInstalled,
  uninstallNetworkGuard,
} from '../helpers/network-guard';

// TEST-NET-1 (RFC 5737) — nie jest routowany, więc kontrola ujemna nie wysyła nic w internet.
const TEST_NET = '192.0.2.1';

afterEach(() => {
  installNetworkGuard();
});

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
      await new Promise((r) => server.close(r));
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
      await new Promise((r) => server.close(r));
    }
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
