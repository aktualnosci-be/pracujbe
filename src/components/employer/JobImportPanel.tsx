'use client';

import { cn } from '@/lib/utils';
import * as React from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { AlertCircle, CheckCircle2, ChevronDown, Link2, Loader2, Upload } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  BTN_PRIMARY,
  BTN_RESET,
  FORM_ERROR,
  FORM_FIELD,
  FORM_HINT,
  FORM_INPUT,
  FORM_LABEL_TEXT,
  H2_EXTENDED,
  P_EXTENDED,
  PAPER,
} from '@/components/dashboard/panel-styles';
import { importJobListing, type JobImportResult } from '@/lib/actions/job-import';
import { checkImportImageMeta, IMPORT_IMAGE_TYPES, type ImportImageProblem } from '@/lib/ai-import/image';
import { toUserMessageKey, type ErrorCode } from '@/lib/errors';

/**
 * Krok „Zaimportuj z ogłoszenia" (#465) nad kreatorem nowej oferty. Pracodawca wgrywa zrzut
 * ekranu (PNG/JPG/WebP) albo wkleja link; serwer odczytuje ogłoszenie przez AI i zwraca
 * wstępnie wypełnione pola szkicu. Nic nie jest publikowane — pracodawca przechodzi kroki
 * kreatora i sam decyduje o publikacji.
 *
 * Invariant #11: blokada w trakcie importu (jedno żądanie naraz), zachowanie wpisanego adresu
 * po błędzie, komunikat przy polu, jasny sukces. Domyślnie zwinięty — ręczne wypełnianie
 * kreatora działa bez zmian.
 */

export type JobImportSuccess = Extract<JobImportResult, { ok: true }>;

const PROBLEM_KEY: Record<ImportImageProblem, string> = {
  empty: 'errorFileEmpty',
  tooLarge: 'errorFileTooLarge',
  type: 'errorFileType',
};

