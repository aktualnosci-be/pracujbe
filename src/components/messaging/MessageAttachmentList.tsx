'use client';

import * as React from 'react';
import { FileText, Image as ImageIcon } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';

import { prepareMessageAttachmentDownload } from '@/lib/actions/message-attachments';
import type { ThreadAttachment } from '@/lib/data/messages';
import { toUserMessageKey } from '@/lib/errors';
import { cn } from '@/lib/utils';

/**
 * MessageAttachmentList — załączniki wiadomości w wątku (0119).
 *
 * Nazwa pliku to przycisk: klik prosi serwer o krótki (60 s) podpisany link i dopiero wtedy
 * przechodzi do trasy pobrania (bez adresu bucketu w DOM). Plik w kwarantannie (skan) jest
 * widoczny z nazwą, ale bez pobrania. Błąd przy pliku z klucza i18n (Invariant #8).
 */

export interface MessageAttachmentListProps {
  attachments: ThreadAttachment[];
}

/** Rozmiar pliku w KB/MB wg locale (np. „1,2 MB”). */
export function formatFileSize(bytes: number, locale: string): string {
  const units: Array<['kilobyte' | 'megabyte', number]> = [['megabyte', 1024 * 1024], ['kilobyte', 1024]];
  const [unit, size] = bytes >= 1024 * 1024 ? units[0]! : units[1]!;
  return new Intl.NumberFormat(locale, {
    style: 'unit',
    unit,
    unitDisplay: 'short',
    maximumFractionDigits: 1,
  }).format(Math.max(bytes / size, 0.1));
}

function AttachmentItem({ attachment }: { attachment: ThreadAttachment }): React.JSX.Element {
  const t = useTranslations('messages');
  const tRoot = useTranslations();
  const locale = useLocale();
  const [pending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);
  const errorId = React.useId();
  const Icon = attachment.mimeType.startsWith('image/') ? ImageIcon : FileText;
  const size = formatFileSize(attachment.sizeBytes, locale);

  function download(): void {
    if (pending) return;
    setError(null);
    startTransition(async () => {
      try {
        const result = await prepareMessageAttachmentDownload(attachment.id);
        if (result.ok) {
          window.location.assign(result.url);
          return;
        }
        setError(
          result.error === 'DEMO_UNAVAILABLE' || result.error === 'RATE_LIMITED'
            ? tRoot(toUserMessageKey(result.error))
            : t('attachmentDownloadError'),
        );
      } catch {
        setError(t('attachmentDownloadError'));
      }
    });
  }

  return (
    <li className="min-w-0">
      {attachment.downloadable ? (
        <button
          type="button"
          onClick={download}
          aria-busy={pending}
          aria-describedby={error ? errorId : undefined}
          aria-label={t('attachmentDownload', { name: attachment.fileName, size })}
          className={cn(
            'inline-flex min-h-11 max-w-full items-center gap-2 rounded-[8px] text-left text-sm font-medium text-foreground underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          )}
        >
          <Icon className="size-4 shrink-0" aria-hidden="true" />
          <span className="min-w-0 break-all">{attachment.fileName}</span>
          <span className="shrink-0 text-xs font-normal text-muted-foreground no-underline">{size}</span>
        </button>
      ) : (
        <p className="inline-flex max-w-full items-center gap-2 text-sm text-foreground">
          <Icon className="size-4 shrink-0" aria-hidden="true" />
          <span className="min-w-0 break-all">{attachment.fileName}</span>
          <span className="shrink-0 text-xs text-muted-foreground">{t('attachmentUnavailable')}</span>
        </p>
      )}
      {error ? (
        <p id={errorId} role="alert" className="mt-1 text-xs text-error">
          {error}
        </p>
      ) : null}
    </li>
  );
}

export function MessageAttachmentList({ attachments }: MessageAttachmentListProps): React.JSX.Element | null {
  const t = useTranslations('messages');
  if (attachments.length === 0) return null;
  return (
    <ul aria-label={t('attachmentsLabel')} className="mt-2 flex flex-col gap-1">
      {attachments.map((attachment) => (
        <AttachmentItem key={attachment.id} attachment={attachment} />
      ))}
    </ul>
  );
}
