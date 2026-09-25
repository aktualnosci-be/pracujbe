// Własny cacheHandler ISR (#298, „Otwarte”): zastępuje domyślny FileSystemCache Next.js 15.
//
// Problem: domyślny handler zapisuje na dysk KAŻDY wynik ISR, także 404 losowych slugów ofert
// (`/pl/oferty-pracy/<cokolwiek>`), bez limitu — dysk usługi rośnie z każdym botem. Wyłączenie
// `experimental.isrFlushToDisk` odpada, bo wyłącza też cache obrazów.
//
// Zasady tego handlera (jedna instancja Railway, jeden proces `next start`):
// - pamięć: LRU z limitem bajtów i wpisów (wspólne dla wszystkich żądań — Next tworzy handler
//   per żądanie, więc stan żyje w domknięciu fabryki);
// - odpowiedzi negatywne (404/≥ 400, `value: null`) tylko w osobnej, małej puli pamięci z krótkim
//   TTL — nigdy na dysk i nie wypychają z LRU poprawnych stron;
// - dysk: osobny katalog (`.next/cache/isr-handler`), jeden plik na wpis, limit bajtów, wpisów
//   i rozmiaru pojedynczego wpisu; najstarsze wpisy są usuwane; po restarcie indeks z katalogu;
// - strony z buildu (prerender w `.next/server/app`) są czytane jak w domyślnym handlerze,
//   ale nigdy nadpisywane ani usuwane;
// - `revalidateTag`/`revalidatePath` działają przez mapę tagów w pamięci procesu.
// Cache obrazów (`.next/cache/images`) ma osobną ścieżkę w Next i ten plik go nie dotyczy.
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { join, sep } from 'node:path';

const MB = 1024 * 1024;

export const DEFAULT_LIMITS = Object.freeze({
  memoryMaxBytes: 64 * MB,
  memoryMaxEntries: 2000,
  negativeMaxEntries: 200,
  negativeTtlMs: 60_000,
  diskMaxBytes: 256 * MB,
  diskMaxEntries: 5000,
  entryMaxBytes: 4 * MB,
});

const TAGS_HEADER = 'x-next-cache-tags';
const FILE_SUFFIX = '.json';

/** Wpis negatywny: 404 (notFound), inny błąd albo brak wartości. */
export function isNegativeValue(value) {
  if (!value) return true;
  const status = value.status;
  return typeof status === 'number' && status >= 400;
}

function byteLength(value) {
  if (value == null) return 0;
  if (typeof value === 'string') return Buffer.byteLength(value);
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) return value.byteLength;
  if (value instanceof Map) {
    let total = 0;
    for (const [k, v] of value) total += byteLength(k) + byteLength(v);
    return total;
  }
  if (Array.isArray(value)) return value.reduce((sum, item) => sum + byteLength(item), 0);
  if (typeof value === 'object') {
    let total = 0;
    for (const [k, v] of Object.entries(value)) total += k.length + byteLength(v);
    return total;
  }
  return 8;
}

// JSON z zachowaniem Buffer/Map (rscData, body trasy, segmentData). Kodowanie przed
// `JSON.stringify`, bo `Buffer.toJSON` zamienia bajty na tablicę liczb (wolne dla MB danych).
function encode(value) {
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
    return { __isr: 'buffer', base64: Buffer.from(value.buffer, value.byteOffset, value.byteLength).toString('base64') };
  }
  if (value instanceof Map) return { __isr: 'map', entries: [...value.entries()].map(([k, v]) => [k, encode(v)]) };
  if (Array.isArray(value)) return value.map(encode);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = encode(v);
    return out;
  }
  return value;
}

function reviver(_key, value) {
  if (value && typeof value === 'object' && value.__isr === 'buffer') return Buffer.from(value.base64, 'base64');
  if (value && typeof value === 'object' && value.__isr === 'map') return new Map(value.entries);
  return value;
}

