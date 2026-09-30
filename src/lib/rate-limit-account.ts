import { checkRateLimit } from '@/lib/rate-limit';

export interface AccountRateLimitOptions {
  /** Budżet akcji na KONTO w oknie (zmiana sieci go nie omija). */
  max: number;
  windowSeconds: number;
  /**
   * Szerszy próg na adres IP (automatyzacja wielu kont z jednego adresu). Domyślnie 10 × `max` —
   * osoby za wspólnym NAT/biurem nie są blokowane po zwykłym użyciu limitu przez jedną osobę.
   */
  ipMax?: number;
}

/**
 * Limit akcji zalogowanego konta (#1109, wzorzec #852): najpierw budżet na konto (`action`,
 * klucz = identyfikator konta, bez IP), potem szeroki próg sieciowy (`action-ip`). Wołać PO
 * odczycie sesji — anonimowe wywołanie nie zużywa wspólnego budżetu. Konto ponad swoim limitem
 * nie zużywa progu sieciowego.
 */
export async function checkAccountRateLimit(
  action: string,
  accountId: string,
  opts: AccountRateLimitOptions,
): Promise<boolean> {
  const { max, windowSeconds } = opts;
  if (!(await checkRateLimit(action, { identifier: accountId, perIp: false, max, windowSeconds }))) return false;
  return checkRateLimit(`${action}-ip`, { max: opts.ipMax ?? max * 10, windowSeconds });
}
