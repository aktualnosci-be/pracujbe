import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { Link } from '@/i18n/navigation';
import { Button } from '@/components/ui/button';
import { JobWizard } from '@/components/employer/JobWizard';
import { CompanyStatusBanner } from '@/components/employer/CompanyStatusBanner';
import { getEmployerShellData, getJobDraft } from '@/lib/data/employer';

/**
 * Wznowienie / edycja SZKICU oferty (P1-04) — `/employer/oferty/[id]/edycja`.
 *
 * Dotąd istniała wyłącznie trasa tworzenia, a `jobId` żył w stanie klienta: „Zapisz i wyjdź"
 * zostawiało osierocony szkic, którego nie dało się otworzyć. Tutaj wczytujemy szkic POD SESJĄ
 * (RLS: tylko oferta własnej firmy) i montujemy kreator z zapisanymi wartościami oraz `jobId`,
 * więc kolejne kroki dopisują się do tego samego rekordu.
 *
 * Stany: brak/obca oferta → 404; oferta NIE-szkic → komunikat + powrót do listy (treść
 * opublikowanej oferty zmienia się przez cykl życia: wstrzymaj/zamknij, a nie kreator);
 * błąd odczytu → 404-owy fallback nie jest właściwy, więc pokazujemy stan błędu z retry
 * (NIGDY pustego kreatora — zapis relacji jest replace-all i wyczyściłby dane; por. P1-07/P1-08).
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

export default async function EditJobDraftPage({
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
      <div className="mx-auto max-w-md space-y-4 py-16 text-center">
        <h1 className="text-lg font-semibold text-foreground">{to('loadError')}</h1>
        <p className="text-sm text-muted-foreground">{to('loadErrorHint')}</p>
        <Button asChild variant="outline">
          <Link href="/employer/oferty">{td('navOffers')}</Link>
        </Button>
      </div>
    );
  }

  if (draft.status === 'not-draft') {
    return (
      <div className="mx-auto max-w-md space-y-4 py-16 text-center">
        <h1 className="text-lg font-semibold text-foreground">{td('jobNotDraftTitle')}</h1>
        <p className="text-sm text-muted-foreground">{td('jobNotDraftHint')}</p>
        <Button asChild variant="outline">
          <Link href="/employer/oferty">{td('navOffers')}</Link>
        </Button>
      </div>
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
      <JobWizard initialJobId={draft.jobId} initialValues={draft.values} />
    </>
  );
}