export function serializeEntry(key, entry) {
  return Buffer.from(JSON.stringify({ key, lastModified: entry.lastModified, value: encode(entry.value) }));
}

export function deserializeEntry(buffer) {
  return JSON.parse(buffer.toString('utf8'), reviver);
}

function hashKey(key) {
  return createHash('sha256').update(key).digest('hex');
}

function isBuildPhase() {
  return process.env.NEXT_PHASE === 'phase-production-build';
}

/** Pamięć LRU: Map w kolejności użycia, limit bajtów i wpisów. */
class MemoryLru {
  constructor(maxBytes, maxEntries) {
    this.maxBytes = maxBytes;
    this.maxEntries = maxEntries;
    this.map = new Map();
    this.bytes = 0;
  }
  get(key) {
    const item = this.map.get(key);
    if (!item) return undefined;
    this.map.delete(key);
    this.map.set(key, item);
    return item;
  }
  set(key, item, size) {
    this.delete(key);
    if (size > this.maxBytes) return;
    this.map.set(key, { ...item, size });
    this.bytes += size;
    while (this.map.size > this.maxEntries || this.bytes > this.maxBytes) {
      const oldest = this.map.keys().next().value;
      this.delete(oldest);
    }
  }
  delete(key) {
    const item = this.map.get(key);
    if (!item) return;
    this.bytes -= item.size;
    this.map.delete(key);
  }
}

/** Katalog wpisów runtime z indeksem w pamięci (kolejność = od najstarszego). */
class DiskStore {
  constructor(dir, limits) {
    this.dir = dir;
    this.limits = limits;
    this.index = new Map();
    this.bytes = 0;
    this.ready = null;
    this.queue = Promise.resolve();
  }

  init() {
    this.ready ??= (async () => {
      await mkdir(this.dir, { recursive: true });
      const all = await readdir(this.dir);
      // Pozostałości przerwanego zapisu (restart w trakcie `writeFile`).
      await Promise.all(all.filter((name) => name.endsWith('.tmp')).map((name) => unlink(join(this.dir, name)).catch(() => {})));
      const names = all.filter((name) => name.endsWith(FILE_SUFFIX));
      const files = [];
      for (const name of names) {
        try {
          const info = await stat(join(this.dir, name));
          files.push({ hash: name.slice(0, -FILE_SUFFIX.length), size: info.size, mtimeMs: info.mtimeMs });
        } catch {
          // plik zniknął w międzyczasie
        }
      }
      files.sort((a, b) => a.mtimeMs - b.mtimeMs);
      for (const file of files) {
        this.index.set(file.hash, file.size);
        this.bytes += file.size;
      }
      await this.evict();
    })().catch(() => {
      // Brak zapisu na dysk nie może zatrzymać serwowania stron — zostaje sama pamięć.
      this.disabled = true;
    });
    return this.ready;
  }

  path(hash) {
    return join(this.dir, `${hash}${FILE_SUFFIX}`);
  }

  async read(key) {
    await this.init();
    if (this.disabled) return null;
    const hash = hashKey(key);
    if (!this.index.has(hash)) return null;
    const size = this.index.get(hash);
    try {
      const parsed = deserializeEntry(await readFile(this.path(hash)));
      if (parsed.key !== key) return null;
      this.index.delete(hash);
      this.index.set(hash, size);
      return { lastModified: parsed.lastModified, value: parsed.value };
    } catch {
      this.enqueue(() => this.remove(hash));
      return null;
    }
  }

  enqueue(task) {
    this.queue = this.queue.then(task).catch(() => {});
    return this.queue;
  }

