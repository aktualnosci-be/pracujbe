import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '@/lib/utils';

/**
 * Button (shadcn-style) — warianty przez cva, kolory wyłącznie klasami Tailwind
 * mapowanymi na tokeny w globals.css. `asChild` renderuje dowolny element (np. Link)
 * z zachowaniem stylów.
 *
 * Uwaga: `asChild` jest zaimplementowane lokalnie przez React.cloneElement zamiast
 * `@radix-ui/react-slot`. Slot wywołuje `createContext` na poziomie modułu, a że Button
 * bywa używany w komponentach SERWEROWYCH (np. ForCompanies), pakiet trafiałby do grafu
 * RSC, gdzie `react` (warunek eksportu react-server) nie udostępnia `createContext`
 * (błąd „createContext is not a function" przy zbieraniu danych stron). Lokalne
 * scalanie propsów utrzymuje Button bezpiecznym po stronie serwera i klienta.
 */
const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground hover:bg-primary-dark',
        /** Czarny przycisk drugiej rangi z prototypu „Ludzie i praca” (nagłówek, „Zobacz wszystkie”). */
        ink: 'bg-foreground text-background hover:bg-foreground/85',
        secondary: 'bg-secondary text-secondary-foreground hover:opacity-90',
        outline: 'border border-input bg-background text-foreground hover:bg-soft',
        ghost: 'text-foreground hover:bg-soft',
        link: 'text-primary underline-offset-4 hover:underline',
        /** `.btn.secondary` z prototypu „Ludzie i praca”: białe tło, linia #ddd, tekst ink (#7). */
        passportSecondary:
          'border border-[color:var(--pp-line-btn)] bg-card text-foreground hover:bg-soft',
      },
      size: {
        default: 'h-12 px-6 py-2',
        sm: 'h-9 rounded-md px-4',
        lg: 'h-12 rounded-md px-8 text-base',
        icon: 'h-11 w-11',
        /** `.people .btn` z prototypu (#7, Z4): 14 px / 650, min. 49 px, promień 11 px, padding 13/21 px. */
        passport: 'min-h-[49px] rounded-[11px] px-[21px] py-[13px] text-sm font-[650]',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, type, children, ...props }, ref) => {
    const classes = cn(buttonVariants({ variant, size }), className);

    if (asChild && React.isValidElement(children)) {
      const child = children as React.ReactElement<Record<string, unknown>>;
      return React.cloneElement(child, {
        ...props,
        ref,
        className: cn(classes, child.props.className as string | undefined),
      });
    }

    return (
      <button ref={ref} type={type ?? 'button'} className={classes} {...props}>
        {children}
      </button>
    );
  },
);
Button.displayName = 'Button';

export { Button, buttonVariants };
