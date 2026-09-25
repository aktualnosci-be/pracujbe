/**
 * Jedno źródło reguł redakcji danych osobowych przed wysłaniem poza aplikację
 * (webhook błędów #571, logi serwera). Czyste funkcje bez zależności —
 * trafiają też do bundla klienta, więc zostają małe.
 *
 * Zasada: usuwamy WARTOŚCI (e-mail, telefon, NISS/BIS, IBAN, tokeny, query i fragment
 * URL, nazwy plików dokumentów, wiersze z błędów Postgresa) oraz całe pola o wrażliwych
 * nazwach (treść wiadomości, bio, CV, dane kontaktowe, nagłówki, body). Zostają kody błędów,
 * obszar (`area`), UUID-y korelacyjne i ścieżki URL bez parametrów.
 */

export const FILTERED = '[Filtered]';

const MAX_DEPTH = 6;
const MAX_ARRAY = 50;
const MAX_STRING = 4000;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Kolejność ma znaczenie: najpierw URL-e (query/fragment), potem pojedyncze wartości. */
const STRING_RULES: ReadonlyArray<readonly [RegExp, string | ((m: string) => string)]> = [
  // Wiersz i wartości klucza z błędów Postgresa („Failing row contains (…)”, „Key (email)=(…)”).
  [/(Failing row contains )\([^\n]*\)/g, `$1(${FILTERED})`],
  [/(Key \([^)]*\)=)\([^)]*\)/g, `$1(${FILTERED})`],
  // Pełne URL-e: zostaje schemat, host i ścieżka bez tokenów.
  [/\b(?:https?|wss?):\/\/[^\s"'<>`]+/gi, (m) => redactUrl(m)],
  // Query i fragment w ścieżkach względnych („/pl/x?token=…”, „#token=…”).
  [/\?[^\s"'<>`#]*=[^\s"'<>`]*/g, `?${FILTERED}`],
  [/#[A-Za-z0-9_.~%+=&-]{16,}/g, `#${FILTERED}`],
  // Tokeny: JWT, nagłówki Authorization, pary klucz=sekret.
  [/\beyJ[\w-]{5,}\.[\w-]{5,}\.[\w-]{5,}/g, FILTERED],
  [/\b(Bearer|Basic)\s+[\w.~+/=-]{8,}/gi, `$1 ${FILTERED}`],
  [
    /\b((?:access_|refresh_|id_)?token|secret|password|passwd|api[_-]?key|signature|authorization|cookie)(\s*[=:]\s*)("?)[^\s&"',;]{4,}\3/gi,
    `$1$2$3${FILTERED}$3`,
  ],
  // Adres e-mail.
  [/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, FILTERED],
  // IBAN.
  [/\b[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]{4}){2,7}(?:[ ]?[A-Z0-9]{1,3})?\b/g, FILTERED],
  // NISS/BIS (rijksregisternummer): 11 cyfr, także w zapisie YY.MM.DD-XXX.XX.
  [/\b\d{2}[.\s]?\d{2}[.\s]?\d{2}[-\s]?\d{3}[.\s]?\d{2}\b/g, FILTERED],
  // Telefon międzynarodowy (+32 / 0032…) i krajowy (04xx…, 02…).
  [/(?:\+|\b00)\d{1,3}(?:[\s().-]*\d){7,12}\b/g, FILTERED],
  [/\b0\d(?:[\s./-]?\d){7,9}\b/g, FILTERED],
  // Nazwy plików dokumentów (CV bywa nazwane imieniem i nazwiskiem).
  [/[^\s/\\"'<>`()[\]]+\.(?:pdf|docx?|odt|rtf|pages)\b/gi, FILTERED],
  // Długie nieprzezroczyste tokeny (poza UUID-ami korelacyjnymi).
  [/[A-Za-z0-9_-]{32,}/g, (m) => (UUID_RE.test(m) || !/\d/.test(m) || !/[A-Za-z]/.test(m) ? m : FILTERED)],
];

/** Redaguje wartości osobowe i sekrety w dowolnym tekście (wiadomość błędu, log, stack). */
export function redactString(input: string): string {
  let out = input.length > MAX_STRING ? `${input.slice(0, MAX_STRING)}…` : input;
  for (const [re, replacement] of STRING_RULES) {
    out = typeof replacement === 'string' ? out.replace(re, replacement) : out.replace(re, replacement);
  }
  return out;
}

function redactPathSegment(segment: string): string {
  let decoded = segment;
  try {
    decoded = decodeURIComponent(segment);
  } catch {
    return FILTERED;
  }
  if (UUID_RE.test(decoded)) return segment;
  if (/^[A-Za-z0-9_.~-]{24,}$/.test(decoded) && /\d/.test(decoded)) return FILTERED;
  const redacted = redactString(decoded);
  return redacted === decoded ? segment : FILTERED;
}

/**
 * URL bez query i fragmentu (parametry mogą nieść tokeny gościa, e-mail, wyszukiwaną frazę)
 * i bez segmentów ścieżki wyglądających na token lub dane osobowe. Działa dla URL-i
 * absolutnych i względnych; zwraca tę samą formę.
 */
export function redactUrl(raw: string): string {
  const hashAt = raw.indexOf('#');
  const queryAt = raw.indexOf('?');
  const cut = [hashAt, queryAt].filter((i) => i >= 0);
  const end = cut.length ? Math.min(...cut) : raw.length;
  const suffix = queryAt >= 0 && queryAt === end ? `?${FILTERED}` : hashAt >= 0 && hashAt === end ? `#${FILTERED}` : '';
  const base = raw.slice(0, end);

  const origin = /^[a-z][a-z0-9+.-]*:\/\/[^/]*/i.exec(base)?.[0] ?? '';
  // Dane logowania w URL (user:pass@host) — host zostaje.
  const safeOrigin = origin.replace(/\/\/[^/@]*@/, '//');
  const path = base.slice(origin.length);
  const safePath = path
    .split('/')
    .map((s) => (s ? redactPathSegment(s) : s))
    .join('/');
  return `${safeOrigin}${safePath}${suffix}`;
}

/** Klucze, których wartość zawsze usuwamy (po normalizacji: małe litery, bez separatorów). */
const SENSITIVE_KEYS = new Set([
  'name', 'firstname', 'lastname', 'fullname', 'displayname', 'username', 'givenname', 'familyname',
  'message', 'body', 'bio', 'about', 'text', 'content', 'answer', 'answers', 'note', 'notes',
  'cv', 'resume', 'file', 'files', 'filename', 'originalname', 'attachment',
  'headers', 'cookies', 'data', 'payload', 'form', 'formdata', 'variables', 'params', 'args', 'arguments',
  'ip', 'ipaddress', 'useragent', 'session', 'sessionid', 'user', 'profile', 'candidate', 'recipient',
  'address', 'street', 'birthdate', 'dateofbirth', 'dob', 'niss', 'bis', 'nationalnumber',
  'rijksregisternummer', 'iban', 'env',
]);
const SENSITIVE_PARTS = [
  'email', 'mail', 'phone', 'mobile', 'password', 'passwd', 'secret', 'token', 'cookie',
  'authorization', 'apikey', 'credential', 'signature', 'query', 'search', 'keyword',
];
/** Klucze z wartością-URL — zostaje ścieżka bez parametrów. */
const URL_KEYS = new Set(['href', 'path', 'pathname', 'from', 'to', 'referrer', 'referer', 'location', 'target', 'route', 'transaction']);

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function isSensitiveKey(key: string): boolean {
  const k = normalizeKey(key);
  if (SENSITIVE_KEYS.has(k)) return true;
  return SENSITIVE_PARTS.some((p) => k.includes(p));
}

function isUrlKey(key: string): boolean {
  const k = normalizeKey(key);
  return URL_KEYS.has(k) || k.endsWith('url') || k.endsWith('uri') || k.endsWith('target');
}

function redactInner(value: unknown, depth: number, seen: WeakSet<object>, byKey: boolean): unknown {
  if (typeof value === 'string') return redactString(value);
  if (value === null || typeof value !== 'object') {
    return typeof value === 'function' || typeof value === 'symbol' ? undefined : value;
  }
  if (depth >= MAX_DEPTH || seen.has(value)) return FILTERED;
  seen.add(value);
  if (value instanceof Error) return redactString(`${value.name}: ${value.message}`);
  if (Array.isArray(value)) {
    return value.slice(0, MAX_ARRAY).map((v) => redactInner(v, depth + 1, seen, byKey));
  }
  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value)) {
    if (byKey && isSensitiveKey(key)) {
      out[key] = FILTERED;
    } else if (typeof v === 'string' && isUrlKey(key)) {
      out[key] = redactUrl(v);
    } else {
      out[key] = redactInner(v, depth + 1, seen, byKey);
    }
  }
  return out;
}

/** Głęboka redakcja obiektu/tablicy/tekstu. Nie modyfikuje wejścia. */
export function redactValue<T>(value: T): T {
  return redactInner(value, 0, new WeakSet(), true) as T;
}

/**
 * Redakcja samych wartości tekstowych, bez usuwania pól po nazwie — dla znanych struktur
 * SDK (np. `contexts.os.name`, `contexts.browser.name`), w których nazwy kluczy są techniczne.
 */
export function redactStrings<T>(value: T): T {
  return redactInner(value, 0, new WeakSet(), false) as T;
}

/**
 * Tekst błędu do logu: nazwa, wiadomość, stack i łańcuch `cause` po redakcji.
 * Nie dołącza pól własnych błędu (np. `context`, `details` z odpowiedzi dostawcy).
 */
export function redactError(error: Error, depth = 0): string {
  const head = error.stack ?? `${error.name}: ${error.message}`;
  let out = redactString(head);
  const cause = (error as { cause?: unknown }).cause;
  if (cause !== undefined && depth < 3) {
    out += `\n[cause] ${cause instanceof Error ? redactError(cause, depth + 1) : safeStringify(redactValue(cause))}`;
  }
  return out;
}

function safeStringify(value: unknown): string {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return FILTERED;
  }
}
