'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { FileText, Trash2, UploadCloud } from 'lucide-react';

import { useRouter } from '@/i18n/navigation';
import { uploadCandidateCv, deleteCandidateFile, prepareCvDownload } from '@/lib/actions/files';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { checkCvFile, type CvFileProblem } from '@/lib/validation/cv-file';

/**
 * Upload CV kandydata (PDF/DOC/DOCX, <=5 MB) — prywatny bucket Railway (#26, Invariant #10).
 * Pobranie: klik „nazwa pliku” → akcja `prepareCvDownload` wystawia krótki (60 s) podpisany
 * link aplikacji dopiero przy kliknięciu (działa po długo otwartym panelu i bez popupów).
 * Plik w kwarantannie (`downloadable=false`) nie ma akcji pobrania, tylko opis stanu.
 * Kliencki fragment: FormData -> server action `uploadCandidateCv`; blokada w trakcie
 * (useTransition), komunikaty z i18n. Po sukcesie odświeża panel (router.refresh).
 *
 * `loadFailed` (#331): odczyt listy się nie udał — pokazujemy błąd z ponowieniem zamiast
 * „Brak wgranych dokumentów" i ukrywamy wgrywanie, żeby nie powstawały duplikaty CV.
 * Usunięcie pliku wymaga potwierdzenia (#328); po nim fokus wraca do „Wgraj", a wynik
 * ogłasza komunikat `role="status"`.
 *
 * #362: rozmiar i format sprawdzamy w przeglądarce PRZED wysyłką (wspólne reguły z serwerem,
 * `checkCvFile`) — plik > 5 MB nie trafia na limit ciała Server Actions (413 → granica błędu).
 * Wywołanie akcji jest w `try/catch`, więc błąd sieci daje komunikat, a nie wywrócenie strony.
 */
export interface CvItem {
  id: string;
  fileName: string;
  /** false = plik w kwarantannie (czeka na sprawdzenie) — bez pobrania. */
  downloadable: boolean;
}

