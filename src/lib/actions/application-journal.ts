'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod/v3';

import { routing } from '@/i18n/routing';
import { databaseErrorMessage, isDatabaseError, reportUnmappedDbError } from '@/lib/db/errors';
import { getPortalIdentity, isPortalDataConfigured, withPortalTransaction } from '@/lib/db/portal';
import { rpc } from '@/lib/db/sql';
import type { ErrorCode } from '@/lib/errors';
import { captureError } from '@/lib/error-report';
import { containsPersonalIdentifier } from '@/lib/privacy/sensitive-data';
import { journalEntrySchema, journalFieldNames, type JournalFieldName } from '@/lib/validation/application-journal';

/**
 * Server Actions dziennika aplikacji (#904, 0196) — cienka warstwa nad RPC
 * `save_application_journal_entry` / `delete_application_journal_entry` (pod sesją kandydata,
 * własność i limit 200 w bazie). Dziennik działa w obu trybach portalu: to prywatna notatka,
 * niczego nie wysyła do firm i nie tworzy zgłoszenia w procesie rekrutacyjnym.
 */

const saveSchema = journalEntrySchema.extend({
  clientKey: z.string().uuid(),
  entryId: z.string().uuid().optional(),
});
const idSchema = z.string().uuid();

export type JournalSaveResult =
  | { ok: true; id: string }
  | { ok: false; error: ErrorCode | 'UNAUTHENTICATED'; field?: JournalFieldName };
export type JournalDeleteResult = { ok: true } | { ok: false; error: ErrorCode };

function mapPgError(message: string | undefined): ErrorCode {
  const m = message ?? '';
  if (m.includes('JOURNAL_LIMIT_REACHED')) return 'JOURNAL_LIMIT_REACHED';
  if (m.includes('NOT_FOUND')) return 'NOT_FOUND';
  if (m.includes('VALIDATION_FAILED')) return 'VALIDATION_FAILED';
  if (m.includes('PERMISSION_DENIED') || m.includes('UNAUTHENTICATED') || m.includes('permission denied')) {
    return 'PERMISSION_DENIED';
  }
  return 'INTERNAL';
}

function revalidateJournal(): void {
  for (const locale of routing.locales) revalidatePath(`/${locale}/candidate/dziennik`);
}

/** Nowy wpis (`entryId` brak) albo edycja własnego. Ten sam `clientKey` = ten sam wpis. */
export async function saveJournalEntryAction(input: unknown): Promise<JournalSaveResult> {
  const parsed = saveSchema.safeParse(input);
  if (!parsed.success) {
    const first = parsed.error.issues[0]?.path[0];
    const field = (journalFieldNames as readonly unknown[]).includes(first) ? (first as JournalFieldName) : undefined;
    return { ok: false, error: 'VALIDATION_FAILED', ...(field ? { field } : {}) };
  }
  const v = parsed.data;
  if (containsPersonalIdentifier(v.note) || containsPersonalIdentifier(v.jobTitle) || containsPersonalIdentifier(v.location)) {
    return { ok: false, error: 'VALIDATION_FAILED', field: 'note' };
  }
  if (!isPortalDataConfigured()) return { ok: false, error: 'DEMO_UNAVAILABLE' };

  try {
    const me = await getPortalIdentity();
    if (!me) return { ok: false, error: 'UNAUTHENTICATED' };
    const id = await withPortalTransaction(me, (tx) =>
      rpc<string>(tx, 'save_application_journal_entry', {
        p_client_key: v.clientKey,
        p_entry_id: v.entryId,
        p_job_title: v.jobTitle,
        p_company_name: v.companyName,
        p_source_url: v.sourceUrl,
        p_location: v.location,
        p_applied_on: v.appliedOn,
        p_stage: v.stage,
        p_note: v.note,
        p_remind_on: v.remindOn,
      }),
    );
    const value = typeof id === 'string' ? id : id && typeof id === 'object' ? Object.values(id as Record<string, unknown>)[0] : null;
    if (typeof value !== 'string') return { ok: false, error: 'INTERNAL' };
    revalidateJournal();
    return { ok: true, id: value };
  } catch (error) {
    if (isDatabaseError(error)) {
      const message = databaseErrorMessage(error);
      if (message.startsWith('UNAUTHENTICATED')) return { ok: false, error: 'UNAUTHENTICATED' };
      return { ok: false, error: reportUnmappedDbError(error, 'application-journal.save', mapPgError(message)) };
    }
    captureError(error, { area: 'application-journal.save' });
    return { ok: false, error: 'INTERNAL' };
  }
}

/** Usunięcie własnego wpisu. Cudzy/nieistniejący → NOT_FOUND z bazy. */
export async function deleteJournalEntryAction(id: unknown): Promise<JournalDeleteResult> {
  const parsedId = idSchema.safeParse(id);
  if (!parsedId.success) return { ok: false, error: 'VALIDATION_FAILED' };
  if (!isPortalDataConfigured()) return { ok: false, error: 'DEMO_UNAVAILABLE' };

  try {
    const me = await getPortalIdentity();
    if (!me) return { ok: false, error: 'PERMISSION_DENIED' };
    await withPortalTransaction(me, (tx) =>
      rpc(tx, 'delete_application_journal_entry', { p_entry_id: parsedId.data }),
    );
    revalidateJournal();
    return { ok: true };
  } catch (error) {
    if (isDatabaseError(error)) {
      return { ok: false, error: reportUnmappedDbError(error, 'application-journal.delete', mapPgError(databaseErrorMessage(error))) };
    }
    captureError(error, { area: 'application-journal.delete' });
    return { ok: false, error: 'INTERNAL' };
  }
}
