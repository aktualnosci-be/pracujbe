'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { FileText, Trash2, UploadCloud } from 'lucide-react';

import { useRouter } from '@/i18n/navigation';
import { uploadCandidateCv, deleteCandidateFile } from '@/lib/actions/files';

/**
 * Upload CV kandydata (PDF/DOC/DOCX, <=5 MB) — prywatny bucket + signed URLs (Invariant #10).
 * Kliencki fragment: FormData -> server action `uploadCandidateCv`; blokada w trakcie
 * (useTransition), komunikaty z i18n. Po sukcesie odświeża panel (router.refresh).
 */
export interface CvItem {
  id: string;
  fileName: string;
  /** Krótkotrwały signed URL (może być null — wtedy bez linku pobrania). */
  url: string | null;
}

export function CvUpload({ items }: { items: CvItem[] }): React.JSX.Element {
  const t = useTranslations('files');
  const router = useRouter();
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [pending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);

  function onPick(): void {
    inputRef.current?.click();
  }

  function onChange(e: React.ChangeEvent<HTMLInputElement>): void {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    const fd = new FormData();
    fd.append('file', file);
    startTransition(async () => {
      const res = await uploadCandidateCv(fd);
      if (!res.ok) setError(t('uploadError'));
      else router.refresh();
      if (inputRef.current) inputRef.current.value = '';
    });
  }

  function onDelete(id: string): void {
    setError(null);
    startTransition(async () => {
      const res = await deleteCandidateFile(id);
      if (!res.ok) setError(t('deleteError'));
      else router.refresh();
    });
  }

  return (
    <div className="rounded-lg border border-border bg-background p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-foreground">{t('cvTitle')}</h3>
        <button
          type="button"
          onClick={onPick}
          disabled={pending}
          className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary-dark disabled:cursor-not-allowed disabled:opacity-60"
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
              <span className="flex min-w-0 items-center gap-2 text-sm text-foreground">
                <FileText className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                {item.url ? (
                  <a href={item.url} target="_blank" rel="noopener noreferrer" className="truncate text-accent hover:underline">
                    {item.fileName}
                  </a>
                ) : (
                  <span className="truncate">{item.fileName}</span>
                )}
              </span>
              <button
                type="button"
                onClick={() => onDelete(item.id)}
                disabled={pending}
                aria-label={t('delete')}
                className="rounded p-1 text-muted-foreground hover:text-error disabled:opacity-60"
              >
                <Trash2 className="h-4 w-4" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-muted-foreground">{t('empty')}</p>
      )}

      {error ? <p className="mt-2 text-xs text-error">{error}</p> : null}
    </div>
  );
}
