'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { AlertCircle, Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Link } from '@/i18n/navigation';
import { getJobCompanyBlockAction, setCompanyBlockAction } from '@/lib/actions/company-blocks';
import type { JobCompanyBlockLoad } from '@/lib/data/company-blocks';

/**
 * JobCompanyBlockControl — blokada / odblokowanie firmy z publicznego szczegółu oferty (#97).
 *
 * Wyspa kliencka dohydrowana PO montażu (jak `JobMatchCard`): HTML strony jest identyczny dla
 * gości i robotów. Stan czytany pod sesją (`get_job_company_block`) — dla gościa, pracodawcy
 * i błędu odczytu nic nie renderujemy (kontrolka jest opcjonalna, nie blokuje aplikowania).
 * Publiczny URL oferty zablokowanej firmy pozostaje dostępny, a tu kandydat może ją odblokować.
 */
export function JobCompanyBlockControl({ jobId }: { jobId: string }): React.JSX.Element | null {
  const t = useTranslations('companyBlocks');
  const [load, setLoad] = React.useState<JobCompanyBlockLoad | null>(null);
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState(false);
  const [changed, setChanged] = React.useState(false);

  React.useEffect(() => {
    let active = true;
    getJobCompanyBlockAction(jobId)
      .then((r) => {
        if (active) setLoad(r);
      })
      .catch(() => {
        if (active) setLoad({ status: 'error' });
      });
    return () => {
      active = false;
    };
  }, [jobId]);

  if (!load || load.status !== 'ready') return null;

  const toggle = async (): Promise<void> => {
    if (pending) return;
    setPending(true);
    setError(false);
    setChanged(false);
    try {
      const result = await setCompanyBlockAction(load.companyId, !load.blocked);
      if (!result.ok) {
        setError(true);
        return;
      }
      setLoad({ ...load, blocked: result.blocked });
      setChanged(true);
    } catch {
      setError(true);
    } finally {
      setPending(false);
    }
  };

  const company = load.companyName;
  const statusText = load.blocked ? t('blockedSuccess', { company }) : t('unblockedSuccess', { company });

  return (
    <div data-testid="job-company-block" className="mt-4 border-t border-border pt-4">
      <h3 className="text-sm font-semibold text-foreground">{t('jobTitle')}</h3>
      <p className="mt-1 text-sm text-muted-foreground">
        {load.blocked ? t('jobBlockedDescription', { company }) : t('jobDescription', { company })}
      </p>
      <div aria-live="polite">
        {error ? (
          <p role="alert" className="mt-2 flex items-start gap-2 text-sm text-error">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            {t('saveError')}
          </p>
        ) : null}
        {changed ? (
          <p role="status" className="mt-2 text-sm text-success-text">
            {statusText}
          </p>
        ) : null}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Button type="button" variant="outline" aria-busy={pending || undefined} disabled={pending} onClick={() => void toggle()}>
          {pending ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
          {pending ? (load.blocked ? t('unblocking') : t('blocking')) : load.blocked ? t('unblock') : t('block')}
        </Button>
        <Link
          href="/candidate/ustawienia#company-blocks-title"
          className="text-sm font-medium text-accent-dark underline-offset-4 hover:underline"
        >
          {t('manage')}
        </Link>
      </div>
    </div>
  );
}
