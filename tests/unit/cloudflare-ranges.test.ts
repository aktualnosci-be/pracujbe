// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  CLOUDFLARE_IPS_V4_URL,
  CLOUDFLARE_IPS_V6_URL,
  CLOUDFLARE_IP_RANGES,
  RANGES_TTL_MS,
  RETRY_AFTER_ERROR_MS,
  cloudflareIpRanges,
  parseCloudflareList,
  refreshCloudflareRanges,
  resetCloudflareRangesForTests,
} from '@/lib/http/cloudflare-ranges';
import { isCloudflareEdgeIp, trustedClientIp } from '@/lib/http/trusted-ip';

/**
 * #1090, decyzja właściciela 30.09.2026: zakresy Cloudflare pobierane automatycznie
 * (ips-v4/ips-v6), cache w procesie z TTL 24 h i single-flight, odświeżanie w tle bez
 * opóźniania żądania; błąd = ostatnia dobra lista, bez niej zapas z kodu. Sieć = atrapa fetch.
 */

const V4 = ['173.245.48.0/20', '103.21.244.0/22', '103.22.200.0/22', '103.31.4.0/22', '141.101.64.0/18', '198.18.0.0/15'];
const V6 = ['2400:cb00::/32', '2606:4700::/32', '2803:f800::/32', '2001:db8:ff00::/40'];

type Reply = { status?: number; body: string } | Error;

function fakeFetch(replies: Record<string, Reply>) {
  return vi.fn(async (url: string, init?: RequestInit) => {
    expect(init?.redirect).toBe('error');
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    const reply = replies[url];
    if (!reply) throw new Error(`nieoczekiwany adres ${url}`);
    if (reply instanceof Error) throw reply;
    return new Response(reply.body, { status: reply.status ?? 200 });
  });
}

const good = () => fakeFetch({
  [CLOUDFLARE_IPS_V4_URL]: { body: `${V4.join('\n')}\n` },
  [CLOUDFLARE_IPS_V6_URL]: { body: V6.join('\r\n') },
});

beforeEach(() => resetCloudflareRangesForTests());
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  resetCloudflareRangesForTests();
});

describe('parseCloudflareList', () => {
  it('przyjmuje poprawną listę właściwej rodziny', () => {
    expect(parseCloudflareList(V4.join('\n'), 4)).toEqual(V4);
    expect(parseCloudflareList(V6.join('\n'), 6)).toEqual(V6);
  });

  it.each([
    ['pusta', '', 4],
    ['podejrzanie krótka', '173.245.48.0/20\n103.21.244.0/22', 4],
    ['zły CIDR (prefiks)', [...V4.slice(0, 5), '104.16.0.0/33'].join('\n'), 4],
    ['zły CIDR (tekst)', [...V4.slice(0, 5), '<html>'].join('\n'), 4],
    ['adres bez prefiksu', [...V4.slice(0, 5), '104.16.0.1'].join('\n'), 4],
    ['zła rodzina', V6.join('\n'), 4],
    ['strona HTML', '<!doctype html><title>Error</title>', 6],
  ] as const)('kontrola ujemna: %s → odrzucona', (_name, body, family) => {
    expect(parseCloudflareList(body, family)).toBeNull();
  });
});

