'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { AlertCircle, CheckCircle2, Download, Loader2, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { H2_EXTENDED, PAPER } from '@/components/dashboard/panel-styles';
import { deleteMyAccountAction, type DeleteAccountError } from '@/lib/actions/account-data';
import { Link } from '@/i18n/navigation';

/**
 * AccountDataSettings — pobranie danych (JSON) i usunięcie konta kandydata albo pracodawcy (#486).
 *
 * `variant` zmienia wyłącznie opisy (zakres eksportu/usunięcia); trasa i akcja same wybierają
 * funkcję bazy po roli sesji (`export_my_employer_data` / `request_employer_account_erasure`,
 * 0209). Pracodawca będący ostatnim właścicielem firmy dostaje `deleteLastOwner`.
 *
 * Eksport: `fetch` POST `/api/account/export` (ta sama witryna, sesja w cookies) → plik
 * z odpowiedzi; status błędu → przetłumaczony komunikat, nigdy surowa odpowiedź (Invariant #8).
 * Usunięcie: drugi krok z polem na adres e-mail konta (porównanie w bazie) i
 * `deleteMyAccountAction`. Invariant #11: przyciski zablokowane w trakcie operacji, błąd
 * `role="alert"` przy polu (`aria-describedby`), wpisany adres zostaje po błędzie; po sukcesie
 * formularz znika, a fokus trafia na komunikat `role="status"`.
 */

type ExportState = 'idle' | 'pending' | 'done' | 'demo' | 'rateLimited' | 'unauthorized' | 'error';

const EXPORT_MESSAGES = {
  done: 'exportSuccess',
  demo: 'exportDemo',
  rateLimited: 'exportRateLimited',
  unauthorized: 'exportUnauthorized',
  error: 'exportError',
} as const;

const DELETE_ERRORS: Record<DeleteAccountError, 'mismatch' | 'deleteDenied' | 'deleteLastOwner' | 'deleteError'> = {
  mismatch: 'mismatch',
  denied: 'deleteDenied',
  lastOwner: 'deleteLastOwner',
  failed: 'deleteError',
};

export type AccountDataVariant = 'candidate' | 'employer';

function exportFailure(status: number): ExportState {
  if (status === 429) return 'rateLimited';
  if (status === 401) return 'unauthorized';
  return 'error';
}

function saveFile(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function fileNameFrom(disposition: string | null): string {
  const match = disposition ? /filename="([^"]+)"/.exec(disposition) : null;
  return match?.[1] ?? 'pracujbe-dane.json';
}

