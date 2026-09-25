// @vitest-environment node
import { mkdir, mkdtemp, readdir, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  createIsrCacheHandler,
  deserializeEntry,
  isNegativeValue,
  serializeEntry,
} from '@/lib/cache/isr-cache-handler.mjs';

/**
 * #298 („Otwarte”): własny cacheHandler ISR. Domyślny handler Next zapisywał na dysk każdy
 * wynik ISR, także 404 losowych slugów ofert — bez limitu. Tu: LRU w pamięci, osobna pula 404
 * z krótkim TTL (nigdy dysk), limit wpisów/bajtów dysku, odczyt stron z buildu.
 */

let root: string;
let serverDistDir: string;
let diskDir: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'isr-cache-'));
  serverDistDir = join(root, 'server');
  diskDir = join(root, 'cache', 'isr-handler');
  await mkdir(join(serverDistDir, 'app'), { recursive: true });
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

type Limits = Partial<{
  memoryMaxBytes: number;
  memoryMaxEntries: number;
  negativeMaxEntries: number;
  negativeTtlMs: number;
  diskMaxBytes: number;
  diskMaxEntries: number;
  entryMaxBytes: number;
}>;

function setup(limits: Limits = {}, clock = { t: 1_000_000 }) {
  const Handler = createIsrCacheHandler({ limits, now: () => clock.t });
  const handler = () => new Handler({ serverDistDir, flushToDisk: true });
  return { Handler, handler, clock };
}

function page(html: string, status = 200, tags?: string) {
  return {
    kind: 'APP_PAGE',
    html,
    rscData: Buffer.from(`rsc:${html}`),
    headers: tags ? { 'x-next-cache-tags': tags } : {},
    status,
    postponed: undefined,
    segmentData: new Map([['/_tree', Buffer.from('tree')]]),
  };
}

const APP_PAGE = { kind: 'APP_PAGE', isRoutePPREnabled: false, isFallback: false };

async function diskFiles() {
  try {
    return (await readdir(diskDir)).filter((name) => name.endsWith('.json'));
  } catch {
    return [];
  }
}