describe('refreshCloudflareRanges', () => {
  it('pobrana lista zastępuje zapas: nowy zakres uznany, zakres spoza listy już nie', async () => {
    // Pierwszy odczyt (zapas) sam uruchamia pobranie w tle — tu z atrapy nieosiągalnej sieci.
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('bez sieci'); }));
    expect(isCloudflareEdgeIp('198.18.0.1')).toBe(false);
    await vi.waitFor(async () => expect(await refreshCloudflareRanges(good())).toBe(true));
    expect(cloudflareIpRanges()).toEqual([...V4, ...V6]);
    expect(isCloudflareEdgeIp('198.18.0.1')).toBe(true);
    expect(isCloudflareEdgeIp('2001:db8:ff00::1')).toBe(true);
    expect(isCloudflareEdgeIp('104.16.0.1')).toBe(false);
  });

  it('single-flight: równoległe odświeżenia = jedno pobranie każdej listy', async () => {
    const f = good();
    await Promise.all([refreshCloudflareRanges(f), refreshCloudflareRanges(f), refreshCloudflareRanges(f)]);
    expect(f).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['błąd sieci', new Error('ECONNRESET')],
    ['odpowiedź 503', { status: 503, body: 'down' }],
    ['zły CIDR', { body: [...V6.slice(0, 3), 'nie-cidr'].join('\n') }],
  ] as const)('kontrola ujemna: %s bez wcześniejszej listy → zapas z kodu', async (_n, v6) => {
    const f = fakeFetch({ [CLOUDFLARE_IPS_V4_URL]: { body: V4.join('\n') }, [CLOUDFLARE_IPS_V6_URL]: v6 as Reply });
    expect(await refreshCloudflareRanges(f)).toBe(false);
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('bez sieci'); }));
    expect(cloudflareIpRanges()).toBe(CLOUDFLARE_IP_RANGES);
  });

  it('kontrola ujemna: błąd po udanym pobraniu → zostaje ostatnia dobra lista', async () => {
    await refreshCloudflareRanges(good());
    const broken = fakeFetch({ [CLOUDFLARE_IPS_V4_URL]: new Error('timeout'), [CLOUDFLARE_IPS_V6_URL]: { body: V6.join('\n') } });
    expect(await refreshCloudflareRanges(broken)).toBe(false);
    expect(cloudflareIpRanges()).toEqual([...V4, ...V6]);
  });
});

describe('cloudflareIpRanges — odświeżanie w tle', () => {
  it('pierwszy odczyt zwraca od razu zapas i uruchamia pobranie; kolejny widzi nową listę', async () => {
    const f = good();
    vi.stubGlobal('fetch', f);
    expect(cloudflareIpRanges()).toBe(CLOUDFLARE_IP_RANGES);
    await vi.waitFor(() => expect(cloudflareIpRanges()).toEqual([...V4, ...V6]));
    expect(f).toHaveBeenCalledTimes(2);
  });

  it('świeża lista (w TTL) nie wywołuje sieci; po TTL — jedno odświeżenie w tle', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-30T10:00:00Z'));
    await refreshCloudflareRanges(good());
    const f = good();
    vi.stubGlobal('fetch', f);
    cloudflareIpRanges();
    expect(f).not.toHaveBeenCalled();
    vi.setSystemTime(Date.now() + RANGES_TTL_MS);
    cloudflareIpRanges();
    cloudflareIpRanges();
    await vi.waitFor(() => expect(f).toHaveBeenCalledTimes(2));
  });

  it('po błędzie pobrania kolejna próba dopiero po przerwie (bez zasypywania przy każdym żądaniu)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-30T10:00:00Z'));
    const failing = vi.fn(async () => { throw new Error('bez sieci'); });
    vi.stubGlobal('fetch', failing);
    cloudflareIpRanges();
    await vi.waitFor(() => expect(failing).toHaveBeenCalled());
    await Promise.resolve();
    const calls = failing.mock.calls.length;
    await new Promise((r) => setImmediate(r));
    cloudflareIpRanges();
    cloudflareIpRanges();
    expect(failing).toHaveBeenCalledTimes(calls);
    vi.setSystemTime(Date.now() + RETRY_AFTER_ERROR_MS);
    cloudflareIpRanges();
    await vi.waitFor(() => expect(failing.mock.calls.length).toBeGreaterThan(calls));
  });

  it('trustedClientIp nie czeka na pobranie (wynik synchroniczny z zapasu)', () => {
    vi.stubEnv('TRUSTED_PROXY_HEADER', 'cf-connecting-ip');
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})));
    const h = new Headers({ 'x-real-ip': '104.16.0.1', 'cf-connecting-ip': '203.0.113.7' });
    expect(trustedClientIp(h)).toBe('203.0.113.7');
  });
});
