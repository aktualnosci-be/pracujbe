'use client';

import * as React from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Check, Send, X } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';

import { Link, useRouter } from '@/i18n/navigation';
import { sendOffer } from '@/lib/actions/offers';
import { toUserMessageKey, type ErrorCode } from '@/lib/errors';
import { cn } from '@/lib/utils';
import { offerSchema } from '@/lib/validation/offer';
import { Button, buttonVariants } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Toast } from '@/components/ui/toast';
import { LightDialogContent, LightDialogRoot } from '@/components/ui/light-dialog';
import { BTN_PRIMARY, BTN_SECONDARY, BTN_SMALL, INFO_LABEL, INFO_VALUE, PANEL_H2 } from '@/components/dashboard/panel-styles';

/**
 * SendOfferButton — wysłanie propozycji do dopasowanego kandydata (panel pracodawcy).
 *
 * Przycisk otwiera dialog potwierdzenia (#327): kandydat, oferta, której dotyczy propozycja,
 * podgląd standardowego zaproszenia i opcjonalna własna wiadomość. Bez własnej treści akcja
 * wysyła `message` = brak → w DB pusta treść, a zaproszenie renderuje się po stronie odbiorcy
 * w JEGO języku (Invariant #1, #289). Własna treść rekrutera trafia do kandydata bez zmian.
 *
 * Woła idempotentną Server Action `sendOffer` (RPC `send_offer`, Invariant #3). `idempotencyKey`
 * generowany JEDNORAZOWO na instancję — ponowne kliknięcia / retry trafiają w ten sam klucz.
 * Stan „wysłano" pochodzi z DB (`offerSentAt` z loadera), więc przetrwa odświeżenie strony.
 * Przycisk wysyłki zablokowany w trakcie zapisu (Invariant #11); błędy → komunikat i18n.
 */

const TOAST_MS = 4000;

export interface SendOfferButtonProps {
  jobId: string;
  candidateId: string;
  /** Imię i nazwisko (lub etykieta zastępcza) — w dialogu i dostępnej nazwie przycisku. */
  candidateName: string;
  /** Oferta, której dotyczy propozycja. */
  jobTitle: string;
  /** Slug oferty (link w dialogu); pusty = bez linku. */
  jobSlug?: string;
  /** Data wysłania aktywnej propozycji z DB; `null` = jeszcze nie wysłano. */
  offerSentAt?: string | null;
  className?: string;
}