describe('isr-cache-handler', () => {
  it('zapis i odczyt strony: pamięć, a po restarcie dysk (Buffer i Map zachowane)', async () => {
    const { Handler, handler } = setup();
    await handler().set('/pl/oferty-pracy/magazynier', page('<p>ok</p>'), { cacheControl: { revalidate: 60 } });
    const hit = await handler().get('/pl/oferty-pracy/magazynier', APP_PAGE);
    expect(hit?.value.html).toBe('<p>ok</p>');
    expect(await diskFiles()).toHaveLength(1);
    await Handler.disk.stats();

    // Nowy proces: pusta pamięć, indeks odbudowany z katalogu.
    const Restarted = createIsrCacheHandler({});
    const fromDisk = await new Restarted({ serverDistDir }).get('/pl/oferty-pracy/magazynier', APP_PAGE);
    expect(fromDisk?.value.html).toBe('<p>ok</p>');
    expect(Buffer.isBuffer(fromDisk?.value.rscData)).toBe(true);
    expect(fromDisk?.value.rscData.toString()).toBe('rsc:<p>ok</p>');
    expect(fromDisk?.value.segmentData.get('/_tree').toString()).toBe('tree');
  });

  it('404 losowego sluga: tylko w pamięci, krótki TTL, nigdy na dysku', async () => {
    const { Handler, handler, clock } = setup({ negativeTtlMs: 60_000 });
    await handler().set('/pl/oferty-pracy/nie-ma', page('404', 404), {});
    expect((await handler().get('/pl/oferty-pracy/nie-ma', APP_PAGE))?.value.status).toBe(404);
    await Handler.disk.stats();
    expect(await diskFiles()).toHaveLength(0);
    clock.t += 60_001;
    expect(await handler().get('/pl/oferty-pracy/nie-ma', APP_PAGE)).toBeNull();
  });

  it('oferta, która stała się 404, znika też z dysku (nie wraca po TTL)', async () => {
    const { Handler, handler, clock } = setup({ negativeTtlMs: 1000 });
    await handler().set('/pl/oferty-pracy/zamknieta', page('ok'), {});
    await handler().set('/pl/oferty-pracy/zamknieta', page('404', 404), {});
    await Handler.disk.stats();
    expect(await diskFiles()).toHaveLength(0);
    clock.t += 1001;
    expect(await handler().get('/pl/oferty-pracy/zamknieta', APP_PAGE)).toBeNull();
  });

  it('seria losowych slugów nie rośnie ponad limit puli 404 i nie wypycha poprawnych stron', async () => {
    const { Handler, handler } = setup({ negativeMaxEntries: 20, memoryMaxEntries: 50 });
    await handler().set('/pl', page('home'), {});
    for (let i = 0; i < 500; i++) {
      await handler().set(`/pl/oferty-pracy/losowy-${i}`, page('404', 404), {});
    }
    expect(Handler.negative.map.size).toBe(20);
    expect(Handler.memory.map.size).toBe(1);
    expect((await handler().get('/pl', APP_PAGE))?.value.html).toBe('home');
    const stats = await Handler.disk.stats();
    expect(stats.entries).toBe(1);
    expect(await diskFiles()).toHaveLength(1);
  });

  it('kontrola ujemna: bez rozróżnienia 404 (status 200) ta sama seria trafia na dysk do limitu', async () => {
    const { Handler, handler } = setup({ diskMaxEntries: 25 });
    for (let i = 0; i < 100; i++) {
      await handler().set(`/pl/oferty-pracy/losowy-${i}`, page('x'), {});
    }
    const stats = await Handler.disk.stats();
    // Detektor działa: poprawne strony trafiają na dysk, a limit wpisów i tak obowiązuje.
    expect(stats.entries).toBe(25);
    expect(await diskFiles()).toHaveLength(25);
    expect(await handler().get('/pl/oferty-pracy/losowy-99', APP_PAGE)).not.toBeNull();
  });

  it('limit bajtów dysku usuwa najstarsze wpisy; za duży wpis nie trafia na dysk', async () => {
    const { Handler, handler } = setup({ diskMaxBytes: 3000, entryMaxBytes: 2000 });
    for (let i = 0; i < 10; i++) {
      await handler().set(`/k/${i}`, page('a'.repeat(400)), {});
    }
    let stats = await Handler.disk.stats();
    expect(stats.bytes).toBeLessThanOrEqual(3000);
    expect(stats.entries).toBeLessThan(10);
    await handler().set('/duzy', page('b'.repeat(5000)), {});
    stats = await Handler.disk.stats();
    expect(await Handler.disk.read('/duzy')).toBeNull();
    expect(await Handler.disk.read('/k/9')).not.toBeNull();
    expect(await Handler.disk.read('/k/0')).toBeNull();
  });

  it('LRU w pamięci: limit wpisów i bajtów, ostatnio czytane zostają', async () => {
    const { Handler, handler } = setup({ memoryMaxEntries: 3 });
    const h = handler();
    await h.set('/a', page('a'), {});
    await h.set('/b', page('b'), {});
    await h.set('/c', page('c'), {});
    await h.get('/a', APP_PAGE);
    await h.set('/d', page('d'), {});
    expect([...Handler.memory.map.keys()]).toEqual(['/c', '/a', '/d']);

    const Small = createIsrCacheHandler({ limits: { memoryMaxBytes: 1000 } });
    const s = new Small({ serverDistDir, flushToDisk: false });
    await s.set('/x', page('x'.repeat(300)), {});
    await s.set('/y', page('y'.repeat(300)), {});
    expect([...Small.memory.map.keys()]).toEqual(['/y']);
    expect(Small.memory.bytes).toBeLessThanOrEqual(1000);
  });

  it('flushToDisk=false (lub build) — tylko pamięć', async () => {
    const Handler = createIsrCacheHandler({});
    await new Handler({ serverDistDir, flushToDisk: false }).set('/pl', page('home'), {});
    await Handler.disk.stats();
    expect(await diskFiles()).toHaveLength(0);
  });

  it('strona z buildu jest czytana z .next/server/app i nie jest usuwana', async () => {
    const app = join(serverDistDir, 'app');
    await mkdir(join(app, 'pl'), { recursive: true });
    await writeFile(join(app, 'pl/regulamin.html'), '<h1>Regulamin</h1>');
    await writeFile(join(app, 'pl/regulamin.rsc'), 'rsc');
    await writeFile(join(app, 'pl/regulamin.meta'), JSON.stringify({ status: 200, headers: { 'x-next-cache-tags': '_N_T_/layout' } }));
    const mtime = new Date(1_000_000 - 5000);
    await utimes(join(app, 'pl/regulamin.html'), mtime, mtime);

    const { handler } = setup({ diskMaxEntries: 1 });
    const seed = await handler().get('/pl/regulamin', APP_PAGE);
    expect(seed?.value.html).toBe('<h1>Regulamin</h1>');
    expect(seed?.value.rscData.toString()).toBe('rsc');
    expect(seed?.lastModified).toBe(mtime.getTime());
    for (let i = 0; i < 5; i++) await handler().set(`/inne/${i}`, page('x'), {});
    expect(readFileSync(join(app, 'pl/regulamin.html'), 'utf8')).toBe('<h1>Regulamin</h1>');
    // Klucz spoza katalogu aplikacji nie jest czytany.
    expect(await handler().get('/../../etc/passwd', APP_PAGE)).toBeNull();
  });

  it('strona z buildu nadpisana w runtime nie wraca do wersji z buildu po wypadnięciu z cache', async () => {
    const app = join(serverDistDir, 'app');
    await mkdir(join(app, 'pl/praca/miasto'), { recursive: true });
    await writeFile(join(app, 'pl/praca/miasto/gent.html'), 'stara');
    await writeFile(join(app, 'pl/praca/miasto/gent.rsc'), 'rsc');
    const { handler, clock } = setup({ negativeTtlMs: 1000 });
    expect((await handler().get('/pl/praca/miasto/gent', APP_PAGE))?.value.html).toBe('stara');
    await handler().set('/pl/praca/miasto/gent', page('404', 404), {});
    clock.t += 1001;
    expect(await handler().get('/pl/praca/miasto/gent', APP_PAGE)).toBeNull();
  });

  it('revalidateTag/revalidatePath: wpis z tagiem starszym niż rewalidacja = brak w cache', async () => {
    const { handler, clock } = setup();
    await handler().set('/pl/employer', page('v1', 200, '_N_T_/layout,_N_T_/pl/employer'), {});
    clock.t += 10;
    await handler().revalidateTag('_N_T_/pl/employer');
    expect(await handler().get('/pl/employer', APP_PAGE)).toBeNull();
    clock.t += 10;
    await handler().set('/pl/employer', page('v2', 200, '_N_T_/layout,_N_T_/pl/employer'), {});
    expect((await handler().get('/pl/employer', APP_PAGE))?.value.html).toBe('v2');
  });

  it('cache fetch: tagi z kontekstu i rewalidacja', async () => {
    const { handler, clock } = setup();
    const data = { kind: 'FETCH', data: { headers: {}, body: 'e30=', status: 200, url: 'x' }, revalidate: 60 };
    await handler().set('fetch-key', data, { fetchCache: true, tags: ['jobs'] });
    const ctx = { kind: 'FETCH', tags: ['jobs'], softTags: [] };
    expect((await handler().get('fetch-key', ctx))?.value.data.body).toBe('e30=');
    clock.t += 1;
    await handler().revalidateTag(['jobs']);
    expect(await handler().get('fetch-key', ctx)).toBeNull();
  });

  it('uszkodzony plik na dysku = brak wpisu (bez wyjątku), pozostałości .tmp sprzątane przy starcie', async () => {
    await mkdir(diskDir, { recursive: true });
    await writeFile(join(diskDir, 'x.tmp'), 'przerwany zapis');
    const { Handler, handler } = setup();
    await handler().set('/pl', page('home'), {});
    await Handler.disk.stats();
    const [file] = await diskFiles();
    await writeFile(join(diskDir, file!), '{uszkodzony');
    const Restarted = createIsrCacheHandler({});
    expect(await new Restarted({ serverDistDir }).get('/pl', APP_PAGE)).toBeNull();
    expect((await readdir(diskDir)).some((name) => name.endsWith('.tmp'))).toBe(false);
  });

  it('isNegativeValue i serializacja', () => {
    expect(isNegativeValue(null)).toBe(true);
    expect(isNegativeValue(page('x', 404))).toBe(true);
    expect(isNegativeValue(page('x', 500))).toBe(true);
    expect(isNegativeValue(page('x', 200))).toBe(false);
    expect(isNegativeValue({ kind: 'APP_PAGE', html: 'x' })).toBe(false);
    const round = deserializeEntry(serializeEntry('/k', { lastModified: 5, value: page('ż') }));
    expect(round.key).toBe('/k');
    expect(round.value.html).toBe('ż');
    expect(Buffer.isBuffer(round.value.rscData)).toBe(true);
  });

  it('next.config.mjs wpina handler i nie wyłącza isrFlushToDisk (cache obrazów)', () => {
    const config = readFileSync(join(process.cwd(), 'next.config.mjs'), 'utf8');
    expect(config).toMatch(/cacheHandler:\s*fileURLToPath\(new URL\('\.\/src\/lib\/cache\/isr-cache-handler\.mjs'/);
    expect(config).not.toMatch(/isrFlushToDisk\s*:/);
  });
});
