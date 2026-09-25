/**
 * Panel administratora — kampanie e-mail (#45, `/admin/kampanie`).
 *
 * ⚠️ Odczyt przez `withServiceRole()` (tabele kampanii nie mają grantów dla ról klienta, 0101).
 * Każda funkcja publiczna najpierw potwierdza rolę admina sesji (`requireAdmin` → `notFound()`).
 * Panel pokazuje rewizje, ich treść (dane redakcyjne, nie osobowe) i LICZBY odbiorców według
 * statusu — bez adresów, identyfikatorów profili i treści listów.
 *
 * Lista: stronicowanie kursorem (`created_at`, `id`), filtr statusu, wyszukiwanie po slugu.
 * Bez konfiguracji backendu → dane DEMO.
 */

import { routing } from '@/i18n/routing';
import {
  campaignStatusesFor,
  emptyRecipientStats,
  isCampaignStatus,
  parseCampaignFilter,
  recipientStatsOf,
  type CampaignRecipientStats,
  type CampaignStatus,
} from '@/lib/admin/campaigns';
import {
  ADMIN_PAGE_SIZE,
  decodeAdminCursor,
  encodeAdminCursor,
  matchesSearch,
  normalizeAdminSearch,
  parseUuid,
} from '@/lib/admin/list-params';
import { requireAdmin, type AdminListResult } from '@/lib/data/admin';
import { isPortalDataConfigured, withServiceRole } from '@/lib/db/portal';
import { queryOne, queryRows } from '@/lib/db/sql';
import type { TransactionQuery } from '@/lib/db/transaction';
import { captureError } from '@/lib/sentry';

export interface AdminCampaignRow {
  id: string;
  slug: string;
  revision: number;
  template: string;
  status: CampaignStatus;
  createdAt: string | null;
  activatedAt: string | null;
  closedAt: string | null;
  recipients: CampaignRecipientStats;
}

export interface AdminCampaignRevision {
  id: string;
  revision: number;
  status: CampaignStatus;
  createdAt: string | null;
}

export interface AdminCampaignDetail extends AdminCampaignRow {
  /** Treść rewizji `{ "<język>": { "jobs": [...] } }` — podgląd buduje `campaignPreview`. */
  content: unknown;
  /** Wszystkie rewizje tego sluga (najnowsza pierwsza), łącznie z bieżącą. */
  revisions: AdminCampaignRevision[];
}

export type AdminCampaignDetailResult =
  | { status: 'ok'; campaign: AdminCampaignDetail }
  | { status: 'not_found' }
  | { status: 'error' };

export interface AdminCampaignsQuery {
  status?: string | null;
  q?: string | null;
  cursor?: string | null;
}

/** Limit rewizji jednego sluga w szczególe (starsze niż 50 — w dzienniku zdarzeń). */
export const ADMIN_CAMPAIGN_REVISIONS_LIMIT = 50;

/* ---------------------------------------------------------------------------
 * DEMO
 * ------------------------------------------------------------------------- */

function demoJobs(title: Record<string, string>, city: Record<string, string>) {
  const content: Record<string, unknown> = {};
  for (const locale of routing.locales) {
    content[locale] = {
      jobs: [
        {
          locale,
          slug: `demo-${locale}-magazyn`,
          title: title[locale],
          city: city[locale],
          salary: '2 400 – 2 800 EUR',
          isDemo: true,
        },
      ],
    };
  }
  return content;
}

const DEMO_CONTENT = demoJobs(
  { pl: 'Magazynier', nl: 'Magazijnier', fr: 'Magasinier', en: 'Warehouse worker' },
  { pl: 'Gandawa', nl: 'Gent', fr: 'Gand', en: 'Ghent' },
);

function demoStats(values: Partial<CampaignRecipientStats>): CampaignRecipientStats {
  const stats = { ...emptyRecipientStats(), ...values };
  stats.total =
    stats.reserved + stats.queued + stats.accepted + stats.delivered + stats.skipped_consent +
    stats.failed + stats.cancelled;
  return stats;
}

