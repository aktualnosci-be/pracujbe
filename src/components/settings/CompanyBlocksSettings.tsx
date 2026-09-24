'use client';

import * as React from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { AlertCircle, Ban, CheckCircle2, Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { setCompanyBlockAction } from '@/lib/actions/company-blocks';
import type { CompanyBlock } from '@/lib/data/company-blocks';

/**
 * CompanyBlocksSettings — lista firm zablokowanych przez kandydata z odblokowaniem (#97).
 *
 * Zapis przez `setCompanyBlockAction` (RPC `set_company_block`, pod sesją). Invariant #11:
 * przycisk zablokowany w trakcie zapisu (jedno żądanie naraz), błąd `role="alert"` bez
 * utraty listy, sukces `role="status"`; po odblokowaniu fokus wraca na nagłówek sekcji,
 * bo usunięty wiersz zabiera przycisk, który go miał.
 */
export function CompanyBlocksSettings({ initialBlocks }: { initialBlocks: CompanyBlock[] }): React.JSX.Element {
  const t = useTranslations('companyBlocks');
  const format = useFormatter();
  const [blocks, setBlocks] = React.useState(initialBlocks);
  const [pendingId, setPendingId] = React.useState<string | null>(null);
  const [error, setError] = React.useState(false);
  const [unblocked, setUnblocked] = React.useState<string | null>(null);
  const headingRef = React.useRef<HTMLHeadingElement | null>(null);

  const unblock = async (block: CompanyBlock): Promise<void> => {
    if (pendingId) return;
    setPendingId(block.companyId);
    setError(false);
    setUnblocked(null);
    try {
      const result = await setCompanyBlockAction(block.companyId, false);
      if (!result.ok) {
        setError(true);
        return;
      }
      setBlocks((current) => current.filter((b) => b.companyId !== block.companyId));
      setUnblocked(block.companyName);
      headingRef.current?.focus();
    } catch {
      setError(true);
    } finally {
      setPendingId(null);
    }
  };

  return (
    <section aria-labelledby="company-blocks-title" className="rounded-lg border border-border bg-card p-5 sm:p-6">
      <h2
        id="company-blocks-title"
        ref={headingRef}
        tabIndex={-1}
        className="flex items-center gap-2 text-lg font-semibold text-foreground focus:outline-none"
      >
        <Ban className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
        {t('sectionTitle')}
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">{t('sectionDescription')}</p>

      <div aria-live="polite">
        {error ? (
          <div
            role="alert"
            className="mt-4 flex items-start gap-3 rounded-md border border-error/30 bg-error/10 p-3 text-sm text-error"
          >
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <p>{t('saveError')}</p>
          </div>
        ) : null}
        {unblocked ? (
          <p
            role="status"
            className="mt-4 flex items-start gap-3 rounded-md border border-success/30 bg-success/10 p-3 text-sm text-success-text"
          >
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            {t('unblockedSuccess', { company: unblocked })}
          </p>
        ) : null}
      </div>

      {blocks.length === 0 ? (
        <p className="mt-4 text-sm text-foreground">{t('empty')}</p>
      ) : (
        <ul className="mt-4 divide-y divide-border">
          {blocks.map((block) => {
            const pending = pendingId === block.companyId;
            const date = block.blockedAt ? new Date(block.blockedAt) : null;
            return (
              <li key={block.companyId} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="break-words font-medium text-foreground">{block.companyName}</p>
                  {date && !Number.isNaN(date.getTime()) ? (
                    <p className="text-sm text-muted-foreground">
                      {t('blockedAt', {
                        date: format.dateTime(date, { dateStyle: 'long', timeZone: 'Europe/Brussels' }),
                      })}
                    </p>
                  ) : null}
                </div>
                <Button
                  type="button"
                  variant="outline"
                  aria-label={t('unblockNamed', { company: block.companyName })}
                  aria-busy={pending || undefined}
                  disabled={pendingId !== null}
                  onClick={() => void unblock(block)}
                >
                  {pending ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
                  {pending ? t('unblocking') : t('unblock')}
                </Button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
