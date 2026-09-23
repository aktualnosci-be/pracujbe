'use client';

import * as React from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';

/**
 * ConfirmDialog — potwierdzenie nieodwracalnej akcji (#328: wycofanie aplikacji, odrzucenie
 * propozycji, usunięcie CV).
 *
 * Kontrolowany Radix Dialog z `role="alertdialog"`: pułapka fokusu, Escape/kliknięcie w tło
 * zamyka (poza trakcją zapisu), fokus startuje na „Anuluj" (bezpieczniejszy wybór przy
 * przypadkowym dotknięciu). Po zamknięciu fokus trafia do elementu z `getReturnFocus` —
 * zwykle wyzwalacza, a po sukcesie np. komunikatu `role="status"`, gdy wyzwalacz zniknął.
 * Teksty przekazuje rodzic (już przetłumaczone, Invariant #2).
 */
export interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: () => void;
  /** Trwa zapis: przyciski zablokowane, dialogu nie da się zamknąć (Invariant #11). */
  pending?: boolean;
  /** Element, który dostaje fokus po zamknięciu (odczytywany w chwili zamknięcia). */
  getReturnFocus?: () => HTMLElement | null | undefined;
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  cancelLabel,
  onConfirm,
  pending = false,
  getReturnFocus,
}: ConfirmDialogProps): React.JSX.Element {
  const cancelRef = React.useRef<HTMLButtonElement>(null);

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        if (pending && !next) return;
        onOpenChange(next);
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-foreground/50" />
        <Dialog.Content
          role="alertdialog"
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            cancelRef.current?.focus();
          }}
          onCloseAutoFocus={(event) => {
            const target = getReturnFocus?.();
            if (target && target.isConnected) {
              event.preventDefault();
              target.focus();
            }
          }}
          className="fixed left-1/2 top-1/2 z-50 flex max-h-[90vh] w-[calc(100vw-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 flex-col overflow-y-auto rounded-2xl border border-border bg-background p-6 shadow-lg"
        >
          <Dialog.Title className="text-lg font-semibold text-foreground">{title}</Dialog.Title>
          <Dialog.Description className="mt-2 break-words text-sm text-muted-foreground">
            {description}
          </Dialog.Description>
          <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button
              ref={cancelRef}
              type="button"
              variant="outline"
              className="w-full sm:w-auto"
              disabled={pending}
              onClick={() => onOpenChange(false)}
            >
              {cancelLabel}
            </Button>
            <Button
              type="button"
              className="w-full sm:w-auto"
              disabled={pending}
              aria-busy={pending || undefined}
              onClick={onConfirm}
            >
              {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
              {confirmLabel}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
