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
 *
 * Podgląd JPG/PNG: miniatura pod nazwą pliku, tylko dla pliku dopuszczonego do pobrania
 * (kwarantanna = brak podglądu). Link (ten sam HMAC 60 s co pobranie, trasa ponownie sprawdza
 * sesję, dostęp i skan) wystawiamy dopiero, gdy miniatura wjedzie w widok (IntersectionObserver),
 * a obraz ładuje się leniwie. Błąd linku albo obrazu = brak miniatury, nazwa i pobranie zostają.
 */

/** Typy z podglądem — wyłącznie rastrowe formaty dozwolone przy wgrywaniu (bez SVG). */
const PREVIEW_MIME_TYPES: ReadonlySet<string> = new Set(['image/jpeg', 'image/png']);

export function hasAttachmentPreview(attachment: Pick<ThreadAttachment, 'mimeType' | 'downloadable'>): boolean {
  return attachment.downloadable && PREVIEW_MIME_TYPES.has(attachment.mimeType);
}

function AttachmentPreview({ attachment }: { attachment: ThreadAttachment }): React.JSX.Element | null {
  const t = useTranslations('messages');
  const holder = React.useRef<HTMLDivElement>(null);
  const [src, setSrc] = React.useState<string | null>(null);
  const [failed, setFailed] = React.useState(false);

  React.useEffect(() => {
    const node = holder.current;
    if (!node || src || failed) return;
    let cancelled = false;
    const load = () => {
      void prepareMessageAttachmentDownload(attachment.id)
        .then((result) => {
          if (cancelled) return;
          if (result.ok) setSrc(result.url);
          else setFailed(true);
        })
        .catch(() => {
          if (!cancelled) setFailed(true);
        });
    };
    if (typeof IntersectionObserver === 'undefined') {
      load();
      return () => {
        cancelled = true;
      };
    }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        observer.disconnect();
        load();
      }
    }, { rootMargin: '200px' });
    observer.observe(node);
    return () => {
      cancelled = true;
      observer.disconnect();
    };
  }, [attachment.id, src, failed]);

  if (failed) return null;
  return (
    <div ref={holder} className="mt-1 min-h-8">
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element -- prywatny plik z krótkim linkiem, bez optymalizatora
        <img
          src={src}
          alt={t('attachmentPreviewAlt', { name: attachment.fileName })}
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
          className="block max-h-48 max-w-full rounded-[8px] border border-border object-contain"
        />
      ) : null}
    </div>
  );
}

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
      {hasAttachmentPreview(attachment) ? <AttachmentPreview attachment={attachment} /> : null}
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