const DEMO_CAMPAIGNS: AdminCampaignDetail[] = [
  {
    id: 'demo-k3',
    slug: 'newsletter-pazdziernik',
    revision: 1,
    template: 'newsletter',
    status: 'draft',
    createdAt: '2026-09-20T09:00:00.000Z',
    activatedAt: null,
    closedAt: null,
    recipients: demoStats({}),
    content: DEMO_CONTENT,
    revisions: [{ id: 'demo-k3', revision: 1, status: 'draft', createdAt: '2026-09-20T09:00:00.000Z' }],
  },
  {
    id: 'demo-k2',
    slug: 'newsletter-wrzesien',
    revision: 2,
    template: 'newsletter',
    status: 'active',
    createdAt: '2026-09-05T08:00:00.000Z',
    activatedAt: '2026-09-05T08:30:00.000Z',
    closedAt: null,
    recipients: demoStats({ queued: 12, accepted: 30, delivered: 118, skipped_consent: 4, failed: 2 }),
    content: DEMO_CONTENT,
    revisions: [
      { id: 'demo-k2', revision: 2, status: 'active', createdAt: '2026-09-05T08:00:00.000Z' },
      { id: 'demo-k1', revision: 1, status: 'superseded', createdAt: '2026-09-01T08:00:00.000Z' },
    ],
  },
  {
    id: 'demo-k1',
    slug: 'newsletter-wrzesien',
    revision: 1,
    template: 'newsletter',
    status: 'superseded',
    createdAt: '2026-09-01T08:00:00.000Z',
    activatedAt: '2026-09-01T08:15:00.000Z',
    closedAt: '2026-09-05T08:30:00.000Z',
    recipients: demoStats({ delivered: 40, cancelled: 25 }),
    content: DEMO_CONTENT,
    revisions: [
      { id: 'demo-k2', revision: 2, status: 'active', createdAt: '2026-09-05T08:00:00.000Z' },
      { id: 'demo-k1', revision: 1, status: 'superseded', createdAt: '2026-09-01T08:00:00.000Z' },
    ],
  },
];

function toRow(detail: AdminCampaignDetail): AdminCampaignRow {
  const { content: _content, revisions: _revisions, ...row } = detail;
  return row;
}

