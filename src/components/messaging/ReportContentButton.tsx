'use client';

import * as React from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Flag, X } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { reportConversationContent } from '@/lib/actions/message-reports';
import { toUserMessageKey, type ErrorCode } from '@/lib/errors';
import { cn } from '@/lib/utils';
import {
  MESSAGE_REPORT_CATEGORIES,
  MESSAGE_REPORT_DETAILS_MAX,
  type MessageReportCategory,
} from '@/lib/validation/message-report';
import { Button, buttonVariants } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { LightDialogContent, LightDialogRoot } from '@/components/ui/light-dialog';
import { BTN_PRIMARY, BTN_SECONDARY, PANEL_H2 } from '@/components/dashboard/panel-styles';

/**
 * ReportContentButton — zgłoszenie wiadomości drugiej strony albo całej rozmowy (0108).
 *
 * Dialog z powodem ze słownika (`MESSAGE_REPORT_CATEGORIES`) i opcjonalnym opisem. Klucz
 * idempotencji jest stały dla jednego otwarcia dialogu: podwójne kliknięcie i ponowienie po
 * zerwanym połączeniu trafiają w to samo zgłoszenie (baza zwraca `duplicate`). Stan
 * „Zgłoszono” pochodzi z bazy (`reported`, `get_my_message_reports`), więc przetrwa
 * odświeżenie. Przycisk wysyłki zablokowany w trakcie zapisu, błąd przy polu z fokusem
 * (Invariant #11), komunikaty z kluczy tłumaczeń (Invariant #8).
 */

export interface ReportContentButtonProps {
  conversationId: string;
  /** `null` = zgłoszenie całej rozmowy. */
  messageId: string | null;
  /** Czy użytkownik ma już otwarte zgłoszenie tej treści (z bazy). */
  reported: boolean;
  /** Dostępna nazwa przycisku (np. „Zgłoś wiadomość z 12.03, 10:15”). */
  label: string;
  /** Zgłaszana wiadomość — podgląd w dialogu (tylko przy zgłoszeniu wiadomości). */
  quote?: string;
  className?: string;
}

const CATEGORY_KEY: Record<MessageReportCategory, string> = {
  spam: 'reportCategorySpam',
  harassment: 'reportCategoryHarassment',
  fraud: 'reportCategoryFraud',
  discrimination: 'reportCategoryDiscrimination',
  inappropriate: 'reportCategoryInappropriate',
  data_misuse: 'reportCategoryDataMisuse',
  other: 'reportCategoryOther',
};

