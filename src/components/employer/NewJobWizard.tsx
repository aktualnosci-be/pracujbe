'use client';

import * as React from 'react';

import { JobWizard } from '@/components/employer/JobWizard';
import { JobImportPanel, type JobImportSuccess } from '@/components/employer/JobImportPanel';

/**
 * Nowa oferta: kreator + opcjonalny krok importu z ogłoszenia (#465). Po udanym imporcie
 * kreator jest montowany od nowa (klucz) z wartościami z importu i — gdy serwer zapisał
 * szkic — z jego identyfikatorem, więc kolejne kroki zapisują się do tego samego szkicu.
 * Bez flagi importu komponent renderuje zwykły kreator.
 */
export function NewJobWizard({ importEnabled }: { importEnabled: boolean }): React.JSX.Element {
  const [imported, setImported] = React.useState<{ result: JobImportSuccess; key: number } | null>(null);

  if (!importEnabled) return <JobWizard />;

  const result = imported?.result ?? null;
  return (
    <JobWizard
      key={imported?.key ?? 0}
      initialJobId={result?.jobId ?? undefined}
      initialValues={result?.values}
      importReview={result ? { fields: result.review, suspicious: result.suspicious } : undefined}
      importSlot={
        <JobImportPanel
          result={result}
          onImported={(r) => setImported((prev) => ({ result: r, key: (prev?.key ?? 0) + 1 }))}
        />
      }
    />
  );
}
