// Kontrola ODEBRANEJ wiadomości `.eml` (#45). Czysty moduł (bez I/O) — używa go
// `scripts/check-received-eml.mjs` i test `tests/unit/received-eml-check.test.ts`.
//
// Sprawdza to, co widzi odbiorca, a nie konfigurację SDK:
//   * wersja HTML i `text/plain` (multipart/alternative),
//   * tożsamość nadawcy i adres pocztowy w obu wersjach,
//   * wiadomość marketingowa: `List-Unsubscribe` (https) + `List-Unsubscribe-Post:
//     List-Unsubscribe=One-Click` (RFC 8058) i link wypisania w treści,
//   * brak trackingu: każdy link i obraz prowadzi wyłącznie do dozwolonych hostów (piksel
//     otwarć i przepisane linki kliknięć dostawcy mają inny host).

/** Rozwija nagłówki (RFC 5322 folding) i zwraca [nagłówki, treść]. */
function splitHeaders(raw) {
  const text = raw.replace(/\r\n/g, '\n');
  const idx = text.indexOf('\n\n');
  const head = idx === -1 ? text : text.slice(0, idx);
  const body = idx === -1 ? '' : text.slice(idx + 2);
  const headers = new Map();
  for (const line of head.replace(/\n[ \t]+/g, ' ').split('\n')) {
    const colon = line.indexOf(':');
    if (colon <= 0) continue;
    const name = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();
    headers.set(name, headers.has(name) ? `${headers.get(name)}, ${value}` : value);
  }
  return { headers, body };
}

function param(value, name) {
  const m = new RegExp(`${name}\\s*=\\s*(?:"([^"]*)"|([^;\\s]+))`, 'i').exec(value ?? '');
  return m ? (m[1] ?? m[2]) : null;
}

function decodeBody(body, encoding) {
  const enc = (encoding ?? '').toLowerCase();
  if (enc === 'base64') return Buffer.from(body.replace(/\s+/g, ''), 'base64').toString('utf8');
  if (enc === 'quoted-printable') {
    const bytes = [];
    const src = body.replace(/=\n/g, '');
    for (let i = 0; i < src.length; i += 1) {
      if (src[i] === '=' && /^[0-9A-Fa-f]{2}$/.test(src.slice(i + 1, i + 3))) {
        bytes.push(parseInt(src.slice(i + 1, i + 3), 16));
        i += 2;
      } else {
        bytes.push(...Buffer.from(src[i], 'utf8'));
      }
    }
    return Buffer.from(bytes).toString('utf8');
  }
  return body;
}

/** Liście drzewa MIME: `{ type, text }`. */
function collectParts(raw, out = []) {
  const { headers, body } = splitHeaders(raw);
  const type = (headers.get('content-type') ?? 'text/plain').split(';')[0].trim().toLowerCase();
  if (type.startsWith('multipart/')) {
    const boundary = param(headers.get('content-type'), 'boundary');
    if (!boundary) return out;
    const chunks = body.split(`--${boundary}`);
    for (const chunk of chunks.slice(1)) {
      if (chunk.startsWith('--')) break;
      collectParts(chunk.replace(/^\n/, ''), out);
    }
    return out;
  }
  out.push({ type, text: decodeBody(body, headers.get('content-transfer-encoding')) });
  return out;
}

function decodeEntities(value) {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function htmlText(html) {
  return decodeEntities(html.replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ');
}

function hostOf(url) {
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * @param {string} raw treść pliku `.eml`
 * @param {{ allowedHosts: string[], identity: string, postalAddress: string, marketing?: boolean }} opts
 * @returns {{ ok: boolean, failures: string[] }}
 */
export function checkReceivedEml(raw, opts) {
  const failures = [];
  const { headers } = splitHeaders(raw);
  const parts = collectParts(raw);
  const html = parts.find((p) => p.type === 'text/html')?.text ?? null;
  const plain = parts.find((p) => p.type === 'text/plain')?.text ?? null;
  const allowed = new Set(opts.allowedHosts.map((h) => h.toLowerCase()));

  if (!headers.get('from')) failures.push('missing From header');
  if (!html) failures.push('missing text/html part');
  if (!plain || !plain.trim()) failures.push('missing text/plain part');

  const identity = opts.identity.replace(/\s+/g, ' ').trim();
  const address = opts.postalAddress.replace(/\s+/g, ' ').trim();
  const plainFlat = (plain ?? '').replace(/\s+/g, ' ');
  const htmlFlat = html ? htmlText(html) : '';
  if (!identity || !address) failures.push('sender identity/address not provided to the check');
  for (const [label, value] of [['identity', identity], ['postal address', address]]) {
    if (!value) continue;
    if (!htmlFlat.includes(value)) failures.push(`sender ${label} missing in HTML`);
    if (!plainFlat.includes(value)) failures.push(`sender ${label} missing in text/plain`);
  }

  if (opts.marketing) {
    const listUnsub = headers.get('list-unsubscribe') ?? '';
    const oneClick = /<(https:\/\/[^>]+)>/i.exec(listUnsub)?.[1] ?? null;
    if (!oneClick) failures.push('missing https List-Unsubscribe header');
    if ((headers.get('list-unsubscribe-post') ?? '').trim() !== 'List-Unsubscribe=One-Click') {
      failures.push('missing List-Unsubscribe-Post: List-Unsubscribe=One-Click');
    }
    if (oneClick && !allowed.has(hostOf(oneClick) ?? '')) {
      failures.push('List-Unsubscribe points outside allowed hosts');
    }
    if (html && !/data-email-unsubscribe/.test(html) && !/\/wypisz\?t=/.test(html)) {
      failures.push('missing unsubscribe link in HTML');
    }
    if (plain && !/\/wypisz\?t=/.test(plain)) failures.push('missing unsubscribe link in text/plain');
  }

  if (html) {
    const urls = [...html.matchAll(/\s(?:href|src)\s*=\s*"([^"]*)"/gi)].map((m) => decodeEntities(m[1]));
    for (const url of urls) {
      if (url.startsWith('mailto:') || url.startsWith('#')) continue;
      const host = hostOf(url);
      if (!host || !allowed.has(host)) failures.push(`tracking or foreign link: ${url.slice(0, 120)}`);
    }
  }
  if (plain) {
    for (const m of plain.matchAll(/https?:\/\/[^\s<>"')\]]+/gi)) {
      const host = hostOf(m[0]);
      if (!host || !allowed.has(host)) failures.push(`tracking or foreign link in text/plain: ${m[0].slice(0, 120)}`);
    }
  }

  return { ok: failures.length === 0, failures: [...new Set(failures)] };
}
