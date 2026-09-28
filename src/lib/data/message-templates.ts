import 'server-only';

import { isLocale } from '@/i18n/routing';
import { getActiveCompany } from '@/lib/company-context';
import { getPortalIdentity, isPortalDataConfigured, withPortalTransaction } from '@/lib/db/portal';
import { queryRows, rpcRows } from '@/lib/db/sql';
import type { TransactionQuery } from '@/lib/db/transaction';
import { captureError } from '@/lib/error-report';
import { canRecruit } from '@/lib/team/permissions';
import type { ComposerTemplates, MessageTemplate, TemplateVariants } from '@/lib/validation/message-template';

/**
 * Szablony odpowiedzi firmy (0170) — odczyt pod sesją/RLS (tylko recruiter+ aktywnej firmy).
 * Strona `/employer/szablony` i kompozytor wiadomości rekrutera.
 */

export type MessageTemplatesLoad =
  | { status: 'ok'; companyId: string; templates: MessageTemplate[] }
  | { status: 'denied' }
  | { status: 'no_company' }
  | { status: 'demo' }
  | { status: 'error' };

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

async function readTemplates(tx: TransactionQuery, companyId: string): Promise<MessageTemplate[]> {
  const rows = await queryRows(tx, 'templates.list',
    `SELECT t.id, t.name, t.updated_at::text AS updated_at,
            coalesce((SELECT jsonb_object_agg(v.locale, v.body)
                        FROM public.company_message_template_variants v
                       WHERE v.template_id = t.id), '{}'::jsonb) AS variants
       FROM public.company_message_templates t
      WHERE t.company_id = $1
      ORDER BY lower(t.name), t.id`, [companyId]);
  return rows.map((row) => {
    const r = row as Record<string, unknown>;
    const raw = typeof r['variants'] === 'object' && r['variants'] !== null
      ? (r['variants'] as Record<string, unknown>) : {};
    const variants: TemplateVariants = {};
    for (const [key, value] of Object.entries(raw)) {
      if (isLocale(key) && typeof value === 'string') variants[key] = value;
    }
    return { id: str(r['id']), name: str(r['name']), updatedAt: str(r['updated_at']), variants };
  });
}

export async function getMessageTemplatesPage(): Promise<MessageTemplatesLoad> {
  if (!isPortalDataConfigured()) return { status: 'demo' };
  try {
    const me = await getPortalIdentity();
    if (!me) return { status: 'no_company' };
    return await withPortalTransaction(me, async (tx): Promise<MessageTemplatesLoad> => {
      const ctx = await getActiveCompany(tx, me.id);
      if (!ctx.activeId) return { status: 'no_company' };
      if (!canRecruit(ctx.activeRole)) return { status: 'denied' };
      return { status: 'ok', companyId: ctx.activeId, templates: await readTemplates(tx, ctx.activeId) };
    });
  } catch (error) {
    captureError(error, { area: 'templates.getMessageTemplatesPage' });
    return { status: 'error' };
  }
}

/**
 * `null` = brak szablonów w tej rozmowie (demo, kandydat, member, rozmowa niefirmowa, awaria —
 * kompozytor działa wtedy jak dotąd). Firma to firma ROZMOWY, nie cookie aktywnej firmy.
 */
export async function getComposerTemplates(conversationId: string): Promise<ComposerTemplates | null> {
  if (!isPortalDataConfigured()) return null;
  try {
    const me = await getPortalIdentity();
    if (!me) return null;
    return await withPortalTransaction(me, async (tx) => {
      const [ctx] = await rpcRows(tx, 'get_conversation_template_context', {
        p_conversation_id: conversationId,
      });
      if (!ctx) return null;
      const companyId = str(ctx['company_id']);
      if (!companyId) return null;
      const locale = str(ctx['candidate_locale']);
      return {
        candidateLocale: isLocale(locale) ? locale : null,
        companyName: str(ctx['company_name']),
        jobTitle: str(ctx['job_title']),
        templates: await readTemplates(tx, companyId),
      };
    });
  } catch (error) {
    captureError(error, { area: 'templates.getComposerTemplates' });
    return null;
  }
}
