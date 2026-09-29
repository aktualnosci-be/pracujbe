import { routing } from '@/i18n/routing';

/**
 * Limit treści Server Actions na stronach publicznych (audyt CFG29-07, #1121).
 *
 * `experimental.serverActions.bodySizeLimit` w `next.config.mjs` jest globalny (6 MB — plik CV
 * i załączniki rozmów mają 5 MB), więc dotyczył też anonimowych formularzy: kontakt, aplikacja
 * gościa, zgłoszenie treści, logowanie/rejestracja. Te przepływy wysyłają najwyżej kilka
 * kilobajtów tekstu (pola mają własne limity długości), a duży anonimowy POST zużywa pamięć
 * procesu przed jakąkolwiek walidacją. Next nie pozwala ustawić limitu per akcja, dlatego
 * middleware odrzuca (413) żądanie Server Action z deklarowanym `Content-Length` powyżej progu
 * wszędzie poza panelami (`/candidate`, `/employer`, `/admin` — tylko tam są uploady:
 * CV, import CV, załączniki wiadomości, zrzut ogłoszenia). Bez `Content-Length` (chunked)
 * decyduje nadal globalny limit Next.
 */
export const PUBLIC_ACTION_MAX_BYTES = 256 * 1024;

const PANEL_SEGMENTS: ReadonlySet<string> = new Set(['candidate', 'employer', 'admin']);

/** Czy ścieżka należy do panelu (po opcjonalnym prefiksie języka)? */
export function isPanelPath(pathname: string): boolean {
  const segments = pathname.split('/').filter(Boolean);
  const locales: readonly string[] = routing.locales;
  const first = segments[0];
  const section = first && locales.includes(first) ? segments[1] : first;
  return section !== undefined && PANEL_SEGMENTS.has(section);
}

/** Żądanie Server Action spoza paneli, którego deklarowana treść przekracza próg. */
export function isOversizedPublicAction(
  pathname: string,
  method: string,
  headers: Pick<Headers, 'get'>,
): boolean {
  if (method !== 'POST' || headers.get('next-action') === null) return false;
  if (isPanelPath(pathname)) return false;
  const declared = headers.get('content-length');
  if (declared === null || !/^\d+$/.test(declared)) return false;
  return Number(declared) > PUBLIC_ACTION_MAX_BYTES;
}
