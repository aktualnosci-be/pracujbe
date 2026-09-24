/**
 * Warstwa danych panelu administratora dla DSA (#43): kolejka odwołań, raport przejrzystości,
 * eksport decyzji i podgląd retencji.
 *
 * Jak `@/lib/data/admin`: KAŻDA funkcja publiczna sama potwierdza rolę admina (`requireAdmin`)
 * PRZED utworzeniem klienta service-role (RPC raportu/retencji mają EXECUTE tylko dla
 * service_role). Bez konfiguracji Supabase — puste dane trybu DEMO.
 */

import { isAppealRole, isAppealStatus, type AppealRole, type AppealStatus } from '@/lib/admin/appeals';
import { requireAdmin } from '@/lib/data/admin';
import { isSupabaseConfigured } from '@/lib/env';
import { captureError } from '@/lib/sentry';

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}
function asNullableString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}
function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
function asRows(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.map(asRecord) : [];
}

/* ---------------------------------------------------------------------------
 * Kolejka odwołań
 * ------------------------------------------------------------------------- */

export interface AdminAppealRow {
  id: string;
  reference: string;
  status: AppealStatus;
  role: AppealRole;
  submittedAt: string;
  dueAt: string;
  decidedAt: string | null;
  grounds: string | null;
  reasoning: string | null;
  sameReviewer: boolean | null;
  /** Bieżący admin jest autorem decyzji, a jest inny admin — musi rozpatrzyć ktoś inny. */
  reviewerConflict: boolean;
  decision: {
    id: string;
    reference: string;
    decision: string;
    facts: string | null;
    groundType: string | null;
    groundReference: string | null;
    decidedAt: string;
  };
  report: { id: string; caseNumber: string; targetType: string; category: string | null };
}

export type AdminAppealsResult =
  | { status: 'ok'; pending: AdminAppealRow[]; decided: AdminAppealRow[] }
  | { status: 'error' };

const APPEAL_SELECT =
  'id, reference, status, appellant_role, submitted_at, due_at, decided_at, grounds, outcome_reasoning, same_reviewer, ' +
  'decision:moderation_decisions!moderation_appeals_decision_id_fkey(id, reference, decision, facts, ground_type, ground_reference, decided_at, decided_by), ' +
  'report:reports!moderation_appeals_report_id_fkey(id, case_number, target_type, category)';

function mapAppeal(row: Record<string, unknown>, viewerId: string | null, otherAdmins: boolean): AdminAppealRow | null {
  const status = row['status'];
  const role = row['appellant_role'];
  if (!isAppealStatus(status) || !isAppealRole(role)) return null;
  const d = asRecord(row['decision']);
  const r = asRecord(row['report']);
  const decidedBy = asNullableString(d['decided_by']);
  return {
    id: asString(row['id']),
    reference: asString(row['reference']),
    status,
    role,
    submittedAt: asString(row['submitted_at']),
    dueAt: asString(row['due_at']),
    decidedAt: asNullableString(row['decided_at']),
    grounds: asNullableString(row['grounds']),
    reasoning: asNullableString(row['outcome_reasoning']),
    sameReviewer: typeof row['same_reviewer'] === 'boolean' ? row['same_reviewer'] : null,
    reviewerConflict: status === 'pending' && viewerId !== null && decidedBy === viewerId && otherAdmins,
    decision: {
      id: asString(d['id']),
      reference: asString(d['reference']),
      decision: asString(d['decision']),
      facts: asNullableString(d['facts']),
      groundType: asNullableString(d['ground_type']),
      groundReference: asNullableString(d['ground_reference']),
      decidedAt: asString(d['decided_at']),
    },
    report: {
      id: asString(r['id']),
      caseNumber: asString(r['case_number']),
      targetType: asString(r['target_type']),
      category: asNullableString(r['category']),
    },
  };
}

/** Odwołania: oczekujące (wg terminu rozpatrzenia) i 20 ostatnio rozpatrzonych. */
export async function listAppeals(): Promise<AdminAppealsResult> {
  if (!isSupabaseConfigured()) return { status: 'ok', pending: [], decided: [] };
  await requireAdmin();

  try {
    const { createServerClient } = await import('@/lib/supabase/server');
    const session = await createServerClient();
    const {
      data: { user },
    } = await session.auth.getUser();
    const viewerId = user?.id ?? null;

    const { createAdminClient } = await import('@/lib/supabase/admin');
    const supabase = createAdminClient();
    const [pending, decided, admins] = await Promise.all([
      supabase.from('moderation_appeals').select(APPEAL_SELECT).eq('status', 'pending')
        .order('due_at', { ascending: true }).limit(100),
      supabase.from('moderation_appeals').select(APPEAL_SELECT).neq('status', 'pending')
        .order('decided_at', { ascending: false }).limit(20),
      supabase.from('profiles').select('id', { count: 'exact', head: true })
        .eq('role', 'admin').is('deleted_at', null).neq('id', viewerId ?? '00000000-0000-0000-0000-000000000000'),
    ]);
    if (pending.error || decided.error || admins.error) {
      throw pending.error ?? decided.error ?? admins.error;
    }
    const otherAdmins = (admins.count ?? 0) > 0;
    const map = (rows: unknown) =>
      asRows(rows).flatMap((row) => {
        const mapped = mapAppeal(row, viewerId, otherAdmins);
        return mapped ? [mapped] : [];
      });
    return { status: 'ok', pending: map(pending.data), decided: map(decided.data) };
  } catch (error) {
    captureError(error, { area: 'adminDsa.listAppeals' });
    return { status: 'error' };
  }
}