export function AccountDataSettings({
  variant = 'candidate',
}: {
  variant?: AccountDataVariant;
} = {}): React.JSX.Element {
  const t = useTranslations('accountData');
  const [exportState, setExportState] = React.useState<ExportState>('idle');
  const [confirming, setConfirming] = React.useState(false);
  const [email, setEmail] = React.useState('');
  const [deleting, setDeleting] = React.useState(false);
  const [deleteError, setDeleteError] = React.useState<DeleteAccountError | null>(null);
  const [deleted, setDeleted] = React.useState<'real' | 'demo' | null>(null);
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const startRef = React.useRef<HTMLButtonElement | null>(null);
  const doneRef = React.useRef<HTMLParagraphElement | null>(null);

  React.useEffect(() => {
    if (confirming) inputRef.current?.focus();
  }, [confirming]);
  React.useEffect(() => {
    if (deleted) doneRef.current?.focus();
  }, [deleted]);
  // Pole jest zablokowane w trakcie zapisu — fokus wraca dopiero po jego odblokowaniu.
  React.useEffect(() => {
    if (deleteError && !deleting) inputRef.current?.focus();
  }, [deleteError, deleting]);

  const downloadData = async (): Promise<void> => {
    if (exportState === 'pending') return;
    setExportState('pending');
    try {
      const response = await fetch('/api/account/export', { method: 'POST', credentials: 'same-origin' });
      if (!response.ok) {
        setExportState(exportFailure(response.status));
        return;
      }
      const blob = await response.blob();
      const demo = await blob
        .text()
        .then((text) => (JSON.parse(text) as { demo?: unknown }).demo === true)
        .catch(() => false);
      saveFile(blob, fileNameFrom(response.headers.get('content-disposition')));
      setExportState(demo ? 'demo' : 'done');
    } catch {
      setExportState('error');
    }
  };

  const deleteAccount = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (deleting) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      const result = await deleteMyAccountAction(email);
      if (!result.ok) {
        setDeleteError(result.error);
        return;
      }
      setDeleted(result.demo ? 'demo' : 'real');
    } catch {
      setDeleteError('failed');
    } finally {
      setDeleting(false);
    }
  };

  const cancel = (): void => {
    setConfirming(false);
    setDeleteError(null);
    setEmail('');
    requestAnimationFrame(() => startRef.current?.focus());
  };

  const exportMessage = exportState === 'idle' || exportState === 'pending' ? null : EXPORT_MESSAGES[exportState];
  const exportOk = exportState === 'done' || exportState === 'demo';
  // Długie etykiety (NL/FR) zawijają się zamiast rozpychać stronę przy 320 px.
  const wrap = 'h-auto min-h-12 whitespace-normal py-3 text-left';

  return (
    <section aria-labelledby="account-data-title" className={PAPER}>
      <h2 id="account-data-title" className={H2_EXTENDED}>
        {t('sectionTitle')}
      </h2>
      <p className="mt-1 text-[15px] leading-[1.7] text-muted-foreground">{t('sectionDescription')}</p>

      <div className="mt-5">
        <h3 className="text-base font-semibold text-foreground">{t('exportTitle')}</h3>
        <p id="account-export-description" className="mt-1 text-sm text-muted-foreground">
          {variant === 'employer' ? t('exportDescriptionEmployer') : t('exportDescription')}
        </p>
        <Button
          type="button"
          variant="outline"
          className={`mt-3 ${wrap}`}
          aria-describedby="account-export-description"
          aria-busy={exportState === 'pending' || undefined}
          disabled={exportState === 'pending'}
          onClick={() => void downloadData()}
        >
          {exportState === 'pending' ? (
            <Loader2 className="animate-spin" aria-hidden="true" />
          ) : (
            <Download aria-hidden="true" />
          )}
          {exportState === 'pending' ? t('exporting') : t('exportButton')}
        </Button>
        <div aria-live="polite">
          {exportMessage ? (
            <p
              role={exportOk ? 'status' : 'alert'}
              className={
                exportOk
                  ? 'mt-3 flex items-start gap-2 text-sm text-success-text'
                  : 'mt-3 flex items-start gap-2 text-sm text-error'
              }
            >
              {exportOk ? (
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              ) : (
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              )}
              {t(exportMessage)}
            </p>
          ) : null}
        </div>
      </div>

      <div className="mt-6 border-t border-border pt-5">
        <h3 className="text-base font-semibold text-foreground">{t('deleteTitle')}</h3>
        {deleted ? (
          <div>
            <p
              ref={doneRef}
              tabIndex={-1}
              role="status"
              className="mt-2 flex items-start gap-2 text-sm text-success-text focus:outline-none"
            >
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              {deleted === 'demo' ? t('deletedDemo') : t('deleted')}
            </p>
            {deleted === 'real' ? (
              <Link href="/" className="mt-3 inline-block text-sm font-medium text-foreground underline">
                {t('homeLink')}
              </Link>
            ) : null}
          </div>
        ) : (
          <>
            <p id="account-delete-description" className="mt-1 text-sm text-muted-foreground">
              {variant === 'employer' ? t('deleteDescriptionEmployer') : t('deleteDescription')}
            </p>
            {confirming ? (
              <form className="mt-3" noValidate onSubmit={(event) => void deleteAccount(event)}>
                <Label htmlFor="account-delete-email">{t('confirmLabel')}</Label>
                <Input
                  ref={inputRef}
                  id="account-delete-email"
                  type="email"
                  autoComplete="off"
                  className="mt-2"
                  value={email}
                  aria-invalid={deleteError ? true : undefined}
                  aria-describedby={deleteError ? 'account-delete-error' : 'account-delete-description'}
                  disabled={deleting}
                  onChange={(event) => setEmail(event.target.value)}
                />
                {deleteError ? (
                  <p id="account-delete-error" role="alert" className="mt-2 text-sm text-error">
                    {t(DELETE_ERRORS[deleteError])}
                  </p>
                ) : null}
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button type="submit" className={wrap} aria-busy={deleting || undefined} disabled={deleting}>
                    {deleting ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
                    {deleting ? t('deleting') : t('confirmButton')}
                  </Button>
                  <Button type="button" variant="outline" className={wrap} disabled={deleting} onClick={cancel}>
                    {t('cancel')}
                  </Button>
                </div>
              </form>
            ) : (
              <Button
                ref={startRef}
                type="button"
                variant="outline"
                className={`mt-3 ${wrap}`}
                aria-describedby="account-delete-description"
                onClick={() => setConfirming(true)}
              >
                <Trash2 aria-hidden="true" />
                {t('deleteStart')}
              </Button>
            )}
          </>
        )}
      </div>
    </section>
  );
}
