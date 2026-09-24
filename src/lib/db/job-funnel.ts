import 'server-only';

import type { FunnelPayload } from '@/lib/job-funnel/events';
import { withUserTransaction, type TransactionPool } from './transaction';

/**
 * Zapis zdarzenia lejka (#99) jako gość (anon) na ograniczonym loginie aplikacji. Bramka
 * `pracujbe.funnel_writer` obowiązuje tylko w tej transakcji. RPC robi atomowy upsert
 * agregatu i deduplikację po nonce (0089). Zwraca liczbę zliczonych ofert.
 */
export async function recordJobFunnelEvent(
  pool: TransactionPool,
  payload: FunnelPayload,
): Promise<number> {
  return withUserTransaction(pool, null, async (tx) => {
    await tx.query("SELECT set_config('pracujbe.funnel_writer', 'on', true)");
    const result = (await tx.query(
      'SELECT public.record_job_funnel_event($1::text, $2::uuid, $3::uuid[]) AS counted',
      [payload.event, payload.nonce, payload.jobIds],
    )) as { rows: { counted: unknown }[] };
    const counted = Number(result.rows[0]?.counted ?? 0);
    return Number.isFinite(counted) ? counted : 0;
  });
}