  write(key, entry) {
    return this.enqueue(async () => {
      await this.init();
      if (this.disabled) return;
      const hash = hashKey(key);
      const data = serializeEntry(key, entry);
      if (data.byteLength > this.limits.entryMaxBytes) {
        await this.remove(hash);
        return;
      }
      const tmp = `${this.path(hash)}.${process.pid}.tmp`;
      await writeFile(tmp, data);
      await rename(tmp, this.path(hash));
      if (this.index.has(hash)) this.bytes -= this.index.get(hash);
      this.index.delete(hash);
      this.index.set(hash, data.byteLength);
      this.bytes += data.byteLength;
      await this.evict();
    });
  }

  delete(key) {
    return this.enqueue(async () => {
      await this.init();
      if (!this.disabled) await this.remove(hashKey(key));
    });
  }

  async remove(hash) {
    if (!this.index.has(hash)) return;
    this.bytes -= this.index.get(hash);
    this.index.delete(hash);
    await unlink(this.path(hash)).catch(() => {});
  }

  async evict() {
    while (this.index.size > this.limits.diskMaxEntries || this.bytes > this.limits.diskMaxBytes) {
      const oldest = this.index.keys().next().value;
      await this.remove(oldest);
    }
  }

  /** Stan do testów i diagnostyki. */
  async stats() {
    await this.init();
    await this.queue;
    return { entries: this.index.size, bytes: this.bytes };
  }
}

async function readBuildSeed(fs, serverDistDir, key, ctx) {
  const appDir = join(serverDistDir, 'app');
  const file = (suffix) => {
    const path = join(appDir, `${key}${suffix}`);
    if (!path.startsWith(appDir + sep)) throw new Error('invalid cache key');
    return path;
  };
  try {
    if (ctx.kind === 'APP_ROUTE') {
      const bodyPath = file('.body');
      const body = await fs.readFile(bodyPath);
      const { mtime } = await fs.stat(bodyPath);
      const meta = JSON.parse(await fs.readFile(file('.meta'), 'utf8'));
      return {
        lastModified: mtime.getTime(),
        value: { kind: 'APP_ROUTE', body, headers: meta.headers, status: meta.status },
      };
    }
    if (ctx.kind !== 'APP_PAGE') return null;
    const htmlPath = file('.html');
    const html = await fs.readFile(htmlPath, 'utf8');
    const { mtime } = await fs.stat(htmlPath);
    let meta;
    try {
      meta = JSON.parse(await fs.readFile(file('.meta'), 'utf8'));
    } catch {
      meta = undefined;
    }
    let segmentData;
    if (meta?.segmentPaths) {
      segmentData = new Map();
      await Promise.all(
        meta.segmentPaths.map(async (segmentPath) => {
          try {
            segmentData.set(segmentPath, await fs.readFile(file(`.segments${segmentPath}.segment.rsc`)));
          } catch {
            // brak segmentu = segment dynamiczny bez prefetchu (jak w domyślnym handlerze)
          }
        }),
      );
    }
    const rscData = ctx.isFallback
      ? undefined
      : await fs.readFile(file(ctx.isRoutePPREnabled ? '.prefetch.rsc' : '.rsc'));
    return {
      lastModified: mtime.getTime(),
      value: {
        kind: 'APP_PAGE',
        html,
        rscData,
        postponed: meta?.postponed,
        headers: meta?.headers,
        status: meta?.status,
        segmentData,
      },
    };
  } catch {
    return null;
  }
}

function entryTags(value) {
  const header = value?.headers?.[TAGS_HEADER];
  return typeof header === 'string' && header ? header.split(',') : [];
}

/**
 * Fabryka klasy handlera. Każde wywołanie ma własny stan (testy); aplikacja używa eksportu
 * domyślnego. `options.diskDir` nadpisuje katalog, `options.limits` — limity, `options.now` — zegar.
 */
