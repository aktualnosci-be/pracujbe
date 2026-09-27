import { localeNames } from '@/i18n/routing';
import type { CampaignLocalePreview } from '@/lib/admin/campaign-preview';
import { ROW_META, TAG } from '@/components/admin/admin-styles';

/**
 * Podgląd treści rewizji kampanii w jednym języku (#45) — wspólny dla szczegółu rewizji
 * (`/admin/kampanie/[id]`) i edytora (`EmailCampaignEditor`). Bez hooków: etykiety podaje
 * rodzic (serwer albo klient). Wejście = wynik `campaignPreview` (ta sama walidacja co worker).
 */
export function CampaignPreviewCard({
  entry,
  idPrefix,
  invalidLabel,
  demoLabel,
}: {
  entry: CampaignLocalePreview;
  idPrefix: string;
  invalidLabel: string;
  demoLabel: string;
}): React.JSX.Element {
  const headingId = `${idPrefix}-${entry.locale}`;
  return (
    <section aria-labelledby={headingId} className="min-w-0 rounded-[14px] border border-border p-4">
      <h3 id={headingId} className="text-sm font-semibold text-foreground">
        {localeNames[entry.locale]}
      </h3>
      {entry.status === 'invalid' ? (
        <p className="mt-2 text-sm font-medium text-error-text">{invalidLabel}</p>
      ) : (
        <ul lang={entry.locale} className="mt-2 space-y-2">
          {entry.jobs.map((job, index) => (
            <li key={`${job.slug}-${index}`} className="min-w-0">
              <p className="break-words text-sm font-semibold text-foreground">{job.title}</p>
              <p className={ROW_META}>
                {job.city}
                {job.salary ? ` · ${job.salary}` : ''}
              </p>
              <p className={`${ROW_META} break-all`}>
                {job.slug}
                {job.isDemo ? <span className={`${TAG} ml-2`}>{demoLabel}</span> : null}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
