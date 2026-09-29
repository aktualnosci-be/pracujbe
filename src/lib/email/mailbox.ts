/**
 * Zapis skrzynki nadawcy (`Nazwa <adres@domena>` albo sam adres) — jedno źródło dla transportu
 * EmailLabs (części `from`) i walidacji `EMAIL_FROM` w gotowości (`/api/health`, #1214).
 * Bez zależności (używane też przez `src/lib/env.ts`).
 */

const NAME_MIN = 2;
const NAME_MAX = 64;

/** `Nazwa <adres@domena>` albo sam adres → części; `null` = zły zapis. */
export function parseMailbox(value: string): { email: string; name?: string } | null {
  const trimmed = value.trim();
  const match = /^(.*)<([^<>\s]+@[^<>\s]+)>$/.exec(trimmed);
  const email = (match?.[2] ?? trimmed).trim();
  if (!/^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/.test(email)) return null;
  // Niesparowany cudzysłów w nazwie (np. ucięty `"Pracuj.be <…>`) = zły zapis nagłówka From.
  if (((match?.[1] ?? '').match(/"/g)?.length ?? 0) % 2 === 1) return null;
  const rawName = (match?.[1] ?? '').trim().replace(/^"(.*)"$/, '$1').trim();
  const name = rawName.length >= NAME_MIN ? rawName.slice(0, NAME_MAX) : undefined;
  return name ? { email, name } : { email };
}