export function SendOfferButton({
  jobId,
  candidateId,
  candidateName,
  jobTitle,
  jobSlug = '',
  offerSentAt = null,
  className,
}: SendOfferButtonProps): React.JSX.Element {
  const td = useTranslations('dashboard');
  const ts = useTranslations('status');
  const tc = useTranslations('common');
  const tRoot = useTranslations();
  const format = useFormatter();

  const [open, setOpen] = React.useState(false);
  const [message, setMessage] = React.useState('');
  const [fieldError, setFieldError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();
  const [sentAt, setSentAt] = React.useState<string | null>(offerSentAt);
  const [toast, setToast] = React.useState<{ tone: 'success' | 'error'; message: string } | null>(
    null,
  );
  const messageRef = React.useRef<HTMLTextAreaElement | null>(null);
  const fieldId = React.useId();

  // Stały klucz idempotencyjny na instancję przycisku (ochrona przed duplikatem propozycji).
  const idempotencyKeyRef = React.useRef<string>('');
  if (idempotencyKeyRef.current === '') {
    idempotencyKeyRef.current = crypto.randomUUID();
  }
  const router = useRouter();

  React.useEffect(() => {
    setSentAt(offerSentAt);
  }, [offerSentAt]);

  React.useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), TOAST_MS);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const job = jobTitle || td('applicationUnknownJob');

  // Toast renderujemy także w stanie „wysłano”: sukces od razu przełącza przycisk na ten stan,
  // więc bez tego komunikat o wysłaniu nigdy by się nie pojawił.
  const toastNode = toast ? (
    <div className="fixed bottom-4 right-4 z-[60] w-[calc(100vw-2rem)] max-w-sm">
      <Toast message={toast.message} tone={toast.tone} onClose={() => setToast(null)} />
    </div>
  ) : null;

  if (sentAt !== null) {
    const date = sentAt ? new Date(sentAt) : null;
    return (
      <>
        <p
          className={cn(
            'inline-flex min-h-11 items-center gap-2 text-sm font-medium text-success-text',
            className,
          )}
        >
          <Check className="size-4 shrink-0" aria-hidden="true" />
          {date && !Number.isNaN(date.getTime())
            ? td('offerSentOn', { date: format.dateTime(date, { dateStyle: 'medium' }) })
            : ts('offerSent')}
        </p>
        {toastNode}
      </>
    );
  }

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (pending) return;
    // Brak identyfikatorów (np. tryb DEMO) — nie wołamy akcji, pokazujemy błąd zamiast wyjątku.
    if (!jobId || !candidateId) {
      setToast({ tone: 'error', message: tRoot(toUserMessageKey('INTERNAL')) });
      return;
    }
    const trimmed = message.trim();
    const parsed = offerSchema.shape.message.safeParse(trimmed.length > 0 ? trimmed : undefined);
    if (!parsed.success) {
      setFieldError(parsed.error.issues[0]?.message ?? 'offer.error.messageTooShort');
      messageRef.current?.focus();
      return;
    }
    setFieldError(null);
    startTransition(async () => {
      try {
        const res = await sendOffer({
          jobId,
          candidateId,
          message: parsed.data,
          idempotencyKey: idempotencyKeyRef.current,
        });
        if (res.ok) {
          setOpen(false);
          setSentAt(new Date().toISOString());
          setToast({ tone: 'success', message: td('offerSentSuccess') });
          router.refresh();
        } else {
          setToast({ tone: 'error', message: tRoot(toUserMessageKey(res.error as ErrorCode)) });
        }
      } catch {
        setToast({ tone: 'error', message: tRoot(toUserMessageKey('INTERNAL')) });
      }
    });
  };

  return (
    <>
      <LightDialogRoot open={open} onOpenChange={(next) => (pending ? undefined : setOpen(next))}>
        <Dialog.Trigger
          aria-label={td('sendOfferTo', { name: candidateName, job })}
          className={cn(BTN_SMALL, 'border-primary bg-primary text-primary-foreground hover:bg-primary-dark', className)}
        >
          <Send className="size-4" aria-hidden="true" />
          {td('sendOffer')}
        </Dialog.Trigger>

        <LightDialogContent
          open={open}
          overlayClassName="fixed inset-0 z-50 bg-foreground/50 backdrop-blur-sm"
          className="fixed left-1/2 top-1/2 z-50 flex max-h-[90vh] w-[calc(100vw-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 flex-col overflow-y-auto rounded-2xl border border-border bg-background p-6 shadow-lg"
        >
          <div className="mb-4 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <Dialog.Title className={PANEL_H2}>
                {td('offerDialogTitle')}
              </Dialog.Title>
              <Dialog.Description className="mt-1 text-sm text-muted-foreground">
                {td('offerDialogDescription')}
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

          <dl className="mb-4 grid gap-3 rounded-[16px] border border-border bg-soft p-4">
            <div className="min-w-0">
              <dt className={INFO_LABEL}>
                {td('offerDialogCandidate')}
              </dt>
              <dd className={INFO_VALUE}>
                {candidateName}
              </dd>
            </div>
            <div className="min-w-0">
              <dt className={INFO_LABEL}>
                {td('offerDialogJob')}
              </dt>
              <dd className={INFO_VALUE}>
                {jobSlug ? (
                  <Link href={`/oferty-pracy/${jobSlug}`} className="text-primary hover:underline">
                    {job}
                  </Link>
                ) : (
                  job
                )}
              </dd>
            </div>
          </dl>

          <form className="space-y-4" onSubmit={handleSubmit} noValidate>
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">{td('offerDialogDefaultInfo')}</p>
              <p className="whitespace-pre-line break-words border-l-4 border-primary bg-soft px-4 py-3 text-sm leading-relaxed text-foreground">
                {td('offerDefaultMessage')}
              </p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor={fieldId}>{td('offerDialogMessageLabel')}</Label>
              <Textarea
                id={fieldId}
                ref={messageRef}
                value={message}
                maxLength={4000}
                onChange={(event) => {
                  setMessage(event.target.value);
                  if (fieldError) setFieldError(null);
                }}
                aria-invalid={fieldError ? true : undefined}
                aria-describedby={`${fieldId}-hint${fieldError ? ` ${fieldId}-error` : ''}`}
              />
              <p id={`${fieldId}-hint`} className="text-xs text-muted-foreground">
                {td('offerDialogMessageHint')}
              </p>
              {fieldError ? (
                <p id={`${fieldId}-error`} className="text-sm text-error-text" role="alert">
                  {tRoot(fieldError)}
                </p>
              ) : null}
            </div>

            <div className="flex flex-wrap justify-end gap-2">
              <Dialog.Close asChild>
                <Button type="button" variant="outline" disabled={pending} className={cn(BTN_SECONDARY, 'h-auto whitespace-normal')}>
                  {tc('cancel')}
                </Button>
              </Dialog.Close>
              <Button type="submit" disabled={pending} aria-busy={pending || undefined} className={cn(BTN_PRIMARY, 'h-auto whitespace-normal')}>
                <Send className="size-4" aria-hidden="true" />
                {td('sendOffer')}
              </Button>
            </div>
          </form>
        </LightDialogContent>
      </LightDialogRoot>

      {toastNode}
    </>
  );
}
