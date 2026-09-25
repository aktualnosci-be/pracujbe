import "server-only";

/**
 * Limit prób bramki `SITE_ACCESS_PASSWORD` bez zaufanego adresu klienta — WYŁĄCZNIE poza
 * produkcją (#625, lokalny `next dev`/`next start` bez proxy). Stan żyje w pamięci jednego
 * procesu: nie ma wspólnego klucza w bazie, którym nadawca bez nagłówka blokowałby innych.
 * W produkcji żądanie bez zaufanego adresu jest odrzucane wcześniej (route handler).
 */

const attempts = { windowStart: 0, count: 0 };

export function withinLocalSiteAccessLimit(
  max: number,
  windowSeconds: number,
  now: number = Date.now(),
): boolean {
  if (now - attempts.windowStart >= windowSeconds * 1000) {
    attempts.windowStart = now;
    attempts.count = 0;
  }
  attempts.count += 1;
  return attempts.count <= max;
}

/** Tylko dla testów. */
export function resetLocalSiteAccessLimit(): void {
  attempts.windowStart = 0;
  attempts.count = 0;
}
