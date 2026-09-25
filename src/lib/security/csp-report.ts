/**
 * Raporty naruszeń CSP (#47). Przeglądarka wysyła je w dwóch formatach:
 *   - `report-uri` → `application/csp-report`: `{ "csp-report": { "violated-directive": … } }`,
 *   - `report-to` (Reporting API) → `application/reports+json`: `[{ type: "csp-violation", body: { effectiveDirective: … } }]`.
 *
 * Z raportu zostaje wyłącznie to, co opisuje politykę, nie osobę: dyrektywa, rodzaj/origin
 * zablokowanego zasobu, ścieżka strony bez query i fragmentu (identyfikatory w ścieżce
 * zastąpione `:id`), origin pliku źródłowego, wiersz/kolumna, tryb. Świadomie pomijamy
 * `script-sample`, `referrer`, pełne URL-e, user agent i adres IP — mogą zawierać dane
 * osobowe albo tokeny (np. `#token=` z linków e-mail, query wyszukiwania).
 */

export interface CspViolation {
  directive: string;
  blocked: string;
  path: string | null;
  source: string | null;
  line: number | null;
  column: number | null;
  disposition: 'enforce' | 'report';
}

/** Najwyżej tyle raportów z jednego żądania (Reporting API grupuje je w tablicę). */
export const MAX_REPORTS_PER_REQUEST = 10;

const DIRECTIVE = /^[a-z][a-z-]{1,39}$/;
const KEYWORD_BLOCKED = new Set(['inline', 'eval', 'self', 'data', 'blob', 'wasm-eval', 'trusted-types-policy', 'trusted-types-sink']);
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const LONG_DIGITS = /\d{4,}/g;
const LONG_TOKEN = /[A-Za-z0-9_-]{24,}/g;

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 && value.length <= 4096 ? value : null;
}

function position(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 10_000_000 ? value : null;
}

/** `script-src-elem 'self' …` → `script-src-elem`; nieznany kształt → null. */
function directiveOf(value: unknown): string | null {
  const first = text(value)?.trim().split(/\s+/)[0]?.toLowerCase();
  return first && DIRECTIVE.test(first) ? first : null;
}

/** Sam origin (schemat + host + port). Adres niebędący URL-em http(s) → null. */
function originOf(value: unknown): string | null {
  const raw = text(value);
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    return url.origin;
  } catch {
    return null;
  }
}

function blockedOf(value: unknown): string {
  const raw = text(value)?.trim().toLowerCase();
  if (!raw) return 'unknown';
  if (KEYWORD_BLOCKED.has(raw)) return raw;
  const scheme = /^([a-z][a-z0-9+.-]*):/.exec(raw)?.[1];
  if (scheme === 'data' || scheme === 'blob') return scheme;
  if (scheme && scheme !== 'http' && scheme !== 'https') return 'other-scheme';
  return originOf(value) ?? 'unknown';
}

/** Ścieżka strony bez query/fragmentu; identyfikatory i długie tokeny → `:id`. */
function pathOf(value: unknown): string | null {
  const raw = text(value);
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    const path = url.pathname.replace(UUID, ':id').replace(LONG_TOKEN, ':id').replace(LONG_DIGITS, ':id');
    return path.slice(0, 200);
  } catch {
    return null;
  }
}

function fromLegacy(body: Record<string, unknown>): CspViolation | null {
  const directive = directiveOf(body['effective-directive']) ?? directiveOf(body['violated-directive']);
  if (!directive) return null;
  return {
    directive,
    blocked: blockedOf(body['blocked-uri']),
    path: pathOf(body['document-uri']),
    source: originOf(body['source-file']),
    line: position(body['line-number']),
    column: position(body['column-number']),
    disposition: body.disposition === 'report' ? 'report' : 'enforce',
  };
}

function fromReportingApi(body: Record<string, unknown>): CspViolation | null {
  const directive = directiveOf(body.effectiveDirective);
  if (!directive) return null;
  return {
    directive,
    blocked: blockedOf(body.blockedURL),
    path: pathOf(body.documentURL),
    source: originOf(body.sourceFile),
    line: position(body.lineNumber),
    column: position(body.columnNumber),
    disposition: body.disposition === 'report' ? 'report' : 'enforce',
  };
}

/**
 * Zwraca znormalizowane naruszenia albo `null`, gdy treść nie jest raportem CSP.
 * Wpisy innego typu z Reporting API (np. `deprecation`) są pomijane.
 */
export function parseCspReports(payload: unknown): CspViolation[] | null {
  if (Array.isArray(payload)) {
    if (payload.length === 0 || payload.length > MAX_REPORTS_PER_REQUEST) return null;
    const violations: CspViolation[] = [];
    for (const entry of payload) {
      const report = record(entry);
      if (!report || report.type !== 'csp-violation') continue;
      const body = record(report.body);
      const violation = body ? fromReportingApi(body) : null;
      if (violation) violations.push(violation);
    }
    return violations.length > 0 ? violations : null;
  }
  const legacy = record(record(payload)?.['csp-report']);
  const violation = legacy ? fromLegacy(legacy) : null;
  return violation ? [violation] : null;
}

/** Typy treści, które przeglądarki wysyłają dla raportów CSP. */
export function isCspReportContentType(contentType: string | null): boolean {
  const type = contentType?.split(';')[0]?.trim().toLowerCase();
  return type === 'application/csp-report' || type === 'application/reports+json' || type === 'application/json';
}
