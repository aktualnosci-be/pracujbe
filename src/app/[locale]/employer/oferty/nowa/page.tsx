import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { NewJobWizard } from '@/components/employer/NewJobWizard';
import { CompanyStatusBanner } from '@/components/employer/CompanyStatusBanner';
import { getEmployerShellData } from '@/lib/data/employer';
import { isJobImportEnabled } from '@/lib/ai-import/config';
import { isJobAssistEnabled } from '@/lib/ai-assist/config';

/**
 * Kreator oferty pracy — nowa oferta (Etap 5, makieta panelu pracodawcy).
 *
 * Cienki wrapper serwerowy: ustawia locale, metadane (NOINDEX — panel/kreator) i renderuje
 * kliencki `JobWizard`. Niezweryfikowana firma widzi nad kreatorem, że może przygotować szkic,
 * a publikacja będzie możliwa po weryfikacji (#399) — zanim przejdzie 9 kroków. Guard sesji + aktywnego członkostwa w firmie dziedziczony jest z
 * layoutu `employer/*` (redirect do logowania / rejestracji firmy). `force-dynamic`, bo
 * kreator działa pod sesją i zapisuje szkic przez Server Actions.
 */

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'jobWizard' });
  return {
    title: t('title'),
    robots: { index: false, follow: false },
  };
}

export default async function NewJobPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

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
      {/* #465: krok importu z ogłoszenia tylko przy włączonej fladze i skonfigurowanym dostawcy;
          #37: asystent redagowania treści — ta sama zasada (osobna flaga). */}
      <NewJobWizard importEnabled={isJobImportEnabled()} assistEnabled={isJobAssistEnabled()} />
    </>
  );
}
