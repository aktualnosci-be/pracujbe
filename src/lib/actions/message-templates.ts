'use server';

import { z } from 'zod';

import { getExpectedActiveCompany } from '@/lib/company-context';
import { databaseErrorMessage, isDatabaseError, reportUnmappedDbError } from '@/lib/db/errors';
import { getPortalIdentity, isPortalDataConfigured, withPortalTransaction } from '@/lib/db/portal';
import { jsonArg, rpc } from '@/lib/db/sql';
import type { ErrorCode } from '@/lib/errors';
import { captureError } from '@/lib/error-report';
import { checkRateLimit } from '@/lib/rate-limit';
import {
  findSensitiveVariant,
  messageTemplateSchema,
  nonEmptyVariants,
  type MessageTemplateInput,
} from '@/lib/validation/message-template';

/**
 * Server Actions szablonów odpowiedzi firmy (0170). Firma = firma WIDOKU (`expectedCompanyId`),
 * sprawdzana względem bieżącej aktywnej firmy (ACTIVE_COMPANY_CHANGED — nic nie zapisujemy).
 * Uprawnienie recruiter+, limit 50 szablonów i CAS po `updated_at` egzekwuje baza.
 */

export type TemplateError = ErrorCode | 'TEMPLATE_LIMIT';

export type TemplateActionResult =
  | { ok: true; id?: string }
  | { ok: false; error: TemplateError; reason?: 'sensitiveId' };

function mapTemplateError(message: string): TemplateError {
  if (message.includes('TEMPLATE_LIMIT')) return 'TEMPLATE_LIMIT';
  if (message.includes('STALE_STATE')) return 'STALE_STATE';
  if (message.includes('NOT_FOUND')) return 'NOT_FOUND';
  if (message.includes('VALIDATION_FAILED')) return 'VALIDATION_FAILED';
  if (message.includes('PERMISSION_DENIED') || message.includes('UNAUTHENTICATED')) return 'PERMISSION_DENIED';
  return 'INTERNAL';
}

async function limited(userId: string): Promise<boolean> {
  return checkRateLimit('message-template', { max: 60, windowSeconds: 3600, identifier: userId, perIp: false });
}

export async function saveMessageTemplate(
  input: MessageTemplateInput,
  expectedCompanyId: string,
): Promise<TemplateActionResult> {
  const parsed = messageTemplateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'VALIDATION_FAILED' };
  // #495: numer rejestru narodowego/dokumentu nie trafia do szablonu (jak do wiadomości).
  if (findSensitiveVariant(parsed.data.variants)) {
    return { ok: false, error: 'VALIDATION_FAILED', reason: 'sensitiveId' };
  }
  if (!isPortalDataConfigured()) return { ok: false, error: 'DEMO_UNAVAILABLE' };
  try {
    const me = await getPortalIdentity();
    if (!me) return { ok: false, error: 'PERMISSION_DENIED' };
    if (!(await limited(me.id))) return { ok: false, error: 'RATE_LIMITED' };
    const saved = await withPortalTransaction(
      me,
      async (tx): Promise<{ ok: false; error: TemplateError } | { ok: true; id: string }> => {
        const expected = await getExpectedActiveCompany(tx, me.id, expectedCompanyId);
        if (!expected.ok) return { ok: false, error: expected.error };
        const id = await rpc<string>(tx, 'save_company_message_template', {
          p_company_id: expected.context.activeId,
          p_template_id: parsed.data.id,
          p_name: parsed.data.name,
          p_variants: jsonArg(nonEmptyVariants(parsed.data.variants)),
          p_expected_updated_at: parsed.data.expectedUpdatedAt,
        });
        return { ok: true, id: String(id) };
      },
    );
    return saved;
  } catch (error) {
    if (isDatabaseError(error)) {
      return { ok: false, error: reportUnmappedDbError(error, 'templates.save', mapTemplateError(databaseErrorMessage(error))) };
    }
    captureError(error, { area: 'templates.save' });
    return { ok: false, error: 'INTERNAL' };
  }
}

export async function deleteMessageTemplate(
  templateId: string,
  expectedCompanyId: string,
): Promise<TemplateActionResult> {
  if (!z.string().uuid().safeParse(templateId).success) return { ok: false, error: 'VALIDATION_FAILED' };
  if (!isPortalDataConfigured()) return { ok: false, error: 'DEMO_UNAVAILABLE' };
  try {
    const me = await getPortalIdentity();
    if (!me) return { ok: false, error: 'PERMISSION_DENIED' };
    if (!(await limited(me.id))) return { ok: false, error: 'RATE_LIMITED' };
    return await withPortalTransaction(me, async (tx): Promise<TemplateActionResult> => {
      const expected = await getExpectedActiveCompany(tx, me.id, expectedCompanyId);
      if (!expected.ok) return { ok: false, error: expected.error };
      await rpc(tx, 'delete_company_message_template', {
        p_company_id: expected.context.activeId,
        p_template_id: templateId,
      });
      return { ok: true };
    });
  } catch (error) {
    if (isDatabaseError(error)) {
      return { ok: false, error: reportUnmappedDbError(error, 'templates.delete', mapTemplateError(databaseErrorMessage(error))) };
    }
    captureError(error, { area: 'templates.delete' });
    return { ok: false, error: 'INTERNAL' };
  }
}
