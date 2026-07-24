import 'server-only';

import type { createAdminClient } from '@/lib/supabase/admin';

/**
 * Inbox webhooków ze stanem (P0-01/P0-02). Zamiast markera „widziany" wstawianego PRZED
 * przetworzeniem (co przy awarii gubiło zdarzenie na zawsze), używamy stanu:
 *   - `claimWebhook` wstawia wpis `processing` (albo raportuje `duplicate`, gdy już `completed`);
 *   - przetwarzanie wykonuje się PO claimie;
 *   - `completeWebhook` oznacza `completed` dopiero po sukcesie.
 *
 * Dzięki temu awaria przed `completed` NIE blokuje ponowienia (retry przetwarza ponownie —
 * zapisy Stripe są idempotentne po stabilnych ID; dla e-maili ponowna wysyłka to mniejsze zło
 * niż trwała utrata). Duplikatem do pominięcia jest wyłącznie `completed`.
 *
 * Tabela `processed_webhooks` jest dostępna tylko dla service_role — helper wymaga admin klienta.
 */

type Admin = ReturnType<typeof createAdminClient>;

export type ClaimResult = 'claimed' | 'duplicate' | 'error';

/**
 * Rezerwuje zdarzenie do przetworzenia.
 *  - `duplicate` → zdarzenie już `completed`; pomiń przetwarzanie, zwróć 200.
 *  - `claimed`   → przetwarzaj (nowe LUB wcześniejsza nieukończona/współbieżna próba —
 *                  reprocessing jest bezpieczny dzięki idempotentnym zapisom).
 *  - `error`     → inbox nieosiągalny (np. brak service-role/infra). Wołający decyduje;
 *                  dla Stripe przetwarzamy dalej (zapisy idempotentne), byle nie zgubić zdarzenia.
 */
export async function claimWebhook(admin: Admin, id: string, source: string): Promise<ClaimResult> {
  const { error: insErr } = await admin
    .from('processed_webhooks')
    .insert({ id, source, status: 'processing' });

  if (!insErr) return 'claimed';

  if ((insErr as { code?: string }).code === '23505') {
    const { data, error: selErr } = await admin
      .from('processed_webhooks')
      .select('status')
      .eq('id', id)
      .limit(1);
    if (selErr) return 'error';
    const status = Array.isArray(data) && data[0] ? (data[0] as { status?: string }).status : undefined;
    return status === 'completed' ? 'duplicate' : 'claimed';
  }

  return 'error';
}

/** Oznacza zdarzenie jako zakończone (po udanym przetworzeniu). */
export async function completeWebhook(admin: Admin, id: string): Promise<void> {
  await admin
    .from('processed_webhooks')
    .update({ status: 'completed', updated_at: new Date().toISOString() })
    .eq('id', id);
}
