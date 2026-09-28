'use client';

import * as React from 'react';

import { JobWizard } from '@/components/employer/JobWizard';
import { JobImportPanel, type JobImportSuccess } from '@/components/employer/JobImportPanel';

/**
 * Nowa oferta: kreator + opcjonalny krok importu z ogłoszenia (#465). Po udanym imporcie
 * kreator jest montowany od nowa (klucz) z wartościami z importu i — gdy serwer zapisał
 * szkic — z jego identyfikatorem, więc kolejne kroki zapisują się do tego samego szkicu.
 * Bez flagi importu komponent renderuje zwykły kreator.
 *
 * `companyId` = aktywna firma, dla której strona wyrenderowała kreator. Szkic i import idą
 * wyłącznie do niej (serwer odrzuca inną aktywną firmę — EMP-02), a komponent montuje
 * kreator z kluczem = firma, więc po przełączeniu firmy w pasku bocznym kreator startuje
 * od nowa bez szkicu poprzedniej firmy (CC25-02).
 */
export interface NewJobWizardProps {
  importEnabled: boolean;
  /** #37: asystent redagowania treści na krokach 5–6. */
  assistEnabled?: boolean;
  companyId: string | null;
}

export function NewJobWizard(props: NewJobWizardProps): React.JSX.Element {
  // Klucz = firma: identyfikator szkicu (stan JobWizard) i wynik importu (tu) należą do firmy,
  // dla której je utworzono — po przełączeniu firmy nie mogą przejść do kreatora nowej.
  return <NewJobWizardForCompany key={props.companyId ?? 'none'} {...props} />;
}

function NewJobWizardForCompany({
  importEnabled,
  assistEnabled = false,
  companyId,
}: NewJobWizardProps): React.JSX.Element {
  const [imported, setImported] = React.useState<{ result: JobImportSuccess; key: number } | null>(null);

  if (!importEnabled) return <JobWizard assistEnabled={assistEnabled} companyId={companyId} />;

  const result = imported?.result ?? null;
  return (
    <JobWizard
      key={imported?.key ?? 0}
      assistEnabled={assistEnabled}
      companyId={companyId}
      initialJobId={result?.jobId ?? undefined}
      initialValues={result?.values}
      importReview={result ? { fields: result.review, suspicious: result.suspicious } : undefined}
      importSlot={
        <JobImportPanel
          result={result}
          companyId={companyId}
          onImported={(r) => setImported((prev) => ({ result: r, key: (prev?.key ?? 0) + 1 }))}
        />
      }
    />
  );
}
