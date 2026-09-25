import { cn } from '@/lib/utils';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { Link } from '@/i18n/navigation';
import { Button } from '@/components/ui/button';
import { JobWizard } from '@/components/employer/JobWizard';
import { CompanyStatusBanner } from '@/components/employer/CompanyStatusBanner';
import {
  BTN_RESET,
  BTN_SECONDARY,
  H2_EXTENDED,
  P_EXTENDED,
  PAPER,
} from '@/components/dashboard/panel-styles';
import { getEmployerShellData, getJobDraft } from '@/lib/data/employer';
import { isJobAssistEnabled } from '@/lib/ai-assist/config';

/**
 * Wznowienie SZKICU albo poprawka OPUBLIKOWANEJ oferty — `/employer/oferty/[id]/edycja`.
 *
 * P1-04: wczytujemy ofertę POD SESJĄ (RLS: tylko oferta własnej firmy) i montujemy kreator
 * z zapisanymi wartościami oraz `jobId`, więc kolejne kroki dopisują się do tego samego rekordu.
 *
 * #325: oferta aktywna/wstrzymana otwiera kreator w trybie edycji — zmiany zapisują się dopiero
 * przyciskiem „Zapisz zmiany", wszystkie naraz (RPC `update_published_job`), bez zmiany statusu
 * i zgłoszeń. Zamknięta/wygasła → komunikat (najpierw „Otwórz ponownie" z listy ofert).
 *
 * Stany: brak/obca oferta → 404; błąd odczytu → stan błędu z retry (NIGDY pustego kreatora —
 * zapis relacji jest replace-all i wyczyściłby dane; por. P1-07/P1-08).
 *
 * Guard sesji + aktywnego członkostwa dziedziczony z layoutu `employer/*`. NOINDEX, force-dynamic.
 */

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'jobWizard' });
  return { title: t('title'), robots: { index: false, follow: false } };
}

export default async function EditJobPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);

  const td = await getTranslations('dashboard');
  const to = await getTranslations('onboarding');
  const draft = await getJobDraft(id);

  if (draft.status === 'not-found') notFound();

  if (draft.status === 'error') {
    return (
      <div className={cn(PAPER, 'mx-auto max-w-md space-y-4 text-center')}>
        <h1 className={H2_EXTENDED}>{to('loadError')}</h1>
        <p className={P_EXTENDED}>{to('loadErrorHint')}</p>
        <Button asChild variant="outline" className={`${BTN_SECONDARY} ${BTN_RESET}`}>
          <Link href="/employer/oferty">{td('navOffers')}</Link>
        </Button>
      </div>
    );
  }

  if (draft.status === 'not-editable') {
    return (
      <div className={cn(PAPER, 'mx-auto max-w-md space-y-4 text-center')}>
        <h1 className={H2_EXTENDED}>{td('jobNotEditableTitle')}</h1>
        <p className={P_EXTENDED}>{td('jobNotEditableHint')}</p>
        <Button asChild variant="outline" className={`${BTN_SECONDARY} ${BTN_RESET}`}>
          <Link href="/employer/oferty">{td('navOffers')}</Link>
        </Button>
      </div>
    );
  }

  if (draft.jobStatus !== 'draft') {
    return (
      <JobWizard
        initialJobId={draft.jobId}
        initialValues={draft.values}
        published={{ status: draft.jobStatus, slug: draft.slug, updatedAt: draft.updatedAt }}
        contentLocale={draft.contentLocale}
        assistEnabled={isJobAssistEnabled()}
      />
    );
  }

  // #399: przy niezweryfikowanej firmie — szkic tak, publikacja po weryfikacji.
  const shell = await getEmployerShellData();
  return (
    <>
      {shell.status === 'ok' ? (
        <CompanyStatusBanner
          status={shell.activeStatus}
          variant="wizard"
          className="mx-auto mb-5 max-w-5xl"
        />
      ) : null}
      <JobWizard
        initialJobId={draft.jobId}
        initialValues={draft.values}
        contentLocale={draft.contentLocale}
        assistEnabled={isJobAssistEnabled()}
      />
    </>
  );
}
