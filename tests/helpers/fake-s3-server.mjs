// Atrapa API S3 (styl ścieżki, bez weryfikacji podpisu) do testów kopii w R2 (#569).
// Klucz odczytu może tylko GET/HEAD/listować; zapis/usuwanie → 403 AccessDenied.
// Użycie z basha: `node tests/helpers/fake-s3-server.mjs <plik-portu>` (działa do SIGTERM).
import { createServer } from 'node:http';
import { writeFileSync } from 'node:fs';

function xml(body) {
  return `<?xml version="1.0" encoding="UTF-8"?>${body}`;
}
function esc(v) {
  return String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * @param {{ bucket: string, writeKeys: string[], readKeys: string[] }} options
 */
export function createFakeS3(options) {
  /** @type {Map<string, { body: Buffer, modified: Date }>} */
  const objects = new Map();
  const log = [];
  const server = createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const url = new URL(req.url ?? '/', 'http://local');
      const auth = String(req.headers.authorization ?? '');
      const keyId = /Credential=([^/]+)\//.exec(auth)?.[1] ?? '';
      const isWrite = options.writeKeys.includes(keyId);
      const isRead = options.readKeys.includes(keyId);
      const [, bucket, ...rest] = url.pathname.split('/');
      const key = decodeURIComponent(rest.join('/'));
      log.push({ method: req.method, key, keyId });
      const deny = (code, status) => {
        res.writeHead(status, { 'content-type': 'application/xml' });
        res.end(xml(`<Error><Code>${code}</Code><Message>${code}</Message></Error>`));
      };
      if (!isWrite && !isRead) return deny('InvalidAccessKeyId', 403);
      if (bucket !== options.bucket) return deny('NoSuchBucket', 404);
      const method = req.method ?? 'GET';
      if ((method === 'PUT' || method === 'DELETE' || method === 'POST') && !isWrite) return deny('AccessDenied', 403);

      if (!key && method === 'GET' && url.searchParams.get('list-type') === '2') {
        const prefix = url.searchParams.get('prefix') ?? '';
        const max = Math.min(Number(url.searchParams.get('max-keys') ?? 1000), 1000);
        const start = Number(url.searchParams.get('continuation-token') ?? 0);
        const keys = [...objects.keys()].filter((k) => k.startsWith(prefix)).sort();
        const page = keys.slice(start, start + max);
        const truncated = start + max < keys.length;
        const contents = page
          .map((k) => {
            const o = objects.get(k);
            return `<Contents><Key>${esc(k)}</Key><LastModified>${o.modified.toISOString()}</LastModified><ETag>"e"</ETag><Size>${o.body.length}</Size><StorageClass>STANDARD</StorageClass></Contents>`;
          })
          .join('');
        res.writeHead(200, { 'content-type': 'application/xml' });
        return res.end(
          xml(
            `<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><Name>${esc(bucket)}</Name><Prefix>${esc(prefix)}</Prefix><KeyCount>${page.length}</KeyCount><MaxKeys>${max}</MaxKeys><IsTruncated>${truncated}</IsTruncated>${truncated ? `<NextContinuationToken>${start + max}</NextContinuationToken>` : ''}${contents}</ListBucketResult>`,
          ),
        );
      }
      if (method === 'PUT' && key) {
        objects.set(key, { body: Buffer.concat(chunks), modified: new Date() });
        res.writeHead(200, { etag: '"e"' });
        return res.end();
      }
      if (method === 'DELETE' && key) {
        objects.delete(key);
        res.writeHead(204);
        return res.end();
      }
      if ((method === 'GET' || method === 'HEAD') && key) {
        const o = objects.get(key);
        if (!o) return deny('NoSuchKey', 404);
        res.writeHead(200, {
          'content-length': String(o.body.length),
          'content-type': 'application/octet-stream',
          'last-modified': o.modified.toUTCString(),
          etag: '"e"',
        });
        return res.end(method === 'HEAD' ? undefined : o.body);
      }
      deny('NotImplemented', 501);
    });
  });
  return {
    objects,
    log,
    server,
    /** @returns {Promise<string>} endpoint http://127.0.0.1:<port> */
    listen() {
      return new Promise((resolve) => {
        server.listen(0, '127.0.0.1', () => {
          const address = server.address();
          resolve(`http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`);
        });
      });
    },
    close() {
      return new Promise((resolve) => server.close(() => resolve(undefined)));
    },
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const portFile = process.argv[2];
  const fake = createFakeS3({
    bucket: process.env.FAKE_S3_BUCKET ?? 'backups',
    writeKeys: [process.env.FAKE_S3_WRITE_KEY ?? 'write-key'],
    readKeys: [process.env.FAKE_S3_READ_KEY ?? 'read-key'],
  });
  fake.listen().then((endpoint) => {
    if (portFile) writeFileSync(portFile, endpoint);
  });
  process.on('SIGTERM', () => fake.close().then(() => process.exit(0)));
}
