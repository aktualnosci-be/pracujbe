'use client';

import * as React from 'react';
import { Copy } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { useRouter } from '@/i18n/navigation';
import { duplicateJobAsDraft } from '@/lib/actions/jobs';
import { toUserMessageKey, type ErrorCode } from '@/lib/errors';
import { Button } from '@/components/ui/button';
import { Toast } from '@/components/ui/toast';
import { BTN_SMALL } from '@/components/dashboard/panel-styles';
import { cn } from '@/lib/utils';

/**
 * „Kopiuj jako szkic” (0216) — nowy szkic w tej samej firmie z treścią oferty w dowolnym
 * statusie, potem przejście do kreatora nowego szkicu.
 *
 * Idempotencja (Invariant #11): jeden klucz (UUID) na operację trzymany w `useRef` — podwójne
 * kliknięcie albo ponowienie po błędzie sieci trafia do bazy z TYM SAMYM kluczem i zwraca ten
 * sam szkic. Klucz jest wymieniany dopiero po sukcesie. Przycisk zablokowany w trakcie zapisu.
 */

const TOAST_MS = 5000;

export interface DuplicateJobButtonProps {
  jobId: string;
  title: string;
}

function newKey(): string {
  return crypto.randomUUID();
}

export function DuplicateJobButton({ jobId, title }: DuplicateJobButtonProps): React.JSX.Element {
  const t = useTranslations('dashboard');
  const tRoot = useTranslations();
  const router = useRouter();
  const keyRef = React.useRef<string | null>(null);
  const [pending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!error) return;
    const timer = window.setTimeout(() => setError(null), TOAST_MS);
    return () => window.clearTimeout(timer);
  }, [error]);

  const run = () => {
    if (pending) return;
    keyRef.current ??= newKey();
    const key = keyRef.current;
    startTransition(async () => {
      try {
        const res = await duplicateJobAsDraft(jobId, key);
        if (!res.ok) {
          const code = res.error as ErrorCode;
          setError(
            code === 'MODERATION_LOCKED'
              ? t('duplicateJobModerationLocked')
              : tRoot(toUserMessageKey(code)),
          );
          return;
        }
        keyRef.current = null;
        // Demo (bez bazy): brak prawdziwego szkicu — pusty kreator.
        router.push(res.demo ? '/employer/oferty/nowa' : `/employer/oferty/${res.id}/edycja`);
      } catch {
        // Błąd sieci: klucz zostaje, ponowienie nie utworzy drugiego szkicu.
        setError(tRoot(toUserMessageKey('INTERNAL')));
      }
    });
  };

  return (
    <>
      <Button
        type="button"
        size="sm"
        variant="outline"
        className={cn(BTN_SMALL, 'h-auto border-border text-foreground hover:bg-soft')}
        disabled={pending}
        aria-busy={pending || undefined}
        aria-label={t('duplicateJobLabel', { title })}
        onClick={run}
      >
        <Copy className="size-4" aria-hidden="true" />
        {t('duplicateJob')}
      </Button>

      {error ? (
        <div className="fixed bottom-4 right-4 z-[60] w-[calc(100vw-2rem)] max-w-sm">
          <Toast message={error} tone="error" onClose={() => setError(null)} />
        </div>
      ) : null}
    </>
  );
}
