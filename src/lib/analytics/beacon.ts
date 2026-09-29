import { allowsTrackingOnPath } from './route-policy';

/**
 * Konfiguracja beaconu Cloudflare Web Analytics (#1046).
 *
 * `spa: false` — beacon liczy wyłącznie pełne załadowania strony. Domyślnie skrypt potrafi
 * też podpiąć się pod podmiany historii przeglądarki (`history.pushState`), więc nawigacja
 * kliencka Next.js z trasy publicznej na prywatną (panel, logowanie) byłaby mierzona już
 * załadowanym skryptem, mimo że komponent na trasie prywatnej się nie renderuje.
 */
export function cfBeaconConfig(token: string): string {
  return JSON.stringify({ token, spa: false });
}

/**
 * Czy przejście na `target` (adres z tego samego originu) trzeba wykonać pełnym
 * przeładowaniem, bo beacon jest już załadowany, a cel jest trasą prywatną.
 * Skrypt, który został wstawiony do DOM, zostaje w karcie do końca dokumentu — jedyny sposób
 * na jego pozbycie się to nowy dokument.
 */
export function needsHardNavigation(beaconLoaded: boolean, targetPathname: string): boolean {
  return beaconLoaded && !allowsTrackingOnPath(targetPathname);
}

/** Adres docelowy kliknięcia w link tego samego originu (`null` = zostaw domyślne zachowanie). */
export function sameOriginTarget(anchor: HTMLAnchorElement, origin: string): URL | null {
  if (anchor.target && anchor.target !== '_self') return null;
  if (anchor.hasAttribute('download')) return null;
  let url: URL;
  try {
    url = new URL(anchor.href, origin);
  } catch {
    return null;
  }
  return url.origin === origin ? url : null;
}