export function ReportContentButton({
  conversationId,
  messageId,
  reported: reportedInitial,
  label,
  quote,
  className,
}: ReportContentButtonProps): React.JSX.Element {
  const t = useTranslations('messages');
  const tc = useTranslations('common');
  const tRoot = useTranslations();

  const [open, setOpen] = React.useState(false);
  const [reported, setReported] = React.useState(reportedInitial);
  const [category, setCategory] = React.useState<MessageReportCategory | null>(null);
  const [details, setDetails] = React.useState('');
  const [categoryError, setCategoryError] = React.useState(false);
  const [formError, setFormError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();
  const firstRadioRef = React.useRef<HTMLInputElement | null>(null);
  const idempotencyKey = React.useRef('');
  const fieldId = React.useId();
  const reportedRef = React.useRef<HTMLSpanElement | null>(null);
  const focusReported = React.useRef(false);
  const isMessage = messageId !== null;

  React.useEffect(() => {
    setReported((current) => current || reportedInitial);
  }, [reportedInitial]);

  // Przycisk znika po zgłoszeniu — fokus na komunikacie, nie na <body>.
  React.useEffect(() => {
    if (reported && focusReported.current) {
      focusReported.current = false;
      reportedRef.current?.focus();
    }
  }, [reported]);

  function openChange(next: boolean): void {
    if (pending) return;
    if (next) {
      // Nowe otwarcie = nowa operacja zgłoszenia (klucz stały do zamknięcia dialogu).
      idempotencyKey.current = crypto.randomUUID();
      setCategory(null);
      setDetails('');
      setCategoryError(false);
      setFormError(null);
    }
    setOpen(next);
  }

  function handleSubmit(event: React.FormEvent): void {
    event.preventDefault();
    if (pending) return;
    if (!category) {
      setCategoryError(true);
      firstRadioRef.current?.focus();
      return;
    }
    setFormError(null);
    startTransition(async () => {
      try {
        const result = await reportConversationContent({
          conversationId,
          messageId,
          category,
          details,
          idempotencyKey: idempotencyKey.current,
        });
        if (result.ok) {
          focusReported.current = true;
          setOpen(false);
          setReported(true);
          setNotice(t(result.outcome === 'already_open' ? 'reportAlreadyOpen' : 'reportSent'));
        } else {
          setFormError(tRoot(toUserMessageKey(result.error as ErrorCode)));
        }
      } catch {
        // Ponowienie z tym samym kluczem nie utworzy drugiego zgłoszenia.
        setFormError(t('reportNetworkError'));
      }
    });
  }

  if (reported) {
    return (
      <span
        ref={reportedRef}
        tabIndex={-1}
        className={cn('inline-flex items-center gap-1 text-[11px] text-muted-foreground focus:outline-none', className)}
      >
        <Flag className="size-3 shrink-0" aria-hidden="true" />
        <span role={notice ? 'status' : undefined}>{notice ?? t('reportedBadge')}</span>
      </span>
    );
  }

  const categoryErrorId = `${fieldId}-category-error`;

  return (
    <LightDialogRoot open={open} onOpenChange={openChange}>
      <Dialog.Trigger
        aria-label={label}
        className={cn(
          'inline-flex min-h-6 min-w-6 items-center gap-1 rounded-[8px] px-1 text-[11px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          className,
        )}
      >
        <Flag className="size-3 shrink-0" aria-hidden="true" />
        {isMessage ? t('reportMessage') : t('reportConversation')}
      </Dialog.Trigger>

      <LightDialogContent
        open={open}
        onCloseAutoFocus={(event) => {
          // Po zgłoszeniu wyzwalacza już nie ma — fokus przejmuje komunikat „Zgłoszono”.
          if (focusReported.current || reportedRef.current) event.preventDefault();
        }}
        overlayClassName="fixed inset-0 z-50 bg-foreground/50 backdrop-blur-sm"
        className="fixed left-1/2 top-1/2 z-50 flex max-h-[90vh] w-[calc(100vw-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 flex-col overflow-y-auto rounded-2xl border border-border bg-background p-6 shadow-lg"
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <Dialog.Title className={PANEL_H2}>
              {isMessage ? t('reportDialogTitleMessage') : t('reportDialogTitleConversation')}
            </Dialog.Title>
            <Dialog.Description className="mt-1 text-sm text-muted-foreground">
              {t('reportDialogDescription')}
            </Dialog.Description>
          </div>
          <Dialog.Close
            aria-label={tc('cancel')}
            disabled={pending}
            className={cn(buttonVariants({ variant: 'ghost', size: 'icon' }), 'h-9 w-9 shrink-0')}
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </Dialog.Close>
        </div>

        {isMessage && quote ? (
          <figure className="mb-4">
            <figcaption className="mb-1 text-xs font-medium text-muted-foreground">
              {t('reportQuoteLabel')}
            </figcaption>
            <blockquote className="max-h-32 overflow-y-auto whitespace-pre-wrap break-words rounded-[14px] border border-border bg-soft px-4 py-3 text-sm text-foreground">
              {quote}
            </blockquote>
          </figure>
        ) : (
          <p className="mb-4 text-sm text-muted-foreground">{t('reportConversationHint')}</p>
        )}

        <form className="space-y-4" onSubmit={handleSubmit} noValidate>
          <fieldset
            aria-describedby={categoryError ? categoryErrorId : undefined}
            className="space-y-1"
          >
            <legend className="mb-2 text-sm font-medium text-foreground">
              {t('reportCategoryLegend')}
            </legend>
            {MESSAGE_REPORT_CATEGORIES.map((value, index) => (
              <label key={value} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-[11px] px-2 text-sm text-foreground hover:bg-soft">
                <input
                  ref={index === 0 ? firstRadioRef : undefined}
                  type="radio"
                  name={`${fieldId}-category`}
                  value={value}
                  checked={category === value}
                  onChange={() => {
                    setCategory(value);
                    setCategoryError(false);
                  }}
                  className="size-4 accent-primary"
                />
                {t(CATEGORY_KEY[value])}
              </label>
            ))}
            {categoryError ? (
              <p id={categoryErrorId} role="alert" className="text-sm text-error-text">
                {t('reportCategoryRequired')}
              </p>
            ) : null}
          </fieldset>

          <div className="space-y-1.5">
            <Label htmlFor={`${fieldId}-details`}>{t('reportDetailsLabel')}</Label>
            <Textarea
              id={`${fieldId}-details`}
              value={details}
              maxLength={MESSAGE_REPORT_DETAILS_MAX}
              onChange={(event) => setDetails(event.target.value)}
              aria-describedby={`${fieldId}-details-hint`}
            />
            <p id={`${fieldId}-details-hint`} className="text-xs text-muted-foreground">
              {t('reportDetailsHint', { max: MESSAGE_REPORT_DETAILS_MAX })}
            </p>
          </div>

          <p className="rounded-md border border-dashed border-border bg-soft p-3 text-xs text-muted-foreground">
            {t('reportLegalPlaceholder')}
          </p>

          {formError ? (
            <p role="alert" className="text-sm text-error-text">
              {formError}
            </p>
          ) : null}

          <div className="flex flex-wrap justify-end gap-2">
            <Dialog.Close asChild>
              <Button type="button" variant="outline" disabled={pending} className={cn(BTN_SECONDARY, 'h-auto whitespace-normal')}>
                {tc('cancel')}
              </Button>
            </Dialog.Close>
            <Button type="submit" disabled={pending} aria-busy={pending || undefined} className={cn(BTN_PRIMARY, 'h-auto whitespace-normal')}>
              {pending ? t('reportSubmitting') : t('reportSubmit')}
            </Button>
          </div>
        </form>
      </LightDialogContent>
    </LightDialogRoot>
  );
}
