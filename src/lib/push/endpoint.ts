/**
 * Dozwolone usługi push przeglądarek (#724) — lustro `public.push_endpoint_allowed` (0219).
 *
 * Endpoint subskrypcji podaje przeglądarka, a serwer wysyła na niego żądanie HTTP — dowolny adres
 * byłby ścieżką do SSRF (sieć wewnętrzna, metadane chmury). Przyjmujemy więc wyłącznie znane
 * usługi push (FCM, Mozilla, Windows, Apple): https, host małymi literami bez portu i danych
 * logowania, od razu po nim ścieżka. Test `web-push-endpoint` porównuje wzorce z migracją.
 */
export const PUSH_ENDPOINT_PATTERNS: readonly RegExp[] = [
  /^https:\/\/fcm\.googleapis\.com\//,
  /^https:\/\/updates\.push\.services\.mozilla\.com\//,
  /^https:\/\/[a-z0-9-]+\.notify\.windows\.com\//,
  /^https:\/\/([a-z0-9-]+\.)*push\.apple\.com\//,
];

export const PUSH_ENDPOINT_MAX_LENGTH = 2048;

// eslint-disable-next-line no-control-regex -- odrzucamy znaki sterujące i białe w adresie
const FORBIDDEN_CHARS = /[\s\u0000-\u001f\u007f]/;

export function isAllowedPushEndpoint(endpoint: unknown): endpoint is string {
  if (typeof endpoint !== 'string') return false;
  if (endpoint.length < 20 || endpoint.length > PUSH_ENDPOINT_MAX_LENGTH) return false;
  if (FORBIDDEN_CHARS.test(endpoint)) return false;
  return PUSH_ENDPOINT_PATTERNS.some((pattern) => pattern.test(endpoint));
}

/** Klucz publiczny P-256 (65 B) i sekret (16 B) subskrypcji w base64url bez dopełnienia. */
export const PUSH_P256DH_PATTERN = /^[A-Za-z0-9_-]{87}$/;
export const PUSH_AUTH_PATTERN = /^[A-Za-z0-9_-]{22}$/;

const BROWSERS: ReadonlyArray<[RegExp, string]> = [
  [/Edg\//, 'Edge'],
  [/OPR\/|Opera/, 'Opera'],
  [/SamsungBrowser\//, 'Samsung Internet'],
  [/Firefox\/|FxiOS\//, 'Firefox'],
  [/Chrome\/|CriOS\//, 'Chrome'],
  [/Safari\//, 'Safari'],
];
const SYSTEMS: ReadonlyArray<[RegExp, string]> = [
  [/Android/, 'Android'],
  [/iPhone|iPad|iPod/, 'iOS'],
  [/Windows/, 'Windows'],
  [/Mac OS X|Macintosh/, 'macOS'],
  [/CrOS/, 'ChromeOS'],
  [/Linux/, 'Linux'],
];

/**
 * Zgrubna etykieta urządzenia z nagłówka `User-Agent` (np. „Chrome · Android”) — tylko po to,
 * żeby kandydat rozpoznał urządzenie na liście. Pełnego user-agenta nie zapisujemy
 * (minimalizacja). Nierozpoznany = `null` (UI pokazuje „Nieznane urządzenie”).
 */
export function deviceLabelFromUserAgent(userAgent: string | null | undefined): string | null {
  if (!userAgent) return null;
  const browser = BROWSERS.find(([re]) => re.test(userAgent))?.[1];
  const system = SYSTEMS.find(([re]) => re.test(userAgent))?.[1];
  const parts = [browser, system].filter((part): part is string => Boolean(part));
  return parts.length > 0 ? parts.join(' · ') : null;
}