/* ---------------------------------------------------------------------------
 * Raport przejrzystości i eksport
 * ------------------------------------------------------------------------- */

export type CountMap = Record<string, number>;

export interface DsaTransparencyReport {
  period: { from: string; to: string };
  notices: { total: number; byCategory: CountMap; byTargetType: CountMap; pending: number };
  decisions: {
    total: number;
    byDecision: CountMap;
    byGround: CountMap;
    fromAppeal: number;
    automatedDetection: number;
    automatedDecision: number;
    medianHoursToDecision: number | null;
    withinDueDate: number;
  };
  appeals: {
    total: number;
    byAppellant: CountMap;
    byStatus: CountMap;
    reversedDecisions: number;
    medianHoursToDecision: number | null;
    withinDueDate: number;
    sameReviewer: number;
  };
  restorations: { total: number; viaAppeal: number; manual: number };
}

function num(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}
function nullableNum(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
function counts(value: unknown): CountMap {
  return Object.fromEntries(Object.entries(asRecord(value)).map(([k, v]) => [k, num(v)]));
}

/** Parsowanie odpowiedzi `dsa_transparency_report` (czysta funkcja — testowana jednostkowo). */
export function parseTransparencyReport(data: unknown): DsaTransparencyReport | null {
  const r = asRecord(data);
  const period = asRecord(r['period']);
  if (typeof period['from'] !== 'string' || typeof period['to'] !== 'string') return null;
  const n = asRecord(r['notices']);
  const d = asRecord(r['decisions']);
  const a = asRecord(r['appeals']);
  const rs = asRecord(r['restorations']);
  return {
    period: { from: period['from'], to: period['to'] },
    notices: {
      total: num(n['total']),
      byCategory: counts(n['byCategory']),
      byTargetType: counts(n['byTargetType']),
      pending: num(n['pending']),
    },
    decisions: {
      total: num(d['total']),
      byDecision: counts(d['byDecision']),
      byGround: counts(d['byGround']),
      fromAppeal: num(d['fromAppeal']),
      automatedDetection: num(d['automatedDetection']),
      automatedDecision: num(d['automatedDecision']),
      medianHoursToDecision: nullableNum(d['medianHoursToDecision']),
      withinDueDate: num(d['withinDueDate']),
    },
    appeals: {
      total: num(a['total']),
      byAppellant: counts(a['byAppellant']),
      byStatus: counts(a['byStatus']),
      reversedDecisions: num(a['reversedDecisions']),
      medianHoursToDecision: nullableNum(a['medianHoursToDecision']),
      withinDueDate: num(a['withinDueDate']),
      sameReviewer: num(a['sameReviewer']),
    },
    restorations: { total: num(rs['total']), viaAppeal: num(rs['viaAppeal']), manual: num(rs['manual']) },
  };
}

export type DsaReportResult = { status: 'ok'; report: DsaTransparencyReport } | { status: 'error' };

function emptyReport(from: Date, to: Date): DsaTransparencyReport {
  return parseTransparencyReport({ period: { from: from.toISOString(), to: to.toISOString() } })!;
}

export async function getTransparencyReport(from: Date, to: Date): Promise<DsaReportResult> {
  if (!isSupabaseConfigured()) return { status: 'ok', report: emptyReport(from, to) };
  await requireAdmin();
  try {
    const { createAdminClient } = await import('@/lib/supabase/admin');
    const { data, error } = await createAdminClient().rpc('dsa_transparency_report', {
      p_from: from.toISOString(),
      p_to: to.toISOString(),
    });
    if (error) throw error;
    const report = parseTransparencyReport(data);
    if (!report) throw new Error('dsa_transparency_report: nieoczekiwana odpowiedź');
    return { status: 'ok', report };
  } catch (error) {
    captureError(error, { area: 'adminDsa.report' });
    return { status: 'error' };
  }
}

/** Kolumny eksportu decyzji — kolejność = nagłówek CSV. Bez danych osobowych i bez faktów. */
export const DSA_EXPORT_COLUMNS = [
  'decision_reference',
  'decided_at',
  'decision',
  'content_type',
  'notice_category',
  'notice_received_at',
  'ground_type',
  'ground_reference',
  'automated_detection',
  'automated_decision',
  'from_appeal',
  'appeal_status',
  'restored',
] as const;
export type DsaExportRow = Record<(typeof DSA_EXPORT_COLUMNS)[number], string | boolean | null>;

export type DsaExportResult = { status: 'ok'; rows: DsaExportRow[] } | { status: 'error' };

export async function getStatementsExport(from: Date, to: Date): Promise<DsaExportResult> {
  if (!isSupabaseConfigured()) return { status: 'ok', rows: [] };
  await requireAdmin();
  try {
    const { createAdminClient } = await import('@/lib/supabase/admin');
    const { data, error } = await createAdminClient().rpc('dsa_statements_export', {
      p_from: from.toISOString(),
      p_to: to.toISOString(),
    });
    if (error) throw error;
    const rows = asRows(data).map(
      (row) =>
        Object.fromEntries(
          DSA_EXPORT_COLUMNS.map((column) => {
            const value = row[column];
            return [column, typeof value === 'string' || typeof value === 'boolean' ? value : null];
          }),
        ) as DsaExportRow,
    );
    return { status: 'ok', rows };
  } catch (error) {
    captureError(error, { area: 'adminDsa.export' });
    return { status: 'error' };
  }
}

/** CSV (RFC 4180, separator przecinek) — wartości w cudzysłowach; neutralizacja formuł arkusza. */
export function toCsv(rows: DsaExportRow[]): string {
  const cell = (value: string | boolean | null): string => {
    if (value === null) return '';
    let text = String(value);
    if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
    return `"${text.replace(/"/g, '""')}"`;
  };
  const lines = [DSA_EXPORT_COLUMNS.join(',')];
  for (const row of rows) lines.push(DSA_EXPORT_COLUMNS.map((column) => cell(row[column])).join(','));
  return `${lines.join('\r\n')}\r\n`;
}

/* ---------------------------------------------------------------------------
 * Retencja (podgląd — bez zapisu) i ostatnie przebiegi
 * ------------------------------------------------------------------------- */

export interface DsaRetentionOverview {
  appealWindowDays: number;
  retentionDays: number;
  eligibleCases: number;
  eligibleDecisions: number;
  eligibleAppeals: number;
  waitingForAppealPath: number;
  withinRetention: number;
  openCases: number;
  redactedCases: number;
  nextEligibleAt: string | null;
  runs: Array<{ id: string; runAt: string; dryRun: boolean; cases: number }>;
}

export type DsaRetentionResult = { status: 'ok'; overview: DsaRetentionOverview } | { status: 'error' };

export function parseRetentionReport(
  data: unknown,
  runs: DsaRetentionOverview['runs'],
): DsaRetentionOverview {
  const r = asRecord(data);
  const policy = asRecord(r['policy']);
  return {
    appealWindowDays: num(policy['appealWindowDays']),
    retentionDays: num(policy['retentionDays']),
    eligibleCases: num(r['eligibleCases']),
    eligibleDecisions: num(r['eligibleDecisions']),
    eligibleAppeals: num(r['eligibleAppeals']),
    waitingForAppealPath: num(r['waitingForAppealPath']),
    withinRetention: num(r['withinRetention']),
    openCases: num(r['openCases']),
    redactedCases: num(r['redactedCases']),
    nextEligibleAt: asNullableString(r['nextEligibleAt']),
    runs,
  };
}

export async function getRetentionOverview(): Promise<DsaRetentionResult> {
  if (!isSupabaseConfigured()) return { status: 'ok', overview: parseRetentionReport({}, []) };
  await requireAdmin();
  try {
    const { createAdminClient } = await import('@/lib/supabase/admin');
    const supabase = createAdminClient();
    const [report, runs] = await Promise.all([
      supabase.rpc('dsa_retention_report'),
      supabase.from('dsa_retention_runs').select('id, run_at, dry_run, summary')
        .order('run_at', { ascending: false }).limit(10),
    ]);
    if (report.error || runs.error) throw report.error ?? runs.error;
    return {
      status: 'ok',
      overview: parseRetentionReport(
        report.data,
        asRows(runs.data).map((row) => {
          const summary = asRecord(row['summary']);
          return {
            id: asString(row['id']),
            runAt: asString(row['run_at']),
            dryRun: row['dry_run'] === true,
            cases: num(row['dry_run'] === true ? summary['eligibleCases'] : summary['redactedCases']),
          };
        }),
      ),
    };
  } catch (error) {
    captureError(error, { area: 'adminDsa.retention' });
    return { status: 'error' };
  }
}
