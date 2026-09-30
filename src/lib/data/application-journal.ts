/**
 * Dziennik aplikacji kandydata (#904, 0196) — odczyt POD SESJĄ (`withPortalTransaction`, RLS
 * `candidate_application_journal_select_own`; nigdy service-role). To prywatne notatki kandydata
 * o aplikacjach składanych poza portalem — nie mają związku z ofertą ani procesem w portalu.
 * Błąd odczytu = jawny `error`; tryb demo: pusta lista z `demo: true`.
 */

import { getPortalIdentity, isPortalDataConfigured, withPortalTransaction } from '@/lib/db/portal';
import { queryRows } from '@/lib/db/sql';
import { captureError } from '@/lib/error-report';
import { JOURNAL_STAGES, type JournalStage } from '@/lib/validation/application-journal';

export interface JournalEntry {
  id: string;
  jobTitle: string;
  companyName: string;
  sourceUrl: string | null;
  location: string | null;
  /** `RRRR-MM-DD` (data bez strefy). */
  appliedOn: string | null;
  stage: JournalStage;
  note: string | null;
  remindOn: string | null;
  /** Przypomnienie na dziś albo wcześniej (dzień w Europe/Brussels liczy baza). */
  remindDue: boolean;
}

export type JournalLoad =
  | { status: 'ready'; entries: JournalEntry[]; demo: boolean }
  | { status: 'error' };

function str(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/** Adres z bazy linkujemy wyłącznie jako https (druga kontrola po CHECK-u w bazie). */
function safeHttps(value: unknown): string | null {
  const v = str(value);
  return v && /^https:\/\//i.test(v) ? v : null;
}

export function mapJournalRow(row: unknown): JournalEntry | null {
  const r = typeof row === 'object' && row !== null ? (row as Record<string, unknown>) : {};
  const id = str(r['id']);
  const jobTitle = str(r['job_title']);
  const companyName = str(r['company_name']);
  if (!id || !jobTitle || !companyName) return null;
  const stage = (JOURNAL_STAGES as readonly string[]).includes(String(r['stage'])) ? (r['stage'] as JournalStage) : 'sent';
  return {
    id,
    jobTitle,
    companyName,
    sourceUrl: safeHttps(r['source_url']),
    location: str(r['location']),
    appliedOn: str(r['applied_on']),
    stage,
    note: str(r['note']),
    remindOn: str(r['remind_on']),
    remindDue: r['remind_due'] === true,
  };
}

export async function loadMyJournal(): Promise<JournalLoad> {
  if (!isPortalDataConfigured()) return { status: 'ready', entries: [], demo: true };

  try {
    const me = await getPortalIdentity();
    // Bez sesji RLS i tak nie zwróci wierszy — nie pytamy bazy.
    if (!me) return { status: 'ready', entries: [], demo: false };
    const rows = await withPortalTransaction(me, (tx) =>
      queryRows(tx, 'application-journal.mine',
        `SELECT id, job_title, company_name, source_url, location,
                to_char(applied_on, 'YYYY-MM-DD') AS applied_on, stage, note,
                to_char(remind_on, 'YYYY-MM-DD') AS remind_on,
                COALESCE(remind_on <= (now() AT TIME ZONE 'Europe/Brussels')::date
                         AND stage NOT IN ('closed', 'offer'), false) AS remind_due
           FROM public.candidate_application_journal
          WHERE profile_id = $1
          ORDER BY COALESCE(applied_on, created_at::date) DESC, created_at DESC, id DESC
          LIMIT 200`, [me.id]),
    );
    const entries = rows.map(mapJournalRow).filter((e): e is JournalEntry => e !== null);
    return { status: 'ready', entries, demo: false };
  } catch (error) {
    captureError(error, { area: 'application-journal.load' });
    return { status: 'error' };
  }
}