export function createIsrCacheHandler(options = {}) {
  const limits = { ...DEFAULT_LIMITS, ...options.limits };
  const now = options.now ?? (() => Date.now());
  const negative = new MemoryLru(Number.MAX_SAFE_INTEGER, limits.negativeMaxEntries);
  const revalidatedTags = new Map();
  // Klucze stron z buildu nadpisane w runtime: po wypadnięciu z cache nie wracamy do starej
  // wersji z buildu (np. landing, który stał się 404). Zbiór ograniczony liczbą stron z buildu.
  const seeded = new Set();
  const overriddenSeeds = new Set();
  let memory = null;
  let disk = null;

  function isTagStale(tags, lastModified) {
    for (const tag of tags) {
      const at = revalidatedTags.get(tag);
      if (typeof at === 'number' && at >= lastModified) return true;
    }
    return false;
  }

  return class IsrCacheHandler {
    constructor(ctx = {}) {
      this.fs = ctx.fs ?? { readFile, stat };
      this.serverDistDir = ctx.serverDistDir;
      this.flushToDisk = ctx.flushToDisk !== false && !isBuildPhase();
      this.revalidatedTagsFromRequest = ctx.revalidatedTags ?? [];
      const memoryMaxBytes = options.limits?.memoryMaxBytes ?? (ctx.maxMemoryCacheSize || limits.memoryMaxBytes);
      memory ??= new MemoryLru(memoryMaxBytes, limits.memoryMaxEntries);
      const diskDir = options.diskDir ?? (ctx.serverDistDir ? join(ctx.serverDistDir, '..', 'cache', 'isr-handler') : null);
      if (!disk && diskDir) disk = new DiskStore(diskDir, limits);
    }

    static get disk() {
      return disk;
    }
    static get memory() {
      return memory;
    }
    static get negative() {
      return negative;
    }

    resetRequestCache() {}

    async revalidateTag(tags) {
      const list = typeof tags === 'string' ? [tags] : (tags ?? []);
      const at = now();
      for (const tag of list) revalidatedTags.set(tag, at);
    }

    async get(key, ctx = {}) {
      let entry = memory.get(key);
      if (!entry) {
        const miss = negative.get(key);
        if (miss) {
          if (now() - miss.lastModified > limits.negativeTtlMs) {
            negative.delete(key);
          } else {
            entry = miss;
          }
        }
      }
      if (!entry && disk && ctx.kind !== 'IMAGE') {
        entry = await disk.read(key);
        if (entry) memory.set(key, entry, byteLength(entry.value));
      }
      if (!entry && this.serverDistDir && ctx.kind !== 'FETCH' && !overriddenSeeds.has(key)) {
        entry = await readBuildSeed(this.fs, this.serverDistDir, key, ctx);
        if (entry) {
          seeded.add(key);
          memory.set(key, entry, byteLength(entry.value));
        }
      }
      if (!entry) return null;

      const value = entry.value;
      if (value?.kind === 'FETCH') {
        const tags = [...(ctx.tags ?? []), ...(ctx.softTags ?? [])];
        if (tags.some((tag) => this.revalidatedTagsFromRequest.includes(tag)) || isTagStale(tags, entry.lastModified)) {
          return null;
        }
      } else if (isTagStale(entryTags(value), entry.lastModified)) {
        return null;
      }
      return { lastModified: entry.lastModified, value };
    }

    async set(key, data, ctx = {}) {
      const entry = { lastModified: now(), value: data ?? null };
      if (seeded.has(key)) overriddenSeeds.add(key);
      if (isNegativeValue(data) && data?.kind !== 'FETCH') {
        // 404 losowego sluga: krótko w pamięci, nigdy na dysku; starszy poprawny wpis znika,
        // żeby zamknięta oferta nie wróciła z dysku po wygaśnięciu TTL.
        memory.delete(key);
        negative.set(key, entry, 1);
        if (disk) await disk.delete(key);
        return;
      }
      negative.delete(key);
      if (data?.kind === 'FETCH') entry.value = { ...data, tags: ctx.fetchCache ? ctx.tags : data.tags };
      memory.set(key, entry, byteLength(entry.value));
      if (this.flushToDisk && disk) await disk.write(key, entry);
    }
  };
}

export default createIsrCacheHandler();
