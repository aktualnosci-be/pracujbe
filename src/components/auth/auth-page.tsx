import * as React from 'react';

import { cn } from '@/lib/utils';
import {
  H1_EXTENDED,
  INTRO,
  PAPER,
} from '@/components/dashboard/panel-styles';

/**
 * Strony uwierzytelniania (#7, zadanie Z4 z `docs/design/people-passport/MATRIX.md`).
 *
 * Prototyp nie ma ekranu logowania — strony są złożone z prymitywów widoku `#people/apply`
 * (formularz w panelu): nagłówek `.dash-content.extended` (H1 40/30 px, 750, −0,045em,
 * `.dash-intro` 14 px / 1,7) nad kartą `.paper.demo-form` (promień 22 px, padding 28 px,
 * linia `--pp-line`). Kolumna ma szerokość formularza z prototypu (max. 560 px) i margines
 * `.dash-content` (32 px; ≤ 600 px: 26 px 6%). Nagłówek i stopka witryny daje layout `(auth)`.
 *
 * API odpowiada dawnym `Card*`, żeby strony zmieniły tylko nazwy elementów.
 */

export function AuthPage({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('mx-auto w-full max-w-[560px] px-4 py-8 max-[600px]:px-[6%] max-[600px]:py-[26px]', className)}>
      {children}
    </div>
  );
}

export function AuthPageHeader({ children, className }: { children: React.ReactNode; className?: string }) {
  return <header className={cn('min-w-0', className)}>{children}</header>;
}

export function AuthPageTitle({ children, className }: { children: React.ReactNode; className?: string }) {
  return <h1 className={cn(H1_EXTENDED, className)}>{children}</h1>;
}

export function AuthPageIntro({ children, className }: { children: React.ReactNode; className?: string }) {
  return <p className={cn(INTRO, className)}>{children}</p>;
}

/** `.paper.demo-form` — karta z formularzem. */
export function AuthPaper({ children, className }: { children: React.ReactNode; className?: string }) {
  return <section className={cn(PAPER, 'space-y-6', className)}>{children}</section>;
}

/** Ikona stanu nad nagłówkiem (`.company-icon` prototypu: 48 px, promień 14 px, linia). */
export function AuthPageIcon({ children }: { children: React.ReactNode }) {
  return (
    <span
      className="mb-2 grid size-12 place-items-center rounded-[14px] border border-[color:var(--pp-line)] bg-soft text-primary [&_svg]:size-6"
      aria-hidden="true"
    >
      {children}
    </span>
  );
}

/**
 * `.demo-form input` — promień 11 px, padding 13/14 px, 15 px, min. 48 px (nakłada się na
 * klasy `Input`; obramowanie `border-input` zostaje dla WCAG 1.4.11).
 */
export const AUTH_INPUT = 'h-auto min-h-12 rounded-[11px] px-3.5 py-[13px] text-[15px] leading-[1.5]';

/** `.demo-form label` — 13 px / 600. */
export const AUTH_LABEL = 'text-[13px] font-semibold';