export function CvUpload({
  items,
  loadFailed = false,
}: {
  items: CvItem[];
  loadFailed?: boolean;
}): React.JSX.Element {
  const t = useTranslations('files');
  const tErrors = useTranslations('errors');
  const tc = useTranslations('common');
  const router = useRouter();
  const inputRef = React.useRef<HTMLInputElement>(null);
  const uploadRef = React.useRef<HTMLButtonElement>(null);
  const deleteTriggerRef = React.useRef<HTMLButtonElement | null>(null);
  const [pending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);
  const [confirmItem, setConfirmItem] = React.useState<CvItem | null>(null);
  const [deleted, setDeleted] = React.useState(false);
  const deletedRef = React.useRef(false);

  // Po usunięciu kosz znika; fokus idzie do „Wgraj", gdy przestanie być zablokowany zapisem.
  React.useEffect(() => {
    if (deleted && !pending) uploadRef.current?.focus();
  }, [deleted, pending]);

  function onPick(): void {
    inputRef.current?.click();
  }

  function onChange(e: React.ChangeEvent<HTMLInputElement>): void {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    setDeleted(false);
    const problem = checkCvFile(file);
    if (problem) {
      setError(problemMessage(problem));
      if (inputRef.current) inputRef.current.value = '';
      return;
    }
    const fd = new FormData();
    fd.append('file', file);
    startTransition(async () => {
      try {
        const res = await uploadCandidateCv(fd);
        if (res.ok) router.refresh();
        else if (res.reason) setError(problemMessage(res.reason));
        else if (res.error === 'RATE_LIMITED') setError(tErrors('rateLimited'));
        else if (res.error === 'DEMO_UNAVAILABLE') setError(tErrors('demoUnavailable'));
        else setError(t('uploadError'));
      } catch {
        // Żądanie nie wróciło (sieć, limit ciała, 5xx) — komunikat zamiast granicy błędu.
        setError(t('uploadError'));
      } finally {
        if (inputRef.current) inputRef.current.value = '';
      }
    });
  }

  function onDownload(item: CvItem): void {
    setError(null);
    setDeleted(false);
    startTransition(async () => {
      try {
        const res = await prepareCvDownload(item.id);
        if (res.ok) window.location.assign(res.url);
        else if (res.error === 'DEMO_UNAVAILABLE') setError(tErrors('demoUnavailable'));
        else setError(t('downloadError'));
      } catch {
        setError(t('downloadError'));
      }
    });
  }

  function problemMessage(problem: CvFileProblem): string {
    if (problem === 'tooLarge') return t('errorTooLarge');
    if (problem === 'type') return t('errorType');
    return t('errorEmpty');
  }

  function askDelete(item: CvItem, trigger: HTMLButtonElement): void {
    deleteTriggerRef.current = trigger;
    deletedRef.current = false;
    setConfirmItem(item);
  }

  function onDelete(id: string): void {
    setError(null);
    setDeleted(false);
    startTransition(async () => {
      let ok = false;
      try {
        ok = (await deleteCandidateFile(id)).ok;
      } catch {
        ok = false;
      }
      deletedRef.current = ok;
      setConfirmItem(null);
      if (!ok) {
        setError(t('deleteError'));
        return;
      }
      setDeleted(true);
      router.refresh();
    });
  }

  if (loadFailed) {
    return (
      <div className="min-w-0 rounded-lg border border-border bg-background p-4">
        <h3 className="mb-3 text-sm font-semibold text-foreground">{t('cvTitle')}</h3>
        <div role="alert">
          <p className="text-sm text-error-text">{t('loadError')}</p>
          <button
            type="button"
            onClick={() => router.refresh()}
            className="mt-3 inline-flex min-h-12 items-center rounded-md border border-border px-4 text-sm font-semibold text-foreground hover:bg-soft focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            {tc('retry')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-w-0 rounded-lg border border-border bg-background p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-foreground">{t('cvTitle')}</h3>
        <button
          ref={uploadRef}
          type="button"
          onClick={onPick}
          disabled={pending}
          className="inline-flex min-h-12 items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary-dark disabled:cursor-not-allowed disabled:opacity-60"
        >
          <UploadCloud className="h-3.5 w-3.5" aria-hidden="true" />
          {pending ? t('uploading') : t('upload')}
        </button>
        <input
          ref={inputRef}
          type="file"
          accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          className="hidden"
          onChange={onChange}
        />
      </div>

      <p className="mb-3 text-xs text-muted-foreground">{t('cvHint')}</p>

      {items.length > 0 ? (
        <ul className="space-y-2">
          {items.map((item) => (
            <li
              key={item.id}
              className="flex items-center justify-between gap-2 rounded-md border border-border bg-soft px-3 py-2"
            >
              <span className="flex min-w-0 items-center gap-2 overflow-hidden text-sm text-foreground">
                <FileText className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                {item.downloadable ? (
                  <button
                    type="button"
                    onClick={() => onDownload(item)}
                    disabled={pending}
                    aria-label={`${t('download')}: ${item.fileName}`}
                    className="min-h-12 min-w-0 truncate text-left text-accent hover:underline disabled:opacity-60"
                  >
                    {item.fileName}
                  </button>
                ) : (
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate">{item.fileName}</span>
                    <span className="text-xs text-muted-foreground">{t('quarantined')}</span>
                  </span>
                )}
              </span>
              <button
                type="button"
                onClick={(event) => askDelete(item, event.currentTarget)}
                disabled={pending}
                aria-label={`${t('delete')}: ${item.fileName}`}
                className="inline-flex min-h-12 min-w-12 items-center justify-center rounded-md text-muted-foreground hover:bg-background hover:text-error disabled:opacity-60"
              >
                <Trash2 className="h-4 w-4" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-muted-foreground">{t('empty')}</p>
      )}

      {error ? (
        <p role="alert" aria-live="polite" className="mt-2 text-xs text-error">
          {error}
        </p>
      ) : null}

      {deleted ? (
        <p role="status" className="mt-2 text-xs text-success-text">
          {t('deleteSuccess')}
        </p>
      ) : null}

      <ConfirmDialog
        open={confirmItem !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmItem(null);
        }}
        title={t('deleteConfirmTitle')}
        description={t('deleteConfirmDescription', { name: confirmItem?.fileName ?? '' })}
        confirmLabel={t('delete')}
        cancelLabel={tc('cancel')}
        onConfirm={() => {
          if (confirmItem) onDelete(confirmItem.id);
        }}
        pending={pending}
        getReturnFocus={() => (deletedRef.current ? uploadRef.current : deleteTriggerRef.current)}
      />
    </div>
  );
}
