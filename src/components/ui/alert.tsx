import * as React from 'react';

import { NOTICE, NOTICE_TEXT, NOTICE_TITLE } from '@/components/dashboard/panel-styles';
import { cn } from '@/lib/utils';

/**
 * Alert (shadcn-style API) w stylu `.notice` prototypu „Ludzie i praca”.
 *
 * Baza = `NOTICE` z `panel-styles.ts` bez zewnętrznego marginesu (odstęp daje układ rodzica).
 * Warianty kolorów wyłącznie tokenami: `note` (tło notatki prototypu), `error`
 * (`error-text` na `error/10` — kontrast AA), `success`. Wariant `error` ma domyślnie
 * `role="alert"` (Invariant #11: jasny błąd); pozostałe nie mają roli — komunikat sukcesu
 * ogłaszany dynamicznie dostaje `role="status"` od wywołującego. Komponent serwerowy.
 */
const ALERT_VARIANTS = {
  note: '',
  error: 'border-error/30 bg-error/10 text-error-text',
  success: 'border-success/30 bg-success/10 text-foreground',
} as const;

export type AlertVariant = keyof typeof ALERT_VARIANTS;

export interface AlertProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: AlertVariant;
}

const Alert = React.forwardRef<HTMLDivElement, AlertProps>(
  ({ className, variant = 'note', role, ...props }, ref) => (
    <div
      ref={ref}
      role={role ?? (variant === 'error' ? 'alert' : undefined)}
      className={cn(NOTICE, 'my-0', ALERT_VARIANTS[variant], className)}
      {...props}
    />
  ),
);
Alert.displayName = 'Alert';

const AlertTitle = React.forwardRef<HTMLElement, React.HTMLAttributes<HTMLElement>>(
  ({ className, ...props }, ref) => (
    <strong ref={ref} className={cn(NOTICE_TITLE, className)} {...props} />
  ),
);
AlertTitle.displayName = 'AlertTitle';

const AlertDescription = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <p ref={ref} className={cn(NOTICE_TEXT, className)} {...props} />
));
AlertDescription.displayName = 'AlertDescription';

export { Alert, AlertTitle, AlertDescription };
