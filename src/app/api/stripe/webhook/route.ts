import { isBillingEnabled } from '@/lib/billing/flag';

/**
 * Integracja sprzedażowa jest wyłączona w bezpłatnym MVP (#51). Endpoint nie czyta treści ani
 * podpisu żądania i nigdy nie zmienia danych:
 * - flaga `BILLING_ENABLED` wyłączona (domyślnie) → 404, jakby trasy nie było;
 * - flaga włączona → 410: ta wersja nie ma obsługi zdarzeń Stripe (osobny projekt).
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(): Promise<Response> {
  if (!isBillingEnabled()) {
    return Response.json({ error: 'not found' }, { status: 404 });
  }
  return Response.json({ error: 'billing disabled' }, { status: 410 });
}
