import 'server-only';

import { createHash } from 'node:crypto';

import { getPortalIdentity, isPortalDataConfigured, withPortalTransaction } from '@/lib/db/portal';
import { queryRows } from '@/lib/db/sql';
import { captureError } from '@/lib/error-report';

/**
 * Urządzenia Web Push zalogowanego kandydata (#724, 0219) — odczyt pod sesją (RLS
 * `push_subscriptions_select_own`), tylko aktywne. Endpoint (adres usługi push) nie trafia do
 * HTML: przeglądarka rozpoznaje „to urządzenie” po skrócie SHA-256 swojego endpointu
 * (`endpointHash`, liczonym tak samo przez `crypto.subtle` w komponencie).
 */

export interface PushDevice {
  id: string;
  label: string | null;
  createdAt: string;
  lastSuccessAt: string | null;
  endpointHash: string;
}

export type PushDevicesLoad = { status: 'ready'; devices: PushDevice[] } | { status: 'error' };

export function pushEndpointHash(endpoint: string): string {
  return createHash('sha256').update(endpoint, 'utf8').digest('hex');
}

function iso(value: unknown): string | null {
  if (value instanceof Date) return value.toISOString();
  return typeof value === 'string' ? value : null;
}

export async function loadPushDevices(): Promise<PushDevicesLoad> {
  if (!isPortalDataConfigured()) return { status: 'ready', devices: [] };
  try {
    const me = await getPortalIdentity();
    if (!me) return { status: 'error' };
    const rows = await withPortalTransaction(me, (tx) =>
      queryRows<{ id: string; device_label: string | null; created_at: unknown; last_success_at: unknown; endpoint: string }>(
        tx,
        'push-devices.own',
        `SELECT id, device_label, created_at, last_success_at, endpoint
           FROM public.push_subscriptions
          WHERE profile_id = $1 AND revoked_at IS NULL
          ORDER BY created_at DESC, id DESC`,
        [me.id],
      ),
    );
    return {
      status: 'ready',
      devices: rows.map((r) => ({
        id: r.id,
        label: r.device_label,
        createdAt: iso(r.created_at) ?? '',
        lastSuccessAt: iso(r.last_success_at),
        endpointHash: pushEndpointHash(r.endpoint),
      })),
    };
  } catch (error) {
    captureError(error, { area: 'push.loadDevices' });
    return { status: 'error' };
  }
}