/* ---------------------------------------------------------------------------
 * Parsowanie wierszy
 * ------------------------------------------------------------------------- */

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function nullableStr(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function int(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isInteger(n) ? n : 0;
}

/** Nieznany status z bazy (nowsza migracja) → wiersz pomijany zamiast zgadywania akcji. */
function statusOf(value: unknown): CampaignStatus | null {
  return isCampaignStatus(value) ? value : null;
}

async function readRecipientStats(
  tx: TransactionQuery,
  ids: string[],
): Promise<Map<string, CampaignRecipientStats>> {
  const byId = new Map<string, Array<{ status: unknown; n: unknown }>>();
  if (ids.length > 0) {
    const rows = await queryRows(
      tx,
      'admin.email-campaign-recipients',
      `SELECT campaign_id, status, count(*)::int AS n
         FROM public.email_campaign_recipients
        WHERE campaign_id = ANY($1::uuid[])
        GROUP BY campaign_id, status`,
      [ids],
    );
    for (const row of rows as Array<Record<string, unknown>>) {
      const id = str(row['campaign_id']);
      const list = byId.get(id) ?? [];
      list.push({ status: row['status'], n: row['n'] });
      byId.set(id, list);
    }
  }
  const out = new Map<string, CampaignRecipientStats>();
  for (const id of ids) out.set(id, recipientStatsOf(byId.get(id) ?? []));
  return out;
}

const CAMPAIGN_COLUMNS = 'id, slug, revision, template, status, created_at, activated_at, closed_at';

function rowOf(
  row: Record<string, unknown>,
  stats: Map<string, CampaignRecipientStats>,
): AdminCampaignRow | null {
  const status = statusOf(row['status']);
  const id = str(row['id']);
  if (!status || !id) return null;
  return {
    id,
    slug: str(row['slug']),
    revision: int(row['revision']),
    template: str(row['template']),
    status,
    createdAt: nullableStr(row['created_at']),
    activatedAt: nullableStr(row['activated_at']),
    closedAt: nullableStr(row['closed_at']),
    recipients: stats.get(id) ?? emptyRecipientStats(),
  };
}

/* ---------------------------------------------------------------------------
 * Publiczne API
 * ------------------------------------------------------------------------- */

/** Lista rewizji kampanii: filtr statusu, wyszukiwanie po slugu, kursor. Bez env → DEMO. */
export async function listEmailCampaigns(
  query: AdminCampaignsQuery = {},
): Promise<AdminListResult<AdminCampaignRow>> {
  const filter = parseCampaignFilter(query.status);
  const statuses = campaignStatusesFor(filter);
  const q = normalizeAdminSearch(query.q);
  if (!isPortalDataConfigured()) {
    return {
      status: 'ok',
      rows: DEMO_CAMPAIGNS.filter(
        (c) => (!statuses || statuses.includes(c.status)) && matchesSearch([c.slug], q),
      ).map(toRow),
      nextCursor: null,
    };
  }
  await requireAdmin();

  try {
    const values: unknown[] = [];
    const add = (value: unknown) => {
      values.push(value);
      return `$${values.length}`;
    };
    const conditions: string[] = [];
    if (statuses) conditions.push(`status = ANY(${add(statuses)}::text[])`);
    if (q) conditions.push(`slug ILIKE ${add(`%${q.replace(/_/g, '\\_')}%`)}`);
    const cursor = decodeAdminCursor(query.cursor);
    if (cursor) {
      conditions.push(`(created_at, id) < (${add(cursor.createdAt)}::timestamptz, ${add(cursor.id)}::uuid)`);
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = add(ADMIN_PAGE_SIZE + 1);

    const { raw, stats } = await withServiceRole(async (tx) => {
      const page = (await queryRows(
        tx,
        'admin.email-campaigns',
        `SELECT ${CAMPAIGN_COLUMNS}
           FROM public.email_campaigns
           ${where}
          ORDER BY created_at DESC, id DESC
          LIMIT ${limit}`,
        values,
      )) as Array<Record<string, unknown>>;
      const ids = page.slice(0, ADMIN_PAGE_SIZE).map((r) => str(r['id'])).filter(Boolean);
      return { raw: page, stats: await readRecipientStats(tx, ids) };
    });

    const rows = raw
      .slice(0, ADMIN_PAGE_SIZE)
      .map((r) => rowOf(r, stats))
      .filter((r): r is AdminCampaignRow => r !== null);
    const last = raw.length > ADMIN_PAGE_SIZE ? raw[ADMIN_PAGE_SIZE - 1] : undefined;
    const lastCreated = last ? nullableStr(last['created_at']) : null;
    const nextCursor =
      last && lastCreated ? encodeAdminCursor({ createdAt: lastCreated, id: str(last['id']) }) : null;
    return { status: 'ok', rows, nextCursor };
  } catch (error) {
    captureError(error, { area: 'admin.listEmailCampaigns' });
    return { status: 'error' };
  }
}

/** Szczegół rewizji: dane, liczby odbiorców, treść do podglądu, rewizje tego sluga. */
export async function getEmailCampaign(id: string): Promise<AdminCampaignDetailResult> {
  if (!isPortalDataConfigured()) {
    const demo = DEMO_CAMPAIGNS.find((c) => c.id === id);
    return demo ? { status: 'ok', campaign: demo } : { status: 'not_found' };
  }
  await requireAdmin();
  const uuid = parseUuid(id);
  if (!uuid) return { status: 'not_found' };

  try {
    const loaded = await withServiceRole(async (tx) => {
      const row = (await queryOne(
        tx,
        'admin.email-campaign',
        `SELECT ${CAMPAIGN_COLUMNS}, content FROM public.email_campaigns WHERE id = $1::uuid`,
        [uuid],
      )) as Record<string, unknown> | null;
      if (!row) return null;
      const revisions = (await queryRows(
        tx,
        'admin.email-campaign-revisions',
        `SELECT id, revision, status, created_at
           FROM public.email_campaigns
          WHERE slug = $1
          ORDER BY revision DESC
          LIMIT $2`,
        [str(row['slug']), ADMIN_CAMPAIGN_REVISIONS_LIMIT],
      )) as Array<Record<string, unknown>>;
      return { row, revisions, stats: await readRecipientStats(tx, [uuid]) };
    });
    if (!loaded) return { status: 'not_found' };
    const base = rowOf(loaded.row, loaded.stats);
    if (!base) return { status: 'error' };
    return {
      status: 'ok',
      campaign: {
        ...base,
        content: loaded.row['content'],
        revisions: loaded.revisions.flatMap((r) => {
          const status = statusOf(r['status']);
          const revId = str(r['id']);
          return status && revId
            ? [{ id: revId, revision: int(r['revision']), status, createdAt: nullableStr(r['created_at']) }]
            : [];
        }),
      },
    };
  } catch (error) {
    captureError(error, { area: 'admin.getEmailCampaign' });
    return { status: 'error' };
  }
}
