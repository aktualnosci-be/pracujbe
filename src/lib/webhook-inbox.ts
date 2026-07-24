import 'server-only';

import type { createAdminClient } from '@/lib/supabase/admin';

/**
 * Inbox webhooków ze stanem + DZIERŻAWĄ (P0-01/P0-02/P2-06). Zamiast markera „widziany"
 * wstawianego PRZED przetworzeniem (co przy awarii gubiło zdarzenie na zawsze), używamy
 * atomowego claimu z lease (RPC `claim_webhook`, FOR UPDATE):
 *   - `claimWebhook` → 'claimed' (przetwarzaj), 'duplicate' (już 'completed', pomiń),
 *                      'locked' (inny worker trzyma świeżą dzierżawę → pomiń, bez podwójnych
 *                      skutków — P2-06), 'error' (inbox nieosiągalny → wołający decyduje);
 *   - przetwarzanie wykonuje się PO claimie;
 *   - `completeWebhook` (RPC) oznacza 'completed' i zwraca, czy trafił wiersz — błąd/false
 *     to dla wołającego powód do 500 (reprocessing), nie cichy sukces.
 *
 * Awaria przed `completed` NIE blokuje ponowienia (dzierżawa wygaśnie → reprocessing; zapisy
 * Stripe są idempotentne po stabilnych ID; dla e-maili ponowna wysyłka to mniejsze zło niż
 * trwała utrata). Tabela `processed_webhooks` + funkcje są dostępne tylko dla service_role.
 */

type Admin = ReturnType<typeof createAdminClient>;

export type ClaimResult = 'claimed' | 'duplicate' | 'locked' | 'error';

/** Domyślna długość dzierżawy (s) — powyżej realnego czasu przetwarzania pojedynczego eventu. */
const DEFAULT_LOCK_SECONDS = 300;

/**
 * Rezerwuje zdarzenie do przetworzenia (atomowo, z dzierżawą — P2-06).
 *  - `duplicate` → zdarzenie już `completed`; pomiń, zwróć 200.
 *  - `locked`    → inny worker trzyma świeżą dzierżawę; pomiń (bez podwójnych skutków), zwróć 200.
 *  - `claimed`   → przetwarzaj (nowe LUB dzierżawa wygasła — reprocessing jest bezpieczny).
 *  - `error`     → inbox nieosiągalny (brak service-role/infra). Wołający decyduje.
 */
export async function claimWebhook(
  admin: Admin,
  id: string,
  source: string,
  lockSeconds: number = DEFAULT_LOCK_SECONDS,
): Promise<ClaimResult> {
  const { data, error } = await admin.rpc('claim_webhook', {
    p_id: id,
    p_source: source,
    p_lock_seconds: lockSeconds,
  });
  if (error) return 'error';
  const outcome = typeof data === 'string' ? data : '';
  if (outcome === 'claimed' || outcome === 'duplicate' || outcome === 'locked') return outcome;
  return 'error';
}

/**
 * Oznacza zdarzenie jako zakończone (po udanym przetworzeniu). Zwraca `true`, gdy wpis został
 * oznaczony; `false` przy błędzie DB lub braku wpisu — wołający traktuje to jako powód do 500
 * (reprocessing), nie cichy sukces (P2-06).
 */
export async function completeWebhook(admin: Admin, id: string): Promise<boolean> {
  const { data, error } = await admin.rpc('complete_webhook', { p_id: id });
  if (error) return false;
  return data === true;
}