export function JobImportPanel({
  result,
  onImported,
}: {
  result: JobImportSuccess | null;
  onImported: (result: JobImportSuccess) => void;
}): React.JSX.Element {
  const t = useTranslations('jobImport');
  const tRoot = useTranslations();
  const locale = useLocale();
  const panelId = React.useId();
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState<'image' | 'url' | null>(null);
  const [error, setError] = React.useState<{ source: 'image' | 'url'; message: string } | null>(null);
  const [url, setUrl] = React.useState('');
  const fileRef = React.useRef<HTMLInputElement>(null);
  const inFlight = React.useRef(false);
  const resultRef = React.useRef<HTMLDivElement>(null);

  // Po imporcie kreator montuje się od nowa (także ten panel) — fokus na podsumowaniu wyniku,
  // żeby nie zgubić go na <body>.
  React.useEffect(() => {
    if (result) resultRef.current?.focus();
    // Tylko przy montażu z nowym wynikiem.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function errorText(code: ErrorCode, reason?: ImportImageProblem): string {
    if (code === 'JOB_IMPORT_INVALID_FILE' && reason) return t(PROBLEM_KEY[reason]);
    return tRoot(toUserMessageKey(code));
  }

  async function submit(source: 'image' | 'url'): Promise<void> {
    if (inFlight.current) return;
    setError(null);
    const formData = new FormData();
    formData.set('mode', source);
    if (source === 'image') {
      const file = fileRef.current?.files?.[0];
      if (!file) {
        setError({ source, message: t('errorFileMissing') });
        fileRef.current?.focus();
        return;
      }
      const problem = checkImportImageMeta(file);
      if (problem) {
        setError({ source, message: t(PROBLEM_KEY[problem]) });
        fileRef.current?.focus();
        return;
      }
      formData.set('file', file);
    } else {
      if (!url.trim()) {
        setError({ source, message: t('errorUrlMissing') });
        return;
      }
      formData.set('url', url.trim());
    }

    inFlight.current = true;
    setBusy(source);
    try {
      const res = await importJobListing(formData, locale);
      if (res.ok) {
        onImported(res);
      } else {
        setError({ source, message: errorText(res.error, res.reason) });
      }
    } catch {
      setError({ source, message: t('errorNetwork') });
    } finally {
      inFlight.current = false;
      setBusy(null);
    }
  }

  const fileErrorId = `${panelId}-file-error`;
  const urlErrorId = `${panelId}-url-error`;
  const filledCount = result ? Object.keys(result.values).length : 0;

  return (
    // Prototyp nie ma importu — karta `.paper` z nagłówkiem `.extended h2` i polami `.demo-form`.
    <section
      aria-labelledby={`${panelId}-title`}
      className={PAPER}
    >
      <h2 id={`${panelId}-title`} className={H2_EXTENDED}>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={`${panelId}-body`}
          onClick={() => setOpen((v) => !v)}
          className="flex min-h-11 w-full items-center justify-between gap-3 rounded-[11px] text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          <span>{t('title')}</span>
          <ChevronDown
            className={`h-5 w-5 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}
            aria-hidden="true"
          />
        </button>
      </h2>
      <p className={cn(P_EXTENDED, 'mt-1.5')}>{t('subtitle')}</p>

      {result ? (
        <div
          ref={resultRef}
          tabIndex={-1}
          role="status"
          className="mt-5 space-y-1.5 rounded-[16px] border border-success/30 bg-success/5 px-[23px] py-5 text-[13px] text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring max-[600px]:p-[18px]"
        >
          <p className="flex items-start gap-2 text-[15px] font-[650]">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-hidden="true" />
            {t('successTitle', { count: filledCount })}
          </p>
          <p>{result.review.length > 0 ? t('successReview', { count: result.review.length }) : t('successNoReview')}</p>
          <p>{result.savedSteps.length > 0 ? t('successDraftSaved') : t('successDraftPending')}</p>
          {result.suspicious ? (
            <p className="flex items-start gap-2 font-medium text-warning-text">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              {t('suspiciousWarning')}
            </p>
          ) : null}
        </div>
      ) : null}

      <div id={`${panelId}-body`} hidden={!open} className="mt-[22px] space-y-7" aria-busy={busy !== null}>
        <p className="border-b border-border pb-3 text-xs leading-[1.6] text-muted-foreground">
          {t('rightsNote')} {t('privacyNote')} {t('contactNote')}
        </p>

        <div className={FORM_FIELD}>
          <Label htmlFor={`${panelId}-file`} className={FORM_LABEL_TEXT}>{t('fileLabel')}</Label>
          <p id={`${panelId}-file-hint`} className={FORM_HINT}>
            {t('fileHint')}
          </p>
          <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center">
            <Input
              ref={fileRef}
              id={`${panelId}-file`}
              type="file"
              accept={IMPORT_IMAGE_TYPES.join(',')}
              disabled={busy !== null}
              aria-invalid={error?.source === 'image' ? true : undefined}
              aria-describedby={[`${panelId}-file-hint`, error?.source === 'image' ? fileErrorId : '']
                .filter(Boolean)
                .join(' ')}
              className={cn(FORM_INPUT, 'sm:flex-1')}
            />
            <Button type="button" onClick={() => void submit('image')} disabled={busy !== null} className={`${BTN_PRIMARY} ${BTN_RESET} shrink-0`}>
              {busy === 'image' ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <Upload className="h-4 w-4" aria-hidden="true" />
              )}
              {busy === 'image' ? t('importing') : t('importImage')}
            </Button>
          </div>
          {error?.source === 'image' ? (
            <p id={fileErrorId} role="alert" className={FORM_ERROR}>
              {error.message}
            </p>
          ) : null}
        </div>

        <form
          noValidate
          className={FORM_FIELD}
          onSubmit={(e) => {
            e.preventDefault();
            void submit('url');
          }}
        >
          <Label htmlFor={`${panelId}-url`} className={FORM_LABEL_TEXT}>{t('urlLabel')}</Label>
          <p id={`${panelId}-url-hint`} className={FORM_HINT}>
            {t('urlHint')}
          </p>
          <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center">
            <Input
              id={`${panelId}-url`}
              type="url"
              inputMode="url"
              autoComplete="url"
              placeholder="https://"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              disabled={busy !== null}
              aria-invalid={error?.source === 'url' ? true : undefined}
              aria-describedby={[`${panelId}-url-hint`, error?.source === 'url' ? urlErrorId : '']
                .filter(Boolean)
                .join(' ')}
              className={cn(FORM_INPUT, 'sm:flex-1')}
            />
            <Button type="submit" disabled={busy !== null} className={`${BTN_PRIMARY} ${BTN_RESET} shrink-0`}>
              {busy === 'url' ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <Link2 className="h-4 w-4" aria-hidden="true" />
              )}
              {busy === 'url' ? t('importing') : t('importUrl')}
            </Button>
          </div>
          {error?.source === 'url' ? (
            <p id={urlErrorId} role="alert" className={FORM_ERROR}>
              {error.message}
            </p>
          ) : null}
        </form>

        {busy ? (
          <p role="status" className={P_EXTENDED}>
            {t('busyHint')}
          </p>
        ) : null}
      </div>
    </section>
  );
}
