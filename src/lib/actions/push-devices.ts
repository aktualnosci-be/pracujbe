'use server';

import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import { z } from 'zod/v3';

import { routing } from '@/i18n/routing';
import { databaseErrorMessage, isDatabaseError, reportUnmappedDbError } from '@/lib/db/errors';
import { getPortalIdentity, isPortalDataConfigured, withPortalTransaction } from '@/lib/db/portal';
import { rpc } from '@/lib/db/sql';
import type { ErrorCode } from '@/lib/errors';
import { captureError } from '@/lib/error-report';
import { checkRateLimit } from '@/lib/rate-limit';
import { isWebPushEnabled } from '@/lib/push/config';
import {
  deviceLabelFromUserAgent,
  isAllowedPushEndpoint,
  PUSH_AUTH_PATTERN,
  PUSH_P256DH_PATTERN,
} from '@/lib/push/endpoint';

/**
 * Server Actions urządzeń Web Push (#724, 0983) — rejestracja bieżącego urządzenia po zgodzie
 * przeglądarki, wycofanie bieżącego i usunięcie dowolnego własnego urządzenia z listy.
 *
 * Kolejność: flaga funkcji (wyłączona = `NOT_FOUND`, bez bazy) → walidacja Zod (endpoint z listy
 * dozwolonych usług push — SSRF, klucze subskrypcji) → tryb demo → sesja i rola kandydata →
 * (rejestracja) limiter per konto → RPC pod sesją. Etykieta urządzenia liczona na serwerze
 * z `User-Agent` (przeglądarka · system), bez zapisu pełnego nagłówka. Decyzja produktowa:
 * portal ogłoszeniowy (#1128) — push obejmuje tylko alerty zapisanych wyszukiwań kandydata.
 */

const endpointSchema = z.string().refine(isAllowedPushEndpoint);
const registerSchema = z
  .object({
    endpoint: endpointSchema,
    keys: z.object({ p256dh: z.string().regex(PUSH_P256DH_PATTERN), auth: z.string().regex(PUSH_AUTH_PATTERN) }).strict(),
  })
  .strict();
const unregisterSchema = z.object({ endpoint: endpointSchema }).strict();
const revokeSchema = z.object({ id: z.string().uuid() }).strict();

export type PushDeviceResult =
  | { ok: true }
  | { ok: false; error: ErrorCode; reason?: 'deviceLimit' };

function mapPgError(message: string): { error: ErrorCode; reason?: 'deviceLimit' } {
  if (message.includes('PUSH_DEVICE_LIMIT')) return { error: 'VALIDATION_FAILED', reason: 'deviceLimit' };
  if (message.includes('VALIDATION_FAILED')) return { error: 'VALIDATION_FAILED' };
  if (message.includes('NOT_FOUND')) return { error: 'NOT_FOUND' };
  if (message.includes('PERMISSION_DENIED') || message.includes('UNAUTHENTICATED') || message.includes('permission denied')) {
    return { error: 'PERMISSION_DENIED' };
  }
  return { error: 'INTERNAL' };
}

function revalidateSettings(): void {
  for (const locale of routing.locales) revalidatePath(`/${locale}/candidate/ustawienia`);
}

async function runAsCandidate(
  area: string,
  action: (me: NonNullable<Awaited<ReturnType<typeof getPortalIdentity>>>) => Promise<PushDeviceResult>,
): Promise<PushDeviceResult> {
  if (!isPortalDataConfigured()) return { ok: false, error: 'DEMO_UNAVAILABLE' };
  try {
    const me = await getPortalIdentity();
    if (!me || me.role !== 'candidate') return { ok: false, error: 'PERMISSION_DENIED' };
    return await action(me);
  } catch (error) {
    if (isDatabaseError(error)) {
      const mapped = mapPgError(databaseErrorMessage(error));
      return { ok: false, ...mapped, error: reportUnmappedDbError(error, area, mapped.error) };
    }
    captureError(error, { area });
    return { ok: false, error: 'INTERNAL' };
  }
}

export async function registerPushDevice(input: unknown): Promise<PushDeviceResult> {
  if (!isWebPushEnabled()) return { ok: false, error: 'NOT_FOUND' };
  const parsed = registerSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'VALIDATION_FAILED' };
  return runAsCandidate('push.register', async (me) => {
    if (!(await checkRateLimit('push-register', { max: 20, windowSeconds: 3600, identifier: me.id, perIp: false }))) {
      return { ok: false, error: 'RATE_LIMITED' };
    }
    const label = deviceLabelFromUserAgent((await headers()).get('user-agent'));
    await withPortalTransaction(me, (tx) =>
      rpc(tx, 'register_push_subscription', {
        p_endpoint: parsed.data.endpoint,
        p_p256dh: parsed.data.keys.p256dh,
        p_auth: parsed.data.keys.auth,
        p_device_label: label,
      }),
    );
    revalidateSettings();
    return { ok: true };
  });
}

export async function unregisterPushDevice(input: unknown): Promise<PushDeviceResult> {
  if (!isWebPushEnabled()) return { ok: false, error: 'NOT_FOUND' };
  const parsed = unregisterSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'VALIDATION_FAILED' };
  return runAsCandidate('push.unregister', async (me) => {
    // Nieznany/cudzy endpoint = sukces bez zmian (bez ujawniania istnienia).
    await withPortalTransaction(me, (tx) => rpc(tx, 'unregister_push_subscription', { p_endpoint: parsed.data.endpoint }));
    revalidateSettings();
    return { ok: true };
  });
}

export async function revokePushDevice(input: unknown): Promise<PushDeviceResult> {
  if (!isWebPushEnabled()) return { ok: false, error: 'NOT_FOUND' };
  const parsed = revokeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'VALIDATION_FAILED' };
  return runAsCandidate('push.revoke', async (me) => {
    await withPortalTransaction(me, (tx) => rpc(tx, 'revoke_push_subscription', { p_id: parsed.data.id }));
    revalidateSettings();
    return { ok: true };
  });
}
