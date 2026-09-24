'use client';

import * as React from 'react';
import { Loader2, Search, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { Link, useRouter } from '@/i18n/navigation';
import { Checkbox } from '@/components/ui/checkbox';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import {
  deleteSavedSearchAction,
  setSavedSearchAlertsAction,
  type SavedSearchMutationResult,
} from '@/lib/actions/saved-searches';
import type { SavedSearch, SavedSearchFrequency } from '@/lib/data/saved-searches';
import { toUserMessageKey } from '@/lib/errors';

/**
 * Zarządzanie zapisanymi wyszukiwaniami (#100): otwarcie listy z filtrami, włączenie/wyłączenie
 * alertu, częstotliwość digestu, usunięcie z potwierdzeniem. Zapis przez RPC (własność
 * i walidacja w bazie). Invariant #11: jedna operacja naraz, wynik w regionie `status`/`alert`,
 * po usunięciu fokus wraca do komunikatu (wiersz znika).
 */
export interface SavedSearchListProps {
  searches: Array<SavedSearch & { lastAlertLabel: string | null }>;
}

type Feedback = { tone: 'ok' | 'error'; text: string } | null;

export function SavedSearchList({ searches }: SavedSearchListProps): React.JSX.Element {
  const t = useTranslations('savedSearches');
  const tRoot = useTranslations();
  const router = useRouter();
  const [pendingId, setPendingId] = React.useState<string | null>(null);
  const [feedback, setFeedback] = React.useState<Feedback>(null);
  const [confirm, setConfirm] = React.useState<SavedSearch | null>(null);
  const statusRef = React.useRef<HTMLParagraphElement>(null);

  const run = async (
    id: string,
    action: () => Promise<SavedSearchMutationResult>,
    okText: string,
  ): Promise<boolean> => {
    if (pendingId) return false;
    setPendingId(id);
    setFeedback(null);
    try {
      const res = await action();
      if (res.ok) {
        setFeedback({ tone: 'ok', text: okText });
        router.refresh();
        return true;
      }
      setFeedback({ tone: 'error', text: tRoot(toUserMessageKey(res.error)) });
    } catch {
      setFeedback({ tone: 'error', text: t('errorNetwork') });
    } finally {
      setPendingId(null);
    }
    return false;
  };

  const setAlerts = (search: SavedSearch, enabled: boolean, frequency: SavedSearchFrequency) =>
    run(search.id, () => setSavedSearchAlertsAction(search.id, enabled, frequency), t('updated'));

  return (
    <div className="space-y-4">
      <p
        ref={statusRef}
        tabIndex={-1}
        role={feedback?.tone === 'error' ? 'alert' : 'status'}
        className={feedback?.tone === 'error' ? 'text-sm text-error-text' : 'text-sm text-foreground'}
      >
        {feedback?.text ?? ''}
      </p>
      <ul className="divide-y divide-border overflow-hidden rounded-[1.75rem] border border-border bg-card">
        {searches.map((search) => {
          const busy = pendingId === search.id;
          const alertsId = `ss-alerts-${search.id}`;
          const freqId = `ss-freq-${search.id}`;
          return (
            <li key={search.id} className="space-y-4 p-5 sm:px-7" aria-busy={busy || undefined}>
              <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <h2 className="break-words text-base font-semibold text-foreground">{search.name}</h2>
                  <p className="text-sm text-muted-foreground">
                    {search.lastAlertLabel ? t('lastAlert', { date: search.lastAlertLabel }) : t('noAlertYet')}
                  </p>
                </div>
                <Link
                  href={`/oferty-pracy${search.query}`}
                  className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-xl border border-border px-4 text-sm font-semibold text-foreground hover:bg-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                >
                  <Search className="h-4 w-4" aria-hidden="true" />
                  {t('open')}
                  <span className="sr-only">: {search.name}</span>
                </Link>
              </div>
              <div className="flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-center">
                <div className="flex min-h-11 items-center gap-3">
                  <Checkbox
                    id={alertsId}
                    checked={search.alertsEnabled}
                    disabled={pendingId !== null}
                    onCheckedChange={(value) => void setAlerts(search, value === true, search.frequency)}
                  />
                  <label htmlFor={alertsId} className="text-sm text-foreground">
                    {t('alerts')}
                  </label>
                </div>
                <div className="flex min-h-11 items-center gap-3">
                  <label htmlFor={freqId} className="text-sm text-foreground">
                    {t('frequency')}
                  </label>
                  <select
                    id={freqId}
                    value={search.frequency}
                    disabled={pendingId !== null || !search.alertsEnabled}
                    onChange={(event) =>
                      void setAlerts(search, search.alertsEnabled, event.target.value === 'weekly' ? 'weekly' : 'daily')
                    }
                    className="h-11 rounded-xl border border-input bg-background px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-60"
                  >
                    <option value="daily">{t('daily')}</option>
                    <option value="weekly">{t('weekly')}</option>
                  </select>
                </div>
                <button
                  type="button"
                  onClick={() => setConfirm(search)}
                  disabled={pendingId !== null}
                  className="inline-flex min-h-11 items-center gap-2 rounded-xl px-3 text-sm font-semibold text-error-text hover:bg-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-60 sm:ml-auto"
                >
                  {busy ? (
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  ) : (
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                  )}
                  {t('delete')}
                  <span className="sr-only">: {search.name}</span>
                </button>
              </div>
            </li>
          );
        })}
      </ul>
      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(open) => {
          if (!open) setConfirm(null);
        }}
        title={confirm ? t('deleteTitle', { name: confirm.name }) : ''}
        description={t('deleteDescription')}
        confirmLabel={t('delete')}
        cancelLabel={tRoot('common.cancel')}
        pending={confirm !== null && pendingId === confirm.id}
        getReturnFocus={() => statusRef.current}
        onConfirm={() => {
          const target = confirm;
          if (!target) return;
          void run(target.id, () => deleteSavedSearchAction(target.id), t('deleted')).then(() => setConfirm(null));
        }}
      />
    </div>
  );
}
